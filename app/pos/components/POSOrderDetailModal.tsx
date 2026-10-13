"use client"

import { useState, useEffect, useMemo } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { formatDisplayDate } from '@/lib/timeUtils'
import { ReceiptData } from '@/lib/pos/printerAdapter'
import ReceiptPreviewModal from './ReceiptPreviewModal'
import { getStoredReceiptSettings } from './ReceiptSettingsModal'
import CashPaymentModal, { type PaymentResult } from './CashPaymentModal'
import { supabase } from '@/lib/supabase'

type Props = {
  isOpen: boolean
  onClose: () => void
  order: any | null
  timezone?: string
  businessName?: string
  cashierName?: string
  onRefundSuccess?: () => void
  onOrderUpdated?: () => void
}

interface PaymentRecord {
  id: string
  date: string
  amount: number
  payment_method: string
  payment_kind: 'payment' | 'refund' | 'void'
  cash_received: number
  change_amount: number
  reference_number?: string | null
  notes?: string | null
  created_at: string
  voided_payment_id?: string | null
}

export default function POSOrderDetailModal({
  isOpen,
  onClose,
  order,
  timezone,
  businessName = 'ShapeUp POS',
  cashierName = 'Kasir',
  onRefundSuccess,
  onOrderUpdated
}: Props) {
  const [currentOrder, setCurrentOrder] = useState<any | null>(order)
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [processingRefund, setProcessingRefund] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  // Universal Payment Modal State for Paying Remaining Balance
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)

  // Void Individual Payment State
  const [processingVoidId, setProcessingVoidId] = useState<string | null>(null)

  // Update currentOrder when prop changes
  useEffect(() => {
    setCurrentOrder(order)
    setIsPayModalOpen(false)
    setRefundError(null)
  }, [order])

  // Fetch payments from order_payments table
  const orderId = order?.id
  const fetchPayments = async (targetOrderId: string) => {
    setLoadingPayments(true)
    setPaymentError(null)
    try {
      const { data, error } = await supabase
        .from('order_payments')
        .select(`
          id,
          date,
          amount,
          payment_method,
          payment_kind,
          cash_received,
          change_amount,
          reference_number,
          notes,
          created_at,
          voided_payment_id
        `)
        .eq('order_id', targetOrderId)
        .order('created_at', { ascending: true })

      if (error) throw error
      setPayments((data as PaymentRecord[]) || [])
    } catch (err: any) {
      console.error('Fetch order payments error:', err)
      setPaymentError(err.message || 'Gagal memuat rincian pembayaran dari server.')
    } finally {
      setLoadingPayments(false)
    }
  }

  useEffect(() => {
    if (isOpen && orderId) {
      fetchPayments(orderId)
    } else {
      setPayments([])
    }
  }, [isOpen, orderId])

  if (!currentOrder) return null

  const isCompleted = currentOrder.status === 'completed'
  const isCancelled = currentOrder.status === 'cancelled'

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  const grandTotal = Number(currentOrder.grand_total || 0)
  const amountPaid = Number(currentOrder.amount_paid ?? (isCompleted ? grandTotal : 0))
  const outstanding = Math.max(0, grandTotal - amountPaid)
  const isPaid = isCompleted && outstanding <= 0.01
  const isPartial = isCompleted && outstanding > 0.01 && amountPaid > 0

  // Set of voided payment IDs to identify cancelled lines
  const voidedPaymentIds = useMemo(() => {
    return new Set(
      payments
        .filter((p) => p.payment_kind === 'void' && p.voided_payment_id)
        .map((p) => p.voided_payment_id as string)
    )
  }, [payments])

  const raw = currentOrder.raw_source_data || {}
  const cashReceivedFallback = Number(raw.cash_received || 0)
  const changeAmountFallback = Number(raw.change_amount || 0)

  // Handle Receipt Preview
  const handleOpenReceipt = () => {
    const settings = getStoredReceiptSettings(businessName)
    const items = (currentOrder.items_json || []).map((item: any) => ({
      name: item.name,
      variant: item.variant_name || undefined,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      subtotal: Number(item.subtotal || item.total || 0),
      discount: Number(item.discount || 0),
      note: item.note || undefined
    }))

    // Find latest cash payment info if available from order_payments
    const cashPay = payments.slice().reverse().find((p) => p.payment_kind === 'payment' && p.payment_method === 'cash')
    const recCash = cashPay ? Number(cashPay.cash_received || cashPay.amount) : cashReceivedFallback
    const recChange = cashPay ? Number(cashPay.change_amount || 0) : changeAmountFallback

    const rData: ReceiptData = {
      businessName: settings.storeName || businessName,
      businessAddress: settings.address || undefined,
      businessPhone: settings.phone || undefined,
      orderNumber: currentOrder.order_number,
      date: formatDisplayDate(currentOrder.created_at, 'datetime', timezone),
      cashierName: cashierName,
      customerName: currentOrder.customer?.name || 'Walk-in Customer',
      items,
      subtotal: Number(currentOrder.subtotal || currentOrder.grand_total),
      discountTotal: Number(currentOrder.discount_amount || 0),
      taxTotal: 0,
      grandTotal: Number(currentOrder.grand_total),
      paymentMethod: currentOrder.payment_method || (payments.length > 1 ? 'Multi-Tender' : 'Tunai'),
      cashReceived: recCash > 0 ? recCash : undefined,
      changeAmount: recChange > 0 ? recChange : undefined,
      note: settings.footerNote || undefined
    }

    setReceiptData(rData)
    setIsReceiptPreviewOpen(true)
  }

  // Handle Full Order Refund
  const handleRefund = async () => {
    const confirmed = window.confirm(
      `Apakah Anda yakin ingin membatalkan & refund pesanan #${currentOrder.order_number}?\n\n• Stok barang akan dikembalikan ke gudang.\n• Jurnal akuntansi pembalikan akan dibuat otomatis.\n• Pembayaran tunai/bank akan disesuaikan di laci kasir.`
    )
    if (!confirmed) return

    setProcessingRefund(true)
    setRefundError(null)

    try {
      const res = await fetch('/api/pos/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: currentOrder.id })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memproses refund pesanan')
      }

      alert(`Pesanan #${currentOrder.order_number} berhasil dibatalkan dan direfund!`)
      if (onRefundSuccess) onRefundSuccess()
      onClose()
    } catch (err: any) {
      console.error('Refund order error:', err)
      setRefundError(err.message || 'Terjadi kesalahan saat memproses refund.')
    } finally {
      setProcessingRefund(false)
    }
  }

  // Handle Pay Remaining via Universal Payment Modal
  const handleConfirmPayRemaining = async (paymentResult: PaymentResult) => {
    try {
      for (const item of paymentResult.payments) {
        const res = await fetch('/api/pos/order/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: currentOrder.id,
            amount: item.amount,
            payment_method: item.method,
            cash_received: item.cash_received || item.amount,
            change_amount: item.change_amount || 0,
            reference_number: item.reference_number || null,
            notes: `Pelunasan #${currentOrder.order_number}`
          })
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Gagal memproses pembayaran')
        }

        // Update local order status
        setCurrentOrder((prev: any) => ({
          ...prev,
          amount_paid: data.amount_paid,
          payment_status: data.payment_status
        }))
      }

      alert('Pembayaran cicilan / pelunasan berhasil dicatat!')
      setIsPayModalOpen(false)

      if (currentOrder?.id) {
        await fetchPayments(currentOrder.id)
      }
      if (onOrderUpdated) onOrderUpdated()
    } catch (err: any) {
      console.error('Pay remaining error:', err)
      alert(`⚠️ Gagal mencatat pembayaran: ${err.message}`)
    }
  }

  // Handle Void Specific Payment Row
  const handleVoidPayment = async (paymentItem: PaymentRecord) => {
    const reason = window.prompt(
      `Batalkan (VOID) Pembayaran ini sebesar ${formatIDR(paymentItem.amount)}?\n\nMasukkan alasan pembatalan:`,
      'Salah input tender'
    )
    if (reason === null) return // User cancelled prompt

    setProcessingVoidId(paymentItem.id)
    try {
      const res = await fetch('/api/pos/order/payment-void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_id: paymentItem.id,
          void_reason: reason.trim() || 'Pembatalan Kasir'
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membatalkan pembayaran (void)')
      }

      alert(data.message || 'Pembayaran berhasil dibatalkan (void)!')

      // Update local order state
      setCurrentOrder((prev: any) => ({
        ...prev,
        amount_paid: data.amount_paid,
        payment_status: data.payment_status
      }))

      // Re-fetch payments
      if (currentOrder?.id) {
        await fetchPayments(currentOrder.id)
      }

      if (onOrderUpdated) onOrderUpdated()
    } catch (err: any) {
      console.error('Void error:', err)
      alert('⚠️ Gagal membatalkan pembayaran: ' + err.message)
    } finally {
      setProcessingVoidId(null)
    }
  }

  const renderPaymentMethodLabel = (method: string) => {
    switch (method.toLowerCase()) {
      case 'cash':
        return '💵 Tunai (Cash)'
      case 'bank':
        return '🏦 Transfer Bank'
      case 'qris':
        return '📱 QRIS / E-Wallet'
      case 'card':
        return '💳 Kartu Debit / Kredit'
      default:
        return method.toUpperCase()
    }
  }

  return (
    <>
      <FullScreenModal
        isOpen={isOpen}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2 flex-wrap">
            <span>Rincian Pesanan #{currentOrder.order_number}</span>
            {isCancelled ? (
              <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                Dibatalkan / Direfund
              </span>
            ) : isPaid ? (
              <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                Lunas
              </span>
            ) : isPartial ? (
              <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                Cicilan / Sebagian (DP)
              </span>
            ) : (
              <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                Belum Dibayar
              </span>
            )}
          </div>
        }
        description={`Waktu Transaksi: ${formatDisplayDate(currentOrder.created_at, 'datetime', timezone)}`}
        desktopSize="lg"
        footer={
          <div className="flex items-center justify-between w-full flex-wrap gap-2">
            <div>
              {isCompleted && !isCancelled && (
                <button
                  type="button"
                  disabled={processingRefund}
                  onClick={handleRefund}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl text-xs border border-rose-200 transition disabled:opacity-50"
                >
                  {processingRefund ? 'Memproses Refund...' : '↩️ Refund Pesanan Lengkap'}
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
        <div className="space-y-5 text-xs">
          {refundError && (
            <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-medium">
              ⚠️ {refundError}
            </div>
          )}

          {/* Banner Status Sisa Tagihan */}
          {isCompleted && !isCancelled && outstanding > 0.01 && (
            <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-bold text-amber-900 text-sm">
                  <span>⚠️ Tagihan Belum Lunas</span>
                  <span className="text-xs px-2 py-0.2 rounded-full bg-amber-200/80 text-amber-800">
                    Sisa: {formatIDR(outstanding)}
                  </span>
                </div>
                <p className="text-amber-700 text-xs">
                  Total Belanja {formatIDR(grandTotal)}, sudah diterima {formatIDR(amountPaid)}. Pelanggan dapat melakukan pelunasan bertahap.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPayModalOpen(true)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition shadow-sm self-start sm:self-auto shrink-0"
              >
                ➕ Bayar Sisa Tagihan
              </button>
            </div>
          )}

          {/* Info Customer & Ringkasan Transaksi */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Pelanggan</span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">
                {currentOrder.customer?.name || 'Walk-in Customer (Tanpa Nama)'}
              </p>
              {currentOrder.customer?.phone && currentOrder.customer.phone !== '0' && (
                <p className="text-slate-500 font-mono text-[11px]">{currentOrder.customer.phone}</p>
              )}
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Status Pembayaran</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-extrabold text-indigo-700 text-sm uppercase">
                  {currentOrder.payment_method || 'Multi-Tender'}
                </span>
                <span className="text-[10px] text-slate-400 font-medium">({cashierName})</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-500">Terbayar: <strong>{formatIDR(amountPaid)}</strong></span>
                <span className="text-slate-300">•</span>
                <span className={outstanding > 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>
                  Sisa: {formatIDR(outstanding)}
                </span>
              </div>
            </div>
          </div>

          {/* Histori Pembayaran (Payment Ledger Audit Trail) */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm">💳</span>
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  Riwayat Pembayaran (Payment Ledger)
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                {payments.length} Baris Transaksi
              </span>
            </div>

            {loadingPayments ? (
              <div className="p-6 text-center text-slate-400 font-medium">
                Memuat riwayat pembayaran...
              </div>
            ) : paymentError ? (
              <div className="p-4 text-center text-rose-600 text-xs font-semibold">
                ⚠️ {paymentError}
              </div>
            ) : payments.length === 0 ? (
              <div className="p-5 text-center text-slate-400 italic text-xs">
                Belum ada rincian pembayaran spesifik di database.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {payments.map((p) => {
                  const isVoidRecord = p.payment_kind === 'void'
                  const isRefundRecord = p.payment_kind === 'refund'
                  const isVoidedOriginal = voidedPaymentIds.has(p.id)
                  const isRegularPayment = p.payment_kind === 'payment' && !isVoidedOriginal

                  return (
                    <div
                      key={p.id}
                      className={`p-3.5 flex justify-between items-center transition ${
                        isVoidedOriginal
                          ? 'bg-slate-50/70 opacity-60'
                          : isVoidRecord
                          ? 'bg-rose-50/40'
                          : isRefundRecord
                          ? 'bg-amber-50/40'
                          : 'hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-xs">
                            {renderPaymentMethodLabel(p.payment_method)}
                          </span>

                          {/* Badge Status Pembayaran */}
                          {isVoidRecord && (
                            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-extrabold text-[9px] uppercase border border-rose-200">
                              Void (Pembalik)
                            </span>
                          )}
                          {isRefundRecord && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-extrabold text-[9px] uppercase border border-amber-200">
                              Refund (Pengembalian)
                            </span>
                          )}
                          {isVoidedOriginal && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-extrabold text-[9px] uppercase">
                              Dibatalkan (Voided)
                            </span>
                          )}
                          {isRegularPayment && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[9px] uppercase">
                              Diterima
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                          <span>{formatDisplayDate(p.created_at, 'datetime', timezone)}</span>
                          {p.reference_number && (
                            <span className="font-mono text-slate-600 bg-slate-100 px-1 rounded">
                              Ref: {p.reference_number}
                            </span>
                          )}
                          {p.notes && <span className="italic text-slate-600">• "{p.notes}"</span>}
                        </div>

                        {p.payment_method === 'cash' && Number(p.cash_received || 0) > Number(p.amount) && (
                          <div className="text-[10px] text-slate-400">
                            Tunai diterima: {formatIDR(Number(p.cash_received))} | Kembalian: {formatIDR(Number(p.change_amount))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span
                            className={`font-black text-xs block ${
                              isVoidedOriginal
                                ? 'line-through text-slate-400'
                                : isVoidRecord || isRefundRecord
                                ? 'text-rose-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {isVoidRecord || isRefundRecord ? '-' : '+'}
                            {formatIDR(Number(p.amount))}
                          </span>
                        </div>

                        {/* Action: Void Button for Active Payment Lines */}
                        {isRegularPayment && !isCancelled && (
                          <button
                            type="button"
                            disabled={processingVoidId === p.id}
                            onClick={() => handleVoidPayment(p)}
                            title="Batalkan (Void) pembayaran ini"
                            className="px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-300 rounded-lg text-[10px] font-bold transition disabled:opacity-50 shadow-2xs"
                          >
                            {processingVoidId === p.id ? '...' : 'Void'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Rincian Item Belanja */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Daftar Produk ({currentOrder.total_qty || currentOrder.items_json?.length || 0} Item)
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {(currentOrder.items_json || []).map((item: any, idx: number) => {
                const itemPrice = Number(item.price || 0)
                const itemQty = Number(item.quantity || 1)
                const itemSub = Number(item.subtotal || item.total || itemPrice * itemQty)
                const itemDiscount = Number(item.discount || 0)

                return (
                  <div key={idx} className="p-3 flex justify-between items-start hover:bg-slate-50/50 transition">
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
              <span className="font-semibold text-slate-800">{formatIDR(Number(currentOrder.subtotal || currentOrder.grand_total))}</span>
            </div>
            {Number(currentOrder.discount_amount) > 0 && (
              <div className="flex justify-between text-rose-600 font-semibold">
                <span>Total Diskon</span>
                <span>-{formatIDR(Number(currentOrder.discount_amount))}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm font-black text-slate-900">
              <span>GRAND TOTAL</span>
              <span className="text-base font-black text-indigo-700">{formatIDR(Number(currentOrder.grand_total))}</span>
            </div>

            <div className="pt-2 border-t border-slate-200/80 text-[11px] space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Total Sudah Diterima:</span>
                <span className="font-bold text-emerald-700">{formatIDR(amountPaid)}</span>
              </div>
              {outstanding > 0.01 && (
                <div className="flex justify-between text-rose-600 font-extrabold">
                  <span>Sisa Tagihan Belum Dibayar:</span>
                  <span>{formatIDR(outstanding)}</span>
                </div>
              )}
            </div>
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

      {/* Reusable Universal Payment Modal untuk Pelunasan Sisa Tagihan */}
      {isPayModalOpen && (
        <CashPaymentModal
          isOpen={isPayModalOpen}
          onClose={() => setIsPayModalOpen(false)}
          grandTotal={outstanding}
          title={`Pelunasan Tagihan #${currentOrder.order_number}`}
          subtitle={`Sisa yang belum dibayar: ${formatIDR(outstanding)}`}
          defaultMode="full"
          onConfirmPayment={handleConfirmPayRemaining}
        />
      )}
    </>
  )
}
