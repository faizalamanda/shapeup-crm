"use client"

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'

type Props = {
  isOpen: boolean
  onClose: () => void
  order: any
  businessId: string
  timezone?: string
  cashierName?: string
  onExchangeSuccess?: () => void
}

export default function ExchangeModal({
  isOpen,
  onClose,
  order,
  businessId,
  timezone,
  cashierName = 'Kasir',
  onExchangeSuccess
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [catalog, setCatalog] = useState<any[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [productSearch, setProductSearch] = useState('')

  // Selected Return Items: Map of itemId -> { quantity, condition: 'good' | 'damaged' }
  const [selectedReturnIndex, setSelectedReturnIndex] = useState<number>(0)
  const [returnCondition, setReturnCondition] = useState<'good' | 'damaged'>('good')

  // Selected Replacement Item
  const [selectedNewProduct, setSelectedNewProduct] = useState<any | null>(null)

  // Payment method for delta
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qris' | 'bank'>('cash')
  const [cashReceived, setCashReceived] = useState<number>(0)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Load product catalog for replacement selection
  useEffect(() => {
    if (isOpen && businessId) {
      setLoadingCatalog(true)
      supabase
        .from('products')
        .select('id, name, price, stock_quantity, stock_type')
        .eq('business_id', businessId)
        .order('name', { ascending: true })
        .limit(200)
        .then(({ data, error }) => {
          if (!error && data) {
            setCatalog(data)
          }
          setLoadingCatalog(false)
        })
    }
  }, [isOpen, businessId])

  // Parse original order items
  const originalItems = useMemo(() => {
    if (!order?.items_json) return []
    if (Array.isArray(order.items_json)) return order.items_json
    if (typeof order.items_json === 'string') {
      try {
        const parsed = JSON.parse(order.items_json)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  }, [order?.items_json])

  // Filter valid returnable items (ignore previous return markers)
  const returnableItems = useMemo(() => {
    return originalItems.filter((i: any) => !String(i.name || '').startsWith('[RETUR]'))
  }, [originalItems])

  const currentReturnItem = returnableItems[selectedReturnIndex] || returnableItems[0]

  // Filtered catalog by search
  const filteredCatalog = useMemo(() => {
    if (!productSearch.trim()) return catalog.slice(0, 30)
    const q = productSearch.toLowerCase()
    return catalog.filter((p) => p.name?.toLowerCase().includes(q))
  }, [catalog, productSearch])

  // Currency Formatter
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Math Calculations
  const returnPrice = Number(currentReturnItem?.price || 0)
  const newPrice = Number(selectedNewProduct?.price || 0)
  const delta = selectedNewProduct ? (newPrice - returnPrice) : 0
  const isCustomerPayingExtra = delta > 0
  const isStoreRefunding = delta < 0
  const isEvenExchange = selectedNewProduct && delta === 0

  const oldGrandTotal = Number(order?.grand_total || 0)
  const oldPaid = Number(order?.amount_paid || 0)
  const newGrandTotal = Math.max(0, oldGrandTotal + delta)
  const actualCashRefund = delta < 0 ? Math.max(0, oldPaid - newGrandTotal) : 0
  const debtReduction = delta < 0 ? (Math.abs(delta) - actualCashRefund) : 0

  useEffect(() => {
    if (delta > 0) {
      setCashReceived(delta)
    } else {
      setCashReceived(0)
    }
  }, [delta])

  const handleConfirmExchange = async () => {
    if (!currentReturnItem) {
      setErrorMsg('Pilih item yang ingin ditukar')
      return
    }
    if (!selectedNewProduct) {
      setErrorMsg('Pilih produk baru pengganti terlebih dahulu')
      return
    }

    if (isCustomerPayingExtra && paymentMethod === 'cash' && cashReceived < delta) {
      setErrorMsg('Nominal uang tunai yang diterima kurang dari selisih pembayaran.')
      return
    }

    setSubmitting(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/pos/order/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          return_items: [
            {
              product_id: currentReturnItem.product_id || currentReturnItem.id,
              name: currentReturnItem.name,
              variant_name: currentReturnItem.variant_name || null,
              quantity: 1,
              price: returnPrice,
              condition: returnCondition
            }
          ],
          new_items: [
            {
              id: selectedNewProduct.id,
              name: selectedNewProduct.name,
              quantity: 1,
              price: newPrice
            }
          ],
          payment_method: paymentMethod,
          cash_received: cashReceived,
          change_amount: Math.max(0, cashReceived - delta),
          notes: notes || `Tukar Barang #${order.order_number}`
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memproses pertukaran barang')
      }

      alert(data.message || 'Pertukaran barang berhasil disimpan!')
      if (onExchangeSuccess) onExchangeSuccess()
      onClose()
    } catch (err: any) {
      console.error('Exchange error:', err)
      setErrorMsg(err.message || 'Terjadi kesalahan sistem')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex justify-center items-center p-3 sm:p-5 z-[10001] animate-in fade-in duration-150">
      <div 
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <span className="text-[10px] font-black tracking-widest uppercase bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-full border border-indigo-200">
              Layanan Purna Jual POS
            </span>
            <h3 className="text-base font-black text-slate-900 mt-1">
              🔄 Tukar Barang (Exchange Ticket) — #{order?.order_number}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs flex-1">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-bold">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* STEP 1: Pilih Barang yang Dikembalikan Pelanggan */}
          <div className="space-y-2">
            <label className="font-black text-slate-800 uppercase tracking-wider block">
              1. Pilih Produk Lama yang Dikembalikan Pelanggan
            </label>
            <div className="grid grid-cols-1 gap-2">
              {returnableItems.map((item: any, idx: number) => {
                const isSelected = selectedReturnIndex === idx
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedReturnIndex(idx)}
                    className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-500'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <p className="font-extrabold text-slate-900 text-sm">{item.name}</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        Harga Beli Awal: <strong className="text-slate-800">{formatIDR(item.price)}</strong>
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`px-2.5 py-1 rounded-xl text-xs font-black ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {isSelected ? '✓ Dipilih' : 'Pilih'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Kondisi Barang Retur */}
            <div className="pt-2">
              <label className="text-[11px] font-bold text-slate-500 mb-1.5 block">
                Kondisi Fisik Barang Retur:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReturnCondition('good')}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    returnCondition === 'good'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold ring-1 ring-emerald-500'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="block font-black">🏷️ Kondisi Baik / Baru</span>
                  <span className="text-[10px] opacity-80">Kembali ke rak gudang siap jual</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReturnCondition('damaged')}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    returnCondition === 'damaged'
                      ? 'border-amber-500 bg-amber-50 text-amber-900 font-bold ring-1 ring-amber-500'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="block font-black">⚠️ Cacat / Rusak / Kotor</span>
                  <span className="text-[10px] opacity-80">Masuk karantina retur (diisolasi)</span>
                </button>
              </div>
            </div>
          </div>

          {/* STEP 2: Pilih Produk Baru Pengganti */}
          <div className="space-y-2 pt-2 border-t border-slate-200">
            <label className="font-black text-slate-800 uppercase tracking-wider block">
              2. Pilih Produk Baru Pengganti (Tukar Ukuran / Model)
            </label>
            <div className="relative">
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="🔍 Ketik nama produk baru pengganti..."
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 rounded-2xl p-2 bg-slate-50/50">
              {loadingCatalog ? (
                <p className="text-center py-4 text-slate-400">Memuat katalog produk...</p>
              ) : filteredCatalog.length === 0 ? (
                <p className="text-center py-4 text-slate-400">Tidak ada produk ditemukan.</p>
              ) : (
                filteredCatalog.map((prod) => {
                  const isSelected = selectedNewProduct?.id === prod.id
                  return (
                    <div
                      key={prod.id}
                      onClick={() => setSelectedNewProduct(prod)}
                      className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'border-indigo-600 bg-white ring-1 ring-indigo-500 shadow-xs'
                          : 'border-slate-200/80 bg-white hover:bg-slate-100/60'
                      }`}
                    >
                      <div>
                        <span className="font-bold text-slate-900 block">{prod.name}</span>
                        <span className="text-[10px] text-slate-400">
                          Stok: {prod.stock_quantity ?? '∞'} • Harga: {formatIDR(prod.price)}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {isSelected ? '✓ Dipilih' : 'Pilih'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* STEP 3: Ringkasan Kalkulasi & Selisih Nilai */}
          {selectedNewProduct && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 text-white space-y-3 shadow-md">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300 block">
                Kalkulasi Selisih Nilai Tukar
              </span>
              <div className="grid grid-cols-2 gap-3 text-xs border-b border-indigo-800/60 pb-3">
                <div>
                  <span className="text-slate-400 block text-[10px]">Nilai Kredit Barang Retur:</span>
                  <span className="font-bold text-slate-200">{formatIDR(returnPrice)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Harga Barang Baru:</span>
                  <span className="font-bold text-emerald-300">{formatIDR(newPrice)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-indigo-200 block">
                      {isEvenExchange
                        ? 'Even Exchange (Harga Sama)'
                        : isCustomerPayingExtra
                        ? 'Pelanggan Bayar Selisih (Tukar Tambah):'
                        : actualCashRefund > 0 && debtReduction > 0
                        ? 'Pengembalian Kas & Pengurangan Piutang:'
                        : actualCashRefund > 0
                        ? 'Toko Mengembalikan Selisih (Refund Kasir):'
                        : 'Pengurangan Sisa Tagihan (Piutang Berkurang):'}
                    </span>
                    <span className="text-xl font-black text-white tabular-nums">
                      {formatIDR(isCustomerPayingExtra ? delta : actualCashRefund > 0 ? actualCashRefund : debtReduction)}
                    </span>
                    {delta < 0 && actualCashRefund === 0 && (
                      <span className="text-[10px] text-amber-300 block font-medium">
                        (Tanpa uang keluar dari laci kasir; tagihan pesanan berkurang otomatis)
                      </span>
                    )}
                    {delta < 0 && actualCashRefund > 0 && debtReduction > 0 && (
                      <span className="text-[10px] text-emerald-300 block font-medium">
                        (Kasir kembalikan {formatIDR(actualCashRefund)} & sisa piutang {formatIDR(debtReduction)} berkurang)
                      </span>
                    )}
                  </div>

                  {isCustomerPayingExtra && (
                    <div className="flex items-center gap-1.5 bg-indigo-900/80 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cash')}
                        className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${paymentMethod === 'cash' ? 'bg-white text-indigo-950 shadow-xs' : 'text-indigo-200'}`}
                      >
                        💵 Tunai
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('qris')}
                        className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${paymentMethod === 'qris' ? 'bg-white text-indigo-950 shadow-xs' : 'text-indigo-200'}`}
                      >
                        📱 QRIS
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('bank')}
                        className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${paymentMethod === 'bank' ? 'bg-white text-indigo-950 shadow-xs' : 'text-indigo-200'}`}
                      >
                        💳 EDC
                      </button>
                    </div>
                  )}
                </div>

                {isCustomerPayingExtra && paymentMethod === 'cash' && (
                  <div className="pt-2 border-t border-indigo-800/60 flex items-center justify-between text-xs">
                    <span className="text-indigo-200">Uang Tunai Diterima:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={cashReceived || ''}
                        onChange={(e) => setCashReceived(Number(e.target.value) || 0)}
                        placeholder={String(delta)}
                        className="w-28 px-2.5 py-1 bg-indigo-900/90 border border-indigo-600 rounded-lg text-right font-black text-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                      {cashReceived > delta && (
                        <span className="text-emerald-300 font-bold text-[11px]">
                          Kembalian: {formatIDR(cashReceived - delta)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 font-bold text-slate-700 text-xs transition"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={!selectedNewProduct || submitting}
            onClick={handleConfirmExchange}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs transition shadow-md shadow-indigo-200 flex items-center gap-1.5"
          >
            {submitting ? 'Menyimpan...' : '✓ Selesaikan Penukaran'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
