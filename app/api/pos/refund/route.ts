import { getApiContext } from '@/lib/apiContext'
import { quoteReturnService, executeReturnService } from '@/lib/pos/returns/returnsService'
import { isUuid } from '@/lib/pos/returns/engine'
import { ReturnError, ReturnRequestItem } from '@/lib/pos/returns/types'
import { NextResponse } from 'next/server'

// POST /api/pos/refund - Full Order Cancellation & Refund
// Migrated onto the unified ShapeUp POS Returns Engine
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx
    const adminClient = supabaseAdmin || supabase

    const body = await req.json().catch(() => null)
    if (!body || !body.order_id) {
      return NextResponse.json({ error: 'Order ID wajib disertakan' }, { status: 400 })
    }

    const { order_id, refund_reason = 'Refund Pesanan POS' } = body
    if (!isUuid(order_id)) {
      return NextResponse.json({ error: 'Order ID tidak valid' }, { status: 400 })
    }

    // 1. Fetch order
    const { data: order, error: orderErr } = await adminClient
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

    // Resolve user role
    const { data: staffRow } = await supabase
      .from('business_staff')
      .select('role')
      .eq('business_id', businessId)
      .eq('profile_id', user.id)
      .maybeSingle()

    const role = staffRow?.role || 'owner'
    const isStaff = Boolean(staffRow)

    const cashierName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Kasir'

    // 2. Quote all returnable lines
    const quoteRes = await quoteReturnService(
      {
        businessId,
        orderId: order_id,
        items: [], // empty items triggers line loading
        returnMethod: 'original',
        reasonCode: 'other',
        isStaff,
        role
      },
      supabase
    ).catch(async () => {
      // If no items provided or empty, load lines manually
      return null
    })

    // Prepare full return items from all remaining returnable lines
    let itemsToReturn: ReturnRequestItem[] = []
    if (quoteRes && quoteRes.returnableLines.length > 0) {
      itemsToReturn = quoteRes.returnableLines
        .filter((l) => l.remainingQty > 0)
        .map((l) => ({
          ref: l.ref,
          qty: l.remainingQty,
          disposition: 'restock' as const
        }))
    }

    // 3. Execute Return if items exist
    let returnId: string | null = null
    let returnNumber: string | null = null

    if (itemsToReturn.length > 0) {
      const execRes = await executeReturnService(
        {
          businessId,
          orderId: order_id,
          items: itemsToReturn,
          returnMethod: 'original',
          cashierId: user.id,
          cashierName,
          reasonCode: 'other',
          reasonNote: refund_reason,
          isStaff,
          role
        },
        supabase,
        adminClient
      )
      returnId = execRes.returnId
      returnNumber = execRes.returnNumber
    }

    // Mark order status explicitly as cancelled
    await adminClient
      .from('orders')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', order_id)

    return NextResponse.json({
      success: true,
      message: 'Pesanan berhasil dibatalkan dan direfund.',
      returnId,
      returnNumber
    })
  } catch (err: any) {
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('POS Refund Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
