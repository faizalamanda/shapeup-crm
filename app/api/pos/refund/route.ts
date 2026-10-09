import { createClient, getAuthUser } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'
import { syncOrderToLedger } from '@/lib/orderLedger'

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    // 1. Get logged-in user and active business ID
    const { user, error: authErr } = await getAuthUser(supabase)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found for user profile' }, { status: 400 })
    }

    const businessId = profile.active_business_id
    const body = await req.json()
    const { order_id } = body

    if (!order_id) {
      return NextResponse.json({ error: 'Order ID wajib disertasikan' }, { status: 400 })
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

    // 3. Update order status to cancelled
    const { error: updErr } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', order_id)

    if (updErr) {
      return NextResponse.json({ error: 'Gagal memperbarui status pesanan: ' + updErr.message }, { status: 500 })
    }

    // 4. Delegate Reversal to unified orderLedger service
    // This automatically restores stock safely via stock_moves and reverses financial journals
    const syncRes = await syncOrderToLedger(order_id, supabase)
    
    if (!syncRes.success) {
      return NextResponse.json({ error: 'Gagal melakukan sinkronisasi pembalikan ledger: ' + syncRes.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Pesanan berhasil direfund'
    }, { status: 200 })

  } catch (err: any) {
    console.error('POS Refund Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
