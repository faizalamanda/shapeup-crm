"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

type OrderItem = {
  name?: string | null
  product_name?: string | null
  quantity?: number | string | null
}

type FlowOrder = {
  id: string | number
  customer_id: string | null
  order_date: string | null
  order_date_utc?: string | null
  created_at: string | null
  status: string | null
  items_json?: OrderItem[] | string | null
}

type CustomerOrder = {
  order: FlowOrder
  date: Date
  customerKey: string
  productNames: string[]
}

type ProductDestination = {
  productName: string
  customers: Set<string>
  orders: number
}

type ProductFilterOperator = 'contains' | 'is' | 'is_not'

const CACHE_KEY_PREFIX = 'su_product_retention_'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const ordersPageSize = 1000
const allowedOrderStatuses = new Set(['shipped', 'processing', 'complete', 'completed'])
const productFilterOperatorOptions: { value: ProductFilterOperator; label: string; description: string }[] = [
  { value: 'contains', label: 'Contain', description: 'mengandung' },
  { value: 'is', label: 'Is', description: 'sama persis dengan' },
  { value: 'is_not', label: 'Is Not', description: 'tidak sama dengan' },
]

const COLOR_PALETTE = [
  { border: 'border-amber-400', bg: 'bg-amber-400', text: 'text-amber-600', svgGradient: ['#fbbf24', '#f59e0b'] },
  { border: 'border-purple-500', bg: 'bg-purple-500', text: 'text-purple-600', svgGradient: ['#c084fc', '#a855f7'] },
  { border: 'border-blue-500', bg: 'bg-blue-500', text: 'text-blue-600', svgGradient: ['#60a5fa', '#3b82f6'] },
  { border: 'border-emerald-500', bg: 'bg-emerald-500', text: 'text-emerald-600', svgGradient: ['#34d399', '#10b981'] },
  { border: 'border-pink-500', bg: 'bg-pink-500', text: 'text-pink-600', svgGradient: ['#f472b6', '#ec4899'] },
  { border: 'border-indigo-500', bg: 'bg-indigo-500', text: 'text-indigo-600', svgGradient: ['#818cf8', '#6366f1'] },
]

const normalizeStatus = (status: string | null) => (
  (status || '').toLowerCase().replace(/[^a-z0-9]/g, '')
)

const isCountedOrderStatus = (status: string | null) => allowedOrderStatuses.has(normalizeStatus(status))

const getCustomerKey = (order: FlowOrder) => order.customer_id || `order-${order.id}`

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

const getOrderDate = (order: FlowOrder) => {
  const rawDate = order.order_date_utc || order.order_date || order.created_at || ''
  const date = new Date(rawDate)
  return Number.isNaN(date.getTime()) ? null : date
}

const cleanProductName = (value: string) => value.replace(/\s+/g, ' ').trim()

const getOrderProductNames = (order: FlowOrder) => {
  const items = parseArray<OrderItem>(order.items_json)
  const names = items
    .map((item) => cleanProductName(item.name || item.product_name || ''))
    .filter(Boolean)

  return Array.from(new Set(names))
}

const formatPercent = (value: number) => `${value.toFixed(1)}%`

const isFirstOrderMatchProductFilter = (
  productNames: string[],
  operator: ProductFilterOperator,
  productName: string
) => {
  const query = productName.trim().toLowerCase()
  if (!query) return true

  const normalizedProductNames = productNames.map((name) => name.toLowerCase())

  if (operator === 'is') {
    return normalizedProductNames.some((name) => name === query)
  }

  if (operator === 'is_not') {
    return normalizedProductNames.every((name) => name !== query)
  }

  return normalizedProductNames.some((name) => name.includes(query))
}

function NodeFlowChart({
  productFilterValue,
  productFilterLabel,
  flowData,
}: {
  productFilterValue: string
  productFilterLabel: string
  flowData: {
    destinations: ProductDestination[]
    cohortSize: number
    retainedCount: number
    bouncedCount: number
    retentionRate: number
    bounceRate: number
  }
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeStartRef = useRef<HTMLDivElement>(null)
  const nodeRetainedRef = useRef<HTMLDivElement>(null)
  const nodeBouncedRef = useRef<HTMLDivElement>(null)
  const nodeDestRefs = useRef<(HTMLDivElement | null)[]>([])

  const [ribbonPaths, setRibbonPaths] = useState<
    { id: string; d: string; color1: string; color2: string; opacity: number }[]
  >([])

  const updateRibbons = useCallback(() => {
    if (!containerRef.current || !nodeStartRef.current || !nodeRetainedRef.current || !nodeBouncedRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const getRect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return {
        left: r.left - containerRect.left,
        right: r.right - containerRect.left,
        top: r.top - containerRect.top,
        bottom: r.bottom - containerRect.top,
        width: r.width,
        height: r.height,
        centerY: r.top - containerRect.top + r.height / 2,
      }
    }

    const start = getRect(nodeStartRef.current)
    const retained = getRect(nodeRetainedRef.current)
    const bounced = getRect(nodeBouncedRef.current)

    const paths: { id: string; d: string; color1: string; color2: string; opacity: number }[] = []

    const makeRibbonPath = (
      x1: number,
      y1Top: number,
      y1Bot: number,
      x2: number,
      y2Top: number,
      y2Bot: number
    ) => {
      const dx = (x2 - x1) * 0.45
      return `M ${x1} ${y1Top} C ${x1 + dx} ${y1Top}, ${x2 - dx} ${y2Top}, ${x2} ${y2Top} L ${x2} ${y2Bot} C ${x2 - dx} ${y2Bot}, ${x1 + dx} ${y1Bot}, ${x1} ${y1Bot} Z`
    }

    // Ribbon 1: Start -> Retained
    const startHeight = start.height
    const retainedShare = flowData.cohortSize ? flowData.retainedCount / flowData.cohortSize : 0.5
    const startRetainedTop = start.top + (startHeight * 0.1)
    const startRetainedBot = start.top + (startHeight * (0.1 + 0.8 * retainedShare))

    paths.push({
      id: 'ribbon-start-retained',
      d: makeRibbonPath(
        start.right,
        startRetainedTop,
        startRetainedBot,
        retained.left,
        retained.top + retained.height * 0.25,
        retained.bottom - retained.height * 0.25
      ),
      color1: '#34d399',
      color2: '#10b981',
      opacity: 0.35,
    })

    // Ribbon 2: Start -> Bounced
    const startBouncedTop = startRetainedBot
    const startBouncedBot = start.top + (startHeight * 0.9)

    paths.push({
      id: 'ribbon-start-bounced',
      d: makeRibbonPath(
        start.right,
        startBouncedTop,
        startBouncedBot,
        bounced.left,
        bounced.top + bounced.height * 0.25,
        bounced.bottom - bounced.height * 0.25
      ),
      color1: '#cbd5e1',
      color2: '#94a3b8',
      opacity: 0.25,
    })

    // Ribbons 3..N: Retained -> Top Destinations
    const topDestinations = flowData.destinations.slice(0, 6)
    const retainedTotalCustomers = topDestinations.reduce((acc, curr) => acc + curr.customers.size, 0) || 1

    let destOffsetTop = retained.top + (retained.height * 0.15)
    const availableHeight = retained.height * 0.7

    topDestinations.forEach((dest, idx) => {
      const el = nodeDestRefs.current[idx]
      if (!el) return

      const destRect = getRect(el)
      const fraction = dest.customers.size / retainedTotalCustomers
      const chunkHeight = Math.max(availableHeight * fraction, 6)

      const y1Top = destOffsetTop
      const y1Bot = destOffsetTop + chunkHeight
      destOffsetTop = y1Bot

      const palette = COLOR_PALETTE[idx % COLOR_PALETTE.length]

      paths.push({
        id: `ribbon-retained-dest-${idx}`,
        d: makeRibbonPath(
          retained.right,
          y1Top,
          y1Bot,
          destRect.left,
          destRect.top + destRect.height * 0.2,
          destRect.bottom - destRect.height * 0.2
        ),
        color1: palette.svgGradient[0],
        color2: palette.svgGradient[1],
        opacity: 0.3,
      })
    })

    setRibbonPaths(paths)
  }, [flowData])

  useEffect(() => {
    updateRibbons()
    const handleResize = () => updateRibbons()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [updateRibbons])

  const topDestinations = flowData.destinations.slice(0, 6)

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-7">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 gap-2">
        <div>
          <h2 className="text-base font-black tracking-tight text-slate-900 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-indigo-600 animate-pulse" />
            Alur Pembelian (Product Flow Retention)
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Visualisasi alur customer dari order pertama hingga produk yang dibeli pada order berikutnya.
          </p>
        </div>
        <div className="text-xs font-bold text-slate-400 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full self-start sm:self-auto">
          Cohort Total: <span className="text-slate-900 font-black">{flowData.cohortSize} customer</span>
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-[380px] w-full">
        {/* SVG Ribbon Layer */}
        <svg className="absolute inset-0 pointer-events-none hidden md:block w-full h-full z-0 overflow-visible">
          <defs>
            {ribbonPaths.map((p) => (
              <linearGradient key={`grad-${p.id}`} id={`grad-${p.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={p.color1} stopOpacity={p.opacity} />
                <stop offset="100%" stopColor={p.color2} stopOpacity={p.opacity} />
              </linearGradient>
            ))}
          </defs>
          {ribbonPaths.map((p) => (
            <path key={p.id} d={p.d} fill={`url(#grad-${p.id})`} />
          ))}
        </svg>

        {/* 3 Tier Node Cards */}
        <div className="relative z-10 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8 items-stretch">
          {/* Column 1: Start Product */}
          <div className="flex flex-col justify-center">
            <div
              ref={nodeStartRef}
              className="group relative rounded-xl border-2 border-indigo-600 bg-white p-5 shadow-lg shadow-indigo-100 transition-all hover:shadow-indigo-200"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  Total Cohort
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 cursor-help" title="Total customer pada order pertama dengan filter produk ini">?</span>
                </span>
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-extrabold text-indigo-700">
                  Step 1
                </span>
              </div>
              <div className="mt-3">
                <p className="text-4xl font-black tracking-tight text-slate-900">{flowData.cohortSize}</p>
                <p className="mt-1 text-xs font-bold text-slate-600 truncate">
                  {productFilterValue ? `Produk: "${productFilterValue}"` : 'Semua Produk First Order'}
                </p>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-2 text-[11px] font-medium text-slate-400 truncate">
                {productFilterLabel}
              </div>
            </div>
          </div>

          {/* Column 2: Retention Outcomes */}
          <div className="flex flex-col justify-center gap-5">
            {/* Delivered / Retained */}
            <div
              ref={nodeRetainedRef}
              className="relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  Delivered / Beli Lagi
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 cursor-help" title="Customer yang melakukan pembelian berikutnya">?</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="text-3xl font-black text-slate-900">{flowData.retainedCount}</p>
                <p className="text-sm font-black text-emerald-600">{formatPercent(flowData.retentionRate)}</p>
              </div>
              {/* Bottom Progress Bar */}
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${flowData.retentionRate}%` }}
                />
              </div>
            </div>

            {/* Failed / Drop */}
            <div
              ref={nodeBouncedRef}
              className="relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-rose-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  Failed / Belum Beli Lagi
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 cursor-help" title="Customer yang belum ada order ke-2">?</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="text-3xl font-black text-slate-900">{flowData.bouncedCount}</p>
                <p className="text-sm font-black text-rose-500">{formatPercent(flowData.bounceRate)}</p>
              </div>
              {/* Bottom Progress Bar */}
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-300 transition-all duration-500"
                  style={{ width: `${flowData.bounceRate}%` }}
                />
              </div>
            </div>
          </div>

          {/* Column 3: Next Purchased Products */}
          <div className="flex flex-col justify-center gap-3">
            {topDestinations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs font-bold text-slate-400">
                Belum ada order berikutnya untuk cohort ini.
              </div>
            ) : (
              topDestinations.map((destination, idx) => {
                const count = destination.customers.size
                const rate = flowData.cohortSize ? (count / flowData.cohortSize) * 100 : 0
                const palette = COLOR_PALETTE[idx % COLOR_PALETTE.length]

                return (
                  <div
                    key={destination.productName}
                    ref={(el) => {
                      nodeDestRefs.current[idx] = el
                    }}
                    className="relative rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-900 truncate" title={destination.productName}>
                          {destination.productName}
                        </p>
                      </div>
                      <div className="text-right flex items-baseline gap-1.5 flex-shrink-0">
                        <span className="text-sm font-black text-slate-900">{count}</span>
                        <span className={`text-xs font-extrabold ${palette.text}`}>
                          {formatPercent(rate)}
                        </span>
                      </div>
                    </div>
                    {/* Bottom Progress Bar */}
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${palette.bg} transition-all duration-500`}
                        style={{ width: `${Math.min(rate, 100)}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type RpcDestination = {
  productName: string
  customersCount: number
  ordersCount: number
}

type RpcRetentionResult = {
  cohortSize: number
  retainedCount: number
  bouncedCount: number
  destinations: RpcDestination[]
}

export default function ProductRetentionPage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [orders, setOrders] = useState<FlowOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [productFilterOperator, setProductFilterOperator] = useState<ProductFilterOperator>('contains')
  const [productFilterValue, setProductFilterValue] = useState('')
  const [serverFlowData, setServerFlowData] = useState<RpcRetentionResult | null>(null)
  const [isUsingRpc, setIsUsingRpc] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchOrders = useCallback(async () => {
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

      // 1. Try PostgreSQL RPC Function for High-Scale Server-Side Processing
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_product_retention_flow', {
          p_business_id: businessId,
          p_product_filter: productFilterValue,
          p_operator: productFilterOperator,
        })

        if (!rpcError && rpcData && typeof rpcData === 'object') {
          setServerFlowData(rpcData as RpcRetentionResult)
          setIsUsingRpc(true)
          setLoading(false)

          // Also fetch list asynchronously for top product suggestions list
          if (orders.length === 0) {
            const { data: firstPage } = await supabase
              .from('orders')
              .select('id, customer_id, order_date, order_date_utc, created_at, status, items_json')
              .eq('business_id', businessId)
              .in('status', ['shipped', 'processing', 'complete', 'completed', 'Shipped', 'Processing', 'Complete', 'Completed'])
              .order('order_date', { ascending: true })
              .range(0, 999)

            if (firstPage) setOrders(firstPage as FlowOrder[])
          }
          return
        }
      } catch {
        // Fallback to client-side processing if RPC is not deployed yet
      }

      setIsUsingRpc(false)
      const cacheKey = `${CACHE_KEY_PREFIX}${businessId}`

      // Check sessionStorage cache first for immediate render
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          if (Date.now() - parsed.timestamp < CACHE_TTL_MS && Array.isArray(parsed.orders)) {
            setOrders(parsed.orders)
            setLoading(false)
          }
        } catch {
          // Ignore cache parse error
        }
      }

      // Fetch from DB for client-side processing
      const allOrders: FlowOrder[] = []
      let from = 0

      while (true) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, customer_id, order_date, order_date_utc, created_at, status, items_json')
          .eq('business_id', businessId)
          .in('status', ['shipped', 'processing', 'complete', 'completed', 'Shipped', 'Processing', 'Complete', 'Completed'])
          .order('order_date', { ascending: true })
          .range(from, from + ordersPageSize - 1)

        if (error) throw error

        allOrders.push(...((data || []) as FlowOrder[]))
        if (!data || data.length < ordersPageSize) break
        from += ordersPageSize
      }

      setOrders(allOrders)

      // Save to sessionStorage cache
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            orders: allOrders,
            timestamp: Date.now(),
            businessId,
          })
        )
      } catch {
        // Ignore cache storage overflow
      }
    } catch (error) {
      console.error('Error fetching product retention:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase, productFilterValue, productFilterOperator, orders.length])

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
        .channel(`product-retention-orders-${profile.active_business_id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `business_id=eq.${profile.active_business_id}`,
          },
          () => {
            fetchOrders()
          }
        )
        .subscribe()
    }

    fetchOrders()
    subscribeToOrderChanges()

    return () => {
      isMounted = false
      if (ordersChannel) {
        supabase.removeChannel(ordersChannel)
      }
    }
  }, [fetchOrders, supabase])

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

  const ordersByCustomer = useMemo(() => {
    const grouped = new Map<string, CustomerOrder[]>()

    orders
      .filter((order) => isCountedOrderStatus(order.status))
      .map((order) => ({
        order,
        date: getOrderDate(order),
        customerKey: getCustomerKey(order),
        productNames: getOrderProductNames(order),
      }))
      .filter((item): item is CustomerOrder => Boolean(item.date && item.customerKey && item.productNames.length > 0))
      .sort((a, b) => {
        const dateDiff = a.date.getTime() - b.date.getTime()
        if (dateDiff !== 0) return dateDiff
        return String(a.order.id).localeCompare(String(b.order.id))
      })
      .forEach((item) => {
        const list = grouped.get(item.customerKey) || []
        list.push(item)
        grouped.set(item.customerKey, list)
      })

    return grouped
  }, [orders])

  const firstProductOptions = useMemo(() => {
    const productCounts = new Map<string, number>()

    ordersByCustomer.forEach((customerOrders) => {
      const firstOrder = customerOrders[0]
      firstOrder?.productNames.forEach((name) => {
        productCounts.set(name, (productCounts.get(name) || 0) + 1)
      })
    })

    return Array.from(productCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [ordersByCustomer])

  const filteredProductSuggestions = useMemo(() => {
    const query = productFilterValue.trim().toLowerCase()
    if (!query) return firstProductOptions.slice(0, 15)
    return firstProductOptions
      .filter((p) => p.name.toLowerCase().includes(query))
      .slice(0, 15)
  }, [firstProductOptions, productFilterValue])

  const productFilterLabel = useMemo(() => {
    const operator = productFilterOperatorOptions.find((item) => item.value === productFilterOperator)
    const value = productFilterValue.trim()

    if (!value) return 'Menampilkan semua customer berdasarkan produk first order.'
    return `First order ${operator?.description || 'mengandung'} "${value}".`
  }, [productFilterOperator, productFilterValue])

  const flowData = useMemo(() => {
    if (isUsingRpc && serverFlowData) {
      const cohortSize = serverFlowData.cohortSize || 0
      const retainedCount = serverFlowData.retainedCount || 0
      const bouncedCount = serverFlowData.bouncedCount || 0
      const destList = (serverFlowData.destinations || []).map((d) => ({
        productName: d.productName,
        customers: new Set<string>(Array.from({ length: d.customersCount }, (_, i) => `rpc-${d.productName}-${i}`)),
        orders: d.ordersCount,
      }))

      return {
        destinations: destList,
        cohortSize,
        retainedCount,
        bouncedCount,
        retentionRate: cohortSize ? (retainedCount / cohortSize) * 100 : 0,
        bounceRate: cohortSize ? (bouncedCount / cohortSize) * 100 : 0,
      }
    }

    const destinations = new Map<string, ProductDestination>()
    const cohortCustomerIds = new Set<string>()
    const retainedCustomerIds = new Set<string>()
    const bouncedCustomerIds = new Set<string>()

    if (ordersByCustomer.size === 0) {
      return {
        destinations: [] as ProductDestination[],
        cohortSize: 0,
        retainedCount: 0,
        bouncedCount: 0,
        retentionRate: 0,
        bounceRate: 0,
      }
    }

    ordersByCustomer.forEach((customerOrders, customerKey) => {
      const firstOrder = customerOrders[0]
      if (!firstOrder || !isFirstOrderMatchProductFilter(firstOrder.productNames, productFilterOperator, productFilterValue)) return

      cohortCustomerIds.add(customerKey)
      const nextOrder = customerOrders[1]

      if (!nextOrder) {
        bouncedCustomerIds.add(customerKey)
        return
      }

      retainedCustomerIds.add(customerKey)

      nextOrder.productNames.forEach((productName) => {
        const destination = destinations.get(productName) || {
          productName,
          customers: new Set<string>(),
          orders: 0,
        }

        destination.customers.add(customerKey)
        destination.orders += 1
        destinations.set(productName, destination)
      })
    })

    const cohortSize = cohortCustomerIds.size
    const retainedCount = retainedCustomerIds.size
    const bouncedCount = bouncedCustomerIds.size

    return {
      destinations: Array.from(destinations.values())
        .sort((a, b) => b.customers.size - a.customers.size || a.productName.localeCompare(b.productName)),
      cohortSize,
      retainedCount,
      bouncedCount,
      retentionRate: cohortSize ? (retainedCount / cohortSize) * 100 : 0,
      bounceRate: cohortSize ? (bouncedCount / cohortSize) * 100 : 0,
    }
  }, [isUsingRpc, serverFlowData, ordersByCustomer, productFilterOperator, productFilterValue])

  const [destinationDisplayLimit, setDestinationDisplayLimit] = useState(10)

  // Reset list display limit when filter changes
  useEffect(() => {
    setDestinationDisplayLimit(10)
  }, [productFilterValue, productFilterOperator])

  const maxDestinationCount = Math.max(...flowData.destinations.map((item) => item.customers.size), 1)
  const visibleDestinations = flowData.destinations.slice(0, destinationDisplayLimit)

  return (
    <div className="space-y-8 text-slate-900">
      <div className="max-w-[1400px] mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-blue-600 border border-blue-100">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <polyline points="16 11 18 13 22 9"/>
              </svg>
              Product Flow Retention
            </div>
            <h1 className="mt-2.5 text-3xl font-black tracking-tight text-slate-900">
              Retention Berdasarkan Produk Pertama
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm font-medium leading-6 text-slate-500">
              Analisis perilaku customer yang membeli produk tertentu pada order pertama (first order), serta melacak produk apa yang paling sering dibeli di order berikutnya.
            </p>
          </div>

          {/* Product Filter Control */}
          <div className="flex flex-col gap-2.5 w-full lg:max-w-xl">
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[150px_1fr] items-start">
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Operator</span>
                <select
                  value={productFilterOperator}
                  onChange={(event) => setProductFilterOperator(event.target.value as ProductFilterOperator)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
                >
                  {productFilterOperatorOptions.map((operator) => (
                    <option key={operator.value} value={operator.value}>{operator.label}</option>
                  ))}
                </select>
              </label>

              <div ref={dropdownRef} className="space-y-1.5 relative">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cari Produk First Order</span>
                  {productFilterValue && (
                    <button
                      type="button"
                      onClick={() => {
                        setProductFilterValue('')
                        setIsDropdownOpen(true)
                      }}
                      className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Reset Pilihan
                    </button>
                  )}
                </div>
                <div className="relative flex items-center">
                  <svg
                    className="absolute left-3 text-slate-400 pointer-events-none"
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
                    value={productFilterValue}
                    onFocus={() => setIsDropdownOpen(true)}
                    onChange={(event) => {
                      setProductFilterValue(event.target.value)
                      setIsDropdownOpen(true)
                    }}
                    placeholder="Ketik produk atau pilih..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 py-2 text-xs font-bold text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:font-normal placeholder:text-slate-400"
                  />
                  {productFilterValue && (
                    <button
                      type="button"
                      onClick={() => {
                        setProductFilterValue('')
                        setIsDropdownOpen(false)
                      }}
                      className="absolute right-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold h-5 w-5 rounded-full flex items-center justify-center bg-slate-200/60 hover:bg-slate-300 transition-colors"
                      title="Reset Pilihan Produk"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Custom Popover Dropdown List - Positioned strictly below the field with max height limit */}
                {isDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-50 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-300/40 space-y-0.5">
                    {filteredProductSuggestions.length === 0 ? (
                      <div className="px-3 py-2 text-center text-xs font-medium text-slate-400">
                        Produk tidak ditemukan
                      </div>
                    ) : (
                      filteredProductSuggestions.map((prod) => (
                        <button
                          key={prod.name}
                          type="button"
                          onClick={() => {
                            setProductFilterValue(prod.name)
                            setIsDropdownOpen(false)
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left rounded-lg text-xs font-bold transition-all ${
                            productFilterValue === prod.name
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          <span className="truncate min-w-0 flex-1">{prod.name}</span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                            {prod.count} customer
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Filter Status Tooltip Banner Placed Below Search Inputs */}
            <div className="rounded-xl border border-slate-200/70 bg-slate-100/80 px-3.5 py-2.5 text-xs font-bold text-slate-600 flex items-center justify-between gap-2 shadow-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-[11px]">
                  ℹ️
                </span>
                <span className="truncate">
                  Filter Aktif: <strong className="text-slate-900 font-extrabold">{productFilterLabel}</strong>
                </span>
              </div>
              {productFilterValue && (
                <button
                  type="button"
                  onClick={() => setProductFilterValue('')}
                  className="shrink-0 text-[11px] font-black text-blue-600 hover:text-blue-800 hover:underline bg-white border border-blue-200 px-2.5 py-0.5 rounded-full shadow-xs"
                >
                  Tampilkan Semua
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Start Guide Highlight / Quick Selection Pills */}
        {!productFilterValue && firstProductOptions.length > 0 && (
          <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/90 via-blue-50/50 to-white p-5 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-200">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Mulai Analisis Product Retention</h3>
                  <p className="text-xs font-medium text-slate-600 mt-0.5">
                    Pilih salah satu produk terlaris di bawah ini untuk melihat alur produk yang paling sering dibeli selanjutnya oleh customer Anda:
                  </p>
                </div>
              </div>

              {/* Quick Pick Tag Pills */}
              <div className="flex flex-wrap items-center gap-2">
                {firstProductOptions.slice(0, 5).map((prod) => (
                  <button
                    key={prod.name}
                    onClick={() => setProductFilterValue(prod.name)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-bold text-indigo-700 shadow-sm transition-all hover:border-indigo-500 hover:bg-indigo-600 hover:text-white"
                  >
                    <span>{prod.name}</span>
                    <span className="rounded-full bg-indigo-100 px-1.5 py-0.2 text-[10px] font-black text-indigo-800">
                      {prod.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent mb-3" />
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Menghitung data retention...
            </p>
          </div>
        ) : (
          <>
            {/* Top Stat Cards */}
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Match Filter Cohort</p>
                <p className="mt-2 text-3xl font-black text-slate-900">{flowData.cohortSize}</p>
                <p className="mt-1 text-xs font-bold text-slate-400 truncate">{productFilterLabel}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Beli Lagi (Retained)</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-3xl font-black text-emerald-600">{flowData.retainedCount}</p>
                  <p className="text-lg font-black text-emerald-600">{formatPercent(flowData.retentionRate)}</p>
                </div>
                <p className="mt-1 text-xs font-bold text-slate-400">Melakukan order ke-2 atau lebih</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Belum Beli Lagi (Drop)</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-3xl font-black text-rose-500">{flowData.bouncedCount}</p>
                  <p className="text-lg font-black text-rose-500">{formatPercent(flowData.bounceRate)}</p>
                </div>
                <p className="mt-1 text-xs font-bold text-slate-400">Customer yang hanya beli 1x</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tujuan Produk berikutnya</p>
                <p className="mt-2 text-3xl font-black text-indigo-600">{flowData.destinations.length}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">Variasi produk yang dibeli</p>
              </div>
            </section>

            {/* Visual Node Flow Diagram */}
            <section>
              <NodeFlowChart
                productFilterValue={productFilterValue}
                productFilterLabel={productFilterLabel}
                flowData={flowData}
              />
            </section>

            {/* Detailed Products Breakdown Table / List */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 p-5 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-900">Detail Tujuan Produk Pembelian Berikutnya</h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    Daftar lengkap produk yang dibeli pada order ke-2 beserta rasio dari total cohort customer.
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-400 bg-white border border-slate-200 px-3 py-1 rounded-full">
                  Menampilkan {visibleDestinations.length} dari {flowData.destinations.length} Produk
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {flowData.destinations.length === 0 ? (
                  <div className="p-10 text-center text-xs font-bold text-slate-400">
                    Belum ada data pembelian berikutnya untuk produk ini.
                  </div>
                ) : (
                  visibleDestinations.map((destination, idx) => {
                    const count = destination.customers.size
                    const rate = flowData.cohortSize ? (count / flowData.cohortSize) * 100 : 0
                    const barWidth = Math.max((count / maxDestinationCount) * 100, 3)
                    const palette = COLOR_PALETTE[idx % COLOR_PALETTE.length]

                    return (
                      <div key={destination.productName} className="p-4 hover:bg-slate-50/80 transition-colors">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${palette.bg} text-[10px] font-black text-white`}>
                              #{idx + 1}
                            </span>
                            <div>
                              <p className="text-sm font-extrabold text-slate-900">{destination.productName}</p>
                              <p className="text-[11px] font-medium text-slate-400">
                                {count} customer ({destination.orders} item terpesan)
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 self-end sm:self-auto">
                            <div className="text-right">
                              <p className={`text-base font-black ${palette.text}`}>{formatPercent(rate)}</p>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">dari cohort</p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${palette.bg} transition-all duration-500`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Load More / Show Less Button Footer */}
              {flowData.destinations.length > 10 && (
                <div className="border-t border-slate-100 bg-slate-50/40 p-4 text-center">
                  {destinationDisplayLimit < flowData.destinations.length ? (
                    <button
                      type="button"
                      onClick={() => setDestinationDisplayLimit((prev) => prev + 10)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-black text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900"
                    >
                      <span>Tampilkan Lebih Banyak ({flowData.destinations.length - destinationDisplayLimit} Produk Lagi)</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDestinationDisplayLimit(10)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2 text-xs font-bold text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-800"
                    >
                      <span>Ciutkan (Tampilkan 10 Utama)</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="18 15 12 9 6 15"/>
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

