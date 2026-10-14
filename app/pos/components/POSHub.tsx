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

// Mode Presets: F&B vs Fashion Retail
type IndustryMode = 'fnb' | 'fashion'

// Mock/Interactive Table Model for F&B Demo & Visual Operations
interface TableItem {
  id: string
  name: string
  area: 'indoor' | 'outdoor'
  capacity: number
  status: 'empty' | 'occupied' | 'billing' | 'kitchen'
  guestName?: string
  guestCount?: number
  seatedMinutes?: number
  runningTotal?: number
}

const INITIAL_FNB_TABLES: TableItem[] = [
  { id: 't1', name: 'Meja 01', area: 'indoor', capacity: 2, status: 'empty' },
  { id: 't2', name: 'Meja 02', area: 'indoor', capacity: 4, status: 'occupied', guestName: 'Budi (2 Tamu)', guestCount: 2, seatedMinutes: 18, runningTotal: 85000 },
  { id: 't3', name: 'Meja 03', area: 'indoor', capacity: 4, status: 'billing', guestName: 'Siti & Rekan', guestCount: 4, seatedMinutes: 45, runningTotal: 215000 },
  { id: 't4', name: 'Meja 04', area: 'indoor', capacity: 6, status: 'kitchen', guestName: 'Keluarga Dimas', guestCount: 5, seatedMinutes: 12, runningTotal: 340000 },
  { id: 't5', name: 'Bar 01', area: 'outdoor', capacity: 1, status: 'empty' },
  { id: 't6', name: 'Bar 02', area: 'outdoor', capacity: 1, status: 'occupied', guestName: 'Pak Rian', guestCount: 1, seatedMinutes: 8, runningTotal: 42000 },
  { id: 't7', name: 'Outdoor A', area: 'outdoor', capacity: 4, status: 'empty' },
  { id: 't8', name: 'Outdoor B', area: 'outdoor', capacity: 4, status: 'occupied', guestName: 'Komunitas Gowes', guestCount: 4, seatedMinutes: 32, runningTotal: 168000 }
]

export default function POSHub({ onOpenWorkspace }: Props) {
  const { activeBusiness, userProfile, bizLoading } = useUserContext()
  const timezone = activeBusiness?.timezone

  // State: Industry Mode (F&B vs Fashion Retail)
  const [industryMode, setIndustryMode] = useState<IndustryMode>('fnb')

  // State: Data Core
  const [loading, setLoading] = useState(true)
  const [activeShift, setActiveShift] = useState<any | null>(null)
  const [cashierName, setCashierName] = useState<string>('Kasir')
  const [accounts, setAccounts] = useState<any[]>([])
  const [posRegisters, setPosRegisters] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [monitoredShifts, setMonitoredShifts] = useState<any[]>([])
  const [totalDrawerCash, setTotalDrawerCash] = useState<number>(0)

  // State: F&B Tables
  const [fnbTables, setFnbTables] = useState<TableItem[]>(INITIAL_FNB_TABLES)
  const [fnbAreaFilter, setFnbAreaFilter] = useState<'all' | 'indoor' | 'outdoor'>('all')

  // State: Fashion Quick Barcode & Search
  const [barcodeQuery, setBarcodeQuery] = useState('')
  const [barcodeScanFeedback, setBarcodeScanFeedback] = useState<string | null>(null)

  // State: Modals
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false)
  const [isPettyCashOpen, setIsPettyCashOpen] = useState(false)
  const [pettyCashType, setPettyCashType] = useState<'cash_in' | 'cash_out'>('cash_out')
  const [isReceiptSettingsOpen, setIsReceiptSettingsOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [isOrderDetailOpen, setIsOrderDetailOpen] = useState(false)
  const [quickPrintReceipt, setQuickPrintReceipt] = useState<ReceiptData | null>(null)
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false)

  // State: Filters
  const [filterMode, setFilterMode] = useState<'current_shift' | 'all'>('current_shift')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled' | 'draft'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // State: Collapsible Manager Section
  const [isManagerMonitoringOpen, setIsManagerMonitoringOpen] = useState(false)

  // Load Persisted Industry Mode Preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('shapeup_pos_industry_mode') as IndustryMode | null
      if (savedMode === 'fnb' || savedMode === 'fashion') {
        setIndustryMode(savedMode)
      }
    }
  }, [])

  const handleToggleIndustryMode = (mode: IndustryMode) => {
    setIndustryMode(mode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('shapeup_pos_industry_mode', mode)
    }
  }

  // Format currency IDR
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Load Initial Data (Shift, Accounts, Registers, Orders, Monitoring)
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

  // Filter Orders for stream
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

  // Handle Quick Barcode Search
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!barcodeQuery.trim()) return
    setBarcodeScanFeedback(`Memindai SKU: "${barcodeQuery.trim()}"...`)
    setTimeout(() => {
      setBarcodeScanFeedback(null)
      onOpenWorkspace()
    }, 600)
  }

  // Filtered F&B Tables
  const filteredFnbTables = useMemo(() => {
    if (fnbAreaFilter === 'all') return fnbTables
    return fnbTables.filter((t) => t.area === fnbAreaFilter)
  }, [fnbTables, fnbAreaFilter])

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
                    {activeBusiness?.name || 'ShapeUp Store'}
                  </h1>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase tracking-wider">
                    Terminal 01
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

          {/* Center: Industry Mode Switcher (F&B vs Fashion Retail) */}
          <div className="hidden md:flex items-center p-1 bg-slate-800/90 rounded-2xl border border-slate-700/70 text-xs font-bold shadow-inner">
            <button
              onClick={() => handleToggleIndustryMode('fnb')}
              className={`px-3.5 py-1.5 rounded-xl transition flex items-center gap-2 ${
                industryMode === 'fnb'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>☕</span>
              <span>Mode F&B (Resto / Kafe)</span>
            </button>
            <button
              onClick={() => handleToggleIndustryMode('fashion')}
              className={`px-3.5 py-1.5 rounded-xl transition flex items-center gap-2 ${
                industryMode === 'fashion'
                  ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>👗</span>
              <span>Mode Fashion Retail</span>
            </button>
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
                className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 rounded-xl cursor-pointer transition group"
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
              <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/50 border border-amber-500/30 rounded-xl text-amber-300 text-xs font-bold">
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

        {/* Mobile Industry Mode Switcher Bar */}
        <div className="md:hidden px-4 pb-2.5 pt-0.5 flex gap-2">
          <button
            onClick={() => handleToggleIndustryMode('fnb')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              industryMode === 'fnb'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            <span>☕ F&B Kafe</span>
          </button>
          <button
            onClick={() => handleToggleIndustryMode('fashion')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              industryMode === 'fashion'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            <span>👗 Fashion Retail</span>
          </button>
        </div>
      </header>

      {/* ─── MAIN CONTENT CONTAINER ───────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* ─── ZONA 1: SMART COMMAND DECK (4 PILAR AKSI UTAMA) ──────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* TILE 1: BUKA KASIR PENJUALAN (REGISTER UTAMA) */}
          <div
            onClick={onOpenWorkspace}
            className="group relative bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 hover:from-indigo-700 hover:to-violet-900 rounded-3xl p-5 text-white shadow-lg shadow-indigo-600/20 cursor-pointer transition transform active:scale-[0.99] border border-indigo-400/20 flex flex-col justify-between overflow-hidden min-h-[140px]"
          >
            <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full blur-xl pointer-events-none -mr-8 -mt-8 group-hover:scale-125 transition duration-500"></div>
            <div className="relative z-10 flex items-start justify-between">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-2xl shadow-inner">
                🛒
              </div>
              <span className="px-2.5 py-1 rounded-full bg-white/20 text-[10px] font-black uppercase tracking-wider backdrop-blur-sm">
                0ms Latency
              </span>
            </div>
            <div className="relative z-10 mt-3">
              <h2 className="text-lg font-black tracking-tight flex items-center gap-1.5">
                <span>Buka Register Kasir</span>
                <span className="group-hover:translate-x-1 transition text-white/80">→</span>
              </h2>
              <p className="text-xs text-indigo-100/90 font-medium mt-0.5">
                Mulai transaksi kasir, scan barcode, atau layani antrean
              </p>
            </div>
          </div>

          {/* TILE 2: FITUR DINAMIS SPESIFIK INDUSTRI */}
          {industryMode === 'fnb' ? (
            <div
              onClick={() => {
                // Focus on table section or open register
                const el = document.getElementById('fnb-tables-section')
                if (el) el.scrollIntoView({ behavior: 'smooth' })
              }}
              className="group bg-white hover:bg-slate-50/80 rounded-3xl p-5 text-slate-800 shadow-sm border border-slate-200/90 cursor-pointer transition flex flex-col justify-between min-h-[140px]"
            >
              <div className="flex items-start justify-between">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center text-2xl border border-amber-200/70">
                  🍽️
                </div>
                <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase tracking-wider">
                  Dine-In & Tabs
                </span>
              </div>
              <div className="mt-3">
                <h3 className="text-base font-extrabold text-slate-900 group-hover:text-amber-700 transition flex items-center gap-1.5">
                  <span>Meja & Bon Berjalan</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {fnbTables.filter((t) => t.status !== 'empty').length} Meja Terisi • Makan Dulu Bayar Nanti
                </p>
              </div>
            </div>
          ) : (
            <div
              onClick={onOpenWorkspace}
              className="group bg-white hover:bg-slate-50/80 rounded-3xl p-5 text-slate-800 shadow-sm border border-slate-200/90 cursor-pointer transition flex flex-col justify-between min-h-[140px]"
            >
              <div className="flex items-start justify-between">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center text-2xl border border-rose-200/70">
                  🏷️
                </div>
                <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 text-[10px] font-extrabold uppercase tracking-wider">
                  Exchange Cart
                </span>
              </div>
              <div className="mt-3">
                <h3 className="text-base font-extrabold text-slate-900 group-hover:text-rose-700 transition flex items-center gap-1.5">
                  <span>Tukar Ukuran & Retur</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Proses ganti ukuran baju dalam 1 transaksi seimbang
                </p>
              </div>
            </div>
          )}

          {/* TILE 3: LACI KAS & KAS KECIL (PETTY CASH) */}
          <div className="bg-white rounded-3xl p-5 text-slate-800 shadow-sm border border-slate-200/90 flex flex-col justify-between min-h-[140px]">
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-2xl border border-emerald-200/70">
                💵
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase tracking-wider">
                Petty Cash
              </span>
            </div>
            <div className="mt-2 space-y-2">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Tunai di Laci Kasir
                </span>
                <span className="text-base sm:text-lg font-black text-emerald-700 tabular-nums leading-tight">
                  {formatIDR(shiftMetrics.expectedDrawerCash)}
                </span>
              </div>

              {/* Quick Petty Cash Buttons */}
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                <button
                  onClick={() => {
                    setPettyCashType('cash_in')
                    setIsPettyCashOpen(true)
                  }}
                  disabled={!activeShift}
                  className="py-1 px-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 text-[10px] font-extrabold transition text-center disabled:opacity-40"
                  title="Catat uang masuk modal tambahan"
                >
                  + Kas Masuk
                </button>
                <button
                  onClick={() => {
                    setPettyCashType('cash_out')
                    setIsPettyCashOpen(true)
                  }}
                  disabled={!activeShift}
                  className="py-1 px-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 text-[10px] font-extrabold transition text-center disabled:opacity-40"
                  title="Catat uang keluar es batu/galon/lakban"
                >
                  - Kas Keluar
                </button>
              </div>
            </div>
          </div>

          {/* TILE 4: STATUS SHIFT & Z-REPORT (CLOSE SHIFT) */}
          <div className="bg-white rounded-3xl p-5 text-slate-800 shadow-sm border border-slate-200/90 flex flex-col justify-between min-h-[140px]">
            <div className="flex items-start justify-between">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl border ${
                activeShift
                  ? 'bg-rose-50 text-rose-700 border-rose-200/70'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
              }`}>
                {activeShift ? '🔒' : '🔑'}
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                activeShift
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {activeShift ? 'Shift Aktif' : 'Belum Buka'}
              </span>
            </div>
            <div className="mt-3">
              <h3 className="text-base font-extrabold text-slate-900">
                {activeShift ? 'Sesi Kasir Berjalan' : 'Shift Kasir Ditutup'}
              </h3>
              <div className="mt-2">
                {activeShift ? (
                  <button
                    onClick={() => setIsShiftModalOpen(true)}
                    className="w-full py-1.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition flex items-center justify-center gap-1.5"
                  >
                    <span>🔒 Tutup Shift & Z-Report</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setIsShiftModalOpen(true)}
                    className="w-full py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-600/20"
                  >
                    <span>🔑 Buka Shift Baru</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ─── ZONA 2: REALTIME OPERATIONAL KPI METRICS ─────────────────────── */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs">
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
                Semua metode (Tunai + QRIS + EDC)
              </span>
            </div>

            {/* KPI 2: Total Transaksi Selesai */}
            <div className="pt-2 lg:pt-0 lg:px-4">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Pesanan Sukses
              </span>
              <span className="text-xl sm:text-2xl font-black text-slate-800 mt-1 block tabular-nums">
                {shiftMetrics.txCount} Transaksi
              </span>
              <span className="text-[11px] text-emerald-600 font-bold mt-0.5 block flex items-center gap-1">
                <span>🟢 Kasir Aktif Standby</span>
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
                Rata-Rata Bon (AOV)
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

        {/* ─── ZONA 3: SPLIT VIEW INTERAKTIF (MODE WORKSPACE & RECENT FEED) ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* SISI KIRI (7/12): MODE-SPECIFIC OPERATIONAL WORKSPACE */}
          <div className="lg:col-span-7 space-y-4">
            {/* MODE F&B: VISUAL FLOOR PLAN & OPEN TABS */}
            {industryMode === 'fnb' && (
              <div id="fnb-tables-section" className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
                {/* Header Meja & Area Filter */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-extrabold text-base sm:text-lg text-slate-900 flex items-center gap-2">
                      <span>Denah Meja & Pesanan Aktif (Floor Plan)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Klik meja untuk melihat tagihan berjalan atau buka pesanan baru
                    </p>
                  </div>

                  {/* Area Filter Buttons */}
                  <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200/80 text-xs font-bold self-start sm:self-auto">
                    {(['all', 'indoor', 'outdoor'] as const).map((area) => (
                      <button
                        key={area}
                        onClick={() => setFnbAreaFilter(area)}
                        className={`px-3 py-1.5 rounded-lg transition capitalize ${
                          fnbAreaFilter === area
                            ? 'bg-white text-indigo-700 shadow-sm font-black'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {area === 'all' ? 'Semua Meja' : area}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grid Visual Meja */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {filteredFnbTables.map((tbl) => {
                    const isEmpty = tbl.status === 'empty'
                    const isBilling = tbl.status === 'billing'
                    const isKitchen = tbl.status === 'kitchen'
                    const isOccupied = tbl.status === 'occupied'

                    return (
                      <div
                        key={tbl.id}
                        onClick={() => {
                          // Jump straight to POS Workspace for this table
                          onOpenWorkspace()
                        }}
                        className={`rounded-2xl p-3.5 border transition cursor-pointer flex flex-col justify-between min-h-[110px] group ${
                          isEmpty
                            ? 'bg-slate-50/70 hover:bg-emerald-50/60 border-slate-200 hover:border-emerald-300'
                            : isBilling
                            ? 'bg-amber-50/70 hover:bg-amber-100/70 border-amber-300 ring-2 ring-amber-400/20'
                            : isKitchen
                            ? 'bg-purple-50/70 hover:bg-purple-100/70 border-purple-300 ring-2 ring-purple-400/20'
                            : 'bg-indigo-50/60 hover:bg-indigo-100/60 border-indigo-200 ring-2 ring-indigo-500/10'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="font-black text-sm text-slate-900 block group-hover:text-indigo-600 transition">
                              {tbl.name}
                            </span>
                            <span className="text-[10px] text-slate-400 block capitalize">
                              {tbl.area} • {tbl.capacity} Kursi
                            </span>
                          </div>

                          <span className={`w-2.5 h-2.5 rounded-full ${
                            isEmpty
                              ? 'bg-slate-300'
                              : isBilling
                              ? 'bg-amber-500 animate-pulse'
                              : isKitchen
                              ? 'bg-purple-500 animate-bounce'
                              : 'bg-indigo-600'
                          }`}></span>
                        </div>

                        <div className="mt-2 pt-2 border-t border-slate-200/50">
                          {isEmpty ? (
                            <span className="text-[10px] font-bold text-slate-400 group-hover:text-emerald-700 transition">
                              + Buka Meja
                            </span>
                          ) : (
                            <div>
                              <div className="flex items-center justify-between text-[11px] font-black text-slate-800">
                                <span className="truncate max-w-[80px]">{tbl.guestName}</span>
                                <span>{formatIDR(tbl.runningTotal || 0)}</span>
                              </div>
                              <span className={`text-[9px] font-extrabold uppercase block mt-0.5 ${
                                isBilling ? 'text-amber-700' : isKitchen ? 'text-purple-700' : 'text-indigo-700'
                              }`}>
                                {isBilling ? '🧾 Minta Bon' : isKitchen ? '🔥 Dimasak Dapur' : `🍽️ Duduk ${tbl.seatedMinutes}m`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Legend Status Meja */}
                <div className="pt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-500 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
                    <span>Kosong</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                    <span>Sedang Makan</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                    <span>Menunggu Dapur</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <span>Minta Bon (Billing)</span>
                  </div>
                </div>
              </div>
            )}

            {/* MODE FASHION: FAST BARCODE SCANNER, SIZING MATRIX, & SPG LEADERBOARD */}
            {industryMode === 'fashion' && (
              <div className="space-y-4">
                {/* 1. FAST BARCODE SCAN STRIP */}
                <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                        <span>Pemindai Barcode Cepat (Barcode Gun Ready)</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Tembakkan scanner barcode atau ketik SKU pakaian untuk langsung membuka transaksi
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-black uppercase">
                      Instant Scan
                    </span>
                  </div>

                  <form onSubmit={handleBarcodeSubmit} className="flex gap-2 pt-1">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm">
                        🏷️
                      </span>
                      <input
                        type="text"
                        placeholder="Scan atau ketik SKU / Barcode (cth: TSHIRT-BLK-L)..."
                        value={barcodeQuery}
                        onChange={(e) => setBarcodeQuery(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm font-bold text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-2xl text-xs sm:text-sm transition shadow-sm shadow-indigo-600/20 shrink-0"
                    >
                      Scan Barang →
                    </button>
                  </form>

                  {barcodeScanFeedback && (
                    <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-700 animate-pulse">
                      ⚡ {barcodeScanFeedback}
                    </div>
                  )}
                </div>

                {/* 2. SIZING MATRIX PREVIEW & SPG LEADERBOARD */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Quick Sizing Matrix Tile */}
                  <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-3">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                      Matriks Varian Busana (Size x Color)
                    </span>
                    <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
                      {['XS', 'S', 'M', 'L', 'XL'].map((sz) => (
                        <div key={sz} className="p-2 bg-slate-50 border border-slate-200/80 rounded-xl">
                          <span className="font-black text-slate-800 block">{sz}</span>
                          <span className="text-[9px] text-emerald-600 font-bold block mt-0.5">Ready</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      Pilihan ukuran & warna terintegrasi langsung pada modal varian di kasir utama.
                    </p>
                  </div>

                  {/* SPG / Pramuniaga Leaderboard */}
                  <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                        Performa SPG Shift Ini
                      </span>
                      <span className="text-[10px] font-bold text-indigo-600">Komisi Aktif</span>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between items-center p-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span className="font-extrabold text-slate-800">1. Rina (SPG-01)</span>
                        <span className="font-black text-indigo-700">Rp 1.450.000 (12 item)</span>
                      </div>
                      <div className="flex justify-between items-center p-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span className="font-extrabold text-slate-800">2. Dimas (Pramuniaga)</span>
                        <span className="font-black text-slate-700">Rp 980.000 (8 item)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SISI KANAN (5/12): TACTILE RECENT TRANSACTIONS STREAM */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col">
            {/* Stream Header & Filters */}
            <div className="p-5 border-b border-slate-100 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-1.5">
                    <span>Transaksi Terkini</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
                      {filteredOrders.length}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Daftar struk transaksi kasir POS
                  </p>
                </div>

                {/* Filter Mode Switcher */}
                <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200 text-xs font-bold">
                  <button
                    onClick={() => setFilterMode('current_shift')}
                    className={`px-2.5 py-1 rounded-lg transition text-[11px] ${
                      filterMode === 'current_shift'
                        ? 'bg-white text-indigo-700 shadow-sm font-black'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Shift Ini
                  </button>
                  <button
                    onClick={() => setFilterMode('all')}
                    className={`px-2.5 py-1 rounded-lg transition text-[11px] ${
                      filterMode === 'all'
                        ? 'bg-white text-indigo-700 shadow-sm font-black'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Semua
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                <input
                  type="text"
                  placeholder="Cari No. Order / Nama Pelanggan..."
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
            </div>

            {/* Stream Body: Modern Card Stream */}
            <div className="p-4 space-y-2.5 max-h-[580px] overflow-y-auto divide-y divide-slate-100/80">
              {loading ? (
                <div className="py-16 text-center text-slate-400 space-y-2">
                  <div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs font-semibold">Memuat transaksi kasir...</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="py-16 text-center text-slate-400 space-y-2">
                  <span className="text-3xl block">🧾</span>
                  <p className="text-xs font-bold text-slate-700">Belum Ada Transaksi</p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    {filterMode === 'current_shift' && activeShift
                      ? 'Belum ada transaksi di shift ini. Tekan tombol "Buka Register Kasir" untuk memulai.'
                      : 'Tidak ada transaksi yang cocok dengan filter pencarian.'}
                  </p>
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
                      <div className="p-3.5 rounded-2xl border border-slate-200/70 hover:border-indigo-400 hover:bg-indigo-50/30 transition flex items-center justify-between gap-3">
                        {/* Left: Info Order */}
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 text-xs group-hover:text-indigo-600 transition truncate">
                              {order.order_number}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                              isCompleted
                                ? 'bg-emerald-100 text-emerald-800'
                                : isCancelled
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {isCompleted ? 'Selesai' : isCancelled ? 'Batal' : 'Draft'}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 truncate">
                            <span className="font-semibold text-slate-700">
                              {order.customer?.name || 'Walk-in'}
                            </span>
                            <span>•</span>
                            <span>{itemsCount} Item</span>
                            <span>•</span>
                            <span>{formatDisplayDate(order.created_at, 'time', timezone)}</span>
                          </div>
                        </div>

                        {/* Right: Total Price & Quick Action */}
                        <div className="text-right shrink-0 flex items-center gap-2.5">
                          <div>
                            <div className="font-black text-slate-900 text-xs sm:text-sm tabular-nums">
                              {formatIDR(order.grand_total)}
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 flex items-center justify-end gap-1">
                              {methodStr.includes('cash') ? '💵 Tunai' : methodStr.includes('qris') ? '📱 QRIS' : '💳 Kartu'}
                            </span>
                          </div>

                          {/* Quick 1-Tap Reprint Button */}
                          <button
                            onClick={(e) => handleDirectPrintOrder(order, e)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-600 flex items-center justify-center text-xs transition shadow-xs"
                            title="Cetak Ulang Struk Cepat"
                          >
                            🖨️
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* ─── ZONA 4: COLLAPSIBLE MANAGER ONLY MONITORING ──────────────────── */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
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
          industryMode={industryMode}
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
