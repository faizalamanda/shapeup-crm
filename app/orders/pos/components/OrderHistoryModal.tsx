"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { supabase } from '@/lib/supabase'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'

type CustomerInfo = {
  name?: string | null
  phone?: string | null
}

export type POSOrderHistoryItem = {
  id: string
  order_number: string
  created_at: string
  order_date?: string
  grand_total: number
  amount_paid?: number
  payment_status?: 'paid' | 'partial' | 'unpaid'
  total_qty: number
  status: string
  payment_method: string
  customer?: CustomerInfo
  items_json?: any[]
  raw_source_data?: any
}

type OrderHistoryModalProps = {
  isOpen: boolean
  onClose: () => void
  businessId: string
  timezone?: string
  onSelectOrder?: (order: POSOrderHistoryItem) => void
  onRefundCompleted?: () => void
}

export default function OrderHistoryModal({
  isOpen,
  onClose,
  businessId,
  timezone = DEFAULT_TIMEZONE,
  onSelectOrder,
  onRefundCompleted
}: OrderHistoryModalProps) {
  const [orders, setOrders] = useState<POSOrderHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tabFilter, setTabFilter] = useState<'all' | 'unpaid' | 'paid'>('all')
  const [processingRefundId, setProcessingRefundId] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, 
          order_number, 
          order_date,
          created_at, 
          grand_total, 
          amount_paid,
          payment_status,
          total_qty, 
          status, 
          payment_method,
          items_json,
          raw_source_data,
          customer:customers(name, phone)
        `)
        .eq('business_id', businessId)
        .eq('source_platform', 'POS')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error

      const formattedOrders: POSOrderHistoryItem[] = (data || []).map((o: any) => {
        const grandTotal = Number(o.grand_total) || 0
        const isCompleted = o.status === 'completed'
        const amountPaid = Number(o.amount_paid ?? (isCompleted ? grandTotal : 0))
        const pStatus: 'paid' | 'partial' | 'unpaid' = 
          o.payment_status || (amountPaid >= grandTotal - 0.01 ? 'paid' : (amountPaid > 0 ? 'partial' : 'unpaid'))

        return {
          id: o.id,
          order_number: o.order_number,
          created_at: o.created_at,
          order_date: o.order_date,
          grand_total: grandTotal,
          amount_paid: amountPaid,
          payment_status: pStatus,
          total_qty: Number(o.total_qty) || 0,
          status: o.status,
          payment_method: o.payment_method || 'Cash',
          items_json: o.items_json,
          raw_source_data: o.raw_source_data,
          customer: Array.isArray(o.customer) ? o.customer[0] : o.customer
        }
      })

      setOrders(formattedOrders)
    } catch (err: any) {
      console.error('Error fetching POS orders:', err)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    if (isOpen && businessId) {
      fetchOrders()
    }
  }, [isOpen, businessId, fetchOrders])

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Filtered orders by Search Query and Tab Filter
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return orders.filter((o) => {
      // 1. Tab status filter
      if (tabFilter === 'unpaid') {
        if (o.payment_status === 'paid' || o.status === 'cancelled') return false
      } else if (tabFilter === 'paid') {
        if (o.payment_status !== 'paid') return false
      }

      // 2. Search query filter
      if (!q) return true
      const matchNo = o.order_number?.toLowerCase().includes(q)
      const custName = o.customer?.name?.toLowerCase() || ''
      const custPhone = o.customer?.phone?.toLowerCase() || ''
      return matchNo || custName.includes(q) || custPhone.includes(q)
    })
  }, [orders, searchQuery, tabFilter])

  // Count metrics for tabs
  const unpaidCount = useMemo(() => {
    return orders.filter((o) => o.payment_status !== 'paid' && o.status !== 'cancelled').length
  }, [orders])

  const handleRefund = async (orderId: string, orderNumber: string) => {
    const confirm = window.confirm(
      `Apakah Anda yakin ingin membatalkan & refund pesanan #${orderNumber}?\n\n• Jurnal akuntansi pembalikan akan dibuat otomatis.\n• Stok barang fisik akan dikembalikan ke gudang.\n• Kas tunai akan dipotong dari laci shift kasir aktif.`
    )
    if (!confirm) return

    setProcessingRefundId(orderId)
    try {
      const res = await fetch('/api/pos/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          refund_reason: 'Refund langsung dari Pusat Layanan Nota POS'
        })
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Gagal memproses refund')
      }

      alert(`Pesanan #${orderNumber} berhasil dibatalkan & direfund!`)
      fetchOrders()
      if (onRefundCompleted) onRefundCompleted()
    } catch (err: any) {
      console.error('Refund error:', err)
      alert('Gagal refund order: ' + err.message)
    } finally {
      setProcessingRefundId(null)
    }
  }

  // Header Title Component
  const modalTitle = (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 w-full pr-2">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black tracking-widest uppercase bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full border border-indigo-200">
            Post-Purchase Service Hub
          </span>
          {unpaidCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black bg-rose-600 text-white px-2.5 py-0.5 rounded-full shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              {unpaidCount} Tagihan Piutang
            </span>
          )}
        </div>
        <h2 className="text-base sm:text-lg font-black text-slate-900 uppercase tracking-tight">
          Pusat Layanan Nota & Transaksi POS
        </h2>
        <p className="text-xs text-slate-500 font-medium">
          Pelunasan Piutang Kasir • Tukar Barang (Exchange) • Pengembalian Dana (Refund)
        </p>
      </div>
    </div>
  )

  // Footer Component
  const modalFooter = (
    <div className="flex flex-col sm:flex-row justify-between items-center gap-3 w-full">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>Menampilkan <strong className="text-slate-800">{filteredOrders.length}</strong> transaksi POS</span>
        {unpaidCount > 0 && (
          <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200">
            {unpaidCount} tagihan belum lunas
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full sm:w-auto px-5 py-2.5 border border-slate-300 rounded-xl text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-100 transition active:scale-95"
      >
        Tutup
      </button>
    </div>
  )

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="xl"
      title={modalTitle}
      footer={modalFooter}
    >
      <div className="space-y-4">
        {/* Toolbar: Search & Segmented Filter Tabs */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setTabFilter('all')}
              className={`px-3 py-1.5 text-xs font-black rounded-xl transition ${
                tabFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Semua ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setTabFilter('unpaid')}
              className={`px-3 py-1.5 text-xs font-black rounded-xl transition flex items-center gap-1.5 ${
                tabFilter === 'unpaid'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-white border border-rose-200 text-rose-700 hover:bg-rose-50'
              }`}
            >
              <span>Belum Lunas</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                tabFilter === 'unpaid' ? 'bg-rose-800 text-white' : 'bg-rose-100 text-rose-800 font-bold'
              }`}>
                {unpaidCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTabFilter('paid')}
              className={`px-3 py-1.5 text-xs font-black rounded-xl transition ${
                tabFilter === 'paid'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              ✓ Lunas
            </button>
          </div>

          {/* Search Input */}
          <div className="relative min-w-[280px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Cari No. Order / Pelanggan / HP..."
              className="w-full pl-3.5 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-9 h-9 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-bold text-slate-500">Memuat riwayat transaksi POS...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center p-8 border border-dashed border-slate-300 rounded-3xl bg-white">
            <span className="text-4xl mb-2">📄</span>
            <p className="text-sm font-black text-slate-800">Tidak Ada Transaksi Ditemukan</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              {searchQuery
                ? `Tidak ada pesanan yang sesuai dengan kata kunci "${searchQuery}".`
                : tabFilter === 'unpaid'
                ? 'Semua pesanan POS telah lunas sepenuhnya (Saldo piutang Rp 0).'
                : 'Belum ada transaksi POS yang tercatat.'}
            </p>
          </div>
        ) : (
          <>
            {/* ─── DESKTOP TABLE VIEW (hidden md:block) ─────────────────────────── */}
            <div className="hidden md:block overflow-x-auto border border-slate-200/90 rounded-2xl bg-white shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">
                    <th className="px-4 py-3.5">No. Order</th>
                    <th className="px-4 py-3.5">Waktu Transaksi</th>
                    <th className="px-4 py-3.5">Pelanggan</th>
                    <th className="px-4 py-3.5 text-right">Total Tagihan</th>
                    <th className="px-4 py-3.5">Status Pembayaran</th>
                    <th className="px-4 py-3.5 text-center">Metode</th>
                    <th className="px-4 py-3.5 text-center">Status</th>
                    <th className="px-4 py-3.5 text-right min-w-[210px]">Pusat Layanan (Aksi)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {filteredOrders.map((order) => {
                    const isCompleted = order.status === 'completed'
                    const isCancelled = order.status === 'cancelled'
                    const grandTotal = order.grand_total
                    const amountPaid = order.amount_paid || 0
                    const outstanding = Math.max(0, grandTotal - amountPaid)
                    const isPaid = order.payment_status === 'paid' && outstanding <= 0.01

                    return (
                      <tr 
                        key={order.id} 
                        className={`hover:bg-indigo-50/30 transition-colors ${
                          !isPaid && !isCancelled ? 'bg-rose-50/15' : ''
                        }`}
                      >
                        {/* No Order */}
                        <td className="px-4 py-3.5 font-mono font-black text-slate-900">
                          #{order.order_number}
                        </td>

                        {/* Waktu */}
                        <td className="px-4 py-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                          {formatDisplayDate(order.order_date || order.created_at, 'datetime', timezone)}
                        </td>

                        {/* Customer */}
                        <td className="px-4 py-3.5">
                          <p className="font-extrabold text-slate-900">
                            👤 {order.customer?.name || 'Pelanggan Tamu'}
                          </p>
                          {order.customer?.phone && order.customer?.phone !== '0' && (
                            <p className="text-[10px] text-slate-400 font-mono">
                              📞 +{order.customer?.phone}
                            </p>
                          )}
                        </td>

                        {/* Total Tagihan */}
                        <td className="px-4 py-3.5 text-right font-black text-slate-900 font-mono whitespace-nowrap">
                          {formatIDR(grandTotal)}
                        </td>

                        {/* Status Pembayaran & Sisa */}
                        <td className="px-4 py-3.5">
                          {isPaid ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black bg-emerald-50 border border-emerald-200 text-emerald-800 uppercase tracking-wider">
                              <span>✓</span> Lunas
                            </span>
                          ) : isCancelled ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 uppercase">
                              Dibatalkan
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-50 border border-rose-200 text-rose-700 uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                                {amountPaid > 0 ? 'Cicilan / DP' : 'Belum Bayar'}
                              </span>
                              <div className="text-[10px] text-rose-700 font-black font-mono">
                                Sisa: {formatIDR(outstanding)}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Metode Bayar */}
                        <td className="px-4 py-3.5 text-center">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 border border-slate-200 text-slate-700 uppercase tracking-wider">
                            {order.payment_method}
                          </span>
                        </td>

                        {/* Status Order */}
                        <td className="px-4 py-3.5 text-center">
                          {isCompleted ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 uppercase">
                              Selesai
                            </span>
                          ) : isCancelled ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 border border-rose-200 text-rose-700 uppercase">
                              Direfund
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 uppercase">
                              {order.status}
                            </span>
                          )}
                        </td>

                        {/* ─── DESKTOP ACTION COLUMN (Aesthetic & Segmented) ─── */}
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {!isPaid && !isCancelled ? (
                            /* Case 1: Tagihan Piutang (Action: Pelunasan Utama) */
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onSelectOrder?.(order)}
                                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs hover:shadow-md transition-all active:scale-95 group cursor-pointer"
                                title="Pelunasan Sisa Tagihan Nota"
                              >
                                <svg className="w-3.5 h-3.5 text-emerald-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth="2.5"/>
                                  <line x1="2" y1="10" x2="22" y2="10" strokeWidth="2.5"/>
                                </svg>
                                <span>Lunasi</span>
                                <span className="bg-emerald-950/40 text-emerald-100 text-[10px] px-2 py-0.5 rounded-md font-mono font-bold">
                                  {formatIDR(outstanding)}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectOrder?.(order)}
                                className="p-1.5 rounded-xl border border-slate-200 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition active:scale-95"
                                title="Lihat Rincian Nota"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                                </svg>
                              </button>
                            </div>
                          ) : isPaid && isCompleted ? (
                            /* Case 2: Lunas & Selesai (Action: Layanan Tukar, Refund, Detail) */
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onSelectOrder?.(order)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white font-extrabold text-xs shadow-xs hover:shadow-md transition-all active:scale-95 group"
                              >
                                <svg className="w-3.5 h-3.5 text-indigo-300 group-hover:rotate-180 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                                </svg>
                                <span>Layanan & Tukar</span>
                              </button>
                              <button
                                type="button"
                                disabled={processingRefundId === order.id}
                                onClick={() => handleRefund(order.id, order.order_number)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 font-bold text-xs transition active:scale-95 disabled:opacity-50"
                                title="Refund Pesanan Kasir"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a5 5 0 015 5v2a5 5 0 01-5 5H6m-3-12l4-4m-4 4l4 4"/>
                                </svg>
                                <span>{processingRefundId === order.id ? '...' : 'Refund'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectOrder?.(order)}
                                className="p-1.5 rounded-xl border border-slate-200 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition active:scale-95"
                                title="Lihat Rincian Nota"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                                </svg>
                              </button>
                            </div>
                          ) : (
                            /* Case 3: Batal / Direfund */
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => onSelectOrder?.(order)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition active:scale-95"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                </svg>
                                <span>Rincian Nota</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ─── MOBILE CARD VIEW (block md:hidden) ───────────────────────────── */}
            <div className="block md:hidden space-y-3">
              {filteredOrders.map((order) => {
                const isCompleted = order.status === 'completed'
                const isCancelled = order.status === 'cancelled'
                const grandTotal = order.grand_total
                const amountPaid = order.amount_paid || 0
                const outstanding = Math.max(0, grandTotal - amountPaid)
                const isPaid = order.payment_status === 'paid' && outstanding <= 0.01

                return (
                  <div
                    key={order.id}
                    className={`p-4 bg-white border rounded-2xl shadow-xs space-y-3 transition ${
                      !isPaid && !isCancelled
                        ? 'border-rose-200 bg-rose-50/15'
                        : 'border-slate-200'
                    }`}
                  >
                    {/* Top Row: Order Number & Status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-slate-900 text-xs">
                          #{order.order_number}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {formatDisplayDate(order.order_date || order.created_at, 'datetime', timezone)}
                        </span>
                      </div>
                      {isPaid ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-800 border border-emerald-200">
                          ✓ Lunas
                        </span>
                      ) : isCancelled ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                          Direfund
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          Sisa: {formatIDR(outstanding)}
                        </span>
                      )}
                    </div>

                    {/* Middle Row: Customer & Total */}
                    <div className="flex items-start justify-between text-xs pt-1 border-t border-slate-100">
                      <div>
                        <p className="font-bold text-slate-800">👤 {order.customer?.name || 'Pelanggan Tamu'}</p>
                        {order.customer?.phone && order.customer?.phone !== '0' && (
                          <p className="text-[10px] text-slate-400 font-mono">📞 +{order.customer.phone}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-black text-slate-900 text-sm font-mono">{formatIDR(grandTotal)}</p>
                        <span className="text-[10px] uppercase font-bold text-slate-400">{order.payment_method}</span>
                      </div>
                    </div>

                    {/* Bottom Action Strip (Thumb-Friendly Touch Targets) */}
                    <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                      {!isPaid && !isCancelled ? (
                        <button
                          type="button"
                          onClick={() => onSelectOrder?.(order)}
                          className="w-full py-2.5 px-3 bg-emerald-600 active:bg-emerald-700 text-white rounded-xl font-black text-xs shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <svg className="w-4 h-4 text-emerald-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth="2.5"/>
                            <line x1="2" y1="10" x2="22" y2="10" strokeWidth="2.5"/>
                          </svg>
                          <span>Lunasi Sisa Tagihan</span>
                          <span className="bg-emerald-950/40 text-emerald-100 text-[10px] px-2 py-0.5 rounded-md font-mono font-bold">
                            {formatIDR(outstanding)}
                          </span>
                        </button>
                      ) : isPaid && isCompleted ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onSelectOrder?.(order)}
                            className="flex-1 py-2 px-3 bg-slate-900 active:bg-indigo-600 text-white rounded-xl font-black text-xs flex items-center justify-center gap-1.5 shadow-xs"
                          >
                            <svg className="w-3.5 h-3.5 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                            </svg>
                            <span>Layanan & Tukar</span>
                          </button>
                          <button
                            type="button"
                            disabled={processingRefundId === order.id}
                            onClick={() => handleRefund(order.id, order.order_number)}
                            className="py-2 px-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs"
                          >
                            {processingRefundId === order.id ? '...' : '↩️ Refund'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectOrder?.(order)}
                          className="w-full py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                          </svg>
                          <span>Lihat Rincian Nota</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </FullScreenModal>
  )
}
