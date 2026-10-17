"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageLayout } from '@/components/ui/PageLayout'
import { useUserContext } from '@/components/UserContext'
import { isPlatformSuperadmin } from '@/lib/platformAuth'
import Link from 'next/link'

// Types
interface PlatformSummary {
  totalGmv: number
  currentPeriodGmv: number
  previousPeriodGmv: number
  gmvGrowthPct: number
  totalOrders: number
  currentPeriodOrdersCount: number
  aov: number
  totalBusinesses: number
  activeBusinesses30d: number
  totalUsers: number
  mau: number
  dau: number
  stickinessRatio: number
  projectedMrr: number
  projectedArr: number
  arpu: number
}

interface TierInfo {
  name: string
  price: number
  count: number
  mrr: number
  color: string
}

interface DailyPoint {
  date: string
  gmv: number
  orders: number
}

interface TopTenant {
  id: string
  name: string
  created_at?: string
  tier: string
  gmv: number
  ordersCount: number
  lastOrderDate: string | null
  isActive30d: boolean
}

interface ApiResponse {
  summary: PlatformSummary
  tiers: TierInfo[]
  dailyTrend: DailyPoint[]
  topTenants: TopTenant[]
  serverTime: string
  timeframeDays: number
}

// Helpers
const formatIDR = (val: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

const formatCompactIDR = (val: number) => {
  if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(2)}M`
  if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(1)}jt`
  if (val >= 1_000) return `Rp ${(val / 1_000).toFixed(0)}rb`
  return formatIDR(val)
}

export default function PlatformAdminDashboard() {
  const { userProfile, currentUserRole, bizLoading } = useUserContext()

  const [timeframe, setTimeframe] = useState<'7' | '30' | '90' | 'all'>('30')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [searchTenant, setSearchTenant] = useState('')

  // Simulator state for Founder Sandbox
  const [simTargetTenants, setSimTargetTenants] = useState(150)
  const [simAvgPrice, setSimAvgPrice] = useState(349000)

  const fetchMetrics = useCallback(async (range: string) => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/platform/metrics?range=${range}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || `HTTP ${res.status}: Gagal memuat data platform`)
      }
      const json: ApiResponse = await res.json()
      setData(json)
      if (json.summary?.totalBusinesses) {
        setSimTargetTenants(Math.max(json.summary.totalBusinesses * 2, 50))
      }
    } catch (err: any) {
      console.error('[PlatformAdmin] Fetch error:', err)
      setErrorMsg(err.message || 'Terjadi kesalahan sistem')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMetrics(timeframe)
  }, [timeframe, fetchMetrics])

  // Computed simulation
  const simMrr = simTargetTenants * simAvgPrice
  const simArr = simMrr * 12
  const simValuation = simArr * 5 // Standard B2B SaaS multiple (5x ARR)

  // Filtered leaderboard
  const filteredTenants = useMemo(() => {
    if (!data?.topTenants) return []
    const q = searchTenant.toLowerCase().trim()
    if (!q) return data.topTenants
    return data.topTenants.filter(t => t.name.toLowerCase().includes(q))
  }, [data?.topTenants, searchTenant])

  // Maximum value for SVG chart scaling
  const maxDailyGmv = useMemo(() => {
    if (!data?.dailyTrend || data.dailyTrend.length === 0) return 1000000
    const highest = Math.max(...data.dailyTrend.map(d => d.gmv))
    return highest > 0 ? highest * 1.15 : 1000000
  }, [data?.dailyTrend])

  if (bizLoading) {
    return (
      <PageLayout title="Platform Intelligence" width="full">
        <div className="flex h-96 items-center justify-center">
          <div className="flex items-center gap-3 text-sm font-semibold text-[var(--su-text-muted)]">
            <span className="size-4 animate-spin rounded-full border-2 border-[var(--su-accent)] border-t-transparent" />
            Memverifikasi hak akses Superadmin...
          </div>
        </div>
      </PageLayout>
    )
  }

  // Strict check: Block regular tenant merchants from viewing entire platform metrics
  if (!isPlatformSuperadmin(userProfile?.email)) {
    return (
      <PageLayout title="Akses Ditolak — Khusus Pemilik Platform" width="md">
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="size-16 rounded-2xl bg-red-100 flex items-center justify-center text-3xl">
            🚫
          </div>
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
            Akses Terbatas: Khusus Pemilik Platform (Superadmin)
          </h2>
          <p className="text-xs text-[var(--su-text-muted)] max-w-md leading-relaxed">
            Data analitik ini memuat metrik rahasia seluruh ekosistem ShapeUp CRM (GMV seluruh toko, MAU, dan MRR) dan hanya dapat diakses oleh tim pemilik/pengembang platform. Akun Anda (<span className="font-bold text-slate-800">{userProfile?.email || 'Tidak Diketahui'}</span>) bukan akun Superadmin.
          </p>
          <div className="pt-2">
            <Link
              href="/dashboard"
              className="inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800"
            >
              Kembali ke Dashboard Toko
            </Link>
          </div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Platform Intelligence & SaaS Analytics"
      description="Pusat komando pemilik platform untuk memantau Gross Merchandise Value (GMV), Monthly Active Users (MAU), dan Monthly Recurring Revenue (MRR) lintas ekosistem ShapeUp CRM."
      eyebrow={
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <span>👑 Founder & Superadmin Console</span>
        </div>
      }
      width="full"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe pill tabs */}
          <div className="inline-flex rounded-xl border border-[var(--su-border)] bg-[var(--su-surface)] p-1 shadow-sm">
            {(['7', '30', '90', 'all'] as const).map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  timeframe === tf
                    ? 'bg-[#1C1C1A] text-white shadow-sm'
                    : 'text-[var(--su-text-muted)] hover:text-[var(--su-text)]'
                }`}
              >
                {tf === '7' ? '7 Hari' : tf === '30' ? '30 Hari' : tf === '90' ? '90 Hari' : 'Semua'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fetchMetrics(timeframe)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--su-border)] bg-[var(--su-card)] px-3.5 py-2 text-xs font-bold text-[var(--su-text)] shadow-sm transition hover:border-[var(--su-accent)] disabled:opacity-60"
            title="Muat Ulang Data"
          >
            <span className={`size-3.5 ${loading ? 'animate-spin' : ''}`}>🔄</span>
            {loading ? 'Memuat...' : 'Refresh'}
          </button>
        </div>
      }
    >
      <div className="space-y-8">
        {/* Error notification if any */}
        {errorMsg && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs font-semibold text-red-800">
            ⚠️ {errorMsg}
          </div>
        )}

        {/* ── 1. THE BIG 4 HERO KPI CARDS ─────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* CARD 1: MRR */}
          <div className="relative overflow-hidden rounded-2xl border border-[var(--su-border)] bg-gradient-to-br from-white via-white to-amber-50/40 p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--su-text-muted)]">
                  Monthly Recurring Revenue (MRR)
                </p>
                <div className="mt-2 text-2xl font-black text-slate-900 lg:text-3xl">
                  {formatCompactIDR(data?.summary?.projectedMrr || 0)}
                </div>
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-amber-500/10 text-xl text-amber-600">
                💎
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--su-border)]/60 pt-3 text-xs text-[var(--su-text-muted)]">
              <div>
                ARR: <span className="font-bold text-slate-900">{formatCompactIDR(data?.summary?.projectedArr || 0)}</span>
              </div>
              <div>
                ARPU: <span className="font-bold text-amber-600">{formatCompactIDR(data?.summary?.arpu || 0)}/toko</span>
              </div>
            </div>
            <div className="mt-1 text-[10px] font-semibold text-emerald-600">
              ● Berdasarkan Model Langganan 3-Tier SaaS
            </div>
          </div>

          {/* CARD 2: GMV */}
          <div className="relative overflow-hidden rounded-2xl border border-[var(--su-border)] bg-gradient-to-br from-white via-white to-blue-50/40 p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--su-text-muted)]">
                  Platform GMV ({timeframe === 'all' ? 'All-Time' : `${timeframe} Hari`})
                </p>
                <div className="mt-2 text-2xl font-black text-slate-900 lg:text-3xl">
                  {formatCompactIDR(data?.summary?.currentPeriodGmv || 0)}
                </div>
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-blue-500/10 text-xl text-blue-600">
                🚀
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--su-border)]/60 pt-3 text-xs text-[var(--su-text-muted)]">
              <div className="flex items-center gap-1 font-semibold text-emerald-600">
                <span>▲</span>
                <span>+{data?.summary?.gmvGrowthPct ?? 0}% vs periode lalu</span>
              </div>
              <div className="text-[11px] text-[var(--su-text-muted)]">
                AOV: <span className="font-bold text-slate-900">{formatCompactIDR(data?.summary?.aov || 0)}</span>
              </div>
            </div>
            <div className="mt-1 text-[10px] text-[var(--su-text-muted)]">
              Total Seluruh Waktu: <span className="font-semibold">{formatCompactIDR(data?.summary?.totalGmv || 0)}</span>
            </div>
          </div>

          {/* CARD 3: MAU */}
          <div className="relative overflow-hidden rounded-2xl border border-[var(--su-border)] bg-gradient-to-br from-white via-white to-indigo-50/40 p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--su-text-muted)]">
                  Monthly Active Users (MAU)
                </p>
                <div className="mt-2 text-2xl font-black text-slate-900 lg:text-3xl">
                  {data?.summary?.mau ?? 0}{' '}
                  <span className="text-sm font-semibold text-[var(--su-text-muted)]">pengguna</span>
                </div>
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-indigo-500/10 text-xl text-indigo-600">
                👥
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--su-border)]/60 pt-3 text-xs text-[var(--su-text-muted)]">
              <div>
                DAU Est.: <span className="font-bold text-slate-900">{data?.summary?.dau ?? 0}</span>
              </div>
              <div className="rounded-md bg-indigo-100/70 px-2 py-0.5 font-bold text-indigo-700">
                Stickiness: {data?.summary?.stickinessRatio ?? 0}%
              </div>
            </div>
            <div className="mt-1 text-[10px] text-[var(--su-text-muted)]">
              Total Terdaftar: <span className="font-semibold">{data?.summary?.totalUsers ?? 0} Profil</span>
            </div>
          </div>

          {/* CARD 4: ACTIVE TENANTS */}
          <div className="relative overflow-hidden rounded-2xl border border-[var(--su-border)] bg-gradient-to-br from-white via-white to-emerald-50/40 p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--su-text-muted)]">
                  Unit Bisnis (Tenants)
                </p>
                <div className="mt-2 text-2xl font-black text-slate-900 lg:text-3xl">
                  {data?.summary?.activeBusinesses30d ?? 0}{' '}
                  <span className="text-sm font-semibold text-[var(--su-text-muted)]">
                    / {data?.summary?.totalBusinesses ?? 0} Toko
                  </span>
                </div>
              </div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-xl text-emerald-600">
                🏢
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--su-border)]/60 pt-3 text-xs text-[var(--su-text-muted)]">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-600">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span>
                  {data?.summary?.totalBusinesses
                    ? Math.round(((data.summary.activeBusinesses30d || 0) / data.summary.totalBusinesses) * 100)
                    : 0}
                  % Aktif Transaksi (30h)
                </span>
              </div>
            </div>
            <div className="mt-1 text-[10px] text-[var(--su-text-muted)]">
              Volume: <span className="font-semibold">{data?.summary?.currentPeriodOrdersCount ?? 0} pesanan diproses</span>
            </div>
          </div>
        </div>

        {/* ── 2. VISUAL CHARTS: GMV RUN-RATE & SUBSCRIPTION TIERS ────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left Chart: Daily GMV Progression (2 cols) */}
          <div className="rounded-2xl border border-[var(--su-border)] bg-[var(--su-card)] p-6 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-[var(--su-text)]">
                  Tren Laju Penjualan GMV Harian
                </h3>
                <p className="text-xs text-[var(--su-text-muted)]">
                  Volume transaksi harian dari seluruh toko di ShapeUp CRM dalam 30 hari terakhir.
                </p>
              </div>
              <div className="inline-flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-[var(--su-primary)]">
                  <span className="size-2.5 rounded-full bg-[var(--su-primary)]" />
                  GMV
                </span>
              </div>
            </div>

            {/* SVG Area Chart */}
            <div className="mt-6 h-64 w-full">
              {data?.dailyTrend && data.dailyTrend.length > 0 ? (
                <div className="relative size-full">
                  <svg className="size-full overflow-visible" viewBox="0 0 800 200" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="gmvGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines */}
                    <line x1="0" y1="50" x2="800" y2="50" stroke="#E2E2DC" strokeDasharray="4 4" strokeWidth="1" />
                    <line x1="0" y1="100" x2="800" y2="100" stroke="#E2E2DC" strokeDasharray="4 4" strokeWidth="1" />
                    <line x1="0" y1="150" x2="800" y2="150" stroke="#E2E2DC" strokeDasharray="4 4" strokeWidth="1" />

                    {/* Area polygon */}
                    {(() => {
                      const points = data.dailyTrend.map((d, idx) => {
                        const x = (idx / (data.dailyTrend.length - 1 || 1)) * 800
                        const y = 200 - (d.gmv / maxDailyGmv) * 180 - 10
                        return `${x},${y}`
                      })
                      const areaPoints = `0,200 ${points.join(' ')} 800,200`
                      return (
                        <>
                          <polygon points={areaPoints} fill="url(#gmvGradient)" />
                          <polyline
                            points={points.join(' ')}
                            fill="none"
                            stroke="#2563EB"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </>
                      )
                    })()}
                  </svg>

                  {/* X Axis Date Labels */}
                  <div className="mt-2 flex justify-between text-[10px] font-semibold text-[var(--su-text-faint)]">
                    <span>{data.dailyTrend[0]?.date}</span>
                    <span>{data.dailyTrend[Math.floor(data.dailyTrend.length / 2)]?.date}</span>
                    <span>{data.dailyTrend[data.dailyTrend.length - 1]?.date}</span>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-[var(--su-text-muted)]">
                  Belum ada data transaksi pada rentang waktu ini.
                </div>
              )}
            </div>
          </div>

          {/* Right Chart: SaaS Subscription Tiers Decomposition (1 col) */}
          <div className="flex flex-col justify-between rounded-2xl border border-[var(--su-border)] bg-[var(--su-card)] p-6 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-extrabold text-[var(--su-text)]">
                  Struktur Paket & MRR
                </h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700">
                  SaaS Model
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--su-text-muted)]">
                Estimasi kontribusi pendapatan bulanan berulang berdasarkan skala bisnis tenant.
              </p>

              <div className="mt-6 space-y-4">
                {data?.tiers?.map(t => {
                  const sharePct =
                    data.summary.projectedMrr > 0
                      ? Math.round((t.mrr / data.summary.projectedMrr) * 100)
                      : 0

                  return (
                    <div key={t.name} className="rounded-xl border border-[var(--su-border)] bg-[var(--su-bg)] p-3.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="size-3 rounded-full" style={{ backgroundColor: t.color }} />
                          <span className="text-xs font-bold text-slate-800">{t.name}</span>
                          <span className="text-[10px] text-[var(--su-text-muted)]">
                            ({formatCompactIDR(t.price)}/bln)
                          </span>
                        </div>
                        <span className="text-xs font-black text-slate-900">{formatCompactIDR(t.mrr)}</span>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--su-text-muted)]">
                        <span>{t.count} unit bisnis</span>
                        <span className="font-semibold text-slate-700">{sharePct}% dari MRR</span>
                      </div>

                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${sharePct}%`, backgroundColor: t.color }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-center">
              <div className="text-[11px] font-semibold text-amber-900">
                Target Realtime Billing Integrations:
              </div>
              <div className="mt-1 text-xs font-black text-amber-950">
                Midtrans / Xendit Recurring Subscriptions
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. FOUNDER SANDBOX: INTERACTIVE TARGET MRR SIMULATOR ────────── */}
        <div className="rounded-2xl border-2 border-dashed border-amber-400/60 bg-gradient-to-r from-amber-500/5 via-white to-amber-500/10 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-700">
                <span>⚡ Founder Sandbox</span>
                <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px]">Interaktif</span>
              </div>
              <h3 className="mt-1 text-lg font-black text-slate-900">
                Simulasi Target Pertumbuhan MRR & Valuasi SaaS
              </h3>
              <p className="text-xs text-[var(--su-text-muted)]">
                Gerakkan slider untuk memproyeksikan target omset SaaS jika jumlah toko aktif atau harga rata-rata langganan dinaikkan.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="rounded-xl border border-amber-300/80 bg-white p-3 text-right shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--su-text-muted)]">
                  Proyeksi Target MRR
                </div>
                <div className="text-xl font-black text-amber-600 lg:text-2xl">
                  {formatCompactIDR(simMrr)}
                  <span className="text-xs font-bold text-slate-600">/bln</span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-300 bg-white p-3 text-right shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--su-text-muted)]">
                  Proyeksi Target ARR
                </div>
                <div className="text-xl font-black text-blue-600 lg:text-2xl">
                  {formatCompactIDR(simArr)}
                  <span className="text-xs font-bold text-slate-600">/thn</span>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-300 bg-white p-3 text-right shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--su-text-muted)]">
                  Valuasi SaaS (5x ARR)
                </div>
                <div className="text-xl font-black text-emerald-600 lg:text-2xl">
                  {formatCompactIDR(simValuation)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 border-t border-amber-200/70 pt-6 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>Target Jumlah Toko Berlangganan (Tenants)</span>
                <span className="rounded bg-slate-900 px-2 py-0.5 text-white">{simTargetTenants} Toko</span>
              </div>
              <input
                type="range"
                min="10"
                max="2000"
                step="10"
                value={simTargetTenants}
                onChange={e => setSimTargetTenants(Number(e.target.value))}
                className="mt-3 w-full cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-[var(--su-text-muted)]">
                <span>10 Toko</span>
                <span>500 Toko</span>
                <span>1.000 Toko</span>
                <span>2.000 Toko</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>Rata-rata Harga Paket (ARPU Bulanan)</span>
                <span className="rounded bg-amber-600 px-2 py-0.5 text-white">{formatIDR(simAvgPrice)}</span>
              </div>
              <input
                type="range"
                min="99000"
                max="999000"
                step="50000"
                value={simAvgPrice}
                onChange={e => setSimAvgPrice(Number(e.target.value))}
                className="mt-3 w-full cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-[var(--su-text-muted)]">
                <span>Rp 99rb (Starter)</span>
                <span>Rp 399rb (Pro)</span>
                <span>Rp 999rb (Enterprise)</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 4. TOP POWER TENANTS LEADERBOARD TABLE ─────────────────────── */}
        <div className="rounded-2xl border border-[var(--su-border)] bg-[var(--su-card)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-extrabold text-[var(--su-text)]">
                Leaderboard Toko Kontributor GMV Terbesar (Power Tenants)
              </h3>
              <p className="text-xs text-[var(--su-text-muted)]">
                Daftar unit bisnis dengan volume penjualan tertinggi di platform ShapeUp CRM.
              </p>
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Cari nama toko / tenant..."
                value={searchTenant}
                onChange={e => setSearchTenant(e.target.value)}
                className="w-full rounded-xl border border-[var(--su-border)] bg-[var(--su-bg)] px-3.5 py-2 text-xs font-medium text-[var(--su-text)] outline-none transition focus:border-[var(--su-accent)] focus:bg-white"
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--su-border)] text-[10px] font-extrabold uppercase tracking-wider text-[var(--su-text-faint)]">
                  <th className="py-3 pl-2">#</th>
                  <th className="py-3">Nama Toko (Tenant)</th>
                  <th className="py-3">Paket SaaS</th>
                  <th className="py-3 text-right">Kontribusi GMV</th>
                  <th className="py-3 text-center">Total Pesanan</th>
                  <th className="py-3 text-center">Status Aktivitas</th>
                  <th className="py-3 text-right pr-2">Aktivitas Terakhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--su-border)]/60">
                {filteredTenants.length > 0 ? (
                  filteredTenants.map((tenant, idx) => (
                    <tr key={tenant.id} className="transition-colors hover:bg-[var(--su-bg)]/80">
                      <td className="py-3.5 pl-2 font-bold text-slate-400">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </td>
                      <td className="py-3.5 font-bold text-slate-900">
                        {tenant.name}
                      </td>
                      <td className="py-3.5">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${
                            tenant.tier === 'Enterprise'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : tenant.tier === 'Pro'
                              ? 'bg-purple-100 text-purple-800 border border-purple-300'
                              : 'bg-blue-100 text-blue-800 border border-blue-300'
                          }`}
                        >
                          {tenant.tier}
                        </span>
                      </td>
                      <td className="py-3.5 text-right font-black text-slate-900">
                        {formatIDR(tenant.gmv)}
                      </td>
                      <td className="py-3.5 text-center font-bold text-[var(--su-text)]">
                        {tenant.ordersCount}
                      </td>
                      <td className="py-3.5 text-center">
                        {tenant.isActive30d ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                            Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                            <span className="size-2 rounded-full bg-slate-300" />
                            Dorman
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 text-right pr-2 text-[11px] text-[var(--su-text-muted)]">
                        {tenant.lastOrderDate
                          ? new Date(tenant.lastOrderDate).toLocaleDateString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          : 'Belum ada transaksi'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-[var(--su-text-muted)]">
                      {searchTenant ? 'Tidak ditemukan toko dengan kata kunci tersebut.' : 'Belum ada data toko.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 5. PLATFORM ROADMAP BANNER ─────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800 bg-[#1C1C1A] p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-400">
                <span>🚀 Langkah Lanjutan: Fase 2 & 3</span>
              </div>
              <h4 className="mt-2 text-base font-extrabold tracking-tight text-white">
                Siap Melangkah ke Otomasi Billing Langganan SaaS?
              </h4>
              <p className="mt-1 text-xs text-slate-300 max-w-2xl">
                Tahap antarmuka telah siap. Langkah berikutnya adalah migrasi skema tabel <code className="text-amber-400">platform_subscriptions</code> dan webhook payment gateway untuk menagih biaya sewa CRM secara otomatis ke tiap merchant.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/settings/business"
                className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/20"
              >
                Kelola Unit Bisnis
              </Link>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
