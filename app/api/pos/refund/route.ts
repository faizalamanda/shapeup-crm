import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'
import { syncOrderToLedger } from '@/lib/orderLedger'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export async function POST(req: Request) {
  try {
    // 1. Auth + Business ID using standard getApiContext()
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    const body = await req.json().catch(() => null)
    if (!body || !body.order_id) {
      return NextResponse.json({ error: 'Order ID wajib disertakan' }, { status: 400 })
    }

    const { order_id, refund_reason = '' } = body
    if (!isUuid(order_id)) {
      return NextResponse.json({ error: 'Order ID tidak valid' }, { status: 400 })
    }

    // 2. Fetch the existing order
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
      return NextResponse.json({ error: 'Pesanan sudah dibatalkan sebelumnya' }, { status: 400 })
    }

    // 3. Resolve Current Active Shift (for Cross-Shift Drawer Cash Deduction)
    const { data: activeShift } = await supabase
      .from('pos_shifts')
      .select('id, cashier_name')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .maybeSingle()

    // 4. Update order status to cancelled and payment_status to unpaid
    const { error: updErr } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        payment_status: 'unpaid',
        amount_paid: 0
      })
      .eq('id', order_id)

    if (updErr) {
      return NextResponse.json({ error: 'Gagal memperbarui status pesanan: ' + updErr.message }, { status: 500 })
    }

    // 5. Delegate Reversal to unified orderLedger service
    // Pass current_shift_id to ensure physical cash refund is deducted from current active drawer
    const preloadedOrder = {
      ...order,
      status: 'cancelled',
      payment_status: 'unpaid',
      amount_paid: 0,
      current_shift_id: activeShift?.id || null,
      refund_reason: refund_reason || 'Refund Pesanan POS'
    }

    const syncRes = await syncOrderToLedger(order_id, supabase, preloadedOrder)
    
    if (!syncRes.success) {
      return NextResponse.json({ error: 'Gagal melakukan sinkronisasi pembalikan ledger: ' + syncRes.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Pesanan berhasil dibatalkan dan direfund.',
      refunded_shift_id: activeShift?.id || null
    }, { status: 200 })

  } catch (err: any) {
    console.error('POS Refund Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
