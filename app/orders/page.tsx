"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { OrderStats } from './components/OrderStats'
import { OrderTable } from './components/OrderTable'
import { OrderCharts } from './components/OrderCharts'
import { FilterBar, OrderFilterRule } from './components/FilterBar'
import { OrderDetailModal } from './components/OrderDetailModal'
import { OrderStatsSkeleton, OrderChartsSkeleton, OrderTableSkeleton } from './components/Skeletons'
import { Pagination } from '../components/Pagination'

const CACHE_TTL_MS   = 5 * 60 * 1000  // 5 minutes
const STALE_RECHECK  = 2 * 60 * 1000  // Background refresh after 2 minutes

type CachePayload = {
  metrics: any
  orders: any[]
  total: number
  ts: number
  businessId: string
}

function getCacheKey(bid: string) {
  return `su_orders_${bid}`
}

function readCache(bid: string): CachePayload | null {
  try {
    const raw = localStorage.getItem(getCacheKey(bid))
    if (!raw) return null
    const parsed: CachePayload = JSON.parse(raw)
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(bid: string, payloadData: { metrics: any; orders: any[]; total: number }) {
  try {
    const payload: CachePayload = {
      ...payloadData,
      ts: Date.now(),
      businessId: bid
    }
    localStorage.setItem(getCacheKey(bid), JSON.stringify(payload))
  } catch {
    // localStorage might be full — silently ignore
  }
}

export default function OrderPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [orders, setOrders]                     = useState<any[]>([])
  const [totalCount, setTotalCount]             = useState<number>(0)
  const [metrics, setMetrics]                   = useState<any>(null)
  const [isFetching, setIsFetching]             = useState(false)
  const [isBackground, setIsBackground]         = useState(false)
  const [currentPage, setCurrentPage]           = useState<number>(1)
  const [pageSize, setPageSize]                 = useState<number>(25)

  const [selectedOrder, setSelectedOrder]       = useState<any>(null)
  const [searchQuery, setSearchQuery]           = useState('')
  const [debouncedSearch, setDebouncedSearch]   = useState('')
  const [rules, setRules]                       = useState<OrderFilterRule[]>([])
  const [showCharts, setShowCharts]             = useState(true)
  const [activeBiz, setActiveBiz]               = useState<any>(null)
  const [activeBizId, setActiveBizId]           = useState<string | null>(null)

  // ─── Search Debounce ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 400)
    return () => clearTimeout(handler)
  }, [searchQuery])

  // Serialize rules to use in useEffect dependency
  const serializedRules = JSON.stringify(rules)

  // Reset to page 1 when search or rules change
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, serializedRules])

  // ─── Fetcher function for metrics and orders page ──────────────────
  const fetchMetricsAndOrders = useCallback(async (
    businessId: string,
    search: string,
    rulesArray: OrderFilterRule[],
    page: number,
    limit: number,
    isBg = false
  ) => {
    if (!isBg) {
      setIsFetching(true)
    } else {
      setIsBackground(true)
    }

    const offset = (page - 1) * limit

    try {
      // 1. Fetch metrics (aggregated over all filtered data)
      const { data: metricsData, error: metricsErr } = await supabase
        .rpc('get_order_analytics_metrics', {
          p_business_id: businessId,
          p_search: search,
          p_rules: rulesArray
        })

      if (metricsErr) throw metricsErr
      setMetrics(metricsData)
      const total = metricsData?.stats?.total_orders ?? 0
      setTotalCount(total)

      // 2. Fetch target page of orders
      const { data: ordersData, error: ordersErr } = await supabase
        .rpc('get_order_list', {
          p_business_id: businessId,
          p_search: search,
          p_rules: rulesArray,
          p_limit: limit,
          p_offset: offset
        })

      if (ordersErr) throw ordersErr
      const pageOrders = ordersData || []
      setOrders(pageOrders)

      // Write to cache only for empty filters on page 1
      if (!search && rulesArray.length === 0 && page === 1 && limit === 25) {
        writeCache(businessId, { metrics: metricsData, orders: pageOrders, total })
      }
    } catch (err) {
      console.error('[ShapeUp] Error fetching orders & metrics:', err)
    } finally {
      setIsFetching(false)
      setIsBackground(false)
    }
  }, [supabase])

  // ─── Load profile / active business ID ─────────────────────────────────────
  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id, businesses!active_business_id(name)')
          .eq('id', user.id)
          .single()

        const businessId = profile?.active_business_id
        if (!businessId) return
        
        setActiveBizId(businessId)
        setActiveBiz(profile.businesses)
      } catch (err) {
        console.error('[ShapeUp] Profile init error:', err)
      }
    }
    loadProfile()
  }, [supabase])

  // ─── Refresh when active business, filters, or page change ───────────────
  useEffect(() => {
    if (!activeBizId) return

    const rulesArray = JSON.parse(serializedRules)

    // Check if we can use cache (only for empty filters on page 1)
    const isDefaultFilters = !debouncedSearch && rulesArray.length === 0 && currentPage === 1 && pageSize === 25
    if (isDefaultFilters) {
      const cached = readCache(activeBizId)
      if (cached) {
        setMetrics(cached.metrics)
        setOrders(cached.orders)
        setTotalCount(cached.total)

        // Background revalidation
        const age = Date.now() - cached.ts
        if (age > STALE_RECHECK) {
          fetchMetricsAndOrders(activeBizId, debouncedSearch, rulesArray, currentPage, pageSize, true)
        }
        return
      }
    }

    // Otherwise, fetch fresh data for selected page
    fetchMetricsAndOrders(activeBizId, debouncedSearch, rulesArray, currentPage, pageSize, false)
  }, [activeBizId, debouncedSearch, serializedRules, currentPage, pageSize, fetchMetricsAndOrders])

  // ─── Derived Dropdown Data for Filters ────────────────────────────────────
  const availableStatuses = useMemo(() => {
    const defaultStatuses = ['completed', 'processing', 'pending', 'failed', 'cancelled']
    const statuses = new Set<string>(defaultStatuses)
    orders.forEach(o => {
      if (o.status) statuses.add(o.status.toLowerCase())
    })
    return Array.from(statuses).sort()
  }, [orders])

  const availablePaymentMethods = useMemo(() => {
    const defaultMethods = ['cod', 'bacs', 'midtrans', 'manual']
    const methods = new Set<string>(defaultMethods)
    orders.forEach(o => {
      if (o.payment_method) methods.add(o.payment_method.toLowerCase())
    })
    return Array.from(methods).sort()
  }, [orders])

  const isLoadingFirst = isFetching && orders.length === 0

  return (
    <div style={{ paddingBottom: '48px' }}>

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '4px',
        borderBottom: '1px solid var(--su-border)',
        paddingBottom: '20px', marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{
                fontSize: '9px', fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'var(--su-primary)', background: 'var(--su-primary-light)',
                padding: '3px 10px', borderRadius: '99px',
                border: '1px solid rgba(37,99,235,0.15)',
              }}>Pesanan & Transaksi</span>
              {activeBiz && (
                <span style={{
                  fontSize: '9px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'var(--su-accent-dark)', background: 'var(--su-accent-light)',
                  padding: '3px 10px', borderRadius: '99px',
                  border: '1px solid rgba(245,158,11,0.2)',
                }}>📍 {activeBiz.name}</span>
              )}
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--su-text)', margin: 0, lineHeight: 1.2 }}>
              Analisa & Segmentasi Pesanan
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--su-text-muted)', marginTop: '4px', fontWeight: 400 }}>
              Pantau total omzet, net sales, rata-rata order, dan segmentasi transaksi secara real-time.
            </p>
          </div>

          {/* Live data counter */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--su-text)', lineHeight: 1.1 }}>
              {totalCount.toLocaleString('id-ID')}
            </div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
              Total Transaksi
            </div>
          </div>
        </div>

        {/* Background revalidation indicator */}
        {isBackground && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px',
            fontSize: '10px', fontWeight: 600, color: 'var(--su-text-faint)',
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--su-accent)' }} className="su-pulse-bar" />
            Menyinkronkan data transaksi di background...
          </div>
        )}
      </div>

      {/* ── KPI Stats ─────────────────────────────────────────────────────── */}
      {isLoadingFirst ? <OrderStatsSkeleton /> : <OrderStats stats={metrics?.stats ?? null} />}

      {/* ── Filter Bar ────────────────────────────────────────────────────── */}
      <FilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        rules={rules}
        setRules={setRules}
        showCharts={showCharts}
        setShowCharts={setShowCharts}
        availableStatuses={availableStatuses}
        availablePaymentMethods={availablePaymentMethods}
      />

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      {showCharts && (isLoadingFirst ? <OrderChartsSkeleton /> : <OrderCharts data={metrics} />)}

      {/* ── Order Table ───────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 2px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--su-text-faint)' }}>
            {isLoadingFirst ? 'Memuat data...' : `Halaman ${currentPage} dari ${Math.max(1, Math.ceil(totalCount / pageSize))} (${totalCount.toLocaleString('id-ID')} total pesanan)`}
          </p>
          {isFetching && orders.length > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--su-accent)', fontWeight: 600 }}>
              • Memperbarui...
            </span>
          )}
        </div>
        {isLoadingFirst ? <OrderTableSkeleton /> : (
          <>
            <OrderTable
              orders={orders}
              onSelectOrder={(order) => setSelectedOrder(order)}
            />
            <Pagination
              currentPage={currentPage}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={(page) => setCurrentPage(page)}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize)
                setCurrentPage(1)
              }}
              isLoading={isFetching}
            />
          </>
        )}
      </div>

      {/* ── Order Detail Modal ────────────────────────────────────────────── */}
      <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </div>
  )
}