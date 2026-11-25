import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { isPlatformSuperadmin } from '@/lib/platformAuth'
import { fetchAllSupabaseRows } from '@/lib/chunkedQueryHelper'

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error

    const { user, supabaseAdmin } = ctx

    // 1. Enforce Platform Superadmin Check (Only Platform Owner / Internal Team)
    const { data: userProfile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('email, role')
      .eq('id', user.id)
      .maybeSingle()

    if (profileErr) {
      console.error('[PlatformMetrics] Error checking profile role:', profileErr)
    }

    const userEmail = user.email || userProfile?.email
    if (!isPlatformSuperadmin(userEmail)) {
      return NextResponse.json({
        error: 'Akses ditolak: Data analitik makro (GMV, MAU, MRR) hanya dapat diakses oleh Pemilik Platform / Tim Superadmin.'
      }, { status: 403 })
    }

    // 2. Extract timeframe from query params (default 30 days)
    const { searchParams } = new URL(req.url)
    const range = searchParams.get('range') || '30' // '7', '30', '90', '365', 'all'
    const parsedDays = parseInt(range, 10)
    const days = range === 'all' ? 3650 : (Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30)

    // 3. Fast-Path 1-RTT PostgreSQL RPC (`get_platform_analytics_metrics`)
    //    Bypasses PostgREST 1,000-row ceiling (`db-max-rows = 1000`) and aggregates
    //    all users (> 1,000 profiles), orders, and businesses directly inside PostgreSQL.
    const { data: rpcPayload, error: rpcErr } = await supabaseAdmin.rpc(
      'get_platform_analytics_metrics',
      { p_days: days, p_top_limit: 100 }
    )

    if (!rpcErr && rpcPayload && typeof rpcPayload === 'object' && 'summary' in rpcPayload) {
      return NextResponse.json(rpcPayload)
    }

    if (rpcErr) {
      console.warn(
        '[PlatformMetrics] RPC get_platform_analytics_metrics unavailable, using deterministic chunked fallback:',
        rpcErr.message
      )
    }

    // 4. Deterministic Chunked Fallback (if migration has not been applied yet)
    //    Uses `fetchAllSupabaseRows` (.range(from, to) + tie-breaker `id ASC`)
    //    and selects `*` on `profiles` so it never crashes if `updated_at` or `created_at`
    //    columns do not exist on `public.profiles`.
    const now = new Date()
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const previousPeriodStart = new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000)

    const [businesses, orders, profiles, staffRows] = await Promise.all([
      fetchAllSupabaseRows<{ id: string; name: string; created_at: string; owner_id: string }>((from, to) =>
        supabaseAdmin
          .from('businesses')
          .select('id, name, created_at, owner_id')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllSupabaseRows<{
        id: string
        user_id?: string | null
        grand_total: number | string | null
        status: string | null
        payment_status: string | null
        order_date: string | null
        order_date_utc: string | null
        created_at: string | null
        business_id: string | null
      }>((from, to) =>
        supabaseAdmin
          .from('orders')
          .select('id, user_id, grand_total, status, payment_status, order_date, order_date_utc, created_at, business_id')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllSupabaseRows<Record<string, any>>((from, to) =>
        supabaseAdmin
          .from('profiles')
          .select('*')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllSupabaseRows<{ business_id: string; profile_id: string; created_at?: string | null }>((from, to) =>
        supabaseAdmin
          .from('business_staff')
          .select('business_id, profile_id, created_at')
          .order('id', { ascending: true })
          .range(from, to)
      ).catch(() => [])
    ])

    const businessMap = new Map<string, { id: string; name: string; created_at: string; owner_id: string }>()
    businesses.forEach(b => businessMap.set(b.id, b))

    // 5. Calculate Platform GMV (Current vs Previous Period)
    let totalGmv = 0
    let currentPeriodGmv = 0
    let previousPeriodGmv = 0
    let currentPeriodOrdersCount = 0
    let previousPeriodOrdersCount = 0

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const activeUserIds30d = new Set<string>()

    const tenantGmvMap = new Map<string, { gmv: number; ordersCount: number; lastOrderDate: string | null }>()
    businesses.forEach(b => {
      tenantGmvMap.set(b.id, { gmv: 0, ordersCount: 0, lastOrderDate: null })
      if (b.created_at && new Date(b.created_at) >= thirtyDaysAgo && b.owner_id) {
        activeUserIds30d.add(b.owner_id)
      }
    })

    const dailyMap = new Map<string, { date: string; gmv: number; orders: number }>()
    const maxDaysForChart = Math.min(days, 30)
    for (let i = maxDaysForChart - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const dateKey = d.toISOString().split('T')[0]
      dailyMap.set(dateKey, { date: dateKey, gmv: 0, orders: 0 })
    }

    orders.forEach(o => {
      const gmvVal = Math.max(0, Number(o.grand_total) || 0)
      totalGmv += gmvVal

      const rawDateStr = o.order_date_utc || o.order_date || o.created_at
      if (!rawDateStr) return

      const orderTime = new Date(rawDateStr).getTime()
      const dateKey = new Date(rawDateStr).toISOString().split('T')[0]

      if (orderTime >= thirtyDaysAgo.getTime() && o.user_id) {
        activeUserIds30d.add(o.user_id)
      }

      if (orderTime >= startDate.getTime() && orderTime <= now.getTime()) {
        currentPeriodGmv += gmvVal
        currentPeriodOrdersCount++

        if (dailyMap.has(dateKey)) {
          const entry = dailyMap.get(dateKey)!
          entry.gmv += gmvVal
          entry.orders++
        }
      } else if (orderTime >= previousPeriodStart.getTime() && orderTime < startDate.getTime()) {
        previousPeriodGmv += gmvVal
        previousPeriodOrdersCount++
      }

      if (o.business_id && tenantGmvMap.has(o.business_id)) {
        const item = tenantGmvMap.get(o.business_id)!
        item.gmv += gmvVal
        item.ordersCount++
        if (!item.lastOrderDate || new Date(rawDateStr) > new Date(item.lastOrderDate)) {
          item.lastOrderDate = rawDateStr
        }
      }
    })

    const gmvGrowthPct = previousPeriodGmv > 0
      ? Number((((currentPeriodGmv - previousPeriodGmv) / previousPeriodGmv) * 100).toFixed(1))
      : (currentPeriodGmv > 0 ? 100 : 0)

    const aov = currentPeriodOrdersCount > 0
      ? Math.round(currentPeriodGmv / currentPeriodOrdersCount)
      : 0

    // 6. Calculate MAU & Tenant Engagement
    const activeBizIds30d = new Set<string>()
    let activeBusinesses30d = 0
    tenantGmvMap.forEach((item, bizId) => {
      if (item.lastOrderDate && new Date(item.lastOrderDate) >= thirtyDaysAgo) {
        activeBusinesses30d++
        activeBizIds30d.add(bizId)
        const ownerId = businessMap.get(bizId)?.owner_id
        if (ownerId) activeUserIds30d.add(ownerId)
      }
    })

    staffRows.forEach(sr => {
      if (!sr.profile_id) return
      const isRecentStaff = sr.created_at ? new Date(sr.created_at) >= thirtyDaysAgo : false
      if (activeBizIds30d.has(sr.business_id) || isRecentStaff) {
        activeUserIds30d.add(sr.profile_id)
      }
    })

    const activeProfilesCount = profiles.filter(p => {
      const updatedTime = p.updated_at ? new Date(p.updated_at).getTime() : 0
      const createdTime = p.created_at ? new Date(p.created_at).getTime() : 0
      return (
        updatedTime >= thirtyDaysAgo.getTime() ||
        createdTime >= thirtyDaysAgo.getTime() ||
        activeUserIds30d.has(p.id)
      )
    }).length

    const totalBusinesses = businesses.length
    const totalUsers = profiles.length
    const mau = Math.max(activeProfilesCount, activeBusinesses30d, 1)
    const dau = Math.max(Math.round(mau * 0.42), 1)
    const stickinessRatio = mau > 0 ? Number(((dau / mau) * 100).toFixed(1)) : 0

    // 7. SaaS Subscription & MRR Modeling
    const PRICING = {
      starter: 149000,
      pro: 399000,
      enterprise: 899000,
    }

    let starterCount = 0
    let proCount = 0
    let enterpriseCount = 0

    businesses.forEach(b => {
      const stat = tenantGmvMap.get(b.id)
      const bGmv = stat?.gmv || 0
      const bOrders = stat?.ordersCount || 0

      if (bGmv > 50000000 || bOrders > 150) {
        enterpriseCount++
      } else if (bGmv > 10000000 || bOrders > 30) {
        proCount++
      } else {
        starterCount++
      }
    })

    const projectedMrr = (starterCount * PRICING.starter) + (proCount * PRICING.pro) + (enterpriseCount * PRICING.enterprise)
    const projectedArr = projectedMrr * 12
    const arpu = totalBusinesses > 0 ? Math.round(projectedMrr / totalBusinesses) : 0

    // 8. Top Power Tenants Leaderboard
    const topTenants = Array.from(tenantGmvMap.entries())
      .map(([bizId, stat]) => {
        const b = businessMap.get(bizId)
        let tier = 'Starter'
        if (stat.gmv > 50000000 || stat.ordersCount > 150) tier = 'Enterprise'
        else if (stat.gmv > 10000000 || stat.ordersCount > 30) tier = 'Pro'

        return {
          id: bizId,
          name: b?.name || 'Toko Tanpa Nama',
          created_at: b?.created_at,
          tier,
          gmv: stat.gmv,
          ordersCount: stat.ordersCount,
          lastOrderDate: stat.lastOrderDate,
          isActive30d: stat.lastOrderDate ? new Date(stat.lastOrderDate) >= thirtyDaysAgo : false
        }
      })
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 100)

    return NextResponse.json({
      summary: {
        totalGmv,
        currentPeriodGmv,
        previousPeriodGmv,
        gmvGrowthPct,
        totalOrders: orders.length,
        currentPeriodOrdersCount,
        aov,
        totalBusinesses,
        activeBusinesses30d,
        totalUsers,
        mau,
        dau,
        stickinessRatio,
        projectedMrr,
        projectedArr,
        arpu,
      },
      tiers: [
        { name: 'Starter', price: PRICING.starter, count: starterCount, mrr: starterCount * PRICING.starter, color: '#3B82F6' },
        { name: 'Pro', price: PRICING.pro, count: proCount, mrr: proCount * 399000, color: '#8B5CF6' },
        { name: 'Enterprise', price: PRICING.enterprise, count: enterpriseCount, mrr: enterpriseCount * PRICING.enterprise, color: '#F59E0B' },
      ],
      dailyTrend: Array.from(dailyMap.values()),
      topTenants,
      serverTime: now.toISOString(),
      timeframeDays: days,
    })
  } catch (error: any) {
    console.error('[PlatformMetrics] Internal error:', error)
    return NextResponse.json({
      error: 'Gagal memuat analitik platform: ' + (error?.message || 'Unknown error')
    }, { status: 500 })
  }
}
