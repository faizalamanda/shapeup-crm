"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

type Product = {
  id: string
  name: string
  sku: string | null
  stock_quantity: number
  cost_price: number
}

type OpnameItem = {
  product_id: string
  name: string
  recorded_quantity: number
  actual_quantity: number
}

type StockOpname = {
  id: string
  business_id: string
  transaction_id: string | null
  opname_number: string
  date: string
  notes: string | null
  items_json: OpnameItem[]
  created_at: string
}

export default function StockOpnamePage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [opnames, setOpnames] = useState<StockOpname[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedOpname, setSelectedOpname] = useState<StockOpname | null>(null)

  // Form State
  const [formOpnameNumber, setFormOpnameNumber] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formNotes, setFormNotes] = useState('')
  const [formItems, setFormItems] = useState<OpnameItem[]>([])
  
  // Sub-Modal Product Selector state
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [selectorSearch, setSelectorSearch] = useState('')
  const [tempSelectedIds, setTempSelectedIds] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Lock scroll when any modal is open
  useEffect(() => {
    if (isModalOpen || isDetailOpen || isSelectorOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isModalOpen, isDetailOpen, isSelectorOpen])

  // Products available to be added (not already in formItems)
  const availableProducts = useMemo(() => {
    const selectedIds = new Set(formItems.map(i => i.product_id))
    return products.filter(p => !selectedIds.has(p.id))
  }, [products, formItems])

  // Products filtered inside the Sub-Modal Selector
  const selectorFilteredProducts = useMemo(() => {
    if (!selectorSearch.trim()) return products
    const q = selectorSearch.toLowerCase().trim()
    return products.filter(
      p => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q))
    )
  }, [products, selectorSearch])

  // Fetch Page Data
  const fetchData = useCallback(async (businessId: string) => {
    setLoading(true)
    try {
      // 1. Fetch Opnames
      const res = await fetch('/api/stock-opname')
      if (!res.ok) throw new Error('Gagal memuat stock opname')
      const data = await res.json()
      setOpnames(data)

      // 2. Fetch Tracked Physical Products
      const { data: prodData } = await supabase
        .from('products')
        .select('id, name, sku, stock_quantity, cost_price')
        .eq('business_id', businessId)
        .eq('type', 'physical')
        .eq('stock_type', 'tracked')
        .order('name', { ascending: true })

      setProducts(prodData || [])
    } catch (err) {
      console.error('Error fetching stock opname page data:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Load active profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('active_business_id, businesses!active_business_id(name)')
          .eq('id', user.id)
          .single()

        if (error) throw error

        const businessId = profile?.active_business_id
        if (businessId) {
          setActiveBizId(businessId)
          const biz = Array.isArray(profile.businesses) ? profile.businesses[0] : profile.businesses
          setActiveBizName(biz?.name || 'Bisnis Saya')
          await fetchData(businessId)
        }
      } catch (err) {
        console.error('Error loading profile:', err)
        setLoading(false)
      }
    }
    loadProfile()
  }, [supabase, fetchData])

  // Open creation modal
  const openAddModal = () => {
    setFormOpnameNumber(`OPN-${Date.now().toString().slice(-6)}`)
    setFormDate(new Date().toISOString().split('T')[0])
    setFormNotes('')
    setFormItems([])
    setIsModalOpen(true)
  }

  // Open Sub-Modal Product Selector
  const openSelectorModal = () => {
    setTempSelectedIds(formItems.map(i => i.product_id))
    setSelectorSearch('')
    setIsSelectorOpen(true)
  }

  // Toggle selection in Sub-Modal Selector
  const toggleTempSelect = (productId: string) => {
    setTempSelectedIds(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    )
  }

  const selectAllFiltered = () => {
    const idsToAdd = selectorFilteredProducts.map(p => p.id)
    setTempSelectedIds(prev => Array.from(new Set([...prev, ...idsToAdd])))
  }

  const deselectAllFiltered = () => {
    const idsToRemove = new Set(selectorFilteredProducts.map(p => p.id))
    setTempSelectedIds(prev => prev.filter(id => !idsToRemove.has(id)))
  }

  // Confirm selection from Sub-Modal Selector
  const confirmSelector = () => {
    const newFormItems: OpnameItem[] = tempSelectedIds.map(id => {
      const existing = formItems.find(i => i.product_id === id)
      if (existing) return existing
      const prod = products.find(p => p.id === id)!
      return {
        product_id: prod.id,
        name: prod.name,
        recorded_quantity: prod.stock_quantity || 0,
        actual_quantity: prod.stock_quantity || 0
      }
    }).filter(Boolean)

    setFormItems(newFormItems)
    setIsSelectorOpen(false)
  }

  // Remove product from form items
  const handleRemoveProduct = (productId: string) => {
    setFormItems(prev => prev.filter(item => item.product_id !== productId))
  }

  // Optionally load all remaining products at once
  const handleLoadAllProducts = () => {
    const existingIds = new Set(formItems.map(i => i.product_id))
    const remaining = products.filter(p => !existingIds.has(p.id))
    const newItems = remaining.map(p => ({
      product_id: p.id,
      name: p.name,
      recorded_quantity: p.stock_quantity || 0,
      actual_quantity: p.stock_quantity || 0
    }))
    setFormItems(prev => [...prev, ...newItems])
  }

  // Handle actual quantity change
  const handleActualQtyChange = (product_id: string, val: string) => {
    const qty = parseInt(val)
    const updated = formItems.map(item => {
      if (item.product_id === product_id) {
        return { ...item, actual_quantity: isNaN(qty) ? 0 : qty }
      }
      return item
    })
    setFormItems(updated)
  }

  // Handle Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (formItems.length === 0) {
      alert('Silakan tambahkan minimal satu produk untuk melakukan stock opname.')
      return
    }

    const hasChanges = formItems.some(i => i.actual_quantity !== i.recorded_quantity)
    if (!hasChanges) {
      if (!confirm('Jumlah fisik semua barang persis sama dengan jumlah sistem. Yakin ingin menyimpan catatan opname tanpa penyesuaian stok?')) {
        return
      }
    }

    setSubmitLoading(true)
    try {
      const payload = {
        opname_number: formOpnameNumber.trim(),
        date: formDate,
        notes: formNotes.trim() || null,
        items: formItems
      }

      const res = await fetch('/api/stock-opname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menyimpan stock opname')
      }

      setIsModalOpen(false)
      if (activeBizId) {
        await fetchData(activeBizId)
      }
    } catch (err: any) {
      console.error(err)
      alert(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  // View Details modal
  const openDetailModal = (opname: StockOpname) => {
    setSelectedOpname(opname)
    setIsDetailOpen(true)
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Produk & Inventori
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 uppercase">
                📍 {activeBizName}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight leading-none uppercase">
            Stock Opname
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Lakukan perhitungan fisik stok di gudang secara berkala untuk mencocokkan jumlah sistem serta catat selisih penyusutan.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="w-full md:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          ➕ Mulai Stock Opname
        </button>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">
          Memuat data stock opname...
        </div>
      ) : opnames.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-xs">
          <span className="text-3xl">📝</span>
          <h3 className="text-sm font-extrabold text-gray-800 mt-2 uppercase tracking-wide">Belum ada stock opname</h3>
          <p className="text-xs text-gray-400 mt-1">Lakukan stock opname pertama Anda untuk menyesuaikan kuantitas produk.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                <th className="p-4">No. Dokumen</th>
                <th className="p-4">Tanggal</th>
                <th className="p-4">Catatan / Memo</th>
                <th className="p-4">Jumlah Produk Dihitung</th>
                <th className="p-4 text-right">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
              {opnames.map(o => {
                const itemsCount = Array.isArray(o.items_json) ? o.items_json.length : 0
                return (
                  <tr key={o.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 font-bold text-gray-900">{o.opname_number}</td>
                    <td className="p-4 text-gray-600">📅 {o.date}</td>
                    <td className="p-4 text-gray-500 max-w-xs truncate">{o.notes || '-'}</td>
                    <td className="p-4"><span className="bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full border border-slate-200 text-[10px] font-bold">{itemsCount} Produk</span></td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => openDetailModal(o)}
                        className="px-2.5 py-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
                      >
                        👁️ Lihat Hasil
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-2xl w-full overflow-hidden my-8 animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                📝 Form Input Perhitungan Fisik (Stock Opname)
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">No. Dokumen Opname *</label>
                  <input
                    type="text"
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formOpnameNumber}
                    onChange={e => setFormOpnameNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Tanggal Perhitungan *</label>
                  <input
                    type="date"
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Catatan / Memo Penyesuaian</label>
                <input
                  type="text"
                  placeholder="Contoh: Penyesuaian stok triwulan II, barang rusak di gudang"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                />
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Daftar Stok Produk Fisik</h4>
                    <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                      Pilih produk yang ingin di-opname menggunakan tombol pencarian di bawah.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={openSelectorModal}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] uppercase tracking-wider rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      🔍 Cari & Pilih Produk ({formItems.length})
                    </button>
                    {availableProducts.length > 0 && (
                      <button
                        type="button"
                        onClick={handleLoadAllProducts}
                        className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                        title="Tambah seluruh produk sekaligus"
                      >
                        ⚡ Muat Semua
                      </button>
                    )}
                  </div>
                </div>

                {products.length === 0 ? (
                  <p className="text-xs text-gray-400 italic text-center py-4">Tidak ada produk fisik bertipe stock-tracked dalam sistem.</p>
                ) : formItems.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center bg-slate-50/50 space-y-2">
                    <span className="text-3xl">📦</span>
                    <h5 className="text-xs font-extrabold text-gray-700 uppercase tracking-wide">Belum Ada Produk Dipilih</h5>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto">Klik tombol di bawah untuk membuka popup pencarian dan memilih produk yang di-opname.</p>
                    <button
                      type="button"
                      onClick={openSelectorModal}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-xs transition-all inline-flex items-center gap-2 cursor-pointer active:scale-95 mt-1"
                    >
                      🔍 Cari & Pilih Produk
                    </button>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          <th className="p-3">Nama Produk</th>
                          <th className="p-3 text-center">Stok Sistem</th>
                          <th className="p-3 text-center w-28">Stok Fisik</th>
                          <th className="p-3 text-right">Selisih</th>
                          <th className="p-3 text-center w-12">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-semibold text-gray-700">
                        {formItems.map(item => {
                          const diff = item.actual_quantity - item.recorded_quantity
                          return (
                            <tr key={item.product_id} className="hover:bg-gray-50/50">
                              <td className="p-3 text-gray-900 font-bold">{item.name}</td>
                              <td className="p-3 text-center text-gray-500 font-medium">{item.recorded_quantity}</td>
                              <td className="p-3 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  required
                                  className="w-20 p-1.5 border border-gray-300 rounded text-center font-bold text-gray-800 bg-white"
                                  value={item.actual_quantity}
                                  onChange={e => handleActualQtyChange(item.product_id, e.target.value)}
                                />
                              </td>
                              <td className="p-3 text-right">
                                {diff === 0 && <span className="text-gray-400">-</span>}
                                {diff > 0 && <span className="text-emerald-600 font-extrabold">+{diff} (Lebih)</span>}
                                {diff < 0 && <span className="text-red-500 font-extrabold">{diff} (Susut)</span>}
                              </td>
                              <td className="p-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveProduct(item.product_id)}
                                  className="text-gray-400 hover:text-red-600 p-1 transition-colors cursor-pointer"
                                  title="Hapus dari daftar opname"
                                >
                                  🗑️
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitLoading || formItems.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {submitLoading ? 'Menyimpan...' : 'Simpan Opname'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {isSelectorOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-[70] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-xl w-full flex flex-col h-[560px] max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider flex items-center gap-2">
                  🔍 Cari & Pilih Produk Fisik ({tempSelectedIds.length} Dipilih)
                </h3>
                <p className="text-[11px] text-slate-300 font-medium mt-0.5">
                  Centang produk yang ingin dimasukkan ke dalam daftar perhitungan stok opname.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSelectorOpen(false)}
                className="text-slate-400 hover:text-white text-base cursor-pointer p-1 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-50 border-b border-gray-200 space-y-3 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  placeholder="🔍 Ketik nama produk atau SKU untuk memfilter..."
                  className="w-full p-2.5 pl-9 pr-8 border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 bg-white"
                  value={selectorSearch}
                  onChange={e => setSelectorSearch(e.target.value)}
                  autoFocus
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
                {selectorSearch && (
                  <button
                    type="button"
                    onClick={() => setSelectorSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs p-1 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex justify-between items-center text-xs">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-md border border-blue-100 uppercase tracking-wider cursor-pointer"
                  >
                    ☑️ Pilih Semua ({selectorFilteredProducts.length})
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllFiltered}
                    className="text-[10px] font-bold text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-md border border-gray-200 uppercase tracking-wider cursor-pointer"
                  >
                    🟩 Batal Pilih
                  </button>
                </div>
                <span className="text-[11px] font-bold text-gray-500">
                  {tempSelectedIds.length} / {products.length} Produk
                </span>
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1 divide-y divide-gray-100">
              {selectorFilteredProducts.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-400 font-medium">
                  Tidak ada produk yang cocok dengan pencarian &quot;{selectorSearch}&quot;
                </div>
              ) : (
                selectorFilteredProducts.map(p => {
                  const isChecked = tempSelectedIds.includes(p.id)
                  return (
                    <div
                      key={p.id}
                      onClick={() => toggleTempSelect(p.id)}
                      className={`p-3 rounded-xl transition-all cursor-pointer flex justify-between items-center my-1 border ${
                        isChecked
                          ? 'bg-blue-50/80 border-blue-200 text-blue-900 shadow-2xs'
                          : 'bg-white border-transparent hover:bg-gray-50 text-gray-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} 
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer pointer-events-none"
                        />
                        <div>
                          <div className="font-bold text-xs">
                            {p.name}
                          </div>
                          {p.sku && (
                            <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                              SKU: {p.sku}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                          isChecked
                            ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          Stok: {p.stock_quantity || 0}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center shrink-0">
              <span className="text-xs font-bold text-gray-600">
                {tempSelectedIds.length} produk terpilih
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsSelectorOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={confirmSelector}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all active:scale-98 cursor-pointer"
                >
                  Gunakan Produk Dipilih ({tempSelectedIds.length})
                </button>
              </div>
            </div>

          </div>
        </div>,
        document.body
      )}

      {isDetailOpen && selectedOpname && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                👁️ Rincian Hasil Stock Opname
              </h2>
              <button onClick={() => setIsDetailOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer">✕</button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 text-xs font-bold text-gray-700 space-y-0.5 bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div>No. Dokumen:</div>
                <div className="text-gray-900 text-right">{selectedOpname.opname_number}</div>
                <div>Tanggal:</div>
                <div className="text-gray-900 text-right">📅 {selectedOpname.date}</div>
                {selectedOpname.notes && (
                  <>
                    <div className="col-span-2 border-t border-gray-200 my-1 pt-1">Memo/Keterangan:</div>
                    <div className="col-span-2 text-gray-500 font-medium italic break-words">{selectedOpname.notes}</div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Selisih & Perhitungan Fisik</h4>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold uppercase">
                      <tr>
                        <th className="p-2">Nama Barang</th>
                        <th className="p-2 text-center">Sistem</th>
                        <th className="p-2 text-center">Fisik</th>
                        <th className="p-2 text-right">Selisih</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-semibold text-gray-700">
                      {selectedOpname.items_json.map((item, idx) => {
                        const diff = item.actual_quantity - item.recorded_quantity
                        return (
                          <tr key={idx} className="hover:bg-gray-50/50">
                            <td className="p-2 font-bold text-gray-900">{item.name}</td>
                            <td className="p-2 text-center text-gray-400">{item.recorded_quantity}</td>
                            <td className="p-2 text-center text-gray-950">{item.actual_quantity}</td>
                            <td className="p-2 text-right">
                              {diff === 0 && <span className="text-gray-400">-</span>}
                              {diff > 0 && <span className="text-emerald-600">+{diff}</span>}
                              {diff < 0 && <span className="text-red-500">{diff}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => setIsDetailOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
