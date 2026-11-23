"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { downloadWorkbook } from '@/lib/fileExporter'
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
type SortField = 'bucket_key' | 'customers' | 'total_ltv' | 'avg_ltv' | 'total_orders' | 'avg_orders' | 'return_rate'

type SummaryMetrics = {
  new_customers: number
  total_orders: number
  total_spend: number
  total_items: number
  returning_customers: number
  avg_ltv: number
  avg_order_value: number
  avg_lifetime_orders: number
  avg_lifetime_items: number
  return_rate: number
}

type BucketMetric = {
  bucket_key: string
  customers: number
  total_ltv: number
  avg_ltv: number
  total_orders: number
  avg_orders: number
  total_items: number
  returning_customers: number
  return_rate: number
}

type CustomersReportRpcResponse = {
  summary: SummaryMetrics
  buckets: BucketMetric[]
}

type MergedBucketRow = BucketMetric & {
  label: string
  compCustomers: number
  compTotalOrders: number
  compTotalLtv: number
}

// ─── L1 In-Memory Cache (TTL 60s) ─────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 1000
const reportMemoryCache = new Map<string, { data: CustomersReportRpcResponse; timestamp: number }>()

const EMPTY_SUMMARY: SummaryMetrics = {
  new_customers: 0,
  total_orders: 0,
  total_spend: 0,
  total_items: 0,
  returning_customers: 0,
  avg_ltv: 0,
  avg_order_value: 0,
  avg_lifetime_orders: 0,
  avg_lifetime_items: 0,
  return_rate: 0,
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

const MONTH_NAMES_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function formatBucketLabel(key: string, granularity: Granularity): string {
  const parts = key.split('-').map(Number)
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

function generateAllBucketKeys(startDate: string, endDate: string, granularity: Granularity): string[] {
  if (!startDate || !endDate) return []
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  if (!sy || !sm || !sd || !ey || !em || !ed) return []

  const cur = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  const keys: string[] = []
  const seen = new Set<string>()

  const pushKey = (k: string) => {
    if (!seen.has(k)) {
      seen.add(k)
      keys.push(k)
    }
  }

  let guard = 0
  while (cur <= end && guard < 1200) {
    guard++
    const y = cur.getUTCFullYear()
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cur.getUTCDate()).padStart(2, '0')

    if (granularity === 'month') {
      pushKey(`${y}-${m}-01`)
      cur.setUTCMonth(cur.getUTCMonth() + 1, 1)
    } else if (granularity === 'week') {
      const dayOfWeek = cur.getUTCDay() || 7
      const monday = new Date(cur.getTime())
      monday.setUTCDate(monday.getUTCDate() - dayOfWeek + 1)
      const my = monday.getUTCFullYear()
      const mm = String(monday.getUTCMonth() + 1).padStart(2, '0')
      const md = String(monday.getUTCDate()).padStart(2, '0')
      pushKey(`${my}-${mm}-${md}`)
      cur.setUTCDate(cur.getUTCDate() + 7)
    } else {
      pushKey(`${y}-${m}-${d}`)
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }
  return keys
}

// ─── RPC Fetcher with L1 Cache ────────────────────────────────────────────────
async function fetchCustomersReportWindow(
  businessId: string,
  startIso: string,
  endIso: string,
  granularity: Granularity,
  timezone: string,
  excludeGuest: boolean
): Promise<CustomersReportRpcResponse> {
  const cacheKey = `${businessId}_${startIso}_${endIso}_${granularity}_${timezone}_${excludeGuest}`
  const cached = reportMemoryCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  const { data, error } = await supabase.rpc('get_customers_report_metrics', {
    p_business_id: businessId,
    p_start_date: startIso,
    p_end_date: endIso,
    p_granularity: granularity,
    p_timezone: timezone,
    p_exclude_guest: excludeGuest,
  })

  if (error) {
    throw new Error(error.message || 'Gagal memuat laporan pelanggan')
  }

  const parsed: CustomersReportRpcResponse = {
    summary: { ...EMPTY_SUMMARY, ...(data?.summary || {}) },
    buckets: Array.isArray(data?.buckets) ? data.buckets : [],
  }

  reportMemoryCache.set(cacheKey, { data: parsed, timestamp: Date.now() })
  return parsed
}

// ─── Delta Badge Component ────────────────────────────────────────────────────
function DeltaBadge({ curr, prev }: { curr: number; prev: number }) {
  const delta = calcDeltaPct(curr, prev)
  if (delta === null) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
        Baru
      </span>
    )
  }
  const rounded = Math.round(delta * 10) / 10
  const isPositive = rounded > 0
  const isNegative = rounded < 0
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border ${
        isPositive
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
          : isNegative
            ? 'bg-rose-50 text-rose-700 border-rose-200/70'
            : 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {isPositive ? `+${rounded}%` : `${rounded}%`}
    </span>
  )
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function CustomersReportPage() {
  usePageBackNavigation()
  const { activeBusiness } = useUserContext()
  const businessId = activeBusiness?.id
  const timezone = useMemo(() => getBusinessTimezone(activeBusiness?.timezone), [activeBusiness?.timezone])

  // Temporal filter state (default: Tahun Ini / this-year or Bulan Ini / this-month)
  const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
    const limits = getLocalDateRangeLimits('this-year', timezone)
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

  const [granularity, setGranularity] = useState<Granularity>('month')
  const [excludeGuest, setExcludeGuest] = useState<boolean>(true)
  const [showCompareOnChart, setShowCompareOnChart] = useState<boolean>(false)
  const [showColumnsMenu, setShowColumnsMenu] = useState<boolean>(false)

  const [visibleCols, setVisibleCols] = useState({
    total_ltv: true,
    avg_ltv: true,
    total_orders: true,
    avg_orders: true,
    return_rate: true,
  })

  const [sortField, setSortField] = useState<SortField>('bucket_key')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const [currData, setCurrData] = useState<CustomersReportRpcResponse>({ summary: EMPTY_SUMMARY, buckets: [] })
  const [compData, setCompData] = useState<CustomersReportRpcResponse>({ summary: EMPTY_SUMMARY, buckets: [] })
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [hoveredBucket, setHoveredBucket] = useState<MergedBucketRow | null>(null)

  const requestIdRef = useRef<number>(0)

  const loadReport = useCallback(async () => {
    if (!businessId || !temporalFilter.startDate || !temporalFilter.endDate) return
    const reqId = ++requestIdRef.current
    setLoading(true)
    setErrorMsg(null)

    try {
      const currBounds = localDateToUtcBounds(temporalFilter.startDate, temporalFilter.endDate, timezone)
      if (!currBounds.startOfDayISO || !currBounds.endOfDayISO) {
        setLoading(false)
        return
      }

      const compBounds =
        temporalFilter.comparisonMode !== 'none' &&
        temporalFilter.comparisonStartDate &&
        temporalFilter.comparisonEndDate
          ? localDateToUtcBounds(
              temporalFilter.comparisonStartDate,
              temporalFilter.comparisonEndDate,
              timezone
            )
          : null

      const hasComp = Boolean(compBounds?.startOfDayISO && compBounds?.endOfDayISO)

      if (hasComp && compBounds?.startOfDayISO && compBounds?.endOfDayISO) {
        const [currRes, compRes] = await Promise.all([
          fetchCustomersReportWindow(
            businessId,
            currBounds.startOfDayISO,
            currBounds.endOfDayISO,
            granularity,
            timezone,
            excludeGuest
          ),
          fetchCustomersReportWindow(
            businessId,
            compBounds.startOfDayISO,
            compBounds.endOfDayISO,
            granularity,
            timezone,
            excludeGuest
          ),
        ])
        if (reqId !== requestIdRef.current) return
        setCurrData(currRes)
        setCompData(compRes)
      } else {
        const currRes = await fetchCustomersReportWindow(
          businessId,
          currBounds.startOfDayISO,
          currBounds.endOfDayISO,
          granularity,
          timezone,
          excludeGuest
        )
        if (reqId !== requestIdRef.current) return
        setCurrData(currRes)
        setCompData({ summary: EMPTY_SUMMARY, buckets: [] })
      }
    } catch (err: any) {
      if (reqId !== requestIdRef.current) return
      setErrorMsg(err?.message || 'Terjadi kesalahan saat memuat laporan pelanggan.')
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [businessId, temporalFilter, granularity, timezone, excludeGuest])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  // Build continuous time series buckets + align comparison buckets by index
  const chartBuckets: MergedBucketRow[] = useMemo(() => {
    const allKeys = generateAllBucketKeys(temporalFilter.startDate, temporalFilter.endDate, granularity)
    const bucketMap = new Map<string, BucketMetric>()
    for (const b of currData.buckets) {
      bucketMap.set(b.bucket_key, b)
    }

    const compKeys =
      temporalFilter.comparisonMode !== 'none' &&
      temporalFilter.comparisonStartDate &&
      temporalFilter.comparisonEndDate
        ? generateAllBucketKeys(temporalFilter.comparisonStartDate, temporalFilter.comparisonEndDate, granularity)
        : []
    const compMap = new Map<string, BucketMetric>()
    for (const b of compData.buckets) {
      compMap.set(b.bucket_key, b)
    }

    return allKeys.map((key, idx) => {
      const m = bucketMap.get(key)
      const compKey = compKeys[idx]
      const cm = compKey ? compMap.get(compKey) : undefined
      return {
        bucket_key: key,
        label: formatBucketLabel(key, granularity),
        customers: Number(m?.customers || 0),
        total_ltv: Number(m?.total_ltv || 0),
        avg_ltv: Number(m?.avg_ltv || 0),
        total_orders: Number(m?.total_orders || 0),
        avg_orders: Number(m?.avg_orders || 0),
        total_items: Number(m?.total_items || 0),
        returning_customers: Number(m?.returning_customers || 0),
        return_rate: Number(m?.return_rate || 0),
        compCustomers: Number(cm?.customers || 0),
        compTotalOrders: Number(cm?.total_orders || 0),
        compTotalLtv: Number(cm?.total_ltv || 0),
      }
    })
  }, [currData.buckets, compData.buckets, temporalFilter, granularity])

  // Table rows: only non-empty cohorts (or all sorted)
  const tableRows: MergedBucketRow[] = useMemo(() => {
    const nonEmpty = chartBuckets.filter((b) => b.customers > 0 || b.total_orders > 0)
    const sorted = [...nonEmpty].sort((a, b) => {
      const dir = sortOrder === 'asc' ? 1 : -1
      if (sortField === 'bucket_key') return a.bucket_key.localeCompare(b.bucket_key) * dir
      return ((a[sortField] as number) - (b[sortField] as number)) * dir
    })
    return sorted
  }, [chartBuckets, sortField, sortOrder])

  // Chart Y-axis scale with clean 4-interval ticks so bars & line fill ~85-90% of height
  const chartScale = useMemo(() => {
    let maxVal = 4
    for (const b of chartBuckets) {
      if (b.customers > maxVal) maxVal = b.customers
      if (b.total_orders > maxVal) maxVal = b.total_orders
      if (showCompareOnChart && b.compCustomers > maxVal) maxVal = b.compCustomers
    }
    const rawStep = (maxVal * 1.08) / 4
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const norm = rawStep / mag
    const niceSteps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
    const niceNorm = niceSteps.find((n) => norm <= n) ?? 10
    const step = Math.max(1, Math.ceil(niceNorm * mag))
    const max = step * 4
    return {
      max,
      ticks: [max, step * 3, step * 2, step, 0],
    }
  }, [chartBuckets, showCompareOnChart])
  const chartMaxY = chartScale.max

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder(field === 'bucket_key' ? 'asc' : 'desc')
    }
  }

  const handleExportExcel = () => {
    const rows = tableRows.map((r) => ({
      'Periode Pesanan Pertama': r.label,
      'Pelanggan Baru': r.customers,
      'Total LTV (IDR)': Math.round(r.total_ltv),
      'Rata-rata LTV (IDR)': Math.round(r.avg_ltv),
      'Total Pesanan': r.total_orders,
      'Rata-rata Pesanan': Number(r.avg_orders.toFixed(2)),
      'Tingkat Repeat (%)': Number(r.return_rate.toFixed(1)),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan Pelanggan')
    downloadWorkbook(wb, `laporan-pelanggan-${temporalFilter.startDate}-sd-${temporalFilter.endDate}.xlsx`)
  }

  const granularityTitle =
    granularity === 'day'
      ? 'Hari Pesanan Pertama'
      : granularity === 'week'
        ? 'Minggu Pesanan Pertama'
        : 'Bulan Pesanan Pertama'

  const hasComparison = temporalFilter.comparisonMode !== 'none'
  const s = currData.summary
  const cs = compData.summary

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 text-slate-800 su-fade-in">
      {/* ─── Top Header Bar (Identik dengan Revenue & Product Performance) ─── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Link
            href="/reports/revenue"
            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 shadow-2xs transition shrink-0"
            title="Kembali ke Laporan Revenue"
            aria-label="Kembali"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>

          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Laporan Pelanggan
          </h1>

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
            allowAllTime={false}
          />
        </div>
      </div>

      {/* ─── Subtitle & View Customers Link ───────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600 border-b border-slate-200/80 pb-3">
        <p>
          Pelanggan yang melakukan pesanan pertama pada periode ini, beserta seluruh transaksi yang dibuat sepanjang masa (lifetime).
        </p>
        <Link
          href="/customers"
          className="text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center gap-1 shrink-0 hover:underline"
        >
          <span>Lihat daftar pelanggan</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
      </div>

      {/* ─── Error Banner ─────────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button
            onClick={loadReport}
            className="px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 shrink-0"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* ─── Main Grid: Chart (8 cols) + Summary KPI Card (4 cols) ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Combo Chart Card */}
        <div className="lg:col-span-8 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm sm:text-base font-bold text-slate-900">Pelanggan Baru</h2>
              <button
                onClick={handleExportExcel}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                title="Unduh Excel"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasComparison && (
                <button
                  onClick={() => setShowCompareOnChart((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    showCompareOnChart
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Bandingkan
                </button>
              )}

              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="day">Harian</option>
                <option value="week">Mingguan</option>
                <option value="month">Bulanan</option>
              </select>
            </div>
          </div>

          <div className="p-5 flex-1 flex flex-col justify-between min-h-[300px] relative">
            {/* Legend (Fixed Height, Never Shifts on Hover) */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4 text-xs text-slate-500 min-h-[24px]">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
                  Pelanggan Baru
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 inline-block" />
                  Total Pesanan (Lifetime)
                </span>
                {showCompareOnChart && hasComparison && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-500">
                    <span className="w-4 border-t-2 border-dashed border-slate-400 inline-block" />
                    Periode Pembanding
                  </span>
                )}
              </div>
            </div>

            {/* Floating Hover Tooltip (Absolute — Zero Layout Shift) */}
            {hoveredBucket && (
              <div className="pointer-events-none absolute top-4 right-5 z-20 text-xs font-medium text-slate-700 bg-white/95 backdrop-blur-xs border border-slate-200 shadow-sm px-3 py-1.5 rounded-lg">
                <span className="font-bold text-slate-900">{hoveredBucket.label}:</span>{' '}
                {formatInt(hoveredBucket.customers)} pelanggan · {formatInt(hoveredBucket.total_orders)} pesanan · {formatCompactIDR(hoveredBucket.total_ltv)}
              </div>
            )}

            {/* Chart Area */}
            {loading ? (
              <div className="flex-1 flex items-center justify-center py-16">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <span className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <span>Memuat grafik pelanggan...</span>
                </div>
              </div>
            ) : chartBuckets.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-16 text-sm text-slate-400">
                Belum ada data pelanggan baru pada rentang tanggal ini.
              </div>
            ) : (
              <div className="relative flex-1 flex flex-col justify-between">
                <div className="relative flex-1 flex min-h-[260px]">
                  {/* Y-axis labels */}
                  <div className="w-11 pr-2.5 flex flex-col justify-between text-[11px] font-mono text-slate-400 text-right select-none shrink-0 py-0">
                    {chartScale.ticks.map((t, i) => (
                      <span key={i} className="leading-none -translate-y-1/2 first:translate-y-0 last:translate-y-1/2">
                        {formatInt(t)}
                      </span>
                    ))}
                  </div>

                  {/* Plot Area */}
                  <div className="flex-1 relative border-l border-b border-slate-200 min-w-0">
                    {/* Horizontal grid lines */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                      {chartScale.ticks.map((_, i) => (
                        <div key={i} className="border-t border-dashed border-slate-100 w-full last:border-t-0" />
                      ))}
                    </div>

                    {/* Bars Layer (Total Lifetime Orders per cohort bucket) */}
                    <div className="absolute inset-0 flex items-end justify-around px-1 gap-0.5">
                      {chartBuckets.map((b) => {
                        const orderHeightPct = chartMaxY > 0 ? Math.min(100, (b.total_orders / chartMaxY) * 100) : 0
                        return (
                          <div
                            key={b.bucket_key}
                            onMouseEnter={() => setHoveredBucket(b)}
                            onMouseLeave={() => setHoveredBucket(null)}
                            className="flex-1 h-full flex items-end justify-center cursor-pointer group min-w-0 hover:bg-indigo-50/40 transition-colors"
                          >
                            <div
                              style={{ height: `${b.total_orders > 0 ? Math.max(orderHeightPct, 2) : 0}%` }}
                              className="w-full max-w-[38px] bg-slate-200/85 group-hover:bg-slate-300 rounded-t-xs transition-all duration-200"
                            />
                          </div>
                        )
                      })}
                    </div>

                    {/* SVG Line Layer (New Customers) */}
                    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                      {showCompareOnChart && hasComparison && chartBuckets.length > 0 && (
                        <polyline
                          fill="none"
                          stroke="#94A3B8"
                          strokeWidth="1.8"
                          strokeDasharray="4 4"
                          vectorEffect="non-scaling-stroke"
                          points={chartBuckets
                            .map((b, i) => {
                              const x = ((i + 0.5) / chartBuckets.length) * 100
                              const y = 100 - Math.min(100, (b.compCustomers / chartMaxY) * 100)
                              return `${x},${y}`
                            })
                            .join(' ')}
                        />
                      )}

                      <polyline
                        fill="none"
                        stroke="#2563EB"
                        strokeWidth="2.2"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={chartBuckets
                          .map((b, i) => {
                            const x = ((i + 0.5) / chartBuckets.length) * 100
                            const y = 100 - Math.min(100, (b.customers / chartMaxY) * 100)
                            return `${x},${y}`
                          })
                          .join(' ')}
                      />
                    </svg>

                    {/* Dots Overlay */}
                    {chartBuckets.length <= 45 && (
                      <div className="absolute inset-0 pointer-events-none">
                        {chartBuckets.map((b, i) => {
                          const leftPct = ((i + 0.5) / chartBuckets.length) * 100
                          const bottomPct = Math.min(100, (b.customers / chartMaxY) * 100)
                          return (
                            <div
                              key={b.bucket_key}
                              style={{ left: `${leftPct}%`, bottom: `${bottomPct}%` }}
                              className="absolute -translate-x-1/2 translate-y-1/2 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white"
                            />
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* X-axis Labels */}
                <div className="pl-11 flex items-center justify-between pt-2.5 text-[11px] font-medium text-slate-400 select-none overflow-hidden">
                  {chartBuckets.map((b, idx) => {
                    const step = Math.max(1, Math.ceil(chartBuckets.length / 8))
                    const show = idx % step === 0 || idx === chartBuckets.length - 1
                    return (
                      <span key={b.bucket_key} className="flex-1 text-center truncate">
                        {show ? b.label : ''}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: KPI Summary Card */}
        <div className="lg:col-span-4 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col divide-y divide-slate-100">
          {/* Top KPI: Pelanggan Baru */}
          <div className="p-5">
            <div className="text-xs font-semibold text-slate-500">Pelanggan Baru</div>
            <div className="mt-1.5 flex items-baseline gap-2.5 flex-wrap">
              <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                {loading ? '—' : formatInt(s.new_customers)}
              </span>
              {!loading && hasComparison && <DeltaBadge curr={s.new_customers} prev={cs.new_customers} />}
            </div>
          </div>

          {/* Middle KPI: Menghasilkan */}
          <div className="p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Menghasilkan
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">Total Pesanan</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5 truncate">
                  {loading ? '—' : formatInt(s.total_orders)}
                </div>
                {!loading && hasComparison && (
                  <div className="mt-1">
                    <DeltaBadge curr={s.total_orders} prev={cs.total_orders} />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="text-xs text-slate-500">Total Belanja</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5 truncate" title={formatIDR(s.total_spend)}>
                  {loading ? '—' : formatIDR(s.total_spend)}
                </div>
                {!loading && hasComparison && (
                  <div className="mt-1">
                    <DeltaBadge curr={s.total_spend} prev={cs.total_spend} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom KPI: Rata-rata Pelanggan */}
          <div className="p-5 space-y-3.5 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Rata-rata Pelanggan
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">Nilai Seumur Hidup (LTV)</div>
                <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5 truncate">
                  {loading ? '—' : formatIDR(s.avg_ltv)}
                </div>
                {!loading && hasComparison && (
                  <div className="mt-1">
                    <DeltaBadge curr={s.avg_ltv} prev={cs.avg_ltv} />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="text-xs text-slate-500">Nilai per Pesanan (AOV)</div>
                <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5 truncate">
                  {loading ? '—' : formatIDR(s.avg_order_value)}
                </div>
                {!loading && hasComparison && (
                  <div className="mt-1">
                    <DeltaBadge curr={s.avg_order_value} prev={cs.avg_order_value} />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="text-xs text-slate-500">Pesanan / Pelanggan</div>
                <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                  {loading ? '—' : formatDec(s.avg_lifetime_orders, 2)}
                </div>
                {!loading && hasComparison && (
                  <div className="mt-1">
                    <DeltaBadge curr={s.avg_lifetime_orders} prev={cs.avg_lifetime_orders} />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="text-xs text-slate-500">Item / Pelanggan</div>
                <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                  {loading ? '—' : formatDec(s.avg_lifetime_items, 2)}
                </div>
                {!loading && hasComparison && (
                  <div className="mt-1">
                    <DeltaBadge curr={s.avg_lifetime_items} prev={cs.avg_lifetime_items} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Cohort Table: Grouped by First Ordered Period ────────────────── */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              Dikelompokkan berdasarkan {granularityTitle}
            </h2>
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setShowColumnsMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <span>Kolom</span>
            </button>

            {showColumnsMenu && (
              <div className="absolute right-10 top-9 z-20 w-48 bg-white border border-slate-200 rounded-xl shadow-lg p-2.5 space-y-1.5 text-xs">
                {[
                  { key: 'total_ltv', label: 'Total LTV' },
                  { key: 'avg_ltv', label: 'Rata-rata LTV' },
                  { key: 'total_orders', label: 'Total Pesanan' },
                  { key: 'avg_orders', label: 'Rata-rata Pesanan' },
                  { key: 'return_rate', label: 'Tingkat Repeat' },
                ].map((col) => (
                  <label key={col.key} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleCols[col.key as keyof typeof visibleCols]}
                      onChange={(e) =>
                        setVisibleCols((prev) => ({ ...prev, [col.key]: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    <span className="text-slate-700 font-medium">{col.label}</span>
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={handleExportExcel}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title="Ekspor Excel"
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
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th
                  onClick={() => handleSort('bucket_key')}
                  className="py-3.5 px-5 cursor-pointer hover:text-slate-800 whitespace-nowrap"
                >
                  {granularityTitle} {sortField === 'bucket_key' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th
                  onClick={() => handleSort('customers')}
                  className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-800 whitespace-nowrap"
                >
                  Pelanggan {sortField === 'customers' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                {visibleCols.total_ltv && (
                  <th
                    onClick={() => handleSort('total_ltv')}
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-800 whitespace-nowrap"
                  >
                    Total LTV {sortField === 'total_ltv' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                )}
                {visibleCols.avg_ltv && (
                  <th
                    onClick={() => handleSort('avg_ltv')}
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-800 whitespace-nowrap"
                  >
                    Rata-rata LTV {sortField === 'avg_ltv' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                )}
                {visibleCols.total_orders && (
                  <th
                    onClick={() => handleSort('total_orders')}
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-800 whitespace-nowrap"
                  >
                    Total Pesanan {sortField === 'total_orders' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                )}
                {visibleCols.avg_orders && (
                  <th
                    onClick={() => handleSort('avg_orders')}
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-800 whitespace-nowrap"
                  >
                    Rata-rata Pesanan {sortField === 'avg_orders' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                )}
                {visibleCols.return_rate && (
                  <th
                    onClick={() => handleSort('return_rate')}
                    className="py-3.5 px-5 text-right cursor-pointer hover:text-slate-800 whitespace-nowrap"
                  >
                    Tingkat Repeat {sortField === 'return_rate' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    Memuat data kohort pelanggan...
                  </td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    Tidak ada pelanggan baru pada periode yang dipilih.
                  </td>
                </tr>
              ) : (
                tableRows.map((row) => (
                  <tr key={row.bucket_key} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-5 font-semibold text-slate-900 whitespace-nowrap">{row.label}</td>
                    <td className="py-3.5 px-4 text-right font-semibold text-slate-800 tabular-nums">
                      {formatInt(row.customers)}
                    </td>
                    {visibleCols.total_ltv && (
                      <td className="py-3.5 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatIDR(row.total_ltv)}
                      </td>
                    )}
                    {visibleCols.avg_ltv && (
                      <td className="py-3.5 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatIDR(row.avg_ltv)}
                      </td>
                    )}
                    {visibleCols.total_orders && (
                      <td className="py-3.5 px-4 text-right text-slate-700 tabular-nums">
                        {formatInt(row.total_orders)}
                      </td>
                    )}
                    {visibleCols.avg_orders && (
                      <td className="py-3.5 px-4 text-right text-slate-700 tabular-nums">
                        {formatDec(row.avg_orders, 1)}
                      </td>
                    )}
                    {visibleCols.return_rate && (
                      <td className="py-3.5 px-5 text-right font-medium text-slate-700 tabular-nums">
                        {formatDec(row.return_rate, 1)}%
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
