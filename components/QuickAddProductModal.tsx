"use client"

import { useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

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
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [name, setName] = useState('')
  const [type, setType] = useState<'physical' | 'service'>('physical')
  const [price, setPrice] = useState<number>(0)
  const [costPrice, setCostPrice] = useState<number>(0)
  const [sku, setSku] = useState('')
  const [trackStock, setTrackStock] = useState(false)
  const [initialStock, setInitialStock] = useState<number>(0)

  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Prefill name when opening
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
    }
  }, [isOpen, initialName])

  if (!isOpen) return null

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

  return (
    <div className="fixed inset-0 bg-[#1C1C1A]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[#EBEBEA] shadow-xl p-6 max-w-md w-full space-y-4 animate-in fade-in zoom-in-95 duration-200 text-[#1C1C1A]">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wider text-[#70706E]">Tambah Produk Baru</h3>
          <p className="text-xs text-[#70706E] mt-1">Buat produk baru dengan cepat untuk dimasukkan ke baris invoice.</p>
        </div>

        {errorMessage && (
          <div className="p-2.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
            ⚠️ {errorMessage}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3.5 text-xs font-semibold">
          {/* Product Name */}
          <div className="space-y-1">
            <label className="text-[#70706E]">Nama Produk *</label>
            <input
              type="text"
              required
              placeholder="Contoh: Kemeja Flannel Navy"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none"
            />
          </div>

          {/* Grid: Type & SKU */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[#70706E]">Tipe Produk</label>
              <select
                value={type}
                onChange={e => {
                  const val = e.target.value as 'physical' | 'service'
                  setType(val)
                  if (val === 'service') {
                    setTrackStock(false)
                  }
                }}
                className="w-full p-2.5 rounded-xl border border-[#EBEBEA] bg-white focus:ring-2 focus:ring-blue-100 focus:outline-none"
              >
                <option value="physical">Fisik (Barang)</option>
                <option value="service">Jasa / Layanan</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[#70706E]">SKU / Kode (Opsional)</label>
              <input
                type="text"
                placeholder="SKU-XXX"
                value={sku}
                onChange={e => setSku(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none font-mono"
              />
            </div>
          </div>

          {/* Grid: Sale Price & Cost Price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[#70706E]">Harga Jual (Rp) *</label>
              <input
                type="number"
                min="0"
                required
                value={price || ''}
                onChange={e => setPrice(Math.max(0, Number(e.target.value)))}
                className="w-full p-2.5 rounded-xl border border-[#EBEBEA] text-right focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[#70706E]">Harga Modal / HPP (Rp)</label>
              <input
                type="number"
                min="0"
                value={costPrice || ''}
                onChange={e => setCostPrice(Math.max(0, Number(e.target.value)))}
                className="w-full p-2.5 rounded-xl border border-[#EBEBEA] text-right focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>
          </div>

          {/* Stock Tracking Toggle (only for physical products) */}
          {type === 'physical' && (
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <label className="flex items-center gap-2 text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trackStock}
                  onChange={e => setTrackStock(e.target.checked)}
                  className="rounded border-[#EBEBEA] text-blue-600 focus:ring-blue-600"
                />
                <span>Aktifkan Pelacakan Stok</span>
              </label>

              {trackStock && (
                <div className="space-y-1 w-1/2">
                  <label className="text-[#70706E]">Stok Awal</label>
                  <input
                    type="number"
                    min="0"
                    value={initialStock || ''}
                    onChange={e => setInitialStock(Math.max(0, Number(e.target.value)))}
                    className="w-full p-2 rounded-xl border border-[#EBEBEA] text-center focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  />
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-3 border-t border-slate-100 text-xs font-bold">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2.5 text-center text-slate-600 hover:text-slate-800 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"
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
    </div>
  )
}
