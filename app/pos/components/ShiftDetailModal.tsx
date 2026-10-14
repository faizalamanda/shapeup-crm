"use client"

import { useState, useEffect, useMemo } from 'react'
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
}

export default function ShiftDetailModal({
  isOpen,
  onClose,
  shiftId,
  timezone,
  businessName = 'ShapeUp Store',
  onReprintOrder,
  onOpenOrderDetail,
  onReprintZReport
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

  // Format IDR
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Load Shift Details
  useEffect(() => {
    if (!isOpen || !shiftId) return

    let isMounted = true
    setLoading(true)

    fetch(`/api/pos/shifts?mode=shift_details&shift_id=${shiftId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return
        if (data.success) {
          setShift(data.shift)
          setOrders(data.orders || [])
          setMovements(data.movements || [])
          if (data.tenderBreakdown) {
            setTenderBreakdown(data.tenderBreakdown)
          }
        }
      })
      .catch((err) => {
        console.error('Error loading shift details:', err)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, shiftId])

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

  // Cash Calculation Metrics
  const cashMetrics = useMemo(() => {
    if (!shift) {
      return {
        initialCash: 0,
        cashSales: 0,
        cashIn: 0,
        cashOut: 0,
        expectedCash: 0,
        actualCash: 0,
        difference: 0,
        totalSales: 0
      }
    }

    const initialCash = Number(shift.initial_cash || 0)
    const cashSales = tenderBreakdown.cash.amount || 0

    let cashIn = 0
    let cashOut = 0
    movements.forEach((m) => {
      const amt = Number(m.amount) || 0
      if (m.type === 'cash_in') cashIn += amt
      else if (m.type === 'cash_out') cashOut += amt
    })

    const expectedCash = Number(shift.expected_cash || (initialCash + cashSales + cashIn - cashOut))
    const actualCash = Number(shift.actual_cash || 0)
    const difference = shift.difference !== undefined && shift.difference !== null
      ? Number(shift.difference)
      : (shift.status === 'closed' ? actualCash - expectedCash : 0)

    const totalSales = orders
      .filter((o) => o.status === 'completed')
      .reduce((sum, o) => sum + Number(o.grand_total || 0), 0)

    return {
      initialCash,
      cashSales,
      cashIn,
      cashOut,
      expectedCash,
      actualCash,
      difference,
      totalSales
    }
  }, [shift, tenderBreakdown, movements, orders])

  // Handler: Build and Print Z-Report
  const handlePrintZReport = () => {
    if (!shift) return

    const zReceipt: ReceiptData = {
      businessName: businessName,
      orderNumber: `Z-REPORT-${shift.id.slice(0, 8).toUpperCase()}`,
      date: formatDisplayDate(shift.closed_at || new Date(), 'datetime', timezone),
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
        }
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
                            <div className="flex items-center gap-2">
                              <span className="font-black text-slate-900 text-xs group-hover:text-indigo-600 transition">
                                #{ord.order_number}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                isCompleted ? 'bg-emerald-100 text-emerald-800' : isCancelled ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {isCompleted ? 'Selesai' : isCancelled ? 'Batal' : 'Draft'}
                              </span>
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
                              <div className="font-black text-slate-900 text-xs sm:text-sm tabular-nums">
                                {formatIDR(ord.grand_total)}
                              </div>
                              <span className="text-[10px] font-bold text-slate-400">
                                {methodStr.includes('cash') ? '💵 Tunai' : methodStr.includes('qris') ? '📱 QRIS' : '💳 Kartu'}
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
                      const isCashIn = mov.type === 'cash_in'

                      return (
                        <div
                          key={mov.id}
                          className="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/60 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm ${
                              isCashIn ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                            }`}>
                              {isCashIn ? '🔺' : '🔻'}
                            </span>
                            <div>
                              <span className="font-extrabold text-slate-900 block">
                                {mov.note || (isCashIn ? 'Kas Masuk Laci' : 'Kas Keluar Operasional')}
                              </span>
                              <span className="text-[11px] text-slate-400 block mt-0.5">
                                Waktu: {formatDisplayDate(mov.created_at, 'time', timezone)}
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className={`font-black text-sm tabular-nums ${
                              isCashIn ? 'text-emerald-700' : 'text-rose-600'
                            }`}>
                              {isCashIn ? '+' : '-'}{formatIDR(mov.amount)}
                            </span>
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold mt-0.5">
                              {isCashIn ? 'Kas Masuk' : 'Petty Cash'}
                            </span>
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
    </FullScreenModal>
  )
}
