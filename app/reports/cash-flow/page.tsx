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
} from '@/lib/localzone'
import {
  formatCurrencyIDR,
  fetchCashFlowAnalytics,
  fetchApArSummary,
  CashFlowAnalyticsData,
  CashFlowTimeSeriesPoint,
  ApArSummaryData,
} from '@/app/accounting/utils'

type Granularity = 'day' | 'week' | 'month'

const EMPTY_AP_AR: ApArSummaryData = {
  as_of_date: '',
  receivables: {
    outstanding_amount: 0,
    outstanding_count: 0,
    overdue_amount: 0,
    overdue_count: 0,
    due_soon_amount: 0,
    due_soon_count: 0,
  },
  payables: {
    outstanding_amount: 0,
    outstanding_count: 0,
    overdue_amount: 0,
    overdue_count: 0,
    due_soon_amount: 0,
    due_soon_count: 0,
    purchases_amount: 0,
    purchases_count: 0,
    expenses_amount: 0,
    expenses_count: 0,
  },
}

const EMPTY_DATA: CashFlowAnalyticsData = {
  starting_cash: 0,
  ending_cash: 0,
  net_change: 0,
  total_inflow: 0,
  total_outflow: 0,
  cash_accounts: [],
  time_series: [],
  top_inflows: [],
  top_outflows: [],
}

function niceCeil(rawMax: number): number {
  if (rawMax <= 0) return 1_000_000
  const target = rawMax * 1.08
  const mag = Math.pow(10, Math.floor(Math.log10(target)))
  const norm = target / mag
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const chosen = steps.find((s) => s >= norm) ?? 10
  return chosen * mag
}

function formatCompactIDR(val: number): string {
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}Rp${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000_000) return `${sign}Rp${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}jt`
  if (abs >= 1_000) return `${sign}Rp${(abs / 1_000).toFixed(0)}rb`
  return `${sign}Rp${Math.round(abs)}`
}

function formatBucketLabel(dateStr: string, granularity: Granularity): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  if (granularity === 'month') {
    return `${months[(m || 1) - 1]} ${String(y).slice(-2)}`
  }
  if (granularity === 'week') {
    return `Mg ${d} ${months[(m || 1) - 1]}`
  }
  return `${d} ${months[(m || 1) - 1]}`
}

function calcDeltaPct(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) {
    return curr === 0 ? 0 : null
  }
  return ((curr - prev) / Math.abs(prev)) * 100
}

function DeltaBadge({
  curr,
  prev,
  reversePolarity = false,
}: {
  curr: number
  prev: number
  reversePolarity?: boolean
}) {
  const pct = calcDeltaPct(curr, prev)
  if (pct === null) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">
        Baru
      </span>
    )
  }
  const isUp = pct > 0.05
  const isDown = pct < -0.05
  const isGood = reversePolarity ? isDown : isUp
  const isBad = reversePolarity ? isUp : isDown

  const cls = isGood
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
    : isBad
    ? 'bg-rose-50 text-rose-700 border-rose-200/70'
    : 'bg-slate-100 text-slate-600 border-slate-200/70'

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold ${cls}`}>
      {isUp ? '▲' : isDown ? '▼' : '•'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

export default function CashFlowAnalyticsPage() {
  const { activeBusiness, bizLoading } = useUserContext()
  const goBack = usePageBackNavigation()
  const businessTz = getBusinessTimezone(activeBusiness?.timezone)

  const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
    const limits = getLocalDateRangeLimits('last-30', businessTz)
    const comp = resolveComparisonRange('previous_period', limits.start, limits.end)
    return {
      startDate: limits.start,
      endDate: limits.end,
      preset: 'last-30',
      comparisonMode: 'previous_period',
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }
  })

  const [granularity, setGranularity] = useState<Granularity>('day')
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [showBars, setShowBars] = useState<boolean>(true)
  const [showCompareLine, setShowCompareLine] = useState<boolean>(true)
  const [flowTab, setFlowTab] = useState<'inflows' | 'outflows'>('outflows')

  const [data, setData] = useState<CashFlowAnalyticsData>(EMPTY_DATA)
  const [compData, setCompData] = useState<CashFlowAnalyticsData | null>(null)
  const [apArData, setApArData] = useState<ApArSummaryData>(EMPTY_AP_AR)
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const requestIdRef = useRef(0)

  const hasComparison =
    temporalFilter.comparisonMode !== 'none' &&
    Boolean(temporalFilter.comparisonStartDate) &&
    Boolean(temporalFilter.comparisonEndDate)

  const loadAnalytics = useCallback(async () => {
    if (bizLoading) return
    if (!activeBusiness?.id) {
      setErrorMsg('Belum ada unit bisnis aktif yang dipilih.')
      setLoading(false)
      return
    }

    const reqId = ++requestIdRef.current
    setLoading(true)
    setErrorMsg(null)

    const accountParam = selectedAccountId !== 'all' ? selectedAccountId : null

    try {
      const promises: Promise<CashFlowAnalyticsData>[] = [
        fetchCashFlowAnalytics(
          supabase,
          activeBusiness.id,
          temporalFilter.startDate,
          temporalFilter.endDate,
          businessTz,
          granularity,
          accountParam
        ),
      ]

      if (hasComparison) {
        promises.push(
          fetchCashFlowAnalytics(
            supabase,
            activeBusiness.id,
            temporalFilter.comparisonStartDate,
            temporalFilter.comparisonEndDate,
            businessTz,
            granularity,
            accountParam
          )
        )
      }

      const apArPromise = fetchApArSummary(supabase, activeBusiness.id, businessTz).catch((e) => {
        console.warn('AP/AR summary load warning:', e)
        return EMPTY_AP_AR
      })

      const [analyticsResults, apArRes] = await Promise.all([
        Promise.all(promises),
        apArPromise,
      ])
      if (reqId !== requestIdRef.current) return

      const [currRes, prevRes] = analyticsResults
      setData(currRes || EMPTY_DATA)
      setCompData(prevRes || null)
      setApArData(apArRes || EMPTY_AP_AR)
    } catch (err: any) {
      if (reqId !== requestIdRef.current) return
      console.error('Error loading cash flow analytics:', err)
      setErrorMsg(err?.message || 'Gagal memuat analitik arus kas')
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [
    bizLoading,
    activeBusiness?.id,
    temporalFilter.startDate,
    temporalFilter.endDate,
    temporalFilter.comparisonStartDate,
    temporalFilter.comparisonEndDate,
    hasComparison,
    businessTz,
    granularity,
    selectedAccountId,
  ])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  // ─── Chart Scaling Calculations ─────────────────────────────────────────────
  const series = data.time_series || []
  const compSeries = compData?.time_series || []

  const chartScale = useMemo(() => {
    const balValues: number[] = series.map((p) => Number(p.running_balance || 0))
    if (hasComparison && showCompareLine && compSeries.length > 0) {
      compSeries.forEach((p) => balValues.push(Number(p.running_balance || 0)))
    }
    if (balValues.length === 0) balValues.push(0)

    const rawMinBal = Math.min(0, ...balValues)
    const rawMaxBal = Math.max(0, ...balValues)
    const maxBal = niceCeil(rawMaxBal)
    const minBal = rawMinBal < 0 ? -niceCeil(Math.abs(rawMinBal)) : 0
    const balSpan = Math.max(1, maxBal - minBal)

    const flowValues = series.flatMap((p) => [Number(p.inflow || 0), Number(p.outflow || 0)])
    const maxFlow = niceCeil(Math.max(0, ...flowValues))

    return { minBal, maxBal, balSpan, maxFlow }
  }, [series, compSeries, hasComparison, showCompareLine])

  const selectedAccountObj = useMemo(() => {
    if (selectedAccountId === 'all') return null
    return (data.cash_accounts || []).find((a) => a.account_id === selectedAccountId) || null
  }, [data.cash_accounts, selectedAccountId])

  const totalEndingAllAccounts = useMemo(
    () => (data.cash_accounts || []).reduce((acc, item) => acc + Number(item.ending_balance || 0), 0),
    [data.cash_accounts]
  )

  // SVG Geometry
  const SVG_W = 860
  const SVG_H = 300
  const PAD_L = 72
  const PAD_R = showBars ? 72 : 24
  const PAD_T = 20
  const PAD_B = 34
  const PLOT_W = SVG_W - PAD_L - PAD_R
  const PLOT_H = SVG_H - PAD_T - PAD_B

  const toBalY = (val: number) =>
    PAD_T + PLOT_H - ((val - chartScale.minBal) / chartScale.balSpan) * PLOT_H

  const toFlowY = (val: number) =>
    PAD_T + PLOT_H - (Math.max(0, val) / chartScale.maxFlow) * PLOT_H

  const stepX = series.length > 0 ? PLOT_W / Math.max(1, series.length) : PLOT_W
  const toPointX = (idx: number) =>
    series.length === 1 ? PAD_L + PLOT_W / 2 : PAD_L + idx * stepX + stepX / 2

  const linePath = useMemo(() => {
    if (series.length === 0) return ''
    return series
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toPointX(idx).toFixed(1)} ${toBalY(p.running_balance).toFixed(1)}`)
      .join(' ')
  }, [series, chartScale, stepX])

  const areaPath = useMemo(() => {
    if (series.length === 0) return ''
    const baseY = toBalY(Math.max(0, chartScale.minBal)).toFixed(1)
    const firstX = toPointX(0).toFixed(1)
    const lastX = toPointX(series.length - 1).toFixed(1)
    return `${linePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`
  }, [linePath, series.length, chartScale])

  const compLinePath = useMemo(() => {
    if (!hasComparison || !showCompareLine || compSeries.length === 0 || series.length === 0) return ''
    const len = Math.min(series.length, compSeries.length)
    return compSeries
      .slice(0, len)
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toPointX(idx).toFixed(1)} ${toBalY(p.running_balance).toFixed(1)}`)
      .join(' ')
  }, [hasComparison, showCompareLine, compSeries, series.length, chartScale, stepX])

  const hoveredPoint: CashFlowTimeSeriesPoint | null =
    hoveredIdx !== null && series[hoveredIdx] ? series[hoveredIdx] : null
  const hoveredCompPoint: CashFlowTimeSeriesPoint | null =
    hoveredIdx !== null && hasComparison && compSeries[hoveredIdx] ? compSeries[hoveredIdx] : null

  const labelStep = Math.max(1, Math.ceil(series.length / 8))

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 text-slate-800 su-fade-in">
      {/* ─── Row 1: Header & Filter Tanggal ────────────────────────────────── */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={goBack}
            aria-label="Kembali"
            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 shadow-2xs transition shrink-0 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Cash Flow Dashboard
          </h1>

          {/* Filter Akun Kas & Bank */}
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            aria-label="Filter Akun Kas & Bank"
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">🏦 Semua Kas &amp; Bank ({data.cash_accounts.length})</option>
            {data.cash_accounts.map((acc) => (
              <option key={acc.account_id} value={acc.account_id}>
                ({acc.code}) {acc.name}
              </option>
            ))}
          </select>

          {/* Granularity Selector */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
            {(['day', 'week', 'month'] as Granularity[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  granularity === g
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g === 'day' ? 'Harian' : g === 'week' ? 'Mingguan' : 'Bulanan'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
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

      {/* ─── Row 2: Subjudul & Tautan Terkait ──────────────────────────────── */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-3 text-xs text-slate-500">
        <p className="min-w-0">
          Posisi uang kas &amp; bank riil (<span className="font-semibold text-slate-700">Cash Real</span>) untuk{' '}
          <span className="font-semibold text-slate-700">{activeBusiness?.name || 'Bisnis Aktif'}</span>{' '}
          ({businessTz})
          {selectedAccountObj ? ` • Filter: (${selectedAccountObj.code}) ${selectedAccountObj.name}` : ''}.
        </p>
        <div className="flex items-center gap-3 shrink-0 font-semibold">
          <Link href="/accounting/cash-flow" className="text-blue-600 hover:text-blue-700">
            Laporan Arus Kas Formal ›
          </Link>
          <Link href="/reports/profit" className="text-indigo-600 hover:text-indigo-700">
            Profit Dashboard ›
          </Link>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between gap-3">
          <span>⚠️ {errorMsg}</span>
          <button
            type="button"
            onClick={loadAnalytics}
            className="px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 cursor-pointer"
          >
            Muat Ulang
          </button>
        </div>
      )}

      {/* ─── Section 1: 4 KPI Cards (Cash Real & Mutasi) ────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Cash Real Akhir */}
        <div className="bg-white border border-blue-200/80 rounded-xl p-4 shadow-2xs min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
              Cash Real Akhir
            </span>
            {hasComparison && compData && (
              <DeltaBadge curr={data.ending_cash} prev={compData.ending_cash} />
            )}
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5 truncate">
            {loading ? '...' : formatCurrencyIDR(data.ending_cash)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Saldo Awal: <span className="font-semibold text-slate-700">{formatCurrencyIDR(data.starting_cash)}</span>
          </div>
        </div>

        {/* KPI 2: Total Kas Masuk */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Total Kas Masuk
            </span>
            {hasComparison && compData && (
              <DeltaBadge curr={data.total_inflow} prev={compData.total_inflow} />
            )}
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-700 mt-1.5 truncate">
            {loading ? '...' : formatCurrencyIDR(data.total_inflow)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Uang riil masuk ke kas &amp; bank
          </div>
        </div>

        {/* KPI 3: Total Kas Keluar */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Total Kas Keluar
            </span>
            {hasComparison && compData && (
              <DeltaBadge curr={data.total_outflow} prev={compData.total_outflow} reversePolarity />
            )}
          </div>
          <div className="text-xl sm:text-2xl font-black text-rose-600 mt-1.5 truncate">
            {loading ? '...' : formatCurrencyIDR(data.total_outflow)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Uang riil keluar dari kas &amp; bank
          </div>
        </div>

        {/* KPI 4: Arus Kas Bersih */}
        <div
          className={`border rounded-xl p-4 shadow-2xs min-w-0 ${
            data.net_change >= 0
              ? 'bg-emerald-50/40 border-emerald-200/80'
              : 'bg-rose-50/40 border-rose-200/80'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Arus Kas Bersih (Net)
            </span>
            {hasComparison && compData && (
              <DeltaBadge curr={data.net_change} prev={compData.net_change} />
            )}
          </div>
          <div
            className={`text-xl sm:text-2xl font-black mt-1.5 truncate ${
              data.net_change >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {loading ? '...' : `${data.net_change >= 0 ? '+' : ''}${formatCurrencyIDR(data.net_change)}`}
          </div>
          <div className="text-[11px] text-slate-600 mt-1">
            {data.net_change >= 0 ? '🟢 Surplus kas periode ini' : '🔴 Defisit kas periode ini'}
          </div>
        </div>
      </div>

      {/* ─── Section 2: Baris Kedua — Combo Chart (Kiri) & AP/AR Visibility (Kanan) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        <div className="xl:col-span-8 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0 relative flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">
              Grafik Pergerakan Cash Real &amp; Arus Kas
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Garis biru menunjukkan posisi saldo kas &amp; bank riil berjalan pada setiap titik waktu.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBars((v) => !v)}
              className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                showBars
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {showBars ? '✓ Batang Masuk/Keluar' : 'Tampilkan Masuk/Keluar'}
            </button>
            {hasComparison && (
              <button
                type="button"
                onClick={() => setShowCompareLine((v) => !v)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                  showCompareLine
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {showCompareLine ? '✓ Garis Pembanding' : 'Garis Pembanding'}
              </button>
            )}
          </div>
        </div>

        {/* Fixed-height Legend Row (Zero Layout Shift) */}
        <div className="px-5 pt-3 flex flex-wrap items-center gap-4 min-h-[24px] text-xs font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-blue-600 inline-block rounded" />
            Saldo Cash Real
          </span>
          {showBars && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-500/80 inline-block rounded-xs" />
                Kas Masuk
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-rose-500/80 inline-block rounded-xs" />
                Kas Keluar
              </span>
            </>
          )}
          {hasComparison && showCompareLine && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-400 inline-block" />
              Cash Real Pembanding
            </span>
          )}
        </div>

        {/* Floating Hover Tooltip (Absolute, Zero Layout Shift) */}
        {hoveredPoint && (
          <div className="absolute top-16 right-5 z-20 pointer-events-none bg-slate-900/95 text-white rounded-xl px-3.5 py-2.5 shadow-lg text-xs space-y-1 min-w-[210px]">
            <div className="font-bold text-slate-200 border-b border-slate-700 pb-1">
              {hoveredPoint.date}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-blue-300">Cash Real:</span>
              <span className="font-extrabold">{formatCurrencyIDR(hoveredPoint.running_balance)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-emerald-300">Kas Masuk:</span>
              <span className="font-semibold">+{formatCurrencyIDR(hoveredPoint.inflow)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-rose-300">Kas Keluar:</span>
              <span className="font-semibold">-{formatCurrencyIDR(hoveredPoint.outflow)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-700 pt-1">
              <span className="text-slate-300">Net:</span>
              <span className={`font-bold ${hoveredPoint.net_change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {hoveredPoint.net_change >= 0 ? '+' : ''}{formatCurrencyIDR(hoveredPoint.net_change)}
              </span>
            </div>
            {hoveredCompPoint && (
              <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400 border-t border-slate-700/80 pt-1">
                <span>Pembanding:</span>
                <span>{formatCurrencyIDR(hoveredCompPoint.running_balance)}</span>
              </div>
            )}
          </div>
        )}

        <div className="p-5 pt-2">
          {loading ? (
            <div className="h-[300px] flex items-center justify-center text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
              Memuat grafik Cash Real...
            </div>
          ) : series.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">
              Belum ada data transaksi kas &amp; bank pada rentang tanggal ini.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                className="w-full min-w-[600px] h-[300px] select-none"
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <defs>
                  <linearGradient id="cashRealAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {/* Horizontal Gridlines & Left Y-Axis (Cash Real Balance) */}
                {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                  const y = PAD_T + PLOT_H * (1 - t)
                  const balVal = chartScale.minBal + chartScale.balSpan * t
                  const flowVal = chartScale.maxFlow * t
                  return (
                    <g key={t}>
                      <line
                        x1={PAD_L}
                        y1={y}
                        x2={SVG_W - PAD_R}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeDasharray={t === 0 ? undefined : '3 3'}
                        strokeWidth="1"
                      />
                      <text
                        x={PAD_L - 8}
                        y={y + 4}
                        textAnchor="end"
                        className="fill-blue-600 text-[10px] font-semibold"
                      >
                        {formatCompactIDR(balVal)}
                      </text>
                      {showBars && (
                        <text
                          x={SVG_W - PAD_R + 8}
                          y={y + 4}
                          textAnchor="start"
                          className="fill-slate-400 text-[10px] font-medium"
                        >
                          {formatCompactIDR(flowVal)}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* Bars: Inflow (Green) & Outflow (Red) */}
                {showBars &&
                  series.map((p, idx) => {
                    const cx = toPointX(idx)
                    const barW = Math.max(3, Math.min(14, stepX * 0.28))
                    const baseY = PAD_T + PLOT_H
                    const inY = toFlowY(p.inflow)
                    const outY = toFlowY(p.outflow)
                    return (
                      <g key={`bars-${p.date}`} opacity={hoveredIdx === null || hoveredIdx === idx ? 0.85 : 0.35}>
                        {p.inflow > 0 && (
                          <rect
                            x={cx - barW - 1}
                            y={inY}
                            width={barW}
                            height={Math.max(1, baseY - inY)}
                            rx="2"
                            fill="#10b981"
                          />
                        )}
                        {p.outflow > 0 && (
                          <rect
                            x={cx + 1}
                            y={outY}
                            width={barW}
                            height={Math.max(1, baseY - outY)}
                            rx="2"
                            fill="#f43f5e"
                          />
                        )}
                      </g>
                    )
                  })}

                {/* Comparison Line (Dashed) */}
                {compLinePath && (
                  <path
                    d={compLinePath}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="2"
                    strokeDasharray="5 4"
                  />
                )}

                {/* Primary Cash Real Area & Line */}
                {areaPath && <path d={areaPath} fill="url(#cashRealAreaGrad)" />}
                {linePath && (
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Interactive Hover Columns & Dots */}
                {series.map((p, idx) => {
                  const cx = toPointX(idx)
                  const cy = toBalY(p.running_balance)
                  const isHovered = hoveredIdx === idx
                  return (
                    <g key={`pt-${p.date}`}>
                      {isHovered && (
                        <line
                          x1={cx}
                          y1={PAD_T}
                          x2={cx}
                          y2={PAD_T + PLOT_H}
                          stroke="#94a3b8"
                          strokeWidth="1"
                          strokeDasharray="3 3"
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isHovered ? 5 : series.length <= 31 ? 2.5 : 0}
                        fill="#2563eb"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      {/* X-Axis Labels */}
                      {(idx % labelStep === 0 || idx === series.length - 1) && (
                        <text
                          x={cx}
                          y={SVG_H - 10}
                          textAnchor="middle"
                          className="fill-slate-500 text-[10px] font-medium"
                        >
                          {formatBucketLabel(p.date, granularity)}
                        </text>
                      )}
                      {/* Invisible wide hit target */}
                      <rect
                        x={PAD_L + idx * stepX}
                        y={PAD_T}
                        width={stepX}
                        height={PLOT_H}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoveredIdx(idx)}
                      />
                    </g>
                  )
                })}
              </svg>
            </div>
          )}
        </div>
        </div>

        {/* Right: AP/AR Visibility (Piutang & Hutang Usaha) */}
        <div className="xl:col-span-4 flex flex-col gap-4 min-w-0">
          {/* Card 1: Piutang Usaha (Invoices / Orders Due) */}
          <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/50">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">Piutang Usaha</h3>
                <p className="text-[11px] text-slate-500">Saldo Buku Besar COA (103000)</p>
              </div>
              <Link
                href="/orders/invoices"
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 shrink-0"
              >
                Kelola ›
              </Link>
            </div>

            <div className="px-4 py-3 divide-y divide-slate-100 flex-1 flex flex-col justify-between">
              <div className="pb-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-medium">Saldo Piutang (Neraca)</span>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {loading ? '...' : `${apArData.receivables.outstanding_count} order`}
                  </span>
                </div>
                <div className="text-lg sm:text-xl font-black text-slate-900 mt-0.5 truncate">
                  {loading ? '...' : formatCurrencyIDR(apArData.receivables.outstanding_amount)}
                </div>
                {!loading && Math.abs(apArData.receivables.unreconciled_amount || 0) > 1 && (
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                    Dokumen: {formatCompactIDR(apArData.receivables.doc_outstanding_amount || 0)} • Jurnal lain: {(apArData.receivables.unreconciled_amount || 0) >= 0 ? '+' : ''}{formatCompactIDR(apArData.receivables.unreconciled_amount || 0)}
                  </div>
                )}
              </div>

              <div className="py-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-medium">Jatuh Tempo (Overdue)</span>
                  <span
                    className={`text-[11px] font-semibold ${
                      apArData.receivables.overdue_count > 0 ? 'text-rose-600' : 'text-slate-400'
                    }`}
                  >
                    {loading ? '...' : `${apArData.receivables.overdue_count} order`}
                  </span>
                </div>
                <div
                  className={`text-base sm:text-lg font-extrabold mt-0.5 truncate ${
                    apArData.receivables.overdue_amount > 0 ? 'text-rose-600' : 'text-slate-800'
                  }`}
                >
                  {loading ? '...' : formatCurrencyIDR(apArData.receivables.overdue_amount)}
                </div>
              </div>

              <div className="pt-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-medium">Jatuh Tempo ≤ 7 Hari</span>
                  <span
                    className={`text-[11px] font-semibold ${
                      apArData.receivables.due_soon_count > 0 ? 'text-amber-600' : 'text-slate-400'
                    }`}
                  >
                    {loading ? '...' : `${apArData.receivables.due_soon_count} order`}
                  </span>
                </div>
                <div
                  className={`text-base sm:text-lg font-extrabold mt-0.5 truncate ${
                    apArData.receivables.due_soon_amount > 0 ? 'text-amber-600' : 'text-slate-800'
                  }`}
                >
                  {loading ? '...' : formatCurrencyIDR(apArData.receivables.due_soon_amount)}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Hutang Usaha (Bills to Pay: Purchases & Expenses) */}
          <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/50">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">Hutang Usaha</h3>
                <p className="text-[11px] text-slate-500">Saldo Buku Besar COA (201xxx)</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-[11px] font-semibold">
                <Link href="/purchases" className="text-blue-600 hover:text-blue-700">
                  Beli ›
                </Link>
                <Link href="/expenses" className="text-blue-600 hover:text-blue-700">
                  Biaya ›
                </Link>
              </div>
            </div>

            <div className="px-4 py-3 divide-y divide-slate-100 flex-1 flex flex-col justify-between">
              <div className="pb-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-medium">Saldo Hutang (Neraca)</span>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {loading ? '...' : `${apArData.payables.outstanding_count} tagihan`}
                  </span>
                </div>
                <div className="text-lg sm:text-xl font-black text-slate-900 mt-0.5 truncate">
                  {loading ? '...' : formatCurrencyIDR(apArData.payables.outstanding_amount)}
                </div>
                {!loading && (apArData.payables.outstanding_count > 0 || Math.abs(apArData.payables.salary_payable_amount || 0) > 1 || Math.abs(apArData.payables.unreconciled_amount || 0) > 1) && (
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                    Beli: {formatCompactIDR(apArData.payables.purchases_amount)} • Biaya: {formatCompactIDR(apArData.payables.expenses_amount)}
                    {Math.abs(apArData.payables.salary_payable_amount || 0) > 1 ? ` • Gaji: ${formatCompactIDR(apArData.payables.salary_payable_amount || 0)}` : ''}
                    {Math.abs(apArData.payables.unreconciled_amount || 0) > 1 ? ` • Jurnal lain: ${(apArData.payables.unreconciled_amount || 0) >= 0 ? '+' : ''}${formatCompactIDR(apArData.payables.unreconciled_amount || 0)}` : ''}
                  </div>
                )}
              </div>

              <div className="py-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-medium">Jatuh Tempo (Overdue)</span>
                  <span
                    className={`text-[11px] font-semibold ${
                      apArData.payables.overdue_count > 0 ? 'text-rose-600' : 'text-slate-400'
                    }`}
                  >
                    {loading ? '...' : `${apArData.payables.overdue_count} tagihan`}
                  </span>
                </div>
                <div
                  className={`text-base sm:text-lg font-extrabold mt-0.5 truncate ${
                    apArData.payables.overdue_amount > 0 ? 'text-rose-600' : 'text-slate-800'
                  }`}
                >
                  {loading ? '...' : formatCurrencyIDR(apArData.payables.overdue_amount)}
                </div>
              </div>

              <div className="pt-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-medium">Jatuh Tempo ≤ 7 Hari</span>
                  <span
                    className={`text-[11px] font-semibold ${
                      apArData.payables.due_soon_count > 0 ? 'text-amber-600' : 'text-slate-400'
                    }`}
                  >
                    {loading ? '...' : `${apArData.payables.due_soon_count} tagihan`}
                  </span>
                </div>
                <div
                  className={`text-base sm:text-lg font-extrabold mt-0.5 truncate ${
                    apArData.payables.due_soon_amount > 0 ? 'text-amber-600' : 'text-slate-800'
                  }`}
                >
                  {loading ? '...' : formatCurrencyIDR(apArData.payables.due_soon_amount)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Section 3: 2-Column Breakdown (Rekening Kas & Top Mutasi) ──────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Posisi Cash Real per Akun Kas & Bank */}
        <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Posisi Cash Real per Rekening</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Klik baris rekening untuk memfilter grafik di atas.
              </p>
            </div>
            {selectedAccountId !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedAccountId('all')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                Reset Filter
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            {data.cash_accounts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Belum ada akun Kas/Bank (sub_type: bank_cash) di Bagan Akun (COA).
              </div>
            ) : (
              data.cash_accounts.map((acc) => {
                const isSelected = selectedAccountId === acc.account_id
                const sharePct =
                  totalEndingAllAccounts > 0
                    ? Math.max(0, Math.min(100, (acc.ending_balance / totalEndingAllAccounts) * 100))
                    : 0
                return (
                  <button
                    key={acc.account_id}
                    type="button"
                    onClick={() =>
                      setSelectedAccountId((prev) => (prev === acc.account_id ? 'all' : acc.account_id))
                    }
                    className={`w-full text-left px-5 py-3.5 transition cursor-pointer ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-slate-400">
                            {acc.code}
                          </span>
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {acc.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                          <span className="text-emerald-600 font-semibold">
                            +{formatCompactIDR(acc.inflow)}
                          </span>
                          <span className="text-rose-600 font-semibold">
                            -{formatCompactIDR(acc.outflow)}
                          </span>
                          <span>Awal: {formatCompactIDR(acc.starting_balance)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-black text-slate-900">
                          {formatCurrencyIDR(acc.ending_balance)}
                        </div>
                        <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
                          {sharePct.toFixed(1)}% porsi kas
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isSelected ? 'bg-blue-600' : 'bg-blue-500/80'}`}
                        style={{ width: `${sharePct}%` }}
                      />
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Top Sumber Kas Masuk & Pos Pengeluaran Terbesar */}
        <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Sumber &amp; Penggunaan Kas Terbesar</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Pos akun COA lawan yang paling memengaruhi kas periode ini.
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setFlowTab('outflows')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  flowTab === 'outflows'
                    ? 'bg-white text-rose-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kas Keluar
              </button>
              <button
                type="button"
                onClick={() => setFlowTab('inflows')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  flowTab === 'inflows'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kas Masuk
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {(flowTab === 'inflows' ? data.top_inflows : data.top_outflows).length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Tidak ada mutasi {flowTab === 'inflows' ? 'kas masuk' : 'kas keluar'} pada periode ini.
              </div>
            ) : (
              (flowTab === 'inflows' ? data.top_inflows : data.top_outflows).map((item) => {
                const list = flowTab === 'inflows' ? data.top_inflows : data.top_outflows
                const maxAmt = Math.max(1, ...list.map((x) => Number(x.amount || 0)))
                const pct = Math.min(100, (Number(item.amount || 0) / maxAmt) * 100)
                return (
                  <div key={item.account_id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-slate-400">
                            {item.code}
                          </span>
                          <span className="text-xs font-semibold text-slate-800 truncate">
                            {item.name}
                          </span>
                        </div>
                      </div>
                      <div
                        className={`shrink-0 text-xs font-extrabold ${
                          flowTab === 'inflows' ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        {flowTab === 'inflows' ? '+' : '-'}
                        {formatCurrencyIDR(item.amount)}
                      </div>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          flowTab === 'inflows' ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${pct}%` }}
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

