"use client"

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

type Product = {
  id: string
  name: string
  price: number
  sku: string | null
  cost_price: number | null
}

type QuickAddProductModalProps = {
  isOpen: boolean
  onClose: () => void
  initialName: string
  businessId: string
  onSuccess: (newProduct: Product) => void
}

export default function QuickAddProductModal({
  isOpen,
  onClose,
  initialName,
  businessId,
  onSuccess
}: QuickAddProductModalProps) {
  useModalBackHandler(isOpen, onClose)

  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [mounted, setMounted] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'physical' | 'service'>('physical')
  const [price, setPrice] = useState<number>(0)
  const [costPrice, setCostPrice] = useState<number>(0)
  const [sku, setSku] = useState('')
  const [trackStock, setTrackStock] = useState(false)
  const [initialStock, setInitialStock] = useState<number>(0)

  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  // Prefill name when opening & lock body scroll
  useEffect(() => {
    if (isOpen) {
      setName(initialName)
      setType('physical')
      setPrice(0)
      setCostPrice(0)
      setSku('')
      setTrackStock(false)
      setInitialStock(0)
      setErrorMessage('')
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen, initialName])

  if (!isOpen || !mounted) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErrorMessage('Nama produk wajib diisi.')
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const payload: Record<string, any> = {
        business_id: businessId,
        name: name.trim(),
        type: type,
        price: Number(price) || 0,
        cost_price: Number(costPrice) || 0,
        sku: sku.trim() || null,
        stock_type: type === 'physical' && trackStock ? 'tracked' : 'available',
        stock_quantity: type === 'physical' && trackStock ? (Number(initialStock) || 0) : 0
      }

      const { data: newProd, error } = await supabase
        .from('products')
        .insert(payload)
        .select('id, name, price, sku, cost_price')
        .single()

      if (error) throw error

      if (newProd) {
        onSuccess(newProd)
        onClose()
      }
    } catch (err: any) {
      console.error('Error quick adding product:', err)
      setErrorMessage(err.message || 'Gagal menambahkan produk.')
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-lg w-full flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-[#1C1C1A]">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 bg-slate-50 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">
              📦
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Tambah Produk Baru</h3>
              <p className="text-[11px] text-slate-500 font-medium">Buat produk baru dengan cepat ke database master</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 flex items-center justify-center text-lg font-bold transition-all"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-semibold">
          {errorMessage && (
            <div className="p-3 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2">
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Product Type Toggle */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tipe Produk</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('physical')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  type === 'physical'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>📦</span>
                <span>Fisik (Barang)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setType('service')
                  setTrackStock(false)
                }}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  type === 'service'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>⚡</span>
                <span>Jasa / Layanan</span>
              </button>
            </div>
          </div>

          {/* Product Name */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Nama Produk *</label>
            <input
              type="text"
              required
              placeholder="Contoh: Kemeja Flannel Navy, Jasa Servis AC..."
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-medium text-gray-900 transition-all placeholder:text-gray-400"
            />
          </div>

          {/* Grid: Sale Price & Cost Price */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Harga Jual (Rp) *</label>
              <input
                type="number"
                min="0"
                required
                placeholder="0"
                value={price || ''}
                onChange={e => setPrice(Math.max(0, Number(e.target.value)))}
                onWheel={e => e.currentTarget.blur()}
                className="w-full p-2.5 rounded-xl border border-gray-300 text-right focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-medium text-gray-900 transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Harga Modal / HPP (Rp)</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={costPrice || ''}
                onChange={e => setCostPrice(Math.max(0, Number(e.target.value)))}
                onWheel={e => e.currentTarget.blur()}
                className="w-full p-2.5 rounded-xl border border-gray-300 text-right focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-medium text-gray-900 transition-all"
              />
            </div>
          </div>

          {/* SKU */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">SKU / Kode Produk (Opsional)</label>
            <input
              type="text"
              placeholder="SKU-1001"
              value={sku}
              onChange={e => setSku(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-mono text-gray-900 transition-all"
            />
          </div>

          {/* Stock Tracking (for physical products) */}
          {type === 'physical' && (
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <label className="flex items-center gap-2 text-slate-800 font-bold cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={trackStock}
                  onChange={e => setTrackStock(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Aktifkan Pelacakan Stok</span>
              </label>

              {trackStock && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Stok Awal</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={initialStock || ''}
                    onChange={e => setInitialStock(Math.max(0, Number(e.target.value)))}
                    onWheel={e => e.currentTarget.blur()}
                    className="w-full p-2.5 rounded-xl border border-gray-300 bg-white text-center focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-bold text-gray-900"
                  />
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-100 text-xs font-bold">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2.5 text-center text-slate-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-200 border-t-white animate-spin" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                'Simpan Produk'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
