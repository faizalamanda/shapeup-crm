"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

type PeriodUnit = 'week' | 'month' | 'quarter' | 'year'
type SegmentOperator = 'contains' | 'is' | 'is_not'

type CohortOrder = {
  id: string | number
  customer_id: string | null
  order_date: string | null
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
  const rawDate = order.order_date || order.created_at || ''
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
  if (rate >= 70) return 'bg-blue-700 text-white border-blue-800'
  if (rate >= 50) return 'bg-blue-600 text-white border-blue-700'
  if (rate >= 35) return 'bg-blue-500 text-white border-blue-600'
  if (rate >= 20) return 'bg-blue-300 text-blue-950 border-blue-400'
  if (rate > 0) return 'bg-blue-100 text-blue-950 border-blue-200'

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
  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>('month')
  const [duration, setDuration] = useState(12)
  const [firstOrderStartDate, setFirstOrderStartDate] = useState(getInitialFirstOrderStartDate)
  const [segmentOperator, setSegmentOperator] = useState<SegmentOperator>('contains')
  const [segmentProductName, setSegmentProductName] = useState('')

  const fetchOrders = useCallback(async () => {
    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()

      if (!profile?.active_business_id) return

      const allOrders: CohortOrder[] = []
      let from = 0

      while (true) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, customer_id, order_date, created_at, grand_total, status, items_json')
          .eq('business_id', profile.active_business_id)
          .order('order_date', { ascending: true })
          .range(from, from + ordersPageSize - 1)

        if (error) throw error

        allOrders.push(...((data || []) as CohortOrder[]))

        if (!data || data.length < ordersPageSize) break
        from += ordersPageSize
      }

      setOrders(allOrders)
    } catch (error) {
      console.error('Error fetching returning cohort:', error)
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

  const cohortData = useMemo(() => {
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

    const rows = Array.from(rowMap.values()).sort((a, b) => b.start.getTime() - a.start.getTime())
    const totalCustomers = rows.reduce((sum, row) => sum + row.customerIds.size, 0)
    const returningCustomers = new Set<string>()

    rows.forEach((row) => {
      row.returningByOffset.forEach((customers) => {
        customers.forEach((customerId) => returningCustomers.add(customerId))
      })
    })

    return {
      rows,
      ignoredStatusCount,
      ignoredSegmentCount,
      totalCustomers,
      returningCustomers: returningCustomers.size,
      repeatRate: totalCustomers ? (returningCustomers.size / totalCustomers) * 100 : 0,
      totalRevenue: rows.reduce((sum, row) => {
        let rowRevenue = 0
        row.revenueByOffset.forEach((revenue) => {
          rowRevenue += revenue
        })
        return sum + rowRevenue
      }, 0),
    }
  }, [duration, firstOrderStartDate, orders, periodUnit, segmentOperator, segmentProductName])

  const productNameOptions = useMemo(() => {
    const productNames = new Set<string>()

    orders.forEach((order) => {
      getOrderProductNames(order).forEach((name) => productNames.add(name))
    })

    return Array.from(productNames).sort((a, b) => a.localeCompare(b))
  }, [orders])

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 md:p-10 text-slate-900">
      <div className="max-w-[1400px] mx-auto space-y-8">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Customer Cohort</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Customer Returning Cohort</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
              Analisa kapan customer dari cohort pembelian pertama kembali order di periode berikutnya.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Period</span>
              <select
                value={periodUnit}
                onChange={(event) => setPeriodUnit(event.target.value as PeriodUnit)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              >
                {periodOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">First Order Mulai</span>
              <input
                type="date"
                value={firstOrderStartDate}
                onChange={(event) => setFirstOrderStartDate(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Durasi</span>
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              >
                {durationOptions.map((option) => (
                  <option key={option} value={option}>{option} periode</option>
                ))}
              </select>
            </label>

            <div className="sm:col-span-3 flex flex-col gap-2 rounded-md bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>First order mulai dipakai sebagai batas tetap. Ubah manual kalau mau geser cohort.</span>
              <span>Status dihitung: shipped, processing, complete/completed</span>
            </div>
          </div>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Segmenting</h2>
              <p className="mt-1 text-xs font-medium text-slate-500">Filter cohort berdasarkan order yang memenuhi kondisi segment.</p>
            </div>
            {segmentProductName && (
              <button
                type="button"
                onClick={() => {
                  setSegmentOperator('contains')
                  setSegmentProductName('')
                }}
                className="rounded-md border border-slate-300 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50"
              >
                Reset
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_160px_1fr] md:items-end">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kriteria</span>
              <select
                value="product_name"
                disabled
                className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-500 outline-none"
              >
                <option value="product_name">Nama Produk</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Operator</span>
              <select
                value={segmentOperator}
                onChange={(event) => setSegmentOperator(event.target.value as SegmentOperator)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              >
                {segmentOperatorOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Parameter</span>
              <input
                list="cohort-product-names"
                value={segmentProductName}
                onChange={(event) => setSegmentProductName(event.target.value)}
                placeholder="Contoh: Serum"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              />
              <datalist id="cohort-product-names">
                {productNameOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
          </div>
        </section>

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-16 text-center text-sm font-black uppercase tracking-[0.2em] text-slate-300">
            Menghitung cohort...
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Cohort Customer</p>
                <p className="mt-2 text-3xl font-black text-slate-900">{cohortData.totalCustomers}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Returning Customer</p>
                <p className="mt-2 text-3xl font-black text-blue-600">{cohortData.returningCustomers}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Returning Rate</p>
                <p className="mt-2 text-3xl font-black text-emerald-600">{cohortData.repeatRate.toFixed(1)}%</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Revenue Cohort</p>
                <p className="mt-2 text-2xl font-black text-slate-900">{formatIDR(cohortData.totalRevenue)}</p>
              </div>
            </section>

            {cohortData.ignoredStatusCount > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
                {cohortData.ignoredStatusCount} order tidak dihitung karena statusnya bukan shipped, processing, complete, atau completed.
              </div>
            )}

            {cohortData.ignoredSegmentCount > 0 && segmentProductName.trim() && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-800">
                {cohortData.ignoredSegmentCount} order eligible tidak masuk cohort karena tidak cocok dengan segment nama produk &quot;{segmentProductName}&quot;.
              </div>
            )}

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-black tracking-tight">Returning Cohort Heatmap</h2>
                  <p className="mt-1 text-xs font-medium text-slate-500">Kolom 0 adalah periode first order. Kolom +1 dan seterusnya menunjukkan customer yang order kembali.</p>
                </div>

                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <span>Low</span>
                  <div className="h-4 w-7 rounded border border-slate-100 bg-slate-50" />
                  <div className="h-4 w-7 rounded border border-blue-200 bg-blue-100" />
                  <div className="h-4 w-7 rounded border border-blue-400 bg-blue-300" />
                  <div className="h-4 w-7 rounded border border-blue-700 bg-blue-600" />
                  <span>High</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                      <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 font-black">Cohort</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right font-black">Customers</th>
                      <th className="border-b border-slate-200 px-3 py-3 text-center font-black">0</th>
                      {Array.from({ length: duration - 1 }).map((_, index) => (
                        <th key={index} className="border-b border-slate-200 px-3 py-3 text-center font-black">+{index + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {cohortData.rows.length === 0 ? (
                      <tr>
                        <td colSpan={duration + 2} className="px-4 py-12 text-center text-sm font-bold text-slate-400">
                          Belum ada data order yang cukup untuk cohort ini.
                        </td>
                      </tr>
                    ) : (
                      cohortData.rows.map((row) => {
                        const cohortSize = row.customerIds.size

                        return (
                          <tr key={row.key} className="hover:bg-blue-50/40">
                            <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 font-black text-slate-800">{row.label}</td>
                            <td className="border-b border-slate-100 px-4 py-3 text-right font-bold text-slate-600">{cohortSize}</td>
                            <td className="border-b border-slate-100 px-2 py-2 text-center">
                              <div
                                className="mx-auto grid h-16 min-w-24 content-center rounded-md border border-emerald-600 bg-emerald-500 px-2 text-white shadow-sm"
                                title={`${cohortSize} customer first order, ${formatIDR(row.firstOrderRevenue)} revenue`}
                              >
                                <p className="text-sm font-black">100%</p>
                                <p className="text-[10px] font-bold">{cohortSize} cust</p>
                              </div>
                            </td>
                            {Array.from({ length: duration - 1 }).map((_, index) => {
                              const offset = index + 1
                              const count = row.returningByOffset.get(offset)?.size || 0
                              const rate = cohortSize ? (count / cohortSize) * 100 : 0

                              return (
                                <td key={offset} className="border-b border-slate-100 px-2 py-2 text-center">
                                  <div
                                    className={`mx-auto grid h-16 min-w-24 content-center rounded-md border px-2 shadow-sm transition-transform hover:scale-[1.02] ${getHeatmapCellClass(rate)}`}
                                    title={`${count} customer kembali, ${formatIDR(row.revenueByOffset.get(offset) || 0)} revenue`}
                                  >
                                    <p className="text-sm font-black">{rate.toFixed(0)}%</p>
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
    </div>
  )
}
