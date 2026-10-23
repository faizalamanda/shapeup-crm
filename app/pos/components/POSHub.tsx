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
import OrderHistoryModal from '../../orders/pos/components/OrderHistoryModal'
import { ReceiptData } from '@/lib/pos/printerAdapter'
import { buildReceiptDataFromOrder } from '@/lib/pos/receiptDataBuilder'

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
  const [totalShiftsCount, setTotalShiftsCount] = useState<number>(0)
  const [hasMoreShifts, setHasMoreShifts] = useState<boolean>(false)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)
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
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false)

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

  // Load Shift, Registers, Accounts & Historical Shift Ledger in parallel (Performance Rule #2)
  const loadData = useCallback(async () => {
    if (!activeBusiness?.id) return
    const currentBizId = activeBusiness.id

    setLoading(true)
    try {
      const statusParam = shiftStatusFilter !== 'all' ? `&status=${shiftStatusFilter}` : ''
      const [shiftRes, historyRes, monitorRes, accRes, regRes] = await Promise.all([
        fetch('/api/pos/shifts'),
        fetch(`/api/pos/shifts?mode=history&limit=15&offset=0${statusParam}`),
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
        setTotalShiftsCount(historyData.totalCount || 0)
        setHasMoreShifts(Boolean(historyData.hasMore))
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
  }, [activeBusiness?.id, shiftStatusFilter])

  useEffect(() => {
    if (!bizLoading && activeBusiness?.id) {
      loadData()
    }
  }, [bizLoading, activeBusiness?.id, loadData])

  // Load More Shifts Handler (Pagination / Load More)
  const handleLoadMoreShifts = async () => {
    if (loadingMore || !hasMoreShifts) return
    const nextOffset = pastShifts.length
    setLoadingMore(true)
    try {
      const statusParam = shiftStatusFilter !== 'all' ? `&status=${shiftStatusFilter}` : ''
      const res = await fetch(`/api/pos/shifts?mode=history&limit=15&offset=${nextOffset}${statusParam}`)
      if (res.ok) {
        const data = await res.json()
        if (data.shifts) {
          setPastShifts((prev) => [...prev, ...data.shifts])
          setHasMoreShifts(Boolean(data.hasMore))
          setTotalShiftsCount(data.totalCount || 0)
        }
      }
    } catch (e) {
      console.error('Failed to load more shifts:', e)
    } finally {
      setLoadingMore(false)
    }
  }

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
    const receipt = buildReceiptDataFromOrder(order, {
      businessName: activeBusiness?.name,
      cashierName,
      timezone
    })
    setQuickPrintReceipt(receipt)
    setIsReceiptPreviewOpen(true)
  }

  // Open Shift Details Modal
  const handleInspectShift = (shiftId: string) => {
    setSelectedShiftIdForDetail(shiftId)
    setIsShiftDetailOpen(true)
  }

  return (
    <div
      className="min-h-screen bg-slate-100 text-slate-900 pb-20 font-sans selection:bg-indigo-500 selection:text-white"
      style={{
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
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

                  {/* Layanan Nota & Piutang */}
                  <button
                    type="button"
                    onClick={() => setIsOrderHistoryOpen(true)}
                    className="px-4 py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 font-bold rounded-2xl text-xs sm:text-sm transition flex items-center justify-center gap-1.5"
                    title="Pusat Layanan Nota: Pelunasan Piutang, Tukar Ukuran, dan Refund"
                  >
                    <span>📋</span>
                    <span className="hidden sm:inline">Layanan Nota & Piutang</span>
                    <span className="sm:hidden">Layanan</span>
                  </button>

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
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsOrderHistoryOpen(true)}
                    className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl text-xs sm:text-sm transition flex items-center justify-center gap-1.5"
                    title="Pusat Layanan Nota: Pelunasan Piutang, Tukar Ukuran, dan Refund"
                  >
                    <span>📋</span>
                    <span>Layanan Nota & Piutang</span>
                  </button>
                  <button
                    onClick={() => setIsShiftModalOpen(true)}
                    className="flex-1 sm:flex-none px-7 py-3.5 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-700 hover:to-violet-800 active:scale-[0.99] text-white font-black rounded-2xl text-sm transition shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2"
                  >
                    <span>🔑</span>
                    <span>Buka Shift Kasir Baru</span>
                  </button>
                </div>
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

        {/* ─── COMPACT SHIFT LEDGER TABLE & LOAD MORE ───────────────────────── */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
          {/* Header & Filter Controls */}
          <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                <span>Riwayat Sesi Shift Kasir (Shift Ledger)</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
                  {totalShiftsCount || pastShifts.length} Sesi
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Daftar rekonsiliasi laci kasir dan Z-Report historis akun Anda. Klik salah satu baris sesi untuk rincian lengkap & cetak ulang struk.
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

          {/* Active Shift Dedicated Banner (If active shift exists) */}
          {activeShift && (
            <div
              onClick={() => handleInspectShift(activeShift.id)}
              className="p-4 sm:px-6 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50/60 border-b border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-emerald-100/60 transition group"
            >
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-emerald-950 text-sm group-hover:text-emerald-700 transition">
                      Sesi Shift Aktif #{activeShift.id.slice(0, 8).toUpperCase()}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider">
                      Sedang Berjalan
                    </span>
                  </div>
                  <p className="text-xs text-emerald-800/90 mt-0.5">
                    Dibuka sejak {formatDisplayDate(activeShift.opened_at, 'time', timezone)} • Modal awal {formatIDR(activeShift.initial_cash)} • Laci kas berjalan: <strong className="font-black">{formatIDR(shiftMetrics.expectedDrawerCash)}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenWorkspace()
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black transition shadow-xs flex items-center gap-1.5"
                >
                  <span>🛒 Ke Kasir</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleInspectShift(activeShift.id)
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-bold transition flex items-center gap-1 shadow-xs"
                >
                  <span>🔍 Rincian & Z-Report</span>
                </button>
              </div>
            </div>
          )}

          {/* Desktop & Tablet View: Compact Ledger Table (Hidden on small mobile) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-black text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">No. Sesi & Status</th>
                  <th className="py-3 px-4">Waktu & Tanggal</th>
                  <th className="py-3 px-4 text-right">Modal Awal</th>
                  <th className="py-3 px-4 text-right">Kas Keluar (Petty)</th>
                  <th className="py-3 px-4 text-right">Total Omzet</th>
                  <th className="py-3 px-4 text-center">Selisih Kas (Z-Report)</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && pastShifts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400">
                      <div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                      <span className="text-xs font-semibold">Memuat riwayat sesi shift...</span>
                    </td>
                  </tr>
                ) : pastShifts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400">
                      <span className="text-3xl block mb-2">🔒</span>
                      <p className="text-xs font-bold text-slate-700">Belum Ada Riwayat Sesi Shift</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Sesi kerja yang pernah Anda buka/tutup akan tercatat di tabel ini.</p>
                    </td>
                  </tr>
                ) : (
                  pastShifts.map((s) => {
                    const isOpen = s.status === 'open'
                    const m = s.metrics || {}
                    const totalSales = Number(m.total_sales || 0)
                    const txCount = Number(m.total_transactions || 0)
                    const initialCash = Number(s.initial_cash || 0)
                    const pettyOut = Number(m.cash_out || 0)
                    const difference = s.difference !== undefined && s.difference !== null ? Number(s.difference) : 0

                    return (
                      <tr
                        key={s.id}
                        onClick={() => handleInspectShift(s.id)}
                        className={`hover:bg-indigo-50/40 transition cursor-pointer group ${
                          isOpen ? 'bg-emerald-50/20' : ''
                        }`}
                      >
                        {/* 1. Sesi & Status */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 group-hover:text-indigo-600 transition">
                              #{s.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                              isOpen
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {isOpen ? 'Aktif' : 'Ditutup'}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            Kasir: {s.cashier_name}
                          </span>
                        </td>

                        {/* 2. Waktu & Tanggal */}
                        <td className="py-3.5 px-4 text-slate-600">
                          <div className="font-semibold text-slate-800">
                            {formatDisplayDate(s.opened_at, 'short', timezone)}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {formatDisplayDate(s.opened_at, 'time', timezone)} {s.closed_at ? `- ${formatDisplayDate(s.closed_at, 'time', timezone)}` : '(Berjalan)'}
                          </div>
                        </td>

                        {/* 3. Modal Awal */}
                        <td className="py-3.5 px-4 text-right font-bold text-slate-700 tabular-nums">
                          {formatIDR(initialCash)}
                        </td>

                        {/* 4. Petty Cash Out */}
                        <td className="py-3.5 px-4 text-right tabular-nums">
                          {pettyOut > 0 ? (
                            <span className="font-bold text-rose-600">-{formatIDR(pettyOut)}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        {/* 5. Total Omzet */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="font-black text-indigo-700 tabular-nums">
                            {formatIDR(totalSales)}
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            {txCount} Nota
                          </span>
                        </td>

                        {/* 6. Selisih Kas (Audit Status) */}
                        <td className="py-3.5 px-4 text-center">
                          {isOpen ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span>Fisik: {formatIDR(m.current_drawer_cash || 0)}</span>
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                              difference === 0
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : difference < 0
                                ? 'bg-rose-50 border-rose-200 text-rose-800'
                                : 'bg-amber-50 border-amber-200 text-amber-800'
                            }`}>
                              <span>{difference === 0 ? '🟢' : difference < 0 ? '🔴' : '🟡'}</span>
                              <span>
                                {difference === 0
                                  ? 'Klop (Rp 0)'
                                  : difference < 0
                                  ? `-${formatIDR(Math.abs(difference))}`
                                  : `+${formatIDR(difference)}`}
                              </span>
                            </span>
                          )}
                        </td>

                        {/* 7. Aksi */}
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleInspectShift(s.id)
                            }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-700 font-extrabold text-xs rounded-xl transition shadow-xs inline-flex items-center gap-1"
                          >
                            <span>🔍 Rincian</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile View: High-Density List (< 768px) */}
          <div className="md:hidden divide-y divide-slate-100">
            {loading && pastShifts.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                <span className="text-xs">Memuat shift...</span>
              </div>
            ) : pastShifts.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs font-semibold">
                Belum ada riwayat sesi shift.
              </div>
            ) : (
              pastShifts.map((s) => {
                const isOpen = s.status === 'open'
                const m = s.metrics || {}
                const totalSales = Number(m.total_sales || 0)
                const difference = s.difference !== undefined && s.difference !== null ? Number(s.difference) : 0

                return (
                  <div
                    key={s.id}
                    onClick={() => handleInspectShift(s.id)}
                    className="p-3.5 hover:bg-indigo-50/30 transition cursor-pointer flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-slate-900 truncate">
                          Sesi #{s.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className={`px-1.5 py-0.2 rounded-md text-[9px] font-bold ${
                          isOpen ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {isOpen ? 'Aktif' : 'Tutup'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatDisplayDate(s.opened_at, 'short', timezone)} • {formatDisplayDate(s.opened_at, 'time', timezone)}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-black text-slate-900 tabular-nums">
                        {formatIDR(totalSales)}
                      </div>
                      <div className={`text-[10px] font-extrabold ${
                        isOpen ? 'text-emerald-600' : difference === 0 ? 'text-emerald-700' : difference < 0 ? 'text-rose-600' : 'text-amber-700'
                      }`}>
                        {isOpen ? '🟢 Berjalan' : difference === 0 ? '🟢 Klop' : difference < 0 ? `🔴 -${formatIDR(Math.abs(difference))}` : `🟡 +${formatIDR(difference)}`}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Bottom Pagination / Load More Bar */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-slate-500 font-medium">
              Menampilkan <strong className="text-slate-800">{pastShifts.length}</strong> dari <strong className="text-slate-800">{totalShiftsCount || pastShifts.length}</strong> Sesi Shift Kasir
            </span>

            <div className="flex items-center gap-2">
              {hasMoreShifts ? (
                <button
                  type="button"
                  onClick={handleLoadMoreShifts}
                  disabled={loadingMore}
                  className="w-full sm:w-auto px-5 py-2 bg-white hover:bg-slate-100 text-slate-700 font-extrabold text-xs rounded-xl border border-slate-300 transition shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin"></span>
                      <span>Memuat...</span>
                    </>
                  ) : (
                    <>
                      <span>⬇️ Muat Lebih Banyak (+15 Sesi)</span>
                    </>
                  )}
                </button>
              ) : pastShifts.length > 0 ? (
                <span className="text-xs text-slate-400 font-semibold">
                  ✓ Seluruh sesi shift telah ditampilkan
                </span>
              ) : null}
            </div>
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
        businessId={activeBusiness?.id}
      />

      {/* 5. Order Detail & Payment Ledger Modal */}
      {selectedOrder && (
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
      )}

      {/* 6. Quick Print Receipt Preview Modal */}
      <ReceiptPreviewModal
        isOpen={isReceiptPreviewOpen}
        onClose={() => {
          setIsReceiptPreviewOpen(false)
          setQuickPrintReceipt(null)
        }}
        receipt={quickPrintReceipt}
      />

      {/* 7. Pusat Layanan Nota & Piutang POS */}
      {isOrderHistoryOpen && activeBusiness?.id && (
        <OrderHistoryModal
          isOpen={isOrderHistoryOpen}
          onClose={() => setIsOrderHistoryOpen(false)}
          businessId={activeBusiness.id}
          timezone={timezone}
          onSelectOrder={(ord) => {
            setIsOrderHistoryOpen(false)
            setSelectedOrder(ord)
            setIsOrderDetailOpen(true)
          }}
          onRefundCompleted={loadData}
        />
      )}
    </div>
  )
}
