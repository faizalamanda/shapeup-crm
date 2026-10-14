"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate } from '@/lib/timeUtils'
import ShiftModal from './ShiftModal'
import PettyCashModal from './PettyCashModal'
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
  const [orders, setOrders] = useState<any[]>([])
  const [monitoredShifts, setMonitoredShifts] = useState<any[]>([])
  const [totalDrawerCash, setTotalDrawerCash] = useState<number>(0)

  // Modals State
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false)
  const [isPettyCashOpen, setIsPettyCashOpen] = useState(false)
  const [pettyCashType, setPettyCashType] = useState<'cash_in' | 'cash_out'>('cash_out')
  const [isReceiptSettingsOpen, setIsReceiptSettingsOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [isOrderDetailOpen, setIsOrderDetailOpen] = useState(false)
  const [quickPrintReceipt, setQuickPrintReceipt] = useState<ReceiptData | null>(null)
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false)

  // Filters State
  const [filterMode, setFilterMode] = useState<'current_shift' | 'all'>('current_shift')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled' | 'draft'>('all')
  const [searchQuery, setSearchQuery] = useState('')

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

  // Load Shift, Registers, Accounts & Recent Orders
  const loadData = useCallback(async () => {
    if (!activeBusiness?.id) return
    const currentBizId = activeBusiness.id

    setLoading(true)
    try {
      // 1. Fetch Active Shift & Live Monitoring in parallel
      const [shiftRes, monitorRes] = await Promise.all([
        fetch('/api/pos/shifts'),
        fetch('/api/pos/shifts?mode=monitoring')
      ])

      if (shiftRes.ok) {
        const shiftData = await shiftRes.json()
        setActiveShift(shiftData.activeShift || null)
        if (shiftData.cashierName) {
          setCashierName(shiftData.cashierName)
        }
      }

      if (monitorRes.ok) {
        const monitorData = await monitorRes.json()
        setMonitoredShifts(monitorData.activeShifts || [])
        setTotalDrawerCash(monitorData.totalDrawerCash || 0)
      }

      // 2. Fetch Accounts, POS Registers, and Recent Orders
      const [accRes, regRes, ordersRes] = await Promise.all([
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
          .order('name', { ascending: true }),
        supabase
          .from('orders')
          .select(`
            id,
            order_number,
            created_at,
            grand_total,
            total_qty,
            status,
            payment_status,
            amount_paid,
            payment_method,
            shift_id,
            register_id,
            raw_source_data,
            items_json,
            customer:customers(name, phone)
          `)
          .eq('business_id', currentBizId)
          .eq('source_platform', 'POS')
          .order('created_at', { ascending: false })
          .limit(80)
      ])

      if (accRes.data) setAccounts(accRes.data)
      if (regRes.data) setPosRegisters(regRes.data)
      if (ordersRes.data) {
        const formatted = ordersRes.data.map((o: any) => ({
          ...o,
          customer: Array.isArray(o.customer) ? o.customer[0] : o.customer
        }))
        setOrders(formatted)
      }
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

  // Filter Orders for history list
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // 1. Shift Filter
      if (filterMode === 'current_shift' && activeShift) {
        const isMatchedShift = o.shift_id === activeShift.id
        const isCreatedAfterOpen = activeShift.opened_at && new Date(o.created_at) >= new Date(activeShift.opened_at)
        if (!isMatchedShift && !isCreatedAfterOpen) return false
      }

      // 2. Status Filter
      if (statusFilter !== 'all' && o.status !== statusFilter) {
        return false
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesOrderNo = o.order_number?.toLowerCase().includes(q)
        const matchesCustomer = o.customer?.name?.toLowerCase().includes(q)
        if (!matchesOrderNo && !matchesCustomer) return false
      }

      return true
    })
  }, [orders, filterMode, activeShift, statusFilter, searchQuery])

  // Shift KPIs
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

    const currentShiftOrders = orders.filter((o) => {
      const isMatchedShift = o.shift_id === activeShift.id
      const isCreatedAfterOpen = activeShift.opened_at && new Date(o.created_at) >= new Date(activeShift.opened_at)
      return (isMatchedShift || isCreatedAfterOpen) && o.status === 'completed'
    })

    const salesTotal = currentShiftOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0)
    const txCount = currentShiftOrders.length
    const averageOrderValue = txCount > 0 ? Math.round(salesTotal / txCount) : 0

    // Cash received from cash orders
    const cashInTotal = currentShiftOrders
      .filter((o) => String(o.payment_method || '').toLowerCase() === 'cash')
      .reduce((sum, o) => sum + Number(o.grand_total || 0), 0)

    const initialCash = Number(activeShift.initial_cash || 0)
    const movementsCashIn = Number(activeShift.calculated_cash_in || 0)
    const movementsCashOut = Number(activeShift.calculated_cash_out || 0)
    const cashRefunds = Number(activeShift.calculated_cash_refunds || 0)

    const expectedDrawerCash = activeShift.calculated_expected_cash !== undefined
      ? Number(activeShift.calculated_expected_cash)
      : initialCash + cashInTotal + movementsCashIn - movementsCashOut - cashRefunds

    return {
      salesTotal,
      txCount,
      cashInTotal,
      expectedDrawerCash,
      averageOrderValue
    }
  }, [orders, activeShift])

  // Quick Direct Print
  const handleDirectPrintOrder = (order: any, e: React.MouseEvent) => {
    e.stopPropagation()
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
              title="Perbarui Data Kasir"
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
                    ? `Modal awal laci ${formatIDR(activeShift.initial_cash)}. Klik tombol "Buka Register Kasir" untuk memindai barcode pakaian dan memproses transaksi.`
                    : 'Buka sesi kasir baru untuk mencatat uang modal laci kembalian dan mengaktifkan register kasir hari ini.'}
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
                      title="Tambah modal uang kembalian"
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

        {/* ─── FULL-WIDTH TRANSAKSI KASIR (SINGLE UNIFIED VIEW) ──────────────── */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
          {/* Header & Filter Controls */}
          <div className="p-5 sm:p-6 border-b border-slate-100 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                  <span>Riwayat Transaksi Penjualan Kasir</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
                    {filteredOrders.length} Nota
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Daftar transaksi penjualan kasir toko. Klik nota untuk rincian lengkap atau cetak ulang struk.
                </p>
              </div>

              {/* Shift vs Semua Switcher */}
              <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200 text-xs font-bold self-start sm:self-auto">
                <button
                  onClick={() => setFilterMode('current_shift')}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    filterMode === 'current_shift'
                      ? 'bg-white text-indigo-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Shift Ini {activeShift ? '🟢' : ''}
                </button>
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    filterMode === 'all'
                      ? 'bg-white text-indigo-700 shadow-sm font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Semua Shift POS
                </button>
              </div>
            </div>

            {/* Search Input & Status Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                <input
                  type="text"
                  placeholder="Cari No. Order (POS-...) atau Nama Pelanggan..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Status Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
                {(['all', 'completed', 'cancelled', 'draft'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 ${
                      statusFilter === st
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {st === 'all' && 'Semua'}
                    {st === 'completed' && 'Selesai'}
                    {st === 'cancelled' && 'Dibatalkan'}
                    {st === 'draft' && 'Draft'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Transactions Stream / List */}
          <div className="p-4 sm:p-5 space-y-2.5 max-h-[620px] overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <div className="py-20 text-center text-slate-400 space-y-2">
                <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-semibold">Memuat riwayat transaksi kasir...</p>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-2">
                <span className="text-4xl block">🧾</span>
                <p className="text-sm font-bold text-slate-700">Belum Ada Transaksi</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {filterMode === 'current_shift' && activeShift
                    ? 'Belum ada transaksi di shift ini. Tekan tombol "Buka Register Kasir" untuk mulai transaksi.'
                    : 'Tidak ada transaksi yang cocok dengan filter pencarian.'}
                </p>
                {activeShift && (
                  <button
                    onClick={onOpenWorkspace}
                    className="mt-3 px-5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs transition"
                  >
                    + Buka Register Kasir
                  </button>
                )}
              </div>
            ) : (
              filteredOrders.map((order) => {
                const isCompleted = order.status === 'completed'
                const isCancelled = order.status === 'cancelled'
                const itemsCount = (order.items_json || []).length
                const methodStr = String(order.payment_method || 'cash').toLowerCase()

                return (
                  <div
                    key={order.id}
                    onClick={() => {
                      setSelectedOrder(order)
                      setIsOrderDetailOpen(true)
                    }}
                    className="pt-2.5 first:pt-0 group cursor-pointer"
                  >
                    <div className="p-4 rounded-2xl border border-slate-200/80 hover:border-indigo-400 hover:bg-indigo-50/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Left: Order Info */}
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-900 text-sm group-hover:text-indigo-600 transition">
                            {order.order_number}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            isCompleted
                              ? 'bg-emerald-100 text-emerald-800'
                              : isCancelled
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {isCompleted ? 'Selesai' : isCancelled ? 'Dibatalkan' : 'Draft'}
                          </span>
                          <span className="text-xs text-slate-400">•</span>
                          <span className="text-xs text-slate-500 font-medium">
                            {formatDisplayDate(order.created_at, 'datetime', timezone)}
                          </span>
                        </div>

                        <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
                          <span className="font-bold text-slate-700">
                            👤 {order.customer?.name || 'Pelanggan Walk-in'}
                          </span>
                          <span>•</span>
                          <span>{itemsCount} Item Produk</span>
                        </div>
                      </div>

                      {/* Right: Total Price, Method, & Action */}
                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100">
                        <div className="text-left sm:text-right">
                          <div className="font-black text-slate-900 text-sm sm:text-base tabular-nums">
                            {formatIDR(order.grand_total)}
                          </div>
                          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 sm:justify-end">
                            {methodStr.includes('cash') ? '💵 Tunai' : methodStr.includes('qris') ? '📱 QRIS' : '💳 Kartu/Transfer'}
                          </span>
                        </div>

                        {/* Quick 1-Tap Reprint Button */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => handleDirectPrintOrder(order, e)}
                            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-700 font-bold text-xs transition shadow-xs flex items-center gap-1"
                            title="Cetak Ulang Struk Cepat"
                          >
                            <span>🖨️</span>
                            <span className="hidden sm:inline">Cetak</span>
                          </button>
                          <button
                            onClick={() => {
                              setSelectedOrder(order)
                              setIsOrderDetailOpen(true)
                            }}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
                            title="Buka Rincian Nota"
                          >
                            →
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
                            <span className="font-semibold text-slate-800">{formatIDR(m.initial_cash || shift.initial_cash || 0)}</span>
                          </div>
                          <div className="flex justify-between text-emerald-700">
                            <span>Penjualan Tunai (+):</span>
                            <span className="font-bold">+{formatIDR(m.cash_sales || 0)}</span>
                          </div>
                          <div className="flex justify-between text-indigo-700">
                            <span>QRIS / Kartu (+):</span>
                            <span className="font-semibold">{formatIDR(m.non_cash_sales || 0)}</span>
                          </div>
                        </div>

                        <div className="pt-2.5 border-t border-slate-100 flex justify-between items-center bg-slate-50 p-2.5 rounded-xl">
                          <span className="text-[11px] font-extrabold text-slate-700 uppercase">Uang Fisik Laci:</span>
                          <span className="text-sm font-black text-emerald-700">
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

      {/* 3. Receipt Settings Modal */}
      <ReceiptSettingsModal
        isOpen={isReceiptSettingsOpen}
        onClose={() => setIsReceiptSettingsOpen(false)}
        defaultBusinessName={activeBusiness?.name || 'ShapeUp Store'}
      />

      {/* 4. Order Detail & Payment Ledger Modal */}
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

      {/* 5. Quick Print Receipt Preview Modal */}
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
