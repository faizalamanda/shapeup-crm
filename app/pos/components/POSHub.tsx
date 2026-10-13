"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate } from '@/lib/timeUtils'
import ShiftModal from './ShiftModal'
import ReceiptSettingsModal from './ReceiptSettingsModal'
import POSOrderDetailModal from './POSOrderDetailModal'

type Props = {
  onOpenWorkspace: () => void
}

export default function POSHub({ onOpenWorkspace }: Props) {
  const { activeBusiness, userProfile, bizLoading } = useUserContext()
  const timezone = activeBusiness?.timezone

  // State
  const [loading, setLoading] = useState(true)
  const [activeShift, setActiveShift] = useState<any | null>(null)
  const [cashierName, setCashierName] = useState<string>('Kasir')
  const [accounts, setAccounts] = useState<any[]>([])
  const [posRegisters, setPosRegisters] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  
  // Modals
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false)
  const [isReceiptSettingsOpen, setIsReceiptSettingsOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [isOrderDetailOpen, setIsOrderDetailOpen] = useState(false)

  // Filters
  const [filterMode, setFilterMode] = useState<'current_shift' | 'all'>('current_shift')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled' | 'draft'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Format currency IDR
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Load Initial Data (Shift, Accounts, Registers, Orders)
  const loadData = useCallback(async () => {
    if (!activeBusiness?.id) return
    const currentBizId = activeBusiness.id

    setLoading(true)
    try {
      // 1. Fetch Active Shift
      const shiftRes = await fetch('/api/pos/shifts')
      if (shiftRes.ok) {
        const shiftData = await shiftRes.json()
        setActiveShift(shiftData.activeShift || null)
        if (shiftData.cashierName) {
          setCashierName(shiftData.cashierName)
        }
      }

      // 2. Fetch Accounts and POS Registers in parallel
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
          .limit(100)
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

  // Shift Management Handlers
  const handleOpenShift = async (initialCash: number, note: string, sourceAccountCode: string, registerId: string) => {
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'open',
        initial_cash: initialCash,
        note,
        source_account_code: sourceAccountCode,
        register_id: registerId
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

  // Filter Orders
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

      // 3. Search Query (order_number or customer name)
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
        expectedDrawerCash: 0
      }
    }

    const currentShiftOrders = orders.filter((o) => {
      const isMatchedShift = o.shift_id === activeShift.id
      const isCreatedAfterOpen = activeShift.opened_at && new Date(o.created_at) >= new Date(activeShift.opened_at)
      return (isMatchedShift || isCreatedAfterOpen) && o.status === 'completed'
    })

    const salesTotal = currentShiftOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0)
    const txCount = currentShiftOrders.length

    // Cash received from cash orders
    const cashInTotal = currentShiftOrders
      .filter((o) => String(o.payment_method || '').toLowerCase() === 'cash')
      .reduce((sum, o) => sum + Number(o.grand_total || 0), 0)

    const initialCash = Number(activeShift.initial_cash || 0)
    const expectedDrawerCash = initialCash + cashInTotal

    return {
      salesTotal,
      txCount,
      cashInTotal,
      expectedDrawerCash
    }
  }, [orders, activeShift])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16 font-sans">
      {/* Top Hub Navbar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border border-slate-700/60"
            >
              <span>←</span>
              <span>CRM Dashboard</span>
            </Link>
            <div className="h-5 w-px bg-slate-800 hidden sm:block"></div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 text-white font-black flex items-center justify-center text-sm shadow-md shadow-indigo-500/20">
                POS
              </div>
              <div>
                <h1 className="font-bold text-sm sm:text-base leading-tight text-white flex items-center gap-2">
                  <span>Kasir & Sesi POS</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/20 font-medium">
                    {activeBusiness?.name || 'ShapeUp Store'}
                  </span>
                </h1>
                <p className="text-[11px] text-slate-400 leading-none mt-0.5">
                  Session Hub & Manajemen Transaksi Kasir
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsReceiptSettingsOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition"
              title="Atur Format Struk & Printer"
            >
              <span>🖨️</span>
              <span className="hidden sm:inline">Pengaturan Struk</span>
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Refresh Data"
            >
              <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* HERO CARD: Shift Status & Primary Actions */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm relative overflow-hidden">
          {/* Background Decorative Accent */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-indigo-500/10 via-violet-500/5 to-transparent rounded-full blur-2xl pointer-events-none -mr-20 -mt-20"></div>

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            {/* Left Shift Status Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                {activeShift ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Shift Aktif
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    Sesi Belum Dibuka
                  </span>
                )}
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs text-slate-500 font-medium">
                  Kasir: <strong className="text-slate-800">{userProfile?.full_name || cashierName}</strong>
                </span>
              </div>

              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  {activeShift ? 'Siap Melayani Pelanggan' : 'Buka Shift untuk Memulai Transaksi'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
                  {activeShift
                    ? `Shift dimulai sejak ${formatDisplayDate(activeShift.opened_at, 'datetime', timezone)} dengan modal awal ${formatIDR(activeShift.initial_cash)}. Klik "Lanjut Jualan" untuk membuka register kasir.`
                    : 'Buka sesi kasir baru untuk mencatat modal laci awal dan mengaktifkan pembukuan keuangan register kasir hari ini.'}
                </p>
              </div>
            </div>

            {/* Right Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {activeShift ? (
                <>
                  <button
                    onClick={onOpenWorkspace}
                    className="flex-1 sm:flex-none px-6 py-3.5 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-700 hover:to-violet-800 active:scale-[0.99] text-white font-bold rounded-2xl text-sm transition shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2.5"
                  >
                    <span className="text-lg">🛒</span>
                    <span>Lanjut Jualan (Buka Kasir)</span>
                    <span className="text-xs opacity-80">→</span>
                  </button>
                  <button
                    onClick={() => setIsShiftModalOpen(true)}
                    className="px-4 py-3.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-2xl text-sm transition flex items-center justify-center gap-1.5"
                    title="Tutup Shift & Rekonsiliasi Kas"
                  >
                    <span>🔒</span>
                    <span>Tutup Shift</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsShiftModalOpen(true)}
                    className="flex-1 sm:flex-none px-6 py-3.5 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-700 hover:to-violet-800 active:scale-[0.99] text-white font-bold rounded-2xl text-sm transition shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
                  >
                    <span>🔑</span>
                    <span>Buka Shift Kasir Baru</span>
                  </button>
                  <button
                    onClick={onOpenWorkspace}
                    className="px-4 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-2xl text-sm transition flex items-center justify-center gap-1.5"
                    title="Langsung Buka Kasir tanpa Shift"
                  >
                    <span>🛒</span>
                    <span>Jualan Langsung</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Realtime KPI Cards for Active Shift */}
          {activeShift && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-6 pt-6 border-t border-slate-100">
              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Modal Awal Kas</span>
                <span className="text-lg sm:text-xl font-black text-slate-800 mt-1 block">
                  {formatIDR(activeShift.initial_cash || 0)}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">Saldo laci mula-mula</span>
              </div>

              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100">
                <span className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider block">Omzet Shift Ini</span>
                <span className="text-lg sm:text-xl font-black text-indigo-700 mt-1 block">
                  {formatIDR(shiftMetrics.salesTotal)}
                </span>
                <span className="text-[10px] text-indigo-500/80 mt-0.5 block">Semua metode pembayaran</span>
              </div>

              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100">
                <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Tunai di Laci (Est.)</span>
                <span className="text-lg sm:text-xl font-black text-emerald-700 mt-1 block">
                  {formatIDR(shiftMetrics.expectedDrawerCash)}
                </span>
                <span className="text-[10px] text-emerald-600/80 mt-0.5 block">Modal + {formatIDR(shiftMetrics.cashInTotal)} Tunai</span>
              </div>

              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Transaksi</span>
                <span className="text-lg sm:text-xl font-black text-slate-800 mt-1 block">
                  {shiftMetrics.txCount} Transaksi
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">Selesai pada shift ini</span>
              </div>
            </div>
          )}
        </div>

        {/* ORDER MANAGEMENT SECTION: POS Orders Table */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
          {/* Table Header & Filter Bar */}
          <div className="p-5 sm:p-6 border-b border-slate-100 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                  <span>Riwayat Transaksi Penjualan Kasir</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                    {filteredOrders.length} Order
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Seluruh pesanan yang diproses melalui kasir POS. Klik salah satu order untuk rincian & cetak ulang struk.
                </p>
              </div>

              {/* Shift vs All Filter Switcher */}
              <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200/80 text-xs font-semibold self-start sm:self-auto">
                <button
                  onClick={() => setFilterMode('current_shift')}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    filterMode === 'current_shift'
                      ? 'bg-white text-indigo-700 shadow-sm font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Shift Ini {activeShift ? '🟢' : ''}
                </button>
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    filterMode === 'all'
                      ? 'bg-white text-indigo-700 shadow-sm font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Semua Shift POS
                </button>
              </div>
            </div>

            {/* Filter Inputs: Search & Status Chips */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                <input
                  type="text"
                  placeholder="Cari No. Order (POS-...) atau Nama Pelanggan..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
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
                    className={`px-3 py-1.5 rounded-xl font-medium transition shrink-0 ${
                      statusFilter === st
                        ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {st === 'all' && 'Semua Status'}
                    {st === 'completed' && 'Selesai'}
                    {st === 'cancelled' && 'Dibatalkan / Refund'}
                    {st === 'draft' && 'Draft'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table Body */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-medium">Memuat riwayat transaksi POS...</p>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-2xl mx-auto">
                  🧾
                </div>
                <div>
                  <h4 className="font-bold text-slate-700 text-sm">Belum Ada Transaksi POS</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    {filterMode === 'current_shift' && activeShift
                      ? 'Belum ada transaksi yang diproses pada sesi shift ini. Tekan tombol "Lanjut Jualan" untuk mulai kasir.'
                      : 'Belum ada riwayat pesanan yang cocok dengan kriteria filter pencarian.'}
                  </p>
                </div>
                {activeShift && (
                  <button
                    onClick={onOpenWorkspace}
                    className="mt-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl text-xs transition"
                  >
                    + Buka Register Jualan
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">No. Order / Waktu</th>
                    <th className="py-3 px-4">Pelanggan</th>
                    <th className="py-3 px-4">Item & Qty</th>
                    <th className="py-3 px-4">Total & Metode</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map((order) => {
                    const isCompleted = order.status === 'completed'
                    const isCancelled = order.status === 'cancelled'
                    const itemsCount = (order.items_json || []).length

                    return (
                      <tr
                        key={order.id}
                        onClick={() => {
                          setSelectedOrder(order)
                          setIsOrderDetailOpen(true)
                        }}
                        className="hover:bg-indigo-50/40 transition cursor-pointer group"
                      >
                        {/* Order Number & Timestamp */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition flex items-center gap-1.5">
                            <span>{order.order_number}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {formatDisplayDate(order.created_at, 'datetime', timezone)}
                          </div>
                        </td>

                        {/* Customer */}
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-800">
                            {order.customer?.name || 'Walk-in Customer'}
                          </div>
                          {order.customer?.phone && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              {order.customer.phone}
                            </div>
                          )}
                        </td>

                        {/* Items & Qty */}
                        <td className="py-3.5 px-4 text-slate-600">
                          <span className="font-semibold text-slate-800">{order.total_qty || itemsCount} pcs</span>
                          <span className="text-[11px] text-slate-400 block mt-0.5">
                            {itemsCount > 0 ? `${itemsCount} macam item` : '-'}
                          </span>
                        </td>

                        {/* Grand Total & Payment Method */}
                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-slate-900 text-sm">
                            {formatIDR(order.grand_total)}
                          </div>
                          <div className="mt-0.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                              {String(order.payment_method || '').toLowerCase() === 'cash' ? '💵 Tunai' : /bank|transfer|debit/i.test(order.payment_method || '') ? '💳 Transfer/Debit/QRIS' : '📱 QRIS'}
                            </span>
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 px-4 text-center">
                          {isCompleted ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Selesai
                            </span>
                          ) : isCancelled ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                              Dibatalkan
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              {order.status}
                            </span>
                          )}
                        </td>

                        {/* Action Column */}
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedOrder(order)
                              setIsOrderDetailOpen(true)
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 font-semibold text-xs transition border border-slate-200 hover:border-indigo-200 inline-flex items-center gap-1"
                          >
                            <span>Rincian</span>
                            <span>→</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* MODAL: Shift Modal (Open / Close Shift) */}
      <ShiftModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        activeShift={activeShift}
        cashierName={userProfile?.full_name || cashierName}
        accounts={accounts}
        posRegisters={posRegisters}
        onOpenShift={handleOpenShift}
        onCloseShift={handleCloseShift}
        timezone={timezone}
      />

      {/* MODAL: Receipt Settings */}
      <ReceiptSettingsModal
        isOpen={isReceiptSettingsOpen}
        onClose={() => setIsReceiptSettingsOpen(false)}
        defaultBusinessName={activeBusiness?.name || 'ShapeUp Store'}
      />

      {/* MODAL: Order Detail & Reprint Receipt & Refund */}
      <POSOrderDetailModal
        isOpen={isOrderDetailOpen}
        onClose={() => {
          setIsOrderDetailOpen(false)
          setSelectedOrder(null)
        }}
        order={selectedOrder}
        timezone={timezone}
        businessName={activeBusiness?.name || 'ShapeUp Store'}
        cashierName={userProfile?.full_name || cashierName}
        onRefundSuccess={() => {
          setIsOrderDetailOpen(false)
          loadData()
        }}
      />
    </div>
  )
}
