"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'

type PeriodUnit = 'week' | 'month' | 'quarter' | 'year'
type SegmentOperator = 'contains' | 'is' | 'is_not'

type CohortOrder = {
  id: string | number
  customer_id: string | null
  order_date: string | null
  order_date_utc?: string | null
  created_at: string | null
  grand_total: number | string | null
  status: string | null
  items_json?: OrderItem[] | string | null
}

type OrderItem = {
  name?: string | null
  product_name?: string | null
}

type CohortRow = {
  key: string
  label: string
  start: Date
  customerIds: Set<string>
  firstOrderRevenue: number
  returningByOffset: Map<number, Set<string>>
  revenueByOffset: Map<number, number>
}

type RpcCohortRow = {
  key: string
  label: string
  start: string
  customerCount: number
  firstOrderRevenue: number
  returningByOffset: Record<string, number>
  revenueByOffset: Record<string, number>
}

type RpcCohortResult = {
  totalCustomers: number
  returningCustomers: number
  repeatRate: number
  totalRevenue: number
  rows: RpcCohortRow[]
}

const CACHE_KEY_PREFIX = 'su_returning_cohort_'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 menit

const periodOptions: { value: PeriodUnit; label: string }[] = [
  { value: 'week', label: 'Mingguan' },
  { value: 'month', label: 'Bulanan' },
  { value: 'quarter', label: 'Kuartalan' },
  { value: 'year', label: 'Tahunan' },
]

const durationOptions = [6, 9, 12, 18]

const segmentOperatorOptions: { value: SegmentOperator; label: string }[] = [
  { value: 'contains', label: 'Contain' },
  { value: 'is', label: 'Is' },
  { value: 'is_not', label: 'Is Not' },
]

const ordersPageSize = 1000
const allowedOrderStatuses = new Set(['shipped', 'processing', 'complete', 'completed'])

const formatIDR = (value: number) => (
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value || 0)
)

const startOfWeek = (date: Date) => {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = next.getDay() || 7
  next.setDate(next.getDate() - day + 1)
  return next
}

const startOfPeriod = (date: Date, unit: PeriodUnit) => {
  if (unit === 'week') return startOfWeek(date)
  if (unit === 'month') return new Date(date.getFullYear(), date.getMonth(), 1)
  if (unit === 'quarter') return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
  return new Date(date.getFullYear(), 0, 1)
}

const addPeriods = (date: Date, unit: PeriodUnit, amount: number) => {
  const next = new Date(date)

  if (unit === 'week') next.setDate(next.getDate() + amount * 7)
  if (unit === 'month') next.setMonth(next.getMonth() + amount)
  if (unit === 'quarter') next.setMonth(next.getMonth() + amount * 3)
  if (unit === 'year') next.setFullYear(next.getFullYear() + amount)

  return startOfPeriod(next, unit)
}

const getPeriodKey = (date: Date, unit: PeriodUnit) => {
  const start = startOfPeriod(date, unit)
  const year = start.getFullYear()
  const month = String(start.getMonth() + 1).padStart(2, '0')
  const day = String(start.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const getPeriodLabel = (date: Date, unit: PeriodUnit) => {
  const start = startOfPeriod(date, unit)

  if (unit === 'week') {
    return `Week ${start.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`
  }

  if (unit === 'month') {
    return start.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
  }

  if (unit === 'quarter') {
    return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`
  }

  return String(start.getFullYear())
}

const getOrderDate = (order: CohortOrder) => {
  const rawDate = order.order_date_utc || order.order_date || order.created_at || ''
  const date = new Date(rawDate)
  return Number.isNaN(date.getTime()) ? null : date
}

const getPeriodOffset = (from: Date, to: Date, unit: PeriodUnit) => {
  const start = startOfPeriod(from, unit)
  const end = startOfPeriod(to, unit)

  if (unit === 'week') {
    return Math.floor((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
  }

  const monthDiff = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth()
  if (unit === 'month') return monthDiff
  if (unit === 'quarter') return Math.floor(monthDiff / 3)
  return end.getFullYear() - start.getFullYear()
}

const getCustomerKey = (order: CohortOrder) => order.customer_id || `order-${order.id}`

const parseOrderItems = (items: CohortOrder['items_json']) => {
  if (Array.isArray(items)) return items
  if (typeof items !== 'string') return []

  try {
    const parsed = JSON.parse(items)
    return Array.isArray(parsed) ? parsed as OrderItem[] : []
  } catch {
    return []
  }
}

const getOrderProductNames = (order: CohortOrder) => {
  return parseOrderItems(order.items_json)
    .map((item) => item.name || item.product_name || '')
    .filter(Boolean)
}

const isOrderMatchProductSegment = (order: CohortOrder, operator: SegmentOperator, productName: string) => {
  const query = productName.trim().toLowerCase()
  if (!query) return true

  const productNames = getOrderProductNames(order).map((name) => name.toLowerCase())

  if (operator === 'is') {
    return productNames.some((name) => name === query)
  }

  if (operator === 'is_not') {
    return productNames.every((name) => name !== query)
  }

  return productNames.some((name) => name.includes(query))
}

const normalizeStatus = (status: string | null) => (
  (status || '').toLowerCase().replace(/[^a-z0-9]/g, '')
)

const isCountedOrderStatus = (status: string | null) => allowedOrderStatuses.has(normalizeStatus(status))

const getDateInputValue = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const dateInputToDate = (value: string) => {
  if (!value) return null

  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

const getInitialFirstOrderStartDate = () => {
  return getDateInputValue(addPeriods(startOfPeriod(new Date(), 'month'), 'month', -11))
}

const getHeatmapCellClass = (rate: number) => {
  if (rate >= 70) return 'bg-blue-700 text-white border-blue-800 shadow-xs'
  if (rate >= 50) return 'bg-blue-600 text-white border-blue-700 shadow-xs'
  if (rate >= 35) return 'bg-blue-500 text-white border-blue-600 shadow-xs'
  if (rate >= 20) return 'bg-blue-200 text-blue-950 border-blue-300'
  if (rate > 0) return 'bg-blue-50 text-blue-950 border-blue-200'

  return 'bg-slate-50 text-slate-400 border-slate-100'
}

export default function ReturningCohortPage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [orders, setOrders] = useState<CohortOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isUsingRpc, setIsUsingRpc] = useState(false)
  const [serverCohortData, setServerCohortData] = useState<RpcCohortResult | null>(null)

  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>('month')
  const [duration, setDuration] = useState(12)
  const [firstOrderStartDate, setFirstOrderStartDate] = useState(getInitialFirstOrderStartDate)
  const [segmentOperator, setSegmentOperator] = useState<SegmentOperator>('contains')
  const [segmentProductName, setSegmentProductName] = useState('')

  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ─── Fetch Cohort Data (RPC First, fallback to LocalStorage & Client Fetch) ──
  const fetchCohortData = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true)
    else setIsSyncing(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()

      if (!profile?.active_business_id) return
      const businessId = profile.active_business_id

      // 1. Try High-Performance PostgreSQL RPC Function
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_returning_cohort', {
          p_business_id: businessId,
          p_period_unit: periodUnit,
          p_duration: duration,
          p_first_order_start: firstOrderStartDate || null,
          p_segment_operator: segmentOperator,
          p_product_name: segmentProductName || '',
        })

        if (!rpcError && rpcData && typeof rpcData === 'object' && Array.isArray(rpcData.rows)) {
          setServerCohortData(rpcData as RpcCohortResult)
          setIsUsingRpc(true)

          // Cache RPC result in localStorage
          if (typeof window !== 'undefined') {
            const cacheKey = `${CACHE_KEY_PREFIX}rpc_${businessId}_${periodUnit}_${duration}_${firstOrderStartDate}_${segmentOperator}_${segmentProductName}`
            try {
              localStorage.setItem(cacheKey, JSON.stringify({ data: rpcData, ts: Date.now() }))
            } catch {
              // Ignore storage overflow
            }
          }

          setLoading(false)
          setIsSyncing(false)

          // Fetch orders asynchronously for product dropdown suggestions if empty
          if (orders.length === 0) {
            const { data: sampleOrders } = await supabase
              .from('orders')
              .select('id, customer_id, order_date, created_at, grand_total, status, items_json')
              .eq('business_id', businessId)
              .in('status', ['shipped', 'processing', 'complete', 'completed', 'Shipped', 'Processing', 'Complete', 'Completed'])
              .order('order_date', { ascending: true })
              .range(0, 999)

            if (sampleOrders) setOrders(sampleOrders as CohortOrder[])
          }
          return
        }
      } catch {
        // RPC not deployed yet, fall back to client-side computation
      }

      setIsUsingRpc(false)

      // 2. Client-side fetch with localStorage caching
      const rawOrdersCacheKey = `${CACHE_KEY_PREFIX}orders_${businessId}`
      if (typeof window !== 'undefined') {
        const cachedRaw = localStorage.getItem(rawOrdersCacheKey)
        if (cachedRaw) {
          try {
            const parsed = JSON.parse(cachedRaw)
            if (Date.now() - parsed.ts < CACHE_TTL_MS && Array.isArray(parsed.orders)) {
              setOrders(parsed.orders)
              setLoading(false)
            }
          } catch {
            // Ignore cache error
          }
        }
      }

      // Fetch full order set from DB for client aggregation
      const allOrders: CohortOrder[] = []
      let from = 0

      while (true) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, customer_id, order_date, created_at, grand_total, status, items_json')
          .eq('business_id', businessId)
          .order('order_date', { ascending: true })
          .range(from, from + ordersPageSize - 1)

        if (error) throw error

        allOrders.push(...((data || []) as CohortOrder[]))
        if (!data || data.length < ordersPageSize) break
        from += ordersPageSize
      }

      setOrders(allOrders)

      // Cache raw orders in localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(rawOrdersCacheKey, JSON.stringify({ orders: allOrders, ts: Date.now() }))
        } catch {
          // Ignore cache error
        }
      }

    } catch (error) {
      console.error('Error fetching returning cohort data:', error)
    } finally {
      setLoading(false)
      setIsSyncing(false)
    }
  }, [supabase, periodUnit, duration, firstOrderStartDate, segmentOperator, segmentProductName, orders.length])

  // Load from localStorage instantly on mount / filter change before network fetch
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Read cached RPC payload
    const dummyBid = 'active'
    const rpcCacheKey = `${CACHE_KEY_PREFIX}rpc_${dummyBid}_${periodUnit}_${duration}_${firstOrderStartDate}_${segmentOperator}_${segmentProductName}`
    
    // Find matching cached item across localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(CACHE_KEY_PREFIX + 'rpc_') && key.includes(`_${periodUnit}_${duration}_`)) {
        try {
          const raw = localStorage.getItem(key)
          if (raw) {
            const parsed = JSON.parse(raw)
            if (Date.now() - parsed.ts < CACHE_TTL_MS && parsed.data) {
              setServerCohortData(parsed.data)
              setIsUsingRpc(true)
              setLoading(false)
              break
            }
          }
        } catch {
          // Ignore
        }
      }
    }
  }, [periodUnit, duration, firstOrderStartDate, segmentOperator, segmentProductName])

  useEffect(() => {
    let isMounted = true
    let ordersChannel: ReturnType<typeof supabase.channel> | null = null

    const subscribeToOrderChanges = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !isMounted) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()

      if (!profile?.active_business_id || !isMounted) return

      ordersChannel = supabase
        .channel(`returning-cohort-orders-${profile.active_business_id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `business_id=eq.${profile.active_business_id}`,
          },
          () => {
            fetchCohortData(true)
          }
        )
        .subscribe()
    }

    fetchCohortData()
    subscribeToOrderChanges()

    return () => {
      isMounted = false
      if (ordersChannel) {
        supabase.removeChannel(ordersChannel)
      }
    }
  }, [fetchCohortData, supabase])

  // ─── Client Cohort Computation (Used if RPC fallback) ─────────────────────
  const computedCohortData = useMemo(() => {
    if (isUsingRpc && serverCohortData) {
      // Map RPC data into component interface
      const rows = (serverCohortData.rows || []).map((r) => {
        const returningMap = new Map<number, number>()
        const revenueMap = new Map<number, number>()

        if (r.returningByOffset && typeof r.returningByOffset === 'object') {
          Object.entries(r.returningByOffset).forEach(([offsetKey, val]) => {
            returningMap.set(Number(offsetKey), Number(val) || 0)
          })
        }

        if (r.revenueByOffset && typeof r.revenueByOffset === 'object') {
          Object.entries(r.revenueByOffset).forEach(([offsetKey, val]) => {
            revenueMap.set(Number(offsetKey), Number(val) || 0)
          })
        }

        return {
          key: r.key,
          label: r.label,
          start: new Date(r.start || r.key),
          customerCount: r.customerCount,
          firstOrderRevenue: r.firstOrderRevenue,
          returningMap,
          revenueMap,
        }
      })

      return {
        rows,
        ignoredStatusCount: 0,
        ignoredSegmentCount: 0,
        totalCustomers: serverCohortData.totalCustomers,
        returningCustomers: serverCohortData.returningCustomers,
        repeatRate: serverCohortData.repeatRate,
        totalRevenue: serverCohortData.totalRevenue,
      }
    }

    // Client-side computation fallback
    const firstOrderStart = dateInputToDate(firstOrderStartDate)
    const statusFilteredOrders = orders.filter((order) => isCountedOrderStatus(order.status))
    const validOrders = statusFilteredOrders
      .filter((order) => isOrderMatchProductSegment(order, segmentOperator, segmentProductName))
      .map((order) => ({ order, date: getOrderDate(order), customerKey: getCustomerKey(order) }))
      .filter((item): item is { order: CohortOrder; date: Date; customerKey: string } => Boolean(item.date && item.customerKey))
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const ignoredStatusCount = orders.length - statusFilteredOrders.length
    const ignoredSegmentCount = statusFilteredOrders.length - validOrders.length
    const firstOrderByCustomer = new Map<string, Date>()

    validOrders.forEach(({ date, customerKey }) => {
      if (!firstOrderByCustomer.has(customerKey)) {
        firstOrderByCustomer.set(customerKey, date)
      }
    })

    const currentPeriod = startOfPeriod(new Date(), periodUnit)
    const earliestPeriod = addPeriods(currentPeriod, periodUnit, -(duration - 1))
    const rowMap = new Map<string, CohortRow>()

    validOrders.forEach(({ order, date, customerKey }) => {
      const firstOrderDate = firstOrderByCustomer.get(customerKey)
      if (!firstOrderDate) return
      if (firstOrderStart && firstOrderDate < firstOrderStart) return

      const cohortStart = startOfPeriod(firstOrderDate, periodUnit)
      if (cohortStart < earliestPeriod || cohortStart > currentPeriod) return

      const cohortKey = getPeriodKey(cohortStart, periodUnit)
      const offset = getPeriodOffset(cohortStart, date, periodUnit)
      if (offset < 0 || offset >= duration) return

      const row = rowMap.get(cohortKey) || {
        key: cohortKey,
        label: getPeriodLabel(cohortStart, periodUnit),
        start: cohortStart,
        customerIds: new Set<string>(),
        firstOrderRevenue: 0,
        returningByOffset: new Map<number, Set<string>>(),
        revenueByOffset: new Map<number, number>(),
      }

      row.customerIds.add(customerKey)

      if (offset === 0) {
        row.firstOrderRevenue += Number(order.grand_total) || 0
      } else {
        const bucket = row.returningByOffset.get(offset) || new Set<string>()
        bucket.add(customerKey)
        row.returningByOffset.set(offset, bucket)
      }

      row.revenueByOffset.set(offset, (row.revenueByOffset.get(offset) || 0) + (Number(order.grand_total) || 0))
      rowMap.set(cohortKey, row)
    })

    const rows = Array.from(rowMap.values())
      .sort((a, b) => b.start.getTime() - a.start.getTime())
      .map((row) => {
        const returningMap = new Map<number, number>()
        const revenueMap = new Map<number, number>()

        row.returningByOffset.forEach((set, offset) => {
          returningMap.set(offset, set.size)
        })
        row.revenueByOffset.forEach((rev, offset) => {
          revenueMap.set(offset, rev)
        })

        return {
          key: row.key,
          label: row.label,
          start: row.start,
          customerCount: row.customerIds.size,
          firstOrderRevenue: row.firstOrderRevenue,
          returningMap,
          revenueMap,
        }
      })

    const totalCustomers = rows.reduce((sum, row) => sum + row.customerCount, 0)
    const returningCustomersSet = new Set<string>()

    rowMap.forEach((row) => {
      row.returningByOffset.forEach((customers) => {
        customers.forEach((customerId) => returningCustomersSet.add(customerId))
      })
    })

    const totalRevenue = rows.reduce((sum, row) => {
      let rowRevenue = 0
      row.revenueMap.forEach((revenue) => {
        rowRevenue += revenue
      })
      return sum + rowRevenue
    }, 0)

    return {
      rows,
      ignoredStatusCount,
      ignoredSegmentCount,
      totalCustomers,
      returningCustomers: returningCustomersSet.size,
      repeatRate: totalCustomers ? (returningCustomersSet.size / totalCustomers) * 100 : 0,
      totalRevenue,
    }
  }, [duration, firstOrderStartDate, isUsingRpc, orders, periodUnit, segmentOperator, segmentProductName, serverCohortData])

  const productNameOptions = useMemo(() => {
    const productNames = new Set<string>()

    orders.forEach((order) => {
      getOrderProductNames(order).forEach((name) => productNames.add(name))
    })

    return Array.from(productNames).sort((a, b) => a.localeCompare(b))
  }, [orders])

  const filteredProductSuggestions = useMemo(() => {
    const query = segmentProductName.trim().toLowerCase()
    if (!query) return productNameOptions.slice(0, 15)
    return productNameOptions.filter((name) => name.toLowerCase().includes(query)).slice(0, 15)
  }, [productNameOptions, segmentProductName])

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 text-slate-900">
      
      {/* ── Sub Navigation Tabs ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-[#E2E2DC] pb-3 overflow-x-auto">
        <Link
          href="/customers"
          className="px-4 py-2 text-xs font-extrabold rounded-lg transition-all text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 flex items-center gap-1.5 shrink-0"
        >
          <span>👥</span> Customer List
        </Link>
        <Link
          href="/customers/cohorts/returning"
          className="px-4 py-2 text-xs font-extrabold rounded-lg transition-all bg-blue-600 text-white shadow-xs flex items-center gap-1.5 shrink-0"
        >
          <span>🔄</span> Returning Cohort
        </Link>
        <Link
          href="/customers/product-retention"
          className="px-4 py-2 text-xs font-extrabold rounded-lg transition-all text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 flex items-center gap-1.5 shrink-0"
        >
          <span>🔀</span> Product Retention
        </Link>
      </div>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-blue-600 border border-blue-100">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            Cohort Analytics {isUsingRpc && <span className="ml-1 text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-mono">RPC Accelerated</span>}
          </div>
          <h1 className="mt-2.5 text-3xl font-black tracking-tight text-slate-900">
            Customer Returning Cohort
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm font-medium leading-6 text-slate-500">
            Analisis retensi customer dari cohort pembelian pertama (first order) yang melakukan repeat purchase pada periode-periode berikutnya.
          </p>
        </div>

        {/* Syncing status badge */}
        {isSyncing && (
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Menyinkronkan data terbaru...
          </div>
        )}
      </header>

      {/* ── Controls & Filters Card ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
              <span>⚙️</span> Filter & Parameter Cohort
            </h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              Atur satuan waktu, tanggal mulai cohort, dan segmentasi produk untuk menganalisis retensi.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {(segmentProductName || firstOrderStartDate !== getInitialFirstOrderStartDate() || duration !== 12 || periodUnit !== 'month') && (
              <button
                type="button"
                onClick={() => {
                  setPeriodUnit('month')
                  setDuration(12)
                  setFirstOrderStartDate(getInitialFirstOrderStartDate())
                  setSegmentOperator('contains')
                  setSegmentProductName('')
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                Reset Default Filter
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          
          {/* Period Selection */}
          <label className="space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Periode Unit</span>
            <select
              value={periodUnit}
              onChange={(event) => setPeriodUnit(event.target.value as PeriodUnit)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
            >
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {/* First Order Date */}
          <label className="space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">First Order Mulai</span>
            <input
              type="date"
              value={firstOrderStartDate}
              onChange={(event) => setFirstOrderStartDate(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </label>

          {/* Duration */}
          <label className="space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Durasi Evaluasi</span>
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
            >
              {durationOptions.map((option) => (
                <option key={option} value={option}>{option} Periode (+{option - 1})</option>
              ))}
            </select>
          </label>

          {/* Operator */}
          <label className="space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kriteria Operator</span>
            <select
              value={segmentOperator}
              onChange={(event) => setSegmentOperator(event.target.value as SegmentOperator)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
            >
              {segmentOperatorOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

        </div>

        {/* Product Autocomplete Search Bar */}
        <div ref={dropdownRef} className="relative space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Segmentasi Produk (Optional)
            </span>
            {segmentProductName && (
              <button
                type="button"
                onClick={() => {
                  setSegmentProductName('')
                  setIsDropdownOpen(false)
                }}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline"
              >
                Clear Produk
              </button>
            )}
          </div>

          <div className="relative flex items-center">
            <svg
              className="absolute left-3.5 text-slate-400 pointer-events-none"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>

            <input
              type="text"
              value={segmentProductName}
              onFocus={() => setIsDropdownOpen(true)}
              onChange={(event) => {
                setSegmentProductName(event.target.value)
                setIsDropdownOpen(true)
              }}
              placeholder="Contoh: Serum, Moisturizer, atau ketik nama produk..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-9 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:font-normal placeholder:text-slate-400"
            />

            {segmentProductName && (
              <button
                type="button"
                onClick={() => {
                  setSegmentProductName('')
                  setIsDropdownOpen(false)
                }}
                className="absolute right-3 text-slate-400 hover:text-slate-700 text-xs font-bold h-5 w-5 rounded-full flex items-center justify-center bg-slate-200/70 hover:bg-slate-300 transition-colors"
                title="Reset Produk"
              >
                ✕
              </button>
            )}
          </div>

          {/* Autocomplete Dropdown List */}
          {isDropdownOpen && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-50 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl space-y-0.5">
              {filteredProductSuggestions.length === 0 ? (
                <div className="px-3 py-2.5 text-center text-xs font-medium text-slate-400">
                  Produk tidak ditemukan
                </div>
              ) : (
                filteredProductSuggestions.map((prodName) => (
                  <button
                    key={prodName}
                    type="button"
                    onClick={() => {
                      setSegmentProductName(prodName)
                      setIsDropdownOpen(false)
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left rounded-lg text-xs font-bold transition-all ${
                      segmentProductName === prodName
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <span className="truncate min-w-0 flex-1">{prodName}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

      </section>

      {/* ── Stat KPI Cards ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs animate-pulse space-y-3">
              <div className="h-3 w-24 bg-slate-200 rounded" />
              <div className="h-7 w-32 bg-slate-300 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-slate-300 transition-all">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Cohort Customer</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{computedCohortData.totalCustomers.toLocaleString('id-ID')}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">Customer melakukan order pertama</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-blue-200 transition-all">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Returning Customer</p>
              <p className="mt-2 text-3xl font-black text-blue-600">{computedCohortData.returningCustomers.toLocaleString('id-ID')}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">Beli kembali di periode berikutnya</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-emerald-200 transition-all">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Returning Rate</p>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="text-3xl font-black text-emerald-600">{computedCohortData.repeatRate.toFixed(1)}%</p>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 border border-emerald-100">
                  Overall
                </span>
              </div>
              <p className="mt-1 text-[11px] font-medium text-slate-400">Rasio pelanggan repeat purchase</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-slate-300 transition-all">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Revenue Cohort</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{formatIDR(computedCohortData.totalRevenue)}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">Revenue akumulatif cohort</p>
            </div>
          </section>

          {/* Ignored Order Banners */}
          {!isUsingRpc && computedCohortData.ignoredStatusCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 flex items-center gap-2">
              <span>⚠️</span>
              <span>{computedCohortData.ignoredStatusCount} order diabaikan karena statusnya tidak terhitung (bukan shipped, processing, complete, completed).</span>
            </div>
          )}

          {!isUsingRpc && computedCohortData.ignoredSegmentCount > 0 && segmentProductName.trim() && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-800 flex items-center gap-2">
              <span>ℹ️</span>
              <span>{computedCohortData.ignoredSegmentCount} order tidak masuk cohort karena tidak cocok dengan segment nama produk &quot;{segmentProductName}&quot;.</span>
            </div>
          )}

          {/* ── Returning Cohort Heatmap Table ───────────────────────────────── */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            
            {/* Table Header Controls */}
            <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between bg-slate-50/50">
              <div>
                <h2 className="text-base font-black tracking-tight text-slate-900 flex items-center gap-2">
                  <span>📊</span> Returning Cohort Heatmap
                </h2>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  Kolom <strong className="text-slate-800">0</strong> adalah periode order pertama. Kolom <strong className="text-slate-800">+1</strong> dan seterusnya menunjukkan % customer yang beli lagi.
                </p>
              </div>

              {/* Heatmap Legend */}
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 shadow-2xs">
                <span>Low</span>
                <div className="h-3.5 w-6 rounded border border-slate-100 bg-slate-50" />
                <div className="h-3.5 w-6 rounded border border-blue-200 bg-blue-50" />
                <div className="h-3.5 w-6 rounded border border-blue-300 bg-blue-200" />
                <div className="h-3.5 w-6 rounded border border-blue-600 bg-blue-500" />
                <div className="h-3.5 w-6 rounded border border-blue-800 bg-blue-700" />
                <span>High</span>
              </div>
            </div>

            {/* Table Container */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="bg-slate-100/70 text-[10px] uppercase tracking-widest text-slate-500">
                    <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-100/90 px-4 py-3.5 font-black">Cohort</th>
                    <th className="border-b border-slate-200 px-4 py-3.5 text-right font-black">Cust Size</th>
                    <th className="border-b border-slate-200 px-3 py-3.5 text-center font-black">0 (First)</th>
                    {Array.from({ length: duration - 1 }).map((_, index) => (
                      <th key={index} className="border-b border-slate-200 px-3 py-3.5 text-center font-black">+{index + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {computedCohortData.rows.length === 0 ? (
                    <tr>
                      <td colSpan={duration + 2} className="px-4 py-16 text-center text-sm font-bold text-slate-400">
                        Belum ada data order yang memenuhi kriteria cohort ini.
                      </td>
                    </tr>
                  ) : (
                    computedCohortData.rows.map((row) => {
                      const cohortSize = row.customerCount

                      return (
                        <tr key={row.key} className="hover:bg-blue-50/30 transition-colors">
                          
                          {/* Sticky Cohort Label */}
                          <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3.5 font-black text-slate-800 shadow-2xs">
                            {row.label}
                          </td>

                          {/* Customer Size */}
                          <td className="border-b border-slate-100 px-4 py-3.5 text-right font-bold text-slate-600">
                            {cohortSize.toLocaleString('id-ID')}
                          </td>

                          {/* Offset 0 Cell */}
                          <td className="border-b border-slate-100 px-2 py-2 text-center">
                            <div
                              className="mx-auto grid h-14 min-w-22 content-center rounded-xl border border-emerald-600 bg-emerald-500 px-2 text-white shadow-2xs transition-transform hover:scale-105"
                              title={`${cohortSize} customer first order, Total ${formatIDR(row.firstOrderRevenue)} revenue`}
                            >
                              <p className="text-xs font-black">100%</p>
                              <p className="text-[10px] font-bold opacity-90">{cohortSize} cust</p>
                            </div>
                          </td>

                          {/* Offsets +1 .. +N Cells */}
                          {Array.from({ length: duration - 1 }).map((_, index) => {
                            const offset = index + 1
                            const count = row.returningMap.get(offset) || 0
                            const rev = row.revenueMap.get(offset) || 0
                            const rate = cohortSize ? (count / cohortSize) * 100 : 0

                            return (
                              <td key={offset} className="border-b border-slate-100 px-2 py-2 text-center">
                                <div
                                  className={`mx-auto grid h-14 min-w-22 content-center rounded-xl border px-2 shadow-2xs transition-transform hover:scale-105 ${getHeatmapCellClass(rate)}`}
                                  title={`${count} customer kembali pada periode +${offset}, Revenue: ${formatIDR(rev)}`}
                                >
                                  <p className="text-xs font-black">{rate.toFixed(0)}%</p>
                                  <p className="text-[10px] font-bold opacity-80">{count} cust</p>
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

          </section>
        </>
      )}

    </div>
  )
}
