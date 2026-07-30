"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar, FilterRule } from './components/FilterBar'
import { AnalyticsCharts } from './components/AnalyticsCharts'
import { CustomerTable } from './components/CustomerTable'
import { CustomerDetail } from './components/CustomerDetail'
import { Pagination } from '../components/Pagination'

const CACHE_TTL_MS   = 5 * 60 * 1000  // 5 menit
const STALE_RECHECK  = 2 * 60 * 1000  // Background refresh setelah 2 menit

type CachePayload = {
  data: any[]
  statsData: any[]
  total: number
  overallTotal?: number
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

function writeCache(bid: string, payloadData: { data: any[]; statsData: any[]; total: number; overallTotal?: number }) {
  try {
    const payload: CachePayload = {
      ...payloadData,
      ts: Date.now(),
      businessId: bid
    }
    sessionStorage.setItem(getCacheKey(bid), JSON.stringify(payload))
  } catch {
    // sessionStorage might be full — silently ignore
  }
}

function applyCustomerFilters(query: any, search: string, rules: FilterRule[]) {
  if (search) {
    const s = search.trim()
    query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`)
  }

  for (const rule of rules) {
    if (!rule.value) continue
    const { field, operator, value } = rule

    if (['ltv', 'aov', 'total_order_count', 'days_since_last_order'].includes(field)) {
      const v = Number(value)
      if (isNaN(v) && operator !== 'between') continue
      if (operator === 'greater_or_equal') query = query.gte(field, v)
      else if (operator === 'less_or_equal') query = query.lte(field, v)
      else if (operator === 'equal') query = query.eq(field, v)
      else if (operator === 'greater') query = query.gt(field, v)
      else if (operator === 'less') query = query.lt(field, v)
      else if (operator === 'between') {
        const [minV, maxV] = value.split(',').map(Number)
        if (!isNaN(minV) && !isNaN(maxV)) {
          query = query.gte(field, minV).lte(field, maxV)
        }
      }
    }

    if (field === 'last_order_status') {
      if (operator === 'is') query = query.ilike(field, value)
      else if (operator === 'is_not') query = query.neq(field, value)
    }

    if (field === 'last_order_date' || field === 'joined_at') {
      if (operator === 'after') query = query.gte(field, value)
      else if (operator === 'before') query = query.lte(field, value)
      else if (operator === 'between') {
        const [minD, maxD] = value.split(',')
        if (minD && maxD) query = query.gte(field, minD).lte(field, maxD)
      }
    }

    if (field === 'rfm_segment') {
      const d30 = new Date(Date.now() - 30 * 86400000).toISOString()
      const isEq = operator === 'is'

      if (value === 'vip') {
        if (isEq) query = query.gte('ltv', 1000000).gte('total_order_count', 2)
        else query = query.or('ltv.lt.1000000,total_order_count.lt.2')
      } else if (value === 'loyal') {
        if (isEq) query = query.gte('total_order_count', 3).lte('days_since_last_order', 30)
        else query = query.or('total_order_count.lt.3,days_since_last_order.gt.30')
      } else if (value === 'new') {
        if (isEq) query = query.lte('total_order_count', 1).or(`days_since_last_order.lte.30,joined_at.gte.${d30}`)
        else query = query.gt('total_order_count', 1)
      } else if (value === 'regular') {
        if (isEq) query = query.gte('total_order_count', 2).lte('days_since_last_order', 60)
        else query = query.or('total_order_count.lt.2,days_since_last_order.gt.60')
      } else if (value === 'at_risk') {
        if (isEq) query = query.gte('total_order_count', 1).gt('days_since_last_order', 60)
        else query = query.or('total_order_count.eq.0,days_since_last_order.lte.60')
      } else if (value === 'churned') {
        if (isEq) query = query.gte('total_order_count', 1).gt('days_since_last_order', 90)
        else query = query.or('total_order_count.eq.0,days_since_last_order.lte.90')
      } else if (value === 'one_time') {
        if (isEq) query = query.eq('total_order_count', 1).gt('days_since_last_order', 30)
        else query = query.or('total_order_count.neq.1,days_since_last_order.lte.30')
      } else if (value === 'lost') {
        if (isEq) query = query.eq('total_order_count', 0)
        else query = query.gt('total_order_count', 0)
      }
    }
  }

  return query
}

export default function CustomerPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [customers, setCustomers]         = useState<any[]>([])
  const [statsCustomers, setStatsCustomers] = useState<any[]>([])
  const [totalCount, setTotalCount]       = useState<number>(0)
  const [overallTotalCount, setOverallTotalCount] = useState<number>(0)
  const [isFetching, setIsFetching]       = useState(false)
  const [isBackground, setIsBackground]   = useState(false)
  const [currentPage, setCurrentPage]     = useState<number>(1)
  const [pageSize, setPageSize]           = useState<number>(25)

  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [searchQuery, setSearchQuery]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [rules, setRules]                 = useState<FilterRule[]>([])
  const [showCharts, setShowCharts]       = useState(true)
  const [businessId, setBusinessId]       = useState<string>('')
  const [userId, setUserId]               = useState<string>('')

  // ─── Search Debounce ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 400)
    return () => clearTimeout(handler)
  }, [searchQuery])

  const serializedRules = JSON.stringify(rules)

  // Reset to page 1 when search or rules change
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, serializedRules])

  // ─── Fetcher for Page Data & Lightweight Full Stats ────────────────────────
  const fetchCustomerData = useCallback(async (
    bid: string,
    search: string,
    rulesArray: FilterRule[],
    page: number,
    limit: number,
    background = false
  ) => {
    if (!background) setIsFetching(true)
    else setIsBackground(true)

    const from = (page - 1) * limit
    const to = page * limit - 1

    try {
      // 1. Fetch Paginated Customer Table Data
      let pageQuery = supabase
        .from('customer_metrics')
        .select('*', { count: 'exact' })
        .eq('business_id', bid)

      pageQuery = applyCustomerFilters(pageQuery, search, rulesArray)
      pageQuery = pageQuery.order('ltv', { ascending: false }).range(from, to)

      const { data: pageData, count, error: pageErr } = await pageQuery
      if (pageErr) throw pageErr

      const total = count ?? 0
      setTotalCount(total)
      setCustomers(pageData || [])

      // 2. Fetch Lightweight Summary Metrics for ALL Matching Customers (for 100% accurate Stats & Charts)
      const STATS_CHUNK = 1000
      let allStatsData: any[] = []

      if (total > 0) {
        const numChunks = Math.ceil(total / STATS_CHUNK)
        const chunkPromises = []

        for (let i = 0; i < numChunks; i++) {
          const chunkFrom = i * STATS_CHUNK
          const chunkTo = Math.min((i + 1) * STATS_CHUNK - 1, total - 1)

          let statsQuery = supabase
            .from('customer_metrics')
            .select('ltv, aov, total_order_count, days_since_last_order, last_order_date, joined_at, last_order_status')
            .eq('business_id', bid)

          statsQuery = applyCustomerFilters(statsQuery, search, rulesArray)
          statsQuery = statsQuery.range(chunkFrom, chunkTo)

          chunkPromises.push(statsQuery)
        }

        const results = await Promise.all(chunkPromises)
        for (const res of results) {
          if (res.data) {
            allStatsData.push(...res.data)
          }
        }
      }

      const finalStatsData = allStatsData.length > 0 ? allStatsData : (pageData || [])
      setStatsCustomers(finalStatsData)

      // Set overall business customer count (unfiltered)
      if (!search && rulesArray.length === 0) {
        setOverallTotalCount(total)
      } else {
        // Fetch unfiltered total count if currently overallTotalCount is not set or filtering is active
        const { count: oCount } = await supabase
          .from('customer_metrics')
          .select('*', { count: 'exact', head: true })
          .eq('business_id', bid)
        if (oCount !== null && oCount !== undefined) {
          setOverallTotalCount(oCount)
        }
      }

      // Write cache only for default initial page
      if (!search && rulesArray.length === 0 && page === 1 && limit === 25) {
        writeCache(bid, { data: pageData || [], statsData: finalStatsData, total, overallTotal: total })
      }

    } catch (err) {
      console.error('[ShapeUp] Error fetching customer page:', err)
    } finally {
      setIsFetching(false)
      setIsBackground(false)
    }
  }, [supabase])

  // ─── Initial Load & Business Profile ──────────────────────────────────────
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
      } catch (err) {
        console.error('[ShapeUp] Init error:', err)
        setIsFetching(false)
      }
    }

    init()
  }, [supabase])

  // ─── Fetch data on businessId, search, rules, or page change ─────────────
  useEffect(() => {
    if (!businessId) return

    const rulesArray = JSON.parse(serializedRules)
    const isDefaultFilters = !debouncedSearch && rulesArray.length === 0 && currentPage === 1 && pageSize === 25

    if (isDefaultFilters) {
      const cached = readCache(businessId)
      if (cached) {
        setCustomers(cached.data)
        setStatsCustomers(cached.statsData)
        setTotalCount(cached.total)
        setOverallTotalCount(cached.overallTotal || cached.total)

        const age = Date.now() - cached.ts
        if (age > STALE_RECHECK) {
          fetchCustomerData(businessId, debouncedSearch, rulesArray, currentPage, pageSize, true)
        }
        return
      }
    }

    fetchCustomerData(businessId, debouncedSearch, rulesArray, currentPage, pageSize, false)
  }, [businessId, debouncedSearch, serializedRules, currentPage, pageSize, fetchCustomerData])

  // ─── Derived unique statuses for filter options ───────────────────────────
  const availableStatuses = useMemo(() => {
    const defaultStatuses = ['completed', 'on-hold', 'pending', 'shipped', 'cancelled', 'return-request']
    const statuses = new Set<string>(defaultStatuses)
    statsCustomers.forEach(c => {
      if (c.last_order_status) statuses.add(c.last_order_status.toLowerCase())
    })
    return Array.from(statuses).sort()
  }, [statsCustomers])

  const isLoadingFirst = isFetching && customers.length === 0

  const handleCustomerUpdate = useCallback((updatedCustomer: any) => {
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

          {/* Live data counter & Action */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <Link
              href="/customers/import"
              className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 border border-gray-300"
            >
              <span>📤</span> Import Customer
            </Link>

            <Link
              href="/customers/new"
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5"
            >
              <span>+</span> Tambah Customer
            </Link>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--su-text)', lineHeight: 1.1 }}>
                {(overallTotalCount || totalCount).toLocaleString('id-ID')}
              </div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                Total Pelanggan
              </div>
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
            Menyinkronkan data terbaru di background...
          </div>
        )}
      </div>

      {/* ── KPI Stats ─────────────────────────────────────────────────────── */}
      <StatsPanel customers={statsCustomers} />

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
      {showCharts && <AnalyticsCharts customers={statsCustomers} />}

      {/* ── Customer Table ────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 2px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--su-text-faint)' }}>
            Halaman {currentPage} dari {Math.max(1, Math.ceil(totalCount / pageSize))} ({totalCount.toLocaleString('id-ID')} total pelanggan)
          </p>
          {isFetching && customers.length > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--su-accent)', fontWeight: 600 }}>
              • Memperbarui...
            </span>
          )}
        </div>
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
          position="top"
        />
        <CustomerTable
          customers={customers}
          onSelect={(customer) => setSelectedCustomer(customer)}
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
          position="bottom"
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