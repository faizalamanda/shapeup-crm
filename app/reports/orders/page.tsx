"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { usePageBackNavigation } from '@/hooks/usePageBackNavigation'
import { TemporalDateFilter, TemporalFilterValue } from '@/components/ui/TemporalDateFilter'
import {
  getLocalDateRangeLimits,
  getBusinessTimezone,
  localDateToUtcBounds,
  resolveComparisonRange,
} from '@/lib/localzone'

// ─── Types ────────────────────────────────────────────────────────────────────
type Granularity = 'day' | 'week' | 'month'
type CompletionUnit = 'day' | 'hour'
type CompletionScope = 'all' | 'non_pos' | 'has_date_completed'
type HeatmapMetric = 'orders' | 'gross_sales' | 'net_sales'

type OrderSummary = {
  orders: number
  items: number
  net_sales: number
  gross_sales: number
  avg_net: number
  avg_gross: number
  avg_items: number
  refunds: number
  discounts: number
  taxes: number
  shipping: number
  fees: number
  active_buckets: number
}

type NvrSegment = {
  customers: number
  orders: number
  net_sales: number
  avg_net: number
  gross_sales: number
  avg_gross: number
}

type TimeSeriesPoint = {
  bucket_date: string
  orders: number
  items: number
  gross_sales: number
  net_sales: number
  avg_gross: number
  avg_items: number
}

type BucketCount = {
  bucket_key: string
  orders: number
}

type DayPoint = {
  dow: number
  orders: number
  gross_sales: number
  net_sales: number
}

type HourPoint = {
  hour: number
  orders: number
  gross_sales: number
  net_sales: number
}

type HeatmapCell = {
  dow: number
  hour: number
  orders: number
  gross_sales: number
  net_sales: number
}

type CompletionStats = {
  completed_orders: number
  avg_hours: number
  median_hours: number
  max_hours: number
  within_1d_pct: number
  within_3d_pct: number
}

type OrdersReportRpcResponse = {
  summary: OrderSummary
  new_vs_returning: {
    new: NvrSegment
    returning: NvrSegment
  }
  time_series: TimeSeriesPoint[]
  item_buckets: BucketCount[]
  value_buckets: BucketCount[]
  by_day: DayPoint[]
  by_hour: HourPoint[]
  heatmap: HeatmapCell[]
  completion: {
    stats: CompletionStats
    buckets: BucketCount[]
  }
  platforms: string[]
}

// ─── L1 In-Memory Cache (TTL 60s) ─────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 1000
const ordersReportCache = new Map<string, { data: OrdersReportRpcResponse; timestamp: number }>()

const EMPTY_SUMMARY: OrderSummary = {
  orders: 0,
  items: 0,
  net_sales: 0,
  gross_sales: 0,
  avg_net: 0,
  avg_gross: 0,
  avg_items: 0,
  refunds: 0,
  discounts: 0,
  taxes: 0,
  shipping: 0,
  fees: 0,
  active_buckets: 0,
}

const EMPTY_NVR: NvrSegment = {
  customers: 0,
  orders: 0,
  net_sales: 0,
  avg_net: 0,
  gross_sales: 0,
  avg_gross: 0,
}

const EMPTY_RESPONSE: OrdersReportRpcResponse = {
  summary: EMPTY_SUMMARY,
  new_vs_returning: { new: EMPTY_NVR, returning: EMPTY_NVR },
  time_series: [],
  item_buckets: [],
  value_buckets: [],
  by_day: [],
  by_hour: [],
  heatmap: [],
  completion: {
    stats: {
      completed_orders: 0,
      avg_hours: 0,
      median_hours: 0,
      max_hours: 0,
      within_1d_pct: 0,
      within_3d_pct: 0,
    },
    buckets: [],
  },
  platforms: [],
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(val || 0))

const formatCompactIDR = (val: number) => {
  const abs = Math.abs(val || 0)
  if (abs >= 1_000_000_000) return `Rp${(val / 1_000_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `Rp${(val / 1_000_000).toFixed(1)}jt`
  if (abs >= 1_000) return `Rp${Math.round(val / 1_000)}rb`
  return `Rp${Math.round(val)}`
}

const formatInt = (val: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(val || 0))

const formatDec = (val: number, digits = 2) =>
  new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(val || 0)

function calcDeltaPct(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return curr > 0 ? 100 : 0
  return ((curr - prev) / Math.abs(prev)) * 100
}

function computeTightYAxis(rawMax: number, minStepFloor = 4): { max: number; ticks: number[] } {
  const safeMax = Math.max(rawMax * 1.08, minStepFloor)
  const magnitude = Math.pow(10, Math.floor(Math.log10(safeMax)))
  const norm = safeMax / magnitude
  const ladder = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const chosen = ladder.find((v) => v >= norm) ?? 10
  const max = chosen * magnitude
  return {
    max,
    ticks: [0, max * 0.25, max * 0.5, max * 0.75, max],
  }
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const DAY_NAMES = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const DAY_SHORT = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

function formatBucketLabel(ymd: string, gran: Granularity): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '-'
  const [y, m, d] = ymd.split('-').map(Number)
  const mName = MONTH_SHORT[(m - 1) % 12] || String(m)
  const shortYear = String(y).slice(-2)
  if (gran === 'month') return `${mName} '${shortYear}`
  return `${d} ${mName}`
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function DeltaBadge({
  curr,
  prev,
  show,
  reversePolarity = false,
}: {
  curr: number
  prev: number
  show: boolean
  reversePolarity?: boolean
}) {
  if (!show) return null
  const pct = calcDeltaPct(curr, prev)
  if (pct === null) return null
  const rounded = Math.round(pct)
  const isZero = rounded === 0
  const isPositive = rounded > 0
  const good = reversePolarity ? !isPositive : isPositive

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold ${
        isZero
          ? 'bg-slate-100 text-slate-500'
          : good
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-rose-50 text-rose-700'
      }`}
    >
      {isPositive ? `+${rounded}%` : `${rounded}%`}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OrdersReportPage() {
  const goBack = usePageBackNavigation({ mobileFallback: '/onboarding' })
  const { activeBusiness } = useUserContext()
  const businessTz = getBusinessTimezone(activeBusiness?.timezone)

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

  // Controls
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [showCompareOnChart, setShowCompareOnChart] = useState<boolean>(true)
  const [excludeGuest, setExcludeGuest] = useState<boolean>(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [isSegmentOpen, setIsSegmentOpen] = useState<boolean>(false)
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>('orders')
  const [completionUnit, setCompletionUnit] = useState<CompletionUnit>('day')
  const [completionScope, setCompletionScope] = useState<CompletionScope>('all')

  // Data state
  const [data, setData] = useState<OrdersReportRpcResponse>(EMPTY_RESPONSE)
  const [compData, setCompData] = useState<OrdersReportRpcResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [hoveredTsIdx, setHoveredTsIdx] = useState<number | null>(null)

  const requestIdRef = useRef(0)

  const fetchMetricsForRange = useCallback(
    async (
      bizId: string,
      startDateStr: string,
      endDateStr: string
    ): Promise<OrdersReportRpcResponse> => {
      const startIso = localDateToUtcBounds(startDateStr, businessTz).startOfDayISO
      const endIso = localDateToUtcBounds(endDateStr, businessTz).endOfDayISO
      const cacheKey = [
        bizId,
        startIso,
        endIso,
        businessTz,
        granularity,
        completionUnit,
        excludeGuest ? '1' : '0',
        completionScope,
        selectedPlatform,
      ].join('|')

      const cached = ordersReportCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data
      }

      const { data: rpcData, error } = await supabase.rpc('get_orders_report_metrics', {
        p_business_id: bizId,
        p_start_date: startIso,
        p_end_date: endIso,
        p_timezone: businessTz,
        p_granularity: granularity,
        p_time_unit: completionUnit,
        p_exclude_guest: excludeGuest,
        p_completion_scope: completionScope,
        p_platform: selectedPlatform,
      })

      if (error) throw error

      const parsed = (rpcData || EMPTY_RESPONSE) as OrdersReportRpcResponse
      ordersReportCache.set(cacheKey, { data: parsed, timestamp: Date.now() })
      return parsed
    },
    [businessTz, granularity, completionUnit, excludeGuest, completionScope, selectedPlatform]
  )

  const loadReport = useCallback(async () => {
    const bizId = activeBusiness?.id
    if (!bizId) return

    const reqId = ++requestIdRef.current
    setLoading(true)
    setErrorMsg(null)

    try {
      const hasComp =
        temporalFilter.comparisonMode !== 'none' &&
        Boolean(temporalFilter.comparisonStartDate && temporalFilter.comparisonEndDate)

      if (hasComp && temporalFilter.comparisonStartDate && temporalFilter.comparisonEndDate) {
        const [curr, prev] = await Promise.all([
          fetchMetricsForRange(bizId, temporalFilter.startDate, temporalFilter.endDate),
          fetchMetricsForRange(
            bizId,
            temporalFilter.comparisonStartDate,
            temporalFilter.comparisonEndDate
          ),
        ])
        if (reqId !== requestIdRef.current) return
        setData(curr)
        setCompData(prev)
      } else {
        const curr = await fetchMetricsForRange(bizId, temporalFilter.startDate, temporalFilter.endDate)
        if (reqId !== requestIdRef.current) return
        setData(curr)
        setCompData(null)
      }
    } catch (err: unknown) {
      if (reqId !== requestIdRef.current) return
      const msg = err instanceof Error ? err.message : 'Gagal memuat laporan Orders'
      setErrorMsg(msg)
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [
    activeBusiness?.id,
    temporalFilter.startDate,
    temporalFilter.endDate,
    temporalFilter.comparisonMode,
    temporalFilter.comparisonStartDate,
    temporalFilter.comparisonEndDate,
    fetchMetricsForRange,
  ])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  const hasComparison = Boolean(compData && temporalFilter.comparisonMode !== 'none')
  const summary = data.summary || EMPTY_SUMMARY
  const prevSummary = compData?.summary || EMPTY_SUMMARY

  // Averages per bucket (Monthly / Weekly / Daily Net, Gross, Orders, Items)
  const bucketDivisor = Math.max(1, summary.active_buckets || data.time_series.length || 1)
  const prevBucketDivisor = Math.max(
    1,
    prevSummary.active_buckets || compData?.time_series.length || 1
  )
  const granLabel =
    granularity === 'day' ? 'Harian' : granularity === 'week' ? 'Mingguan' : 'Bulanan'

  // Busiest Day & Busiest Hour
  const busiestDay = useMemo(() => {
    if (!data.by_day.length) return null
    return data.by_day.reduce((best, cur) => (cur.orders > best.orders ? cur : best), data.by_day[0])
  }, [data.by_day])

  const busiestHour = useMemo(() => {
    if (!data.by_hour.length) return null
    return data.by_hour.reduce((best, cur) => (cur.orders > best.orders ? cur : best), data.by_hour[0])
  }, [data.by_hour])

  // Average Order Gross / Items Highest & Lowest
  const avgGrossStats = useMemo(() => {
    const valid = data.time_series.filter((p) => p.orders > 0)
    if (!valid.length) return { highest: null, lowest: null }
    const highest = valid.reduce((a, b) => (b.avg_gross > a.avg_gross ? b : a), valid[0])
    const lowest = valid.reduce((a, b) => (b.avg_gross < a.avg_gross ? b : a), valid[0])
    return { highest, lowest }
  }, [data.time_series])

  const avgItemsStats = useMemo(() => {
    const valid = data.time_series.filter((p) => p.orders > 0)
    if (!valid.length) return { highest: null, lowest: null }
    const highest = valid.reduce((a, b) => (b.avg_items > a.avg_items ? b : a), valid[0])
    const lowest = valid.reduce((a, b) => (b.avg_items < a.avg_items ? b : a), valid[0])
    return { highest, lowest }
  }, [data.time_series])

  // Heatmap lookup map & max
  const { heatmapMap, heatmapMax, heatmapDayTotals } = useMemo(() => {
    const map = new Map<string, number>()
    const dayTotals = new Array<number>(8).fill(0)
    let maxVal = 0
    for (const cell of data.heatmap) {
      const val =
        heatmapMetric === 'orders'
          ? cell.orders
          : heatmapMetric === 'gross_sales'
          ? cell.gross_sales
          : cell.net_sales
      map.set(`${cell.dow}-${cell.hour}`, val)
      dayTotals[cell.dow] = (dayTotals[cell.dow] || 0) + val
      if (val > maxVal) maxVal = val
    }
    return { heatmapMap: map, heatmapMax: maxVal, heatmapDayTotals: dayTotals }
  }, [data.heatmap, heatmapMetric])

  // New vs Returning percentages
  const nvr = data.new_vs_returning || { new: EMPTY_NVR, returning: EMPTY_NVR }
  const totalNvrCustomers = nvr.new.customers + nvr.returning.customers
  const totalNvrOrders = nvr.new.orders + nvr.returning.orders
  const totalNvrNet = nvr.new.net_sales + nvr.returning.net_sales
  const totalNvrGross = nvr.new.gross_sales + nvr.returning.gross_sales

  const pct = (part: number, total: number) =>
    total > 0 ? Math.round((part / total) * 1000) / 10 : 0

  // Time series SVG scales
  const tsPoints = data.time_series
  const compTsPoints = compData?.time_series || []
  const maxSalesVal = useMemo(() => {
    let m = 0
    for (const p of tsPoints) m = Math.max(m, p.gross_sales, p.net_sales)
    if (showCompareOnChart) {
      for (const p of compTsPoints) m = Math.max(m, p.net_sales)
    }
    return m
  }, [tsPoints, compTsPoints, showCompareOnChart])
  const maxOrdersVal = useMemo(
    () => tsPoints.reduce((m, p) => Math.max(m, p.orders), 0),
    [tsPoints]
  )
  const salesYAxis = computeTightYAxis(maxSalesVal, 100000)
  const ordersYAxis = computeTightYAxis(maxOrdersVal, 4)

  // Export handlers
  const handleExportMainChart = () => {
    downloadCsv(
      `orders-trend-${temporalFilter.startDate}-to-${temporalFilter.endDate}.csv`,
      ['Periode', 'Orders', 'Items', 'Gross Sales', 'Net Sales', 'Avg Gross', 'Avg Items'],
      tsPoints.map((p) => [
        p.bucket_date,
        p.orders,
        p.items,
        p.gross_sales,
        p.net_sales,
        p.avg_gross,
        p.avg_items,
      ])
    )
  }

  const handleExportHeatmap = () => {
    const rows: (string | number)[][] = []
    for (let h = 0; h < 24; h++) {
      rows.push([
        formatHourLabel(h),
        ...[1, 2, 3, 4, 5, 6, 7].map((d) => heatmapMap.get(`${d}-${h}`) || 0),
      ])
    }
    downloadCsv(
      `orders-heatmap-${heatmapMetric}-${temporalFilter.startDate}.csv`,
      ['Jam', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'],
      rows
    )
  }

  const handleExportCompletion = () => {
    downloadCsv(
      `orders-completion-time-${completionUnit}-${temporalFilter.startDate}.csv`,
      ['Bucket', 'Completed Orders'],
      data.completion.buckets.map((b) => [b.bucket_key, b.orders])
    )
  }

  const completionUnitDivisor = completionUnit === 'day' ? 24 : 1
  const completionUnitLabel = completionUnit === 'day' ? 'hari' : 'jam'

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
        {/* ─── Top Header Bar ───────────────────────────────────────────────── */}
        <div className="no-print flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={goBack}
              aria-label="Kembali"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-slate-900">Orders</h1>

            {/* Segment Filter Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSegmentOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                  selectedPlatform !== 'all'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>⚙️</span>
                <span>{selectedPlatform === 'all' ? 'Segment' : `Channel: ${selectedPlatform}`}</span>
              </button>
              {isSegmentOpen && (
                <div className="absolute left-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-30">
                  <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase">
                    Filter Channel / Platform
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlatform('all')
                      setIsSegmentOpen(false)
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs ${
                      selectedPlatform === 'all'
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Semua Channel
                  </button>
                  {data.platforms.map((plat) => (
                    <button
                      key={plat}
                      type="button"
                      onClick={() => {
                        setSelectedPlatform(plat)
                        setIsSegmentOpen(false)
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs ${
                        selectedPlatform === plat
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {plat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Guest Exclusion Toggle */}
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50 select-none">
              <input
                type="checkbox"
                checked={excludeGuest}
                onChange={(e) => setExcludeGuest(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Kecualikan Tamu POS</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <TemporalDateFilter
              value={temporalFilter}
              onChange={setTemporalFilter}
              timezone={activeBusiness?.timezone}
              showComparison={true}
              allowAllTime={false}
              align="right"
            />
          </div>
        </div>

        {/* Subtitle & Quick Link */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
          <p>
            <strong className="text-slate-700">Net sales</strong> dari pesanan pada periode ini — gross sales dikurangi pajak, ongkir, biaya lain, dan refund.
          </p>
          <Link
            href={`/orders?start=${temporalFilter.startDate}&end=${temporalFilter.endDate}`}
            className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1 shrink-0"
          >
            <span>Lihat daftar order di laporan ini</span>
            <span>&rsaquo;</span>
          </Link>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMsg}
          </div>
        )}

        {/* ─── Section 1: Main Orders Chart + KPI Grid ──────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Chart + Bucket Averages */}
          <div className="lg:col-span-8 space-y-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">Orders</h2>
                  <button
                    type="button"
                    onClick={handleExportMainChart}
                    title="Export CSV"
                    className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs"
                  >
                    ⬇
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {hasComparison && (
                    <button
                      type="button"
                      onClick={() => setShowCompareOnChart((v) => !v)}
                      className={`px-2.5 py-1 rounded-md border text-xs font-medium transition ${
                        showCompareOnChart
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      ⇄ Compare
                    </button>
                  )}
                  <select
                    value={granularity}
                    onChange={(e) => setGranularity(e.target.value as Granularity)}
                    className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
              </div>

              {/* Dual-axis SVG Chart */}
              <div className="relative h-64 w-full">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    Memuat grafik orders...
                  </div>
                ) : tsPoints.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    Belum ada transaksi pada periode ini.
                  </div>
                ) : (
                  <svg viewBox="0 0 760 240" className="w-full h-full overflow-visible">
                    {/* Horizontal gridlines */}
                    {salesYAxis.ticks.map((t, i) => {
                      const y = 200 - (t / salesYAxis.max) * 180
                      const orderTick = ordersYAxis.ticks[i] ?? 0
                      return (
                        <g key={i}>
                          <line x1={58} x2={710} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />
                          <text
                            x={52}
                            y={y + 3}
                            textAnchor="end"
                            className="fill-slate-400 text-[10px]"
                          >
                            {formatCompactIDR(t)}
                          </text>
                          <text
                            x={716}
                            y={y + 3}
                            textAnchor="start"
                            className="fill-slate-400 text-[10px]"
                          >
                            {formatInt(orderTick)}
                          </text>
                        </g>
                      )
                    })}

                    {/* Bars (Orders) */}
                    {tsPoints.map((pt, idx) => {
                      const slotW = (710 - 58) / Math.max(tsPoints.length, 1)
                      const barW = Math.min(36, Math.max(6, slotW * 0.52))
                      const cx = 58 + slotW * (idx + 0.5)
                      const barH = (pt.orders / ordersYAxis.max) * 180
                      const y = 200 - barH
                      return (
                        <rect
                          key={pt.bucket_date}
                          x={cx - barW / 2}
                          y={y}
                          width={barW}
                          height={Math.max(1, barH)}
                          rx={2}
                          className={
                            hoveredTsIdx === idx ? 'fill-slate-300' : 'fill-slate-200/80'
                          }
                          onMouseEnter={() => setHoveredTsIdx(idx)}
                          onMouseLeave={() => setHoveredTsIdx(null)}
                        />
                      )
                    })}

                    {/* Comparison Net Sales dashed line */}
                    {hasComparison && showCompareOnChart && compTsPoints.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#c4b5fd"
                        strokeWidth={1.75}
                        strokeDasharray="4 3"
                        points={compTsPoints
                          .slice(0, tsPoints.length)
                          .map((pt, idx) => {
                            const slotW = (710 - 58) / Math.max(tsPoints.length, 1)
                            const cx = 58 + slotW * (idx + 0.5)
                            const y = 200 - (pt.net_sales / salesYAxis.max) * 180
                            return `${cx},${y}`
                          })
                          .join(' ')}
                      />
                    )}

                    {/* Gross Sales Line (Blue) */}
                    {tsPoints.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={2}
                        points={tsPoints
                          .map((pt, idx) => {
                            const slotW = (710 - 58) / Math.max(tsPoints.length, 1)
                            const cx = 58 + slotW * (idx + 0.5)
                            const y = 200 - (pt.gross_sales / salesYAxis.max) * 180
                            return `${cx},${y}`
                          })
                          .join(' ')}
                      />
                    )}

                    {/* Net Sales Line (Purple) */}
                    {tsPoints.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#7c3aed"
                        strokeWidth={2}
                        points={tsPoints
                          .map((pt, idx) => {
                            const slotW = (710 - 58) / Math.max(tsPoints.length, 1)
                            const cx = 58 + slotW * (idx + 0.5)
                            const y = 200 - (pt.net_sales / salesYAxis.max) * 180
                            return `${cx},${y}`
                          })
                          .join(' ')}
                      />
                    )}

                    {/* Dots & X labels */}
                    {tsPoints.map((pt, idx) => {
                      const slotW = (710 - 58) / Math.max(tsPoints.length, 1)
                      const cx = 58 + slotW * (idx + 0.5)
                      const yGross = 200 - (pt.gross_sales / salesYAxis.max) * 180
                      const yNet = 200 - (pt.net_sales / salesYAxis.max) * 180
                      const showLabel =
                        tsPoints.length <= 12 || idx % Math.ceil(tsPoints.length / 8) === 0
                      return (
                        <g key={`dot-${pt.bucket_date}`}>
                          <circle cx={cx} cy={yGross} r={3} fill="#2563eb" />
                          <circle cx={cx} cy={yNet} r={3} fill="#7c3aed" />
                          {showLabel && (
                            <text
                              x={cx}
                              y={218}
                              textAnchor="middle"
                              className="fill-slate-400 text-[10px]"
                            >
                              {formatBucketLabel(pt.bucket_date, granularity)}
                            </text>
                          )}
                        </g>
                      )
                    })}
                  </svg>
                )}

                {hoveredTsIdx !== null && tsPoints[hoveredTsIdx] && (
                  <div className="absolute top-2 right-12 bg-slate-900 text-white text-[11px] rounded-lg px-3 py-2 shadow-lg pointer-events-none space-y-0.5 z-10">
                    <div className="font-semibold">
                      {formatBucketLabel(tsPoints[hoveredTsIdx].bucket_date, granularity)}
                    </div>
                    <div>Orders: {formatInt(tsPoints[hoveredTsIdx].orders)}</div>
                    <div className="text-blue-300">
                      Gross: {formatIDR(tsPoints[hoveredTsIdx].gross_sales)}
                    </div>
                    <div className="text-violet-300">
                      Net: {formatIDR(tsPoints[hoveredTsIdx].net_sales)}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 text-[11px] text-slate-500 mt-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-600 inline-block" /> Net Sales
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Gross Sales
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-200 inline-block" /> Orders
                </span>
              </div>
            </div>

            {/* 4-Column Granularity Averages Strip */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[11px] text-slate-500">Net {granLabel}</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{formatIDR(summary.net_sales / bucketDivisor)}</span>
                  <DeltaBadge
                    curr={summary.net_sales / bucketDivisor}
                    prev={prevSummary.net_sales / prevBucketDivisor}
                    show={hasComparison}
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Gross {granLabel}</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{formatIDR(summary.gross_sales / bucketDivisor)}</span>
                  <DeltaBadge
                    curr={summary.gross_sales / bucketDivisor}
                    prev={prevSummary.gross_sales / prevBucketDivisor}
                    show={hasComparison}
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Orders {granLabel}</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{formatInt(summary.orders / bucketDivisor)}</span>
                  <DeltaBadge
                    curr={summary.orders / bucketDivisor}
                    prev={prevSummary.orders / prevBucketDivisor}
                    show={hasComparison}
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Items {granLabel}</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{formatInt(summary.items / bucketDivisor)}</span>
                  <DeltaBadge
                    curr={summary.items / bucketDivisor}
                    prev={prevSummary.items / prevBucketDivisor}
                    show={hasComparison}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right: 2 Stacked KPI Cards */}
          <div className="lg:col-span-4 space-y-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span>Net Sales</span>
                    <span className="w-2 h-2 rounded-full bg-violet-600" />
                  </div>
                  <div className="text-base font-bold text-slate-900 mt-0.5">
                    {formatIDR(summary.net_sales)}
                  </div>
                  <div className="mt-1">
                    <DeltaBadge curr={summary.net_sales} prev={prevSummary.net_sales} show={hasComparison} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span>Gross Sales</span>
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                  </div>
                  <div className="text-base font-bold text-slate-900 mt-0.5">
                    {formatIDR(summary.gross_sales)}
                  </div>
                  <div className="mt-1">
                    <DeltaBadge curr={summary.gross_sales} prev={prevSummary.gross_sales} show={hasComparison} />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-500">Orders</div>
                  <div className="text-base font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                    <span>{formatInt(summary.orders)}</span>
                    <DeltaBadge curr={summary.orders} prev={prevSummary.orders} show={hasComparison} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Items</div>
                  <div className="text-base font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                    <span>{formatInt(summary.items)}</span>
                    <DeltaBadge curr={summary.items} prev={prevSummary.items} show={hasComparison} />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[11px] text-slate-500">Average net</div>
                  <div className="text-xs font-bold text-slate-900 mt-0.5">
                    {formatIDR(summary.avg_net)}
                  </div>
                  <div className="mt-1">
                    <DeltaBadge curr={summary.avg_net} prev={prevSummary.avg_net} show={hasComparison} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Average gross</div>
                  <div className="text-xs font-bold text-slate-900 mt-0.5">
                    {formatIDR(summary.avg_gross)}
                  </div>
                  <div className="mt-1">
                    <DeltaBadge curr={summary.avg_gross} prev={prevSummary.avg_gross} show={hasComparison} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Average items</div>
                  <div className="text-xs font-bold text-slate-900 mt-0.5">
                    {formatDec(summary.avg_items, 1)}
                  </div>
                  <div className="mt-1">
                    <DeltaBadge curr={summary.avg_items} prev={prevSummary.avg_items} show={hasComparison} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500">Refunds</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                  <span>{formatIDR(summary.refunds)}</span>
                  <DeltaBadge
                    curr={summary.refunds}
                    prev={prevSummary.refunds}
                    show={hasComparison}
                    reversePolarity={true}
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Discounts</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                  <span>{formatIDR(summary.discounts)}</span>
                  <DeltaBadge curr={summary.discounts} prev={prevSummary.discounts} show={hasComparison} />
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Taxes</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                  <span>{formatIDR(summary.taxes)}</span>
                  <DeltaBadge curr={summary.taxes} prev={prevSummary.taxes} show={hasComparison} />
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Shipping</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                  <span>{formatIDR(summary.shipping)}</span>
                  <DeltaBadge curr={summary.shipping} prev={prevSummary.shipping} show={hasComparison} />
                </div>
              </div>
              <div className="col-span-2 border-t border-slate-100 pt-2">
                <div className="text-xs text-slate-500">Fees</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                  <span>{formatIDR(summary.fees)}</span>
                  <DeltaBadge curr={summary.fees} prev={prevSummary.fees} show={hasComparison} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Section 2: New vs. Returning Customers ──────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">New vs. returning customers</h2>
              <span className="text-xs text-slate-400">
                {formatInt(totalNvrCustomers)} pelanggan
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-left py-2 font-medium w-36">Metrik</th>
                  <th className="text-right py-2 font-medium w-32">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-600" /> New
                    </span>
                  </th>
                  <th className="text-right py-2 font-medium w-32">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-400" /> Returning
                    </span>
                  </th>
                  <th className="text-right py-2 font-medium pl-6">Share of total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  {
                    label: 'Customers',
                    newVal: formatInt(nvr.new.customers),
                    retVal: formatInt(nvr.returning.customers),
                    newPct: pct(nvr.new.customers, totalNvrCustomers),
                    retPct: pct(nvr.returning.customers, totalNvrCustomers),
                    bar: true,
                  },
                  {
                    label: 'Orders',
                    newVal: formatInt(nvr.new.orders),
                    retVal: formatInt(nvr.returning.orders),
                    newPct: pct(nvr.new.orders, totalNvrOrders),
                    retPct: pct(nvr.returning.orders, totalNvrOrders),
                    bar: true,
                  },
                  {
                    label: 'Net sales',
                    newVal: formatIDR(nvr.new.net_sales),
                    retVal: formatIDR(nvr.returning.net_sales),
                    newPct: pct(nvr.new.net_sales, totalNvrNet),
                    retPct: pct(nvr.returning.net_sales, totalNvrNet),
                    bar: true,
                  },
                  {
                    label: 'Average net',
                    newVal: formatIDR(nvr.new.avg_net),
                    retVal: formatIDR(nvr.returning.avg_net),
                    newPct: 0,
                    retPct: 0,
                    bar: false,
                  },
                  {
                    label: 'Gross sales',
                    newVal: formatIDR(nvr.new.gross_sales),
                    retVal: formatIDR(nvr.returning.gross_sales),
                    newPct: pct(nvr.new.gross_sales, totalNvrGross),
                    retPct: pct(nvr.returning.gross_sales, totalNvrGross),
                    bar: true,
                  },
                  {
                    label: 'Average gross',
                    newVal: formatIDR(nvr.new.avg_gross),
                    retVal: formatIDR(nvr.returning.avg_gross),
                    newPct: 0,
                    retPct: 0,
                    bar: false,
                  },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="py-2.5 text-slate-600 font-medium">{row.label}</td>
                    <td className="py-2.5 text-right font-semibold text-slate-900">{row.newVal}</td>
                    <td className="py-2.5 text-right font-semibold text-slate-700">{row.retVal}</td>
                    <td className="py-2.5 pl-6">
                      {row.bar ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-blue-600 w-11 text-right">
                            {row.newPct}%
                          </span>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden flex">
                            <div
                              className="bg-blue-600 h-full"
                              style={{ width: `${row.newPct}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold text-slate-500 w-11">
                            {row.retPct}%
                          </span>
                        </div>
                      ) : (
                        <div className="text-right text-[11px] text-slate-400">
                          {nvr.returning.orders === 0 ? 'Belum ada returning order' : 'Perbandingan rata-rata'}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500">
            Pelanggan baru menyumbang{' '}
            <strong className="text-slate-800">{pct(nvr.new.net_sales, totalNvrNet)}%</strong> dari total net sales.
          </div>
        </div>

        {/* ─── Section 3: Distributions (Item Count & Order Value) ───────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Item count distribution */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-4">Item count distribution</h2>
            <DistributionBarChart
              buckets={data.item_buckets.map((b) => ({
                label: b.bucket_key === '1' ? '1 item' : `${b.bucket_key} items`,
                value: b.orders,
              }))}
            />
          </div>

          {/* Order value distribution */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-4">Order value distribution</h2>
            <DistributionBarChart
              buckets={data.value_buckets.map((b) => ({
                label: b.bucket_key,
                value: b.orders,
              }))}
            />
          </div>
        </div>

        {/* ─── Section 4: Average Order Gross & Items Trends ────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AverageTrendCard
            title="Average order gross"
            avgValue={formatIDR(summary.avg_gross)}
            highestValue={
              avgGrossStats.highest ? formatIDR(avgGrossStats.highest.avg_gross) : '-'
            }
            highestLabel={
              avgGrossStats.highest
                ? formatBucketLabel(avgGrossStats.highest.bucket_date, granularity)
                : ''
            }
            lowestValue={
              avgGrossStats.lowest ? formatIDR(avgGrossStats.lowest.avg_gross) : '-'
            }
            lowestLabel={
              avgGrossStats.lowest
                ? formatBucketLabel(avgGrossStats.lowest.bucket_date, granularity)
                : ''
            }
            points={tsPoints.map((p) => ({
              label: formatBucketLabel(p.bucket_date, granularity),
              value: p.avg_gross,
            }))}
            formatY={formatCompactIDR}
          />

          <AverageTrendCard
            title="Average order items"
            avgValue={formatDec(summary.avg_items, 1)}
            highestValue={
              avgItemsStats.highest ? formatDec(avgItemsStats.highest.avg_items, 2) : '-'
            }
            highestLabel={
              avgItemsStats.highest
                ? formatBucketLabel(avgItemsStats.highest.bucket_date, granularity)
                : ''
            }
            lowestValue={
              avgItemsStats.lowest ? formatDec(avgItemsStats.lowest.avg_items, 2) : '-'
            }
            lowestLabel={
              avgItemsStats.lowest
                ? formatBucketLabel(avgItemsStats.lowest.bucket_date, granularity)
                : ''
            }
            points={tsPoints.map((p) => ({
              label: formatBucketLabel(p.bucket_date, granularity),
              value: p.avg_items,
            }))}
            formatY={(v) => formatDec(v, 1)}
          />
        </div>

        {/* ─── Section 5: Orders by Day & Orders by Hour ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Orders by day */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Orders by day</h2>
            <div className="grid grid-cols-3 gap-2 mb-4 pb-3 border-b border-slate-100 text-xs">
              <div>
                <div className="text-[11px] text-slate-500">Busiest day</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {busiestDay ? DAY_NAMES[busiestDay.dow] : '-'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Orders</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {busiestDay ? formatInt(busiestDay.orders) : '0'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Gross sales</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {busiestDay ? formatIDR(busiestDay.gross_sales) : 'Rp0'}
                </div>
              </div>
            </div>
            <TemporalPatternChart
              items={data.by_day.map((d) => ({
                label: DAY_SHORT[d.dow] || String(d.dow),
                orders: d.orders,
                gross: d.gross_sales,
                isPeak: busiestDay?.dow === d.dow && d.orders > 0,
              }))}
            />
          </div>

          {/* Orders by hour */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Orders by hour</h2>
            <div className="grid grid-cols-3 gap-2 mb-4 pb-3 border-b border-slate-100 text-xs">
              <div>
                <div className="text-[11px] text-slate-500">Busiest hour</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {busiestHour ? formatHourLabel(busiestHour.hour) : '-'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Orders</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {busiestHour ? formatInt(busiestHour.orders) : '0'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Gross sales</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {busiestHour ? formatIDR(busiestHour.gross_sales) : 'Rp0'}
                </div>
              </div>
            </div>
            <TemporalPatternChart
              items={data.by_hour.map((h) => ({
                label: `${String(h.hour).padStart(2, '0')}:00`,
                orders: h.orders,
                gross: h.gross_sales,
                isPeak: busiestHour?.hour === h.hour && h.orders > 0,
              }))}
              sparseLabels={true}
            />
          </div>
        </div>

        {/* ─── Section 6: Orders by Day & Hour Heatmap ──────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-bold text-slate-900">Orders by day and hour</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold">
                <span>LOW</span>
                <div className="w-20 h-2 rounded-full bg-gradient-to-r from-slate-100 via-blue-300 to-blue-600" />
                <span>HIGH</span>
              </div>
              <select
                value={heatmapMetric}
                onChange={(e) => setHeatmapMetric(e.target.value as HeatmapMetric)}
                className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700"
              >
                <option value="orders">Based on total orders</option>
                <option value="gross_sales">Based on gross sales</option>
                <option value="net_sales">Based on net sales</option>
              </select>
              <button
                type="button"
                onClick={handleExportHeatmap}
                className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                ⬇ Export
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              {/* Day headers */}
              <div className="grid grid-cols-8 gap-1 mb-1 text-[11px] font-medium text-slate-500 text-center">
                <div />
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <div key={d}>{DAY_NAMES[d]}</div>
                ))}
              </div>

              {/* 24 Hour Rows */}
              <div className="space-y-1">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="grid grid-cols-8 gap-1 items-center">
                    <div className="text-[10px] text-slate-400 text-right pr-2">
                      {formatHourLabel(hour)}
                    </div>
                    {[1, 2, 3, 4, 5, 6, 7].map((dow) => {
                      const val = heatmapMap.get(`${dow}-${hour}`) || 0
                      const ratio = heatmapMax > 0 ? val / heatmapMax : 0
                      const bgStyle =
                        val === 0
                          ? 'bg-slate-50 text-slate-300 border-slate-100'
                          : ratio > 0.75
                          ? 'bg-blue-600 text-white border-blue-600'
                          : ratio > 0.5
                          ? 'bg-blue-500 text-white border-blue-500'
                          : ratio > 0.25
                          ? 'bg-blue-300 text-slate-900 border-blue-300'
                          : 'bg-blue-100 text-slate-700 border-blue-200'

                      return (
                        <div
                          key={`${dow}-${hour}`}
                          title={`${DAY_NAMES[dow]} ${formatHourLabel(hour)}: ${
                            heatmapMetric === 'orders' ? formatInt(val) : formatIDR(val)
                          }`}
                          className={`h-6 rounded border flex items-center justify-center text-[10px] font-medium ${bgStyle}`}
                        >
                          {heatmapMetric === 'orders' ? formatInt(val) : formatCompactIDR(val)}
                        </div>
                      )
                    })}
                  </div>
                ))}

                {/* Total Row */}
                <div className="grid grid-cols-8 gap-1 items-center pt-1.5 border-t border-slate-200">
                  <div className="text-[10px] font-bold text-slate-700 text-right pr-2">Total</div>
                  {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                    <div
                      key={`total-${dow}`}
                      className="h-7 rounded bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold"
                    >
                      {heatmapMetric === 'orders'
                        ? formatInt(heatmapDayTotals[dow] || 0)
                        : formatCompactIDR(heatmapDayTotals[dow] || 0)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Section 7: Time to Complete Orders ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-sm font-bold text-slate-900">Time to complete orders</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={completionScope}
                  onChange={(e) => setCompletionScope(e.target.value as CompletionScope)}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700"
                >
                  <option value="all">Semua Order Selesai</option>
                  <option value="non_pos">Non-POS (Pengiriman / Online)</option>
                  <option value="has_date_completed">Hanya yang punya Date Completed</option>
                </select>
                <select
                  value={completionUnit}
                  onChange={(e) => setCompletionUnit(e.target.value as CompletionUnit)}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700"
                >
                  <option value="day">Days</option>
                  <option value="hour">Hours</option>
                </select>
                <button
                  type="button"
                  onClick={handleExportCompletion}
                  title="Export CSV"
                  className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs"
                >
                  ⬇
                </button>
              </div>
            </div>

            {(() => {
              const buckets = data.completion.buckets
              const totalComp = data.completion.stats.completed_orders
              const maxVal = buckets.reduce((m, b) => Math.max(m, b.orders), 0) || 1
              return (
                <>
                  <div className="grid grid-cols-5 gap-3 items-end h-48 pt-6 pb-2">
                    {buckets.map((b, i) => {
                      const pctVal = totalComp > 0 ? ((b.orders / totalComp) * 100).toFixed(1) : '0.0'
                      const hPct = Math.max(4, (b.orders / maxVal) * 100)
                      const isMax = b.orders === maxVal && b.orders > 0
                      return (
                        <div key={b.bucket_key} className="flex flex-col items-center h-full justify-end">
                          <div className="text-[11px] font-bold text-slate-800">
                            {formatInt(b.orders)}
                          </div>
                          <div className="text-[10px] text-slate-400 mb-1.5">{pctVal}%</div>
                          <div className="w-full max-w-[72px] flex-1 flex items-end">
                            <div
                              className={`w-full rounded-t transition-all ${
                                isMax ? 'bg-blue-600' : i >= 3 ? 'bg-slate-300' : 'bg-slate-200'
                              }`}
                              style={{ height: `${hPct}%` }}
                            />
                          </div>
                          <div className="text-[11px] text-slate-500 mt-2">
                            {completionUnit === 'day'
                              ? `${b.bucket_key} ${b.bucket_key === '0-1' ? 'day' : 'days'}`
                              : b.bucket_key}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500">
                    {data.completion.stats.within_1d_pct}% order selesai dalam 1 hari;{' '}
                    {data.completion.stats.within_3d_pct}% selesai dalam 3 hari.
                  </div>
                </>
              )
            })()}
          </div>

          <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col justify-between">
            <div>
              <div className="text-xs text-slate-500">Average time to complete</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {formatDec(data.completion.stats.avg_hours / completionUnitDivisor, 1)}{' '}
                {completionUnitLabel}
              </div>
            </div>

            <div className="divide-y divide-slate-100 text-xs mt-4">
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Median</span>
                <span className="font-semibold text-slate-900">
                  {formatDec(data.completion.stats.median_hours / completionUnitDivisor, 1)}{' '}
                  {completionUnitLabel}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Longest</span>
                <span className="font-semibold text-slate-900">
                  {formatDec(data.completion.stats.max_hours / completionUnitDivisor, 1)}{' '}
                  {completionUnitLabel}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Completed orders</span>
                <span className="font-semibold text-slate-900">
                  {formatInt(data.completion.stats.completed_orders)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Reusable Sub-Charts ──────────────────────────────────────────────────────
function DistributionBarChart({ buckets }: { buckets: { label: string; value: number }[] }) {
  const maxVal = buckets.reduce((m, b) => Math.max(m, b.value), 0)
  const yAxis = computeTightYAxis(maxVal, 4)

  return (
    <div className="h-52 w-full">
      <svg viewBox="0 0 460 190" className="w-full h-full overflow-visible">
        {yAxis.ticks.map((t, i) => {
          const y = 155 - (t / yAxis.max) * 140
          return (
            <g key={i}>
              <line x1={42} x2={448} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={36} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                {formatInt(t)}
              </text>
            </g>
          )
        })}
        {buckets.map((b, idx) => {
          const slotW = (448 - 42) / Math.max(buckets.length, 1)
          const barW = Math.min(48, slotW * 0.55)
          const cx = 42 + slotW * (idx + 0.5)
          const barH = (b.value / yAxis.max) * 140
          const y = 155 - barH
          return (
            <g key={b.label}>
              <rect
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={Math.max(1, barH)}
                rx={2}
                fill="#3b82f6"
              >
                <title>{`${b.label}: ${formatInt(b.value)} orders`}</title>
              </rect>
              <text x={cx} y={172} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {b.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function AverageTrendCard({
  title,
  avgValue,
  highestValue,
  highestLabel,
  lowestValue,
  lowestLabel,
  points,
  formatY,
}: {
  title: string
  avgValue: string
  highestValue: string
  highestLabel: string
  lowestValue: string
  lowestLabel: string
  points: { label: string; value: number }[]
  formatY: (v: number) => string
}) {
  const maxVal = points.reduce((m, p) => Math.max(m, p.value), 0)
  const yAxis = computeTightYAxis(maxVal, 1)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
      <h2 className="text-sm font-bold text-slate-900 mb-3">{title}</h2>
      <div className="grid grid-cols-3 gap-2 mb-4 pb-3 border-b border-slate-100 text-xs">
        <div>
          <div className="text-[11px] text-slate-500">Average this period</div>
          <div className="font-bold text-slate-900 mt-0.5">{avgValue}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Highest</div>
          <div className="font-bold text-slate-900 mt-0.5">
            {highestValue}{' '}
            {highestLabel && <span className="font-normal text-slate-400">{highestLabel}</span>}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Lowest</div>
          <div className="font-bold text-slate-900 mt-0.5">
            {lowestValue}{' '}
            {lowestLabel && <span className="font-normal text-slate-400">{lowestLabel}</span>}
          </div>
        </div>
      </div>

      <div className="h-44 w-full">
        {points.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">
            Tidak ada data tren.
          </div>
        ) : (
          <svg viewBox="0 0 460 165" className="w-full h-full overflow-visible">
            {yAxis.ticks.map((t, i) => {
              const y = 135 - (t / yAxis.max) * 120
              return (
                <g key={i}>
                  <line x1={48} x2={448} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />
                  <text x={42} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                    {formatY(t)}
                  </text>
                </g>
              )
            })}
            {points.length > 1 && (
              <polyline
                fill="none"
                stroke="#2563eb"
                strokeWidth={2}
                points={points
                  .map((p, idx) => {
                    const slotW = (448 - 48) / Math.max(points.length, 1)
                    const cx = 48 + slotW * (idx + 0.5)
                    const y = 135 - (p.value / yAxis.max) * 120
                    return `${cx},${y}`
                  })
                  .join(' ')}
              />
            )}
            {points.map((p, idx) => {
              const slotW = (448 - 48) / Math.max(points.length, 1)
              const cx = 48 + slotW * (idx + 0.5)
              const showLabel = points.length <= 8 || idx % Math.ceil(points.length / 6) === 0
              return showLabel ? (
                <text key={idx} x={cx} y={152} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {p.label}
                </text>
              ) : null
            })}
          </svg>
        )}
      </div>
    </div>
  )
}

function TemporalPatternChart({
  items,
  sparseLabels = false,
}: {
  items: { label: string; orders: number; gross: number; isPeak: boolean }[]
  sparseLabels?: boolean
}) {
  const maxGross = items.reduce((m, i) => Math.max(m, i.gross), 0)
  const maxOrders = items.reduce((m, i) => Math.max(m, i.orders), 0)
  const grossAxis = computeTightYAxis(maxGross, 100000)
  const ordersAxis = computeTightYAxis(maxOrders, 4)

  return (
    <div className="h-44 w-full">
      <svg viewBox="0 0 460 165" className="w-full h-full overflow-visible">
        {grossAxis.ticks.map((t, i) => {
          const y = 135 - (t / grossAxis.max) * 120
          return (
            <g key={i}>
              <line x1={48} x2={420} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={42} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                {formatCompactIDR(t)}
              </text>
              <text x={426} y={y + 3} textAnchor="start" className="fill-slate-400 text-[10px]">
                {formatInt(ordersAxis.ticks[i] ?? 0)}
              </text>
            </g>
          )
        })}

        {items.map((item, idx) => {
          const slotW = (420 - 48) / Math.max(items.length, 1)
          const barW = Math.min(28, Math.max(4, slotW * 0.6))
          const cx = 48 + slotW * (idx + 0.5)
          const barH = (item.orders / ordersAxis.max) * 120
          const y = 135 - barH
          const showLabel = !sparseLabels || idx % 6 === 0
          return (
            <g key={item.label}>
              <rect
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={Math.max(1, barH)}
                rx={2}
                fill={item.isPeak ? '#4f46e5' : '#cbd5e1'}
              >
                <title>{`${item.label}: ${formatInt(item.orders)} orders (${formatIDR(item.gross)})`}</title>
              </rect>
              {showLabel && (
                <text x={cx} y={152} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {item.label}
                </text>
              )}
            </g>
          )
        })}

        {items.length > 1 && (
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth={1.75}
            points={items
              .map((item, idx) => {
                const slotW = (420 - 48) / Math.max(items.length, 1)
                const cx = 48 + slotW * (idx + 0.5)
                const y = 135 - (item.gross / grossAxis.max) * 120
                return `${cx},${y}`
              })
              .join(' ')}
          />
        )}
      </svg>
    </div>
  )
}

