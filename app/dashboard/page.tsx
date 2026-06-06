"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

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
}

type ProductMetric = {
  name: string
  category: string
  orders: number
  qty: number
  revenue: number
  averagePrice: number
}

type MonthMetric = {
  key: string
  label: string
  revenue: number
  orders: number
}

type ProductSegmentOperator = 'contains' | 'is' | 'is_not'

const ordersPageSize = 1000
const countedStatuses = new Set(['shipped', 'processing', 'complete', 'completed'])
const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const palette = ['#2563eb', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']
const productSegmentOperatorOptions: { value: ProductSegmentOperator; label: string }[] = [
  { value: 'contains', label: 'Contain' },
  { value: 'is', label: 'Is' },
  { value: 'is_not', label: 'Is Not' },
]
const provinceNamesByCode: Record<string, string> = {
  AC: 'Aceh',
  SU: 'Sumatera Utara',
  SB: 'Sumatera Barat',
  RI: 'Riau',
  KR: 'Kepulauan Riau',
  JA: 'Jambi',
  SS: 'Sumatera Selatan',
  BB: 'Bangka Belitung',
  BE: 'Bengkulu',
  LA: 'Lampung',
  JK: 'DKI Jakarta',
  JB: 'Jawa Barat',
  BT: 'Banten',
  JT: 'Jawa Tengah',
  YO: 'DI Yogyakarta',
  JI: 'Jawa Timur',
  BA: 'Bali',
  NB: 'Nusa Tenggara Barat',
  NT: 'Nusa Tenggara Timur',
  KB: 'Kalimantan Barat',
  KT: 'Kalimantan Tengah',
  KI: 'Kalimantan Timur',
  KS: 'Kalimantan Selatan',
  KU: 'Kalimantan Utara',
  SA: 'Sulawesi Utara',
  ST: 'Sulawesi Tengah',
  SG: 'Sulawesi Tenggara',
  SR: 'Sulawesi Barat',
  SN: 'Sulawesi Selatan',
  GO: 'Gorontalo',
  MA: 'Maluku',
  MU: 'Maluku Utara',
  PA: 'Papua',
  PB: 'Papua Barat',
  PE: 'Papua Pegunungan',
  PS: 'Papua Selatan',
  PT: 'Papua Tengah',
  PD: 'Papua Barat Daya',
}

const normalizeStatus = (status?: string | null) => (
  (status || '').toLowerCase().replace(/[^a-z0-9]/g, '')
)

const isCountedOrderStatus = (status?: string | null) => countedStatuses.has(normalizeStatus(status))

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

const cleanText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeProvinceName = (value: unknown) => {
  const province = cleanText(value)
  if (!province) return ''

  const normalizedCode = province.toUpperCase().replace(/^ID[-_]/, '').replace(/[^A-Z]/g, '')
  const mappedProvince = provinceNamesByCode[normalizedCode]
  if (mappedProvince) return mappedProvince

  if (province.length <= 3 && /^[A-Za-z-_\s]+$/.test(province)) return ''

  return province
}

const getOrderDate = (order: SalesOrder) => {
  const rawDate = order.order_date_utc || order.order_date || order.created_at || ''
  const date = new Date(rawDate)
  return Number.isNaN(date.getTime()) ? null : date
}

const getDateFromRaw = (raw: RawRecord, keys: string[]) => {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) {
      const date = new Date(value.endsWith('Z') || value.includes('+') ? value : value.replace(' ', 'T'))
      if (!Number.isNaN(date.getTime())) return date
    }
  }

  return null
}

const getShippedDate = (order: SalesOrder) => {
  const raw = parseRecord(order.raw_source_data)
  const directDate = getDateFromRaw(raw, [
    'date_shipped_gmt',
    'date_shipped',
    'shipped_at',
    'date_completed_gmt',
    'date_completed',
    'completed_at',
  ])

  if (directDate) return directDate

  const metaData = parseArray<RawRecord>(raw.meta_data)
  const shippedMeta = metaData.find((item) => {
    const key = String(item.key || '').toLowerCase()
    return key.includes('shipped') || key.includes('shipment') || key.includes('completed')
  })

  return shippedMeta ? getDateFromRaw({ value: shippedMeta.value }, ['value']) : null
}

const getLocation = (order: SalesOrder) => {
  const raw = parseRecord(order.raw_source_data)
  const billing = parseRecord(raw.billing)
  const shipping = parseRecord(raw.shipping)

  return {
    city: cleanText(shipping.city || billing.city) || 'Tanpa Kota',
    province: normalizeProvinceName(shipping.state || billing.state || shipping.province || billing.province) || 'Tanpa Provinsi',
  }
}

const getItemCategory = (item: OrderItem) => {
  if (item.category) return cleanText(item.category)

  const categories = parseArray<string | { name?: string | null }>(item.categories)
  const firstCategory = categories
    .map((category) => typeof category === 'string' ? category : category.name)
    .find(Boolean)

  if (firstCategory) return cleanText(firstCategory)
  if (item.sku) return cleanText(item.sku).split('-')[0] || 'Tanpa Kategori'

  return 'Tanpa Kategori'
}

const getOrderItems = (order: SalesOrder) => {
  const raw = parseRecord(order.raw_source_data)
  const items = parseArray<OrderItem>(order.items_json)
  const rawItems = parseArray<OrderItem>(raw.line_items)

  return (items.length > 0 ? items : rawItems)
    .map((item) => {
      const name = cleanText(item.name || item.product_name)
      const qty = Math.max(toNumber(item.quantity), 1)
      const revenue = toNumber(item.subtotal || item.total || item.price)
      const averagePrice = toNumber(item.price) || (qty > 0 ? revenue / qty : 0)

      return {
        name,
        category: getItemCategory(item),
        qty,
        revenue,
        averagePrice,
      }
    })
    .filter((item) => item.name)
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

const getMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

const getMonthLabel = (key: string) => {
  const [year, month] = key.split('-')
  return `${monthLabels[Number(month) - 1]} ${year.slice(2)}`
}

const getMonthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1)

const parseDateInput = (value: string) => {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

const buildMonthRange = (orders: { orderDate: Date | null }[], startDate: string, endDate: string) => {
  const parsedStartDate = parseDateInput(startDate)
  const parsedEndDate = parseDateInput(endDate)
  let startMonth: Date
  let endMonth: Date

  if (parsedStartDate && parsedEndDate) {
    startMonth = getMonthStart(parsedStartDate)
    endMonth = getMonthStart(parsedEndDate)
  } else if (parsedStartDate || parsedEndDate) {
    const selectedDate = parsedStartDate || parsedEndDate || new Date()
    startMonth = getMonthStart(selectedDate)
    endMonth = getMonthStart(selectedDate)
  } else {
    const latestOrderDate = orders
      .map((order) => order.orderDate)
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0] || new Date()

    endMonth = getMonthStart(latestOrderDate)
    startMonth = new Date(endMonth.getFullYear(), endMonth.getMonth() - 11, 1)
  }

  if (startMonth.getTime() > endMonth.getTime()) {
    const previousStart = startMonth
    startMonth = endMonth
    endMonth = previousStart
  }

  const months: MonthMetric[] = []
  const cursor = new Date(startMonth)

  while (cursor.getTime() <= endMonth.getTime()) {
    const key = getMonthKey(cursor)
    months.push({ key, label: getMonthLabel(key), revenue: 0, orders: 0 })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return months
}

const getPercent = (value: number, total: number) => total > 0 ? (value / total) * 100 : 0

const buildSvgLinePath = (points: { x: number; y: number }[]) => {
  if (points.length === 0) return ''
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

const isProductMatchSegment = (productName: string, operator: ProductSegmentOperator, value: string) => {
  const query = value.trim().toLowerCase()
  if (!query) return true

  const normalizedProductName = productName.toLowerCase()

  if (operator === 'is') return normalizedProductName === query
  if (operator === 'is_not') return normalizedProductName !== query

  return normalizedProductName.includes(query)
}

const isOrderMatchProductSegment = (
  productNames: string[],
  operator: ProductSegmentOperator,
  value: string
) => {
  const query = value.trim()
  if (!query) return true

  if (operator === 'is_not') {
    return productNames.every((name) => isProductMatchSegment(name, operator, query))
  }

  return productNames.some((name) => isProductMatchSegment(name, operator, query))
}

export default function DashboardPage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [businessName, setBusinessName] = useState('')
  const [productSegmentOperator, setProductSegmentOperator] = useState<ProductSegmentOperator>('contains')
  const [productSegment, setProductSegment] = useState('')
  const [cityFilter, setCityFilter] = useState('all')
  const [provinceFilter, setProvinceFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [topMode, setTopMode] = useState<'product' | 'category'>('product')

  const fetchOrders = useCallback(async () => {
    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id, businesses!active_business_id(name)')
        .eq('id', user.id)
        .single()

      if (!profile?.active_business_id) return

      const business = profile.businesses as { name?: string } | null
      setBusinessName(business?.name || '')

      const allOrders: SalesOrder[] = []
      let from = 0

      while (true) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, order_date, order_date_utc, created_at, status, total_qty, subtotal, grand_total, items_json, raw_source_data')
          .eq('business_id', profile.active_business_id)
          .order('order_date', { ascending: true })
          .range(from, from + ordersPageSize - 1)

        if (error) throw error

        allOrders.push(...((data || []) as SalesOrder[]))
        if (!data || data.length < ordersPageSize) break
        from += ordersPageSize
      }

      setOrders(allOrders)
    } catch (error) {
      console.error('Error fetching sales dashboard:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase])

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
        .channel(`sales-dashboard-orders-${profile.active_business_id}`)
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

  const enrichedOrders = useMemo(() => orders
    .filter((order) => isCountedOrderStatus(order.status))
    .map((order) => {
      const orderDate = getOrderDate(order)
      const shippedDate = getShippedDate(order)
      const location = getLocation(order)
      const items = getOrderItems(order)

      return {
        ...order,
        orderDate,
        shippedDate,
        location,
        items,
      }
    })
    .filter((order) => Boolean(order.orderDate)), [orders])

  const filterOptions = useMemo(() => {
    const products = new Set<string>()
    const cities = new Set<string>()
    const provinces = new Set<string>()

    enrichedOrders.forEach((order) => {
      cities.add(order.location.city)
      provinces.add(order.location.province)
      order.items.forEach((item) => products.add(item.name))
    })

    return {
      products: Array.from(products).sort((a, b) => a.localeCompare(b)),
      cities: Array.from(cities).sort((a, b) => a.localeCompare(b)),
      provinces: Array.from(provinces).sort((a, b) => a.localeCompare(b)),
    }
  }, [enrichedOrders])

  const filteredOrders = useMemo(() => enrichedOrders.filter((order) => {
    if (!order.orderDate) return false

    const orderDateKey = order.orderDate.toISOString().slice(0, 10)
    const matchProduct = isOrderMatchProductSegment(order.items.map((item) => item.name), productSegmentOperator, productSegment)
    const matchCity = cityFilter === 'all' || order.location.city === cityFilter
    const matchProvince = provinceFilter === 'all' || order.location.province === provinceFilter
    const matchStart = !startDate || orderDateKey >= startDate
    const matchEnd = !endDate || orderDateKey <= endDate

    return matchProduct && matchCity && matchProvince && matchStart && matchEnd
  }), [cityFilter, endDate, enrichedOrders, productSegment, productSegmentOperator, provinceFilter, startDate])

  const productMetrics = useMemo(() => {
    const metrics = new Map<string, ProductMetric>()

    filteredOrders.forEach((order) => {
      const orderProducts = new Set<string>()

      order.items.forEach((item) => {
        const metric = metrics.get(item.name) || {
          name: item.name,
          category: item.category,
          orders: 0,
          qty: 0,
          revenue: 0,
          averagePrice: 0,
        }

        metric.qty += item.qty
        metric.revenue += item.revenue
        if (!orderProducts.has(item.name)) {
          metric.orders += 1
          orderProducts.add(item.name)
        }
        metric.averagePrice = metric.qty > 0 ? metric.revenue / metric.qty : 0

        metrics.set(item.name, metric)
      })
    })

    return Array.from(metrics.values()).sort((a, b) => b.revenue - a.revenue)
  }, [filteredOrders])

  const categoryMetrics = useMemo(() => {
    const metrics = new Map<string, ProductMetric>()

    productMetrics.forEach((product) => {
      const metric = metrics.get(product.category) || {
        name: product.category,
        category: product.category,
        orders: 0,
        qty: 0,
        revenue: 0,
        averagePrice: 0,
      }

      metric.orders += product.orders
      metric.qty += product.qty
      metric.revenue += product.revenue
      metric.averagePrice = metric.qty > 0 ? metric.revenue / metric.qty : 0
      metrics.set(product.category, metric)
    })

    return Array.from(metrics.values()).sort((a, b) => b.revenue - a.revenue)
  }, [productMetrics])

  const trendData = useMemo(() => {
    const months = new Map<string, MonthMetric>()

    filteredOrders.forEach((order) => {
      if (!order.orderDate) return
      const key = getMonthKey(order.orderDate)
      const metric = months.get(key) || { key, label: getMonthLabel(key), revenue: 0, orders: 0 }

      metric.revenue += toNumber(order.grand_total)
      metric.orders += 1
      months.set(key, metric)
    })

    return Array.from(months.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-12)
  }, [filteredOrders])

  const cityRevenue = useMemo(() => {
    const cities = new Map<string, { city: string; province: string; revenue: number; orders: number }>()

    filteredOrders.forEach((order) => {
      const metric = cities.get(order.location.city) || {
        city: order.location.city,
        province: order.location.province,
        revenue: 0,
        orders: 0,
      }

      metric.revenue += toNumber(order.grand_total)
      metric.orders += 1
      cities.set(order.location.city, metric)
    })

    return Array.from(cities.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  }, [filteredOrders])

  const weekdayData = useMemo(() => {
    const weekday = { orders: 0, revenue: 0 }
    const weekend = { orders: 0, revenue: 0 }

    filteredOrders.forEach((order) => {
      if (!order.orderDate) return
      const day = order.orderDate.getDay()
      const destination = day === 0 || day === 6 ? weekend : weekday
      destination.orders += 1
      destination.revenue += toNumber(order.grand_total)
    })

    return { weekday, weekend }
  }, [filteredOrders])

  const selectedProductMetrics = useMemo(() => {
    const matchedProducts = productSegment.trim()
      ? productMetrics.filter((product) => isProductMatchSegment(product.name, productSegmentOperator, productSegment))
      : productMetrics

    return matchedProducts.slice(0, 3)
  }, [productMetrics, productSegment, productSegmentOperator])

  const seasonalData = useMemo(() => {
    const monthRange = buildMonthRange(filteredOrders, startDate, endDate)

    return selectedProductMetrics.map((product) => {
      const months = new Map(monthRange.map((month) => [month.key, { ...month }]))

      filteredOrders.forEach((order) => {
        if (!order.orderDate) return

        const matchingItems = order.items.filter((item) => item.name === product.name)
        if (matchingItems.length === 0) return

        const key = getMonthKey(order.orderDate)
        const metric = months.get(key)
        if (!metric) return

        metric.revenue += matchingItems.reduce((total, item) => total + item.revenue, 0)
        metric.orders += 1
      })

      return {
        product,
        months: Array.from(months.values()).sort((a, b) => a.key.localeCompare(b.key)),
      }
    })
  }, [endDate, filteredOrders, selectedProductMetrics, startDate])

  const deliveryDistribution = useMemo(() => {
    const buckets = [
      { label: '0-2 hari', min: 0, max: 2, color: '#10b981', orders: 0 },
      { label: '3-6 hari', min: 3, max: 6, color: '#06b6d4', orders: 0 },
      { label: '7-14 hari', min: 7, max: 14, color: '#f59e0b', orders: 0 },
      { label: '>14 hari', min: 15, max: Infinity, color: '#ef4444', orders: 0 },
    ]

    filteredOrders.forEach((order) => {
      if (!order.orderDate || !order.shippedDate) return
      const days = Math.max(0, Math.ceil((order.shippedDate.getTime() - order.orderDate.getTime()) / 86400000))
      const bucket = buckets.find((item) => days >= item.min && days <= item.max)
      if (bucket) bucket.orders += 1
    })

    return buckets
  }, [filteredOrders])

  const totalRevenue = filteredOrders.reduce((total, order) => total + toNumber(order.grand_total), 0)
  const totalOrders = filteredOrders.length
  const totalQty = productMetrics.reduce((total, product) => total + product.qty, 0)
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0
  const topList = topMode === 'product' ? productMetrics.slice(0, 5) : categoryMetrics.slice(0, 5)
  const bottomList = (topMode === 'product' ? productMetrics : categoryMetrics).slice(-5).reverse()
  const maxTrendRevenue = Math.max(...trendData.map((item) => item.revenue), 1)
  const maxTrendOrders = Math.max(...trendData.map((item) => item.orders), 1)
  const maxCityRevenue = Math.max(...cityRevenue.map((item) => item.revenue), 1)
  const maxWeekdayOrders = Math.max(weekdayData.weekday.orders, weekdayData.weekend.orders, 1)
  const maxSeasonalRevenue = Math.max(...seasonalData.flatMap((series) => series.months.map((item) => item.revenue)), 1)
  const maxDeliveryOrders = Math.max(...deliveryDistribution.map((item) => item.orders), 1)
  const maxProductOrders = Math.max(...selectedProductMetrics.map((item) => item.orders), 1)
  const maxAveragePrice = Math.max(...selectedProductMetrics.map((item) => item.averagePrice), 1)
  const seasonalSeriesPoints = seasonalData.map((series) => ({
    product: series.product,
    points: series.months.map((item, index) => ({
      x: series.months.length <= 1 ? 8 : 8 + (index / (series.months.length - 1)) * 84,
      y: 86 - getPercent(item.revenue, maxSeasonalRevenue) * 68,
    })),
  }))
  const trendLinePoints = trendData.map((item, index) => ({
    x: trendData.length <= 1 ? 8 : 8 + (index / (trendData.length - 1)) * 84,
    y: 84 - getPercent(item.orders, maxTrendOrders) * 64,
  }))

  const handleDownloadReport = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Total Revenue', totalRevenue],
      ['Total Orders', totalOrders],
      ['Total Qty', totalQty],
      ['Average Order Value', Math.round(averageOrderValue)],
      [],
      ['Top Best Selling', topMode],
      ['Name', 'Category', 'Orders', 'Qty', 'Revenue', 'Average Price'],
      ...topList.map((item) => [item.name, item.category, item.orders, item.qty, Math.round(item.revenue), Math.round(item.averagePrice)]),
    ]

    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sales-dashboard-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 text-slate-900">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-blue-600">Sales Performance</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Report Dashboard Penjualan</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {businessName ? `Ringkasan performa ${businessName}` : 'Ringkasan performa penjualan berdasarkan order aktif.'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleDownloadReport}
              className="inline-flex items-center justify-center rounded-md bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-blue-700"
            >
              Download Report
            </button>
            <select
              value={topMode}
              onChange={(event) => setTopMode(event.target.value as 'product' | 'category')}
              className="rounded-md border border-slate-300 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="product">Top Produk</option>
              <option value="category">Top Kategori</option>
            </select>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-1 md:col-span-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Segmentasi Produk</span>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <select value={productSegmentOperator} onChange={(event) => setProductSegmentOperator(event.target.value as ProductSegmentOperator)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500">
                {productSegmentOperatorOptions.map((operator) => (
                  <option key={operator.value} value={operator.value}>{operator.label}</option>
                ))}
              </select>
              <input
                list="dashboard-product-segments"
                value={productSegment}
                onChange={(event) => setProductSegment(event.target.value)}
                placeholder="Semua produk"
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              />
            </div>
            <datalist id="dashboard-product-segments">
              {filterOptions.products.map((product) => (
                <option key={product} value={product} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kota</span>
            <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500">
              <option value="all">Semua Kota</option>
              {filterOptions.cities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Provinsi</span>
            <select value={provinceFilter} onChange={(event) => setProvinceFilter(event.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500">
              <option value="all">Semua Provinsi</option>
              {filterOptions.provinces.map((province) => (
                <option key={province} value={province}>{province}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tanggal Mulai</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tanggal Akhir</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500" />
          </label>
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-16 text-center text-xs font-black uppercase tracking-[0.24em] text-slate-300">
          Memuat dashboard penjualan...
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Total Revenue', value: formatCompactIDR(totalRevenue), accent: 'bg-blue-600' },
              { label: 'Total Orders', value: totalOrders.toLocaleString('id-ID'), accent: 'bg-cyan-500' },
              { label: 'Produk Terjual', value: totalQty.toLocaleString('id-ID'), accent: 'bg-amber-500' },
              { label: 'Avg Order Value', value: formatCompactIDR(averageOrderValue), accent: 'bg-emerald-500' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className={`mb-5 h-1.5 w-12 rounded-full ${stat.accent}`} />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{stat.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{stat.value}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr_0.8fr]">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Monthly Revenue and Orders Trend</h2>
                <span className="text-[10px] font-bold uppercase text-slate-400">{trendData.length} bulan</span>
              </div>
              <div className="relative h-72 overflow-hidden border-b border-l border-slate-200 px-3 pt-8">
                <div className="pointer-events-none absolute inset-x-3 top-8 bottom-8 z-20">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-hidden">
                    {[20, 40, 60, 80].map((line) => (
                      <line key={line} x1="0" x2="100" y1={line} y2={line} stroke="#e2e8f0" strokeWidth="0.4" />
                    ))}
                    <path d={buildSvgLinePath(trendLinePoints)} fill="none" stroke="#f59e0b" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    {trendLinePoints.map((point, index) => (
                      <circle key={`${point.x}-${index}`} cx={point.x} cy={point.y} r="1.4" fill="#f59e0b" />
                    ))}
                  </svg>
                </div>
                <div className="relative z-10 flex h-full items-end gap-3 pb-8">
                  {trendData.map((item) => (
                    <div key={item.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                      <div className="flex h-52 w-full items-end justify-center">
                        <div className="w-full max-w-10 rounded-t bg-blue-600/85" style={{ height: `${Math.max(getPercent(item.revenue, maxTrendRevenue), 5)}%` }} />
                      </div>
                      <p className="truncate text-[10px] font-black text-slate-500">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Revenue</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Orders</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Top Revenue-Contributing Cities</h2>
              <div className="mt-5 space-y-4">
                {cityRevenue.map((city, index) => (
                  <div key={city.city}>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-black text-slate-800">{index + 1}. {city.city}</p>
                      <p className="text-xs font-black text-blue-700">{formatCompactIDR(city.revenue)}</p>
                    </div>
                    <div className="h-3 rounded-full bg-slate-100">
                      <div className="h-3 rounded-full bg-cyan-500" style={{ width: `${Math.max(getPercent(city.revenue, maxCityRevenue), 5)}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{city.province} / {city.orders} order</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Top 5 Best Selling {topMode === 'product' ? 'Products' : 'Categories'}</h2>
                <div className="mt-4 space-y-2">
                  {topList.map((item, index) => (
                    <div key={item.name} className="rounded-md border border-slate-100 p-3" style={{ background: `linear-gradient(90deg, ${palette[index % palette.length]}22, #ffffff)` }}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-black text-slate-900">{item.name}</p>
                        <span className="text-[10px] font-black text-slate-500">{item.qty} pcs</span>
                      </div>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{formatCompactIDR(item.revenue)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Bottom 5 Sales {topMode === 'product' ? 'Products' : 'Categories'}</h2>
                <div className="mt-4 space-y-2">
                  {bottomList.map((item) => (
                    <div key={item.name} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                      <p className="truncate text-xs font-black text-slate-700">{item.name}</p>
                      <p className="text-[10px] font-black text-slate-400">{formatCompactIDR(item.revenue)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Monthly Weekday vs Weekend Order Trend</h2>
              <div className="mt-8 space-y-5">
                {[
                  { label: 'Weekday', data: weekdayData.weekday, color: 'bg-blue-600' },
                  { label: 'Weekend', data: weekdayData.weekend, color: 'bg-amber-400' },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between text-xs font-black text-slate-700">
                      <span>{item.label}</span>
                      <span>{item.data.orders} order</span>
                    </div>
                    <div className="h-8 rounded-md bg-slate-100">
                      <div className={`flex h-8 items-center rounded-md px-3 text-[10px] font-black text-white ${item.color}`} style={{ width: `${Math.max(getPercent(item.data.orders, maxWeekdayOrders), 8)}%` }}>
                        {formatCompactIDR(item.data.revenue)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Seasonal Trends in Monthly Product</h2>
                <span className="rounded-md bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {productSegment.trim() ? 'Filter produk utama' : 'Top 3 produk'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {seasonalData.map((series, index) => (
                  <span key={series.product.name} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-[10px] font-black text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                    {series.product.name}
                  </span>
                ))}
              </div>
              <div className="mt-6 h-64 overflow-hidden">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-hidden">
                  {[20, 40, 60, 80].map((line) => (
                    <line key={line} x1="6" x2="96" y1={line} y2={line} stroke="#e2e8f0" strokeWidth="0.5" />
                  ))}
                  {seasonalSeriesPoints.map((series, seriesIndex) => (
                    <g key={series.product.name}>
                      <path d={buildSvgLinePath(series.points)} fill="none" stroke={palette[seriesIndex % palette.length]} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                      {series.points.map((point, index) => (
                        <circle key={`${series.product.name}-${index}`} cx={point.x} cy={point.y} r="1.1" fill={palette[seriesIndex % palette.length]} />
                      ))}
                    </g>
                  ))}
                </svg>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-[9px] font-black text-slate-400">
                {(seasonalData[0]?.months || []).slice(-4).map((item) => (
                  <span key={item.key}>{item.label}</span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Delivery Speed Distribution</h2>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tanggal order sampai tanggal shipped</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {deliveryDistribution.map((bucket) => (
                  <div key={bucket.label} className="rounded-md border border-slate-100 p-4">
                    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full text-lg font-black text-white" style={{ background: `conic-gradient(${bucket.color} ${getPercent(bucket.orders, maxDeliveryOrders) * 3.6}deg, #e2e8f0 0deg)` }}>
                      {bucket.orders}
                    </div>
                    <p className="mt-3 text-center text-xs font-black text-slate-800">{bucket.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Avg Price vs Orders Berdasarkan Produk</h2>
                <p className="mt-1 text-xs font-bold text-slate-400">Semakin kanan berarti harga rata-rata tinggi, semakin atas berarti order lebih banyak.</p>
              </div>
              <span className="rounded-md bg-blue-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-blue-700">
                {productSegment.trim() ? 'Filter produk utama' : 'Top 3 produk'}
              </span>
            </div>
            <div className="relative h-80 rounded-lg border border-slate-200 bg-[linear-gradient(#f1f5f9_1px,transparent_1px),linear-gradient(90deg,#f1f5f9_1px,transparent_1px)] bg-[size:48px_48px]">
              {selectedProductMetrics.map((product, index) => (
                <div
                  key={product.name}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
                  style={{
                    left: `${8 + getPercent(product.averagePrice, maxAveragePrice) * 84}%`,
                    top: `${92 - getPercent(product.orders, maxProductOrders) * 84}%`,
                    width: `${Math.min(54, Math.max(18, product.qty * 4))}px`,
                    height: `${Math.min(54, Math.max(18, product.qty * 4))}px`,
                    backgroundColor: palette[index % palette.length],
                  }}
                  title={`${product.name}: ${product.orders} order, avg ${formatIDR(product.averagePrice)}`}
                />
              ))}
              <div className="absolute bottom-3 left-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Average Price</div>
              <div className="absolute left-4 top-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Orders</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedProductMetrics.map((product, index) => (
                <span key={product.name} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-[10px] font-black text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                  {product.name}
                </span>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
