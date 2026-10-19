import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'

export async function POST(req: Request) {
  try {
    // 1. Strict Auth & Business Context (Zero-Tolerance RLS)
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    // 2. Parse request body safely
    const body = await req.json().catch(() => ({}))
    const search: string = typeof body.search === 'string' ? body.search.trim() : ''
    const rules: any[] = Array.isArray(body.rules) ? body.rules : []
    
    // Validate pagination bounds (max chunk 1000 for high-speed PostgREST streaming)
    const rawLimit = Number(body.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 1000
    
    const rawOffset = Number(body.offset)
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0

    // 3. Query orders using get_order_list with strictly pinned businessId
    const { data, error } = await supabaseAdmin.rpc('get_order_list', {
      p_business_id: businessId,
      p_search: search || null,
      p_rules: rules,
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      console.error('[Orders Export API] Error calling get_order_list:', error)
      return NextResponse.json({ error: error.message || 'Gagal mengambil data pesanan' }, { status: 500 })
    }

    const orders = Array.isArray(data) ? data : []

    return NextResponse.json({
      success: true,
      orders,
      offset,
      limit,
      count: orders.length,
    })
  } catch (err: any) {
    console.error('[Orders Export API] Unhandled server error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
