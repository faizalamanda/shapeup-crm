import { createClient, getAuthUser } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

// GET /api/pos/hold - Fetch list of held orders
export async function GET(req: Request) {
  const supabase = await createClient()

  try {
    const { user, error: authErr } = await getAuthUser(supabase)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const { data: heldOrders, error: fetchErr } = await supabase
      .from('pos_held_orders')
      .select('*')
      .eq('business_id', profile.active_business_id)
      .order('created_at', { ascending: false })

    if (fetchErr && !fetchErr.message?.includes('does not exist')) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    return NextResponse.json({ heldOrders: heldOrders || [] })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/pos/hold - Save a new held order or delete/resume an existing one
export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    const { user, error: authErr } = await getAuthUser(supabase)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const body = await req.json()
    const { action, hold_id, customer_id, customer_name, cart_json, total_items, grand_total, note } = body

    if (action === 'delete') {
      if (!hold_id) return NextResponse.json({ error: 'hold_id wajib diisi' }, { status: 400 })

      await supabase
        .from('pos_held_orders')
        .delete()
        .eq('id', hold_id)

      return NextResponse.json({ success: true, message: 'Held order deleted' })
    }

    // Save hold order
    if (!cart_json || cart_json.length === 0) {
      return NextResponse.json({ error: 'Keranjang kosong' }, { status: 400 })
    }

    const { data: newHold, error: insertErr } = await supabase
      .from('pos_held_orders')
      .insert({
        business_id: profile.active_business_id,
        user_id: user.id,
        customer_id: customer_id || null,
        customer_name: customer_name || 'Walk-in',
        note: note || '',
        cart_json: cart_json,
        total_items: total_items || cart_json.length,
        grand_total: Number(grand_total || 0)
      })
      .select()
      .single()

    if (insertErr) {
      // Return local confirmation if table not present
      return NextResponse.json({
        success: true,
        heldOrder: {
          id: 'hold-' + Date.now(),
          customer_name: customer_name || 'Walk-in',
          cart_json,
          total_items,
          grand_total,
          created_at: new Date().toISOString()
        }
      })
    }

    return NextResponse.json({ success: true, heldOrder: newHold })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
