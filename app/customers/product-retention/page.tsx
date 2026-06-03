"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  grand_total?: number | string | null
  items_json?: OrderItem[] | string | null
  raw_source_data?: {
    line_items?: OrderItem[] | null
  } | null
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

const ordersPageSize = 1000
const allowedOrderStatuses = new Set(['shipped', 'processing', 'complete', 'completed'])
const productFilterOperatorOptions: { value: ProductFilterOperator; label: string; description: string }[] = [
  { value: 'contains', label: 'Contain', description: 'mengandung' },
  { value: 'is', label: 'Is', description: 'sama persis dengan' },
  { value: 'is_not', label: 'Is Not', description: 'tidak sama dengan' },
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
  const rawItems = parseArray<OrderItem>(order.raw_source_data?.line_items)
  const orderItems = items.length > 0 ? items : rawItems
  const names = orderItems
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

      const allOrders: FlowOrder[] = []
      let from = 0

      while (true) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, customer_id, order_date, order_date_utc, created_at, status, grand_total, items_json, raw_source_data')
          .eq('business_id', profile.active_business_id)
          .order('order_date', { ascending: true })
          .range(from, from + ordersPageSize - 1)

        if (error) throw error

        allOrders.push(...((data || []) as FlowOrder[]))
        if (!data || data.length < ordersPageSize) break
        from += ordersPageSize
      }

      setOrders(allOrders)
    } catch (error) {
      console.error('Error fetching product retention:', error)
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

  useEffect(() => {
    if (!productFilterValue && firstProductOptions.length > 0) {
      setProductFilterValue(firstProductOptions[0].name)
    }
  }, [firstProductOptions, productFilterValue])

  const productFilterLabel = useMemo(() => {
    const operator = productFilterOperatorOptions.find((item) => item.value === productFilterOperator)
    const value = productFilterValue.trim()

    if (!value) return 'Semua customer berdasarkan first order yang punya data produk.'
    return `First order ${operator?.description || 'mengandung'} "${value}".`
  }, [productFilterOperator, productFilterValue])

  const flowData = useMemo(() => {
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
  }, [ordersByCustomer, productFilterOperator, productFilterValue])

  const maxDestinationCount = Math.max(...flowData.destinations.map((item) => item.customers.size), 1)

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="space-y-7">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-7 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Product Flow Retention</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Retention Berdasarkan Produk Pertama</h1>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">
              Lihat customer yang first order-nya berisi produk tertentu, lalu cek produk apa yang mereka beli di order berikutnya.
            </p>
          </div>

          <div className="grid w-full gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm xl:max-w-2xl sm:grid-cols-[160px_1fr]">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Operator</span>
              <select
                value={productFilterOperator}
                onChange={(event) => setProductFilterOperator(event.target.value as ProductFilterOperator)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              >
                {productFilterOperatorOptions.map((operator) => (
                  <option key={operator.value} value={operator.value}>{operator.label}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Produk First Order</span>
              <input
                list="first-order-product-options"
                value={productFilterValue}
                onChange={(event) => setProductFilterValue(event.target.value)}
                placeholder="Contoh: Serum"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
              />
              <datalist id="first-order-product-options">
                {firstProductOptions.map((product) => (
                  <option key={product.name} value={product.name} />
                ))}
              </datalist>
            </label>

            <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-500 sm:col-span-2">
              Filter aktif: {productFilterLabel}
            </div>
          </div>
        </header>

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-16 text-center text-sm font-black uppercase tracking-[0.2em] text-slate-300">
            Menghitung product flow...
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Customer Match Filter</p>
                <p className="mt-2 text-3xl font-black text-slate-900">{flowData.cohortSize}</p>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-400">{productFilterLabel}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Beli Lagi</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-3xl font-black text-blue-600">{flowData.retainedCount}</p>
                  <p className="text-xl font-black text-blue-600">{formatPercent(flowData.retentionRate)}</p>
                </div>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-400">
                  Dari {flowData.cohortSize} customer dengan filter: {productFilterLabel}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Belum Beli Lagi</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-3xl font-black text-rose-600">{flowData.bouncedCount}</p>
                  <p className="text-xl font-black text-rose-600">{formatPercent(flowData.bounceRate)}</p>
                </div>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-400">
                  Customer filter ini yang belum punya order berikutnya.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tujuan Produk</p>
                <p className="mt-2 text-3xl font-black text-emerald-600">{flowData.destinations.length}</p>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="text-base font-black tracking-tight">Flow Pembelian Berikutnya</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  Persentase tujuan produk dihitung dari total customer first product. Jika next order berisi beberapa produk, customer dihitung di setiap produk tersebut.
                </p>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[280px_1fr]">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Start Product</p>
                  <h3 className="mt-2 text-lg font-black leading-tight text-slate-900">{productFilterValue || 'Semua produk first order'}</h3>
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{productFilterLabel}</p>
                  <div className="mt-5 overflow-hidden rounded-md border border-slate-200 bg-white">
                    <div className="flex h-11">
                      <div
                        className="bg-blue-600"
                        style={{ width: `${flowData.retentionRate}%` }}
                        title={`${formatPercent(flowData.retentionRate)} beli lagi`}
                      />
                      <div
                        className="bg-rose-500"
                        style={{ width: `${flowData.bounceRate}%` }}
                        title={`${formatPercent(flowData.bounceRate)} belum beli lagi`}
                      />
                    </div>
                    <div className="grid grid-cols-2 border-t border-slate-100 text-center text-[10px] font-black uppercase tracking-widest">
                      <div className="px-2 py-3 text-blue-700">Beli Lagi {formatPercent(flowData.retentionRate)}</div>
                      <div className="px-2 py-3 text-rose-700">Drop {formatPercent(flowData.bounceRate)}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {flowData.destinations.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm font-bold text-slate-400">
                      Belum ada order berikutnya untuk produk ini.
                    </div>
                  ) : (
                    flowData.destinations.map((destination) => {
                      const count = destination.customers.size
                      const rate = flowData.cohortSize ? (count / flowData.cohortSize) * 100 : 0
                      const barWidth = Math.max((count / maxDestinationCount) * 100, 4)

                      return (
                        <div key={destination.productName} className="rounded-md border border-slate-200 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-black text-slate-900">{destination.productName}</p>
                              <p className="mt-1 text-[11px] font-bold text-slate-400">{count} customer di order berikutnya</p>
                            </div>
                            <div className="text-left sm:text-right">
                              <p className="text-xl font-black text-blue-600">{formatPercent(rate)}</p>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">dari cohort</p>
                            </div>
                          </div>
                          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${barWidth}%` }} />
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
