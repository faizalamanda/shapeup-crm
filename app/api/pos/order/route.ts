import { getApiContext } from '@/lib/apiContext'
import { resolveGuestCustomerId } from '@/lib/guestCustomer'
import { syncOrderToLedger } from '@/lib/orderLedger'
import { getPriceGuardSettings } from '@/lib/priceGuard/settings'
import { evaluatePriceFloor } from '@/lib/priceGuard/resolvePriceFloor'
import { NextResponse } from 'next/server'
import { after } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export async function POST(req: Request) {
  try {
    // 1. Auth + Business ID — uses JWT fast-path + cached profile
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx

    // 2. POS Session Gating: Enforce Active Shift
    const { data: activeShift, error: shiftErr } = await supabase
      .from('pos_shifts')
      .select('id, register_id, cashier_name')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .maybeSingle()

    if (shiftErr && !shiftErr.message?.includes('does not exist')) {
      return NextResponse.json({ error: 'Gagal memverifikasi status shift kasir' }, { status: 500 })
    }

    if (!activeShift) {
      return NextResponse.json({
        error: 'Sesi kasir belum dibuka. Anda harus membuka shift kasir terlebih dahulu sebelum melayani transaksi.'
      }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const { 
      customer_id, 
      items, 
      payment_method, 
      payments, // Optional array for split payments
      amount_paid, // Optional explicit paid amount for partial payments/cicilan
      discount_amount = 0, 
      grand_total, 
      subtotal, 
      order_number: clientOrderNumber,
      cash_received = 0,
      change_amount = 0,
      register_id = null,
      reference_number = null,
      order_note = null,
      note = null,
      authorizations = [] // Price Guard Authorization tokens/IDs
    } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Keranjang belanja tidak boleh kosong' }, { status: 400 })
    }

    const numGrandTotal = Number(grand_total) || 0

    // 3. Validate products, stock & HPP Floor Guard
    const productIds = items.filter((i: any) => !String(i.id).startsWith('custom-')).map((i: any) => i.id)

    const productMap = new Map<string, any>()
    if (productIds.length > 0) {
      let prodQuery = supabase
        .from('products')
        .select('id, name, type, price, cost_price, stock_type, stock_quantity, prevent_below_hpp, hpp_type')
        .in('id', productIds)

      let { data: dbProducts, error: prodErr } = await prodQuery

      // Fallback if prevent_below_hpp column is not yet present
      if (prodErr && prodErr.message?.includes('prevent_below_hpp')) {
        const fallback = await supabase
          .from('products')
          .select('id, name, type, price, cost_price, stock_type, stock_quantity')
          .in('id', productIds)
        dbProducts = fallback.data as any
        prodErr = fallback.error
      }

      if (prodErr || !dbProducts) {
        return NextResponse.json({ error: 'Gagal mengambil data produk' }, { status: 500 })
      }
      dbProducts.forEach(p => productMap.set(p.id, p))
    }

    // 3a. Enforce Price Guard Server-Side
    const priceGuardSettings = await getPriceGuardSettings(businessId, ctx.supabaseAdmin)
    const lineItemsForGuard = items.map((item: any) => {
      const dbProd = productMap.get(item.id)
      return {
        id: item.id,
        name: dbProd?.name || item.name,
        price: Number(item.price || 0),
        discount: Number(item.discount || 0),
        quantity: Number(item.quantity || 1),
        isCustom: String(item.id).startsWith('custom-'),
        costPrice: Number(dbProd?.cost_price || 0),
        preventBelowHpp: Boolean(dbProd?.prevent_below_hpp)
      }
    })

    const guardResult = evaluatePriceFloor(
      priceGuardSettings,
      lineItemsForGuard,
      Number(discount_amount || 0)
    )

    if (guardResult.isHardBlocked) {
      return NextResponse.json({
        error: 'Terdapat harga item atau diskon di bawah batas HPP minimum. Pengaturan sistem memblokir penjualan di bawah HPP.'
      }, { status: 422 })
    }

    if (guardResult.hasViolations || guardResult.requiresGlobalDiscountAuth) {
      const validAuthList = Array.isArray(authorizations) ? authorizations : []
      if (validAuthList.length === 0) {
        return NextResponse.json({
          error: 'Terdapat harga item atau diskon global yang memerlukan otorisasi Approver terlebih dahulu.'
        }, { status: 422 })
      }
    }

    for (const item of items) {
      const isCustom = String(item.id).startsWith('custom-')
      if (isCustom) continue

      const dbProd = productMap.get(item.id)
      if (!dbProd) {
        return NextResponse.json({ error: `Produk dengan ID ${item.id} tidak ditemukan` }, { status: 404 })
      }

      if (dbProd.stock_type === 'unavailable') {
        return NextResponse.json({ error: `Produk "${dbProd.name}" sedang tidak tersedia untuk dijual.` }, { status: 400 })
      }

      if (dbProd.stock_type === 'tracked') {
        if (dbProd.stock_quantity < item.quantity) {
          return NextResponse.json({
            error: `Stok untuk "${dbProd.name}" tidak mencukupi. (Tersedia: ${dbProd.stock_quantity}, Diminta: ${item.quantity})`
          }, { status: 400 })
        }
      }
    }

    // 4. Resolve Guest Customer — uses cached guest ID per business
    let resolvedCustomerId = customer_id
    if (!resolvedCustomerId || !isUuid(resolvedCustomerId) || resolvedCustomerId === 'guest' || resolvedCustomerId === '0') {
      resolvedCustomerId = await resolveGuestCustomerId(businessId, ctx.supabaseAdmin)
    }

    // 5. Build Payments List & Calculate Status (Multi-Tender / Installment Support)
    const effectivePayments: Array<{
      method: string
      amount: number
      cash_received: number
      change_amount: number
      reference_number: string | null
      notes: string | null
      is_cash?: boolean
      payment_method_account_id?: string | null
      account_id?: string | null
      account_name?: string | null
    }> = Array.isArray(payments) && payments.length > 0
      ? payments.map((p: any) => ({
          method: String(p.method || 'cash').toLowerCase(),
          amount: Number(p.amount) || 0,
          cash_received: Number(p.cash_received || p.amount || 0),
          change_amount: Number(p.change_amount || 0),
          reference_number: p.reference_number || null,
          notes: p.notes || null,
          is_cash: p.is_cash,
          payment_method_account_id: p.payment_method_account_id || p.account_id || null,
          account_id: p.account_id || p.payment_method_account_id || null,
          account_name: p.account_name || null
        }))
      : [
          {
            method: String(payment_method || 'cash').toLowerCase(),
            amount: Number(amount_paid !== undefined ? amount_paid : numGrandTotal) || 0,
            cash_received: Number(cash_received || numGrandTotal) || 0,
            change_amount: Number(change_amount || 0),
            reference_number: reference_number || null,
            notes: null,
            payment_method_account_id: null,
            account_id: null,
            account_name: null
          }
        ]

    const totalPaid = effectivePayments.reduce((sum, p) => sum + p.amount, 0)
    const paymentStatus: 'paid' | 'partial' | 'unpaid' = 
      totalPaid >= numGrandTotal - 0.01 
        ? 'paid' 
        : (totalPaid > 0 ? 'partial' : 'unpaid')

    // 6. Format Line Items
    const orderNumber = clientOrderNumber || ('POS-' + Date.now().toString().slice(-8))
    
    const lineItems = items.map((item: any, idx: number) => {
      const isCustom = String(item.id).startsWith('custom-')
      const name = isCustom ? (item.name || 'Biaya Kustom') : productMap.get(item.id).name
      const sku = isCustom ? 'CUSTOM' : (productMap.get(item.id).sku || '')
      
      const metaData: any[] = []
      if (item.discount > 0) metaData.push({ key: 'Discount', value: String(item.discount) })
      if (item.variantName) metaData.push({ key: 'Variant', value: String(item.variantName) })
      if (item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
        metaData.push({ key: 'Modifiers', value: item.modifiers.map((m: any) => `${m.group}: ${m.name}`).join(', ') })
      }
      if (item.note) metaData.push({ key: 'Note', value: String(item.note) })

      return {
        id: idx + 1,
        name: name,
        product_id: item.id,
        variation_id: item.variantId || 0,
        variant_name: item.variantName || null,
        modifiers: item.modifiers || [],
        note: item.note || '',
        quantity: item.quantity,
        tax_class: '',
        subtotal: String(item.price * item.quantity),
        subtotal_tax: '0.00',
        total: String((item.price - (item.discount || 0)) * item.quantity),
        total_tax: '0.00',
        taxes: [],
        meta_data: metaData,
        sku: sku,
        price: item.price
      }
    })

    const rawSourceData = {
      id: orderNumber,
      status: 'completed',
      currency: 'IDR',
      total: String(numGrandTotal),
      discount_total: String(discount_amount),
      shipping_total: '0.00',
      payment_method: payment_method === 'cash' ? 'cod' : 'bacs',
      payment_method_title: payment_method === 'cash' ? 'Cash (Tunai)' : 'Bank Card / QRIS',
      cash_received: Number(cash_received) || 0,
      change_amount: Number(change_amount) || 0,
      payments: effectivePayments,
      amount_paid: totalPaid,
      payment_status: paymentStatus,
      line_items: lineItems,
      customer_note: (order_note || note || '').trim() || undefined,
      notes: (order_note || note || '').trim() || undefined,
      price_authorizations: Array.isArray(authorizations) ? authorizations : []
    }

    const assignedRegisterId = isUuid(register_id) ? register_id : (activeShift.register_id || null)

    const orderPayload: any = {
      business_id: businessId,
      customer_id: resolvedCustomerId,
      order_number: orderNumber,
      source_platform: 'POS',
      order_date: new Date().toISOString(),
      order_date_utc: new Date().toISOString(),
      total_qty: items.reduce((acc: number, item: any) => acc + item.quantity, 0),
      subtotal: subtotal || numGrandTotal + discount_amount,
      shipping_cost: 0,
      discount_amount: discount_amount,
      other_fees: 0,
      grand_total: numGrandTotal,
      payment_method: payment_method === 'cash' ? 'Cash' : (effectivePayments.length > 1 ? 'Split Payment' : 'Bank/QRIS'),
      status: 'completed',
      payment_status: paymentStatus,
      amount_paid: totalPaid,
      items_json: lineItems,
      raw_source_data: rawSourceData,
      shift_id: activeShift.id,
      register_id: assignedRegisterId
    }

    const { data: order, error: orderInsertErr } = await supabase
      .from('orders')
      .insert(orderPayload)
      .select('id')
      .single()

    if (orderInsertErr) {
      return NextResponse.json({ error: 'Gagal membuat pesanan: ' + orderInsertErr.message }, { status: 500 })
    }

    // 7. Insert Order Payments (Single Source of Truth)
    try {
      const { getOrCreateDefaultAccounts } = await import('@/lib/accountHelper')
      const accountMap = await getOrCreateDefaultAccounts(businessId, supabaseAdmin || supabase)

      let shiftCashAccId = accountMap['101000']
      if (assignedRegisterId) {
        const { data: regData } = await supabase
          .from('pos_registers')
          .select('account_id')
          .eq('id', assignedRegisterId)
          .maybeSingle()
        if (regData?.account_id) shiftCashAccId = regData.account_id
      }

      const paymentInserts = effectivePayments
        .filter((p) => p.amount > 0)
        .map((p) => {
          const isCash = p.method === 'cash' || p.is_cash === true
          const customAccId = p.payment_method_account_id || p.account_id
          const accId = isUuid(customAccId)
            ? customAccId
            : (isCash ? shiftCashAccId : accountMap['101200'])
          return {
            business_id: businessId,
            order_id: order.id,
            shift_id: activeShift.id,
            date: new Date().toISOString().split('T')[0],
            amount: p.amount,
            payment_method: isCash ? 'cash' : (p.method || 'bank'),
            payment_method_account_id: isUuid(accId) ? accId : null,
            cash_received: p.cash_received || p.amount,
            change_amount: p.change_amount || 0,
            reference_number: p.reference_number || null,
            notes: p.notes || (p.account_name ? `Pembayaran POS #${orderNumber} via ${p.account_name}` : `Pembayaran POS #${orderNumber}`),
            payment_kind: 'payment'
          }
        })

      if (paymentInserts.length > 0) {
        const { error: payErr } = await supabase
          .from('order_payments')
          .insert(paymentInserts)

        if (payErr) {
          console.warn('[POS Order] order_payments insert warning:', payErr.message)
        }
      }
    } catch (payExc) {
      console.warn('[POS Order] Exception inserting order payments:', payExc)
    }

    const fullOrder = { id: order.id, ...orderPayload }

    // 8. Record Ledger transaction, stock reduction & journal lines in background
    after(async () => {
      try {
        const syncRes = await syncOrderToLedger(order.id, supabase, fullOrder)
        if (!syncRes.success) {
          console.error(`[Background Sync] Failed to sync order ${order.id} to ledger:`, syncRes.message)
        }
      } catch (syncErr) {
        console.error(`[Background Sync] Exception syncing order ${order.id}:`, syncErr)
      }
    })

    return NextResponse.json({
      success: true,
      order_id: order.id,
      order_number: orderNumber,
      payment_status: paymentStatus,
      amount_paid: totalPaid,
      outstanding: Math.max(0, numGrandTotal - totalPaid)
    }, { status: 200 })

  } catch (err: any) {
    console.error('POS Checkout Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
