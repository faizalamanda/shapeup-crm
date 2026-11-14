"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { fetchAllSupabaseRows } from '@/lib/chunkedQueryHelper'
import { TemporalDateFilter, TemporalFilterValue } from '@/components/ui/TemporalDateFilter'
import {
  getLocalDateRangeLimits,
  resolveComparisonRange,
  getBusinessTimezone,
  getOrderLocalDateKey,
  localDateToUtcBounds,
} from '@/lib/localzone'

// ─── Types ────────────────────────────────────────────────────────────────────
type RawOrderRow = {
  id: string
  order_number?: string | null
  order_date: string | null
  order_date_utc?: string | null
  created_at?: string | null
  status?: string | null
  payment_status?: string | null
  payment_method?: string | null
  source_platform?: string | null
  subtotal?: number | string | null
  shipping_cost?: number | string | null
  discount_amount?: number | string | null
  other_fees?: number | string | null
  grand_total?: number | string | null
  raw_source_data?: Record<string, any> | null
}

type EnrichedOrder = {
  id: string
  localDate: string // YYYY-MM-DD in business timezone
  status: string
  paymentStatus: string
  paymentMethod: string
  platform: string
  country: string
  city: string
  province: string
  courier: string
  taxCode: string
  grossSales: number
  taxes: number
  shipping: number
  fees: number
  refunds: number
  netRevenue: number
}

type Granularity = 'day' | 'week' | 'month'
type ChartType = 'bar' | 'line'
type SortField = 'date' | 'orders' | 'grossSales' | 'taxes' | 'shipping' | 'fees' | 'refunds' | 'netRevenue'
type GroupDimension = 'country' | 'city' | 'province' | 'platform' | 'payment_method' | 'courier'
type SecondaryGroupDimension = 'tax_code' | 'platform' | 'payment_method' | 'courier' | 'city'

type BucketRow = {
  key: string
  label: string
  sortKey: string
  orders: number
  grossSales: number
  taxes: number
  shipping: number
  fees: number
  refunds: number
  netRevenue: number
  compOrders: number
  compGrossSales: number
  compNetRevenue: number
}

type GroupedRow = {
  key: string
  label: string
  flag?: string
  orders: number
  netRevenue: number
  avgNet: number
  grossSales: number
  avgGross: number
  taxes: number
  shipping: number
}

// L1 In-Memory Cache per businessId + date window
const revenueOrdersCache = new Map<string, { rows: RawOrderRow[]; timestamp: number }>()
const CACHE_TTL_MS = 60 * 1000 // 60s L1 cache

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COUNTED_STATUSES = new Set(['shipped', 'processing', 'complete', 'completed'])
const normalizeStatus = (status?: string | null) =>
  (status || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const isCountedStatus = (status?: string | null) =>
  COUNTED_STATUSES.has(normalizeStatus(status))

const toNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(val || 0))

const formatAxisIDR = (val: number) => {
  if (val === 0) return 'Rp0'
  return `Rp${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(val))}`
}

const formatNumber = (val: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(val || 0))

const calcGrowthPct = (curr: number, prev: number): number => {
  if (prev === 0) return curr > 0 ? 100 : 0
  return ((curr - prev) / Math.abs(prev)) * 100
}

const COUNTRY_NAMES: Record<string, { name: string; flag: string }> = {
  ID: { name: 'Indonesia', flag: '🇮🇩' },
  SG: { name: 'Singapore', flag: '🇸🇬' },
  MY: { name: 'Malaysia', flag: '🇲🇾' },
  US: { name: 'United States', flag: '🇺🇸' },
  AU: { name: 'Australia', flag: '🇦🇺' },
  JP: { name: 'Japan', flag: '🇯🇵' },
}

function getBucketKeyAndLabel(localYmd: string, granularity: Granularity): { key: string; label: string; sortKey: string } {
  if (!localYmd || !/^\d{4}-\d{2}-\d{2}$/.test(localYmd)) {
    return { key: 'unknown', label: '-', sortKey: '0000-00-00' }
  }
  const [yStr, mStr, dStr] = localYmd.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const day = Number(dStr)

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const shortYear = String(year).slice(-2)
  const mName = monthNames[(month - 1) % 12] || mStr

  if (granularity === 'month') {
    return {
      key: `${yStr}-${mStr}`,
      label: `${mName} '${shortYear}`,
      sortKey: `${yStr}-${mStr}`,
    }
  }

  if (granularity === 'week') {
    const dt = new Date(Date.UTC(year, month - 1, day))
    if (isNaN(dt.getTime())) {
      return { key: localYmd, label: localYmd, sortKey: localYmd }
    }
    const dayOfWeek = dt.getUTCDay() // 0 = Sun, 1 = Mon
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    dt.setUTCDate(dt.getUTCDate() + diffToMonday)
    const wy = dt.getUTCFullYear()
    const wm = String(dt.getUTCMonth() + 1).padStart(2, '0')
    const wd = String(dt.getUTCDate()).padStart(2, '0')
    const wmName = monthNames[dt.getUTCMonth()]
    return {
      key: `${wy}-${wm}-${wd}`,
      label: `${wd} ${wmName} '${String(wy).slice(-2)}`,
      sortKey: `${wy}-${wm}-${wd}`,
    }
  }

  // Day
  return {
    key: localYmd,
    label: `${dStr} ${mName} '${shortYear}`,
    sortKey: localYmd,
  }
}

function generateDateBuckets(startYmd: string, endYmd: string, granularity: Granularity): Array<{ key: string; label: string; sortKey: string }> {
  if (!startYmd || !endYmd || startYmd > endYmd) return []
  const map = new Map<string, { key: string; label: string; sortKey: string }>()

  const [sy, sm, sd] = startYmd.split('-').map(Number)
  const [ey, em, ed] = endYmd.split('-').map(Number)
  const curr = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))

  let guard = 0
  while (curr <= end && guard < 1500) {
    guard++
    const y = curr.getUTCFullYear()
    const m = String(curr.getUTCMonth() + 1).padStart(2, '0')
    const d = String(curr.getUTCDate()).padStart(2, '0')
    const ymd = `${y}-${m}-${d}`
    const b = getBucketKeyAndLabel(ymd, granularity)
    if (!map.has(b.key)) {
      map.set(b.key, b)
    }
    curr.setUTCDate(curr.getUTCDate() + 1)
  }

  return Array.from(map.values())
}

function enrichOrderRow(row: RawOrderRow, businessTz: string): EnrichedOrder {
  const localDate = getOrderLocalDateKey(row, businessTz)
  const raw = (row.raw_source_data && typeof row.raw_source_data === 'object') ? row.raw_source_data : {}

  const shipping = Math.max(0, toNum(row.shipping_cost) || toNum(raw.shipping_total))
  const fees = Math.max(0, Math.abs(toNum(row.other_fees)))
  const taxes = Math.max(0, toNum(raw.total_tax) || toNum(raw.tax_total))

  let refunds = 0
  if (Array.isArray(raw.refunds) && raw.refunds.length > 0) {
    refunds = raw.refunds.reduce((sum: number, r: any) => sum + Math.abs(toNum(r?.total)), 0)
  }

  const grandTotal = Math.max(0, toNum(row.grand_total))
  const subtotal = Math.max(0, toNum(row.subtotal))
  const discount = Math.max(0, toNum(row.discount_amount))

  // Gross Sales matches Metorik convention: total order value before deducting shipping, fees, taxes, refunds
  const grossSales = grandTotal > 0 ? grandTotal : Math.max(0, subtotal - discount + shipping + fees + taxes)
  const netRevenue = Math.max(0, grossSales - taxes - shipping - fees - refunds)

  // Dimensional attributes
  const rawCountry = String(raw.billing?.country || raw.shipping?.country || 'ID').toUpperCase().trim() || 'ID'
  const rawCity = String(raw.shipping?.city || raw.billing?.city || 'Tidak Diketahui').trim() || 'Tidak Diketahui'
  const rawState = String(raw.shipping?.state || raw.billing?.state || 'Tidak Diketahui').trim() || 'Tidak Diketahui'

  const meta = Array.isArray(raw.meta_data) ? raw.meta_data : []
  const courierMeta =
    meta.find((m: any) => m?.key === 'shapeup_kurir_awb')?.value ||
    meta.find((m: any) => m?.key === '_kurir_awb')?.value ||
    (Array.isArray(raw.shipping_lines) && raw.shipping_lines[0]?.method_title) ||
    'Tanpa Ekspedisi'

  const taxLines = Array.isArray(raw.tax_lines) ? raw.tax_lines : []
  const taxCode = taxLines[0]?.rate_code || taxLines[0]?.label || ''

  const platform = String(row.source_platform || raw.source_order?.channel || 'Manual').trim() || 'Manual'
  const paymentMethod = String(row.payment_method || raw.payment_method_title || 'Manual / Tunai').trim() || 'Manual / Tunai'
  const status = normalizeStatus(row.status)
  const paymentStatus = String(row.payment_status || (status === 'completed' ? 'paid' : 'unpaid')).toLowerCase()

  return {
    id: String(row.id),
    localDate,
    status,
    paymentStatus,
    paymentMethod,
    platform,
    country: rawCountry,
    city: rawCity,
    province: rawState,
    courier: String(courierMeta).trim() || 'Tanpa Ekspedisi',
    taxCode: String(taxCode).trim(),
    grossSales,
    taxes,
    shipping,
    fees,
    refunds,
    netRevenue,
  }
}

export default function RevenueReportPage() {
  const router = useRouter()
  const { activeBusiness } = useUserContext()
  const businessTz = getBusinessTimezone(activeBusiness?.timezone)

  // Default to 'this-year' so monthly bars & breakdown table match the Metorik multi-month view immediately
  const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
    const limits = getLocalDateRangeLimits('this-year', businessTz)
    const comp = resolveComparisonRange('previous_period', limits.start, limits.end)
    return {
      startDate: limits.start,
      endDate: limits.end,
      preset: 'this-year',
      comparisonMode: 'previous_period',
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }
  })

  // Controls state
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [showCompareOnChart, setShowCompareOnChart] = useState<boolean>(false)
  const [hoveredBucket, setHoveredBucket] = useState<BucketRow | null>(null)

  // Segment filter state
  const [isSegmentOpen, setIsSegmentOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all')

  // Breakdown Table Sorting
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // Grouped By Dimensions
  const [primaryGroupDim, setPrimaryGroupDim] = useState<GroupDimension>('country')
  const [secondaryGroupDim, setSecondaryGroupDim] = useState<SecondaryGroupDimension>('tax_code')

  // Data state
  const [rawOrders, setRawOrders] = useState<RawOrderRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const hasLoadedOnceRef = useRef<boolean>(false)

  // Determine overall query window covering both Current and Comparison ranges
  const queryBounds = useMemo(() => {
    const currStart = temporalFilter.startDate || ''
    const currEnd = temporalFilter.endDate || ''

    if (!currStart || !currEnd || temporalFilter.preset === 'all') {
      return {
        minStart: '',
        maxEnd: '',
        utcStart: '',
        utcEnd: '',
      }
    }

    const compStart =
      temporalFilter.comparisonMode !== 'none' && temporalFilter.comparisonStartDate
        ? temporalFilter.comparisonStartDate
        : currStart
    const compEnd =
      temporalFilter.comparisonMode !== 'none' && temporalFilter.comparisonEndDate
        ? temporalFilter.comparisonEndDate
        : currEnd

    const minStart = compStart && compStart < currStart ? compStart : currStart
    const maxEnd = compEnd && compEnd > currEnd ? compEnd : currEnd

    const utcBounds = localDateToUtcBounds(minStart, maxEnd, businessTz)

    return {
      minStart,
      maxEnd,
      utcStart: utcBounds.startOfDayISO || `${minStart}T00:00:00.000Z`,
      utcEnd: utcBounds.endOfDayISO || `${maxEnd}T23:59:59.999Z`,
    }
  }, [
    temporalFilter.preset,
    temporalFilter.startDate,
    temporalFilter.endDate,
    temporalFilter.comparisonMode,
    temporalFilter.comparisonStartDate,
    temporalFilter.comparisonEndDate,
    businessTz,
  ])

  const fetchRevenueOrders = useCallback(async (bid: string, startIso: string, endIso: string) => {
    const cacheKey = `${bid}_${startIso || 'ALL'}_${endIso || 'ALL'}`
    const cached = revenueOrdersCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setRawOrders(cached.rows)
      hasLoadedOnceRef.current = true
      setLoading(false)
      return
    }

    if (!hasLoadedOnceRef.current) {
      setLoading(true)
    }
    setIsSyncing(true)

    try {
      const rows = await fetchAllSupabaseRows<RawOrderRow>(
        (from, to) => {
          let q = supabase
            .from('orders')
            .select(
              'id, order_number, order_date, order_date_utc, created_at, status, payment_status, payment_method, source_platform, subtotal, shipping_cost, discount_amount, other_fees, grand_total, raw_source_data'
            )
            .eq('business_id', bid)

          if (startIso) {
            q = q.gte('order_date', startIso)
          }
          if (endIso) {
            q = q.lte('order_date', endIso)
          }

          return q
            .order('order_date', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        },
        1000
      )

      revenueOrdersCache.set(cacheKey, { rows, timestamp: Date.now() })
      hasLoadedOnceRef.current = true
      setRawOrders(rows)
    } catch (err) {
      console.error('[RevenueReport] Failed to load orders:', err)
    } finally {
      setLoading(false)
      setIsSyncing(false)
    }
  }, [])

  useEffect(() => {
    if (!activeBusiness?.id) return
    fetchRevenueOrders(activeBusiness.id, queryBounds.utcStart, queryBounds.utcEnd)
  }, [activeBusiness?.id, queryBounds.utcStart, queryBounds.utcEnd, fetchRevenueOrders])

  // Enrich & filter counted orders
  const allEnrichedOrders = useMemo(() => {
    return rawOrders
      .filter(r => isCountedStatus(r.status))
      .map(r => enrichOrderRow(r, businessTz))
      .filter(o => Boolean(o.localDate && /^\d{4}-\d{2}-\d{2}$/.test(o.localDate)))
  }, [rawOrders, businessTz])

  // Available segment options
  const availablePlatforms = useMemo(() => {
    const set = new Set<string>()
    allEnrichedOrders.forEach(o => {
      if (o.platform) set.add(o.platform)
    })
    return Array.from(set).sort()
  }, [allEnrichedOrders])

  const availablePaymentMethods = useMemo(() => {
    const set = new Set<string>()
    allEnrichedOrders.forEach(o => {
      if (o.paymentMethod) set.add(o.paymentMethod)
    })
    return Array.from(set).sort()
  }, [allEnrichedOrders])

  // Apply Segment Filters
  const segmentedOrders = useMemo(() => {
    return allEnrichedOrders.filter(o => {
      if (selectedPlatform !== 'all' && o.platform !== selectedPlatform) return false
      if (selectedPaymentMethod !== 'all' && o.paymentMethod !== selectedPaymentMethod) return false
      return true
    })
  }, [allEnrichedOrders, selectedPlatform, selectedPaymentMethod])

  // Partition into Current Period vs Comparison Period
  const { currentOrders, comparisonOrders } = useMemo(() => {
    const curr: EnrichedOrder[] = []
    const comp: EnrichedOrder[] = []

    const isAllTime = temporalFilter.preset === 'all' || (!temporalFilter.startDate && !temporalFilter.endDate)
    const cStart = temporalFilter.startDate
    const cEnd = temporalFilter.endDate
    const pStart = temporalFilter.comparisonStartDate
    const pEnd = temporalFilter.comparisonEndDate
    const hasComp = !isAllTime && temporalFilter.comparisonMode !== 'none' && Boolean(pStart && pEnd)

    for (const o of segmentedOrders) {
      if (isAllTime || (o.localDate >= cStart && o.localDate <= cEnd)) {
        curr.push(o)
      }
      if (hasComp && o.localDate >= pStart && o.localDate <= pEnd) {
        comp.push(o)
      }
    }

    return { currentOrders: curr, comparisonOrders: comp }
  }, [
    segmentedOrders,
    temporalFilter.preset,
    temporalFilter.startDate,
    temporalFilter.endDate,
    temporalFilter.comparisonMode,
    temporalFilter.comparisonStartDate,
    temporalFilter.comparisonEndDate,
  ])

  // Aggregate KPI Summary Totals (Current vs Comparison)
  const kpiSummary = useMemo(() => {
    const sumMetrics = (list: EnrichedOrder[]) => {
      let grossSales = 0
      let taxes = 0
      let shipping = 0
      let fees = 0
      let refunds = 0
      let netRevenue = 0

      for (const o of list) {
        grossSales += o.grossSales
        taxes += o.taxes
        shipping += o.shipping
        fees += o.fees
        refunds += o.refunds
        netRevenue += o.netRevenue
      }

      const orders = list.length
      const avgOrderNet = orders > 0 ? netRevenue / orders : 0
      const avgOrderGross = orders > 0 ? grossSales / orders : 0

      return { grossSales, taxes, shipping, fees, refunds, netRevenue, orders, avgOrderNet, avgOrderGross }
    }

    const curr = sumMetrics(currentOrders)
    const comp = sumMetrics(comparisonOrders)

    return {
      curr,
      comp,
      growth: {
        netRevenue: calcGrowthPct(curr.netRevenue, comp.netRevenue),
        grossSales: calcGrowthPct(curr.grossSales, comp.grossSales),
        refunds: calcGrowthPct(curr.refunds, comp.refunds),
        taxes: calcGrowthPct(curr.taxes, comp.taxes),
        shipping: calcGrowthPct(curr.shipping, comp.shipping),
        fees: calcGrowthPct(curr.fees, comp.fees),
        orders: calcGrowthPct(curr.orders, comp.orders),
        avgOrderNet: calcGrowthPct(curr.avgOrderNet, comp.avgOrderNet),
      },
    }
  }, [currentOrders, comparisonOrders])

  // Build Time-Series Buckets for Chart & Revenue Breakdown Table
  const bucketRows = useMemo<BucketRow[]>(() => {
    const bucketsTemplate = generateDateBuckets(temporalFilter.startDate, temporalFilter.endDate, granularity)
    const bucketMap = new Map<string, BucketRow>()

    bucketsTemplate.forEach(b => {
      bucketMap.set(b.key, {
        key: b.key,
        label: b.label,
        sortKey: b.sortKey,
        orders: 0,
        grossSales: 0,
        taxes: 0,
        shipping: 0,
        fees: 0,
        refunds: 0,
        netRevenue: 0,
        compOrders: 0,
        compGrossSales: 0,
        compNetRevenue: 0,
      })
    })

    for (const o of currentOrders) {
      const b = getBucketKeyAndLabel(o.localDate, granularity)
      let entry = bucketMap.get(b.key)
      if (!entry) {
        entry = {
          key: b.key,
          label: b.label,
          sortKey: b.sortKey,
          orders: 0,
          grossSales: 0,
          taxes: 0,
          shipping: 0,
          fees: 0,
          refunds: 0,
          netRevenue: 0,
          compOrders: 0,
          compGrossSales: 0,
          compNetRevenue: 0,
        }
        bucketMap.set(b.key, entry)
      }
      entry.orders += 1
      entry.grossSales += o.grossSales
      entry.taxes += o.taxes
      entry.shipping += o.shipping
      entry.fees += o.fees
      entry.refunds += o.refunds
      entry.netRevenue += o.netRevenue
    }

    // Align comparison buckets by index
    if (temporalFilter.comparisonMode !== 'none' && temporalFilter.comparisonStartDate && temporalFilter.comparisonEndDate) {
      const compTemplate = generateDateBuckets(temporalFilter.comparisonStartDate, temporalFilter.comparisonEndDate, granularity)
      const compMap = new Map<string, { orders: number; gross: number; net: number }>()
      compTemplate.forEach(cb => compMap.set(cb.key, { orders: 0, gross: 0, net: 0 }))

      for (const co of comparisonOrders) {
        const cb = getBucketKeyAndLabel(co.localDate, granularity)
        const existing = compMap.get(cb.key) || { orders: 0, gross: 0, net: 0 }
        existing.orders += 1
        existing.gross += co.grossSales
        existing.net += co.netRevenue
        compMap.set(cb.key, existing)
      }

      const currKeys = Array.from(bucketMap.keys())
      const compVals = Array.from(compMap.values())
      currKeys.forEach((k, idx) => {
        const item = bucketMap.get(k)
        const cVal = compVals[idx]
        if (item && cVal) {
          item.compOrders = cVal.orders
          item.compGrossSales = cVal.gross
          item.compNetRevenue = cVal.net
        }
      })
    }

    return Array.from(bucketMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }, [
    currentOrders,
    comparisonOrders,
    temporalFilter.startDate,
    temporalFilter.endDate,
    temporalFilter.comparisonMode,
    temporalFilter.comparisonStartDate,
    temporalFilter.comparisonEndDate,
    granularity,
  ])

  // For the Breakdown Table: filter to buckets that have orders (or show all if none have orders) and apply sorting
  const sortedTableRows = useMemo(() => {
    const nonEmpty = bucketRows.filter(r => r.orders > 0)
    const base = nonEmpty.length > 0 ? nonEmpty : bucketRows

    return [...base].sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') cmp = a.sortKey.localeCompare(b.sortKey)
      else cmp = (a[sortField] as number) - (b[sortField] as number)
      return sortOrder === 'asc' ? cmp : -cmp
    })
  }, [bucketRows, sortField, sortOrder])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder(field === 'date' ? 'asc' : 'desc')
    }
  }

  // Build Grouped By rows helper
  const buildGroupedRows = useCallback(
    (dim: GroupDimension | SecondaryGroupDimension): GroupedRow[] => {
      const map = new Map<string, { label: string; flag?: string; orders: number; net: number; gross: number; taxes: number; shipping: number }>()

      for (const o of currentOrders) {
        let key = ''
        let label = ''
        let flag: string | undefined

        if (dim === 'country') {
          key = o.country || 'ID'
          const cInfo = COUNTRY_NAMES[key]
          label = cInfo ? cInfo.name : key
          flag = cInfo ? cInfo.flag : '🌐'
        } else if (dim === 'city') {
          key = o.city || 'Tidak Diketahui'
          label = key
        } else if (dim === 'province') {
          key = o.province || 'Tidak Diketahui'
          label = key
        } else if (dim === 'platform') {
          key = o.platform || 'Manual'
          label = key
        } else if (dim === 'payment_method') {
          key = o.paymentMethod || 'Manual / Tunai'
          label = key
        } else if (dim === 'courier') {
          key = o.courier || 'Tanpa Ekspedisi'
          label = key
        } else if (dim === 'tax_code') {
          if (!o.taxCode && o.taxes <= 0) continue
          key = o.taxCode || 'PPN / Pajak Standar'
          label = key
        }

        const existing = map.get(key) || { label, flag, orders: 0, net: 0, gross: 0, taxes: 0, shipping: 0 }
        existing.orders += 1
        existing.net += o.netRevenue
        existing.gross += o.grossSales
        existing.taxes += o.taxes
        existing.shipping += o.shipping
        map.set(key, existing)
      }

      return Array.from(map.entries())
        .map(([key, val]) => ({
          key,
          label: val.label,
          flag: val.flag,
          orders: val.orders,
          netRevenue: val.net,
          avgNet: val.orders > 0 ? val.net / val.orders : 0,
          grossSales: val.gross,
          avgGross: val.orders > 0 ? val.gross / val.orders : 0,
          taxes: val.taxes,
          shipping: val.shipping,
        }))
        .sort((a, b) => b.netRevenue - a.netRevenue)
    },
    [currentOrders]
  )

  const primaryGroupedRows = useMemo(() => buildGroupedRows(primaryGroupDim), [buildGroupedRows, primaryGroupDim])
  const secondaryGroupedRows = useMemo(() => buildGroupedRows(secondaryGroupDim), [buildGroupedRows, secondaryGroupDim])

  // Export Handlers
  const handleExportBreakdown = () => {
    const exportData = sortedTableRows.map(r => ({
      Date: r.label,
      Orders: r.orders,
      'Gross Sales (Rp)': Math.round(r.grossSales),
      'Taxes (Rp)': Math.round(r.taxes),
      'Shipping (Rp)': -Math.round(r.shipping),
      'Fees (Rp)': -Math.round(r.fees),
      'Refunds (Rp)': -Math.round(r.refunds),
      'Net Revenue (Rp)': Math.round(r.netRevenue),
    }))

    exportData.push({
      Date: 'Totals',
      Orders: kpiSummary.curr.orders,
      'Gross Sales (Rp)': Math.round(kpiSummary.curr.grossSales),
      'Taxes (Rp)': Math.round(kpiSummary.curr.taxes),
      'Shipping (Rp)': -Math.round(kpiSummary.curr.shipping),
      'Fees (Rp)': -Math.round(kpiSummary.curr.fees),
      'Refunds (Rp)': -Math.round(kpiSummary.curr.refunds),
      'Net Revenue (Rp)': Math.round(kpiSummary.curr.netRevenue),
    })

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue Breakdown')
    XLSX.writeFile(wb, `Revenue_Breakdown_${temporalFilter.startDate}_to_${temporalFilter.endDate}.xlsx`)
  }

  const handleExportGrouped = (rows: GroupedRow[], dimName: string) => {
    const exportData = rows.map(r => ({
      [dimName]: r.label,
      Orders: r.orders,
      'Net Revenue (Rp)': Math.round(r.netRevenue),
      'Average Net (Rp)': Math.round(r.avgNet),
      'Gross Sales (Rp)': Math.round(r.grossSales),
      'Average Gross (Rp)': Math.round(r.avgGross),
    }))
    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Grouped Revenue')
    XLSX.writeFile(wb, `Revenue_Grouped_${dimName}_${temporalFilter.startDate}.xlsx`)
  }

  // Chart Y-Axis Scale Calculation
  const chartScale = useMemo(() => {
    const maxVal = Math.max(
      ...bucketRows.map(b => Math.max(b.grossSales, showCompareOnChart ? b.compGrossSales : 0)),
      1
    )
    // Round up to a clean nice number for 8 ticks
    const roughStep = maxVal / 7
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep || 1)))
    const residual = roughStep / mag
    let step = mag
    if (residual > 5) step = 10 * mag
    else if (residual > 2) step = 5 * mag
    else if (residual > 1) step = 2 * mag

    const topMax = Math.max(step * 7, 1000000)
    const ticks: number[] = []
    for (let i = 7; i >= 0; i--) {
      ticks.push((topMax / 7) * i)
    }
    return { max: topMax, ticks }
  }, [bucketRows, showCompareOnChart])

  const renderGrowthPill = (pct: number, reverse = false) => {
    const rounded = Math.round(pct * 10) / 10
    const isZero = Math.abs(rounded) < 0.1
    if (isZero || temporalFilter.comparisonMode === 'none') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">
          0%
        </span>
      )
    }
    const isPositive = rounded > 0
    const isGood = reverse ? !isPositive : isPositive
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
          isGood ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
        }`}
      >
        {isPositive ? '+' : ''}
        {rounded.toFixed(1)}%
      </span>
    )
  }

  const dimensionLabelMap: Record<string, string> = {
    country: 'Billing Country',
    city: 'Kota / Kabupaten',
    province: 'Provinsi',
    platform: 'Platform / Channel',
    payment_method: 'Metode Pembayaran',
    courier: 'Kurir Ekspedisi',
    tax_code: 'Tax Rate Code',
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-slate-800 p-4 sm:p-6 md:p-8 space-y-6">
      <div className="max-w-[1360px] mx-auto space-y-5">

        {/* ── TOP HEADER BAR (Metorik Style) ─────────────────────────────── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => router.back()}
              className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 shadow-2xs transition cursor-pointer"
              title="Kembali"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Revenue
            </h1>

            {/* Segment Filter Button & Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSegmentOpen(prev => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer shadow-2xs ${
                  selectedPlatform !== 'all' || selectedPaymentMethod !== 'all'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-indigo-600 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/40'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                <span>Segment</span>
                {(selectedPlatform !== 'all' || selectedPaymentMethod !== 'all') && (
                  <span className="ml-0.5 px-1.5 py-0.2 bg-white/20 rounded-full text-[10px]">
                    Aktif
                  </span>
                )}
              </button>

              {isSegmentOpen && (
                <div className="absolute left-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-4 z-40 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Filter Segmen Pesanan</span>
                    <button
                      type="button"
                      onClick={() => setIsSegmentOpen(false)}
                      className="text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Platform / Channel</label>
                    <select
                      value={selectedPlatform}
                      onChange={e => setSelectedPlatform(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="all">Semua Platform ({availablePlatforms.length})</option>
                      {availablePlatforms.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Metode Pembayaran</label>
                    <select
                      value={selectedPaymentMethod}
                      onChange={e => setSelectedPaymentMethod(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="all">Semua Metode Bayar ({availablePaymentMethods.length})</option>
                      {availablePaymentMethods.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  {(selectedPlatform !== 'all' || selectedPaymentMethod !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPlatform('all')
                        setSelectedPaymentMethod('all')
                      }}
                      className="w-full py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 transition cursor-pointer"
                    >
                      Reset Filter Segmen
                    </button>
                  )}
                </div>
              )}
            </div>

            {isSyncing && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                Menyinkronkan...
              </span>
            )}
          </div>

          {/* Lifetimely / Metorik Grade Date & Comparison Filter */}
          <div className="flex items-center justify-end">
            <TemporalDateFilter
              value={temporalFilter}
              onChange={setTemporalFilter}
              timezone={activeBusiness?.timezone}
              showComparison={true}
              allowAllTime={true}
            />
          </div>
        </div>

        {/* ── SUBTITLE & VIEW ORDERS LINK ────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600 border-b border-slate-200/80 pb-3">
          <p>
            <strong className="font-bold text-slate-900">Net revenue</strong> yang Anda terima pada periode ini — penjualan kotor (gross sales) dikurangi pajak, ongkos kirim, biaya admin/layanan, dan refund.
          </p>
          <Link
            href="/orders"
            className="text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center gap-1 shrink-0 hover:underline"
          >
            <span>Lihat pesanan di laporan ini</span>
            <span>&rsaquo;</span>
          </Link>
        </div>

        {/* ── SECTION 1: CHART (LEFT) + KPI SUMMARY GRID (RIGHT) ─────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">

          {/* LEFT: Revenue Bar / Line Chart Card (8 Cols) */}
          <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between">
            {/* Card Header */}
            <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-extrabold text-slate-900">Revenue</h2>
                <button
                  type="button"
                  onClick={handleExportBreakdown}
                  title="Download Data Grafik (Excel)"
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>

              {/* Chart Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowCompareOnChart(prev => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    showCompareOnChart
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span>⇄</span>
                  <span>Compare</span>
                </button>

                {/* Bar vs Line Toggle */}
                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white">
                  <button
                    type="button"
                    onClick={() => setChartType('bar')}
                    className={`p-1.5 transition cursor-pointer ${
                      chartType === 'bar'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500 hover:bg-slate-50'
                    }`}
                    title="Bar Chart"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartType('line')}
                    className={`p-1.5 transition cursor-pointer border-l border-slate-200 ${
                      chartType === 'line'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500 hover:bg-slate-50'
                    }`}
                    title="Line Chart"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <polyline points="22 12 18 8 13 15 9 11 2 18" />
                    </svg>
                  </button>
                </div>

                {/* Granularity Selector */}
                <select
                  value={granularity}
                  onChange={e => setGranularity(e.target.value as Granularity)}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </div>
            </div>

            {/* Chart Body */}
            <div className="p-5 flex-1 flex flex-col justify-between relative min-h-[340px]">
              {/* Hover Tooltip Banner */}
              {hoveredBucket && (
                <div className="absolute top-3 right-5 z-20 bg-slate-900/95 text-white px-3.5 py-2.5 rounded-xl shadow-lg text-xs flex flex-wrap items-center gap-4 pointer-events-none border border-slate-700">
                  <span className="font-extrabold text-amber-300">{hoveredBucket.label}</span>
                  <span>
                    Net: <strong className="font-mono">{formatIDR(hoveredBucket.netRevenue)}</strong>
                  </span>
                  <span>
                    Gross: <strong className="font-mono text-indigo-300">{formatIDR(hoveredBucket.grossSales)}</strong>
                  </span>
                  <span>
                    Orders: <strong>{hoveredBucket.orders}</strong>
                  </span>
                </div>
              )}

              {loading ? (
                <div className="flex-1 flex items-center justify-center text-xs font-bold text-slate-400 animate-pulse">
                  Memuat grafik Revenue...
                </div>
              ) : bucketRows.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-xs font-semibold text-slate-400">
                  Tidak ada data transaksi pada rentang tanggal ini.
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-between">
                  {/* Plot Area with Y-Axis */}
                  <div className="relative flex-1 flex min-h-[260px]">
                    {/* Y-Axis Labels */}
                    <div className="w-28 pr-3 flex flex-col justify-between text-[10px] font-mono text-slate-400 text-right select-none py-1">
                      {chartScale.ticks.map((t, i) => (
                        <span key={i} className="leading-none">{formatAxisIDR(t)}</span>
                      ))}
                    </div>

                    {/* Grid + Bars / Lines */}
                    <div className="flex-1 relative border-b border-slate-200">
                      {/* Horizontal Grid Lines */}
                      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none py-1">
                        {chartScale.ticks.map((_, i) => (
                          <div key={i} className="w-full border-b border-dashed border-slate-100" />
                        ))}
                      </div>

                      {chartType === 'bar' ? (
                        <div className="absolute inset-0 flex items-end justify-between gap-1 sm:gap-2 px-2 pt-2">
                          {bucketRows.map((b) => {
                            const grossPct = Math.min(100, (b.grossSales / chartScale.max) * 100)
                            const netPct = Math.min(100, (b.netRevenue / chartScale.max) * 100)
                            const deductionPct = Math.max(0, grossPct - netPct)
                            const compGrossPct = Math.min(100, (b.compGrossSales / chartScale.max) * 100)

                            return (
                              <div
                                key={b.key}
                                onMouseEnter={() => setHoveredBucket(b)}
                                onMouseLeave={() => setHoveredBucket(null)}
                                className="flex-1 h-full flex items-end justify-center gap-0.5 group cursor-pointer relative"
                              >
                                {showCompareOnChart && (
                                  <div
                                    style={{ height: `${Math.max(compGrossPct, b.compGrossSales > 0 ? 1.5 : 0)}%` }}
                                    className="w-1/3 max-w-[18px] bg-slate-200 border border-slate-300 rounded-t-xs transition-all duration-300"
                                    title={`Pembanding (${b.label}): ${formatIDR(b.compNetRevenue)}`}
                                  />
                                )}

                                {/* Stacked Metorik Bar: Top Light Cap (Gross - Net) + Bottom Solid Bar (Net Revenue) */}
                                <div
                                  style={{ height: `${Math.max(grossPct, b.grossSales > 0 ? 2 : 0)}%` }}
                                  className="w-full max-w-[44px] flex flex-col justify-end rounded-t-xs overflow-hidden transition-all duration-300 group-hover:brightness-95"
                                >
                                  {deductionPct > 0 && (
                                    <div
                                      style={{ height: `${(deductionPct / (grossPct || 1)) * 100}%` }}
                                      className="w-full bg-[#D9DDFB] border-t-2 border-x-2 border-[#6C72EE]"
                                    />
                                  )}
                                  <div
                                    style={{ height: `${(netPct / (grossPct || 1)) * 100}%` }}
                                    className="w-full bg-[#8B92F8] border-2 border-[#6C72EE] flex-1"
                                  />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        /* Line Chart Mode */
                        <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                          {/* Gross Sales Line */}
                          <polyline
                            fill="none"
                            stroke="#C7D2FE"
                            strokeWidth="2"
                            points={bucketRows
                              .map((b, i) => {
                                const x = bucketRows.length <= 1 ? 50 : (i / (bucketRows.length - 1)) * 100
                                const y = 100 - Math.min(100, (b.grossSales / chartScale.max) * 100)
                                return `${x},${y}`
                              })
                              .join(' ')}
                          />
                          {/* Net Revenue Line */}
                          <polyline
                            fill="none"
                            stroke="#6366F1"
                            strokeWidth="2.5"
                            points={bucketRows
                              .map((b, i) => {
                                const x = bucketRows.length <= 1 ? 50 : (i / (bucketRows.length - 1)) * 100
                                const y = 100 - Math.min(100, (b.netRevenue / chartScale.max) * 100)
                                return `${x},${y}`
                              })
                              .join(' ')}
                          />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* X-Axis Labels */}
                  <div className="flex pl-28 pt-2.5">
                    <div className="flex-1 flex items-center justify-between px-2 text-[10px] font-semibold text-slate-500">
                      {bucketRows.map((b, idx) => {
                        // Show every 2nd label if compact to avoid crowding, just like Metorik
                        const step = bucketRows.length > 8 ? 2 : 1
                        const showLabel = idx % step === 0 || idx === bucketRows.length - 1
                        return (
                          <div key={b.key} className="flex-1 text-center truncate">
                            {showLabel ? b.label : ''}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Metorik KPI Summary Grid Card (4 Cols) */}
          <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between overflow-hidden divide-y divide-slate-100">
            {/* Top Primary Metric: Net Revenue */}
            <div className="p-5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span>Net Revenue</span>
                <span className="w-2 h-2 rounded-full bg-[#6C72EE] inline-block" />
              </div>
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  {formatIDR(kpiSummary.curr.netRevenue)}
                </span>
                {renderGrowthPill(kpiSummary.growth.netRevenue)}
              </div>
            </div>

            {/* Row 2: Gross Sales | Refunds */}
            <div className="grid grid-cols-2 divide-x divide-slate-100">
              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  <span>Gross Sales</span>
                  <span className="w-2 h-2 rounded-full bg-[#C7D2FE] border border-[#6C72EE] inline-block" />
                </div>
                <div className="text-sm sm:text-base font-extrabold text-slate-900">
                  {formatIDR(kpiSummary.curr.grossSales)}
                </div>
                <div>{renderGrowthPill(kpiSummary.growth.grossSales)}</div>
              </div>

              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  <span>Refunds</span>
                  <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />
                </div>
                <div className="text-sm sm:text-base font-extrabold text-slate-900">
                  {formatIDR(kpiSummary.curr.refunds)}
                </div>
                <div>{renderGrowthPill(kpiSummary.growth.refunds, true)}</div>
              </div>
            </div>

            {/* Row 3: Taxes | Shipping */}
            <div className="grid grid-cols-2 divide-x divide-slate-100">
              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  <span>Taxes</span>
                  <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />
                </div>
                <div className="text-sm sm:text-base font-extrabold text-slate-900">
                  {formatIDR(kpiSummary.curr.taxes)}
                </div>
                <div>{renderGrowthPill(kpiSummary.growth.taxes)}</div>
              </div>

              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  <span>Shipping</span>
                  <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />
                </div>
                <div className="text-sm sm:text-base font-extrabold text-slate-900">
                  {formatIDR(kpiSummary.curr.shipping)}
                </div>
                <div>{renderGrowthPill(kpiSummary.growth.shipping)}</div>
              </div>
            </div>

            {/* Row 4: Fees */}
            <div className="p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                <span>Fees</span>
                <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />
              </div>
              <div className="text-sm sm:text-base font-extrabold text-slate-900">
                {formatIDR(kpiSummary.curr.fees)}
              </div>
              <div>{renderGrowthPill(kpiSummary.growth.fees)}</div>
            </div>

            {/* Row 5: Orders | Average order net */}
            <div className="grid grid-cols-2 divide-x divide-slate-100 bg-slate-50/40">
              <div className="p-4 space-y-1">
                <div className="text-[11px] font-bold text-slate-500">Orders</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-base sm:text-lg font-extrabold text-slate-900">
                    {formatNumber(kpiSummary.curr.orders)}
                  </span>
                  {renderGrowthPill(kpiSummary.growth.orders)}
                </div>
              </div>

              <div className="p-4 space-y-1">
                <div className="text-[11px] font-bold text-slate-500">Average order net</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-base sm:text-lg font-extrabold text-slate-900">
                    {formatIDR(kpiSummary.curr.avgOrderNet)}
                  </span>
                  {renderGrowthPill(kpiSummary.growth.avgOrderNet)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── SECTION 2: REVENUE BREAKDOWN TABLE ─────────────────────────── */}
        <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-extrabold text-slate-900">Revenue Breakdown</h2>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportBreakdown}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-2xs"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Export</span>
              </button>

              <select
                value={granularity}
                onChange={e => setGranularity(e.target.value as Granularity)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[780px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-600 font-bold">
                  {(
                    [
                      { key: 'date', label: 'Date' },
                      { key: 'orders', label: 'Orders' },
                      { key: 'grossSales', label: 'Gross Sales' },
                      { key: 'taxes', label: 'Taxes' },
                      { key: 'shipping', label: 'Shipping' },
                      { key: 'fees', label: 'Fees' },
                      { key: 'refunds', label: 'Refunds' },
                      { key: 'netRevenue', label: 'Net' },
                    ] as Array<{ key: SortField; label: string }>
                  ).map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="py-3 px-4 cursor-pointer select-none hover:text-slate-900 transition"
                    >
                      <div className="inline-flex items-center gap-1">
                        <span>{col.label}</span>
                        <span className="text-[10px] text-slate-400">
                          {sortField === col.key ? (sortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400 font-semibold">
                      Memuat rincian Revenue Breakdown...
                    </td>
                  </tr>
                ) : sortedTableRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400 font-semibold">
                      Belum ada data transaksi pada periode ini.
                    </td>
                  </tr>
                ) : (
                  sortedTableRows.map(row => (
                    <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-700 whitespace-nowrap">
                        {row.label}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href="/orders"
                          className="text-indigo-600 hover:text-indigo-800 font-bold underline decoration-indigo-300 underline-offset-2"
                        >
                          {formatNumber(row.orders)}
                        </Link>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700 whitespace-nowrap">
                        {formatIDR(row.grossSales)}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-600 whitespace-nowrap">
                        {formatIDR(row.taxes)}
                      </td>
                      <td className="py-3 px-4 font-medium whitespace-nowrap">
                        {row.shipping > 0 ? (
                          <span className="text-rose-500">({formatIDR(row.shipping)})</span>
                        ) : (
                          <span className="text-slate-600">{formatIDR(0)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium whitespace-nowrap">
                        {row.fees > 0 ? (
                          <span className="text-rose-500">({formatIDR(row.fees)})</span>
                        ) : (
                          <span className="text-slate-600">{formatIDR(0)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium whitespace-nowrap">
                        {row.refunds > 0 ? (
                          <span className="text-rose-500">({formatIDR(row.refunds)})</span>
                        ) : (
                          <span className="text-slate-600">{formatIDR(0)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-extrabold text-slate-900 whitespace-nowrap">
                        {formatIDR(row.netRevenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>

              {!loading && sortedTableRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-extrabold text-slate-900">
                    <td className="py-3.5 px-4">Totals</td>
                    <td className="py-3.5 px-4">{formatNumber(kpiSummary.curr.orders)}</td>
                    <td className="py-3.5 px-4 whitespace-nowrap">{formatIDR(kpiSummary.curr.grossSales)}</td>
                    <td className="py-3.5 px-4 whitespace-nowrap">{formatIDR(kpiSummary.curr.taxes)}</td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {kpiSummary.curr.shipping > 0
                        ? `(${formatIDR(kpiSummary.curr.shipping)})`
                        : formatIDR(0)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {kpiSummary.curr.fees > 0
                        ? `(${formatIDR(kpiSummary.curr.fees)})`
                        : formatIDR(0)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {kpiSummary.curr.refunds > 0
                        ? `(${formatIDR(kpiSummary.curr.refunds)})`
                        : formatIDR(0)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">{formatIDR(kpiSummary.curr.netRevenue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── SECTION 3: GROUPED BY (PRIMARY DIMENSION, e.g. Billing Country / City / Platform) ── */}
        <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-extrabold text-slate-900">Grouped by</span>
              <select
                value={primaryGroupDim}
                onChange={e => setPrimaryGroupDim(e.target.value as GroupDimension)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
              >
                <option value="country">Billing Country</option>
                <option value="city">Kota / Kabupaten</option>
                <option value="province">Provinsi</option>
                <option value="platform">Platform / Channel</option>
                <option value="payment_method">Metode Pembayaran</option>
                <option value="courier">Kurir Ekspedisi</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleExportGrouped(primaryGroupedRows, dimensionLabelMap[primaryGroupDim])}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition cursor-pointer shadow-2xs"
                title="Export Grouped Data"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-600 font-bold">
                  <th className="py-3 px-5">{dimensionLabelMap[primaryGroupDim]} ⇅</th>
                  <th className="py-3 px-4 text-right">Orders ⇅</th>
                  <th className="py-3 px-4 text-right">Net Revenue ⇅</th>
                  <th className="py-3 px-4 text-right">Average Net ⇅</th>
                  <th className="py-3 px-4 text-right">Gross Sales ⇅</th>
                  <th className="py-3 px-5 text-right">Average Gross ⇅</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {primaryGroupedRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
                      No matching results
                    </td>
                  </tr>
                ) : (
                  primaryGroupedRows.slice(0, 25).map(row => (
                    <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-5 font-semibold text-slate-800">
                        <span className="inline-flex items-center gap-2">
                          {row.flag && <span>{row.flag}</span>}
                          <span className="underline decoration-slate-300 underline-offset-2">{row.label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-indigo-600">
                        {formatNumber(row.orders)}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-700">
                        {formatIDR(row.netRevenue)}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-600">
                        {formatIDR(row.avgNet)}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-700">
                        {formatIDR(row.grossSales)}
                      </td>
                      <td className="py-3 px-5 text-right font-medium text-slate-600">
                        {formatIDR(row.avgGross)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── SECTION 4: GROUPED BY (SECONDARY DIMENSION, e.g. Tax Rate Code / Platform) ── */}
        <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-extrabold text-slate-900">Grouped by</span>
              <select
                value={secondaryGroupDim}
                onChange={e => setSecondaryGroupDim(e.target.value as SecondaryGroupDimension)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
              >
                <option value="tax_code">Tax Rate Code</option>
                <option value="platform">Platform / Channel</option>
                <option value="payment_method">Metode Pembayaran</option>
                <option value="courier">Kurir Ekspedisi</option>
                <option value="city">Kota / Kabupaten</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleExportGrouped(secondaryGroupedRows, dimensionLabelMap[secondaryGroupDim])}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition cursor-pointer shadow-2xs"
                title="Export Grouped Data"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {secondaryGroupDim === 'tax_code' ? (
              <table className="w-full text-left border-collapse text-xs min-w-[720px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-600 font-bold">
                    <th className="py-3 px-5">Tax Rate Code ⇅</th>
                    <th className="py-3 px-4 text-right">Orders ⇅</th>
                    <th className="py-3 px-4 text-right">Net Tax ⇅</th>
                    <th className="py-3 px-4 text-right">Refunded Tax ⇅</th>
                    <th className="py-3 px-4 text-right">Total Tax ⇅</th>
                    <th className="py-3 px-4 text-right">Shipping Tax ⇅</th>
                    <th className="py-3 px-5 text-right">Taxed Sales (Net) ⇅</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {secondaryGroupedRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 font-medium">
                        No matching results
                      </td>
                    </tr>
                  ) : (
                    secondaryGroupedRows.map(row => (
                      <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-5 font-semibold text-slate-800">{row.label}</td>
                        <td className="py-3 px-4 text-right font-bold text-indigo-600">{formatNumber(row.orders)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-700">{formatIDR(row.taxes)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-600">{formatIDR(0)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-700">{formatIDR(row.taxes)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-600">{formatIDR(0)}</td>
                        <td className="py-3 px-5 text-right font-medium text-slate-800">{formatIDR(row.netRevenue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left border-collapse text-xs min-w-[720px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-600 font-bold">
                    <th className="py-3 px-5">{dimensionLabelMap[secondaryGroupDim]} ⇅</th>
                    <th className="py-3 px-4 text-right">Orders ⇅</th>
                    <th className="py-3 px-4 text-right">Net Revenue ⇅</th>
                    <th className="py-3 px-4 text-right">Average Net ⇅</th>
                    <th className="py-3 px-4 text-right">Gross Sales ⇅</th>
                    <th className="py-3 px-5 text-right">Average Gross ⇅</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {secondaryGroupedRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
                        No matching results
                      </td>
                    </tr>
                  ) : (
                    secondaryGroupedRows.slice(0, 25).map(row => (
                      <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-5 font-semibold text-slate-800">{row.label}</td>
                        <td className="py-3 px-4 text-right font-bold text-indigo-600">{formatNumber(row.orders)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-700">{formatIDR(row.netRevenue)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-600">{formatIDR(row.avgNet)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-700">{formatIDR(row.grossSales)}</td>
                        <td className="py-3 px-5 text-right font-medium text-slate-600">{formatIDR(row.avgGross)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
