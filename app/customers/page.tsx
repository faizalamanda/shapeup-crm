"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar, FilterRule } from './components/FilterBar'
import { AnalyticsCharts } from './components/AnalyticsCharts'
import { CustomerTable } from './components/CustomerTable'
import { CustomerDetail } from './components/CustomerDetail'

const CACHE_TTL_MS   = 5 * 60 * 1000  // 5 menit
const BATCH_SIZE     = 1000            // Supabase max per request
const STALE_RECHECK  = 2 * 60 * 1000  // Background refresh setelah 2 menit

type CachePayload = {
  data: any[]
  ts: number
  businessId: string
}

function getCacheKey(bid: string) {
  return `su_customers_${bid}`
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

export default function CustomerPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [customers, setCustomers]         = useState<any[]>([])
  const [totalCount, setTotalCount]       = useState<number>(0)
  const [fetchedCount, setFetchedCount]   = useState<number>(0)
  const [isFetching, setIsFetching]       = useState(false)
  const [isBackground, setIsBackground]   = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [searchQuery, setSearchQuery]     = useState('')
  const [rules, setRules]                 = useState<FilterRule[]>([])
  const [showCharts, setShowCharts]       = useState(true)
  const [businessId, setBusinessId]       = useState<string>('')
  const [userId, setUserId]               = useState<string>('')

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
        .from('customer_metrics')
        .select('*', { count: 'exact' })
        .eq('business_id', businessId)
        .order('ltv', { ascending: false })
        .range(from, from + BATCH_SIZE - 1)

      if (error) throw error

      total = count ?? 0
      setTotalCount(total)

      const batch1 = firstBatch || []
      allData.push(...batch1)
      from += BATCH_SIZE

      // Show first batch immediately — user sees data fast
      setCustomers([...allData])
      setFetchedCount(allData.length)

      // Fetch remaining batches
      while (from < total) {
        const { data: nextBatch, error: bErr } = await supabase
          .from('customer_metrics')
          .select('*')
          .eq('business_id', businessId)
          .order('ltv', { ascending: false })
          .range(from, from + BATCH_SIZE - 1)

        if (bErr) break

        allData.push(...(nextBatch || []))
        from += BATCH_SIZE

        // Update state after each batch — live progress
        setCustomers([...allData])
        setFetchedCount(allData.length)
      }

      // Write full dataset to cache
      writeCache(businessId, allData)

    } catch (err) {
      console.error('[ShapeUp] Error fetching customers:', err)
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

        setUserId(user.id)

        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id')
          .eq('id', user.id)
          .single()

        const bid = profile?.active_business_id
        if (!bid) return

        setBusinessId(bid)

        // Cache-first strategy
        const cached = readCache(bid)
        if (cached) {
          // Show cached data immediately — perceived load = 0ms
          setCustomers(cached.data)
          setFetchedCount(cached.data.length)
          setTotalCount(cached.data.length)

          // If cache is getting stale (>2min), revalidate in background
          const age = Date.now() - cached.ts
          if (age > STALE_RECHECK) {
            fetchAllBatches(bid, true) // background refresh
          }
        } else {
          // No cache — full fetch
          await fetchAllBatches(bid, false)
        }
      } catch (err) {
        console.error('[ShapeUp] Init error:', err)
        setIsFetching(false)
      }
    }

    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived unique statuses ──────────────────────────────────────────────
  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>()
    customers.forEach(c => {
      if (c.last_order_status) statuses.add(c.last_order_status.toLowerCase())
    })
    if (statuses.size === 0) {
      return ['completed', 'on-hold', 'pending', 'shipped', 'cancelled', 'return-request']
    }
    return Array.from(statuses).sort()
  }, [customers])

  // ─── Filter Logic ─────────────────────────────────────────────────────────
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchesSearch =
        (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.phone || '').includes(searchQuery)

      if (!matchesSearch) return false

      for (const rule of rules) {
        if (!rule.value) continue

        const field    = rule.field
        const operator = rule.operator

        // Numeric fields
        if (['ltv', 'aov', 'total_order_count', 'days_since_last_order'].includes(field)) {
          const cVal = Number(c[field]) || 0
          const rVal = Number(rule.value) || 0
          if (operator === 'greater_or_equal' && !(cVal >= rVal)) return false
          if (operator === 'less_or_equal'    && !(cVal <= rVal)) return false
          if (operator === 'equal'            && !(cVal === rVal)) return false
          if (operator === 'greater'          && !(cVal > rVal))  return false
          if (operator === 'less'             && !(cVal < rVal))  return false
          if (operator === 'between') {
            const [minV, maxV] = (rule.value || '').split(',').map(Number)
            if (isNaN(minV) || isNaN(maxV)) return false
            if (!(cVal >= minV && cVal <= maxV)) return false
          }
        }

        // Date fields
        if (field === 'last_order_date' || field === 'joined_at') {
          if (!c[field]) return false
          const cDate = new Date(c[field]).getTime()
          const rDate = new Date(rule.value).getTime()
          if (isNaN(cDate) || isNaN(rDate)) return false
          if (operator === 'after'  && !(cDate >= rDate)) return false
          if (operator === 'before' && !(cDate <= rDate)) return false
          if (operator === 'between') {
            const [minD, maxD] = (rule.value || '').split(',')
            const minT = new Date(minD).getTime()
            const maxT = new Date(maxD).getTime()
            if (isNaN(minT) || isNaN(maxT)) return false
            if (!(cDate >= minT && cDate <= maxT)) return false
          }
        }

        // Status field
        if (field === 'last_order_status') {
          const cStr = (c[field] || '').toLowerCase()
          const rStr = (rule.value || '').toLowerCase()
          if (operator === 'is'     && cStr !== rStr) return false
          if (operator === 'is_not' && cStr === rStr) return false
        }

        // RFM segment (computed client-side)
        if (field === 'rfm_segment') {
          const ltv   = Number(c.ltv) || 0
          const freq  = Number(c.total_order_count) || 0
          const days  = Number(c.days_since_last_order) ?? 999
          let seg = 'regular'
          if (ltv >= 1000000 && freq >= 2)          seg = 'vip'
          else if (freq === 0)                       seg = 'lost'
          else if (days > 90)                        seg = 'churned'
          else if (days > 60)                        seg = 'at_risk'
          else if (freq === 1 && days <= 30)         seg = 'new'
          else if (freq >= 3 && days <= 30)          seg = 'loyal'
          else if (freq === 1)                       seg = 'one_time'

          const rSeg = (rule.value || '').toLowerCase()
          if (operator === 'is'     && seg !== rSeg) return false
          if (operator === 'is_not' && seg === rSeg) return false
        }
      }

      return true
    })
  }, [customers, searchQuery, rules])

  // ─── Loading Progress ─────────────────────────────────────────────────────
  const progressPct = totalCount > 0
    ? Math.min(Math.round((fetchedCount / totalCount) * 100), 100)
    : 0

  const isLoadingFirst = isFetching && customers.length === 0

  const handleCustomerUpdate = useCallback((updatedCustomer: any) => {
    // 1. Update list state
    setCustomers(prev => prev.map(c => {
      if (c.customer_id === updatedCustomer.id) {
        let newAddressString = ''
        if (updatedCustomer.address_data) {
          const ad = updatedCustomer.address_data
          const parts = [
            ad.address_line1,
            ad.address_line2,
            ad.subdistrict ? `Kec. ${ad.subdistrict}` : '',
            ad.city,
            ad.state,
            ad.postcode,
            ad.country
          ].filter(Boolean)
          newAddressString = parts.join(', ')
        }

        return {
          ...c,
          name: updatedCustomer.name,
          phone: updatedCustomer.phone,
          email: updatedCustomer.email,
          category: updatedCustomer.category,
          address: newAddressString || null
        }
      }
      return c
    }))

    // 2. Update selected customer modal state
    setSelectedCustomer((prev: any) => {
      if (prev && prev.customer_id === updatedCustomer.id) {
        let newAddressString = ''
        if (updatedCustomer.address_data) {
          const ad = updatedCustomer.address_data
          const parts = [
            ad.address_line1,
            ad.address_line2,
            ad.subdistrict ? `Kec. ${ad.subdistrict}` : '',
            ad.city,
            ad.state,
            ad.postcode,
            ad.country
          ].filter(Boolean)
          newAddressString = parts.join(', ')
        }

        return {
          ...prev,
          name: updatedCustomer.name,
          phone: updatedCustomer.phone,
          email: updatedCustomer.email,
          category: updatedCustomer.category,
          address: newAddressString || null
        }
      }
      return prev
    })
  }, [])

  // ─── Loading State (first load with no cache) ─────────────────────────────
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
            Memuat Data Pelanggan
          </p>
          {totalCount > 0 && (
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)', marginTop: '4px' }}>
              {fetchedCount.toLocaleString('id-ID')} / {totalCount.toLocaleString('id-ID')} pelanggan
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
              }}>Pelanggan & CRM</span>
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--su-text)', margin: 0, lineHeight: 1.2 }}>
              Analisa & Segmentasi Pelanggan
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--su-text-muted)', marginTop: '4px', fontWeight: 400 }}>
              Segmentasi, pantau LTV dan AOV berdasarkan order <strong>completed</strong>.
            </p>
          </div>

          {/* Live data counter */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--su-text)', lineHeight: 1.1 }}>
              {customers.length.toLocaleString('id-ID')}
            </div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
              Total Pelanggan
            </div>
          </div>
        </div>

        {/* Fetch progress bar (visible during multi-batch fetch) */}
        {isFetching && customers.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                Mengambil data...
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
            Menyinkronkan data terbaru di background...
          </div>
        )}
      </div>

      {/* ── KPI Stats ─────────────────────────────────────────────────────── */}
      <StatsPanel customers={filteredCustomers} />

      {/* ── Filter Bar ────────────────────────────────────────────────────── */}
      <FilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        rules={rules}
        setRules={setRules}
        showCharts={showCharts}
        setShowCharts={setShowCharts}
        availableStatuses={availableStatuses}
        businessId={businessId}
        userId={userId}
      />

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      {showCharts && <AnalyticsCharts customers={filteredCustomers} />}

      {/* ── Customer Table ────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 2px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--su-text-faint)' }}>
            {filteredCustomers.length.toLocaleString('id-ID')} dari {customers.length.toLocaleString('id-ID')} pelanggan
          </p>
          {isFetching && (
            <span style={{ fontSize: '10px', color: 'var(--su-accent)', fontWeight: 600 }}>
              • Live updating
            </span>
          )}
        </div>
        <CustomerTable
          customers={filteredCustomers}
          onSelect={(customer) => setSelectedCustomer(customer)}
        />
      </div>

      {/* ── Customer Detail Modal ─────────────────────────────────────────── */}
      <CustomerDetail
        customer={selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        onUpdate={handleCustomerUpdate}
      />
    </div>
  )
}