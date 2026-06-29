"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

type Order = {
  id: string
  order_number: string
  created_at: string
  grand_total: number
  total_qty: number
  status: string
  payment_method: string
  customer?: {
    name: string
    phone: string
  }
}

type OrderHistoryModalProps = {
  isOpen: boolean
  onClose: () => void
  businessId: string
  onRefundCompleted: () => void // Callback to refresh catalog or state
}

export default function OrderHistoryModal({ isOpen, onClose, businessId, onRefundCompleted }: OrderHistoryModalProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [mounted, setMounted] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [processingRefundId, setProcessingRefundId] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen && businessId) {
      fetchOrders()
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen, businessId])

  const fetchOrders = async () => {
    setLoading(true)
    try {
      // Query POS orders for this business, order by created_at desc, limit to 20
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, 
          order_number, 
          created_at, 
          grand_total, 
          total_qty, 
          status, 
          payment_method,
          customer:customers(name, phone)
        `)
        .eq('business_id', businessId)
        .eq('source_platform', 'POS')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      // Format customer details since it returns as an object or array
      const formattedOrders: Order[] = (data || []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        created_at: o.created_at,
        grand_total: Number(o.grand_total),
        total_qty: Number(o.total_qty),
        status: o.status,
        payment_method: o.payment_method,
        customer: Array.isArray(o.customer) ? o.customer[0] : o.customer
      }))

      setOrders(formattedOrders)
    } catch (err: any) {
      console.error('Error fetching POS orders:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleRefund = async (orderId: string, orderNumber: string) => {
    const confirm = window.confirm(`Apakah Anda yakin ingin membatalkan & refund pesanan #${orderNumber}? Jurnal akuntansi pembalikan akan dibuat dan stok akan dikembalikan.`)
    if (!confirm) return

    setProcessingRefundId(orderId)
    try {
      const res = await fetch('/api/pos/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ order_id: orderId })
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Gagal memproses refund')
      }

      alert(`Pesanan #${orderNumber} berhasil dibatalkan & direfund!`)
      fetchOrders()
      onRefundCompleted()
    } catch (err: any) {
      console.error('Refund error:', err)
      alert('Gagal refund order: ' + err.message)
    } finally {
      setProcessingRefundId(null)
    }
  }

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val)
  }

  const formatDateTime = (isoString: string) => {
    return new Date(isoString).toLocaleString('id-ID', {
      dateStyle: 'short',
      timeStyle: 'short'
    })
  }

  if (!isOpen || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-center items-center p-4 overflow-y-auto z-[10000] animate-in fade-in duration-200">
      <div 
        className="bg-white border border-gray-300 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col h-[80vh] overflow-hidden transform scale-100 transition-all duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
            Riwayat Transaksi POS Terkini
          </h3>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 transition-colors text-xl font-light focus:outline-none"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-3">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold text-gray-500">Memuat riwayat transaksi...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <span className="text-4xl">📄</span>
              <p className="text-sm font-bold text-gray-700 mt-3">Belum Ada Transaksi POS</p>
              <p className="text-xs text-gray-400 mt-1">Transaksi penjualan kasir POS akan muncul di sini.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider">
                    <th className="px-5 py-3.5">No. Order</th>
                    <th className="px-5 py-3.5">Tanggal</th>
                    <th className="px-5 py-3.5">Pelanggan</th>
                    <th className="px-5 py-3.5 text-center">Item</th>
                    <th className="px-5 py-3.5 text-right">Total</th>
                    <th className="px-5 py-3.5 text-center">Bayar</th>
                    <th className="px-5 py-3.5 text-center">Status</th>
                    <th className="px-5 py-3.5 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                  {orders.map(order => {
                    const isCompleted = order.status === 'completed'
                    const isRefunded = order.status === 'cancelled'
                    
                    return (
                      <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3.5 font-bold text-[#1a1c23] uppercase">#{order.order_number}</td>
                        <td className="px-5 py-3.5 text-gray-500">{formatDateTime(order.created_at)}</td>
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-gray-800">{order.customer?.name || 'Customer Tamu'}</p>
                          {order.customer?.phone !== '0' && <p className="text-[10px] text-gray-400 font-mono">{order.customer?.phone}</p>}
                        </td>
                        <td className="px-5 py-3.5 text-center font-bold">{order.total_qty}</td>
                        <td className="px-5 py-3.5 text-right font-bold text-slate-800">{formatIDR(order.grand_total)}</td>
                        <td className="px-5 py-3.5 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 border border-slate-200 text-slate-600">
                            {order.payment_method}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {isCompleted && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 border border-green-200 text-green-700">
                              Selesai
                            </span>
                          )}
                          {isRefunded && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 border border-red-200 text-red-700">
                              Direfund
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {isCompleted ? (
                            <button
                              disabled={processingRefundId !== null}
                              onClick={() => handleRefund(order.id, order.order_number)}
                              className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 transition-colors font-bold text-[10px] uppercase tracking-wide disabled:opacity-50"
                            >
                              {processingRefundId === order.id ? 'Refund...' : 'Refund'}
                            </button>
                          ) : (
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Lunas</span>
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
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
