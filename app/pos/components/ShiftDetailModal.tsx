"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { formatDisplayDate } from '@/lib/timeUtils'
import { ReceiptData } from '@/lib/pos/printerAdapter'

type Props = {
  isOpen: boolean
  onClose: () => void
  shiftId: string | null
  timezone?: string
  businessName?: string
  onReprintOrder?: (order: any) => void
  onOpenOrderDetail?: (order: any) => void
  onReprintZReport?: (receipt: ReceiptData) => void
  onShiftUpdated?: () => void
}

export default function ShiftDetailModal({
  isOpen,
  onClose,
  shiftId,
  timezone,
  businessName = 'ShapeUp Store',
  onReprintOrder,
  onOpenOrderDetail,
  onReprintZReport,
  onShiftUpdated
}: Props) {
  const [loading, setLoading] = useState<boolean>(true)
  const [shift, setShift] = useState<any | null>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [movements, setMovements] = useState<any[]>([])
  const [tenderBreakdown, setTenderBreakdown] = useState<any>({
    cash: { amount: 0, count: 0 },
    qris: { amount: 0, count: 0 },
    card: { amount: 0, count: 0 },
    other: { amount: 0, count: 0 }
  })
  const [activeTab, setActiveTab] = useState<'zreport' | 'orders' | 'movements'>('zreport')
  const [orderSearch, setOrderSearch] = useState<string>('')

  // Void Modal State
  const [movementToVoid, setMovementToVoid] = useState<any | null>(null)
  const [voidReason, setVoidReason] = useState<string>('')
  const [approvers, setApprovers] = useState<any[]>([])
  const [selectedApproverId, setSelectedApproverId] = useState<string>('')
  const [approverPin, setApproverPin] = useState<string>('')
  const [showPin, setShowPin] = useState<boolean>(false)
  const [voidSubmitting, setVoidSubmitting] = useState<boolean>(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  // Format IDR
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Fetch Shift Details
  const fetchShiftDetails = useCallback(async () => {
    if (!shiftId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/pos/shifts?mode=shift_details&shift_id=${shiftId}`)
      const data = await res.json()
      if (data.success) {
        setShift(data.shift)
        setOrders(data.orders || [])
        setMovements(data.movements || [])
        if (data.tenderBreakdown) {
          setTenderBreakdown(data.tenderBreakdown)
        }
      }
    } catch (err) {
      console.error('Error loading shift details:', err)
    } finally {
      setLoading(false)
    }
  }, [shiftId])

  useEffect(() => {
    if (isOpen && shiftId) {
      fetchShiftDetails()
    }
  }, [isOpen, shiftId, fetchShiftDetails])

  // Load Approvers in case approval PIN is needed
  useEffect(() => {
    if (!isOpen) return
    fetch('/api/pos/price-authorizations')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.approvers && data.approvers.length > 0) {
          const validApprovers = data.approvers.filter((a: any) => a.has_pin)
          setApprovers(validApprovers)
          if (validApprovers.length > 0) {
            setSelectedApproverId(validApprovers[0].id)
          }
        }
      })
      .catch(() => {})
  }, [isOpen])

  // Filtered Orders inside this shift
  const filteredOrders = useMemo(() => {
    if (!orderSearch.trim()) return orders
    const q = orderSearch.toLowerCase()
    return orders.filter((o) => {
      const matchNo = o.order_number?.toLowerCase().includes(q)
      const matchCust = (o.customer?.name || (Array.isArray(o.customer) ? o.customer[0]?.name : ''))?.toLowerCase().includes(q)
      return matchNo || matchCust
    })
  }, [orders, orderSearch])

  // Cash Calculation Metrics (Excluding Voided Movements)
  const cashMetrics = useMemo(() => {
    if (!shift) {
      return {
        initialCash: 0,
        cashSales: 0,
        cashArCollections: 0,
        cashRefunds: 0,
        cashIn: 0,
        cashOut: 0,
        expectedCash: 0,
        actualCash: 0,
        difference: 0,
        totalSales: 0,
        voidedCount: 0,
        voidedTotal: 0
      }
    }

    const initialCash = Number(shift.initial_cash || 0)
    const tb: any = tenderBreakdown || {}
    const cashSales = Number(tb.cash_sales ?? (tb.cash?.amount || 0))
    const cashArCollections = Number(tb.cash_ar_collections || 0)
    const cashRefunds = Number(tb.cash_refunds || 0)

    let cashIn = 0
    let cashOut = 0
    let voidedCount = 0
    let voidedTotal = 0

    movements.forEach((m) => {
      const isVoided = m.status === 'voided' || (typeof m.note === 'string' && m.note.startsWith('[VOID'))
      const amt = Number(m.amount) || 0

      if (isVoided) {
        voidedCount += 1
        voidedTotal += amt
        return
      }

      if (m.type === 'cash_in') cashIn += amt
      else if (m.type === 'cash_out') cashOut += amt
    })

    const expectedCash = Number(shift.expected_cash || (initialCash + cashSales + cashArCollections - cashRefunds + cashIn - cashOut))
    const actualCash = Number(shift.actual_cash || 0)
    const difference = shift.difference !== undefined && shift.difference !== null
      ? Number(shift.difference)
      : (shift.status === 'closed' ? actualCash - expectedCash : 0)

    const totalSales = orders
      .filter((o) => o.status === 'completed' && !o.is_cross_shift)
      .reduce((sum, o) => sum + Number(o.grand_total || 0), 0)

    return {
      initialCash,
      cashSales,
      cashArCollections,
      cashRefunds,
      cashIn,
      cashOut,
      expectedCash,
      actualCash,
      difference,
      totalSales,
      voidedCount,
      voidedTotal
    }
  }, [shift, tenderBreakdown, movements, orders])

  // Handler: Build and Print Z-Report (with Compact Audit Note for voids)
  const handlePrintZReport = () => {
    if (!shift) return

    const zReceipt: ReceiptData = {
      businessName: businessName,
      orderNumber: `Z-REPORT-${shift.id.slice(0, 8).toUpperCase()}`,
      date: formatDisplayDate(shift.closed_at || new Date(), 'receipt', timezone),
      cashierName: shift.cashier_name || 'Kasir',
      customerName: 'LAPORAN REKONSILIASI KASIR',
      items: [
        {
          name: 'Modal Awal Kas Laci',
          quantity: 1,
          price: cashMetrics.initialCash,
          subtotal: cashMetrics.initialCash
        },
        {
          name: 'Penjualan Tunai (+)',
          quantity: tenderBreakdown.cash.count || 0,
          price: cashMetrics.cashSales,
          subtotal: cashMetrics.cashSales
        },
        ...(cashMetrics.cashArCollections > 0 ? [{
          name: 'Pelunasan Piutang (+)',
          quantity: 1,
          price: cashMetrics.cashArCollections,
          subtotal: cashMetrics.cashArCollections
        }] : []),
        ...(cashMetrics.cashRefunds > 0 ? [{
          name: 'Refund Kasir Keluar (-)',
          quantity: 1,
          price: -cashMetrics.cashRefunds,
          subtotal: -cashMetrics.cashRefunds
        }] : []),
        {
          name: 'Penjualan QRIS (+)',
          quantity: tenderBreakdown.qris.count || 0,
          price: tenderBreakdown.qris.amount,
          subtotal: tenderBreakdown.qris.amount
        },
        {
          name: 'Penjualan EDC/Kartu (+)',
          quantity: tenderBreakdown.card.count || 0,
          price: tenderBreakdown.card.amount,
          subtotal: tenderBreakdown.card.amount
        },
        {
          name: 'Petty Cash Masuk (+)',
          quantity: 1,
          price: cashMetrics.cashIn,
          subtotal: cashMetrics.cashIn
        },
        {
          name: 'Petty Cash Keluar (-)',
          quantity: 1,
          price: -cashMetrics.cashOut,
          subtotal: -cashMetrics.cashOut
        },
        ...(cashMetrics.voidedCount > 0 ? [{
          name: `*Catatan: ${cashMetrics.voidedCount} mutasi di-void (${formatIDR(cashMetrics.voidedTotal)})`,
          quantity: cashMetrics.voidedCount,
          price: 0,
          subtotal: 0
        }] : [])
      ],
      subtotal: cashMetrics.totalSales,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: cashMetrics.expectedCash,
      paymentMethod: 'REKONSILIASI',
      cashReceived: isClosed ? cashMetrics.actualCash : cashMetrics.expectedCash,
      changeAmount: 0
    }

    if (onReprintZReport) {
      onReprintZReport(zReceipt)
    }
  }

  // Handler: Confirm Void POS Movement
  const handleConfirmVoid = async () => {
    if (!movementToVoid) return
    setVoidError(null)

    const cleanReason = voidReason.trim()
    if (!cleanReason || cleanReason.length < 5) {
      setVoidError('Alasan pembatalan (void) wajib diisi minimal 5 karakter.')
      return
    }

    if (approvers.length > 0 && (!selectedApproverId || approverPin.length !== 6)) {
      setVoidError('Otorisasi Manajer diperlukan. Pilih approver dan masukkan 6 digit PIN.')
      return
    }

    setVoidSubmitting(true)
    try {
      const res = await fetch('/api/pos/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'void_cash_movement',
          movement_id: movementToVoid.id,
          void_reason: cleanReason,
          approver_id: approvers.length > 0 ? selectedApproverId : undefined,
          approver_pin: approvers.length > 0 ? approverPin : undefined
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membatalkan mutasi kas')
      }

      setMovementToVoid(null)
      setVoidReason('')
      setApproverPin('')
      await fetchShiftDetails()
      if (onShiftUpdated) onShiftUpdated()
    } catch (err: any) {
      setVoidError(err.message || 'Terjadi kesalahan saat membatalkan mutasi kas')
    } finally {
      setVoidSubmitting(false)
    }
  }

  const isClosed = shift?.status === 'closed'

  return (
    <FullScreenModal
      isOpen={isOpen && Boolean(shiftId)}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black shadow-xs ${
            isClosed ? 'bg-slate-800 text-white' : 'bg-emerald-600 text-white'
          }`}>
            {isClosed ? '🔒' : '🟢'}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-base leading-tight">
              {shift ? `Sesi Shift #${shift.id.slice(0, 8).toUpperCase()}` : 'Memuat Sesi Shift...'}
            </span>
            {shift && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                isClosed ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {isClosed ? 'Shift Selesai' : 'Sedang Aktif'}
              </span>
            )}
          </div>
        </div>
      }
      description={
        shift
          ? `Kasir: ${shift.cashier_name || 'Kasir'} • Buka: ${formatDisplayDate(shift.opened_at, 'datetime', timezone)}${
              shift.closed_at ? ` • Tutup: ${formatDisplayDate(shift.closed_at, 'datetime', timezone)}` : ''
            }`
          : undefined
      }
      desktopSize="xl"
      footer={
        <div className="flex items-center justify-between w-full flex-wrap gap-2">
          <div>
            {shift && (
              <button
                type="button"
                onClick={handlePrintZReport}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition shadow-md flex items-center gap-1.5"
                title="Cetak Ringkasan Laporan Z-Report ke Printer Thermal"
              >
                <span>🖨️ Cetak Struk Z-Report</span>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-extrabold text-xs transition"
          >
            Tutup
          </button>
        </div>
      }
    >
      <div className="space-y-5 text-xs">
        {/* ─── TABS HEADER ──────────────────────────────────────────────────── */}
        <div className="border-b border-slate-200 bg-white flex items-center gap-2 overflow-x-auto font-bold -mt-2">
          <button
            type="button"
            onClick={() => setActiveTab('zreport')}
            className={`pb-3 px-3 transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'zreport'
                ? 'border-indigo-600 text-indigo-700 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📊</span>
            <span>Rekonsiliasi Kas & Z-Report</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`pb-3 px-3 transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'orders'
                ? 'border-indigo-600 text-indigo-700 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>🧾</span>
            <span>Transaksi Sesi Ini ({orders.length} Nota)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('movements')}
            className={`pb-3 px-3 transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'movements'
                ? 'border-indigo-600 text-indigo-700 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>💸</span>
            <span>Log Mutasi Kas ({movements.length} Log)</span>
          </button>
        </div>

        {/* ─── TAB CONTENT ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className="py-24 text-center text-slate-400 space-y-3">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold">Memuat rincian sesi shift...</p>
          </div>
        ) : !shift ? (
          <div className="py-24 text-center text-slate-400 space-y-2">
            <span className="text-3xl block">⚠️</span>
            <p className="text-sm font-bold text-slate-700">Data shift tidak ditemukan</p>
          </div>
        ) : (
          <>
            {/* TAB 1: Z-REPORT & CASH RECONCILIATION */}
            {activeTab === 'zreport' && (
              <div className="space-y-5">
                {/* Status Selisih Banner */}
                <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
                  cashMetrics.difference === 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : cashMetrics.difference < 0
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">
                      {cashMetrics.difference === 0 ? '🟢' : cashMetrics.difference < 0 ? '🔴' : '🟡'}
                    </span>
                    <div>
                      <h4 className="font-black text-sm">
                        {isClosed
                          ? cashMetrics.difference === 0
                            ? 'Laci Kas Klop Sempurna (Rp 0)'
                            : cashMetrics.difference < 0
                            ? `Selisih Kurang (Minus ${formatIDR(Math.abs(cashMetrics.difference))})`
                            : `Selisih Lebih (Plus ${formatIDR(cashMetrics.difference)})`
                          : 'Sesi Masih Berjalan (Live Monitoring)'}
                      </h4>
                      <p className="text-xs opacity-80 mt-0.5">
                        {isClosed
                          ? `Saldo kas fisik akhir ${formatIDR(cashMetrics.actualCash)} vs saldo ekspektasi sistem ${formatIDR(cashMetrics.expectedCash)}.`
                          : `Total uang tunai di laci kas saat ini diperkirakan ${formatIDR(cashMetrics.expectedCash)}.`}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[10px] uppercase tracking-wider font-extrabold opacity-75 block">Status Audit</span>
                    <span className="text-sm font-black">
                      {isClosed
                        ? cashMetrics.difference === 0 ? 'KLOP' : cashMetrics.difference < 0 ? 'DEFISIT' : 'SURPLUS'
                        : 'STANDBY'}
                    </span>
                  </div>
                </div>

                {/* 2 Kolom Grid: Kas Fisik vs Breakdown Tender */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Kolom Kiri: Arus Kas Laci */}
                  <div className="bg-slate-50/80 rounded-2xl p-5 border border-slate-200/80 space-y-3">
                    <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200/60 pb-2">
                      Arus Kas Laci (Drawer Flow)
                    </h4>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-slate-700">
                        <span>Modal Awal Kasir:</span>
                        <span className="font-bold tabular-nums">{formatIDR(cashMetrics.initialCash)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-700">
                        <span>Penjualan Tunai (+):</span>
                        <span className="font-bold tabular-nums">+{formatIDR(cashMetrics.cashSales)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-700">
                        <span>Kas Masuk Petty Cash (+):</span>
                        <span className="font-bold tabular-nums">+{formatIDR(cashMetrics.cashIn)}</span>
                      </div>
                      <div className="flex justify-between text-rose-600">
                        <span>Kas Keluar Petty Cash (-):</span>
                        <span className="font-bold tabular-nums">-{formatIDR(cashMetrics.cashOut)}</span>
                      </div>

                      <div className="pt-2 border-t border-slate-200/80 flex justify-between font-black text-slate-900 text-sm">
                        <span>Saldo Diharapkan (Expected):</span>
                        <span className="tabular-nums">{formatIDR(cashMetrics.expectedCash)}</span>
                      </div>

                      {isClosed && (
                        <div className="flex justify-between font-black text-emerald-700 text-sm">
                          <span>Uang Fisik Dihitung (Actual):</span>
                          <span className="tabular-nums">{formatIDR(cashMetrics.actualCash)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Kolom Kanan: Breakdown Metode Bayar (Tender) */}
                  <div className="bg-slate-50/80 rounded-2xl p-5 border border-slate-200/80 space-y-3">
                    <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200/60 pb-2">
                      Rincian Penjualan per Metode Bayar
                    </h4>

                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-100">
                        <div className="flex items-center gap-2">
                          <span>💵</span>
                          <span className="font-bold text-slate-700">Tunai (Cash)</span>
                          <span className="text-[10px] text-slate-400">({tenderBreakdown.cash.count} nota)</span>
                        </div>
                        <span className="font-black text-slate-900 tabular-nums">{formatIDR(tenderBreakdown.cash.amount)}</span>
                      </div>

                      <div className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-100">
                        <div className="flex items-center gap-2">
                          <span>📱</span>
                          <span className="font-bold text-slate-700">QRIS Dinamis / Statis</span>
                          <span className="text-[10px] text-slate-400">({tenderBreakdown.qris.count} nota)</span>
                        </div>
                        <span className="font-black text-slate-900 tabular-nums">{formatIDR(tenderBreakdown.qris.amount)}</span>
                      </div>

                      <div className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-100">
                        <div className="flex items-center gap-2">
                          <span>💳</span>
                          <span className="font-bold text-slate-700">EDC / Kartu / Transfer</span>
                          <span className="text-[10px] text-slate-400">({tenderBreakdown.card.count} nota)</span>
                        </div>
                        <span className="font-black text-slate-900 tabular-nums">{formatIDR(tenderBreakdown.card.amount)}</span>
                      </div>

                      <div className="pt-2 border-t border-slate-200/80 flex justify-between font-black text-indigo-700 text-sm">
                        <span>Total Omzet Shift Ini:</span>
                        <span className="tabular-nums">{formatIDR(cashMetrics.totalSales)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Note info if any */}
                {shift.note && (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-600">
                    <strong className="text-slate-800">Catatan Penutupan Kasir:</strong> &ldquo;{shift.note}&rdquo;
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: ENCAPSULATED ORDERS LIST */}
            {activeTab === 'orders' && (
              <div className="space-y-4">
                {/* Search bar inside shift */}
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                  <input
                    type="text"
                    placeholder="Cari nota di shift ini (No. Order / Nama Pelanggan)..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  />
                  {orderSearch && (
                    <button
                      type="button"
                      onClick={() => setOrderSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Orders List */}
                {filteredOrders.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 space-y-2">
                    <span className="text-3xl block">🧾</span>
                    <p className="text-xs font-bold text-slate-700">Tidak Ada Transaksi</p>
                    <p className="text-[11px] text-slate-400">
                      {orderSearch ? 'Tidak ada nota yang cocok dengan kata kunci pencarian.' : 'Belum ada transaksi pada sesi shift ini.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-y-auto divide-y divide-slate-100">
                    {filteredOrders.map((ord) => {
                      const isCompleted = ord.status === 'completed'
                      const isCancelled = ord.status === 'cancelled'
                      const parsedItems = Array.isArray(ord.items_json)
                        ? ord.items_json
                        : typeof ord.items_json === 'string'
                        ? (() => { try { const p = JSON.parse(ord.items_json); return Array.isArray(p) ? p : [] } catch { return [] } })()
                        : []
                      const itemsCount = parsedItems.length || ord.total_qty || 1
                      const methodStr = String(ord.payment_method || 'cash').toLowerCase()

                      return (
                        <div
                          key={ord.id}
                          onClick={() => onOpenOrderDetail && onOpenOrderDetail(ord)}
                          className="pt-2 first:pt-0 group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border border-slate-200/70 hover:border-indigo-400 hover:bg-indigo-50/20 transition cursor-pointer"
                          title="Klik untuk membuka rincian pesanan & mutasi pembayaran"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-slate-900 text-xs group-hover:text-indigo-600 transition">
                                #{ord.order_number}
                              </span>
                              {ord.is_cross_shift ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-purple-100 text-purple-800 border border-purple-200">
                                  Pelunasan Piutang
                                </span>
                              ) : (
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                  isCompleted ? 'bg-emerald-100 text-emerald-800' : isCancelled ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {isCompleted ? 'Selesai' : isCancelled ? 'Batal' : 'Draft'}
                                </span>
                              )}
                              <span className="text-slate-300 text-xs">•</span>
                              <span className="text-xs text-slate-500 font-medium">
                                {formatDisplayDate(ord.created_at, 'time', timezone)}
                              </span>
                            </div>

                            <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
                              <span className="font-bold text-slate-700">
                                👤 {ord.customer?.name || (Array.isArray(ord.customer) ? ord.customer[0]?.name : 'Pelanggan Walk-in')}
                              </span>
                              <span>•</span>
                              <span>{itemsCount} Item Produk</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100">
                            <div className="text-left sm:text-right">
                              <div className={`font-black text-xs sm:text-sm tabular-nums ${ord.is_cross_shift ? 'text-purple-700' : 'text-slate-900'}`}>
                                {ord.is_cross_shift
                                  ? `+${formatIDR(ord.shift_net_tender || ord.amount_paid)}`
                                  : formatIDR(ord.grand_total)}
                              </div>
                              <span className="text-[10px] font-bold text-slate-400">
                                {ord.is_cross_shift
                                  ? 'Diterima di Shift Ini'
                                  : (methodStr.includes('cash') ? '💵 Tunai' : methodStr.includes('qris') ? '📱 QRIS' : '💳 Kartu')}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {onReprintOrder && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onReprintOrder(ord)
                                  }}
                                  className="p-2 rounded-xl bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-700 text-xs font-bold transition shadow-xs"
                                  title="Cetak Ulang Struk Nota"
                                >
                                  🖨️
                                </button>
                              )}
                              {onOpenOrderDetail && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onOpenOrderDetail(ord)
                                  }}
                                  className="p-2 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 text-xs font-bold transition border border-transparent hover:border-indigo-200"
                                  title="Lihat Detail Pesanan"
                                >
                                  🔍
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PETTY CASH LOGS */}
            {activeTab === 'movements' && (
              <div className="space-y-3">
                {movements.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 space-y-2">
                    <span className="text-3xl block">💸</span>
                    <p className="text-xs font-bold text-slate-700">Tidak Ada Mutasi Kas Kecil</p>
                    <p className="text-[11px] text-slate-400">Tidak ada pencatatan kas masuk atau kas keluar petty cash pada sesi shift ini.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {movements.map((mov) => {
                      const isVoided = mov.status === 'voided' || (typeof mov.note === 'string' && mov.note.startsWith('[VOID'))
                      const isCashIn = mov.type === 'cash_in'
                      const canVoid = shift?.status === 'open' && !isVoided

                      // Clean note preview
                      const cleanNote = (mov.note || (isCashIn ? 'Kas Masuk Laci' : 'Kas Keluar Operasional')).replace(/^\[VOID:[^\]]+\]\s*/i, '').trim()
                      const voidReasonText = mov.void_reason || (typeof mov.note === 'string' && mov.note.match(/^\[VOID:\s*([^\]]+)\]/i)?.[1])

                      return (
                        <div
                          key={mov.id}
                          className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 text-xs ${
                            isVoided
                              ? 'border-slate-200/70 bg-slate-100/50 opacity-70'
                              : 'border-slate-200/80 bg-slate-50/60'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                              isVoided
                                ? 'bg-slate-200 text-slate-500'
                                : isCashIn
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-rose-100 text-rose-700'
                            }`}>
                              {isVoided ? '🚫' : isCashIn ? '🔺' : '🔻'}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`font-extrabold truncate ${
                                  isVoided ? 'line-through text-slate-500' : 'text-slate-900'
                                }`}>
                                  {cleanNote}
                                </span>
                                {isVoided && (
                                  <span className="text-[9px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-md border border-rose-200">
                                    VOID
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-400 block mt-0.5">
                                Waktu: {formatDisplayDate(mov.created_at, 'time', timezone)}
                              </span>
                              {isVoided && voidReasonText && (
                                <span className="text-[10px] text-rose-600/90 font-medium block mt-0.5 italic">
                                  Alasan Void: {voidReasonText}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0 flex items-center gap-3">
                            <div>
                              <span className={`font-black text-sm tabular-nums block ${
                                isVoided
                                  ? 'line-through text-slate-400'
                                  : isCashIn
                                  ? 'text-emerald-700'
                                  : 'text-rose-600'
                              }`}>
                                {isCashIn ? '+' : '-'}{formatIDR(mov.amount)}
                              </span>
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold mt-0.5">
                                {isCashIn ? 'Kas Masuk' : 'Petty Cash'}
                              </span>
                            </div>

                            {/* Tombol Void Mutasi untuk Shift Aktif */}
                            {canVoid && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMovementToVoid(mov)
                                  setVoidReason('')
                                  setApproverPin('')
                                  setVoidError(null)
                                }}
                                className="px-2.5 py-1.5 rounded-xl bg-slate-200/70 hover:bg-rose-50 text-slate-600 hover:text-rose-700 hover:border-rose-200 border border-transparent font-bold text-[11px] transition shadow-2xs flex items-center gap-1"
                                title="Batalkan (Void) Mutasi Kas Ini"
                              >
                                <span>🚫</span>
                                <span className="hidden sm:inline">Void</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* MODAL KONFIRMASI VOID MUTASI KAS */}
      {movementToVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center text-lg font-black">
                  🚫
                </span>
                <div>
                  <h3 className="font-black text-slate-900 text-base">Batalkan Mutasi Kas (Void)</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Sesi shift aktif saat ini</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMovementToVoid(null)
                  setVoidError(null)
                }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-bold transition"
              >
                ✕
              </button>
            </div>

            {/* Ringkasan Mutasi */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Tipe Mutasi:</span>
                <span className="font-extrabold text-slate-900">
                  {movementToVoid.type === 'cash_in' ? '🔺 Kas Masuk Laci' : '🔻 Kas Keluar Operasional'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Nominal:</span>
                <span className={`font-black text-sm tabular-nums ${movementToVoid.type === 'cash_in' ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {formatIDR(movementToVoid.amount)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Catatan Asal:</span>
                <span className="font-bold text-slate-700 truncate max-w-[200px]">
                  {movementToVoid.note || '-'}
                </span>
              </div>
            </div>

            {/* Dampak Finansial */}
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/70 text-[11px] text-amber-900 leading-relaxed font-medium">
              {movementToVoid.type === 'cash_out'
                ? `ℹ️ Uang kas sebesar ${formatIDR(movementToVoid.amount)} akan dikembalikan ke saldo kas laci, dan jurnal pembalik beban akan diposting otomatis ke buku besar.`
                : `ℹ️ Saldo kas laci sebesar ${formatIDR(movementToVoid.amount)} akan dikurangi kembali, dan jurnal pembalik sumber dana akan diposting otomatis ke buku besar.`}
            </div>

            {/* Input Alasan */}
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-800 block">
                Alasan Pembatalan (Void) <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Contoh: Salah input nominal kelebihan nol, transaksi dibatalkan kurir..."
                rows={2}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
              />
            </div>

            {/* Approver & PIN (Jika toko memiliki approver PIN) */}
            {approvers.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-indigo-50/50 border border-indigo-100 space-y-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">🔑</span>
                  <span className="text-xs font-black text-indigo-950">Otorisasi Manajer / Approver</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 block">Pilih Approver</label>
                  <select
                    value={selectedApproverId}
                    onChange={(e) => setSelectedApproverId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {approvers.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 block">6 Digit PIN Approver</label>
                  <div className="relative">
                    <input
                      type={showPin ? 'text' : 'password'}
                      value={approverPin}
                      onChange={(e) => setApproverPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Masukkan 6 digit PIN"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 tracking-widest pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      tabIndex={-1}
                      aria-label={showPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-1"
                    >
                      {showPin ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {voidError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{voidError}</span>
              </div>
            )}

            {/* Tombol Aksi */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setMovementToVoid(null)
                  setVoidError(null)
                }}
                disabled={voidSubmitting}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={voidSubmitting || voidReason.trim().length < 5 || (approvers.length > 0 && approverPin.length !== 6)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black shadow-xs transition flex items-center justify-center gap-2"
              >
                {voidSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Memproses...</span>
                  </>
                ) : (
                  <span>Konfirmasi Void</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </FullScreenModal>
  )
}
