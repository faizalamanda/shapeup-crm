export type OrderItem = {
  name?: string | null
  product_name?: string | null
}

export type MarketingOrderPreview = {
  id: string | number
  customer_id?: string | null
  created_at?: string | null
  status?: string | null
  order_date_utc?: string | null
  order_date?: string | null
  updated_at?: string | null
  items_json?: OrderItem[] | string | null
  raw_source_data?: {
    date_completed_gmt?: string | null
    date_completed?: string | null
    total?: string | number | null
    number?: string | number | null
    line_items?: OrderItem[] | null
    billing?: {
      first_name?: string | null
      last_name?: string | null
      city?: string | null
    } | null
  } | string | null
}

export type MarketingFilter = {
  key: string
  op: string
  value?: string
  logic?: 'AND' | 'OR'
}

export type CustomerMetricMapItem = {
  ltv: number
  aov: number
  total_order_count: number
}

export type PreviewPerson = {
  name: string
  orderId: string
  status: string
  time: string
}

export const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export const parseArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string') return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export const getDateKeyInTimezone = (dateStr: string, timezone: string) => {
  if (!dateStr) return ''

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return year && month && day ? `${year}-${month}-${day}` : ''
}

export const getLocalDateKey = (dateStr: string) => {
  return dateStr?.slice(0, 10) || ''
}

export const ensureUTCDateString = (dateStr: string) => {
  if (!dateStr) return ''
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(dateStr) ? dateStr : `${dateStr}Z`
}

export const getOrderDateKey = (order: MarketingOrderPreview, timezone: string) => {
  if (order.order_date_utc) return getDateKeyInTimezone(order.order_date_utc, timezone)
  return getLocalDateKey(order.order_date || '')
}

export const getCompletedDateKey = (order: MarketingOrderPreview, timezone: string) => {
  const raw = parseRecord(order.raw_source_data) || {}
  const completedGmt = typeof raw.date_completed_gmt === 'string' ? raw.date_completed_gmt : ''
  const completed = typeof raw.date_completed === 'string' ? raw.date_completed : ''

  if (completedGmt) return getDateKeyInTimezone(ensureUTCDateString(completedGmt), timezone)
  if (completed) return getLocalDateKey(completed)
  return getDateKeyInTimezone(order.updated_at || '', timezone)
}

export const getOrderProductNames = (order: MarketingOrderPreview) => {
  const raw = parseRecord(order.raw_source_data)
  const items = parseArray<OrderItem>(order.items_json)
  const rawItems = parseArray<OrderItem>(raw?.line_items)
  const orderItems = items.length > 0 ? items : rawItems

  return orderItems
    .map((item) => item.name || item.product_name || '')
    .filter(Boolean)
    .join(', ')
}

export const dateKeyToLocalDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const subtractDaysFromDateKey = (dateKey: string, days: number) => {
  const date = dateKeyToLocalDate(dateKey)
  date.setDate(date.getDate() - days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export const formatDateKeyID = (dateStr: string, timezone: string, useTimezone = false) => {
  const dateKey = useTimezone ? getDateKeyInTimezone(dateStr, timezone) : getLocalDateKey(dateStr)
  if (!dateKey) return '-'

  return dateKeyToLocalDate(dateKey).toLocaleDateString('id-ID')
}

export const isDateKeyMatch = (orderDateKey: string, orderIsoDate: string, filterValue: string, operator: string, timezone: string) => {
  if (!orderDateKey || !filterValue) return false

  if (operator === 'after_x_days') {
    const dayCount = Number(filterValue)
    if (!Number.isFinite(dayCount) || dayCount < 0) return false

    const todayKey = getDateKeyInTimezone(new Date().toISOString(), timezone)
    return orderDateKey === subtractDaysFromDateKey(todayKey, Math.trunc(dayCount))
  }

  if (operator === 'after_x_hours') {
    const hourCount = Number(filterValue)
    if (!Number.isFinite(hourCount) || hourCount < 0) return false

    const orderTime = new Date(orderIsoDate || orderDateKey).getTime()
    if (!Number.isFinite(orderTime)) return false

    const thresholdTime = Date.now() - (hourCount * 3600 * 1000)
    return orderTime <= thresholdTime
  }

  switch (operator) {
    case 'equal':
    case 'is':
      return orderDateKey === filterValue
    case 'before':
      return orderDateKey < filterValue
    case 'after':
      return orderDateKey > filterValue
    default:
      return true
  }
}

export const compareTextValue = (sourceValue: string, filterValue: string, operator: string) => {
  const source = (sourceValue || '').toLowerCase()
  const filter = (filterValue || '').toLowerCase()

  switch (operator) {
    case 'is': return source === filter
    case 'is not': return source !== filter
    case 'contains': return source.includes(filter)
    default: return true
  }
}

export const compareNumberValue = (sourceValue: string | number | null | undefined, filterValue: string, operator: string) => {
  const source = Number(sourceValue)
  const filter = Number(filterValue)

  if (!Number.isFinite(source) || !Number.isFinite(filter)) return false

  switch (operator) {
    case 'equal to':
    case 'equal':
      return source === filter
    case 'more than':
    case 'greater':
      return source > filter
    case 'less than':
    case 'less':
      return source < filter
    case 'greater_or_equal':
    case 'greater than or equal to':
    case 'at_least':
      return source >= filter
    case 'less_or_equal':
    case 'less than or equal to':
    case 'at_most':
      return source <= filter
    default:
      return true
  }
}

export const isCustomerMatchFilter = (
  customer: any,
  orders: MarketingOrderPreview[],
  filter: MarketingFilter,
  timezone: string
): boolean => {
  switch (filter.key) {
    case 'customer_ltv':
    case 'ltv':
      return compareNumberValue(customer.ltv || 0, filter.value || '', filter.op)

    case 'customer_aov':
    case 'aov':
      return compareNumberValue(customer.aov || 0, filter.value || '', filter.op)

    case 'customer_total_orders':
    case 'total_order_count':
      return compareNumberValue(customer.total_order_count ?? customer.completed_order_count ?? 0, filter.value || '', filter.op)

    case 'order_status': {
      if (compareTextValue(customer.last_order_status || '', filter.value || '', filter.op)) return true
      return orders.some(o => compareTextValue(o.status || '', filter.value || '', filter.op))
    }

    case 'customer_city': {
      if (compareTextValue(customer.address || '', filter.value || '', filter.op)) return true
      return orders.some(o => {
        const raw = parseRecord(o.raw_source_data) || {}
        const billing = parseRecord(raw.billing)
        return compareTextValue(String(billing?.city || ''), filter.value || '', filter.op)
      })
    }

    case 'product_name':
      return orders.some(o => compareTextValue(getOrderProductNames(o), filter.value || '', filter.op))

    case 'total_spent': {
      if (compareNumberValue(customer.ltv || 0, filter.value || '', filter.op)) return true
      return orders.some(o => {
        const raw = parseRecord(o.raw_source_data) || {}
        const total = Number(raw.total ?? (o as any).grand_total ?? 0)
        return compareNumberValue(total, filter.value || '', filter.op)
      })
    }

    case 'date_order': {
      if (customer.last_order_date && isDateKeyMatch(getDateKeyInTimezone(customer.last_order_date, timezone), customer.last_order_date, filter.value || '', filter.op, timezone)) return true
      return orders.some(o => {
        const dateKey = getOrderDateKey(o, timezone)
        const isoDate = o.order_date_utc || o.order_date || o.created_at || ''
        return isDateKeyMatch(dateKey, isoDate, filter.value || '', filter.op, timezone)
      })
    }

    case 'date_completed': {
      return orders.some(o => {
        const dateKey = getCompletedDateKey(o, timezone)
        const raw = parseRecord(o.raw_source_data) || {}
        const rawComp = typeof raw.date_completed_gmt === 'string' ? raw.date_completed_gmt : (typeof raw.date_completed === 'string' ? raw.date_completed : o.updated_at || '')
        return isDateKeyMatch(dateKey, rawComp, filter.value || '', filter.op, timezone)
      })
    }

    default:
      return true
  }
}

export const isCustomerMatchFilters = (
  customer: any,
  orders: MarketingOrderPreview[],
  filters: MarketingFilter[],
  timezone: string
): boolean => {
  if (!filters.length) return true

  return filters.reduce((result, filter, index) => {
    const isMatch = isCustomerMatchFilter(customer, orders, filter, timezone)
    if (index === 0) return isMatch
    return filter.logic === 'OR' ? result || isMatch : result && isMatch
  }, true)
}

export const isOrderMatchFilter = (
  order: MarketingOrderPreview,
  filter: MarketingFilter,
  timezone: string,
  customerMetricsMap?: Map<string, CustomerMetricMapItem>
) => {
  const raw = parseRecord(order.raw_source_data) || {}
  const billing = parseRecord(raw.billing)
  const cid = order.customer_id

  switch (filter.key) {
    case 'order_status':
      return compareTextValue(order.status || '', filter.value || '', filter.op)
    case 'customer_city':
      return compareTextValue(String(billing?.city || ''), filter.value || '', filter.op)
    case 'product_name':
      return compareTextValue(getOrderProductNames(order), filter.value || '', filter.op)
    case 'total_spent':
      return compareNumberValue(raw.total as string | number | null | undefined, filter.value || '', filter.op)
    case 'customer_aov':
    case 'aov': {
      const metric = cid ? customerMetricsMap?.get(cid) : undefined
      return compareNumberValue(metric?.aov ?? 0, filter.value || '', filter.op)
    }
    case 'customer_ltv':
    case 'ltv': {
      const metric = cid ? customerMetricsMap?.get(cid) : undefined
      return compareNumberValue(metric?.ltv ?? 0, filter.value || '', filter.op)
    }
    case 'customer_total_orders':
    case 'total_order_count': {
      const metric = cid ? customerMetricsMap?.get(cid) : undefined
      return compareNumberValue(metric?.total_order_count ?? 0, filter.value || '', filter.op)
    }
    case 'date_order': {
      const dateKey = getOrderDateKey(order, timezone)
      const isoDate = order.order_date_utc || order.order_date || order.created_at || ''
      return isDateKeyMatch(dateKey, isoDate, filter.value || '', filter.op, timezone)
    }
    case 'date_completed': {
      const dateKey = getCompletedDateKey(order, timezone)
      const rawComp = typeof raw.date_completed_gmt === 'string' ? raw.date_completed_gmt : (typeof raw.date_completed === 'string' ? raw.date_completed : order.updated_at || '')
      return isDateKeyMatch(dateKey, rawComp, filter.value || '', filter.op, timezone)
    }
    default:
      return true
  }
}

export const isOrderMatchFilters = (
  order: MarketingOrderPreview,
  filters: MarketingFilter[],
  timezone: string,
  customerMetricsMap?: Map<string, CustomerMetricMapItem>
) => {
  if (!filters.length) return true

  return filters.reduce((result, filter, index) => {
    const isMatch = isOrderMatchFilter(order, filter, timezone, customerMetricsMap)
    if (index === 0) return isMatch

    return filter.logic === 'OR' ? result || isMatch : result && isMatch
  }, true)
}
