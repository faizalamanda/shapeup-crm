"use client"

import { useState } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { formatDisplayDate } from '@/lib/timeUtils'
import { ReceiptData } from '@/lib/pos/printerAdapter'
import ReceiptPreviewModal from './ReceiptPreviewModal'
import { getStoredReceiptSettings } from './ReceiptSettingsModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  order: any | null
  timezone?: string
  businessName?: string
  cashierName?: string
  onRefundSuccess?: () => void
}

export default function POSOrderDetailModal({
  isOpen,
  onClose,
  order,
  timezone,
  businessName = 'ShapeUp POS',
  cashierName = 'Kasir',
  onRefundSuccess
}: Props) {
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [processingRefund, setProcessingRefund] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  if (!order) return null

  const isCompleted = order.status === 'completed'
  const isCancelled = order.status === 'cancelled'

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  const raw = order.raw_source_data || {}
  const cashReceived = Number(raw.cash_received || 0)
  const changeAmount = Number(raw.change_amount || 0)

  const handleOpenReceipt = () => {
    const settings = getStoredReceiptSettings(businessName)
    const items = (order.items_json || []).map((item: any) => ({
      name: item.name,
      variant: item.variant_name || undefined,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      subtotal: Number(item.subtotal || item.total || 0),
      discount: Number(item.discount || 0),
      note: item.note || undefined
    }))

    const rData: ReceiptData = {
      businessName: settings.storeName || businessName,
      businessAddress: settings.address || undefined,
      businessPhone: settings.phone || undefined,
      orderNumber: order.order_number,
      date: formatDisplayDate(order.created_at, 'datetime', timezone),
      cashierName: cashierName,
      customerName: order.customer?.name || 'Walk-in Customer',
      items,
      subtotal: Number(order.subtotal || order.grand_total),
      discountTotal: Number(order.discount_amount || 0),
      taxTotal: 0,
      grandTotal: Number(order.grand_total),
      paymentMethod: order.payment_method || 'Tunai',
      cashReceived: cashReceived > 0 ? cashReceived : undefined,
      changeAmount: changeAmount > 0 ? changeAmount : undefined,
      note: settings.footerNote || undefined
    }

    setReceiptData(rData)
    setIsReceiptPreviewOpen(true)
  }

  const handleRefund = async () => {
    const confirmed = window.confirm(
      `Apakah Anda yakin ingin membatalkan & refund pesanan #${order.order_number}?\n\n• Stok barang akan dikembalikan secara massal.\n• Jurnal akuntansi pembalikan akan dibuat otomatis.`
    )
    if (!confirmed) return

    setProcessingRefund(true)
    setRefundError(null)

    try {
      const res = await fetch('/api/pos/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memproses refund pesanan')
      }

      alert(`Pesanan #${order.order_number} berhasil dibatalkan dan direfund!`)
      if (onRefundSuccess) onRefundSuccess()
      onClose()
    } catch (err: any) {
      console.error('Refund order error:', err)
      setRefundError(err.message || 'Terjadi kesalahan saat memproses refund.')
    } finally {
      setProcessingRefund(false)
    }
  }

  return (
    <>
      <FullScreenModal
        isOpen={isOpen}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <span>Rincian Pesanan #{order.order_number}</span>
            {isCompleted && (
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Selesai (Lunas)
              </span>
            )}
            {isCancelled && (
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                Dibatalkan / Direfund
              </span>
            )}
          </div>
        }
        description={`Waktu Transaksi: ${formatDisplayDate(order.created_at, 'datetime', timezone)}`}
        desktopSize="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <div>
              {isCompleted && (
                <button
                  type="button"
                  disabled={processingRefund}
                  onClick={handleRefund}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl text-xs border border-rose-200 transition disabled:opacity-50"
                >
                  {processingRefund ? 'Memproses Refund...' : '↩️ Refund Pesanan'}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleOpenReceipt}
                className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs border border-indigo-200 transition flex items-center gap-1.5"
              >
                <span>🖨️</span>
                <span>Cetak Ulang Struk</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs transition"
              >
                Tutup
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          {refundError && (
            <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-medium">
              ⚠️ {refundError}
            </div>
          )}

          {/* Info Customer & Kasir */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Pelanggan</span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">
                {order.customer?.name || 'Walk-in Customer (Tanpa Nama)'}
              </p>
              {order.customer?.phone && order.customer.phone !== '0' && (
                <p className="text-slate-500 font-mono text-[11px]">{order.customer.phone}</p>
              )}
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Metode Pembayaran</span>
              <p className="font-extrabold text-indigo-700 text-sm mt-0.5 uppercase">
                {order.payment_method || 'Tunai (Cash)'}
              </p>
              <span className="text-[10px] text-slate-400">Kasir: {cashierName}</span>
            </div>
          </div>

          {/* Rincian Item Belanja */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Daftar Produk ({order.total_qty || order.items_json?.length || 0} Item)
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {(order.items_json || []).map((item: any, idx: number) => {
                const itemPrice = Number(item.price || 0)
                const itemQty = Number(item.quantity || 1)
                const itemSub = Number(item.subtotal || item.total || (itemPrice * itemQty))
                const itemDiscount = Number(item.discount || 0)

                return (
                  <div key={idx} className="p-3.5 flex justify-between items-start hover:bg-slate-50/50 transition">
                    <div className="space-y-0.5">
                      <h5 className="font-bold text-slate-900 text-xs">{item.name}</h5>
                      {item.variant_name && (
                        <span className="text-[10px] text-indigo-600 font-semibold block">• Varian: {item.variant_name}</span>
                      )}
                      {item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0 && (
                        <span className="text-[10px] text-slate-500 block">
                          • {item.modifiers.map((m: any) => `${m.group}: ${m.name}`).join(', ')}
                        </span>
                      )}
                      {item.note && (
                        <span className="text-[10px] text-slate-500 italic block">• "{item.note}"</span>
                      )}
                      <span className="text-[11px] text-slate-500 block">
                        {itemQty} x {formatIDR(itemPrice)}
                      </span>
                    </div>

                    <div className="text-right">
                      {itemDiscount > 0 && (
                        <span className="text-[10px] text-slate-400 line-through block">
                          {formatIDR(itemPrice * itemQty)}
                        </span>
                      )}
                      <span className={`font-black text-xs ${itemDiscount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                        {formatIDR(itemSub)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Rincian Perhitungan Total */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal Penjualan</span>
              <span className="font-semibold text-slate-800">{formatIDR(Number(order.subtotal || order.grand_total))}</span>
            </div>
            {Number(order.discount_amount) > 0 && (
              <div className="flex justify-between text-rose-600 font-semibold">
                <span>Total Diskon</span>
                <span>-{formatIDR(Number(order.discount_amount))}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm font-black text-slate-900">
              <span>GRAND TOTAL</span>
              <span className="text-base font-black text-indigo-700">{formatIDR(Number(order.grand_total))}</span>
            </div>

            {/* Rincian Kas Faktual */}
            {cashReceived > 0 && (
              <div className="pt-2 border-t border-slate-200/80 text-[11px] space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Uang Diterima (Cash):</span>
                  <span className="font-bold text-slate-800">{formatIDR(cashReceived)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Kembalian Diserahkan:</span>
                  <span className="font-bold text-slate-800">{formatIDR(changeAmount)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </FullScreenModal>

      {/* Modal Preview Struk */}
      {isReceiptPreviewOpen && (
        <ReceiptPreviewModal
          isOpen={isReceiptPreviewOpen}
          onClose={() => setIsReceiptPreviewOpen(false)}
          receipt={receiptData}
        />
      )}
    </>
  )
}
