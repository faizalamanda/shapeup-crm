"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  const [mounted, setMounted] = useState(false)
  const [orders, setOrders] = useState<POSOrderHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tabFilter, setTabFilter] = useState<'all' | 'unpaid' | 'paid'>('all')
  const [processingRefundId, setProcessingRefundId] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

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
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
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
      `Apakah Anda yakin ingin membatalkan & refund pesanan #${orderNumber}?\n\n• Jurnal akuntansi pembalikan akan dibuat otomatis.\n• Stok akan dikembalikan ke gudang.`
    )
    if (!confirm) return

    setProcessingRefundId(orderId)
    try {
      const res = await fetch('/api/pos/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId })
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

  if (!isOpen || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex justify-center items-center p-3 sm:p-5 overflow-y-auto z-[10000] animate-in fade-in duration-200">
      <div 
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-5xl flex flex-col h-[90vh] overflow-hidden transform scale-100 transition-all duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-6 py-4 bg-white border-b border-slate-200 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black tracking-widest uppercase bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full border border-blue-200">
                POS Financial & Order Ledger
              </span>
              {unpaidCount > 0 && (
                <span className="text-[10px] font-black bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300 animate-pulse">
                  ⚠️ {unpaidCount} Tagihan Belum Lunas
                </span>
              )}
            </div>
            <h3 className="text-base font-black text-slate-900 uppercase tracking-tight mt-1">
              Riwayat Transaksi POS & Pelunasan Piutang
            </h3>
          </div>

          <button 
            type="button"
            onClick={onClose} 
            className="self-end sm:self-auto p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none"
            aria-label="Tutup"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar: Search & Filter Tabs */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setTabFilter('all')}
              className={`px-3 py-1.5 text-xs font-extrabold rounded-xl transition ${
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
              className={`px-3 py-1.5 text-xs font-extrabold rounded-xl transition flex items-center gap-1.5 ${
                tabFilter === 'unpaid'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-50'
              }`}
            >
              <span>⚠️ Belum Lunas</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                tabFilter === 'unpaid' ? 'bg-amber-800 text-white' : 'bg-amber-100 text-amber-900'
              }`}>
                {unpaidCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTabFilter('paid')}
              className={`px-3 py-1.5 text-xs font-extrabold rounded-xl transition ${
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
              className="w-full pl-3 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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

        {/* Body Table */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/60">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-3">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold text-slate-500">Memuat riwayat transaksi POS...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 border border-dashed border-slate-300 rounded-2xl bg-white">
              <span className="text-4xl mb-2">📄</span>
              <p className="text-sm font-extrabold text-slate-800">Tidak Ada Transaksi Ditemukan</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                {searchQuery
                  ? `Tidak ada pesanan yang sesuai dengan kata kunci "${searchQuery}".`
                  : tabFilter === 'unpaid'
                  ? 'Kabar baik! Semua pesanan POS telah lunas sepenuhnya.'
                  : 'Belum ada transaksi POS yang tercatat.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200/90 rounded-2xl bg-white shadow-xs">
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
                    <th className="px-4 py-3.5 text-right">Aksi</th>
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
                        className={`hover:bg-blue-50/40 transition-colors ${
                          !isPaid && !isCancelled ? 'bg-amber-50/20' : ''
                        }`}
                      >
                        {/* No Order */}
                        <td className="px-4 py-3.5 font-mono font-extrabold text-slate-900">
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
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-100 border border-amber-300 text-amber-900 uppercase tracking-wider">
                                <span>⚠️</span> {amountPaid > 0 ? 'Cicilan / DP' : 'Belum Bayar'}
                              </span>
                              <div className="text-[10px] text-amber-800 font-extrabold font-mono">
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

                        {/* Aksi */}
                        <td className="px-4 py-3.5 text-right whitespace-nowrap space-x-1.5">
                          {/* Tombol Lunasi / Detail */}
                          {onSelectOrder && (
                            <button
                              type="button"
                              onClick={() => onSelectOrder(order)}
                              className={`px-3 py-1.5 rounded-xl font-extrabold text-[11px] transition shadow-2xs ${
                                !isPaid && !isCancelled
                                  ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-200'
                                  : 'bg-slate-900 hover:bg-slate-800 text-white'
                              }`}
                            >
                              {!isPaid && !isCancelled ? '➕ Bayar / Detail' : '🔍 Detail'}
                            </button>
                          )}

                          {/* Tombol Refund jika sudah lunas dan completed */}
                          {isCompleted && isPaid && (
                            <button
                              type="button"
                              disabled={processingRefundId !== null}
                              onClick={() => handleRefund(order.id, order.order_number)}
                              className="px-2.5 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl hover:bg-rose-100 transition font-bold text-[10px] uppercase tracking-wider disabled:opacity-50"
                              title="Batalkan & Refund Pesanan"
                            >
                              {processingRefundId === order.id ? '...' : 'Refund'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-slate-500">
            Menampilkan <span className="font-bold text-slate-800">{filteredOrders.length}</span> transaksi POS
          </p>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 border border-slate-300 rounded-xl text-xs font-extrabold uppercase tracking-wider text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
