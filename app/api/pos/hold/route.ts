import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// GET /api/pos/hold - Fetch list of held orders
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase, supabaseAdmin } = ctx
    const dbClient = supabaseAdmin || supabase

    const { data: heldOrders, error: fetchErr } = await dbClient
      .from('pos_held_orders')
      .select('*')
      .eq('business_id', businessId)
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
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx
    const dbClient = supabaseAdmin || supabase

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const { action, hold_id, customer_id, customer_name, cart_json, total_items, grand_total, note } = body

    if (action === 'delete') {
      if (!hold_id) return NextResponse.json({ error: 'hold_id wajib diisi' }, { status: 400 })

      await dbClient
        .from('pos_held_orders')
        .delete()
        .eq('id', hold_id)
        .eq('business_id', businessId)

      return NextResponse.json({ success: true, message: 'Held order deleted' })
    }

    // Save or update hold order
    if (!cart_json || !Array.isArray(cart_json) || cart_json.length === 0) {
      return NextResponse.json({ error: 'Keranjang kosong' }, { status: 400 })
    }

    const sanitizedCustomerId = isUuid(customer_id) ? customer_id : null
    const sanitizedHoldId = isUuid(hold_id) ? hold_id : null
    const effectiveNote = (note || '').trim()

    // 1. If existing hold_id is provided, try updating in-place to prevent duplication
    if (sanitizedHoldId) {
      const { data: updatedHold, error: updateErr } = await dbClient
        .from('pos_held_orders')
        .update({
          user_id: user.id,
          customer_id: sanitizedCustomerId,
          customer_name: customer_name || 'Walk-in',
          note: effectiveNote,
          cart_json: cart_json,
          total_items: total_items || cart_json.length,
          grand_total: Number(grand_total || 0),
          created_at: new Date().toISOString()
        })
        .eq('id', sanitizedHoldId)
        .eq('business_id', businessId)
        .select()
        .maybeSingle()

      if (!updateErr && updatedHold) {
        return NextResponse.json({ success: true, heldOrder: updatedHold, isUpdated: true })
      }
    }

    // 2. Otherwise insert a new hold order
    const { data: newHold, error: insertErr } = await dbClient
      .from('pos_held_orders')
      .insert({
        business_id: businessId,
        user_id: user.id,
        customer_id: sanitizedCustomerId,
        customer_name: customer_name || 'Walk-in',
        note: effectiveNote,
        cart_json: cart_json,
        total_items: total_items || cart_json.length,
        grand_total: Number(grand_total || 0)
      })
      .select()
      .single()

    if (insertErr) {
      console.error('[POS Hold] Failed to insert hold order:', insertErr)
      return NextResponse.json({ error: 'Gagal menyimpan transaksi hold: ' + insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, heldOrder: newHold, isUpdated: false })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
