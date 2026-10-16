import { getApiContext } from '@/lib/apiContext'
import { recordStockMovements, StockMoveInput } from '@/lib/stockLedger'
import { postJournalTransaction } from '@/lib/journalHelper'
import { getOrCreateDefaultAccounts } from '@/lib/accountHelper'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// POST /api/pos/order/exchange - Atomic Exchange (Tukar Barang / Return & Replace)
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const {
      order_id,
      return_items = [], // [{ product_id, variant_id, quantity, price, name, condition: 'good' | 'damaged' }]
      new_items = [],    // [{ id, variantId, quantity, price, name }]
      payment_method = 'cash',
      payment_method_account_id = null,
      cash_received = 0,
      change_amount = 0,
      notes = ''
    } = body

    if (!isUuid(order_id)) {
      return NextResponse.json({ error: 'order_id tidak valid' }, { status: 400 })
    }

    if (!Array.isArray(return_items) || return_items.length === 0) {
      return NextResponse.json({ error: 'Minimal 1 produk harus dipilih untuk ditukar/dikembalikan' }, { status: 400 })
    }

    if (!Array.isArray(new_items) || new_items.length === 0) {
      return NextResponse.json({ error: 'Minimal 1 produk baru pengganti harus dipilih' }, { status: 400 })
    }

    // 1. Fetch Existing Order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .eq('business_id', businessId)
      .single()

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Pesanan tidak ditemukan' }, { status: 404 })
    }

    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Pesanan sudah dibatalkan sebelumnya dan tidak dapat ditukar.' }, { status: 400 })
    }

    // 2. Resolve Active Cashier Shift (Enforced if cash tender involved)
    const { data: activeShift, error: shiftErr } = await supabase
      .from('pos_shifts')
      .select('id, register_id, cashier_name')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .maybeSingle()

    // 3. Compute Values: Return Value vs New Purchase Value
    const returnTotal = return_items.reduce((sum: number, i: any) => sum + (Number(i.price || 0) * Number(i.quantity || 1)), 0)
    const newTotal = new_items.reduce((sum: number, i: any) => sum + (Number(i.price || 0) * Number(i.quantity || 1)), 0)
    const delta = newTotal - returnTotal // > 0: customer pays difference, < 0: store refunds difference, === 0: even exchange

    const oldGrandTotal = Number(order.grand_total || 0)
    const oldPaid = Number(order.amount_paid || 0)
    const newGrandTotal = Math.max(0, oldGrandTotal + delta)

    let cashRefundAmount = 0
    let arReduction = 0
    if (delta < 0) {
      const absDelta = Math.abs(delta)
      if (oldPaid > newGrandTotal) {
        cashRefundAmount = oldPaid - newGrandTotal
        arReduction = absDelta - cashRefundAmount
      } else {
        cashRefundAmount = 0
        arReduction = absDelta
      }
    }

    const isCash = String(payment_method).toLowerCase() === 'cash'
    const requiresCashPayment = delta > 0 && isCash
    const requiresCashRefund = delta < 0 && isCash && cashRefundAmount > 0
    if ((requiresCashPayment || requiresCashRefund) && (shiftErr || !activeShift)) {
      return NextResponse.json({
        error: 'Sesi kasir belum dibuka. Anda harus membuka shift kasir aktif di POS untuk memproses transaksi tunai.'
      }, { status: 403 })
    }

    // 4. Validate Products, Stock & Load Cost Prices for COGS
    const allProductIds = Array.from(new Set([
      ...return_items.map((i: any) => i.product_id),
      ...new_items.map((i: any) => i.id)
    ])).filter((id: any) => isUuid(id))

    let pMap = new Map<string, any>()
    if (allProductIds.length > 0) {
      const { data: dbProducts } = await supabase
        .from('products')
        .select('id, name, stock_type, stock_quantity, cost_price')
        .in('id', allProductIds)
      
      pMap = new Map((dbProducts || []).map((p: any) => [p.id, p]))
      for (const ni of new_items) {
        const dbP = pMap.get(ni.id)
        if (dbP && dbP.stock_type === 'tracked' && dbP.stock_quantity < ni.quantity) {
          return NextResponse.json({
            error: `Stok produk "${dbP.name}" tidak mencukupi untuk pertukaran (Tersedia: ${dbP.stock_quantity}, Dibutuhkan: ${ni.quantity})`
          }, { status: 400 })
        }
      }
    }

    // Calculate COGS impact
    let returnGoodCost = 0
    for (const ri of return_items) {
      if (ri.condition !== 'damaged') {
        const dbP = pMap.get(ri.product_id)
        const cp = Number(dbP?.cost_price || 0)
        returnGoodCost += cp * Math.abs(Number(ri.quantity || 1))
      }
    }
    let newItemsCost = 0
    for (const ni of new_items) {
      const dbP = pMap.get(ni.id)
      const cp = Number(dbP?.cost_price || 0)
      newItemsCost += cp * Math.abs(Number(ni.quantity || 1))
    }
    const netCogsChange = Math.round(newItemsCost - returnGoodCost)

    // 5. Chart of Accounts
    const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)
    let tenderAccId = payment_method_account_id
    if (!tenderAccId) {
      tenderAccId = isCash ? accountMap['101000'] : accountMap['101200']
      if (isCash && activeShift?.register_id) {
        const { data: reg } = await supabase.from('pos_registers').select('account_id').eq('id', activeShift.register_id).maybeSingle()
        if (reg?.account_id) tenderAccId = reg.account_id
      }
    }

    const currentShiftId = activeShift ? activeShift.id : (order.shift_id || null)
    const currentCashierName = activeShift ? activeShift.cashier_name : (user.user_metadata?.full_name || 'Kasir')

    // 6. Record Payment or Refund Event in order_payments & Journal
    let paymentTransactionId: string | null = null
    const journalLines: Array<{ account_id: string; debit: number; credit: number }> = []

    if (delta > 0) {
      // Customer pays extra (Tukar Tambah)
      const { data: payRow, error: pErr } = await supabase
        .from('order_payments')
        .insert({
          business_id: businessId,
          order_id: order.id,
          shift_id: isUuid(currentShiftId) ? currentShiftId : null,
          date: new Date().toISOString().split('T')[0],
          amount: delta,
          payment_method: isCash ? 'cash' : payment_method,
          payment_method_account_id: isUuid(tenderAccId) ? tenderAccId : null,
          cash_received: isCash ? Number(cash_received || delta) : delta,
          change_amount: isCash ? Number(change_amount || 0) : 0,
          notes: notes || `Tukar Tambah POS #${order.order_number} (${currentCashierName})`,
          payment_kind: 'payment'
        })
        .select('id')
        .single()

      if (!pErr && payRow) {
        // Journal: Debit Kas/Bank, Credit Penjualan
        journalLines.push(
          { account_id: tenderAccId, debit: delta, credit: 0 },
          { account_id: accountMap['401000'], debit: 0, credit: delta }
        )
      }
    } else if (delta < 0) {
      const absDelta = Math.abs(delta)
      if (cashRefundAmount > 0) {
        // Store refunds cash difference (Tukar Turun dengan Pengembalian Dana Kasir)
        const { error: rErr } = await supabase
          .from('order_payments')
          .insert({
            business_id: businessId,
            order_id: order.id,
            shift_id: isUuid(currentShiftId) ? currentShiftId : null,
            date: new Date().toISOString().split('T')[0],
            amount: cashRefundAmount,
            payment_method: isCash ? 'cash' : payment_method,
            payment_method_account_id: isUuid(tenderAccId) ? tenderAccId : null,
            cash_received: cashRefundAmount,
            change_amount: 0,
            notes: notes || `Refund Selisih Tukar Barang POS #${order.order_number} (${currentCashierName})`,
            payment_kind: 'refund'
          })
        if (rErr) console.warn('[Exchange] order_payments refund warning:', rErr.message)
      }

      // Journal: Debit Penjualan, Credit Tender (if cash refund) & Credit Piutang (if AR reduced)
      journalLines.push({ account_id: accountMap['401000'], debit: absDelta, credit: 0 })
      if (cashRefundAmount > 0) {
        journalLines.push({ account_id: tenderAccId, debit: 0, credit: cashRefundAmount })
      }
      if (arReduction > 0) {
        journalLines.push({ account_id: accountMap['103000'], debit: 0, credit: arReduction })
      }
    }

    // Attach COGS / Inventory balancing lines to journal if applicable
    if (netCogsChange > 0) {
      journalLines.push(
        { account_id: accountMap['501000'], debit: netCogsChange, credit: 0 },
        { account_id: accountMap['102000'], debit: 0, credit: netCogsChange }
      )
    } else if (netCogsChange < 0) {
      const absCogs = Math.abs(netCogsChange)
      journalLines.push(
        { account_id: accountMap['102000'], debit: absCogs, credit: 0 },
        { account_id: accountMap['501000'], debit: 0, credit: absCogs }
      )
    }

    if (journalLines.length > 0) {
      try {
        const jRes = await postJournalTransaction(
          businessId,
          order.id,
          new Date().toISOString(),
          `Penukaran Barang #${order.order_number} - ${currentCashierName}`,
          journalLines,
          supabase,
          true
        )
        paymentTransactionId = jRes?.transactionId || null
      } catch (jErr: any) {
        console.warn('[Exchange] Journal error:', jErr)
      }
    }

    // 7. Physical Stock Movements (Distinct Event Sourcing with unique exchangeId)
    const exchangeId = crypto.randomUUID()
    const exchangeRef = `EXCHANGE-${order.order_number}`
    const stockMoveInputs: StockMoveInput[] = []

    // 7a. Returned items (+qty back to quarantine or main bucket)
    for (const ri of return_items) {
      if (isUuid(ri.product_id)) {
        const dbP = pMap.get(ri.product_id)
        stockMoveInputs.push({
          businessId,
          productId: ri.product_id,
          reference: exchangeRef,
          qty: Math.abs(Number(ri.quantity || 1)),
          unitCost: Number(dbP?.cost_price || ri.price || 0),
          type: 'receipt',
          sourceType: 'order_exchange',
          sourceId: exchangeId,
          status: 'done',
          bucket: ri.condition === 'damaged' ? 'quarantine' : 'main',
          createdAt: new Date().toISOString()
        })
      }
    }

    // 7b. New items (-qty from main shelf)
    for (const ni of new_items) {
      if (isUuid(ni.id)) {
        const dbP = pMap.get(ni.id)
        stockMoveInputs.push({
          businessId,
          productId: ni.id,
          reference: exchangeRef,
          qty: Math.abs(Number(ni.quantity || 1)),
          unitCost: Number(dbP?.cost_price || ni.price || 0),
          type: 'delivery',
          sourceType: 'order_exchange',
          sourceId: exchangeId,
          status: 'done',
          bucket: 'main',
          createdAt: new Date().toISOString()
        })
      }
    }

    if (stockMoveInputs.length > 0) {
      try {
        await recordStockMovements(stockMoveInputs, supabase)
      } catch (smErr: any) {
        console.warn('[Exchange] stock_moves error (non-fatal):', smErr)
      }
    }

    // 8. Update Order Items & Financial Totals
    const currentItems: any[] = Array.isArray(order.items_json) ? order.items_json : []
    const updatedItems = [...currentItems]

    // Append return markers
    return_items.forEach((ri: any) => {
      updatedItems.push({
        id: `retur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product_id: ri.product_id,
        name: `[RETUR] ${ri.name || 'Produk'}`,
        variant_name: ri.variant_name || null,
        quantity: -Math.abs(Number(ri.quantity || 1)),
        price: Number(ri.price || 0),
        subtotal: String(-Math.abs(Number(ri.price || 0) * Number(ri.quantity || 1))),
        total: String(-Math.abs(Number(ri.price || 0) * Number(ri.quantity || 1))),
        note: `Ditukar: Kondisi ${ri.condition === 'damaged' ? 'Karantina' : 'Layak Jual'}`
      })
    })

    // Append new replacement items
    new_items.forEach((ni: any) => {
      updatedItems.push({
        id: `exchange-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product_id: ni.id,
        name: `[PENGGANTI] ${ni.name || 'Produk'}`,
        variant_name: ni.variantName || null,
        quantity: Math.abs(Number(ni.quantity || 1)),
        price: Number(ni.price || 0),
        subtotal: String(Math.abs(Number(ni.price || 0) * Number(ni.quantity || 1))),
        total: String(Math.abs(Number(ni.price || 0) * Number(ni.quantity || 1))),
        note: 'Barang pengganti penukaran'
      })
    })

    const newAmountPaid = Math.max(0, oldPaid + (delta > 0 ? delta : -cashRefundAmount))
    const newPaymentStatus: 'paid' | 'partial' | 'unpaid' =
      newAmountPaid >= newGrandTotal - 0.01 ? 'paid' : (newAmountPaid > 0 ? 'partial' : 'unpaid')

    const { error: updOrderErr } = await supabase
      .from('orders')
      .update({
        grand_total: newGrandTotal,
        amount_paid: newAmountPaid,
        payment_status: newPaymentStatus,
        items_json: updatedItems,
        updated_at: new Date().toISOString()
      })
      .eq('id', order.id)

    if (updOrderErr) {
      return NextResponse.json({ error: 'Gagal memperbarui data pesanan: ' + updOrderErr.message }, { status: 500 })
    }

    let messageText = 'Pertukaran barang berhasil diproses.'
    if (delta > 0) {
      messageText += ` Diterima selisih: Rp ${delta.toLocaleString('id-ID')}`
    } else if (delta < 0) {
      if (cashRefundAmount > 0 && arReduction > 0) {
        messageText += ` Direfund tunai: Rp ${cashRefundAmount.toLocaleString('id-ID')} & sisa piutang berkurang Rp ${arReduction.toLocaleString('id-ID')}`
      } else if (cashRefundAmount > 0) {
        messageText += ` Direfund selisih: Rp ${cashRefundAmount.toLocaleString('id-ID')}`
      } else {
        messageText += ` Sisa tagihan berkurang Rp ${arReduction.toLocaleString('id-ID')} (tanpa uang keluar dari kasir).`
      }
    } else {
      messageText += ' Even exchange (tanpa selisih harga).'
    }

    return NextResponse.json({
      success: true,
      message: messageText
    }, { status: 200 })

  } catch (err: any) {
    console.error('POS Exchange API Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
