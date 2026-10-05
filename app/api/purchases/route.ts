import { getApiContext } from '@/lib/apiContext'
import { recordStockMovements, StockMoveInput } from '@/lib/stockLedger'
import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { postJournalTransaction } from '@/lib/journalHelper'

export async function GET(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const all = url.searchParams.get('all') === 'true'
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')
    const search = url.searchParams.get('search') || ''

    if (id) {
      const { data: purchase, error: fetchErr } = await supabase
        .from('purchases')
        .select(`
          *,
          suppliers(id, name)
        `)
        .eq('business_id', businessId)
        .eq('id', id)
        .single()

      if (fetchErr) {
        return NextResponse.json({ error: fetchErr.message }, { status: 500 })
      }
      return NextResponse.json(purchase)
    }

    if (all) {
      const { data: purchases, error: fetchErr } = await supabase
        .from('purchases')
        .select(`
          *,
          suppliers(id, name)
        `)
        .eq('business_id', businessId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })

      if (fetchErr) {
        return NextResponse.json({ error: fetchErr.message }, { status: 500 })
      }
      return NextResponse.json(purchases)
    }

    // Default pagination: 25 items per page
    const page = Math.max(1, parseInt(pageParam || '1', 10))
    const limit = Math.max(1, parseInt(limitParam || '25', 10))
    const from = (page - 1) * limit
    const to = from + limit - 1

    let supplierIds: string[] = []
    if (search.trim()) {
      const { data: matchedSuppliers } = await supabase
        .from('suppliers')
        .select('id')
        .eq('business_id', businessId)
        .ilike('name', `%${search.trim()}%`)
      if (matchedSuppliers && matchedSuppliers.length > 0) {
        supplierIds = matchedSuppliers.map(s => s.id)
      }
    }

    let query = supabase
      .from('purchases')
      .select(`
        *,
        suppliers(id, name)
      `, { count: 'exact' })
      .eq('business_id', businessId)

    if (search.trim()) {
      const trimmed = search.trim()
      if (supplierIds.length > 0) {
        query = query.or(`purchase_number.ilike.%${trimmed}%,supplier_id.in.(${supplierIds.join(',')})`)
      } else {
        query = query.ilike('purchase_number', `%${trimmed}%`)
      }
    }

    const { data: purchases, count, error: fetchErr } = await query
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    return NextResponse.json({
      data: purchases || [],
      totalCount: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const body = await req.json()
    const {
      supplier_id,
      purchase_number,
      date,
      due_date,
      items, // array: { product_id?: string, name: string, quantity: number, price: number, is_physical: boolean }
      discount_amount = 0,
      other_fees = 0,
      amount_paid = 0,
      payment_method_account_id,
      attachment_url
    } = body

    if (!purchase_number || !date || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Resolve Account Mapping (cached)
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accHutang = accountMap['201000'] // Hutang Usaha
    const accPersediaan = accountMap['102000'] // Persediaan Barang
    const accBeban = accountMap['503000'] // Beban Operasional

    if (!accHutang || !accPersediaan || !accBeban) {
      return NextResponse.json({ error: 'Required accounting accounts could not be resolved' }, { status: 500 })
    }

    // Calculate totals
    let physicalSubtotal = 0
    let serviceSubtotal = 0
    items.forEach((item: any) => {
      const itemPrice = parseFloat(item.price) || 0
      const itemQty = parseInt(item.quantity) || 1
      if (item.is_physical) {
        physicalSubtotal += itemPrice * itemQty
      } else {
        serviceSubtotal += itemPrice * itemQty
      }
    })

    const subtotal = physicalSubtotal + serviceSubtotal
    const discount = parseFloat(discount_amount) || 0
    const fees = parseFloat(other_fees) || 0
    const grandTotal = subtotal - discount + fees

    const paidAmt = parseFloat(amount_paid) || 0
    if (paidAmt > 0 && !payment_method_account_id) {
      return NextResponse.json({ error: 'Payment method is required for initial payment' }, { status: 400 })
    }

    const paymentStatus = paidAmt === 0 ? 'unpaid' : (paidAmt >= grandTotal ? 'paid' : 'partial')

    // Allocation ratio to distribute discounts and fees proportionally
    const ratio = subtotal > 0 ? (grandTotal / subtotal) : 1
    const netPhysicalDebit = physicalSubtotal * ratio
    const netServiceDebit = serviceSubtotal * ratio

    const journalLines: any[] = []
    if (netPhysicalDebit > 0) {
      journalLines.push({ account_id: accPersediaan, debit: netPhysicalDebit, credit: 0 })
    }
    if (netServiceDebit > 0) {
      journalLines.push({ account_id: accBeban, debit: netServiceDebit, credit: 0 })
    }
    journalLines.push({ account_id: accHutang, debit: 0, credit: grandTotal })

    const physicalItems = items.filter((item: any) => item.is_physical && item.product_id)
    const aggregatedPhysical = new Map<string, { totalQty: number; totalNetCost: number }>()
    for (const item of physicalItems) {
      const pId = item.product_id
      const qty = parseFloat(item.quantity) || 0
      const netPrice = (parseFloat(item.price) || 0) * ratio
      const existing = aggregatedPhysical.get(pId) || { totalQty: 0, totalNetCost: 0 }
      aggregatedPhysical.set(pId, {
        totalQty: existing.totalQty + qty,
        totalNetCost: existing.totalNetCost + (qty * netPrice)
      })
    }

    const moveTimestamp = (date && date.length === 10 && date === new Date().toISOString().split('T')[0])
      ? new Date().toISOString()
      : (date && date.includes('T') ? date : (date ? `${date}T16:59:59.000Z` : new Date().toISOString()))

    const payJournalLines = paidAmt > 0 ? [
      { account_id: accHutang, debit: paidAmt, credit: 0 },
      { account_id: payment_method_account_id, debit: 0, credit: paidAmt }
    ] : []

    const payload = {
      business_id: businessId,
      supplier_id: supplier_id || null,
      purchase_number,
      date,
      due_date: due_date || null,
      subtotal,
      discount_amount: discount,
      other_fees: fees,
      grand_total: grandTotal,
      amount_paid: paidAmt,
      payment_status: paymentStatus,
      items_json: items,
      attachment_url,
      journal_lines: journalLines,
      physical_items_aggregated: Array.from(aggregatedPhysical.entries()).map(([productId, agg]) => ({
        product_id: productId,
        qty: agg.totalQty,
        net_cost: agg.totalNetCost
      })),
      payment_journal_lines: payJournalLines,
      payment_method_account_id,
      move_timestamp: moveTimestamp
    }

    // Eksekusi Single-Transaction RPC (Zero Tolerance ACID Compliance)
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('create_purchase_transaction_v1', { payload })

    if (rpcErr) {
      console.error(`[Purchases API] RPC Error: ${rpcErr.message}`)
      return NextResponse.json({ error: `Failed to process purchase: ${rpcErr.message}` }, { status: 500 })
    }

    // Fetch the newly created purchase for the response
    const { data: purchase } = await supabase
      .from('purchases')
      .select('*, suppliers(id, name)')
      .eq('id', rpcRes.purchase_id)
      .single()

    return NextResponse.json(purchase)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const body = await req.json()
    const id = url.searchParams.get('id') || body.id

    if (!id) {
      return NextResponse.json({ error: 'Missing purchase ID' }, { status: 400 })
    }

    // 1. Fetch existing purchase
    const { data: oldPurchase, error: getErr } = await supabase
      .from('purchases')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()

    if (getErr || !oldPurchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    if (oldPurchase.payment_status !== 'unpaid' || (oldPurchase.amount_paid || 0) > 0) {
      return NextResponse.json({ error: 'Pembelian tidak dapat diubah karena sudah memiliki riwayat pembayaran/cicilan. Edit hanya dapat dilakukan pada pembelian yang belum terbayar.' }, { status: 400 })
    }

    // Check if there are any payment logs in purchase_payments
    const { count: payCount } = await supabase
      .from('purchase_payments')
      .select('id', { count: 'exact', head: true })
      .eq('purchase_id', id)

    if (payCount && payCount > 0) {
      return NextResponse.json({ error: 'Pembelian tidak dapat diubah karena sudah memiliki riwayat pembayaran.' }, { status: 400 })
    }

    const {
      supplier_id,
      purchase_number,
      date,
      due_date,
      items,
      discount_amount = 0,
      other_fees = 0,
      amount_paid = 0,
      payment_method_account_id,
      attachment_url
    } = body

    if (!purchase_number || !date || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Resolve Account Mapping (cached)
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accHutang = accountMap['201000']
    const accPersediaan = accountMap['102000']
    const accBeban = accountMap['503000']

    if (!accHutang || !accPersediaan || !accBeban) {
      return NextResponse.json({ error: 'Required accounting accounts could not be resolved' }, { status: 500 })
    }

    // 2. Delete old stock moves (PostgreSQL trigger trg_sync_product_stock_from_moves
    // will automatically revert products.stock_quantity upon deletion).
    // Note: Actually, the RPC update_purchase_transaction_v1 handles this natively inside the transaction.
    // We don't need to manually delete it here anymore.

    // 3. Calculate new totals
    let physicalSubtotal = 0
    let serviceSubtotal = 0
    items.forEach((item: any) => {
      const itemPrice = parseFloat(item.price) || 0
      const itemQty = parseInt(item.quantity) || 1
      if (item.is_physical) {
        physicalSubtotal += itemPrice * itemQty
      } else {
        serviceSubtotal += itemPrice * itemQty
      }
    })

    const subtotal = physicalSubtotal + serviceSubtotal
    const discount = parseFloat(discount_amount) || 0
    const fees = parseFloat(other_fees) || 0
    const grandTotal = subtotal - discount + fees

    const paidAmt = parseFloat(amount_paid) || 0
    if (paidAmt > 0 && !payment_method_account_id) {
      return NextResponse.json({ error: 'Payment method is required for initial payment' }, { status: 400 })
    }

    const paymentStatus = paidAmt === 0 ? 'unpaid' : (paidAmt >= grandTotal ? 'paid' : 'partial')
    const ratio = subtotal > 0 ? (grandTotal / subtotal) : 1
    const netPhysicalDebit = physicalSubtotal * ratio
    const netServiceDebit = serviceSubtotal * ratio

    const journalLines: any[] = []
    if (netPhysicalDebit > 0) {
      journalLines.push({ account_id: accPersediaan, debit: netPhysicalDebit, credit: 0 })
    }
    if (netServiceDebit > 0) {
      journalLines.push({ account_id: accBeban, debit: netServiceDebit, credit: 0 })
    }
    journalLines.push({ account_id: accHutang, debit: 0, credit: grandTotal })

    const newPhysicalItems = items.filter((i: any) => i.is_physical && i.product_id)
    const aggregatedNewPhysical = new Map<string, { totalQty: number; totalNetCost: number }>()
    for (const item of newPhysicalItems) {
      const pId = item.product_id
      const qty = parseFloat(item.quantity) || 0
      const netPrice = (parseFloat(item.price) || 0) * ratio
      const existing = aggregatedNewPhysical.get(pId) || { totalQty: 0, totalNetCost: 0 }
      aggregatedNewPhysical.set(pId, {
        totalQty: existing.totalQty + qty,
        totalNetCost: existing.totalNetCost + (qty * netPrice)
      })
    }

    const moveTimestamp = (date && date.length === 10 && date === new Date().toISOString().split('T')[0])
      ? new Date().toISOString()
      : (date && date.includes('T') ? date : (date ? `${date}T16:59:59.000Z` : new Date().toISOString()))

    const payJournalLines = paidAmt > 0 ? [
      { account_id: accHutang, debit: paidAmt, credit: 0 },
      { account_id: payment_method_account_id, debit: 0, credit: paidAmt }
    ] : []

    const payload = {
      business_id: businessId,
      id: id,
      supplier_id: supplier_id || null,
      purchase_number,
      date,
      due_date: due_date || null,
      subtotal,
      discount_amount: discount,
      other_fees: fees,
      grand_total: grandTotal,
      amount_paid: paidAmt,
      payment_status: paymentStatus,
      items_json: items,
      attachment_url,
      journal_lines: journalLines,
      physical_items_aggregated: Array.from(aggregatedNewPhysical.entries()).map(([productId, agg]) => ({
        product_id: productId,
        qty: agg.totalQty,
        net_cost: agg.totalNetCost
      })),
      payment_journal_lines: payJournalLines,
      payment_method_account_id,
      move_timestamp: moveTimestamp
    }

    // Eksekusi Single-Transaction RPC (Zero Tolerance ACID Compliance)
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('update_purchase_transaction_v1', { payload })

    if (rpcErr) {
      console.error(`[Purchases API Edit] RPC Error: ${rpcErr.message}`)
      return NextResponse.json({ error: `Failed to edit purchase: ${rpcErr.message}` }, { status: 500 })
    }

    const { data: updatedPurchase } = await supabase
      .from('purchases')
      .select('*, suppliers(id, name)')
      .eq('id', id)
      .single()

    return NextResponse.json(updatedPurchase)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing purchase ID' }, { status: 400 })
    }

    // Eksekusi Single-Transaction RPC untuk DELETE (Zero Tolerance ACID)
    const { error: rpcErr } = await supabase.rpc('delete_purchase_transaction_v1', { 
      p_business_id: businessId, 
      p_purchase_id: id 
    })

    if (rpcErr) {
      console.error(`[Purchases API Delete] RPC Error: ${rpcErr.message}`)
      return NextResponse.json({ error: `Failed to delete purchase: ${rpcErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
