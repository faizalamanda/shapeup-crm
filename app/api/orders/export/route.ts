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

    // 4. Resilient creator attribution enrichment (Graceful fallback before/after DB RPC migration)
    const needsEnrichment = orders.some(o => !o.created_by)
    if (needsEnrichment && orders.length > 0) {
      const internalOrders = orders.filter(o => 
        !o.created_by && ['pos', 'invoice', 'manual'].includes(String(o.source_platform || '').toLowerCase())
      )
      
      if (internalOrders.length > 0) {
        const orderIds = internalOrders.map(o => o.id).filter(Boolean)
        const { data: dbOrders } = await supabaseAdmin
          .from('orders')
          .select('id, user_id, shift_id, pos_shifts(cashier_name), profiles:user_id(full_name, email)')
          .in('id', orderIds)

        if (dbOrders && dbOrders.length > 0) {
          const map = new Map<string, any>()
          dbOrders.forEach((d: any) => map.set(d.id, d))

          orders.forEach((o: any) => {
            if (!o.created_by) {
              const matched = map.get(o.id)
              if (matched) {
                const cashier = matched.pos_shifts?.cashier_name
                const profileName = matched.profiles?.full_name || matched.profiles?.email
                if (cashier && cashier.trim()) {
                  o.created_by = cashier.trim()
                } else if (profileName && profileName.trim()) {
                  o.created_by = profileName.trim()
                }
              }
            }
          })
        }
      }

      // Assign system label for integration platforms if still empty
      orders.forEach((o: any) => {
        if (!o.created_by) {
          const plat = String(o.source_platform || '').trim()
          const lower = plat.toLowerCase()
          if (lower && !['manual', 'pos', 'invoice'].includes(lower)) {
            o.created_by = `Sistem (${plat})`
          } else {
            o.created_by = 'Sistem'
          }
        }
      })
    }

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
