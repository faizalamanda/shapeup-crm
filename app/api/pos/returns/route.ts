import { getApiContext } from '@/lib/apiContext'
import { quoteReturnService, executeReturnService } from '@/lib/pos/returns/returnsService'
import { isUuid } from '@/lib/pos/returns/engine'
import { ReturnError } from '@/lib/pos/returns/types'
import { NextResponse } from 'next/server'

// GET /api/pos/returns?order_id=...
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase } = ctx

    const url = new URL(req.url)
    const orderId = url.searchParams.get('order_id')

    let query = supabase
      .from('pos_returns')
      .select('*, pos_return_items(*)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })

    if (orderId && isUuid(orderId)) {
      query = query.eq('order_id', orderId)
    } else {
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)))
      query = query.limit(limit)
    }

    const { data, error } = await query

    if (error) {
      // If pos_returns table doesn't exist yet, return empty list gracefully
      if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
        return NextResponse.json({ success: true, returns: [] })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, returns: data || [] })
  } catch (err: any) {
    console.error('[API Returns GET]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// POST /api/pos/returns
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx

    // Resolve user role in active business
    const { data: staffRow } = await supabase
      .from('business_staff')
      .select('role')
      .eq('business_id', businessId)
      .eq('profile_id', user.id)
      .maybeSingle()

    const role = staffRow?.role || 'owner'
    const isStaff = Boolean(staffRow)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const {
      action = 'execute',
      order_id,
      items = [],
      exchange_items = [],
      return_method = 'original',
      shift_id = null,
      reason_code = '',
      reason_note = '',
      approver_id = null,
      approver_pin = null,
      idempotency_key = null,
      payment_in = null
    } = body

    if (!isUuid(order_id)) {
      return NextResponse.json({ error: 'order_id wajib disertakan dan harus UUID valid' }, { status: 400 })
    }

    if (action === 'execute' && (!Array.isArray(items) || items.length === 0)) {
      return NextResponse.json({ error: 'Pilih minimal 1 item produk yang akan diretur/ditukar' }, { status: 400 })
    }

    // Action: QUOTE (pre-calculation, read-only preview)
    if (action === 'quote') {
      const quoteRes = await quoteReturnService(
        {
          businessId,
          orderId: order_id,
          items: items.map((i: any) => ({
            ref: String(i.ref || i.id || ''),
            qty: Number(i.qty || i.quantity || 1),
            disposition: i.disposition || 'restock'
          })),
          exchangeItems: (exchange_items || []).map((e: any) => ({
            productId: e.productId || e.product_id || e.id,
            variantId: e.variantId || e.variant_id || null,
            name: e.name || 'Produk Pengganti',
            variantName: e.variantName || e.variant_name || null,
            quantity: Number(e.quantity || e.qty || 1),
            unitPrice: Number(e.unitPrice || e.unit_price || e.price || 0)
          })),
          returnMethod: return_method,
          isStaff,
          role
        },
        supabase
      )

      return NextResponse.json({
        success: true,
        quote: quoteRes.quote,
        returnableLines: quoteRes.returnableLines,
        policy: quoteRes.policy,
        requireApproval: quoteRes.requireApproval,
        approvalReason: quoteRes.approvalReason
      })
    }

    // Action: EXECUTE (commit return/exchange transaction)
    const cashierName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Kasir'

    const execRes = await executeReturnService(
      {
        businessId,
        orderId: order_id,
        items: items.map((i: any) => ({
          ref: String(i.ref || i.id || ''),
          qty: Number(i.qty || i.quantity || 1),
          disposition: i.disposition || 'restock'
        })),
        exchangeItems: (exchange_items || []).map((e: any) => ({
          productId: e.productId || e.product_id || e.id,
          variantId: e.variantId || e.variant_id || null,
          name: e.name || 'Produk Pengganti',
          variantName: e.variantName || e.variant_name || null,
          quantity: Number(e.quantity || e.qty || 1),
          unitPrice: Number(e.unitPrice || e.unit_price || e.price || 0)
        })),
        returnMethod: return_method,
        cashierId: user.id,
        cashierName,
        currentShiftId: shift_id,
        reasonCode: reason_code,
        reasonNote: reason_note,
        approverId: approver_id,
        approverPin: approver_pin,
        idempotencyKey: idempotency_key || undefined,
        paymentIn: payment_in || undefined,
        isStaff,
        role
      },
      supabase,
      supabaseAdmin
    )

    return NextResponse.json({
      ...execRes
    })
  } catch (err: any) {
    if (err instanceof ReturnError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      )
    }
    console.error('[API Returns POST]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
