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
} from '@/lib/localzone'

// ─── Types ────────────────────────────────────────────────────────────────────
type TimeUnit = 'day' | 'week' | 'month'

type RetentionSummary = {
  total_customers: number
  onetime_customers: number
  returning_customers: number
  retention_rate: number
  total_orders: number
  total_spend: number
  avg_order_spend: number
  avg_lifetime_orders: number
  min_lifetime_orders: number
  max_lifetime_orders: number
  onetime_orders: number
  onetime_spend: number
  onetime_avg_order: number
  onetime_avg_ltv: number
  returning_orders: number
  returning_spend: number
  returning_avg_order: number
  returning_avg_ltv: number
  returning_vs_onetime_ltv_multiplier: number
  total_items: number
  avg_lifetime_items: number
  min_lifetime_items: number
  max_lifetime_items: number
  repeat_pair_count: number
  repeat_avg_days: number
  repeat_min_days: number
  repeat_max_days: number
}

type OrderBucket = {
  bucket_key: string
  customers: number
  total_orders: number
  total_spend: number
  avg_order_spend: number
}

type RepeatTimeBucket = {
  bucket_key: string
  repeat_orders: number
}

type ItemBucket = {
  bucket_key: string
  customers: number
}

type RetentionRpcResponse = {
  summary: RetentionSummary
  order_buckets: OrderBucket[]
  repeat_time_buckets: RepeatTimeBucket[]
  item_buckets: ItemBucket[]
}

// ─── L1 In-Memory Cache (TTL 60s) ─────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 1000
const retentionCache = new Map<string, { data: RetentionRpcResponse; timestamp: number }>()

const EMPTY_SUMMARY: RetentionSummary = {
  total_customers: 0,
  onetime_customers: 0,
  returning_customers: 0,
  retention_rate: 0,
  total_orders: 0,
  total_spend: 0,
  avg_order_spend: 0,
  avg_lifetime_orders: 0,
  min_lifetime_orders: 0,
  max_lifetime_orders: 0,
  onetime_orders: 0,
  onetime_spend: 0,
  onetime_avg_order: 0,
  onetime_avg_ltv: 0,
  returning_orders: 0,
  returning_spend: 0,
  returning_avg_order: 0,
  returning_avg_ltv: 0,
  returning_vs_onetime_ltv_multiplier: 0,
  total_items: 0,
  avg_lifetime_items: 0,
  min_lifetime_items: 0,
  max_lifetime_items: 0,
  repeat_pair_count: 0,
  repeat_avg_days: 0,
  repeat_min_days: 0,
  repeat_max_days: 0,
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

// Tight Y-axis scale helper per page-layout-ux standard
function computeTightYAxis(rawMax: number, minStepFloor = 4): { max: number; ticks: number[] } {
  const safeMax = Math.max(rawMax * 1.08, minStepFloor)
  const magnitude = Math.pow(10, Math.floor(Math.log10(safeMax)))
  const norm = safeMax / magnitude
  const ladder = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const chosen = ladder.find((v) => v >= norm) ?? 10
  const max = chosen * magnitude
  return {
    max,
    ticks: [max, max * 0.75, max * 0.5, max * 0.25, 0],
  }
}

const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  day: 'hari',
  week: 'minggu',
  month: 'bulan',
}

const TIME_UNIT_DIVISOR: Record<TimeUnit, number> = {
  day: 1,
  week: 7,
  month: 30,
}

// ─── RPC Fetcher with L1 Cache ────────────────────────────────────────────────
async function fetchRetentionMetrics(
  businessId: string,
  startIso: string,
  endIso: string,
  timeUnit: TimeUnit,
  excludeGuest: boolean
): Promise<RetentionRpcResponse> {
  const cacheKey = `${businessId}_${startIso}_${endIso}_${timeUnit}_${excludeGuest}`
  const cached = retentionCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  const { data, error } = await supabase.rpc('get_customer_retention_metrics', {
    p_business_id: businessId,
    p_start_date: startIso,
    p_end_date: endIso,
    p_time_unit: timeUnit,
    p_exclude_guest: excludeGuest,
  })

  if (error) {
    throw new Error(error.message || 'Gagal memuat laporan retensi pelanggan')
  }

  const parsed: RetentionRpcResponse = {
    summary: { ...EMPTY_SUMMARY, ...(data?.summary || {}) },
    order_buckets: Array.isArray(data?.order_buckets) ? data.order_buckets : [],
    repeat_time_buckets: Array.isArray(data?.repeat_time_buckets) ? data.repeat_time_buckets : [],
    item_buckets: Array.isArray(data?.item_buckets) ? data.item_buckets : [],
  }

  retentionCache.set(cacheKey, { data: parsed, timestamp: Date.now() })
  return parsed
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function CustomerRetentionReportPage() {
  usePageBackNavigation()
  const { activeBusiness } = useUserContext()
  const businessId = activeBusiness?.id
  const timezone = useMemo(() => getBusinessTimezone(activeBusiness?.timezone), [activeBusiness?.timezone])

  // Temporal filter state (single period without comparison)
  const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
    const limits = getLocalDateRangeLimits('this-year', timezone)
    return {
      startDate: limits.start,
      endDate: limits.end,
      preset: 'this-year',
      comparisonMode: 'none',
      comparisonStartDate: '',
      comparisonEndDate: '',
      comparisonLabel: '',
    }
  })

  const [timeUnit, setTimeUnit] = useState<TimeUnit>('week')
  const [excludeGuest, setExcludeGuest] = useState<boolean>(true)
  const [data, setData] = useState<RetentionRpcResponse>({
    summary: EMPTY_SUMMARY,
    order_buckets: [],
    repeat_time_buckets: [],
    item_buckets: [],
  })
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Hover states for floating tooltips (Zero Layout Shift)
  const [hoveredOrderBucket, setHoveredOrderBucket] = useState<OrderBucket | null>(null)
  const [hoveredRepeatBucket, setHoveredRepeatBucket] = useState<RepeatTimeBucket | null>(null)
  const [hoveredItemBucket, setHoveredItemBucket] = useState<ItemBucket | null>(null)

  const requestIdRef = useRef<number>(0)

  const loadReport = useCallback(async () => {
    if (!businessId || !temporalFilter.startDate || !temporalFilter.endDate) return
    const reqId = ++requestIdRef.current
    setLoading(true)
    setErrorMsg(null)

    try {
      const bounds = localDateToUtcBounds(temporalFilter.startDate, temporalFilter.endDate, timezone)
      if (!bounds.startOfDayISO || !bounds.endOfDayISO) {
        setLoading(false)
        return
      }

      const res = await fetchRetentionMetrics(
        businessId,
        bounds.startOfDayISO,
        bounds.endOfDayISO,
        timeUnit,
        excludeGuest
      )
      if (reqId !== requestIdRef.current) return
      setData(res)
    } catch (err: any) {
      if (reqId !== requestIdRef.current) return
      setErrorMsg(err?.message || 'Terjadi kesalahan saat memuat laporan retensi pelanggan')
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [businessId, temporalFilter.startDate, temporalFilter.endDate, timezone, timeUnit, excludeGuest])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  // ─── Chart Scales ──────────────────────────────────────────────────────────
  const orderCustScale = useMemo(() => {
    const maxVal = Math.max(...data.order_buckets.map((b) => Number(b.customers) || 0), 0)
    return computeTightYAxis(maxVal, 4)
  }, [data.order_buckets])

  const orderSpendScale = useMemo(() => {
    const maxVal = Math.max(...data.order_buckets.map((b) => Number(b.avg_order_spend) || 0), 0)
    return computeTightYAxis(maxVal, 10000)
  }, [data.order_buckets])

  const repeatScale = useMemo(() => {
    const maxVal = Math.max(...data.repeat_time_buckets.map((b) => Number(b.repeat_orders) || 0), 0)
    return computeTightYAxis(maxVal, 4)
  }, [data.repeat_time_buckets])

  const itemScale = useMemo(() => {
    const maxVal = Math.max(...data.item_buckets.map((b) => Number(b.customers) || 0), 0)
    return computeTightYAxis(maxVal, 4)
  }, [data.item_buckets])

  const s = data.summary
  const onetimePct = s.total_customers > 0 ? (s.onetime_customers / s.total_customers) * 100 : 0
  const returningPct = s.total_customers > 0 ? (s.returning_customers / s.total_customers) * 100 : 0
  const divisor = TIME_UNIT_DIVISOR[timeUnit]
  const unitLabel = TIME_UNIT_LABELS[timeUnit]

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 text-slate-800 su-fade-in">
      {/* ─── Row 1: Header & Filter Tanggal ────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Link
            href="/reports/customers"
            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 shadow-2xs transition shrink-0"
            title="Kembali ke Laporan Pelanggan"
            aria-label="Kembali"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>

          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Retensi Pelanggan
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
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200/80 text-[11px] font-semibold text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            Pesanan Pertama
          </span>
          <TemporalDateFilter
            value={temporalFilter}
            onChange={setTemporalFilter}
            timezone={activeBusiness?.timezone}
            showComparison={false}
            allowAllTime={false}
            align="right"
          />
        </div>
      </div>

      {/* ─── Row 2: Subtitle & Link Daftar Pelanggan ───────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600 border-b border-slate-200/80 pb-3">
        <p>
          Seberapa baik Anda mempertahankan pelanggan — dari saat mereka pertama kali bergabung hingga kembali berbelanja sepanjang masa (lifetime).
        </p>
        <Link
          href="/customers"
          className="text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center gap-1 shrink-0 hover:underline"
        >
          <span>Lihat daftar pelanggan</span>
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
      </div>

      {/* ─── Error Banner ──────────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={loadReport}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition shrink-0"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* ─── Section 1: Orders Over Customer Lifetime & Retention Summary ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Chart Card (8 cols) */}
        <div className="lg:col-span-8 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col relative">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold text-slate-900">
                Distribusi Pesanan Sepanjang Masa
              </h2>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold cursor-help"
                title="Mengelompokkan pelanggan berdasarkan total jumlah pesanan sepanjang masa (1, 2, 3, 4, 5-9, 10+) beserta rata-rata nilai pesanan."
              >
                i
              </span>
            </div>

            <div className="flex items-center gap-4 text-[11px] font-semibold text-slate-600 min-h-[24px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600" />
                Pelanggan
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-400" />
                Rata-rata Belanja / Pesanan
              </span>
            </div>
          </div>

          {/* Floating Tooltip (Zero Layout Shift) */}
          {hoveredOrderBucket && (
            <div className="absolute top-16 right-5 z-20 pointer-events-none bg-slate-900/95 text-white rounded-xl px-3.5 py-2.5 shadow-lg text-xs space-y-1 min-w-[200px]">
              <div className="font-bold text-slate-100 border-b border-slate-700 pb-1">
                {hoveredOrderBucket.bucket_key} Pesanan Lifetime
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-300">Pelanggan:</span>
                <span className="font-bold text-indigo-300">{formatInt(hoveredOrderBucket.customers)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-300">Rata-rata Pesanan:</span>
                <span className="font-bold text-amber-300">{formatIDR(hoveredOrderBucket.avg_order_spend)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-300">Total Pesanan:</span>
                <span className="font-semibold">{formatInt(hoveredOrderBucket.total_orders)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-300">Total Belanja:</span>
                <span className="font-semibold">{formatCompactIDR(hoveredOrderBucket.total_spend)}</span>
              </div>
            </div>
          )}

          <div className="p-5 flex-1 flex flex-col justify-between">
            {loading ? (
              <div className="flex-1 min-h-[260px] flex items-center justify-center">
                <div className="w-full h-[240px] bg-slate-100 animate-pulse rounded-lg" />
              </div>
            ) : s.total_customers === 0 ? (
              <div className="flex-1 min-h-[260px] flex flex-col items-center justify-center text-center text-slate-400 text-xs gap-1">
                <span className="font-semibold text-slate-500">Belum ada data pelanggan pada periode ini</span>
                <span>Coba perluas rentang tanggal atau nonaktifkan filter pelanggan tamu.</span>
              </div>
            ) : (
              <div className="flex-1 min-h-[260px] flex flex-col">
                <div className="flex-1 flex items-stretch gap-2">
                  {/* Left Y-Axis (Customers) */}
                  <div className="w-10 shrink-0 flex flex-col justify-between text-right text-[10px] font-medium text-slate-400 pb-6">
                    {orderCustScale.ticks.map((t, idx) => (
                      <span key={idx}>{formatInt(t)}</span>
                    ))}
                  </div>

                  {/* Plot Area */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex-1 relative border-b border-slate-200 flex items-end justify-around gap-2 sm:gap-4 px-2">
                      {/* Horizontal Gridlines */}
                      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                        {orderCustScale.ticks.map((_, idx) => (
                          <div key={idx} className="w-full border-t border-slate-100" />
                        ))}
                      </div>

                      {data.order_buckets.map((bucket) => {
                        const custPct = Math.min(100, (Number(bucket.customers) / orderCustScale.max) * 100)
                        const spendPct = Math.min(100, (Number(bucket.avg_order_spend) / orderSpendScale.max) * 100)
                        return (
                          <div
                            key={bucket.bucket_key}
                            onMouseEnter={() => setHoveredOrderBucket(bucket)}
                            onMouseLeave={() => setHoveredOrderBucket(null)}
                            className="relative z-10 flex-1 max-w-[84px] h-full flex items-end justify-center gap-1.5 group cursor-pointer"
                          >
                            {/* Customers Bar (Blue) */}
                            <div
                              style={{ height: `${bucket.customers > 0 ? Math.max(2, custPct) : 0}%` }}
                              className="w-1/2 max-w-[28px] bg-indigo-600 group-hover:bg-indigo-500 rounded-t transition-all duration-200"
                            />
                            {/* Avg Order Spend Bar (Amber) */}
                            <div
                              style={{ height: `${bucket.avg_order_spend > 0 ? Math.max(2, spendPct) : 0}%` }}
                              className="w-1/2 max-w-[28px] bg-amber-400 group-hover:bg-amber-300 rounded-t transition-all duration-200"
                            />
                          </div>
                        )
                      })}
                    </div>

                    {/* X-Axis Labels */}
                    <div className="h-6 flex items-center justify-around gap-2 sm:gap-4 px-2 pt-1.5 text-[11px] font-semibold text-slate-600">
                      {data.order_buckets.map((b) => (
                        <div key={b.bucket_key} className="flex-1 max-w-[84px] text-center truncate">
                          {b.bucket_key}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Y-Axis (Avg Order Spend) */}
                  <div className="w-16 shrink-0 flex flex-col justify-between text-left text-[10px] font-medium text-slate-400 pb-6">
                    {orderSpendScale.ticks.map((t, idx) => (
                      <span key={idx}>{formatCompactIDR(t)}</span>
                    ))}
                  </div>
                </div>
                <div className="text-center text-[11px] font-medium text-slate-400 mt-1">
                  Jumlah Pesanan Sepanjang Masa
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Summary KPI Card (4 cols) */}
        <div className="lg:col-span-4 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs p-5 flex flex-col justify-between gap-4">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-14 bg-slate-100 rounded-lg" />
              <div className="h-20 bg-slate-100 rounded-lg" />
              <div className="h-16 bg-slate-100 rounded-lg" />
            </div>
          ) : (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500">Tingkat Retensi</div>
                <div className="text-3xl font-extrabold text-slate-900 tracking-tight mt-0.5">
                  {formatDec(s.retention_rate, 2)}%
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {formatInt(s.returning_customers)} dari {formatInt(s.total_customers)} pelanggan baru kembali berbelanja
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                    Pelanggan
                    <span className="w-2 h-2 rounded-full bg-indigo-600" />
                  </span>
                  <span className="font-bold text-slate-900">{formatInt(s.total_customers)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                    Rata-rata belanja / pesanan
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                  </span>
                  <span className="font-bold text-slate-900">{formatIDR(s.avg_order_spend)}</span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-500">Rata-rata pesanan</div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                    {formatDec(s.avg_lifetime_orders, 1)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    dari {formatInt(s.min_lifetime_orders)} hingga {formatInt(s.max_lifetime_orders)} pesanan
                  </div>
                </div>
                <div className="min-w-0 border-l border-slate-100 pl-3">
                  <div className="text-[11px] font-semibold text-slate-500">Kembali belanja</div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                    {formatInt(s.returning_customers)}
                  </div>
                  <div className="text-[11px] text-slate-400">membuat 2+ pesanan</div>
                </div>
              </div>

              <div className="rounded-xl bg-indigo-50/80 border border-indigo-100 p-3 flex items-start gap-2.5 text-xs text-indigo-950">
                <span className="text-indigo-600 shrink-0 mt-0.5" aria-hidden="true">
                  💡
                </span>
                <p className="leading-relaxed">
                  {s.returning_vs_onetime_ltv_multiplier > 0 ? (
                    <>
                      Pelanggan repeat berbelanja{' '}
                      <strong className="font-bold text-indigo-700">
                        {formatDec(s.returning_vs_onetime_ltv_multiplier, 1)}x
                      </strong>{' '}
                      lebih banyak sepanjang masa dibanding pelanggan sekali beli.
                    </>
                  ) : (
                    'Belum ada pelanggan repeat pada kohort periode ini untuk dibandingkan.'
                  )}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Section 2: One-time vs Returning Customers ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* One-time customers */}
        <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-bold text-slate-900">Pelanggan Sekali Beli</h3>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold cursor-help"
                title="Pelanggan dalam kohort ini yang baru melakukan tepat 1 pesanan sepanjang masa."
              >
                i
              </span>
            </div>
            <span className="text-sm font-bold text-slate-800">{formatDec(onetimePct, 1)}%</span>
          </div>

          <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              style={{ width: `${Math.min(100, onetimePct)}%` }}
              className="h-full bg-indigo-600 rounded-full transition-all duration-300"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Jumlah</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{formatInt(s.onetime_customers)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Pesanan</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{formatInt(s.onetime_orders)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Total Belanja</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 truncate" title={formatIDR(s.onetime_spend)}>
                {formatIDR(s.onetime_spend)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Rata-rata Pesanan</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 truncate" title={formatIDR(s.onetime_avg_order)}>
                {formatIDR(s.onetime_avg_order)}
              </div>
            </div>
          </div>
        </div>

        {/* Returning customers */}
        <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-bold text-slate-900">Pelanggan Repeat</h3>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold cursor-help"
                title="Pelanggan dalam kohort ini yang melakukan 2 pesanan atau lebih sepanjang masa."
              >
                i
              </span>
            </div>
            <span className="text-sm font-bold text-slate-800">{formatDec(returningPct, 1)}%</span>
          </div>

          <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              style={{ width: `${Math.min(100, returningPct)}%` }}
              className="h-full bg-violet-600 rounded-full transition-all duration-300"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Jumlah</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{formatInt(s.returning_customers)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Pesanan</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{formatInt(s.returning_orders)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Total Belanja</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 truncate" title={formatIDR(s.returning_spend)}>
                {formatIDR(s.returning_spend)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500">Rata-rata Pesanan</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 truncate" title={formatIDR(s.returning_avg_order)}>
                {formatIDR(s.returning_avg_order)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Section 3: Time Between Repeat Orders ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Chart Card (8 cols) */}
        <div className="lg:col-span-8 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col relative">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold text-slate-900">
                Jeda Waktu Repeat Order
              </h2>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold cursor-help"
                title="Distribusi selisih waktu antar pesanan berurutan dari pelanggan repeat."
              >
                i
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">Satuan:</span>
              <select
                value={timeUnit}
                onChange={(e) => setTimeUnit(e.target.value as TimeUnit)}
                aria-label="Satuan waktu repeat order"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              >
                <option value="day">Hari</option>
                <option value="week">Minggu</option>
                <option value="month">Bulan</option>
              </select>
            </div>
          </div>

          {/* Floating Tooltip (Zero Layout Shift) */}
          {hoveredRepeatBucket && (
            <div className="absolute top-16 right-5 z-20 pointer-events-none bg-slate-900/95 text-white rounded-xl px-3.5 py-2 shadow-lg text-xs space-y-0.5">
              <div className="font-bold text-slate-100">
                Jeda {hoveredRepeatBucket.bucket_key} {unitLabel}
              </div>
              <div className="text-indigo-300 font-semibold">
                {formatInt(hoveredRepeatBucket.repeat_orders)} transaksi repeat
              </div>
            </div>
          )}

          <div className="p-5 flex-1 flex flex-col">
            {loading ? (
              <div className="flex-1 min-h-[240px] flex items-center justify-center">
                <div className="w-full h-[220px] bg-slate-100 animate-pulse rounded-lg" />
              </div>
            ) : s.repeat_pair_count === 0 ? (
              <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center text-center text-slate-400 text-xs gap-1">
                <span className="font-semibold text-slate-500">Belum ada transaksi repeat order</span>
                <span>Grafik jeda waktu akan muncul setelah ada pelanggan yang memesan minimal 2 kali.</span>
              </div>
            ) : (
              <div className="flex-1 min-h-[240px] flex items-stretch gap-2">
                <div className="w-10 shrink-0 flex flex-col justify-between text-right text-[10px] font-medium text-slate-400 pb-6">
                  {repeatScale.ticks.map((t, idx) => (
                    <span key={idx}>{formatInt(t)}</span>
                  ))}
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex-1 relative border-b border-slate-200 flex items-end justify-around gap-1.5 px-1">
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                      {repeatScale.ticks.map((_, idx) => (
                        <div key={idx} className="w-full border-t border-slate-100" />
                      ))}
                    </div>

                    {data.repeat_time_buckets.map((bucket) => {
                      const pct = Math.min(100, (Number(bucket.repeat_orders) / repeatScale.max) * 100)
                      return (
                        <div
                          key={bucket.bucket_key}
                          onMouseEnter={() => setHoveredRepeatBucket(bucket)}
                          onMouseLeave={() => setHoveredRepeatBucket(null)}
                          className="relative z-10 flex-1 max-w-[44px] h-full flex items-end justify-center group cursor-pointer"
                        >
                          <div
                            style={{ height: `${bucket.repeat_orders > 0 ? Math.max(2, pct) : 0}%` }}
                            className="w-full bg-indigo-600 group-hover:bg-indigo-500 rounded-t transition-all duration-200"
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="h-6 flex items-center justify-around gap-1.5 px-1 pt-1.5 text-[11px] font-semibold text-slate-600">
                    {data.repeat_time_buckets.map((b) => (
                      <div key={b.bucket_key} className="flex-1 max-w-[44px] text-center truncate">
                        {b.bucket_key}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Summary Card (4 cols) */}
        <div className="lg:col-span-4 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs p-5 flex flex-col justify-between gap-4">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-14 bg-slate-100 rounded-lg" />
              <div className="h-16 bg-slate-100 rounded-lg" />
            </div>
          ) : (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500">Rata-rata Jeda Repeat Order</div>
                <div className="text-2xl font-extrabold text-slate-900 tracking-tight mt-1">
                  {formatDec(s.repeat_avg_days / divisor, 2)}{' '}
                  <span className="text-sm font-semibold text-slate-500">{unitLabel}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Berdasarkan {formatInt(s.returning_customers)} pelanggan repeat
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-500">Tercepat</div>
                  <div className="text-base font-extrabold text-slate-900 mt-0.5">
                    {formatDec(s.repeat_min_days / divisor, 2)}{' '}
                    <span className="text-xs font-medium text-slate-500">{unitLabel}</span>
                  </div>
                </div>
                <div className="min-w-0 border-l border-slate-100 pl-3">
                  <div className="text-[11px] font-semibold text-slate-500">Terlama</div>
                  <div className="text-base font-extrabold text-slate-900 mt-0.5">
                    {formatDec(s.repeat_max_days / divisor, 2)}{' '}
                    <span className="text-xs font-medium text-slate-500">{unitLabel}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Section 4: Items Bought Over Customer Lifetime ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Chart Card (8 cols) */}
        <div className="lg:col-span-8 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex flex-col relative">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold text-slate-900">
                Total Item Dibeli Sepanjang Masa
              </h2>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold cursor-help"
                title="Distribusi jumlah total item yang dibeli oleh masing-masing pelanggan sepanjang masa."
              >
                i
              </span>
            </div>
          </div>

          {/* Floating Tooltip (Zero Layout Shift) */}
          {hoveredItemBucket && (
            <div className="absolute top-16 right-5 z-20 pointer-events-none bg-slate-900/95 text-white rounded-xl px-3.5 py-2 shadow-lg text-xs space-y-0.5">
              <div className="font-bold text-slate-100">
                {hoveredItemBucket.bucket_key} Item Lifetime
              </div>
              <div className="text-indigo-300 font-semibold">
                {formatInt(hoveredItemBucket.customers)} pelanggan
              </div>
            </div>
          )}

          <div className="p-5 flex-1 flex flex-col">
            {loading ? (
              <div className="flex-1 min-h-[240px] flex items-center justify-center">
                <div className="w-full h-[220px] bg-slate-100 animate-pulse rounded-lg" />
              </div>
            ) : s.total_customers === 0 ? (
              <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center text-center text-slate-400 text-xs gap-1">
                <span className="font-semibold text-slate-500">Belum ada data item pelanggan</span>
                <span>Data akan tampil setelah ada pesanan valid pada periode terpilih.</span>
              </div>
            ) : (
              <div className="flex-1 min-h-[240px] flex items-stretch gap-2">
                <div className="w-10 shrink-0 flex flex-col justify-between text-right text-[10px] font-medium text-slate-400 pb-6">
                  {itemScale.ticks.map((t, idx) => (
                    <span key={idx}>{formatInt(t)}</span>
                  ))}
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex-1 relative border-b border-slate-200 flex items-end justify-around gap-2 px-2">
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                      {itemScale.ticks.map((_, idx) => (
                        <div key={idx} className="w-full border-t border-slate-100" />
                      ))}
                    </div>

                    {data.item_buckets.map((bucket) => {
                      const pct = Math.min(100, (Number(bucket.customers) / itemScale.max) * 100)
                      return (
                        <div
                          key={bucket.bucket_key}
                          onMouseEnter={() => setHoveredItemBucket(bucket)}
                          onMouseLeave={() => setHoveredItemBucket(null)}
                          className="relative z-10 flex-1 max-w-[52px] h-full flex items-end justify-center group cursor-pointer"
                        >
                          <div
                            style={{ height: `${bucket.customers > 0 ? Math.max(2, pct) : 0}%` }}
                            className="w-full bg-indigo-600 group-hover:bg-indigo-500 rounded-t transition-all duration-200"
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="h-6 flex items-center justify-around gap-2 px-2 pt-1.5 text-[11px] font-semibold text-slate-600">
                    {data.item_buckets.map((b) => (
                      <div key={b.bucket_key} className="flex-1 max-w-[52px] text-center truncate">
                        {b.bucket_key}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Summary Card (4 cols) */}
        <div className="lg:col-span-4 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs p-5 flex flex-col justify-center">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-10 bg-slate-100 rounded-lg" />
              <div className="h-6 bg-slate-100 rounded-lg" />
            </div>
          ) : (
            <div>
              <div className="text-xs font-semibold text-slate-500">Rata-rata Item Dibeli</div>
              <div className="text-2xl font-extrabold text-slate-900 tracking-tight mt-1">
                {formatInt(s.avg_lifetime_items)}{' '}
                <span className="text-sm font-semibold text-slate-500">item</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Dari {formatInt(s.min_lifetime_items)} item hingga {formatInt(s.max_lifetime_items)} item sepanjang masa
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

