"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { PageLayout } from '@/components/ui/PageLayout'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

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

type JournalLine = {
  id: string
  account_id: string
  debit: number
  credit: number
  accounts: {
    id?: string
    code: string
    name: string
    type: string
  } | null
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
  transactions?: {
    id: string
    date?: string
    description?: string
    journal_lines?: JournalLine[]
  } | null
}

export default function StockOpnamePage() {
  const [opnames, setOpnames] = useState<StockOpname[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedOpname, setSelectedOpname] = useState<StockOpname | null>(null)
  
  const [selectedOpnameMoves, setSelectedOpnameMoves] = useState<any[]>([])
  const [movesLoading, setMovesLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<'fisik' | 'jurnal_stok' | 'jurnal_keuangan'>('fisik')

  // Success Modal State
  const [successData, setSuccessData] = useState<any>(null)

  // Form State
  const [formOpnameNumber, setFormOpnameNumber] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formNotes, setFormNotes] = useState('')
  const [formItems, setFormItems] = useState<OpnameItem[]>([])
  
  // Sub-Modal Product Selector state
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [selectorSearch, setSelectorSearch] = useState('')
  const [tempSelectedIds, setTempSelectedIds] = useState<string[]>([])

  const { activeBusiness } = useUserContext()
  const activeBizId = activeBusiness?.id
  const activeBizName = activeBusiness?.name

  // Immediate fetch for opnames data
  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetch('/api/stock-opname')
      .then(res => {
        if (!res.ok) throw new Error('Gagal memuat stock opname')
        return res.json()
      })
      .then(data => {
        if (mounted && Array.isArray(data)) setOpnames(data)
      })
      .catch(err => console.error('Error fetching opnames:', err))
      .finally(() => {
        if (mounted) setLoading(false)
      })
    
    return () => { mounted = false }
  }, []) // Empty dependency array -> runs instantly on mount

  // Fetch products when activeBizId is available
  useEffect(() => {
    if (!activeBizId) return
    let mounted = true
    const fetchProducts = async () => {
      try {
        const { data } = await supabase
          .from('products')
          .select('id, name, sku, stock_quantity, cost_price')
          .eq('business_id', activeBizId)
          .eq('type', 'physical')
          .eq('stock_type', 'tracked')
          .order('name', { ascending: true })
        if (mounted && data) setProducts(data)
      } catch (err) {
        console.error('Error fetching products:', err)
      }
    }
    fetchProducts()
    
    return () => { mounted = false }
  }, [activeBizId]) // Only depend on primitive string ID

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
  const handleSubmit = async () => {
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
      
      const newOpname = await res.json()

      // Optimistic Update List
      setOpnames(prev => [newOpname, ...prev])
      
      // Success flow
      setSuccessData(newOpname)

    } catch (err: any) {
      console.error(err)
      alert(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  // View Details modal
  const openDetailModal = async (opname: StockOpname) => {
    setSelectedOpname(opname)
    setDetailTab('fisik')
    setIsDetailOpen(true)
    setMovesLoading(true)
    try {
      const { data, error } = await supabase
        .from('v_stock_moves_ledger')
        .select('*')
        .eq('source_type', 'stock_opname')
        .eq('source_id', opname.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setSelectedOpnameMoves(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setMovesLoading(false)
    }
  }

  // Filter opnames
  const filteredOpnames = useMemo(() => {
    if (!searchQuery.trim()) return opnames
    const q = searchQuery.toLowerCase().trim()
    return opnames.filter(o => {
      const matchOpname = o.opname_number?.toLowerCase().includes(q) || false
      const matchNotes = o.notes?.toLowerCase().includes(q) || false
      const matchProducts = Array.isArray(o.items_json) && o.items_json.some(item => 
        item.name?.toLowerCase().includes(q)
      )

      return matchOpname || matchNotes || matchProducts
    })
  }, [opnames, searchQuery])

  return (
    <PageLayout
      title="Stock Opname"
      description="Lakukan perhitungan fisik stok di gudang secara berkala untuk mencocokkan jumlah sistem serta catat selisih penyusutan."
      width="xl"
      actions={
        <button
          onClick={openAddModal}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          ➕ Mulai Stock Opname
        </button>
      }
    >
      <div className="space-y-6 animate-in fade-in duration-300">
        
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
          <div className="space-y-4">
            <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-xs px-4 py-2">
              <span className="text-gray-400 mr-2">🔍</span>
              <input
                type="text"
                placeholder="Cari berdasarkan No. Dokumen, Catatan, atau Nama Produk..."
                className="flex-1 bg-transparent text-sm font-medium text-gray-800 outline-none placeholder:text-gray-400 py-1"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="text-gray-400 hover:text-gray-600 text-sm font-bold"
                >
                  ✕
                </button>
              )}
            </div>
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
                  {filteredOpnames.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-gray-400 italic">
                        Tidak ada hasil pencarian untuk "{searchQuery}"
                      </td>
                    </tr>
                  ) : filteredOpnames.map(o => {
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
          </div>
        )}

        {/* Create Modal */}
        <FullScreenModal
          isOpen={isModalOpen && !successData}
          onClose={() => setIsModalOpen(false)}
          title="📝 Form Input Perhitungan Fisik (Stock Opname)"
          desktopSize="xl"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitLoading || formItems.length === 0}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                {submitLoading ? 'Menyimpan...' : 'Simpan Opname'}
              </button>
            </div>
          }
        >
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse min-w-[600px]">
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
          </div>
        </FullScreenModal>

        {/* Sub-Modal Product Selector */}
        <FullScreenModal
          isOpen={isSelectorOpen}
          onClose={() => setIsSelectorOpen(false)}
          title={`🔍 Cari & Pilih Produk Fisik (${tempSelectedIds.length} Dipilih)`}
          description="Centang produk yang ingin dimasukkan ke dalam daftar perhitungan stok opname."
          desktopSize="lg"
          footer={
            <div className="flex justify-between items-center w-full">
              <span className="text-xs font-bold text-gray-600">
                {tempSelectedIds.length} produk terpilih
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsSelectorOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={confirmSelector}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-md transition-all active:scale-98 cursor-pointer"
                >
                  Gunakan Produk Dipilih ({tempSelectedIds.length})
                </button>
              </div>
            </div>
          }
        >
          <div className="flex flex-col h-full space-y-3 p-4">
            <div className="relative shrink-0">
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

            <div className="flex justify-between items-center text-xs shrink-0">
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

            <div className="overflow-y-auto flex-1 divide-y divide-gray-100 min-h-[300px] border border-gray-200 rounded-xl bg-gray-50 p-2">
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
                      className={`p-3 rounded-lg transition-all cursor-pointer flex justify-between items-center my-1 border ${
                        isChecked
                          ? 'bg-blue-50/80 border-blue-200 text-blue-900 shadow-2xs'
                          : 'bg-white border-transparent hover:border-gray-200 text-gray-800'
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
          </div>
        </FullScreenModal>

        {/* Detail Modal */}
        <FullScreenModal
          isOpen={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          title="👁️ Rincian Hasil Stock Opname & Jurnal"
          desktopSize="lg"
          footer={
            <div className="flex justify-end w-full">
              <button
                onClick={() => setIsDetailOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          }
        >
          {selectedOpname && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-bold text-gray-700 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div>No. Dokumen:
                  <div className="text-gray-900 mt-1">{selectedOpname.opname_number}</div>
                </div>
                <div>Tanggal:
                  <div className="text-gray-900 mt-1">📅 {selectedOpname.date}</div>
                </div>
                {selectedOpname.notes && (
                  <div className="col-span-2 md:col-span-4 border-t border-gray-200 pt-3 mt-1">
                    Memo/Keterangan:
                    <div className="text-gray-500 font-medium italic break-words mt-1">{selectedOpname.notes}</div>
                  </div>
                )}
              </div>

              <div className="flex border-b border-gray-200 space-x-4 mt-5 overflow-x-auto">
                <button 
                  onClick={() => setDetailTab('fisik')}
                  className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${detailTab === 'fisik' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  📦 Fisik
                </button>
                <button 
                  onClick={() => setDetailTab('jurnal_stok')}
                  className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${detailTab === 'jurnal_stok' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  📊 Jurnal Stok
                </button>
                <button 
                  onClick={() => setDetailTab('jurnal_keuangan')}
                  className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${detailTab === 'jurnal_keuangan' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  📒 Jurnal Keuangan
                </button>
              </div>

              {detailTab === 'fisik' && (
                <div className="space-y-2 mt-4 animate-in fade-in duration-200">
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse min-w-[500px]">
                      <thead className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold uppercase">
                        <tr>
                          <th className="p-3">Nama Barang</th>
                          <th className="p-3 text-center">Sistem</th>
                          <th className="p-3 text-center">Fisik</th>
                          <th className="p-3 text-right">Selisih</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-semibold text-gray-700">
                        {selectedOpname.items_json.map((item, idx) => {
                          const diff = item.actual_quantity - item.recorded_quantity
                          return (
                            <tr key={idx} className="hover:bg-gray-50/50">
                              <td className="p-3 font-bold text-gray-900">{item.name}</td>
                              <td className="p-3 text-center text-gray-400">{item.recorded_quantity}</td>
                              <td className="p-3 text-center text-gray-950">{item.actual_quantity}</td>
                              <td className="p-3 text-right">
                                {diff === 0 && <span className="text-gray-400">-</span>}
                                {diff > 0 && <span className="text-emerald-600 font-bold">+{diff} (Lebih)</span>}
                                {diff < 0 && <span className="text-red-500 font-bold">{diff} (Susut)</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detailTab === 'jurnal_stok' && (
                <div className="space-y-2 mt-4 animate-in fade-in duration-200">
                  {movesLoading ? (
                    <div className="text-center p-4 text-xs text-gray-500 font-medium">Memuat kartu stok...</div>
                  ) : selectedOpnameMoves.length === 0 ? (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-500 font-medium">
                      Tidak ada mutasi stok yang dicatat (karena tidak ada selisih).
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse min-w-[500px]">
                        <thead className="bg-slate-50 border-b border-gray-200 text-[10px] text-gray-500 font-bold uppercase">
                          <tr>
                            <th className="p-3">Produk</th>
                            <th className="p-3 text-center">Tipe Aksi</th>
                            <th className="p-3 text-right">Mutasi</th>
                            <th className="p-3 text-right">Saldo Sistem</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                          {selectedOpnameMoves.map(move => {
                            const prodName = products.find(p => p.id === move.product_id)?.name || 'Produk Tidak Ditemukan'
                            const isNegative = move.origin_location_id !== null
                            const qtyDisplay = isNegative ? `-${move.qty}` : `+${move.qty}`
                            const qtyColor = isNegative ? 'text-red-500' : 'text-emerald-600'
                            
                            return (
                              <tr key={move.id} className="hover:bg-gray-50/50">
                                <td className="p-3 font-bold text-gray-900">{prodName}</td>
                                <td className="p-3 text-center">
                                  <span className="text-[9px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full uppercase">
                                    {move.type}
                                  </span>
                                </td>
                                <td className={`p-3 text-right font-mono font-bold ${qtyColor}`}>
                                  {qtyDisplay}
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-gray-900">
                                  {move.system_stock}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'jurnal_keuangan' && (
                <div className="space-y-3 mt-4 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Entri Jurnal Akuntansi
                    </span>
                    {selectedOpname.transaction_id ? (
                      <span className="text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full uppercase">
                        ✓ Diposting Ke Jurnal
                      </span>
                    ) : (
                      <span className="text-[9px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full uppercase">
                        Tanpa Penyesuaian (Stok Pas)
                      </span>
                    )}
                  </div>

                  {selectedOpname.transactions?.journal_lines && selectedOpname.transactions.journal_lines.length > 0 ? (
                    <div className="border border-gray-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse min-w-[500px]">
                      <thead className="bg-slate-50 border-b border-gray-200 text-[10px] text-gray-500 font-bold uppercase">
                        <tr>
                          <th className="p-3">Kode & Akun Akuntansi</th>
                          <th className="p-3 text-right">Debet</th>
                          <th className="p-3 text-right">Kredit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                        {selectedOpname.transactions.journal_lines.map((jl) => {
                          const code = jl.accounts?.code || '---'
                          const name = jl.accounts?.name || 'Akun Tidak Ditemukan'
                          const debit = jl.debit || 0
                          const credit = jl.credit || 0
                          return (
                            <tr key={jl.id} className="hover:bg-gray-50/50">
                              <td className="p-3 font-semibold text-gray-900">
                                <span className="font-mono text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 mr-1.5 font-bold">
                                  [{code}]
                                </span>
                                {name}
                              </td>
                              <td className="p-3 text-right font-mono text-gray-900 font-semibold">
                                {debit > 0 ? `Rp ${debit.toLocaleString('id-ID')}` : '-'}
                              </td>
                              <td className="p-3 text-right font-mono text-gray-900 font-semibold">
                                {credit > 0 ? `Rp ${credit.toLocaleString('id-ID')}` : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t border-gray-200 text-xs font-bold text-gray-900">
                        <tr>
                          <td className="p-3 uppercase text-[10px] tracking-wider text-gray-500">Total Balancing</td>
                          <td className="p-3 text-right font-mono text-emerald-700">
                            Rp {selectedOpname.transactions.journal_lines.reduce((s, l) => s + (l.debit || 0), 0).toLocaleString('id-ID')}
                          </td>
                          <td className="p-3 text-right font-mono text-emerald-700">
                            Rp {selectedOpname.transactions.journal_lines.reduce((s, l) => s + (l.credit || 0), 0).toLocaleString('id-ID')}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  ) : (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-3 text-center text-xs text-slate-500 font-medium">
                      Tidak ada entri jurnal keuangan yang dibuat untuk hasil opname ini (selisih stok = 0).
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </FullScreenModal>

        {/* Success Modal Overlay */}
        {successData && (
          <div className="fixed inset-0 z-[60] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
                ✓
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-2">Opname Berhasil</h3>
              <p className="text-sm text-gray-500 mb-6">
                Data perhitungan fisik stok <strong className="text-gray-700">{successData.opname_number}</strong> telah disimpan ke sistem.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setFormOpnameNumber(`OPN-${Date.now().toString().slice(-6)}`)
                    setFormDate(new Date().toISOString().split('T')[0])
                    setFormNotes('')
                    setFormItems([])
                    setSuccessData(null)
                    // Keep modal open
                  }}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                >
                  Buat Data Lagi
                </button>
                <button
                  onClick={() => {
                    setSuccessData(null)
                    setIsModalOpen(false)
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                >
                  Selesai & Kembali
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </PageLayout>
  )
}
