"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import { useUserContext } from '@/components/UserContext'
import Link from 'next/link'

// Types
type RawRecord = Record<string, unknown>

type OrderItem = {
  name?: string | null
  product_name?: string | null
  quantity?: number | string | null
  subtotal?: number | string | null
  total?: number | string | null
  price?: number | string | null
  sku?: string | null
  category?: string | null
  categories?: string[] | { name?: string | null }[] | null
}

type SalesOrder = {
  id: string | number
  order_number?: string | null
  order_date: string | null
  order_date_utc?: string | null
  created_at?: string | null
  status?: string | null
  total_qty?: number | string | null
  subtotal?: number | string | null
  grand_total?: number | string | null
  items_json?: OrderItem[] | string | null
  raw_source_data?: RawRecord | null
  customer_id?: string | null
}

type CustomerMetric = {
  customer_id: string
  name: string | null
  ltv: number
  total_order_count: number
  last_order_date: string | null
}

type SectionId = 'overview_kpis' | 'customer_charts' | 'bottom_details'

interface LayoutItem {
  id: SectionId
  title: string
  visible: boolean
}

// Helpers
const toNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatIDR = (value: number) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
}).format(value)

const formatCompactIDR = (value: number) => {
  if (value >= 1000000000) return `Rp ${(value / 1000000000).toFixed(1)}M`
  if (value >= 1000000) return `Rp ${(value / 1000000).toFixed(1)}jt`
  if (value >= 1000) return `Rp ${(value / 1000).toFixed(0)}rb`
  return formatIDR(value)
}

const parseArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

const parseRecord = (value: unknown): RawRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as RawRecord
}

const countedStatuses = new Set(['shipped', 'processing', 'complete', 'completed'])
const normalizeStatus = (status?: string | null) => (
  (status || '').toLowerCase().replace(/[^a-z0-9]/g, '')
)
const isCountedOrderStatus = (status?: string | null) => countedStatuses.has(normalizeStatus(status))

export default function DashboardPage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  // Helper to format Date to local YYYY-MM-DD string to avoid timezone offset shifts
  const formatDateToLocalYYYYMMDD = useCallback((d: Date) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])

  // States
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [customerMetrics, setCustomerMetrics] = useState<CustomerMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isStaleRefresh, setIsStaleRefresh] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [businessId, setBusinessId] = useState('')

  // Date Filters (default to 'this-month')
  const [datePreset, setDatePreset] = useState<string>('this-month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Set default preset dates on mount to avoid hydration mismatches
  useEffect(() => {
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    setStartDate(formatDateToLocalYYYYMMDD(start))
    setEndDate(formatDateToLocalYYYYMMDD(end))
  }, [formatDateToLocalYYYYMMDD])

  // Layout Personalization
  const [layout, setLayout] = useState<LayoutItem[]>([
    { id: 'overview_kpis', title: 'Business Overview (KPI)', visible: true },
    { id: 'customer_charts', title: 'Customer Overview & Charts', visible: true },
    { id: 'bottom_details', title: 'Customer Lists & Attention Items', visible: true }
  ])
  const [showLayoutModal, setShowLayoutModal] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (showLayoutModal) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [showLayoutModal])

  // Fetch data with pagination to bypass limit
  const fetchAllData = useCallback(async (bid: string, silently = false) => {
    if (!silently) setLoading(true)
    setIsSyncing(true)
    setIsStaleRefresh(false)

    try {
      // 1. Fetch Orders in batches (select only necessary fields for dashboard)
      const allOrders: SalesOrder[] = []
      let from = 0
      const limit = 1000
      while (true) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_date, order_date_utc, created_at, status, grand_total, customer_id')
          .eq('business_id', bid)
          .order('order_date', { ascending: true })
          .range(from, from + limit - 1)

        if (error) throw error
        if (!data || data.length === 0) break
        allOrders.push(...(data as SalesOrder[]))
        if (data.length < limit) break
        from += limit
      }

      // 2. Fetch Customer Metrics in batches
      const allMetrics: CustomerMetric[] = []
      let mFrom = 0
      while (true) {
        const { data, error } = await supabase
          .from('customer_metrics')
          .select('customer_id, name, ltv, total_order_count, last_order_date')
          .eq('business_id', bid)
          .range(mFrom, mFrom + limit - 1)

        if (error) throw error
        if (!data || data.length === 0) break
        allMetrics.push(...(data as CustomerMetric[]))
        if (data.length < limit) break
        mFrom += limit
      }

      // Minimize orders to save localStorage space (prevents QuotaExceededError)
      const minimizedOrders = allOrders.map(o => ({
        id: o.id,
        order_date: o.order_date,
        order_date_utc: o.order_date_utc,
        created_at: o.created_at,
        status: o.status,
        grand_total: o.grand_total,
        customer_id: o.customer_id
      }))

      const ordersStr = JSON.stringify(minimizedOrders)
      const metricsStr = JSON.stringify(allMetrics)

      const prevOrders = localStorage.getItem(`su_dash_orders_${bid}`)
      const prevMetrics = localStorage.getItem(`su_dash_metrics_${bid}`)

      if (ordersStr !== prevOrders || metricsStr !== prevMetrics) {
        setOrders(allOrders)
        setCustomerMetrics(allMetrics)
        try {
          localStorage.setItem(`su_dash_orders_${bid}`, ordersStr)
          localStorage.setItem(`su_dash_metrics_${bid}`, metricsStr)
        } catch (e) {
          console.warn('LocalStorage quota exceeded, caching disabled for this session:', e)
        }
      }

      try {
        localStorage.setItem(`su_dash_ts_${bid}`, Date.now().toString())
      } catch (e) {
        // Ignore timestamp store failure
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
    } finally {
      setLoading(false)
      setIsSyncing(false)
    }
  }, [supabase])

  const { activeBusiness } = useUserContext()

  // Initial Load & Caching
  useEffect(() => {
    let isMounted = true
    let ordersChannel: ReturnType<typeof supabase.channel> | null = null

    if (!activeBusiness?.id) return

    const activeBid = activeBusiness.id
    const activeName = activeBusiness.name || 'Bisnis Saya'

    setBusinessId(activeBid)
    setBusinessName(activeName)

    // Load layout settings
    const savedLayout = localStorage.getItem(`su_dash_layout_${activeBid}`)
    if (savedLayout) {
      try {
        setLayout(JSON.parse(savedLayout))
      } catch (e) {
        console.error('Error parsing layout preference', e)
      }
    }

      // ── Smart Tiered Cache Strategy ────────────────────────────────────
      // Tier 1: <30s  → show cache, skip sync (definitely fresh)
      // Tier 2: 30s–5m → show cache + silent background sync
      // Tier 3: >5m   → show cache + background sync with spinner
      // Tier 4: no cache or business changed → fresh foreground fetch
      const SKIP_SYNC_MS    = 30 * 1000        //  30 seconds
      const SILENT_SYNC_MS  =  5 * 60 * 1000  //   5 minutes

      const cachedOrders  = localStorage.getItem(`su_dash_orders_${activeBid}`)
      const cachedMetrics = localStorage.getItem(`su_dash_metrics_${activeBid}`)
      const cachedTs      = localStorage.getItem(`su_dash_ts_${activeBid}`)
      const lastActiveBid = localStorage.getItem('su_last_active_bid')

      // Detect if user just switched businesses since last visit
      const businessJustChanged = lastActiveBid && lastActiveBid !== activeBid
      localStorage.setItem('su_last_active_bid', activeBid)

      if (cachedOrders && cachedMetrics && cachedTs && !businessJustChanged) {
        // Show cache instantly
        setOrders(JSON.parse(cachedOrders))
        setCustomerMetrics(JSON.parse(cachedMetrics))
        setLoading(false)

        const cacheAge = Date.now() - Number(cachedTs)

        if (cacheAge < SKIP_SYNC_MS) {
          // Tier 1: Cache is very fresh — skip network call entirely
          // (Realtime subscription will handle live updates)
        } else if (cacheAge < SILENT_SYNC_MS) {
          // Tier 2: Moderately fresh — sync silently in background
          fetchAllData(activeBid, true)
        } else {
          // Tier 3: Stale — show skeleton overlay while syncing in background
          setIsStaleRefresh(true)
          fetchAllData(activeBid, true)
        }
      } else {
        // Tier 4: No cache or business switched — fresh foreground fetch
        fetchAllData(activeBid, false)
      }

      // Supabase Realtime Listener (handles live order mutations instantly)
      ordersChannel = supabase
        .channel(`su_dash_orders_realtime_${activeBid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `business_id=eq.${activeBid}`,
          },
          () => {
            fetchAllData(activeBid!, true)
          }
        )
        .subscribe()

    return () => {
      isMounted = false
      if (ordersChannel) {
        supabase.removeChannel(ordersChannel)
      }
    }
  }, [activeBusiness, supabase, fetchAllData])


  // Date Preset Handler
  const handlePresetChange = (value: string) => {
    setDatePreset(value)
    if (value === 'all') {
      setStartDate('')
      setEndDate('')
      return
    }

    const today = new Date()
    let start = new Date()
    let end = new Date()

    if (value === 'this-month') {
      start = new Date(today.getFullYear(), today.getMonth(), 1)
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    } else if (value === 'last-month') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      end = new Date(today.getFullYear(), today.getMonth(), 0)
    } else if (value === 'last-30') {
      start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      end = today
    }

    setStartDate(formatDateToLocalYYYYMMDD(start))
    setEndDate(formatDateToLocalYYYYMMDD(end))
  }

  // Memoized enriched and filtered orders
  const processedOrders = useMemo(() => {
    return orders
      .filter((o) => isCountedOrderStatus(o.status))
      .map((o) => {
        const rawDate = o.order_date_utc || o.order_date || o.created_at || ''
        const dateObj = new Date(rawDate)
        return {
          ...o,
          dateObj: Number.isNaN(dateObj.getTime()) ? null : dateObj,
          grandTotalNum: toNumber(o.grand_total)
        }
      })
      .filter((o) => o.dateObj !== null) as Array<SalesOrder & { dateObj: Date; grandTotalNum: number }>
  }, [orders])

  // Filter orders by date range
  const filteredOrders = useMemo(() => {
    return processedOrders.filter((o) => {
      const orderDateKey = formatDateToLocalYYYYMMDD(o.dateObj)
      const matchStart = !startDate || orderDateKey >= startDate
      const matchEnd = !endDate || orderDateKey <= endDate
      return matchStart && matchEnd
    })
  }, [processedOrders, startDate, endDate, formatDateToLocalYYYYMMDD])

  // Calculate Previous Period Orders for percentage changes
  const prevPeriodOrders = useMemo(() => {
    if (!startDate || !endDate) return []
    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    const prevStart = new Date(start.getTime() - diffTime - 24 * 60 * 60 * 1000)
    const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000)

    const prevStartStr = formatDateToLocalYYYYMMDD(prevStart)
    const prevEndStr = formatDateToLocalYYYYMMDD(prevEnd)

    return processedOrders.filter((o) => {
      const orderDateKey = formatDateToLocalYYYYMMDD(o.dateObj)
      return orderDateKey >= prevStartStr && orderDateKey <= prevEndStr
    })
  }, [processedOrders, startDate, endDate, formatDateToLocalYYYYMMDD])

  // Deduplicate and re-calculate customer metrics locally based only on valid orders (excl cancelled/returned)
  const uniqueCustomerMetrics = useMemo(() => {
    const map = new Map<string, CustomerMetric>()
    
    // Create name lookup map
    const nameMap = new Map<string, string | null>()
    customerMetrics.forEach((c) => {
      if (c.customer_id) nameMap.set(c.customer_id, c.name)
    })

    // Group valid orders (processedOrders) by customer_id
    processedOrders.forEach((o) => {
      if (!o.customer_id) return
      const cid = o.customer_id
      const grandTotal = o.grandTotalNum
      const oDateStr = formatDateToLocalYYYYMMDD(o.dateObj)

      const existing = map.get(cid)
      if (existing) {
        existing.ltv += grandTotal
        existing.total_order_count += 1
        if (!existing.last_order_date || oDateStr > existing.last_order_date) {
          existing.last_order_date = oDateStr
        }
      } else {
        map.set(cid, {
          customer_id: cid,
          name: nameMap.get(cid) || 'Tanpa Nama',
          ltv: grandTotal,
          total_order_count: 1,
          last_order_date: oDateStr
        })
      }
    })

    return Array.from(map.values())
  }, [processedOrders, customerMetrics, formatDateToLocalYYYYMMDD])

  // KPIs Calculations
  const metrics = useMemo(() => {
    // Current period metrics
    const currentRevenue = filteredOrders.reduce((sum, o) => sum + o.grandTotalNum, 0)
    const currentOrdersCount = filteredOrders.length
    const currentCustomers = Array.from(new Set(filteredOrders.map((o) => o.customer_id).filter(Boolean)))
    
    // Repeat buyers in current period: count of customers who have total orders >= 2
    const currentRepeatCustomers = currentCustomers.filter((cid) => {
      const match = uniqueCustomerMetrics.find((m) => m.customer_id === cid)
      return match ? match.total_order_count >= 2 : false
    })

    const repeatCustomerRate = currentCustomers.length > 0 
      ? (currentRepeatCustomers.length / currentCustomers.length) * 100 
      : 0

    const currentRepeatRevenue = filteredOrders.reduce((sum, o) => {
      const match = uniqueCustomerMetrics.find((m) => m.customer_id === o.customer_id)
      return match && match.total_order_count >= 2 ? sum + o.grandTotalNum : sum
    }, 0)

    const repeatRevenueRate = currentRevenue > 0 
      ? (currentRepeatRevenue / currentRevenue) * 100 
      : 0

    const currentClvSum = currentCustomers.reduce((sum, cid) => {
      const match = uniqueCustomerMetrics.find((m) => m.customer_id === cid)
      return sum + (match ? match.ltv : 0)
    }, 0)

    const averageClv = currentCustomers.length > 0 ? currentClvSum / currentCustomers.length : 0

    // Previous period metrics
    const prevRevenue = prevPeriodOrders.reduce((sum, o) => sum + o.grandTotalNum, 0)
    const prevOrdersCount = prevPeriodOrders.length
    const prevCustomers = Array.from(new Set(prevPeriodOrders.map((o) => o.customer_id).filter(Boolean)))

    const prevClvSum = prevCustomers.reduce((sum, cid) => {
      const match = uniqueCustomerMetrics.find((m) => m.customer_id === cid)
      return sum + (match ? match.ltv : 0)
    }, 0)
    const prevAverageClv = prevCustomers.length > 0 ? prevClvSum / prevCustomers.length : 0

    const revenueDiff = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue) * 100 : 0
    const customersDiff = prevCustomers.length > 0 ? ((currentCustomers.length - prevCustomers.length) / prevCustomers.length) * 100 : 0
    const clvDiff = prevAverageClv > 0 ? ((averageClv - prevAverageClv) / prevAverageClv) * 100 : 0

    return {
      revenue: currentRevenue,
      revenueDiff,
      ordersCount: currentOrdersCount,
      customersCount: currentCustomers.length,
      customersDiff,
      repeatCustomerRate,
      repeatRevenueRate,
      averageClv,
      clvDiff,
      repeatCustomersCount: currentRepeatCustomers.length
    }
  }, [filteredOrders, prevPeriodOrders, uniqueCustomerMetrics])

  // Sparkline Points for Revenue Card
  const revenueSparklinePoints = useMemo(() => {
    if (filteredOrders.length === 0) return []
    const dailyMap = new Map<string, number>()
    filteredOrders.forEach((o) => {
      const key = o.dateObj.toISOString().slice(0, 10)
      dailyMap.set(key, (dailyMap.get(key) || 0) + o.grandTotalNum)
    })

    const sortedKeys = Array.from(dailyMap.keys()).sort()
    return sortedKeys.map((key, idx) => ({
      x: sortedKeys.length <= 1 ? 50 : (idx / (sortedKeys.length - 1)) * 100,
      y: dailyMap.get(key) || 0
    }))
  }, [filteredOrders])

  const revenueSparklinePath = useMemo(() => {
    if (revenueSparklinePoints.length === 0) return ''
    const maxY = Math.max(...revenueSparklinePoints.map((p) => p.y), 1)
    const scaledPoints = revenueSparklinePoints.map((p) => ({
      x: p.x,
      y: 35 - (p.y / maxY) * 30 // Bound between y=5 and y=35
    }))
    return scaledPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  }, [revenueSparklinePoints])

  // Customer Segmentation (Loyal, Active, Mulai Hilang, Hilang)
  const segments = useMemo(() => {
    let loyal = 0
    let active = 0
    let warning = 0
    let lost = 0

    const today = new Date()

    uniqueCustomerMetrics.forEach((c) => {
      if (!c.last_order_date) {
        lost++
        return
      }

      const lastDate = new Date(c.last_order_date)
      const diffTime = Math.abs(today.getTime() - lastDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      const isLoyal = c.total_order_count >= 2

      if (isLoyal) {
        loyal++
      } else if (diffDays <= 60) {
        active++
      } else if (diffDays > 60 && diffDays <= 90) {
        warning++
      } else {
        lost++
      }
    })

    const total = uniqueCustomerMetrics.length || 1

    return {
      loyal: { count: loyal, percent: (loyal / total) * 100 },
      active: { count: active, percent: (active / total) * 100 },
      warning: { count: warning, percent: (warning / total) * 100 },
      lost: { count: lost, percent: (lost / total) * 100 },
      totalCount: uniqueCustomerMetrics.length
    }
  }, [uniqueCustomerMetrics])

  // Revenue Sources (New vs Repeat revenue split)
  const revenueSources = useMemo(() => {
    let newRevenue = 0
    let repeatRevenue = 0

    filteredOrders.forEach((o) => {
      const match = uniqueCustomerMetrics.find((m) => m.customer_id === o.customer_id)
      if (match && match.total_order_count >= 2) {
        repeatRevenue += o.grandTotalNum
      } else {
        newRevenue += o.grandTotalNum
      }
    })

    const total = newRevenue + repeatRevenue || 1
    const newPercent = (newRevenue / total) * 100
    const repeatPercent = (repeatRevenue / total) * 100

    // Stats
    const currentCustomers = Array.from(new Set(filteredOrders.map((o) => o.customer_id).filter(Boolean)))
    const aov = currentCustomers.length > 0 ? total / filteredOrders.length : 0
    const purchaseFreq = currentCustomers.length > 0 ? filteredOrders.length / currentCustomers.length : 0

    return {
      newRevenue,
      repeatRevenue,
      newPercent,
      repeatPercent,
      aov,
      purchaseFreq
    }
  }, [filteredOrders, uniqueCustomerMetrics])

  // Customer Health Trend (Optimized Stacked Area Chart)
  const healthTrendData = useMemo(() => {
    const today = new Date()
    const months: Array<{
      key: string
      label: string
      date: Date
      loyal: number
      active: number
      warning: number
      lost: number
    }> = []

    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 0)
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('id-ID', { month: 'short' }),
        date: d,
        loyal: 0,
        active: 0,
        warning: 0,
        lost: 0
      })
    }

    // Pre-group orders by customer_id
    const ordersByCustomer: Record<string, Array<{ date: Date; total: number }>> = {}
    processedOrders.forEach((o) => {
      if (!o.customer_id) return
      if (!ordersByCustomer[o.customer_id]) {
        ordersByCustomer[o.customer_id] = []
      }
      ordersByCustomer[o.customer_id].push({
        date: o.dateObj,
        total: o.grandTotalNum
      })
    })

    // Sort order dates for each customer
    Object.values(ordersByCustomer).forEach((arr) => {
      arr.sort((a, b) => a.date.getTime() - b.date.getTime())
    })

    // Calculate segments for each month end
    months.forEach((m) => {
      const monthEnd = m.date.getTime()

      Object.entries(ordersByCustomer).forEach(([cid, ordersList]) => {
        const ordersBefore = ordersList.filter((o) => o.date.getTime() <= monthEnd)
        if (ordersBefore.length === 0) return

        const ltvVal = ordersBefore.reduce((sum, o) => sum + o.total, 0)
        const countVal = ordersBefore.length
        const lastOrderDate = ordersBefore[ordersBefore.length - 1].date

        const diffTime = Math.abs(monthEnd - lastOrderDate.getTime())
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

        const isLoyal = countVal >= 2

        if (isLoyal) {
          m.loyal++
        } else if (diffDays <= 60) {
          m.active++
        } else if (diffDays > 60 && diffDays <= 90) {
          m.warning++
        } else {
          m.lost++
        }
      })
    })

    return months
  }, [processedOrders])

  // Generate SVG stacked paths
  const healthTrendPaths = useMemo(() => {
    if (healthTrendData.length === 0) return { loyal: '', active: '', warning: '', lost: '', points: [] }

    const points = healthTrendData.map((m, idx) => {
      const total = m.loyal + m.active + m.warning + m.lost || 1
      const pLoyal = (m.loyal / total) * 100
      const pActive = (m.active / total) * 100
      const pWarning = (m.warning / total) * 100
      const pLost = (m.lost / total) * 100

      const x = (idx / (healthTrendData.length - 1)) * 100

      return {
        x,
        y0: 100,
        y1: 100 - pLoyal,
        y2: 100 - (pLoyal + pActive),
        y3: 100 - (pLoyal + pActive + pWarning),
        y4: 0
      }
    })

    const last = points[points.length - 1]

    // Path for Loyal (bottom band)
    const loyalPath =
      points.map((p) => `L ${p.x} ${p.y1}`).join(' ').replace(/^L/, 'M') +
      ` L 100 100 L 0 100 Z`

    // Path for Active (y1 to y2)
    const activePath =
      points.map((p) => `L ${p.x} ${p.y2}`).join(' ').replace(/^L/, 'M') +
      ` L ${last.x} ${last.y1}` +
      [...points].reverse().map((p) => ` L ${p.x} ${p.y1}`).join('') +
      ` Z`

    // Path for Warning (y2 to y3)
    const warningPath =
      points.map((p) => `L ${p.x} ${p.y3}`).join(' ').replace(/^L/, 'M') +
      ` L ${last.x} ${last.y2}` +
      [...points].reverse().map((p) => ` L ${p.x} ${p.y2}`).join('') +
      ` Z`

    // Path for Lost (top band, y3 to 0)
    const lostPath =
      points.map((p) => `L ${p.x} 0`).join(' ').replace(/^L/, 'M') +
      ` L ${last.x} ${last.y3}` +
      [...points].reverse().map((p) => ` L ${p.x} ${p.y3}`).join('') +
      ` Z`

    return { loyal: loyalPath, active: activePath, warning: warningPath, lost: lostPath, points }
  }, [healthTrendData])

  // Customer Attention List Calculations
  const attentionItems = useMemo(() => {
    let oneTimeBuyers = 0
    let inactive90 = 0
    let inactive60_90 = 0
    let highClv = 0

    const today = new Date()

    uniqueCustomerMetrics.forEach((c) => {
      if (c.total_order_count === 1) oneTimeBuyers++
      if (c.ltv >= 2000000) highClv++

      if (!c.last_order_date) {
        inactive90++
        return
      }

      const lastDate = new Date(c.last_order_date)
      const diffTime = Math.abs(today.getTime() - lastDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      if (diffDays > 90) {
        inactive90++
      } else if (diffDays > 60 && diffDays <= 90) {
        inactive60_90++
      }
    })

    return { oneTimeBuyers, inactive90, inactive60_90, highClv }
  }, [uniqueCustomerMetrics])

  // Potential Revenue Loss (Sum of LTV of inactive customers)
  const potentialLoss = useMemo(() => {
    const today = new Date()
    return uniqueCustomerMetrics.reduce((sum, c) => {
      if (!c.last_order_date) return sum + c.ltv
      const lastDate = new Date(c.last_order_date)
      const diffDays = Math.ceil(Math.abs(today.getTime() - lastDate.getTime()) / 86400000)
      if (diffDays > 60) {
        return sum + c.ltv
      }
      return sum
    }, 0)
  }, [uniqueCustomerMetrics])

  // Top Pelanggan based on CLV
  const topCustomers = useMemo(() => {
    return [...uniqueCustomerMetrics]
      .sort((a, b) => b.ltv - a.ltv)
      .slice(0, 5)
  }, [uniqueCustomerMetrics])

  // Layout Personalization functions
  const toggleSectionVisibility = (id: SectionId) => {
    const updated = layout.map((item) =>
      item.id === id ? { ...item, visible: !item.visible } : item
    )
    setLayout(updated)
    if (businessId) {
      localStorage.setItem(`su_dash_layout_${businessId}`, JSON.stringify(updated))
    }
  }

  const moveSection = (index: number, direction: 'up' | 'down') => {
    const updated = [...layout]
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    if (targetIdx < 0 || targetIdx >= layout.length) return

    const temp = updated[index]
    updated[index] = updated[targetIdx]
    updated[targetIdx] = temp

    setLayout(updated)
    if (businessId) {
      localStorage.setItem(`su_dash_layout_${businessId}`, JSON.stringify(updated))
    }
  }

  // ── Dashboard Skeleton Component ──────────────────────────────────────
  const DashboardSkeleton = () => (
    <div className="space-y-6 su-fade-in">
      {/* KPI Cards Skeleton */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
            <div className="space-y-2">
              <div className="h-3 w-24 bg-slate-100 rounded-full animate-pulse" />
              <div className="h-7 w-28 bg-slate-200 rounded-lg animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-5 w-14 bg-slate-100 rounded-full animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
              <div className="h-5 w-16 bg-slate-100 rounded-lg animate-pulse" style={{ animationDelay: `${i * 120}ms` }} />
            </div>
          </div>
        ))}
      </section>

      {/* Charts Skeleton */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Segmentation skeleton */}
        <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-5">
          <div className="space-y-1.5">
            <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
            <div className="h-3 w-48 bg-slate-100 rounded animate-pulse" />
          </div>
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <div className="h-3 w-20 bg-slate-200 rounded animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                  <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-200 rounded-full animate-pulse"
                    style={{ width: `${[65, 45, 25, 30][i]}%`, animationDelay: `${i * 80}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue sources skeleton */}
        <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-5">
          <div className="space-y-1.5">
            <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
            <div className="h-3 w-52 bg-slate-100 rounded animate-pulse" />
          </div>
          <div className="flex justify-center py-2">
            <div className="w-32 h-32 rounded-full bg-slate-200 animate-pulse flex items-center justify-center">
              <div className="w-24 h-24 rounded-full bg-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-1 p-2 rounded-xl bg-slate-50">
                <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
              </div>
            ))}
          </div>
        </div>

        {/* Health trend skeleton */}
        <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-5">
          <div className="space-y-1.5">
            <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
            <div className="h-3 w-44 bg-slate-100 rounded animate-pulse" />
          </div>
          <div className="h-40 w-full bg-slate-100 rounded-xl animate-pulse" />
          <div className="flex justify-center gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-3 w-16 bg-slate-100 rounded-full animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        </div>
      </section>

      {/* Bottom Detail Skeleton */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Attention items */}
        <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="p-3 rounded-xl bg-slate-50 space-y-2">
                <div className="h-6 w-12 bg-slate-200 rounded animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>

        {/* Top customers */}
        <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-slate-200 animate-pulse flex-shrink-0" style={{ animationDelay: `${i * 60}ms` }} />
                  <div className="space-y-1">
                    <div className="h-3 w-28 bg-slate-200 rounded animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                    <div className="h-2.5 w-20 bg-slate-100 rounded animate-pulse" />
                  </div>
                </div>
                <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )

  return (
    <div className="space-y-6 text-[#1C1C1A] su-fade-in relative">
      {/* Background sync thin progress bar (silent sync only, not stale) */}
      {isSyncing && !isStaleRefresh && (
        <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-blue-500/20">
          <div className="h-full bg-blue-600 animate-pulse w-full" />
        </div>
      )}

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#E2E2DC] pb-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Overview Dashboard</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900 tracking-tight">Performa Bisnis & Customer</h1>
          <p className="text-xs font-semibold text-[#6B6B63] mt-0.5">
            {businessName ? `Ringkasan metrik real-time ${businessName}` : 'Ringkasan metrik performa retail Anda.'}
          </p>
        </div>
        <button
          onClick={() => setShowLayoutModal(true)}
          className="inline-flex items-center gap-1.5 justify-center rounded-xl bg-white border border-[#E2E2DC] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-700 shadow-sm transition hover:bg-slate-50 cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="9" />
            <rect x="14" y="3" width="7" height="5" />
            <rect x="14" y="12" width="7" height="9" />
            <rect x="3" y="16" width="7" height="5" />
          </svg>
          Personalize Layout
        </button>
      </section>

      {/* ── DATE FILTER PANEL ────────────────────────────────────────────── */}
      <section className="bg-white border border-[#E2E2DC] rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3 flex-1">
          <label className="space-y-1 w-full sm:max-w-[200px]">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#8A8A80]">Preset Periode</span>
            <select
              value={datePreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full rounded-xl border border-[#E2E2DC] bg-[#F7F7F5] px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">Semua Periode</option>
              <option value="this-month">Bulan Ini</option>
              <option value="last-month">Bulan Lalu</option>
              <option value="last-30">30 Hari Terakhir</option>
            </select>
          </label>
          <label className="space-y-1 w-full sm:max-w-[160px]">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#8A8A80]">Tanggal Mulai</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setDatePreset('')
              }}
              className="w-full rounded-xl border border-[#E2E2DC] bg-[#F7F7F5] px-3.5 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="space-y-1 w-full sm:max-w-[160px]">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#8A8A80]">Tanggal Akhir</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setDatePreset('')
              }}
              className="w-full rounded-xl border border-[#E2E2DC] bg-[#F7F7F5] px-3.5 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
      </section>

      {/* ── SECTIONS DYNAMIC RENDER ─────────────────────────────────────── */}
      {/* Stale skeleton overlay: show skeleton on top when refreshing stale cache */}
      {isStaleRefresh ? (
        <>
          {/* "Memperbarui data..." badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl w-fit">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Memperbarui data...</span>
          </div>
          <DashboardSkeleton />
        </>
      ) : (
      <div className="space-y-6">
        {layout.map((item, index) => {
          if (!item.visible) return null

          // Business Overview KPI Cards
          if (item.id === 'overview_kpis') {
            return (
              <section key={item.id} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {/* KPI Card 1: Revenue */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8A80]">Revenue</span>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                      {loading ? (
                        <div className="h-7 w-28 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        formatCompactIDR(metrics.revenue)
                      )}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between">
                    {loading ? (
                      <div className="h-4 w-12 bg-slate-200 animate-pulse rounded" />
                    ) : (
                      <div className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        metrics.revenueDiff >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                      }`}>
                        {metrics.revenueDiff >= 0 ? '+' : ''}{metrics.revenueDiff.toFixed(1)}%
                      </div>
                    )}
                    <div className="w-16 h-5">
                      {loading ? (
                        <div className="w-full h-full bg-slate-100 animate-pulse rounded" />
                      ) : revenueSparklinePath ? (
                        <svg className="w-full h-full" viewBox="0 0 100 40">
                          <path d={revenueSparklinePath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <span className="text-[8px] font-bold text-slate-300">No data</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* KPI Card 2: Total Customers */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8A80]">Total Customer</span>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                      {loading ? (
                        <div className="h-7 w-16 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        metrics.customersCount.toLocaleString('id-ID')
                      )}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between">
                    {loading ? (
                      <div className="h-4 w-12 bg-slate-200 animate-pulse rounded" />
                    ) : (
                      <div className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        metrics.customersDiff >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                      }`}>
                        {metrics.customersDiff >= 0 ? '+' : ''}{metrics.customersDiff.toFixed(1)}%
                      </div>
                    )}
                    <span className="text-[10px] font-bold text-[#6B6B63]">{metrics.ordersCount} orders</span>
                  </div>
                </div>

                {/* KPI Card 3: Repeat Customer Rate */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8A80]">Repeat Customer Rate</span>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                      {loading ? (
                        <div className="h-7 w-20 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        `${metrics.repeatCustomerRate.toFixed(1)}%`
                      )}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#6B6B63]">
                      {loading ? (
                        <span className="inline-block h-3.5 w-16 bg-slate-100 animate-pulse rounded" />
                      ) : (
                        `${metrics.repeatCustomersCount} dari ${metrics.customersCount} customer`
                      )}
                    </span>
                  </div>
                </div>

                {/* KPI Card 4: Repeat Revenue Rate */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8A80]">Repeat Revenue Rate</span>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                      {loading ? (
                        <div className="h-7 w-20 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        `${metrics.repeatRevenueRate.toFixed(1)}%`
                      )}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#6B6B63]">
                      {loading ? (
                        <span className="inline-block h-3.5 w-16 bg-slate-100 animate-pulse rounded" />
                      ) : (
                        `Repeat: ${formatCompactIDR(revenueSources.repeatRevenue)}`
                      )}
                    </span>
                  </div>
                </div>

                {/* KPI Card 5: CLV */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8A80]">Customer Lifetime Value</span>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                      {loading ? (
                        <div className="h-7 w-24 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        formatCompactIDR(metrics.averageClv)
                      )}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between">
                    {loading ? (
                      <div className="h-4 w-12 bg-slate-200 animate-pulse rounded" />
                    ) : (
                      <div className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        metrics.clvDiff >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                      }`}>
                        {metrics.clvDiff >= 0 ? '+' : ''}{metrics.clvDiff.toFixed(1)}%
                      </div>
                    )}
                    <span className="text-[10px] font-bold text-[#6B6B63]">Avg. CLV</span>
                  </div>
                </div>
              </section>
            )
          }

          // Customer Charts Section
          if (item.id === 'customer_charts') {
            return (
              <section key={item.id} className="grid gap-4 lg:grid-cols-3">
                {/* Column 1: Customer Segmentation */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-5">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">Segmentasi Customer</h2>
                    <p className="text-[10px] text-[#6B6B63] font-bold mt-0.5">Klasifikasi berdasarkan frekuensi beli.</p>
                  </div>

                  <div className="space-y-4">
                    {/* Loyal */}
                    <div>
                      <div className="flex justify-between items-center text-xs font-bold mb-1.5">
                        <span className="text-slate-800">Loyal</span>
                        <span className="text-[#6B6B63]">{loading ? '--' : `${segments.loyal.count} (${segments.loyal.percent.toFixed(1)}%)`}</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${loading ? 0 : segments.loyal.percent}%` }} />
                      </div>
                      <p className="text-[9px] font-bold text-[#8A8A80] mt-1">Beli &ge; 2 kali</p>
                    </div>

                    {/* Aktif */}
                    <div>
                      <div className="flex justify-between items-center text-xs font-bold mb-1.5">
                        <span className="text-slate-800">Aktif</span>
                        <span className="text-[#6B6B63]">{loading ? '--' : `${segments.active.count} (${segments.active.percent.toFixed(1)}%)`}</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500 rounded-full transition-all duration-500" style={{ width: `${loading ? 0 : segments.active.percent}%` }} />
                      </div>
                      <p className="text-[9px] font-bold text-[#8A8A80] mt-1">Beli dalam 60 hari terakhir</p>
                    </div>

                    {/* Mulai Hilang */}
                    <div>
                      <div className="flex justify-between items-center text-xs font-bold mb-1.5">
                        <span className="text-slate-800">Mulai Hilang</span>
                        <span className="text-[#6B6B63]">{loading ? '--' : `${segments.warning.count} (${segments.warning.percent.toFixed(1)}%)`}</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${loading ? 0 : segments.warning.percent}%` }} />
                      </div>
                      <p className="text-[9px] font-bold text-[#8A8A80] mt-1">Beli 61 - 90 hari yang lalu</p>
                    </div>

                    {/* Hilang */}
                    <div>
                      <div className="flex justify-between items-center text-xs font-bold mb-1.5">
                        <span className="text-slate-800">Hilang</span>
                        <span className="text-[#6B6B63]">{loading ? '--' : `${segments.lost.count} (${segments.lost.percent.toFixed(1)}%)`}</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500 rounded-full transition-all duration-500" style={{ width: `${loading ? 0 : segments.lost.percent}%` }} />
                      </div>
                      <p className="text-[9px] font-bold text-[#8A8A80] mt-1">Tidak beli &gt; 90 hari</p>
                    </div>
                  </div>
                </div>

                {/* Column 2: Revenue Sources */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-5">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">Sumber Revenue</h2>
                    <p className="text-[10px] text-[#6B6B63] font-bold mt-0.5">Kontribusi Customer Baru vs Repeat Customer.</p>
                  </div>

                  <div className="flex justify-center items-center py-2">
                    {loading ? (
                      <div className="w-32 h-32 rounded-full bg-slate-100 animate-pulse flex items-center justify-center text-slate-300 text-xs">Loading...</div>
                    ) : (
                      <div className="w-32 h-32 rounded-full relative flex items-center justify-center shadow-sm" style={{
                        background: `conic-gradient(#2563eb ${revenueSources.repeatPercent}%, #06b6d4 0%)`
                      }}>
                        <div className="w-24 h-24 rounded-full bg-white flex flex-col items-center justify-center shadow-inner">
                          <span className="text-[10px] font-black uppercase text-[#8A8A80]">Total</span>
                          <span className="text-xs font-black text-slate-800 mt-0.5">{formatCompactIDR(metrics.revenue)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-[#E2E2DC] pt-3.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 inline-block" />
                        <span className="text-[10px] font-black uppercase text-slate-700">Repeat Customer</span>
                      </div>
                      <p className="text-xs font-black text-slate-900">{loading ? '--' : formatCompactIDR(revenueSources.repeatRevenue)}</p>
                      <p className="text-[9px] font-bold text-[#8A8A80]">{loading ? '--' : `${revenueSources.repeatPercent.toFixed(1)}%`}</p>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 inline-block" />
                        <span className="text-[10px] font-black uppercase text-slate-700">Customer Baru</span>
                      </div>
                      <p className="text-xs font-black text-slate-900">{loading ? '--' : formatCompactIDR(revenueSources.newRevenue)}</p>
                      <p className="text-[9px] font-bold text-[#8A8A80]">{loading ? '--' : `${revenueSources.newPercent.toFixed(1)}%`}</p>
                    </div>
                  </div>
                </div>


                {/* Column 3: Customer Health Trend */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">Customer Health Trend</h2>
                    <p className="text-[10px] text-[#6B6B63] font-bold mt-0.5">Perkembangan segmentasi pelanggan 6 bulan terakhir.</p>
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold text-[#6B6B63]">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600 inline-block" />Loyal</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 inline-block" />Aktif</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />Mulai Hilang</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />Hilang</span>
                  </div>

                  {/* Chart */}
                  {loading ? (
                    <div className="h-36 w-full bg-slate-100 animate-pulse rounded-xl" />
                  ) : healthTrendData.every(m => m.loyal + m.active + m.warning + m.lost === 0) ? (
                    <div className="h-36 w-full rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center gap-2">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                      <p className="text-[10px] font-bold text-slate-300">Belum ada data</p>
                    </div>
                  ) : (
                    <svg
                      className="w-full rounded-xl overflow-hidden"
                      style={{ height: '144px', display: 'block' }}
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <path d={healthTrendPaths.loyal}   fill="#2563eb" />
                      <path d={healthTrendPaths.active}   fill="#06b6d4" />
                      <path d={healthTrendPaths.warning}  fill="#fbbf24" />
                      <path d={healthTrendPaths.lost}     fill="#f43f5e" />
                    </svg>
                  )}

                  {/* Month labels */}
                  {!loading && (
                    <div className="flex justify-between text-[9px] font-bold text-slate-400">
                      {healthTrendData.map((m) => (
                        <span key={m.key}>{m.label}</span>
                      ))}
                    </div>
                  )}
                </div>

              </section>
            )
          }

          // Customer Details & Actions
          if (item.id === 'bottom_details') {
            return (
              <section key={item.id} className="grid gap-4 lg:grid-cols-[1.25fr_1fr_0.75fr]">
                {/* Top Pelanggan */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">Top Pelanggan (CLV)</h2>
                    <p className="text-[10px] text-[#6B6B63] font-bold mt-0.5">Pelanggan dengan kontribusi revenue tertinggi.</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E2E2DC] text-[9px] font-black uppercase tracking-wider text-[#8A8A80]">
                          <th className="pb-2">Nama</th>
                          <th className="pb-2">Orders</th>
                          <th className="pb-2 text-right">Lifetime LTV</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E2DC]/50">
                        {loading ? (
                          [...Array(5)].map((_, i) => (
                            <tr key={i}>
                              <td className="py-2.5"><div className="h-3.5 w-24 bg-slate-100 animate-pulse rounded" /></td>
                              <td className="py-2.5"><div className="h-3.5 w-8 bg-slate-100 animate-pulse rounded" /></td>
                              <td className="py-2.5 text-right"><div className="h-3.5 w-16 bg-slate-100 animate-pulse rounded ml-auto" /></td>
                            </tr>
                          ))
                        ) : (
                          topCustomers.map((cust) => (
                            <tr key={cust.customer_id} className="text-xs font-bold text-slate-700 hover:bg-[#F7F7F5]/50">
                              <td className="py-2.5 max-w-[120px] truncate">{cust.name || 'Tanpa Nama'}</td>
                              <td className="py-2.5">{cust.total_order_count}</td>
                              <td className="py-2.5 text-right text-blue-600">{formatIDR(cust.ltv)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t border-[#E2E2DC] pt-3 text-center">
                    <Link
                      href="/customers"
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1 hover:underline"
                    >
                      Lihat daftar customer
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </Link>
                  </div>
                </div>

                {/* Customer yang Perlu Diperhatikan */}
                <div className="bg-white border border-[#E2E2DC] rounded-2xl p-5 shadow-sm space-y-4">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">Customer yang Perlu Diperhatikan</h2>
                    <p className="text-[10px] text-[#6B6B63] font-bold mt-0.5">Segmen pelanggan dengan tanda-tanda churn.</p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-rose-50/50 border border-rose-100 rounded-xl">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black text-rose-800">Customer Hilang (&gt;90 hari)</p>
                        <p className="text-[10px] font-bold text-rose-600">Pelanggan tidak bertransaksi &gt; 90 hari.</p>
                      </div>
                      <span className="text-xs font-black text-rose-800 bg-rose-100/60 px-2.5 py-1 rounded-lg">
                        {loading ? '--' : attentionItems.inactive90}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-amber-50/50 border border-amber-100 rounded-xl">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black text-amber-800">Mulai Hilang (60-90 hari)</p>
                        <p className="text-[10px] font-bold text-amber-600">Pelanggan mulai masuk masa risiko.</p>
                      </div>
                      <span className="text-xs font-black text-amber-800 bg-amber-100/60 px-2.5 py-1 rounded-lg">
                        {loading ? '--' : attentionItems.inactive60_90}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-blue-50/50 border border-blue-100 rounded-xl">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black text-blue-800">Pembeli 1-Kali (One-time)</p>
                        <p className="text-[10px] font-bold text-blue-600">Pelanggan baru sekali belanja.</p>
                      </div>
                      <span className="text-xs font-black text-blue-800 bg-blue-100/60 px-2.5 py-1 rounded-lg">
                        {loading ? '--' : attentionItems.oneTimeBuyers}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-purple-50/50 border border-purple-100 rounded-xl">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black text-purple-800">High CLV Potential</p>
                        <p className="text-[10px] font-bold text-purple-600">Pelanggan dengan LTV tinggi &ge; Rp2jt.</p>
                      </div>
                      <span className="text-xs font-black text-purple-800 bg-purple-100/60 px-2.5 py-1 rounded-lg">
                        {loading ? '--' : attentionItems.highClv}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Nilai Potensi */}
                <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Nilai Potensi Hilang</span>
                    <h2 className="text-sm font-black text-slate-800">LTV Terancam (Risk Value)</h2>
                    <p className="text-xs font-semibold text-slate-600 leading-relaxed">
                      Jumlah akumulasi total spend pelanggan (LTV) yang berada pada segmen <strong>Mulai Hilang</strong> dan <strong>Hilang</strong>.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Total Potensi</p>
                    <div className="text-2xl font-black text-amber-600 tracking-tight">
                      {loading ? (
                        <div className="h-8 w-36 bg-amber-200/50 animate-pulse rounded" />
                      ) : (
                        formatIDR(potentialLoss)
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )
          }

          return null
        })}
      </div>
      )} {/* end isStaleRefresh ? skeleton : sections */}

      {/* ── PERSONALIZATION LAYOUT MODAL ────────────────────────────────────── */}
      {showLayoutModal && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-[1.5px]" onClick={() => setShowLayoutModal(false)}>
          <div className="bg-white rounded-2xl border border-[#E2E2DC] shadow-2xl p-6 w-full max-w-md mx-4 space-y-6 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start border-b border-[#E2E2DC] pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-800">Personalize Dashboard Layout</h3>
                <p className="text-[11px] text-[#6B6B63] font-medium mt-1">Sesuaikan urutan dan visibilitas dari bagian dashboard.</p>
              </div>
              <button
                onClick={() => setShowLayoutModal(false)}
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-xs font-black uppercase tracking-wider bg-slate-50 border border-[#E2E2DC] px-3 py-1.5 rounded-lg shadow-sm cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              {layout.map((item, index) => (
                <div key={item.id} className="flex items-center justify-between p-3.5 bg-slate-50 border border-[#E2E2DC]/60 rounded-xl">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.visible}
                      onChange={() => toggleSectionVisibility(item.id)}
                      className="w-4.5 h-4.5 accent-blue-600 rounded cursor-pointer"
                    />
                    <span className="text-xs font-extrabold text-slate-700">{item.title}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Move Up */}
                    <button
                      disabled={index === 0}
                      onClick={() => moveSection(index, 'up')}
                      className="p-1.5 rounded-md border border-[#E2E2DC] bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors cursor-pointer"
                      title="Geser ke atas"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="18 15 12 9 6 15"/>
                      </svg>
                    </button>
                    {/* Move Down */}
                    <button
                      disabled={index === layout.length - 1}
                      onClick={() => moveSection(index, 'down')}
                      className="p-1.5 rounded-md border border-[#E2E2DC] bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors cursor-pointer"
                      title="Geser ke bawah"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 p-3 rounded-xl">
              💡 Pengaturan layout Anda akan disimpan secara otomatis di browser (localStorage) dan tetap sama saat Anda kembali.
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
