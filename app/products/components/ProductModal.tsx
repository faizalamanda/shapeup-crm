"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

type Category = {
  id: string
  name: string
}

type Product = {
  id?: string
  name: string
  sku: string | null
  description: string | null
  price: number
  cost_price: number
  type: 'physical' | 'service'
  category_id: string | null
  stock_type: 'tracked' | 'available' | 'unavailable'
  stock_quantity: number
}

type ProductModalProps = {
  isOpen: boolean
  onClose: () => void
  onSave: () => void
  product: Product | null // if null, it is "Add New" mode
  businessId: string
}

export default function ProductModal({ isOpen, onClose, onSave, product, businessId }: ProductModalProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [mounted, setMounted] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form State
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState<number>(0)
  const [costPrice, setCostPrice] = useState<number>(0)
  const [type, setType] = useState<'physical' | 'service'>('physical')
  const [categoryId, setCategoryId] = useState<string>('')
  const [stockType, setStockType] = useState<'tracked' | 'available' | 'unavailable'>('available')
  const [stockQuantity, setStockQuantity] = useState<number>(0)

  // New Category State
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState('')

  // Set mounted
  useEffect(() => {
    setMounted(true)
  }, [])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  // Load categories
  useEffect(() => {
    if (isOpen && businessId) {
      fetchCategories()
    }
  }, [isOpen, businessId])

  // Populate form on edit mode
  useEffect(() => {
    if (isOpen) {
      if (product) {
        setName(product.name || '')
        setSku(product.sku || '')
        setDescription(product.description || '')
        setPrice(product.price || 0)
        setCostPrice(product.cost_price || 0)
        setType(product.type || 'physical')
        setCategoryId(product.category_id || '')
        setStockType(product.stock_type || 'available')
        setStockQuantity(product.stock_quantity || 0)
        setShowNewCategoryInput(false)
        setNewCategoryName('')
        setCategoryError('')
      } else {
        // Reset to defaults for Create mode
        setName('')
        setSku('')
        setDescription('')
        setPrice(0)
        setCostPrice(0)
        setType('physical')
        setCategoryId('')
        setStockType('available')
        setStockQuantity(0)
        setShowNewCategoryInput(false)
        setNewCategoryName('')
        setCategoryError('')
      }
    }
  }, [isOpen, product])

  const fetchCategories = async () => {
    setLoadingCategories(true)
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .eq('business_id', businessId)
        .order('name', { ascending: true })

      if (error) throw error
      setCategories(data || [])
    } catch (err) {
      console.error('Error fetching categories:', err)
    } finally {
      setLoadingCategories(false)
    }
  }

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === 'NEW_CATEGORY') {
      setShowNewCategoryInput(true)
      setCategoryId('')
    } else {
      setShowNewCategoryInput(false)
      setCategoryId(val)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return alert('Nama produk wajib diisi!')
    if (price < 0) return alert('Harga jual produk tidak boleh kurang dari 0!')
    if (costPrice < 0) return alert('Harga modal beli (HPP) tidak boleh kurang dari 0!')
    if (stockType === 'tracked' && stockQuantity < 0) {
      return alert('Jumlah stok tidak boleh kurang dari 0!')
    }

    setSaving(true)
    try {
      let finalCategoryId: string | null = categoryId ? categoryId : null

      // 1. If user typed a new category, insert it first
      if (showNewCategoryInput) {
        if (!newCategoryName.trim()) {
          setCategoryError('Nama kategori baru wajib diisi!')
          setSaving(false)
          return
        }

        // Check if category name already exists (case insensitive)
        const matched = categories.find(
          c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase()
        )

        if (matched) {
          finalCategoryId = matched.id
        } else {
          const { data: newCat, error: catErr } = await supabase
            .from('categories')
            .insert({
              business_id: businessId,
              name: newCategoryName.trim()
            })
            .select('id')
            .single()

          if (catErr) {
            if (catErr.code === '23505') { // Unique constraint violation
              setCategoryError('Kategori ini sudah ada.')
            } else {
              throw catErr
            }
            setSaving(false)
            return
          }
          finalCategoryId = newCat.id
        }
      }

      // 2. Insert or update product
      const productPayload = {
        business_id: businessId,
        name: name.trim(),
        sku: sku.trim() || null,
        description: description.trim() || null,
        price: Number(price),
        cost_price: Number(costPrice),
        type,
        category_id: finalCategoryId,
        stock_type: stockType,
        stock_quantity: stockType === 'tracked' ? Number(stockQuantity) : 0,
        updated_at: new Date().toISOString()
      }

      if (product?.id) {
        // Edit mode
        const { error } = await supabase
          .from('products')
          .update(productPayload)
          .eq('id', product.id)

        if (error) throw error
      } else {
        // Create mode
        const { error } = await supabase
          .from('products')
          .insert(productPayload)

        if (error) throw error
      }

      onSave()
      onClose()
    } catch (err: any) {
      console.error('Error saving product:', err)
      alert('Gagal menyimpan produk: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-center items-start md:items-center p-4 md:p-8 overflow-y-auto z-[99] animate-in fade-in duration-200">
      <div 
        className="bg-white border border-gray-300 rounded-xl shadow-2xl w-full max-w-lg md:max-w-xl my-auto flex flex-col max-h-[90vh] overflow-hidden transform scale-100 transition-all duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-200">
          <h3 className="text-md font-bold text-gray-900 uppercase tracking-wider">
            {product ? 'Edit Produk' : 'Tambah Produk Baru'}
          </h3>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 transition-colors text-xl font-light focus:outline-none"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          
          {/* Tipe Produk */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Jenis Produk</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('physical')}
                className={`py-2.5 px-4 border rounded-lg font-bold text-xs text-center transition-all ${
                  type === 'physical'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                }`}
              >
                📦 Produk Fisik
              </button>
              <button
                type="button"
                onClick={() => setType('service')}
                className={`py-2.5 px-4 border rounded-lg font-bold text-xs text-center transition-all ${
                  type === 'service'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                }`}
              >
                ⚡ Layanan / Jasa
              </button>
            </div>
          </div>

          {/* Nama Produk */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Nama Produk *</label>
            <input
              type="text"
              required
              className="w-full p-2.5 border border-gray-300 rounded-lg shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-medium text-gray-800 transition-all placeholder:text-gray-400"
              placeholder="Contoh: Kaus Polos Hitam, Konsultasi Bisnis..."
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* SKU & Kategori */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">SKU / Kode Produk</label>
              <input
                type="text"
                className="w-full p-2.5 border border-gray-300 rounded-lg shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-medium text-gray-800 transition-all placeholder:text-gray-300"
                placeholder="SKU-1002"
                value={sku}
                onChange={e => setSku(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Kategori</label>
              <select
                className="w-full p-2.5 border border-gray-300 rounded-lg shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-medium text-gray-800 transition-all bg-white"
                value={showNewCategoryInput ? 'NEW_CATEGORY' : categoryId}
                onChange={handleCategoryChange}
              >
                <option value="">-- Pilih Kategori --</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="NEW_CATEGORY" className="text-blue-600 font-bold">
                  ➕ Tambah Kategori Baru...
                </option>
              </select>
            </div>
          </div>

          {/* Input Inline Kategori Baru (di bawah grid SKU & Kategori) */}
          {showNewCategoryInput && (
            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-lg space-y-2 animate-in slide-in-from-top-2 duration-150">
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">Nama Kategori Baru *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-medium text-gray-800 bg-white"
                  placeholder="Contoh: Pakaian, Jasa Desain..."
                  value={newCategoryName}
                  onChange={e => {
                    setNewCategoryName(e.target.value)
                    setCategoryError('')
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowNewCategoryInput(false)
                    setNewCategoryName('')
                    setCategoryId('')
                    setCategoryError('')
                  }}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-bold text-gray-500 hover:bg-gray-100"
                >
                  Batal
                </button>
              </div>
              {categoryError && (
                <p className="text-[11px] font-bold text-red-600">{categoryError}</p>
              )}
            </div>
          )}

          {/* Harga Jual & HPP / Modal Beli */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Harga Jual (Rp) *</label>
              <input
                type="number"
                min="0"
                required
                className="w-full p-2.5 border border-gray-300 rounded-lg shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-medium text-gray-800 transition-all placeholder:text-gray-400"
                value={price === 0 ? '' : price}
                onChange={e => setPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">HPP / Harga Modal Beli (Rp)</label>
              <input
                type="number"
                min="0"
                className="w-full p-2.5 border border-gray-300 rounded-lg shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-medium text-gray-800 transition-all placeholder:text-gray-400"
                value={costPrice === 0 ? '' : costPrice}
                onChange={e => setCostPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                placeholder="0"
              />
            </div>
          </div>

          {/* Stok Pilihan */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Status & Manajemen Stok</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStockType('available')}
                className={`py-2 px-3 border rounded-lg font-bold text-xs text-center transition-all ${
                  stockType === 'available'
                    ? 'border-green-600 bg-green-50 text-green-700 shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                }`}
              >
                Tersedia
              </button>
              <button
                type="button"
                onClick={() => setStockType('unavailable')}
                className={`py-2 px-3 border rounded-lg font-bold text-xs text-center transition-all ${
                  stockType === 'unavailable'
                    ? 'border-red-600 bg-red-50 text-red-700 shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                }`}
              >
                Tidak Tersedia
              </button>
              <button
                type="button"
                onClick={() => setStockType('tracked')}
                className={`py-2 px-3 border rounded-lg font-bold text-xs text-center transition-all ${
                  stockType === 'tracked'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                }`}
              >
                Ditrack
              </button>
            </div>

            {/* Input jumlah stok jika Ditrack */}
            {stockType === 'tracked' && (
              <div className="mt-3.5 p-3.5 bg-blue-50/40 border border-blue-100 rounded-lg space-y-1.5 animate-in slide-in-from-top-2 duration-150">
                <label className="block text-[10px] font-bold text-blue-800 uppercase tracking-wider">Jumlah Stok Tersedia *</label>
                <input
                  type="number"
                  min="0"
                  required
                  className="w-full max-w-[120px] p-2.5 border border-blue-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-gray-800 bg-white"
                  value={stockQuantity === 0 ? '' : stockQuantity}
                  onChange={e => setStockQuantity(e.target.value === '' ? 0 : Number(e.target.value))}
                  placeholder="0"
                />
                <p className="text-[10px] text-blue-700/80 font-medium">Stok akan berubah otomatis bila ada transaksi penjualan atau pembelian.</p>
              </div>
            )}
          </div>

          {/* Deskripsi */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Deskripsi Produk</label>
            <textarea
              className="w-full p-2.5 border border-gray-300 rounded-lg shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-medium text-gray-800 transition-all min-h-[90px] placeholder:text-gray-350"
              placeholder="Jelaskan detail spesifikasi produk atau jenis jasa di sini..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-all"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-400 transition-all"
          >
            {saving ? 'Menyimpan...' : 'Simpan Produk'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
