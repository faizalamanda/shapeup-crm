"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { useUserContext } from '@/components/UserContext'
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

function applyCustomerFilters(query: any, search: string, rules: FilterRule[], productCustomerIds: string[] | null = null) {
  if (search) {
    const s = search.trim()
    query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`)
  }

  if (productCustomerIds !== null) {
    if (productCustomerIds.length === 0) {
      query = query.eq('customer_id', '00000000-0000-0000-0000-000000000000')
    } else {
      query = query.in('customer_id', productCustomerIds)
    }
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
      const arr = value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      if (arr.length > 0) {
        if (operator === 'is') query = query.in(field, arr)
        else if (operator === 'is_not') query = query.not(field, 'in', arr)
      } else {
        if (operator === 'is') query = query.ilike(field, value)
        else if (operator === 'is_not') query = query.neq(field, value)
      }
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
      // 0. Pre-fetch matching customer IDs if product_name rule is present
      const productRule = rulesArray.find(r => r.field === 'product_name' && r.value?.trim())
      let productCustomerIds: string[] | null = null

      if (productRule) {
        const val = productRule.value.trim().toLowerCase()
        const op = productRule.operator || 'contains'

        const { data: orderRows } = await supabase
          .from('orders')
          .select('customer_id, items_json')
          .eq('business_id', bid)
          .not('customer_id', 'is', null)

        const matchingSet = new Set<string>()
        if (orderRows) {
          for (const o of orderRows) {
            const itemsStr = JSON.stringify(o.items_json || '').toLowerCase()
            const matches = itemsStr.includes(val)
            if (op === 'is_not' ? !matches : matches) {
              matchingSet.add(o.customer_id)
            }
          }
        }
        productCustomerIds = Array.from(matchingSet)
      }

      // 1. Fetch Paginated Customer Table Data
      let pageQuery = supabase
        .from('customer_metrics')
        .select('*', { count: 'exact' })
        .eq('business_id', bid)

      pageQuery = applyCustomerFilters(pageQuery, search, rulesArray, productCustomerIds)
      pageQuery = pageQuery.order('ltv', { ascending: false }).range(from, to)

      const { data: pageData, count, error: pageErr } = await pageQuery
      if (pageErr) throw pageErr

      let finalPageData = pageData || []
      if (finalPageData.length > 0) {
        const pageCustomerIds = finalPageData.map((c: any) => c.customer_id)
        const { data: metaRows } = await supabase
          .from('customers')
          .select('id, metadata')
          .in('id', pageCustomerIds)

        if (metaRows && metaRows.length > 0) {
          const metaMap = new Map(metaRows.map((m: any) => [m.id, m.metadata]))
          finalPageData = finalPageData.map((c: any) => ({
            ...c,
            metadata: metaMap.get(c.customer_id) || {}
          }))
        }
      }

      const total = count ?? 0
      setTotalCount(total)
      setCustomers(finalPageData)
      setStatsCustomers(finalPageData)

      if (!search && rulesArray.length === 0) {
        setOverallTotalCount(total)
      }

      // Write cache only for default initial page
      if (!search && rulesArray.length === 0 && page === 1 && limit === 25) {
        writeCache(bid, { data: finalPageData, statsData: finalPageData, total, overallTotal: total })
      }

    } catch (err) {
      console.error('[ShapeUp] Error fetching customer page:', err)
    } finally {
      setIsFetching(false)
      setIsBackground(false)
    }
  }, [supabase])

  const { userProfile, activeBusiness } = useUserContext()

  // ─── Initial Load & Business Profile from UserContext ─────────────────────
  useEffect(() => {
    if (userProfile?.id) {
      setUserId(userProfile.id)
    }
    if (activeBusiness?.id) {
      setBusinessId(activeBusiness.id)
    }
  }, [userProfile, activeBusiness])

  // ─── Fetch data on businessId, search, rules, or page change ─────────────
  useEffect(() => {
    if (!businessId) return

    const rulesArray = JSON.parse(serializedRules)
    const isDefaultFilters = !debouncedSearch && rulesArray.length === 0 && currentPage === 1 && pageSize === 25

    if (isDefaultFilters) {
      const cached = readCache(businessId)
      if (cached && cached.data && cached.data.length > 0) {
        setCustomers(cached.data)
        setStatsCustomers(cached.statsData || cached.data)
        setTotalCount(cached.total)
        setOverallTotalCount(cached.overallTotal || cached.total)
        setIsFetching(false)

        const age = Date.now() - cached.ts
        if (age > STALE_RECHECK) {
          fetchCustomerData(businessId, debouncedSearch, rulesArray, currentPage, pageSize, true)
        }
        return
      }
    }

    fetchCustomerData(businessId, debouncedSearch, rulesArray, currentPage, pageSize, false)
  }, [businessId, debouncedSearch, serializedRules, currentPage, pageSize, fetchCustomerData])

  // ─── Fetch available products for filter ───────────────────────────────
  const [availableProducts, setAvailableProducts] = useState<string[]>([])

  useEffect(() => {
    if (!businessId) return
    async function loadProducts() {
      try {
        const { data } = await supabase
          .from('products')
          .select('name')
          .eq('business_id', businessId)
          .order('name')
        if (data && data.length > 0) {
          setAvailableProducts(Array.from(new Set(data.map(p => p.name).filter(Boolean))).sort())
        }
      } catch (err) {
        console.error('[ShapeUp] Error loading products for customer filter:', err)
      }
    }
    loadProducts()
  }, [businessId, supabase])

  const availableStatuses = useMemo(() => {
    const defaultStatuses = ['completed', 'on-hold', 'pending', 'shipped', 'cancelled', 'return-request']
    const statuses = new Set<string>(defaultStatuses)
    statsCustomers.forEach(c => {
      if (c.last_order_status) statuses.add(c.last_order_status.toLowerCase())
    })
    return Array.from(statuses).sort()
  }, [statsCustomers])

  const isLoadingFirst = isFetching && customers.length === 0

  const handleTagUpdate = useCallback((customerId: string, newTags: string[]) => {
    if (businessId) {
      try { sessionStorage.removeItem(getCacheKey(businessId)) } catch {}
    }
    setCustomers(prev => prev.map(c => {
      if (c.customer_id === customerId || c.id === customerId) {
        return {
          ...c,
          metadata: {
            ...(c.metadata || {}),
            tags: newTags
          }
        }
      }
      return c
    }))

    setSelectedCustomer((prev: any) => {
      if (prev && (prev.customer_id === customerId || prev.id === customerId)) {
        return {
          ...prev,
          metadata: {
            ...(prev.metadata || {}),
            tags: newTags
          }
        }
      }
      return prev
    })
  }, [businessId])

  const handleCustomerUpdate = useCallback((updatedCustomer: any) => {
    if (businessId) {
      try { sessionStorage.removeItem(getCacheKey(businessId)) } catch {}
    }
    setCustomers(prev => prev.map(c => {
      if (c.customer_id === updatedCustomer.id || c.id === updatedCustomer.id) {
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
          address: newAddressString || null,
          metadata: updatedCustomer.metadata || c.metadata
        }
      }
      return c
    }))

    setSelectedCustomer((prev: any) => {
      if (prev && (prev.customer_id === updatedCustomer.id || prev.id === updatedCustomer.id)) {
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
          address: newAddressString || null,
          metadata: updatedCustomer.metadata || prev.metadata
        }
      }
      return prev
    })
  }, [businessId])

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
      <StatsPanel customers={statsCustomers} totalCount={totalCount} />

      {/* ── Filter Bar ────────────────────────────────────────────────────── */}
      <FilterBar
        searchQuery={searchQuery}
        rules={rules}
        onApplyFilters={(query, newRules) => {
          setSearchQuery(query)
          setRules(newRules)
        }}
        showCharts={showCharts}
        setShowCharts={setShowCharts}
        availableStatuses={availableStatuses}
        availableProducts={availableProducts}
        businessId={businessId}
        userId={userId}
        isFetching={isFetching}
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
          onTagUpdate={handleTagUpdate}
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