"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { OrderStats } from './components/OrderStats'
import { OrderTable } from './components/OrderTable'
import { OrderCharts } from './components/OrderCharts'
import { FilterBar, OrderFilterRule } from './components/FilterBar'
import { OrderDetailModal } from './components/OrderDetailModal'

const CACHE_TTL_MS   = 5 * 60 * 1000  // 5 minutes
const BATCH_SIZE     = 1000            // Supabase max rows per request
const STALE_RECHECK  = 2 * 60 * 1000  // Background refresh after 2 minutes

type CachePayload = {
  data: any[]
  ts: number
  businessId: string
}

function getCacheKey(bid: string) {
  return `su_orders_${bid}`
}

function readCache(bid: string): CachePayload | null {
  try {
    const raw = sessionStorage.getItem(getCacheKey(bid))
    if (!raw) return null
    const parsed: CachePayload = JSON.parse(raw)
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(bid: string, data: any[]) {
  try {
    const payload: CachePayload = { data, ts: Date.now(), businessId: bid }
    sessionStorage.setItem(getCacheKey(bid), JSON.stringify(payload))
  } catch {
    // sessionStorage might be full — silently ignore
  }
}

export default function OrderPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [orders, setOrders]                 = useState<any[]>([])
  const [totalCount, setTotalCount]         = useState<number>(0)
  const [fetchedCount, setFetchedCount]     = useState<number>(0)
  const [isFetching, setIsFetching]         = useState(false)
  const [isBackground, setIsBackground]     = useState(false)
  const [selectedOrder, setSelectedOrder]   = useState<any>(null)
  const [searchQuery, setSearchQuery]       = useState('')
  const [rules, setRules]                   = useState<OrderFilterRule[]>([])
  const [showCharts, setShowCharts]         = useState(true)
  const [activeBiz, setActiveBiz]           = useState<any>(null)

  // ─── Batch Fetcher ────────────────────────────────────────────────────────
  const fetchAllBatches = useCallback(async (businessId: string, background = false) => {
    if (!background) setIsFetching(true)
    else setIsBackground(true)

    const allData: any[] = []
    let from = 0
    let total = 0

    try {
      // First batch — also get total count
      const { data: firstBatch, error, count } = await supabase
        .from('orders')
        .select(`*, customer:customer_metrics(name, phone)`, { count: 'exact' })
        .eq('business_id', businessId)
        .order('order_date', { ascending: false })
        .range(from, from + BATCH_SIZE - 1)

      if (error) throw error

      total = count ?? 0
      setTotalCount(total)

      const batch1 = firstBatch || []
      allData.push(...batch1)
      from += BATCH_SIZE

      // Show first batch immediately — user sees data fast
      setOrders([...allData])
      setFetchedCount(allData.length)

      // Fetch remaining batches
      while (from < total) {
        const { data: nextBatch, error: bErr } = await supabase
          .from('orders')
          .select(`*, customer:customer_metrics(name, phone)`)
          .eq('business_id', businessId)
          .order('order_date', { ascending: false })
          .range(from, from + BATCH_SIZE - 1)

        if (bErr) break

        allData.push(...(nextBatch || []))
        from += BATCH_SIZE

        // Update state after each batch — live progress
        setOrders([...allData])
        setFetchedCount(allData.length)
      }

      // Write full dataset to cache
      writeCache(businessId, allData)

    } catch (err) {
      console.error('[ShapeUp] Error fetching orders:', err)
    } finally {
      setIsFetching(false)
      setIsBackground(false)
    }
  }, [supabase])

  // ─── Initial Load + Cache Strategy ───────────────────────────────────────
  useEffect(() => {
    async function init() {
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
        
        setActiveBiz(profile.businesses)

        // Cache-first strategy
        const cached = readCache(businessId)
        if (cached) {
          // Show cached data immediately
          setOrders(cached.data)
          setFetchedCount(cached.data.length)
          setTotalCount(cached.data.length)

          // Background revalidation if cache is getting stale (>2min)
          const age = Date.now() - cached.ts
          if (age > STALE_RECHECK) {
            fetchAllBatches(businessId, true)
          }
        } else {
          // No cache — full fetch
          await fetchAllBatches(businessId, false)
        }
      } catch (err) {
        console.error('[ShapeUp] Init error:', err)
        setIsFetching(false)
      }
    }

    init()
  }, [fetchAllBatches]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived Dropdown Data for Filters ────────────────────────────────────
  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>()
    orders.forEach(o => {
      if (o.status) statuses.add(o.status.toLowerCase())
    })
    if (statuses.size === 0) {
      return ['completed', 'processing', 'pending', 'failed', 'cancelled']
    }
    return Array.from(statuses).sort()
  }, [orders])

  const availablePaymentMethods = useMemo(() => {
    const methods = new Set<string>()
    orders.forEach(o => {
      if (o.payment_method) methods.add(o.payment_method.toLowerCase())
    })
    if (methods.size === 0) {
      return ['cod', 'bacs']
    }
    return Array.from(methods).sort()
  }, [orders])

  // ─── Filter Logic ─────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      // Search matches customer name, customer phone, or order number
      const orderNumStr = `#${o.order_number || o.id}`
      const matchesSearch =
        (o.customer?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (o.customer?.phone || '').includes(searchQuery) ||
        orderNumStr.toLowerCase().includes(searchQuery.toLowerCase())

      if (!matchesSearch) return false

      for (const rule of rules) {
        if (!rule.value) continue

        const field    = rule.field
        const operator = rule.operator

        if (field === 'grand_total' || field === 'total_qty') {
          const oVal = Number(o[field]) || 0
          const rVal = Number(rule.value) || 0
          if (operator === 'greater_or_equal' && !(oVal >= rVal)) return false
          if (operator === 'less_or_equal'    && !(oVal <= rVal)) return false
          if (operator === 'equal'            && !(oVal === rVal)) return false
        }

        if (field === 'order_date') {
          if (!o[field]) return false
          const oDate = new Date(o[field]).getTime()
          const rDate = new Date(rule.value).getTime()
          if (isNaN(oDate) || isNaN(rDate)) return false
          if (operator === 'after'  && !(oDate >= rDate)) return false
          if (operator === 'before' && !(oDate <= rDate)) return false
        }

        if (field === 'status') {
          const oStr = (o[field] || '').toLowerCase()
          const rStr = (rule.value || '').toLowerCase()
          if (operator === 'is'     && oStr !== rStr) return false
          if (operator === 'is_not' && oStr === rStr) return false
        }

        if (field === 'payment_method') {
          const oStr = (o[field] || '').toLowerCase()
          const rStr = (rule.value || '').toLowerCase()
          if (operator === 'is'     && oStr !== rStr) return false
          if (operator === 'is_not' && oStr === rStr) return false
        }
      }

      return true
    })
  }, [orders, searchQuery, rules])

  // ─── Loading Progress ─────────────────────────────────────────────────────
  const progressPct = totalCount > 0
    ? Math.min(Math.round((fetchedCount / totalCount) * 100), 100)
    : 0

  const isLoadingFirst = isFetching && orders.length === 0

  if (isLoadingFirst) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '60vh', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{
          width: '36px', height: '36px', border: '3px solid var(--su-border)',
          borderTopColor: 'var(--su-primary)', borderRadius: '50%',
        }} className="su-spinner" />
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
            Memuat Data Pesanan
          </p>
          {totalCount > 0 && (
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)', marginTop: '4px' }}>
              {fetchedCount.toLocaleString('id-ID')} / {totalCount.toLocaleString('id-ID')} pesanan
            </p>
          )}
        </div>
      </div>
    )
  }

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
              {orders.length.toLocaleString('id-ID')}
            </div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
              Total Transaksi
            </div>
          </div>
        </div>

        {/* Fetch progress bar (visible during multi-batch fetch) */}
        {isFetching && orders.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                Mengambil data pesanan terbaru...
              </span>
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--su-text-muted)' }}>
                {fetchedCount.toLocaleString('id-ID')} / {totalCount.toLocaleString('id-ID')}
              </span>
            </div>
            <div className="su-progress-track">
              <div className="su-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

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
      <OrderStats orders={filteredOrders} />

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
      {showCharts && <OrderCharts orders={filteredOrders} />}

      {/* ── Order Table ───────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 2px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--su-text-faint)' }}>
            {filteredOrders.length.toLocaleString('id-ID')} dari {orders.length.toLocaleString('id-ID')} pesanan
          </p>
          {isFetching && (
            <span style={{ fontSize: '10px', color: 'var(--su-accent)', fontWeight: 600 }}>
              • Live updating
            </span>
          )}
        </div>
        <OrderTable
          orders={filteredOrders}
          onSelectOrder={(order) => setSelectedOrder(order)}
        />
      </div>

      {/* ── Order Detail Modal ────────────────────────────────────────────── */}
      <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </div>
  )
}