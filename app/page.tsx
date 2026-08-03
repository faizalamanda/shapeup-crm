"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState<'cohort' | 'retention' | 'rfm' | 'pos' | 'finance'>('cohort')
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  // Interactive Repeat Order Calculator State
  const [activeCustomers, setActiveCustomers] = useState(1200)
  const [avgOrderValue, setAvgOrderValue] = useState(250000)
  const [repeatRate, setRepeatRate] = useState(25) // %

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()
      setIsLoggedIn(!!session)
    }
    checkAuth()
  }, [supabase])

  // Calculation for repeat order growth calculator
  const currentRepeatRevenue = activeCustomers * (repeatRate / 100) * avgOrderValue
  const boostedRepeatRate = Math.min(repeatRate + 15, 90)
  const potentialRepeatRevenue = activeCustomers * (boostedRepeatRate / 100) * avgOrderValue
  const addedRevenue = potentialRepeatRevenue - currentRepeatRevenue

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val)
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 font-sans selection:bg-amber-400 selection:text-slate-900">
      {/* ── BACKGROUND GLOW DECORATIONS ────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-blue-600/15 rounded-full blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[140px]" />
        <div className="absolute -bottom-40 left-1/3 w-[600px] h-[600px] bg-indigo-600/15 rounded-full blur-[140px]" />
      </div>

      {/* ── NAVBAR ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0F172A]/80 border-b border-slate-800/80 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-600 to-amber-500 flex items-center justify-center font-black text-xl text-white shadow-lg shadow-blue-500/25 group-hover:scale-105 transition-transform">
              S
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-white block leading-none">
                ShapeUp<span className="text-amber-400">.</span>
              </span>
              <span className="text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase block mt-1">
                CRM & Retention Platform
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
            <a href="#fitur" className="hover:text-amber-400 transition-colors">Fitur Retensi</a>
            <a href="#demo" className="hover:text-amber-400 transition-colors">Showcase Demo</a>
            <a href="#kalkulator" className="hover:text-amber-400 transition-colors">Kalkulator Repeat Order</a>
            <a href="#omnichannel" className="hover:text-amber-400 transition-colors">POS & Invoice</a>
            <a href="#faq" className="hover:text-amber-400 transition-colors">FAQ</a>
          </nav>

          {/* CTA Buttons */}
          <div className="flex items-center gap-3">
            {isLoggedIn === true ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm tracking-wide shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 hover:-translate-y-0.5 transition-all"
              >
                <span>Buka Dashboard</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800/60 transition-all"
                >
                  Masuk
                </Link>
                <Link
                  href="/register"
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-sm tracking-wide shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:-translate-y-0.5 transition-all"
                >
                  Coba Gratis
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── HERO SECTION ──────────────────────────────────────────────────── */}
      <section className="relative z-10 pt-16 pb-20 md:pt-24 md:pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-wider mb-8 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            <span>Platform CRM Omnichannel & Customer Retention Terlengkap</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.1] max-w-5xl mx-auto mb-6">
            Pahami Pelanggan Anda & <br />
            <span className="bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
              Tingkatkan Repeat Order
            </span> Bisnis Hingga 3x Lipat
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto font-normal leading-relaxed mb-10">
            Jangan biarkan pelanggan hanya beli sekali. Pelajari pola pembelian pelanggan, kelola pesanan toko & POS kasir, serta lacak alur produk yang memicu pembeli kembali berbelanja secara berulang.
          </p>

          {/* Hero CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href={isLoggedIn ? "/dashboard" : "/register"}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-base tracking-wide shadow-xl shadow-blue-600/35 hover:shadow-blue-600/50 hover:-translate-y-1 transition-all flex items-center justify-center gap-3"
            >
              <span>{isLoggedIn ? "Masuk ke Dashboard Bisnis" : "Mulai Kelola Pelanggan Sekarang"}</span>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </Link>
            <a
              href="#demo"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-base tracking-wide hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Lihat Demo Interaktif</span>
            </a>
          </div>

          {/* Value Stats Pills */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-6 border-t border-slate-800/80 text-left">
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
              <div className="text-2xl font-black text-amber-400">98%</div>
              <div className="text-xs font-semibold text-slate-400 mt-0.5">Akurasi Identifikasi Returning Customer</div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
              <div className="text-2xl font-black text-blue-400">+45%</div>
              <div className="text-xs font-semibold text-slate-400 mt-0.5">Rata-rata Kenaikan Customer LTV</div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
              <div className="text-2xl font-black text-emerald-400">Omnichannel</div>
              <div className="text-xs font-semibold text-slate-400 mt-0.5">Integrasi Kasir POS, Invoice & Online</div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
              <div className="text-2xl font-black text-indigo-400">Real-Time</div>
              <div className="text-xs font-semibold text-slate-400 mt-0.5">Analisis Cohort & Flow Retensi</div>
            </div>
          </div>
        </div>

        {/* Hero Interactive Dashboard Visual Mockup */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-16">
          <div className="relative rounded-3xl p-3 sm:p-4 bg-gradient-to-b from-slate-700/50 via-slate-800/40 to-slate-900/80 border border-slate-700/60 shadow-2xl shadow-blue-900/20">
            <div className="rounded-2xl bg-[#1C1C1A] overflow-hidden border border-slate-800 text-slate-200">
              {/* Window Bar */}
              <div className="px-4 py-3 bg-[#161614] border-b border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  <span className="ml-3 text-xs font-medium text-slate-400">ShapeUp CRM — Customer Retention & Returning Cohort Dashboard</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-amber-400 font-bold bg-amber-500/10 px-3 py-1 rounded-md border border-amber-500/20">
                  ⚡ Mode Live Analytics
                </div>
              </div>

              {/* Mockup Dashboard Content */}
              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Metric Card 1 */}
                <div className="bg-[#242421] p-5 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Pelanggan Setia (VIP)</span>
                    <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">+18% bulan ini</span>
                  </div>
                  <div className="text-3xl font-black text-white mt-2">842 Customer</div>
                  <div className="text-xs text-slate-400 mt-1">LTV &gt; Rp 1.500.000 (Repeat 3x+)</div>
                  <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between text-xs">
                    <span className="text-slate-400">Avg Order Value (AOV)</span>
                    <span className="font-bold text-amber-400">Rp 385.000</span>
                  </div>
                </div>

                {/* Metric Card 2 */}
                <div className="bg-[#242421] p-5 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Returning Cohort Rate</span>
                    <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">Tingkat Retensi</span>
                  </div>
                  <div className="text-3xl font-black text-white mt-2">38.4%</div>
                  <div className="text-xs text-slate-400 mt-1">Pembelian Ulang pada Bulan ke-2</div>
                  <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between text-xs">
                    <span className="text-slate-400">Target Retensi Toko</span>
                    <span className="font-bold text-emerald-400">Tercapai (Optimal)</span>
                  </div>
                </div>

                {/* Metric Card 3 */}
                <div className="bg-[#242421] p-5 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Top Repeat Product</span>
                    <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">Pemicu Order #2</span>
                  </div>
                  <div className="text-2xl font-black text-white mt-2">Serum Brightening 30ml</div>
                  <div className="text-xs text-slate-400 mt-1">64% dibeli kembali dalam 30 hari</div>
                  <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between text-xs">
                    <span className="text-slate-400">Total Retensi Omset</span>
                    <span className="font-bold text-white">Rp 142.500.000</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CORE VALUE & PAIN POINTS ──────────────────────────────────────── */}
      <section id="fitur" className="py-20 bg-slate-900/60 relative z-10 border-y border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold text-amber-400 uppercase tracking-[0.2em] mb-3">
              Mengapa Harus Fokus Pada Retensi & Repeat Order?
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Biaya Mendapatkan Pelanggan Baru Semakin Mahal. <br className="hidden sm:inline" />
              <span className="text-blue-400">Kunci Keuntungan Terbesar Ada pada Repeat Order.</span>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="p-8 rounded-3xl bg-slate-800/40 border border-slate-700/60 hover:border-blue-500/50 transition-all hover:-translate-y-1">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center text-2xl mb-6">
                🎯
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Segmentasi RFM Otomatis</h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Kelompokkan pelanggan Anda secara otomatis ke dalam segmen VIP, Loyal, Baru, At-Risk (hampir hilang), dan Churn berdasarkan riwayat belanja riil.
              </p>
            </div>

            {/* Card 2 */}
            <div className="p-8 rounded-3xl bg-slate-800/40 border border-slate-700/60 hover:border-amber-500/50 transition-all hover:-translate-y-1">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-2xl mb-6">
                📊
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Matriks Returning Cohort</h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Ketahui dengan pasti berapa persen pembeli bulan Januari yang kembali lagi di Februari, Maret, hingga akhir tahun dalam bentuk tabel kohort yang visual.
              </p>
            </div>

            {/* Card 3 */}
            <div className="p-8 rounded-3xl bg-slate-800/40 border border-slate-700/60 hover:border-emerald-500/50 transition-all hover:-translate-y-1">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl mb-6">
                🔄
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Product Retention Flow</h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Lacak alur perjalanan produk. Temukan produk pembuka (*entry product*) apa yang paling sering mendorong pelanggan membeli produk pendamping berikutnya.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE SHOWCASE DEMO TAB ──────────────────────────────────── */}
      <section id="demo" className="py-24 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-[0.2em] block mb-3">Showcase Fitur Interaktif</span>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
              Jelajahi Modul CRM & Retensi ShapeUp
            </h2>
            <p className="text-slate-300 mt-4 text-base">
              Klik tab di bawah untuk melihat bagaimana ShapeUp CRM membantu Anda mengelola data pelanggan dan operasional bisnis secara utuh.
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex flex-wrap justify-center gap-2 mb-10 p-2 rounded-2xl bg-slate-900/80 border border-slate-800 max-w-4xl mx-auto">
            <button
              onClick={() => setActiveTab('cohort')}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'cohort'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              📈 Returning Cohort
            </button>
            <button
              onClick={() => setActiveTab('retention')}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'retention'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              🔁 Product Retention Flow
            </button>
            <button
              onClick={() => setActiveTab('rfm')}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'rfm'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              👥 Customer Profiling & RFM
            </button>
            <button
              onClick={() => setActiveTab('pos')}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'pos'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              🏪 POS Kasir & Invoice
            </button>
            <button
              onClick={() => setActiveTab('finance')}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'finance'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              💰 Keuangan & Stock Opname
            </button>
          </div>

          {/* Dynamic Tab Content Box */}
          <div className="p-8 sm:p-10 rounded-3xl bg-slate-900 border border-slate-800 min-h-[420px] flex items-center shadow-2xl">
            {activeTab === 'cohort' && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-2">Analisis Retensi Waktu</span>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                    Ukur Berapa Banyak Pelanggan Kembali Berbelanja Setiap Bulan
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed mb-6">
                    Matriks Returning Cohort mengelompokkan pembeli berdasarkan bulan pertama mereka bertransaksi. Anda dapat langsung melihat persentase retensi di bulan M+1, M+2, hingga M+12 untuk menguji keefektifan program promosi atau kualitas produk.
                  </p>
                  <ul className="space-y-3 text-sm text-slate-300">
                    <li className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">✓</span>
                      <span>Filter periode mingguan, bulanan, kuartalan, atau tahunan</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">✓</span>
                      <span>Perhitungan otomatis revenue retensi per kohort</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-[#181816] p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-400 border-b border-slate-800 pb-3">
                    <span>Bulan Kohort</span>
                    <span>Total Pembeli</span>
                    <span>Bulan +1</span>
                    <span>Bulan +2</span>
                    <span>Bulan +3</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-200">
                    <span className="font-bold text-amber-400">Januari 2026</span>
                    <span>450 Cust</span>
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded font-bold">42%</span>
                    <span className="px-2 py-1 bg-emerald-500/15 text-emerald-400 rounded font-bold">34%</span>
                    <span className="px-2 py-1 bg-blue-500/15 text-blue-400 rounded font-bold">28%</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-200">
                    <span className="font-bold text-amber-400">Februari 2026</span>
                    <span>520 Cust</span>
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded font-bold">45%</span>
                    <span className="px-2 py-1 bg-emerald-500/15 text-emerald-400 rounded font-bold">36%</span>
                    <span className="px-2 py-1 bg-slate-800 text-slate-400 rounded font-bold">-</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-200">
                    <span className="font-bold text-amber-400">Maret 2026</span>
                    <span>610 Cust</span>
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded font-bold">48%</span>
                    <span className="px-2 py-1 bg-slate-800 text-slate-400 rounded font-bold">-</span>
                    <span className="px-2 py-1 bg-slate-800 text-slate-400 rounded font-bold">-</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'retention' && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-2">Alur Pembelian Ulang Produk</span>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                    Ketahui Produk Mana yang Memicu Pembelian Kedua
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed mb-6">
                    Product Retention Flow membantu Anda memetakan alur produk dari transaksi pertama ke transaksi berikutnya. Anda dapat merancang paket penawaran (*cross-selling / up-selling*) yang tepat sasaran berdasarkan data aktual.
                  </p>
                  <ul className="space-y-3 text-sm text-slate-300">
                    <li className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">✓</span>
                      <span>Analisis Produk Utama vs Produk Pembelian Ulang</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">✓</span>
                      <span>Optimasi strategi bundel & re-stocking produk favorit</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-[#181816] p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="text-xs font-bold text-slate-400 border-b border-slate-800 pb-2">
                    Visual Flow: Transaksi Pertama ➔ Transaksi Pembelian Ulang
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/60 border border-slate-700">
                    <div className="text-xs">
                      <div className="text-slate-400">Order #1 (Entry Product)</div>
                      <div className="font-bold text-white mt-0.5">Cleanser Facial Wash</div>
                    </div>
                    <div className="text-amber-400 font-bold text-sm">➔ 72% Repurchase ➔</div>
                    <div className="text-xs text-right">
                      <div className="text-slate-400">Order #2 (Repeat Product)</div>
                      <div className="font-bold text-emerald-400 mt-0.5">Hydrating Serum 30ml</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'rfm' && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-2">Profil & Segmentasi Pelanggan</span>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                    Kenali Pelanggan VIP & Cegah Pelanggan Churn
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed mb-6">
                    Sistem otomatis menandai pelanggan berdasarkan nilai transaksi (Monetary), frekuensi pesanan (Frequency), dan waktu transaksi terakhir (Recency).
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl">
                    <div className="text-xs font-bold text-amber-400 uppercase">VIP Customer</div>
                    <div className="text-xl font-extrabold text-white mt-1">154 Orangnya</div>
                    <div className="text-[11px] text-slate-400 mt-1">Order &gt; 3x & LTV tinggi</div>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl">
                    <div className="text-xs font-bold text-emerald-400 uppercase">Loyal Customer</div>
                    <div className="text-xl font-extrabold text-white mt-1">420 Orang</div>
                    <div className="text-[11px] text-slate-400 mt-1">Rutin belanja berkala</div>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl">
                    <div className="text-xs font-bold text-red-400 uppercase">At-Risk Customer</div>
                    <div className="text-xl font-extrabold text-white mt-1">89 Orang</div>
                    <div className="text-[11px] text-slate-400 mt-1">Sudah 60+ hari tak beli</div>
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-xl">
                    <div className="text-xs font-bold text-blue-400 uppercase">New Customer</div>
                    <div className="text-xl font-extrabold text-white mt-1">210 Orang</div>
                    <div className="text-[11px] text-slate-400 mt-1">Baru order 1x bulan ini</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'pos' && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-2">Omnichannel POS & Invoicing</span>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                    Mendukung Toko Fisik (Kasir POS) & Penjualan B2B (Invoice)
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed mb-6">
                    ShapeUp CRM tidak hanya untuk penjualan online. Kelola transaksi tatap muka di kasir toko (POS) dan cetak Invoice penagihan resmi untuk pelanggan grosir/B2B secara terpusat dalam satu database pelanggan.
                  </p>
                </div>

                <div className="bg-[#181816] p-6 rounded-2xl border border-slate-800 space-y-3">
                  <div className="flex justify-between items-center p-3 bg-slate-800/40 rounded-lg">
                    <div>
                      <div className="text-xs font-bold text-white">Fitur Kasir POS Store</div>
                      <div className="text-[11px] text-slate-400">Pencatatan kasir cepat & update stok otomatis</div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">Aktif</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-800/40 rounded-lg">
                    <div>
                      <div className="text-xs font-bold text-white">Generator Invoice & Tagihan</div>
                      <div className="text-[11px] text-slate-400">Penjualan tempo & pembukuan otomatis</div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">Aktif</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'finance' && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-2">Akuntansi & Audit Stok</span>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                    Laporan Laba Rugi, Arus Kas & Rekonsiliasi Stock Opname
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed mb-6">
                    Pencatatan keuangan otomatis dari penjualan POS, online, dan invoice. Dilengkapi dengan audit fisik *Stock Opname* untuk memastikan stok fisik sesuai dengan data sistem.
                  </p>
                </div>

                <div className="bg-[#181816] p-6 rounded-2xl border border-slate-800 space-y-3">
                  <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <div className="text-xs text-slate-400">Total Profit Bersih (Nett)</div>
                    <div className="text-xl font-extrabold text-emerald-400 mt-0.5">Rp 84.500.000</div>
                  </div>
                  <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <div className="text-xs text-slate-400">Status Stock Opname Terakhir</div>
                    <div className="text-sm font-bold text-white mt-0.5">Audited (100% Match No Discrepancy)</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE SIMULATION CALCULATOR ──────────────────────────────── */}
      <section id="kalkulator" className="py-20 bg-slate-900/80 border-y border-slate-800/80 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-2">Kalkulator Potensi Omset</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Hitung Potensi Tambahan Revenue Dari Repeat Order
            </h2>
            <p className="text-slate-300 text-sm mt-2">
              Geser nilai di bawah untuk melihat peningkatan omset jika Anda berhasil meningkatkan tingkat repeat order pelanggan sebesar +15%.
            </p>
          </div>

          <div className="p-8 rounded-3xl bg-slate-800/60 border border-slate-700/80 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Input Sliders */}
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-sm font-bold text-slate-200 mb-2">
                  <span>Jumlah Pelanggan Aktif:</span>
                  <span className="text-amber-400 font-extrabold">{activeCustomers.toLocaleString('id-ID')} Cust</span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="10000"
                  step="100"
                  value={activeCustomers}
                  onChange={(e) => setActiveCustomers(Number(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-sm font-bold text-slate-200 mb-2">
                  <span>Rata-rata Nilai Order (AOV):</span>
                  <span className="text-amber-400 font-extrabold">{formatIDR(avgOrderValue)}</span>
                </div>
                <input
                  type="range"
                  min="50000"
                  max="2000000"
                  step="25000"
                  value={avgOrderValue}
                  onChange={(e) => setAvgOrderValue(Number(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-sm font-bold text-slate-200 mb-2">
                  <span>Repeat Order Rate Saat Ini:</span>
                  <span className="text-blue-400 font-extrabold">{repeatRate}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="1"
                  value={repeatRate}
                  onChange={(e) => setRepeatRate(Number(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                />
              </div>
            </div>

            {/* Simulation Results Card */}
            <div className="p-6 rounded-2xl bg-[#171A21] border border-amber-500/30 text-center space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Potensi Omset Tambahan / Bulan</div>
              <div className="text-3xl sm:text-4xl font-black text-amber-400">
                + {formatIDR(addedRevenue)}
              </div>
              <p className="text-xs text-slate-300 leading-relaxed px-4">
                Dengan menaikkan Repeat Order Rate dari <strong className="text-white">{repeatRate}%</strong> menjadi <strong className="text-emerald-400">{boostedRepeatRate}%</strong>, Anda mendapatkan tambahan omset tanpa perlu menambah anggaran iklan baru!
              </p>
              <div className="pt-2">
                <Link
                  href={isLoggedIn ? "/dashboard" : "/register"}
                  className="inline-block w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-sm tracking-wide shadow-lg shadow-amber-500/20"
                >
                  Capai Omset Retensi Ini Sekarang
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ SECTION ───────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-widest block mb-2">Pertanyaan Umum</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Sering Ditanyakan Seputar ShapeUp CRM
            </h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: "Apakah ShapeUp CRM hanya cocok untuk toko online?",
                a: "Tidak! ShapeUp CRM dirancang untuk usaha Omnichannel (Online & Offline). Dilengkapi fitur Kasir POS untuk toko fisik, generator Invoice penagihan B2B/Grosir, serta manajemen pesanan online."
              },
              {
                q: "Bagaimana cara ShapeUp CRM menghitung Returning Cohort?",
                a: "Sistem secara otomatis mencatat tanggal order pertama setiap pelanggan dan melacak transaksi berikutnya. Data ini dikelompokkan dalam tabel kohort visual berdasarkan minggu, bulan, atau tahun."
              },
              {
                q: "Apakah ada fitur pembukuan akuntansi dan stok fisik?",
                a: "Ya! Tersedia laporan Laba Rugi (P&L), laporan Arus Kas, pencatatan biaya operasional, serta modul Stock Opname untuk audit kesesuaian stok fisik."
              },
              {
                q: "Dapatkah tim saya mengakses aplikasi secara bersamaan?",
                a: "Bisa. ShapeUp CRM mendukung Multi-User dan Role-Based Access Control. Anda dapat membagikan hak akses khusus untuk Admin, Staf Kasir, maupun Staf Gudang."
              }
            ].map((faq, idx) => (
              <div
                key={idx}
                className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden transition-all"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full p-6 text-left flex justify-between items-center gap-4 text-base font-bold text-white hover:text-amber-400 transition-colors"
                >
                  <span>{faq.q}</span>
                  <span className="text-xl font-bold text-slate-500">{openFaq === idx ? '−' : '+'}</span>
                </button>
                {openFaq === idx && (
                  <div className="px-6 pb-6 text-slate-300 text-sm leading-relaxed border-t border-slate-800/60 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA BANNER ──────────────────────────────────────────────── */}
      <section className="py-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-3xl p-10 sm:p-14 bg-gradient-to-r from-blue-700 via-indigo-700 to-amber-600 overflow-hidden shadow-2xl text-center">
            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight mb-4">
                Siap Memaksimalkan Potensi Repeat Order Bisnis Anda?
              </h2>
              <p className="text-blue-100 text-base sm:text-lg mb-8">
                Bergabunglah dengan bisnis yang sudah beralih ke analisis data retensi pelanggan yang terukur dan otomatis.
              </p>
              <Link
                href={isLoggedIn ? "/dashboard" : "/register"}
                className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-base tracking-wide shadow-xl shadow-amber-400/30 hover:scale-105 transition-all"
              >
                <span>{isLoggedIn ? "Masuk ke Dashboard" : "Coba ShapeUp CRM Sekarang"}</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer className="py-12 bg-[#090D16] border-t border-slate-800/80 text-slate-400 text-xs relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-amber-500 flex items-center justify-center font-bold text-white text-xs">
              S
            </div>
            <span className="font-bold text-sm text-slate-200">ShapeUp CRM</span>
            <span>— Platform Retensi & Omnichannel CRM Bisnis</span>
          </div>

          <div className="flex items-center gap-6 text-slate-400">
            <Link href="/login" className="hover:text-slate-200">Login</Link>
            <Link href="/register" className="hover:text-slate-200">Register</Link>
            <a href="#fitur" className="hover:text-slate-200">Fitur</a>
            <a href="#faq" className="hover:text-slate-200">Bantuan & FAQ</a>
          </div>

          <div>
            © {new Date().getFullYear()} ShapeUp CRM. Hak Cipta Dilindungi Undang-Undang.
          </div>
        </div>
      </footer>
    </div>
  )
}
