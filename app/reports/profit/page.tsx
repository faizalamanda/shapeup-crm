"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { usePageBackNavigation } from '@/hooks/usePageBackNavigation'
import { TemporalDateFilter, TemporalFilterValue } from '@/components/ui/TemporalDateFilter'
import {
  getLocalDateRangeLimits,
  resolveComparisonRange,
  getBusinessTimezone,
  localDateToUtcBounds,
} from '@/lib/localzone'

// ─── Types ────────────────────────────────────────────────────────────────────
type Granularity = 'day' | 'week' | 'month'

type ProfitSummary = {
  orders: number
  items: number
  gross_sales: number
  net_revenue: number
  cogs: number
  payroll: number
  shipping_cost: number
  transaction_fees: number
  operational_cost: number
  total_costs: number
  net_profit: number
  net_profit_margin: number
  gross_profit: number
  gross_margin: number
  avg_order_value: number
  avg_order_profit: number
  avg_order_cost: number
  avg_items_per_order: number
  purchase_frequency: number
  total_customers: number
  new_customers: number
  returning_customers: number
  repurchase_rate: number
  shipping_charged: number
  taxes_collected: number
  order_fees: number
  discounts: number
  refunds: number
  utm_attributed_revenue: number
}

type TimeSeriesPoint = {
  bucket_date: string
  orders: number
  gross_sales: number
  net_revenue: number
  cogs: number
  total_costs: number
  net_profit: number
  net_profit_margin: number
  avg_order_value: number
}

type ChannelRow = {
  channel: string
  orders: number
  gross_sales: number
  net_revenue: number
}

type UtmChannelRow = {
  source_label: string
  is_utm: boolean
  orders: number
  gross_sales: number
  net_revenue: number
}

type CostBreakdownRow = {
  code: string
  name: string
  cost_group: string
  amount: number
}

type ProfitDashboardResponse = {
  summary: ProfitSummary
  time_series: TimeSeriesPoint[]
  channels: ChannelRow[]
  utm_channels: UtmChannelRow[]
  cost_breakdown: CostBreakdownRow[]
  platforms: string[]
}

// ─── Constants & Cache ────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 1000
const profitReportCache = new Map<string, { data: ProfitDashboardResponse; timestamp: number }>()

const EMPTY_SUMMARY: ProfitSummary = {
  orders: 0,
  items: 0,
  gross_sales: 0,
  net_revenue: 0,
  cogs: 0,
  payroll: 0,
  shipping_cost: 0,
  transaction_fees: 0,
  operational_cost: 0,
  total_costs: 0,
  net_profit: 0,
  net_profit_margin: 0,
  gross_profit: 0,
  gross_margin: 0,
  avg_order_value: 0,
  avg_order_profit: 0,
  avg_order_cost: 0,
  avg_items_per_order: 0,
  purchase_frequency: 0,
  total_customers: 0,
  new_customers: 0,
  returning_customers: 0,
  repurchase_rate: 0,
  shipping_charged: 0,
  taxes_collected: 0,
  order_fees: 0,
  discounts: 0,
  refunds: 0,
  utm_attributed_revenue: 0,
}

const EMPTY_RESPONSE: ProfitDashboardResponse = {
  summary: EMPTY_SUMMARY,
  time_series: [],
  channels: [],
  utm_channels: [],
  cost_breakdown: [],
  platforms: [],
}

const DONUT_COLORS = [
  '#1e3a5f',
  '#3b82f6',
  '#0d9488',
  '#f59e0b',
  '#f97316',
  '#6366f1',
  '#10b981',
  '#64748b',
]

const MONTH_NAMES_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

// ─── Formatters & Helpers ─────────────────────────────────────────────────────
const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(val || 0))

const formatCostIDR = (val: number) => {
  const rounded = Math.round(val || 0)
  if (rounded === 0) return formatIDR(0)
  return `(${formatIDR(Math.abs(rounded))})`
}

const formatCompactIDR = (val: number) => {
  const abs = Math.abs(val || 0)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}Rp${(abs / 1_000_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `${sign}Rp${(abs / 1_000_000).toFixed(1)}jt`
  if (abs >= 1_000) return `${sign}Rp${Math.round(abs / 1_000)}rb`
  return `${sign}Rp${Math.round(abs)}`
}

const formatInt = (val: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(val || 0))

const formatPct = (val: number, digits = 2) =>
  `${(Number(val) || 0).toFixed(digits)}%`

function formatBucketLabel(key: string, granularity: Granularity): string {
  const parts = (key || '').split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return key
  const [y, m, d] = parts
  const mon = MONTH_NAMES_ID[(m - 1) % 12] || String(m)
  if (granularity === 'month') return `${mon} '${String(y).slice(-2)}`
  if (granularity === 'week') return `Mg ${String(d).padStart(2, '0')} ${mon}`
  return `${String(d).padStart(2, '0')} ${mon}`
}

function calcDeltaPct(curr: number, prev: number): number | null {
  if (prev === 0 && curr === 0) return 0
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

function computeTightYAxis(maxVal: number, intervals = 4): { max: number; ticks: number[] } {
  if (maxVal <= 0) {
    return { max: intervals, ticks: Array.from({ length: intervals + 1 }, (_, i) => i) }
  }
  const padded = maxVal * 1.08
  const rawStep = padded / intervals
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const ladder = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const niceNorm = ladder.find((v) => v >= norm) || 10
  const step = niceNorm * mag
  const max = step * intervals
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => step * i)
  return { max, ticks }
}

function DeltaBadge({
  current,
  previous,
  hasComparison,
  reversePolarity = false,
  suffix,
}: {
  current: number
  previous: number
  hasComparison: boolean
  reversePolarity?: boolean
  suffix?: string
}) {
  if (!hasComparison) return null
  const delta = calcDeltaPct(current, previous)
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
        Baru
      </span>
    )
  }
  const isUp = delta >= 0
  const isGood = reversePolarity ? !isUp : isUp
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span
        className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded ${
          delta === 0
            ? 'bg-slate-100 text-slate-600'
            : isGood
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-700'
        }`}
      >
        {delta === 0 ? '•' : isUp ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}%
      </span>
      {suffix && <span className="text-[11px] text-slate-500">{suffix}</span>}
    </span>
  )
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function ProfitDashboardPage() {
  const { activeBusiness } = useUserContext()
  const goBack = usePageBackNavigation()
  const businessTz = getBusinessTimezone(activeBusiness?.timezone)

  const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
    const limits = getLocalDateRangeLimits('this-month', businessTz)
    const comp = resolveComparisonRange('previous_period', limits.start, limits.end)
    return {
      startDate: limits.start,
      endDate: limits.end,
      preset: 'this-month',
      comparisonMode: 'previous_period',
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }
  })

  const [granularity, setGranularity] = useState<Granularity>('day')
  const [excludeGuest, setExcludeGuest] = useState<boolean>(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [isSegmentOpen, setIsSegmentOpen] = useState<boolean>(false)
  const [showAllChannels, setShowAllChannels] = useState<boolean>(false)

  const [data, setData] = useState<ProfitDashboardResponse>(EMPTY_RESPONSE)
  const [compData, setCompData] = useState<ProfitDashboardResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [hoveredPerfIdx, setHoveredPerfIdx] = useState<number | null>(null)
  const [hoveredOrdersIdx, setHoveredOrdersIdx] = useState<number | null>(null)
  const [hoveredDonutIdx, setHoveredDonutIdx] = useState<number | null>(null)

  const requestIdRef = useRef(0)

  const fetchMetricsForRange = useCallback(
    async (bizId: string, startStr: string, endStr: string): Promise<ProfitDashboardResponse> => {
      const cacheKey = `${bizId}|${startStr}|${endStr}|${businessTz}|${granularity}|${excludeGuest}|${selectedPlatform}`
      const cached = profitReportCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data
      }

      const { startOfDayISO, endOfDayISO } = localDateToUtcBounds(startStr, endStr, businessTz)
      const { data: rpcData, error } = await supabase.rpc('get_profit_dashboard_metrics', {
        p_business_id: bizId,
        p_start_date: startOfDayISO,
        p_end_date: endOfDayISO,
        p_timezone: businessTz,
        p_granularity: granularity,
        p_exclude_guest: excludeGuest,
        p_platform: selectedPlatform,
      })

      if (error) throw error

      const parsed = (rpcData || EMPTY_RESPONSE) as ProfitDashboardResponse
      profitReportCache.set(cacheKey, { data: parsed, timestamp: Date.now() })
      return parsed
    },
    [businessTz, granularity, excludeGuest, selectedPlatform]
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
      const msg = err instanceof Error ? err.message : 'Gagal memuat Profit Dashboard'
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
  const s = data.summary || EMPTY_SUMMARY
  const prev = compData?.summary || EMPTY_SUMMARY

  // ─── Derived Metrics ────────────────────────────────────────────────────────
  const opexRatio = s.net_revenue > 0 ? ((s.total_costs - s.cogs) / s.net_revenue) * 100 : 0
  const prevOpexRatio =
    prev.net_revenue > 0 ? ((prev.total_costs - prev.cogs) / prev.net_revenue) * 100 : 0

  const topChannel = data.channels.length > 0 ? data.channels[0] : null
  const visibleChannels = showAllChannels ? data.channels : data.channels.slice(0, 3)
  const maxChannelOrders = Math.max(...data.channels.map((c) => c.orders), 1)
  const maxChannelRev = Math.max(...data.channels.map((c) => c.net_revenue), 1)

  const utmMaxVal = Math.max(
    ...data.utm_channels.map((u) => Math.max(u.gross_sales, u.net_revenue)),
    1
  )

  // ─── Performance Chart Scale (Diverging Bars + Margin Line) ─────────────────
  const perfPoints = data.time_series || []
  const perfScale = useMemo(() => {
    const maxPos = Math.max(...perfPoints.map((p) => Math.max(p.net_revenue, p.net_profit, 0)), 0)
    const maxNeg = Math.max(...perfPoints.map((p) => Math.max(p.total_costs, Math.abs(Math.min(0, p.net_profit)), 0)), 0)
    const maxAbs = Math.max(maxPos, maxNeg, 1000)
    const tight = computeTightYAxis(maxAbs, 2)
    return { halfMax: tight.max }
  }, [perfPoints])

  // ─── Orders vs AOV Chart Scale ──────────────────────────────────────────────
  const ordersScale = useMemo(() => {
    const maxOrders = Math.max(...perfPoints.map((p) => p.orders), 0)
    const maxAov = Math.max(...perfPoints.map((p) => p.avg_order_value), 0)
    return {
      orders: computeTightYAxis(maxOrders, 4),
      aov: computeTightYAxis(maxAov, 4),
    }
  }, [perfPoints])

  // ─── Cost Breakdown Donut Segments ──────────────────────────────────────────
  const donutSegments = useMemo(() => {
    const items = (data.cost_breakdown || []).filter((c) => c.amount > 0)
    const total = items.reduce((acc, c) => acc + c.amount, 0)
    if (total <= 0) return { items: [], total: 0 }
    let cumPct = 0
    const mapped = items.slice(0, 7).map((item, idx) => {
      const pct = (item.amount / total) * 100
      const startPct = cumPct
      cumPct += pct
      return {
        ...item,
        pct,
        startPct,
        color: DONUT_COLORS[idx % DONUT_COLORS.length],
      }
    })
    if (items.length > 7) {
      const restAmt = items.slice(7).reduce((acc, c) => acc + c.amount, 0)
      const pct = (restAmt / total) * 100
      mapped.push({
        code: 'OTHER',
        name: 'Beban Lainnya',
        cost_group: 'operational',
        amount: restAmt,
        pct,
        startPct: cumPct,
        color: DONUT_COLORS[7],
      })
    }
    return { items: mapped, total }
  }, [data.cost_breakdown])

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 text-slate-800 su-fade-in">
      {/* ─── Row 1: Header & Filter Tanggal ────────────────────────────────── */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={goBack}
            aria-label="Kembali"
            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 shadow-2xs transition shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Profit Dashboard
          </h1>

          {/* Segment / Channel Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSegmentOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold shadow-2xs transition ${
                selectedPlatform !== 'all'
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>⚙️</span>
              <span>{selectedPlatform === 'all' ? 'Semua Channel' : `Channel: ${selectedPlatform}`}</span>
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

          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 shadow-2xs select-none">
            <input
              type="checkbox"
              checked={excludeGuest}
              onChange={(e) => setExcludeGuest(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Kecualikan Pelanggan Tamu</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <TemporalDateFilter
            value={temporalFilter}
            onChange={setTemporalFilter}
            timezone={activeBusiness?.timezone}
            showComparison={true}
            align="right"
          />
        </div>
      </div>

      {/* ─── Row 2: Subjudul & Tautan Terkait ──────────────────────────────── */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-3 text-xs text-slate-500">
        <p className="min-w-0">
          Profitabilitas <span className="font-semibold text-slate-700">{activeBusiness?.name || 'Bisnis Aktif'}</span>{' '}
          ({businessTz}) bersumber langsung dari <span className="font-semibold text-slate-700">Jurnal Ledger Akuntansi</span>; metrik order &amp; channel dari transaksi pesanan.
        </p>
        <div className="flex items-center gap-3 shrink-0 font-semibold">
          <Link href="/accounting/profit-loss" className="text-indigo-600 hover:text-indigo-700">
            Laba Rugi Akuntansi ›
          </Link>
          <Link href="/reports/revenue" className="text-indigo-600 hover:text-indigo-700">
            Laporan Revenue ›
          </Link>
        </div>
      </div>

      {(selectedPlatform !== 'all' || excludeGuest) && (
        <div className="no-print bg-blue-50/70 border border-blue-200/80 text-blue-800 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>
            ℹ️ Filter segmen aktif ({selectedPlatform !== 'all' ? `Channel: ${selectedPlatform}` : 'Semua Channel'}
            {excludeGuest ? ', tanpa tamu' : ''}). Angka <strong>Revenue, Total Costs &amp; Net Profit</strong> tetap mencerminkan total Buku Besar Akuntansi bisnis aktif, sedangkan metrik Order, Channel &amp; Pelanggan mengikuti filter segmen.
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectedPlatform('all')
              setExcludeGuest(false)
            }}
            className="shrink-0 font-semibold text-blue-700 hover:underline"
          >
            Reset Filter
          </button>
        </div>
      )}

      {/* Print-Only Header */}
      <div className="hidden print:block border-b border-slate-300 pb-3 mb-4">
        <h1 className="text-xl font-bold text-slate-900">
          Profit Dashboard — {activeBusiness?.name || 'Bisnis'}
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Periode: {temporalFilter.startDate} s.d. {temporalFilter.endDate} ({businessTz})
          {hasComparison &&
            ` | Pembanding: ${temporalFilter.comparisonStartDate} s.d. ${temporalFilter.comparisonEndDate}`}
        </p>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between gap-3">
          <span>⚠️ {errorMsg}</span>
          <button
            type="button"
            onClick={loadReport}
            className="px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* ─── Section 1: Active Business & Channel Breakdown Strip ──────────── */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0">
        <div className="p-5 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 border-b border-slate-100">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">Bisnis Aktif</div>
            <div className="text-base font-extrabold text-slate-900 mt-1 truncate">
              {activeBusiness?.name || 'Unit Bisnis'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {data.channels.length} Channel Aktif
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">Orders</div>
            <div className="text-lg font-extrabold text-slate-900 mt-1 tabular-nums truncate">
              {loading ? '...' : formatInt(s.orders)}
            </div>
            <div className="mt-1">
              <DeltaBadge current={s.orders} previous={prev.orders} hasComparison={hasComparison} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">Revenue</div>
            <div className="text-lg font-extrabold text-slate-900 mt-1 tabular-nums truncate" title={loading ? undefined : formatIDR(s.net_revenue)}>
              {loading ? '...' : formatIDR(s.net_revenue)}
            </div>
            <div className="mt-1">
              <DeltaBadge current={s.net_revenue} previous={prev.net_revenue} hasComparison={hasComparison} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">Total Costs</div>
            <div className="text-lg font-extrabold text-slate-900 mt-1 tabular-nums truncate" title={loading ? undefined : formatCostIDR(s.total_costs)}>
              {loading ? '...' : formatCostIDR(s.total_costs)}
            </div>
            <div className="mt-1">
              <DeltaBadge
                current={s.total_costs}
                previous={prev.total_costs}
                hasComparison={hasComparison}
                reversePolarity
              />
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">Net Profit</div>
            <div
              className={`text-lg font-extrabold mt-1 tabular-nums truncate ${
                s.net_profit >= 0 ? 'text-slate-900' : 'text-rose-600'
              }`}
              title={loading ? undefined : formatIDR(s.net_profit)}
            >
              {loading ? '...' : formatIDR(s.net_profit)}
            </div>
            <div className="mt-1">
              <DeltaBadge current={s.net_profit} previous={prev.net_profit} hasComparison={hasComparison} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">Net Profit Margin</div>
            <div className="text-lg font-extrabold text-slate-900 mt-1 tabular-nums truncate">
              {loading ? '...' : formatPct(s.net_profit_margin)}
            </div>
            <div className="mt-1">
              <DeltaBadge
                current={s.net_profit_margin}
                previous={prev.net_profit_margin}
                hasComparison={hasComparison}
              />
            </div>
          </div>
        </div>

        {/* Channel Breakdown Rows */}
        {data.channels.length > 0 && (
          <div className="p-5 bg-slate-50/40 space-y-2.5">
            <div className="hidden sm:grid grid-cols-12 gap-4 text-[11px] font-semibold text-slate-400 px-2">
              <div className="col-span-3">Channel Penjualan</div>
              <div className="col-span-3">Orders per channel</div>
              <div className="col-span-3">Revenue per channel</div>
              <div className="col-span-3 text-right">Kontribusi &amp; AOV</div>
            </div>

            {visibleChannels.map((ch) => {
              const ordPct = (ch.orders / maxChannelOrders) * 100
              const revPct = (ch.net_revenue / maxChannelRev) * 100
              const sharePct = s.net_revenue > 0 ? (ch.net_revenue / s.net_revenue) * 100 : 0
              const chAov = ch.orders > 0 ? ch.net_revenue / ch.orders : 0
              const isActiveFilter = selectedPlatform === ch.channel

              return (
                <button
                  key={ch.channel}
                  type="button"
                  onClick={() =>
                    setSelectedPlatform((curr) => (curr === ch.channel ? 'all' : ch.channel))
                  }
                  className={`w-full text-left grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-center px-3 py-2 rounded-lg border transition ${
                    isActiveFilter
                      ? 'bg-blue-50/70 border-blue-200'
                      : 'bg-white border-slate-200/70 hover:border-slate-300'
                  }`}
                >
                  <div className="sm:col-span-3 flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 truncate">
                      {ch.channel}
                    </span>
                  </div>

                  <div className="sm:col-span-3 flex items-center gap-2 min-w-0">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full"
                        style={{ width: `${Math.max(4, ordPct)}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 shrink-0 w-12 text-right">
                      {formatInt(ch.orders)}
                    </span>
                  </div>

                  <div className="sm:col-span-3 flex items-center gap-2 min-w-0">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${Math.max(4, revPct)}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 shrink-0">
                      {formatCompactIDR(ch.net_revenue)}
                    </span>
                  </div>

                  <div className="sm:col-span-3 flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">{formatPct(sharePct, 1)}</span>
                    <span className="text-[11px] text-slate-400">AOV {formatCompactIDR(chAov)}</span>
                  </div>
                </button>
              )
            })}

            {data.channels.length > 3 && (
              <div className="pt-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllChannels((v) => !v)}
                  className="px-3.5 py-1 rounded-full bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 shadow-2xs"
                >
                  {showAllChannels
                    ? 'Tampilkan lebih sedikit'
                    : `Tampilkan semua (${data.channels.length} channel)`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Section 2: Hero Net Profit & Cost Sub-Metrics Card ─────────────── */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0">
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 border-b border-slate-100">
          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500">Net Profit</div>
            <div
              className={`text-xl sm:text-2xl xl:text-xl 2xl:text-2xl font-extrabold tracking-tight tabular-nums truncate mt-1 ${
                s.net_profit >= 0 ? 'text-slate-900' : 'text-rose-600'
              }`}
              title={loading ? undefined : formatIDR(s.net_profit)}
            >
              {loading ? '...' : formatIDR(s.net_profit)}
            </div>
            <div className="mt-2">
              <DeltaBadge
                current={s.net_profit}
                previous={prev.net_profit}
                hasComparison={hasComparison}
                suffix={hasComparison ? `vs periode lalu: ${formatIDR(prev.net_profit)}` : undefined}
              />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500">Revenue (Net Sales)</div>
            <div
              className="text-lg sm:text-xl xl:text-lg 2xl:text-xl font-bold text-slate-900 tabular-nums truncate mt-1.5"
              title={loading ? undefined : formatIDR(s.net_revenue)}
            >
              {loading ? '...' : formatIDR(s.net_revenue)}
            </div>
            <div className="mt-2">
              <DeltaBadge current={s.net_revenue} previous={prev.net_revenue} hasComparison={hasComparison} />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500">Total Costs</div>
            <div
              className="text-lg sm:text-xl xl:text-lg 2xl:text-xl font-bold text-slate-900 tabular-nums truncate mt-1.5"
              title={loading ? undefined : formatCostIDR(s.total_costs)}
            >
              {loading ? '...' : formatCostIDR(s.total_costs)}
            </div>
            <div className="mt-2">
              <DeltaBadge
                current={s.total_costs}
                previous={prev.total_costs}
                hasComparison={hasComparison}
                reversePolarity
              />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500">Net Profit Margin</div>
            <div className="text-lg sm:text-xl xl:text-lg 2xl:text-xl font-bold text-slate-900 tabular-nums truncate mt-1.5">
              {loading ? '...' : formatPct(s.net_profit_margin)}
            </div>
            <div className="mt-2">
              <DeltaBadge
                current={s.net_profit_margin}
                previous={prev.net_profit_margin}
                hasComparison={hasComparison}
              />
            </div>
          </div>
        </div>

        {/* 5 Cost Sub-Metrics from COA */}
        <div className="p-5 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4 bg-slate-50/40">
          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500 truncate">COGS / HPP</div>
            <div className="text-sm sm:text-base font-bold text-slate-900 tabular-nums truncate mt-1" title={loading ? undefined : formatCostIDR(s.cogs)}>
              {loading ? '...' : formatCostIDR(s.cogs)}
            </div>
            <div className="mt-1.5">
              <DeltaBadge current={s.cogs} previous={prev.cogs} hasComparison={hasComparison} reversePolarity />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500 truncate">Gaji &amp; Upah</div>
            <div className="text-sm sm:text-base font-bold text-slate-900 tabular-nums truncate mt-1" title={loading ? undefined : formatCostIDR(s.payroll)}>
              {loading ? '...' : formatCostIDR(s.payroll)}
            </div>
            <div className="mt-1.5">
              <DeltaBadge
                current={s.payroll}
                previous={prev.payroll}
                hasComparison={hasComparison}
                reversePolarity
              />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500 truncate">Transportasi &amp; Kirim</div>
            <div className="text-sm sm:text-base font-bold text-slate-900 tabular-nums truncate mt-1" title={loading ? undefined : formatCostIDR(s.shipping_cost)}>
              {loading ? '...' : formatCostIDR(s.shipping_cost)}
            </div>
            <div className="mt-1.5">
              <DeltaBadge
                current={s.shipping_cost}
                previous={prev.shipping_cost}
                hasComparison={hasComparison}
                reversePolarity
              />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500 truncate">Biaya Bank &amp; Transaksi</div>
            <div className="text-sm sm:text-base font-bold text-slate-900 tabular-nums truncate mt-1" title={loading ? undefined : formatCostIDR(s.transaction_fees)}>
              {loading ? '...' : formatCostIDR(s.transaction_fees)}
            </div>
            <div className="mt-1.5">
              <DeltaBadge
                current={s.transaction_fees}
                previous={prev.transaction_fees}
                hasComparison={hasComparison}
                reversePolarity
              />
            </div>
          </div>

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-500 truncate">Operasional &amp; Lainnya</div>
            <div className="text-sm sm:text-base font-bold text-slate-900 tabular-nums truncate mt-1" title={loading ? undefined : formatCostIDR(s.operational_cost)}>
              {loading ? '...' : formatCostIDR(s.operational_cost)}
            </div>
            <div className="mt-1.5">
              <DeltaBadge
                current={s.operational_cost}
                previous={prev.operational_cost}
                hasComparison={hasComparison}
                reversePolarity
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Section 3: Performance Diverging Bar + Margin Line Chart ───────── */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0 relative">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">Performance</h2>

          <div className="flex flex-wrap items-center gap-4 min-h-[24px]">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-amber-400 inline-block" />
                Net Profit
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 border-t-2 border-dashed border-orange-500 inline-block" />
                Net Profit Margin
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400 inline-block" />
                Revenue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1e3a5f] inline-block" />
                Total Costs
              </span>
            </div>

            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as Granularity)}
              aria-label="Granularitas Grafik"
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="day">Harian</option>
              <option value="week">Mingguan</option>
              <option value="month">Bulanan</option>
            </select>
          </div>
        </div>

        {/* Floating Tooltip (Zero Layout Shift) */}
        {hoveredPerfIdx !== null && perfPoints[hoveredPerfIdx] && (
          <div className="absolute top-16 right-5 z-20 pointer-events-none bg-slate-900/95 text-white rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5 min-w-[190px]">
            <div className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1">
              {formatBucketLabel(perfPoints[hoveredPerfIdx].bucket_date, granularity)}
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-teal-300">Revenue:</span>
              <span className="font-semibold">{formatIDR(perfPoints[hoveredPerfIdx].net_revenue)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-sky-300">Total Costs:</span>
              <span className="font-semibold">{formatCostIDR(perfPoints[hoveredPerfIdx].total_costs)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-amber-300">Net Profit:</span>
              <span className="font-semibold">{formatIDR(perfPoints[hoveredPerfIdx].net_profit)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-orange-300">Margin:</span>
              <span className="font-semibold">
                {formatPct(perfPoints[hoveredPerfIdx].net_profit_margin)}
              </span>
            </div>
          </div>
        )}

        <div className="p-5">
          {perfPoints.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">
              {loading ? 'Memuat grafik performa...' : 'Belum ada data transaksi pada periode ini.'}
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg viewBox="0 0 920 280" className="w-full min-w-[560px] h-[270px] overflow-visible">
                {/* Horizontal grid lines (-max, -half, 0, +half, +max) */}
                {[-1, -0.5, 0, 0.5, 1].map((ratio, idx) => {
                  const y = 135 - ratio * 105
                  const val = ratio * perfScale.halfMax
                  const pctVal = ratio * 100
                  return (
                    <g key={idx}>
                      <line
                        x1="68"
                        x2="862"
                        y1={y}
                        y2={y}
                        stroke={ratio === 0 ? '#94a3b8' : '#e2e8f0'}
                        strokeWidth={ratio === 0 ? 1.2 : 1}
                      />
                      <text x="60" y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
                        {formatCompactIDR(val)}
                      </text>
                      <text x="870" y={y + 4} textAnchor="start" className="fill-slate-400 text-[10px]">
                        {pctVal}%
                      </text>
                    </g>
                  )
                })}

                {/* Bars + Hover Hitboxes */}
                {perfPoints.map((pt, i) => {
                  const plotW = 794
                  const slotW = plotW / perfPoints.length
                  const barW = Math.min(18, Math.max(4, slotW * 0.45))
                  const cx = 68 + slotW * i + slotW / 2
                  const revH = Math.min(105, (Math.max(0, pt.net_revenue) / perfScale.halfMax) * 105)
                  const costH = Math.min(105, (Math.max(0, pt.total_costs) / perfScale.halfMax) * 105)
                  const showLabel =
                    perfPoints.length <= 14 || i % Math.ceil(perfPoints.length / 10) === 0

                  return (
                    <g
                      key={pt.bucket_date}
                      onMouseEnter={() => setHoveredPerfIdx(i)}
                      onMouseLeave={() => setHoveredPerfIdx(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={cx - slotW / 2}
                        y={20}
                        width={slotW}
                        height={230}
                        fill={hoveredPerfIdx === i ? 'rgba(241,245,249,0.7)' : 'transparent'}
                      />
                      {/* Revenue Bar (Up) */}
                      <rect
                        x={cx - barW / 2}
                        y={135 - revH}
                        width={barW}
                        height={Math.max(0, revH)}
                        rx="2"
                        fill="#2dd4bf"
                      />
                      {/* Total Costs Bar (Down) */}
                      <rect
                        x={cx - barW / 2}
                        y={135}
                        width={barW}
                        height={Math.max(0, costH)}
                        rx="2"
                        fill="#1e3a5f"
                      />
                      {showLabel && (
                        <text
                          x={cx}
                          y={264}
                          textAnchor="middle"
                          className="fill-slate-400 text-[10px]"
                        >
                          {formatBucketLabel(pt.bucket_date, granularity)}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* Net Profit Line */}
                {perfPoints.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#facc15"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={perfPoints
                      .map((pt, i) => {
                        const slotW = 794 / perfPoints.length
                        const cx = 68 + slotW * i + slotW / 2
                        const clamped = Math.max(
                          -perfScale.halfMax,
                          Math.min(perfScale.halfMax, pt.net_profit)
                        )
                        const y = 135 - (clamped / perfScale.halfMax) * 105
                        return `${cx},${y}`
                      })
                      .join(' ')}
                  />
                )}

                {/* Net Profit Margin Dashed Line */}
                {perfPoints.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="1.8"
                    strokeDasharray="4 3"
                    strokeLinejoin="round"
                    points={perfPoints
                      .map((pt, i) => {
                        const slotW = 794 / perfPoints.length
                        const cx = 68 + slotW * i + slotW / 2
                        const clampedPct = Math.max(-100, Math.min(100, pt.net_profit_margin))
                        const y = 135 - (clampedPct / 100) * 105
                        return `${cx},${y}`
                      })
                      .join(' ')}
                  />
                )}
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* ─── Section 4: Cost Breakdown Donut Chart ──────────────────────────── */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">Cost Breakdown</h2>
          <span className="text-xs text-slate-500">Rincian Akun Beban (COA)</span>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Donut SVG */}
          <div className="lg:col-span-4 min-w-0 flex justify-center">
            <div className="relative w-52 h-52 flex items-center justify-center">
              <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90">
                <circle
                  cx="90"
                  cy="90"
                  r="66"
                  fill="none"
                  stroke="#f1f5f9"
                  strokeWidth="20"
                />
                {donutSegments.items.map((seg, idx) => {
                  const circumference = 2 * Math.PI * 66
                  const dash = (seg.pct / 100) * circumference
                  const offset = -((seg.startPct / 100) * circumference)
                  return (
                    <circle
                      key={seg.code + idx}
                      cx="90"
                      cy="90"
                      r="66"
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={hoveredDonutIdx === idx ? 23 : 20}
                      strokeDasharray={`${dash} ${circumference}`}
                      strokeDashoffset={offset}
                      onMouseEnter={() => setHoveredDonutIdx(idx)}
                      onMouseLeave={() => setHoveredDonutIdx(null)}
                      className="cursor-pointer transition-all"
                    />
                  )
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
                <span className="text-[11px] font-semibold text-slate-500">
                  {hoveredDonutIdx !== null && donutSegments.items[hoveredDonutIdx]
                    ? donutSegments.items[hoveredDonutIdx].name
                    : 'Total Cost'}
                </span>
                <span className="text-base font-extrabold text-slate-900 mt-0.5">
                  {hoveredDonutIdx !== null && donutSegments.items[hoveredDonutIdx]
                    ? formatCompactIDR(donutSegments.items[hoveredDonutIdx].amount)
                    : formatCompactIDR(s.total_costs)}
                </span>
                <div className="mt-1">
                  <DeltaBadge
                    current={s.total_costs}
                    previous={prev.total_costs}
                    hasComparison={hasComparison}
                    reversePolarity
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Cost Legend Grid */}
          <div className="lg:col-span-8 min-w-0">
            {donutSegments.items.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">
                Belum ada catatan beban/HPP pada periode ini.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {donutSegments.items.map((seg, idx) => (
                  <div
                    key={seg.code + idx}
                    onMouseEnter={() => setHoveredDonutIdx(idx)}
                    onMouseLeave={() => setHoveredDonutIdx(null)}
                    className={`flex items-start justify-between gap-3 p-3 rounded-lg border transition cursor-pointer ${
                      hoveredDonutIdx === idx
                        ? 'bg-slate-50 border-slate-300'
                        : 'bg-white border-slate-100'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className="w-3 h-3 rounded-xs mt-1 shrink-0"
                        style={{ backgroundColor: seg.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 truncate">
                          {seg.name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {seg.code} • {seg.pct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div className="text-xs font-bold text-slate-800 shrink-0 text-right">
                      {formatCostIDR(seg.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Section 5: Revenue by Channel/UTM + Profitability Summary ──────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Horizontal Bars */}
        <div className="lg:col-span-7 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">Revenue by Channel &amp; UTM</h2>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                Gross Sales
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400 inline-block" />
                Net Revenue
              </span>
            </div>
          </div>

          <div className="p-5 flex-1 space-y-4">
            {data.utm_channels.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                Belum ada data channel / UTM pada periode ini.
              </div>
            ) : (
              data.utm_channels.map((u) => {
                const grossW = (u.gross_sales / utmMaxVal) * 100
                const netW = (u.net_revenue / utmMaxVal) * 100
                return (
                  <div key={`${u.source_label}-${u.is_utm}`} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-slate-800 truncate">
                          {u.source_label}
                        </span>
                        {u.is_utm && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold shrink-0">
                            UTM
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500 shrink-0">
                        {formatInt(u.orders)} order • {formatIDR(u.net_revenue)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.max(2, grossW)}%` }}
                        />
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-400 rounded-full"
                          style={{ width: `${Math.max(2, netW)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Profitability Summary */}
        <div className="lg:col-span-5 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Profitability Summary</h2>
          </div>

          <div className="divide-y divide-slate-100 flex-1">
            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Gross Profit (Revenue - COGS)</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{formatIDR(s.gross_profit)}</span>
                <DeltaBadge
                  current={s.gross_profit}
                  previous={prev.gross_profit}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Gross Margin</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{formatPct(s.gross_margin)}</span>
                <DeltaBadge
                  current={s.gross_margin}
                  previous={prev.gross_margin}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Rasio Beban Operasional</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{formatPct(opexRatio)}</span>
                <DeltaBadge
                  current={opexRatio}
                  previous={prevOpexRatio}
                  hasComparison={hasComparison}
                  reversePolarity
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Channel Terbesar</span>
              <div className="text-right shrink-0">
                <span className="text-sm font-bold text-slate-900">
                  {topChannel ? `${topChannel.channel} (${formatCompactIDR(topChannel.net_revenue)})` : '-'}
                </span>
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">UTM Attributed Revenue</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatIDR(s.utm_attributed_revenue)}
                </span>
                <DeltaBadge
                  current={s.utm_attributed_revenue}
                  previous={prev.utm_attributed_revenue}
                  hasComparison={hasComparison}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Section 6: Orders vs Avg. Order Value + Order Summary ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Orders vs AOV Combo Chart */}
        <div className="lg:col-span-7 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col relative">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">Orders vs Avg. Order Value</h2>
            <div className="flex items-center gap-3 text-xs text-slate-600 min-h-[24px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" />
                Orders
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-orange-500 inline-block" />
                Avg. Order Value
              </span>
            </div>
          </div>

          {hoveredOrdersIdx !== null && perfPoints[hoveredOrdersIdx] && (
            <div className="absolute top-16 right-5 z-20 pointer-events-none bg-slate-900/95 text-white rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
              <div className="font-bold text-slate-200">
                {formatBucketLabel(perfPoints[hoveredOrdersIdx].bucket_date, granularity)}
              </div>
              <div>Orders: {formatInt(perfPoints[hoveredOrdersIdx].orders)}</div>
              <div>AOV: {formatIDR(perfPoints[hoveredOrdersIdx].avg_order_value)}</div>
            </div>
          )}

          <div className="p-5 flex-1 flex flex-col justify-center">
            {perfPoints.length === 0 ? (
              <div className="flex-1 min-h-[260px] flex items-center justify-center text-sm text-slate-400">
                {loading ? 'Memuat grafik order...' : 'Belum ada data order pada periode ini.'}
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <svg viewBox="0 0 640 250" className="w-full min-w-[420px] h-[250px] overflow-visible">
                  {ordersScale.orders.ticks.map((t, idx) => {
                    const y = 210 - (t / Math.max(1, ordersScale.orders.max)) * 180
                    const aovVal = (ordersScale.aov.max / 4) * idx
                    return (
                      <g key={idx}>
                        <line x1="42" x2="578" y1={y} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                        <text x="36" y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                          {formatInt(t)}
                        </text>
                        <text x="584" y={y + 3} textAnchor="start" className="fill-slate-400 text-[10px]">
                          {formatCompactIDR(aovVal)}
                        </text>
                      </g>
                    )
                  })}

                  {perfPoints.map((pt, i) => {
                    const plotW = 536
                    const slotW = plotW / perfPoints.length
                    const barW = Math.min(18, Math.max(4, slotW * 0.5))
                    const cx = 42 + slotW * i + slotW / 2
                    const h = (pt.orders / Math.max(1, ordersScale.orders.max)) * 180
                    const showLabel =
                      perfPoints.length <= 10 || i % Math.ceil(perfPoints.length / 7) === 0
                    return (
                      <g
                        key={pt.bucket_date}
                        onMouseEnter={() => setHoveredOrdersIdx(i)}
                        onMouseLeave={() => setHoveredOrdersIdx(null)}
                        className="cursor-pointer"
                      >
                        <rect
                          x={cx - slotW / 2}
                          y={20}
                          width={slotW}
                          height={195}
                          fill={hoveredOrdersIdx === i ? 'rgba(241,245,249,0.7)' : 'transparent'}
                        />
                        <rect
                          x={cx - barW / 2}
                          y={210 - h}
                          width={barW}
                          height={Math.max(0, h)}
                          rx="2"
                          fill="#cbd5e1"
                        />
                        {showLabel && (
                          <text x={cx} y={232} textAnchor="middle" className="fill-slate-400 text-[10px]">
                            {formatBucketLabel(pt.bucket_date, granularity)}
                          </text>
                        )}
                      </g>
                    )
                  })}

                  {perfPoints.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      points={perfPoints
                        .map((pt, i) => {
                          const slotW = 536 / perfPoints.length
                          const cx = 42 + slotW * i + slotW / 2
                          const y =
                            210 - (pt.avg_order_value / Math.max(1, ordersScale.aov.max)) * 180
                          return `${cx},${y}`
                        })
                        .join(' ')}
                    />
                  )}
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Right: Order Summary */}
        <div className="lg:col-span-5 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Order Summary</h2>
          </div>

          <div className="divide-y divide-slate-100 flex-1">
            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Avg. Order Value (AOV)</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatIDR(s.avg_order_value)}
                </span>
                <DeltaBadge
                  current={s.avg_order_value}
                  previous={prev.avg_order_value}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Avg. Order Profit</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatIDR(s.avg_order_profit)}
                </span>
                <DeltaBadge
                  current={s.avg_order_profit}
                  previous={prev.avg_order_profit}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Avg. Order Cost</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatIDR(s.avg_order_cost)}
                </span>
                <DeltaBadge
                  current={s.avg_order_cost}
                  previous={prev.avg_order_cost}
                  hasComparison={hasComparison}
                  reversePolarity
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Avg. Items per Order</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {(Number(s.avg_items_per_order) || 0).toFixed(2)}
                </span>
                <DeltaBadge
                  current={s.avg_items_per_order}
                  previous={prev.avg_items_per_order}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Purchase Frequency</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {(Number(s.purchase_frequency) || 0).toFixed(2)}x
                </span>
                <DeltaBadge
                  current={s.purchase_frequency}
                  previous={prev.purchase_frequency}
                  hasComparison={hasComparison}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Section 7: Bottom Row (Customer Summary + Others) ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Customer Summary */}
        <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">Customer Summary</h2>
            <Link
              href="/reports/customers"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Lihat laporan lengkap ›
            </Link>
          </div>

          <div className="divide-y divide-slate-100 flex-1">
            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Total Customers</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatInt(s.total_customers)}
                </span>
                <DeltaBadge
                  current={s.total_customers}
                  previous={prev.total_customers}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">New Customers</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatInt(s.new_customers)}
                </span>
                <DeltaBadge
                  current={s.new_customers}
                  previous={prev.new_customers}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Returning Customers</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatInt(s.returning_customers)}
                </span>
                <DeltaBadge
                  current={s.returning_customers}
                  previous={prev.returning_customers}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Repurchase Rate</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatPct(s.repurchase_rate)}
                </span>
                <DeltaBadge
                  current={s.repurchase_rate}
                  previous={prev.repurchase_rate}
                  hasComparison={hasComparison}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Others */}
        <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Others</h2>
          </div>

          <div className="divide-y divide-slate-100 flex-1">
            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Ongkir Ditagih (Shipping Charged)</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatIDR(s.shipping_charged)}
                </span>
                <DeltaBadge
                  current={s.shipping_charged}
                  previous={prev.shipping_charged}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Pajak Terkumpul (Taxes Collected)</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatIDR(s.taxes_collected)}
                </span>
                <DeltaBadge
                  current={s.taxes_collected}
                  previous={prev.taxes_collected}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Biaya Lainnya (Fees)</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{formatIDR(s.order_fees)}</span>
                <DeltaBadge
                  current={s.order_fees}
                  previous={prev.order_fees}
                  hasComparison={hasComparison}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Diskon (Discounts)</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{formatIDR(s.discounts)}</span>
                <DeltaBadge
                  current={s.discounts}
                  previous={prev.discounts}
                  hasComparison={hasComparison}
                  reversePolarity
                />
              </div>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">Refunds</span>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {formatCostIDR(s.refunds)}
                </span>
                <DeltaBadge
                  current={s.refunds}
                  previous={prev.refunds}
                  hasComparison={hasComparison}
                  reversePolarity
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

