"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate } from '@/lib/timeUtils'
import ShiftModal from './ShiftModal'
import PettyCashModal from './PettyCashModal'
import ShiftDetailModal from './ShiftDetailModal'
import ReceiptSettingsModal from './ReceiptSettingsModal'
import ReceiptPreviewModal from './ReceiptPreviewModal'
import POSOrderDetailModal from './POSOrderDetailModal'
import { ReceiptData } from '@/lib/pos/printerAdapter'

type Props = {
  onOpenWorkspace: () => void
}

export default function POSHub({ onOpenWorkspace }: Props) {
  const { activeBusiness, userProfile, bizLoading } = useUserContext()
  const timezone = activeBusiness?.timezone

  // Core Data State
  const [loading, setLoading] = useState(true)
  const [activeShift, setActiveShift] = useState<any | null>(null)
  const [cashierName, setCashierName] = useState<string>('Kasir')
  const [accounts, setAccounts] = useState<any[]>([])
  const [posRegisters, setPosRegisters] = useState<any[]>([])
  const [pastShifts, setPastShifts] = useState<any[]>([])
  const [monitoredShifts, setMonitoredShifts] = useState<any[]>([])
  const [totalDrawerCash, setTotalDrawerCash] = useState<number>(0)

  // Modals State
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false)
  const [isPettyCashOpen, setIsPettyCashOpen] = useState(false)
  const [pettyCashType, setPettyCashType] = useState<'cash_in' | 'cash_out'>('cash_out')
  const [isShiftDetailOpen, setIsShiftDetailOpen] = useState(false)
  const [selectedShiftIdForDetail, setSelectedShiftIdForDetail] = useState<string | null>(null)
  const [isReceiptSettingsOpen, setIsReceiptSettingsOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [isOrderDetailOpen, setIsOrderDetailOpen] = useState(false)
  const [quickPrintReceipt, setQuickPrintReceipt] = useState<ReceiptData | null>(null)
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false)

  // Shift History Filters
  const [shiftStatusFilter, setShiftStatusFilter] = useState<'all' | 'closed' | 'open'>('all')

  // Collapsible Manager Section State
  const [isManagerMonitoringOpen, setIsManagerMonitoringOpen] = useState(false)

  // Format IDR currency
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Load Shift, Registers, Accounts & Historical Shift Ledger in parallel
  const loadData = useCallback(async () => {
    if (!activeBusiness?.id) return
    const currentBizId = activeBusiness.id

    setLoading(true)
    try {
      // Parallel DB queries (Performance Rule #2)
      const [shiftRes, historyRes, monitorRes, accRes, regRes] = await Promise.all([
        fetch('/api/pos/shifts'),
        fetch('/api/pos/shifts?mode=history&limit=30'),
        fetch('/api/pos/shifts?mode=monitoring'),
        supabase
          .from('accounts')
          .select('id, name, code, type')
          .eq('business_id', currentBizId)
          .eq('type', 'ASSET')
          .order('code', { ascending: true }),
        supabase
          .from('pos_registers')
          .select('*')
          .eq('business_id', currentBizId)
          .order('name', { ascending: true })
      ])

      // 1. Active Shift
      if (shiftRes.ok) {
        const shiftData = await shiftRes.json()
        setActiveShift(shiftData.activeShift || null)
        if (shiftData.cashierName) {
          setCashierName(shiftData.cashierName)
        }
      }

      // 2. Past Shifts Ledger
      if (historyRes.ok) {
        const historyData = await historyRes.json()
        setPastShifts(historyData.shifts || [])
      }

      // 3. Manager Monitoring
      if (monitorRes.ok) {
        const monitorData = await monitorRes.json()
        setMonitoredShifts(monitorData.activeShifts || [])
        setTotalDrawerCash(monitorData.totalDrawerCash || 0)
      }

      // 4. Accounts & Registers
      if (accRes.data) setAccounts(accRes.data)
      if (regRes.data) setPosRegisters(regRes.data)
    } catch (err) {
      console.error('Error loading POS Hub data:', err)
    } finally {
      setLoading(false)
    }
  }, [activeBusiness?.id])

  useEffect(() => {
    if (!bizLoading && activeBusiness?.id) {
      loadData()
    }
  }, [bizLoading, activeBusiness?.id, loadData])

  // Shift Actions
  const handleOpenShift = async (initialCash: number, note: string, sourceAccountCode: string, registerId?: string | null) => {
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'open',
        initial_cash: initialCash,
        note,
        source_account_code: sourceAccountCode,
        register_id: registerId || null
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Gagal membuka shift')
    setActiveShift(data.shift)
    await loadData()
  }

  const handleCloseShift = async (shiftId: string, actualCash: number, note: string, targetAccountCode: string) => {
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'close',
        shift_id: shiftId,
        actual_cash: actualCash,
        note,
        target_account_code: targetAccountCode
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Gagal menutup shift')
    setActiveShift(null)
    await loadData()
  }

  // Filtered Shift History List
  const filteredPastShifts = useMemo(() => {
    if (shiftStatusFilter === 'all') return pastShifts
    return pastShifts.filter((s) => s.status === shiftStatusFilter)
  }, [pastShifts, shiftStatusFilter])

  // Active Shift KPIs
  const shiftMetrics = useMemo(() => {
    if (!activeShift) {
      return {
        salesTotal: 0,
        txCount: 0,
        cashInTotal: 0,
        expectedDrawerCash: 0,
        averageOrderValue: 0
      }
    }

    const m = activeShift.metrics || {}
    const salesTotal = Number(activeShift.calculated_cash_sales || m.cash_sales || 0) + Number(activeShift.calculated_non_cash_sales || m.non_cash_sales || 0)
    const txCount = Number(activeShift.total_transactions || m.total_transactions || 0)
    const averageOrderValue = txCount > 0 ? Math.round(salesTotal / txCount) : 0
    const expectedDrawerCash = Number(activeShift.calculated_expected_cash || 0)

    return {
      salesTotal,
      txCount,
      cashInTotal: Number(activeShift.calculated_cash_sales || m.cash_sales || 0),
      expectedDrawerCash,
      averageOrderValue
    }
  }, [activeShift])

  // Quick Direct Print Receipt
  const handleDirectPrintOrder = (order: any) => {
    const receipt: ReceiptData = {
      businessName: activeBusiness?.name || 'ShapeUp Store',
      orderNumber: order.order_number,
      date: formatDisplayDate(order.created_at, 'datetime', timezone),
      cashierName: cashierName,
      customerName: order.customer?.name || 'Pelanggan Walk-in',
      items: (order.items_json || []).map((it: any) => ({
        name: it.name || it.product_name || 'Item',
        quantity: it.quantity || it.qty || 1,
        price: it.price || 0,
        subtotal: (it.price || 0) * (it.quantity || it.qty || 1)
      })),
      subtotal: Number(order.grand_total || 0),
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: Number(order.grand_total || 0),
      paymentMethod: String(order.payment_method || 'Cash').toUpperCase(),
      cashReceived: Number(order.amount_paid || order.grand_total || 0),
      changeAmount: 0
    }
    setQuickPrintReceipt(receipt)
    setIsReceiptPreviewOpen(true)
  }

  // Open Shift Details Modal
  const handleInspectShift = (shiftId: string) => {
    setSelectedShiftIdForDetail(shiftId)
    setIsShiftDetailOpen(true)
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-20 font-sans selection:bg-indigo-500 selection:text-white">
      {/* ─── 1. TOP COMMAND STRIP (STICKY POS HEADER) ─────────────────────────── */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-lg backdrop-blur-md bg-slate-900/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Left: CRM Return & Store Brand */}
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition border border-slate-700/60"
              title="Kembali ke Dashboard CRM ShapeUp"
            >
              <span>←</span>
              <span className="hidden sm:inline">CRM</span>
            </Link>

            <div className="h-5 w-px bg-slate-800 hidden sm:block"></div>

            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-violet-600 text-white font-black flex items-center justify-center text-sm shadow-md shadow-indigo-500/20">
                POS
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-extrabold text-sm sm:text-base leading-tight text-white tracking-tight">
                    {activeBusiness?.name || 'ShapeUp Fashion'}
                  </h1>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-bold uppercase tracking-wider">
                    Kasir Fashion
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-none mt-0.5 flex items-center gap-1.5">
                  <span>Kasir: <strong className="text-slate-200">{userProfile?.full_name || cashierName}</strong></span>
                  <span>•</span>
                  <span>{formatDisplayDate(new Date(), 'short', timezone)}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Right: Personal Drawer Cash Pill & Settings */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Live Drawer Cash Badge */}
            {activeShift ? (
              <div
                onClick={() => {
                  setPettyCashType('cash_out')
                  setIsPettyCashOpen(true)
                }}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 rounded-xl cursor-pointer transition group"
                title="Klik untuk catat Kas Masuk / Kas Keluar (Petty Cash)"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <div className="text-left leading-tight">
                  <span className="text-[9px] uppercase tracking-wider text-emerald-300 font-bold block">
                    Uang Tunai di Laci
                  </span>
                  <span className="text-xs font-black text-emerald-200 group-hover:text-white tabular-nums">
                    {formatIDR(shiftMetrics.expectedDrawerCash)}
                  </span>
                </div>
                <span className="text-[10px] text-emerald-400 group-hover:translate-x-0.5 transition">
                  ✏️
                </span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/50 border border-amber-500/30 rounded-xl text-amber-300 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>Sesi Belum Buka</span>
              </div>
            )}

            {/* Receipt Settings Button */}
            <button
              onClick={() => setIsReceiptSettingsOpen(true)}
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition"
              title="Atur Format Struk & Printer Thermal"
            >
              <span>🖨️</span>
              <span className="hidden sm:inline">Struk</span>
            </button>

            {/* Refresh Data Button */}
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Perbarui Data Kasir & Sesi Shift"
            >
              <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
            </button>
          </div>
        </div>
      </header>

      {/* ─── MAIN CONTENT CONTAINER (SINGLE UNIFIED COLUMN) ───────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* ─── HERO CARD: SHIFT STATUS & PRIMARY ACTIONS ────────────────────── */}
        <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/90 shadow-sm relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-indigo-500/10 via-violet-500/5 to-transparent rounded-full blur-2xl pointer-events-none -mr-20 -mt-20"></div>

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            {/* Left: Shift Info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                {activeShift ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Shift Kasir Aktif
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-200">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    Sesi Belum Dibuka
                  </span>
                )}
                <span className="text-xs text-slate-300">•</span>
                <span className="text-xs text-slate-500 font-semibold">
                  Kasir: <strong className="text-slate-800">{userProfile?.full_name || cashierName}</strong>
                </span>
                {activeShift?.opened_at && (
                  <>
                    <span className="text-xs text-slate-300">•</span>
                    <span className="text-xs text-slate-500">
                      Buka: {formatDisplayDate(activeShift.opened_at, 'time', timezone)}
                    </span>
                  </>
                )}
              </div>

              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                  {activeShift ? 'Siap Melayani Pelanggan Toko' : 'Buka Shift untuk Memulai Transaksi'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
                  {activeShift
                    ? `Modal awal laci ${formatIDR(activeShift.initial_cash)}. Tekan "Buka Register Kasir" untuk memindai barcode pakaian atau kelola mutasi kas di bawah.`
                    : 'Buka sesi kasir baru untuk mencatat uang modal kembalian dan mengaktifkan pembukuan laci kasir hari ini.'}
                </p>
              </div>
            </div>

            {/* Right: Primary Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {activeShift ? (
                <>
                  {/* Primary CTA: Buka Register Kasir */}
                  <button
                    onClick={onOpenWorkspace}
                    className="flex-1 sm:flex-none px-7 py-3.5 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-700 hover:to-violet-800 active:scale-[0.99] text-white font-black rounded-2xl text-sm transition shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2.5"
                  >
                    <span className="text-lg">🛒</span>
                    <span>Buka Register Kasir</span>
                    <span className="text-xs opacity-80">→</span>
                  </button>

                  {/* Petty Cash Button */}
                  <div className="inline-flex rounded-2xl p-1 bg-slate-100 border border-slate-200/90 gap-1">
                    <button
                      onClick={() => {
                        setPettyCashType('cash_in')
                        setIsPettyCashOpen(true)
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-bold bg-white text-emerald-700 hover:bg-emerald-50 transition shadow-xs flex items-center gap-1"
                      title="Tambah modal uang kembalian ke laci"
                    >
                      <span>+ Kas Masuk</span>
                    </button>
                    <button
                      onClick={() => {
                        setPettyCashType('cash_out')
                        setIsPettyCashOpen(true)
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-bold bg-white text-rose-700 hover:bg-rose-50 transition shadow-xs flex items-center gap-1"
                      title="Catat kas keluar operasional toko (lakban, packing, dll)"
                    >
                      <span>- Kas Keluar (Petty)</span>
                    </button>
                  </div>

                  {/* Tutup Shift Button */}
                  <button
                    onClick={() => setIsShiftModalOpen(true)}
                    className="px-4 py-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 font-bold rounded-2xl text-xs sm:text-sm transition flex items-center justify-center gap-1.5"
                    title="Tutup Shift & Rekonsiliasi Kas Z-Report"
                  >
                    <span>🔒</span>
                    <span className="hidden sm:inline">Tutup Shift</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsShiftModalOpen(true)}
                  className="flex-1 sm:flex-none px-7 py-3.5 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-700 hover:to-violet-800 active:scale-[0.99] text-white font-black rounded-2xl text-sm transition shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2"
                >
                  <span>🔑</span>
                  <span>Buka Shift Kasir Baru</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ─── REALTIME SHIFT KPI METRICS CARDS ──────────────────────────────── */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-sm">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
            {/* KPI 1: Omzet Shift */}
            <div className="pt-2 lg:pt-0 lg:pr-4">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Total Omzet Shift Ini
              </span>
              <span className="text-xl sm:text-2xl font-black text-indigo-700 mt-1 block tabular-nums">
                {formatIDR(shiftMetrics.salesTotal)}
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                Semua metode pembayaran
              </span>
            </div>

            {/* KPI 2: Total Transaksi Selesai */}
            <div className="pt-2 lg:pt-0 lg:px-4">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Transaksi Sukses
              </span>
              <span className="text-xl sm:text-2xl font-black text-slate-800 mt-1 block tabular-nums">
                {shiftMetrics.txCount} Nota
              </span>
              <span className="text-[11px] text-emerald-600 font-bold mt-0.5 block flex items-center gap-1">
                <span>🟢 {activeShift ? 'Kasir Standby' : 'Shift Nonaktif'}</span>
              </span>
            </div>

            {/* KPI 3: Tunai di Laci */}
            <div className="pt-2 lg:pt-0 lg:px-4">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Fisik Kas di Laci
              </span>
              <span className="text-xl sm:text-2xl font-black text-emerald-700 mt-1 block tabular-nums">
                {formatIDR(shiftMetrics.expectedDrawerCash)}
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                Modal + Penjualan Tunai ± Petty
              </span>
            </div>

            {/* KPI 4: Nilai Rata-rata Bon (AOV) */}
            <div className="pt-2 lg:pt-0 lg:pl-4">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Rata-Rata Belanja (AOV)
              </span>
              <span className="text-xl sm:text-2xl font-black text-slate-800 mt-1 block tabular-nums">
                {formatIDR(shiftMetrics.averageOrderValue)}
              </span>
              <span className="text-[11px] text-indigo-600 font-medium mt-0.5 block">
                Per transaksi pelanggan
              </span>
            </div>
          </div>
        </div>

        {/* ─── FULL-WIDTH SHIFT LEDGER (DAFTAR RIWAYAT SESI SHIFT KASIR) ─────── */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
          {/* Header & Filter Controls */}
          <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                <span>Riwayat Sesi Shift Kasir (Shift Ledger)</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
                  {filteredPastShifts.length} Sesi
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Daftar pertanggungjawaban laci kasir dan laporan penutupan (*Z-Report*) akun Anda. Klik salah satu sesi untuk melihat rincian nota & uang kas.
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200 text-xs font-bold self-start sm:self-auto">
              <button
                onClick={() => setShiftStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  shiftStatusFilter === 'all'
                    ? 'bg-white text-indigo-700 shadow-sm font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semua Sesi
              </button>
              <button
                onClick={() => setShiftStatusFilter('closed')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  shiftStatusFilter === 'closed'
                    ? 'bg-white text-indigo-700 shadow-sm font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Shift Ditutup 🔒
              </button>
              <button
                onClick={() => setShiftStatusFilter('open')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  shiftStatusFilter === 'open'
                    ? 'bg-white text-indigo-700 shadow-sm font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Shift Berjalan 🟢
              </button>
            </div>
          </div>

          {/* Shifts Ledger Cards Body */}
          <div className="p-4 sm:p-5 space-y-3 max-h-[680px] overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <div className="py-20 text-center text-slate-400 space-y-2">
                <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-semibold">Memuat riwayat sesi shift...</p>
              </div>
            ) : filteredPastShifts.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-2">
                <span className="text-4xl block">🔒</span>
                <p className="text-sm font-bold text-slate-700">Belum Ada Riwayat Sesi Shift</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Belum ada catatan sesi shift kasir yang pernah Anda operasikan. Tekan tombol &ldquo;Buka Shift Kasir Baru&rdquo; untuk memulai.
                </p>
              </div>
            ) : (
              filteredPastShifts.map((s) => {
                const isOpen = s.status === 'open'
                const m = s.metrics || {}
                const totalSales = Number(m.total_sales || 0)
                const txCount = Number(m.total_transactions || 0)
                const initialCash = Number(s.initial_cash || 0)
                const pettyOut = Number(m.cash_out || 0)
                const difference = s.difference !== undefined && s.difference !== null ? Number(s.difference) : 0

                return (
                  <div
                    key={s.id}
                    onClick={() => handleInspectShift(s.id)}
                    className="pt-3 first:pt-0 group cursor-pointer"
                  >
                    <div className="p-4 sm:p-5 rounded-2xl border border-slate-200/80 hover:border-indigo-400 hover:bg-indigo-50/25 transition space-y-3">
                      {/* Top Row: Shift Identifier & Dates */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-900 text-sm group-hover:text-indigo-600 transition">
                            Sesi #{s.id.slice(0, 8).toUpperCase()}
                          </span>

                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isOpen
                              ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500/20'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {isOpen ? '🟢 Sedang Berjalan' : '🔒 Ditutup'}
                          </span>

                          <span className="text-slate-300 text-xs hidden sm:inline">•</span>
                          <span className="text-xs text-slate-500 font-semibold">
                            Kasir: {s.cashier_name}
                          </span>
                        </div>

                        <div className="text-xs text-slate-400 font-medium">
                          📅 {formatDisplayDate(s.opened_at, 'short', timezone)} • {formatDisplayDate(s.opened_at, 'time', timezone)} {s.closed_at ? `- ${formatDisplayDate(s.closed_at, 'time', timezone)}` : '(Berjalan)'}
                        </div>
                      </div>

                      {/* Middle Row: Metrics Summary */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Omzet Penjualan</span>
                          <span className="text-sm font-black text-indigo-700 mt-0.5 block tabular-nums">
                            {formatIDR(totalSales)}
                          </span>
                        </div>

                        <div className="p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Transaksi Sukses</span>
                          <span className="text-sm font-black text-slate-800 mt-0.5 block tabular-nums">
                            {txCount} Nota
                          </span>
                        </div>

                        <div className="p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Modal Awal Laci</span>
                          <span className="text-sm font-black text-slate-800 mt-0.5 block tabular-nums">
                            {formatIDR(initialCash)}
                          </span>
                        </div>

                        <div className="p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Kas Keluar Petty</span>
                          <span className={`text-sm font-black mt-0.5 block tabular-nums ${pettyOut > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                            {pettyOut > 0 ? `-${formatIDR(pettyOut)}` : 'Rp 0'}
                          </span>
                        </div>
                      </div>

                      {/* Bottom Row: Cash Reconciliation Status & Inspection Button */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <div>
                          {isOpen ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span>Fisik Laci Berjalan: {formatIDR(m.current_drawer_cash || 0)}</span>
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-xl border ${
                              difference === 0
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : difference < 0
                                ? 'bg-rose-50 border-rose-200 text-rose-800'
                                : 'bg-amber-50 border-amber-200 text-amber-800'
                            }`}>
                              <span>{difference === 0 ? '🟢' : difference < 0 ? '🔴' : '🟡'}</span>
                              <span>
                                {difference === 0 
                                  ? 'Rekonsiliasi Kas Klop (Rp 0)' 
                                  : difference < 0 
                                  ? `Selisih Kurang: -${formatIDR(Math.abs(difference))}` 
                                  : `Selisih Lebih: +${formatIDR(difference)}`}
                              </span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleInspectShift(s.id)
                            }}
                            className="px-4 py-2 bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 font-extrabold text-xs rounded-xl transition shadow-xs flex items-center gap-1.5"
                          >
                            <span>🔍 Rincian Shift & Z-Report</span>
                            <span>→</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ─── COLLAPSIBLE MANAGER SECTION ──────────────────────────────────── */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
          <button
            onClick={() => setIsManagerMonitoringOpen(!isManagerMonitoringOpen)}
            className="w-full p-4 sm:p-5 flex items-center justify-between text-left hover:bg-slate-50/80 transition"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-lg">📊</span>
              <div>
                <h4 className="font-extrabold text-sm sm:text-base text-slate-900">
                  Pemantauan Multi-Kasir & Brankas Toko (Akses Manajer Toko)
                </h4>
                <p className="text-xs text-slate-400">
                  {monitoredShifts.length} Kasir Sedang Aktif • Total Fisik Seluruh Kasir: {formatIDR(totalDrawerCash)}
                </p>
              </div>
            </div>

            <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700">
              {isManagerMonitoringOpen ? 'Sembunyikan ▲' : 'Buka Pantau ▼'}
            </span>
          </button>

          {isManagerMonitoringOpen && (
            <div className="p-5 border-t border-slate-100 bg-slate-50/50 space-y-4">
              <p className="text-xs text-slate-500">
                Menu ini khusus untuk manajer toko guna mengawasi saldo fisik uang tunai di masing-masing mesin kasir secara terpusat tanpa mengganggu jalannya pelayanan kasir di lapangan.
              </p>

              {monitoredShifts.length === 0 ? (
                <div className="p-6 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400 font-medium">
                  Tidak ada kasir lain yang sedang membuka sesi shift saat ini.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {monitoredShifts.map((shift: any) => {
                    const isMyShift = activeShift?.id === shift.id
                    const m = shift.metrics || {}
                    const registerObj = posRegisters.find((r) => r.id === shift.register_id)

                    return (
                      <div
                        key={shift.id}
                        className={`rounded-2xl p-4 border transition ${
                          isMyShift 
                            ? 'bg-indigo-50/50 border-indigo-200 shadow-xs ring-1 ring-indigo-500/10' 
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-black text-slate-900 text-sm">{shift.cashier_name}</span>
                              {isMyShift && (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 bg-indigo-600 text-white rounded-md">
                                  Anda
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500 block mt-0.5">
                              {registerObj ? `Laci: ${registerObj.name}` : 'Laci Bebas'} • Buka: {formatDisplayDate(shift.opened_at, 'time', timezone)}
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            Aktif
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs py-2.5 text-slate-600">
                          <div className="flex justify-between">
                            <span>Modal Mula-mula:</span>
                            <span className="font-semibold text-slate-800 tabular-nums">{formatIDR(m.initial_cash || shift.initial_cash || 0)}</span>
                          </div>
                          <div className="flex justify-between text-emerald-700">
                            <span>Penjualan Tunai (+):</span>
                            <span className="font-bold tabular-nums">+{formatIDR(m.cash_sales || 0)}</span>
                          </div>
                          <div className="flex justify-between text-indigo-700">
                            <span>QRIS / Kartu (+):</span>
                            <span className="font-semibold tabular-nums">{formatIDR(m.non_cash_sales || 0)}</span>
                          </div>
                        </div>

                        <div className="pt-2.5 border-t border-slate-100 flex justify-between items-center bg-slate-50 p-2.5 rounded-xl">
                          <span className="text-[11px] font-extrabold text-slate-700 uppercase">Uang Fisik Laci:</span>
                          <span className="text-sm font-black text-emerald-700 tabular-nums">
                            {formatIDR(m.current_drawer_cash || 0)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ─── MODALS ───────────────────────────────────────────────────────────── */}
      {/* 1. Shift Modal (Open / Close Shift & Reconciliation) */}
      <ShiftModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        activeShift={activeShift}
        accounts={accounts}
        posRegisters={posRegisters}
        cashierName={cashierName}
        onOpenShift={handleOpenShift}
        onCloseShift={handleCloseShift}
        timezone={timezone}
      />

      {/* 2. Petty Cash Modal (Cash In / Out) */}
      {activeShift && (
        <PettyCashModal
          isOpen={isPettyCashOpen}
          onClose={() => setIsPettyCashOpen(false)}
          shiftId={activeShift.id}
          initialType={pettyCashType}
          industryMode="fashion"
          onSuccess={loadData}
        />
      )}

      {/* 3. Shift Detail Modal (Z-Report & Encapsulated Orders Inspector) */}
      <ShiftDetailModal
        isOpen={isShiftDetailOpen}
        onClose={() => {
          setIsShiftDetailOpen(false)
          setSelectedShiftIdForDetail(null)
        }}
        shiftId={selectedShiftIdForDetail}
        timezone={timezone}
        businessName={activeBusiness?.name || 'ShapeUp Store'}
        onReprintOrder={(order) => handleDirectPrintOrder(order)}
        onOpenOrderDetail={(order) => {
          setSelectedOrder(order)
          setIsOrderDetailOpen(true)
        }}
        onReprintZReport={(receipt) => {
          setQuickPrintReceipt(receipt)
          setIsReceiptPreviewOpen(true)
        }}
      />

      {/* 4. Receipt Settings Modal */}
      <ReceiptSettingsModal
        isOpen={isReceiptSettingsOpen}
        onClose={() => setIsReceiptSettingsOpen(false)}
        defaultBusinessName={activeBusiness?.name || 'ShapeUp Store'}
      />

      {/* 5. Order Detail & Payment Ledger Modal */}
      <POSOrderDetailModal
        isOpen={isOrderDetailOpen}
        onClose={() => {
          setIsOrderDetailOpen(false)
          setSelectedOrder(null)
        }}
        order={selectedOrder}
        timezone={timezone}
        businessName={activeBusiness?.name || 'ShapeUp Store'}
        cashierName={cashierName}
        onRefundSuccess={loadData}
        onOrderUpdated={loadData}
      />

      {/* 6. Quick Print Receipt Preview Modal */}
      <ReceiptPreviewModal
        isOpen={isReceiptPreviewOpen}
        onClose={() => {
          setIsReceiptPreviewOpen(false)
          setQuickPrintReceipt(null)
        }}
        receipt={quickPrintReceipt}
      />
    </div>
  )
}
