import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { formatPhoneNumberSmart } from '@/lib/utils'
import { syncOrderToLedger } from '@/lib/orderLedger'

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const { name, phone, items, total_amount, payment_method = 'Cash' } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Daftar produk tidak boleh kosong' }, { status: 400 })
    }

    // 1. Sanitize Phone
    const cleanPhone = formatPhoneNumberSmart(phone || '0')

    // 2. UPSERT Customer
    const { data: customer, error: custError } = await supabaseAdmin
      .from('customers')
      .upsert({ 
        business_id: businessId,
        phone: cleanPhone, 
        name: name || 'Pelanggan Manual'
      }, { onConflict: 'phone' })
      .select('id')
      .single()

    if (custError) throw custError

    const orderNumber = 'MAN-' + Date.now().toString().slice(-8)
    const numTotal = Number(total_amount) || 0

    const lineItems = items.map((item: any, idx: number) => ({
      id: idx + 1,
      name: item.product_name,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      total: String(Number(item.quantity || 1) * Number(item.price || 0))
    }))

    // 3. INSERT ke Tabel Orders
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        business_id: businessId,
        user_id: user.id,
        customer_id: customer.id,
        order_number: orderNumber,
        source_platform: 'Manual',
        status: 'completed',
        payment_status: 'paid',
        amount_paid: numTotal,
        payment_method: payment_method,
        grand_total: numTotal,
        subtotal: numTotal,
        total_qty: items.reduce((sum: number, i: any) => sum + Number(i.quantity || 1), 0),
        items_json: lineItems,
        order_date: new Date().toISOString(),
        order_date_utc: new Date().toISOString()
      })
      .select('id, order_number')
      .single()

    if (orderError) throw orderError

    // 4. Synchronize to Accounting & Payment Ledger
    try {
      await syncOrderToLedger(order.id, supabaseAdmin)
    } catch (syncErr) {
      console.warn('[Manual Order Sync] Warning syncing to ledger:', syncErr)
    }

    return NextResponse.json({ success: true, orderId: order.id, order_number: order.order_number })
  } catch (error: any) {
    console.error('Manual order create error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}