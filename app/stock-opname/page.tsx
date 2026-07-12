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
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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

  // Open creation modal and pre-load form items from current products list
  const openAddModal = () => {
    setFormOpnameNumber(`OPN-${Date.now().toString().slice(-6)}`)
    setFormDate(new Date().toISOString().split('T')[0])
    setFormNotes('')
    
    // Auto populate count rows with currently tracked physical products
    const initialItems = products.map(p => ({
      product_id: p.id,
      name: p.name,
      recorded_quantity: p.stock_quantity || 0,
      actual_quantity: p.stock_quantity || 0
    }))
    
    setFormItems(initialItems)
    setIsModalOpen(true)
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

    // Find any changes to justify posting
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
      
      {/* Page Header */}
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

      {/* Stock Opname History */}
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

      {/* Perform Opname Modal */}
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

              {/* Items Table */}
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Daftar Stok Produk Fisik</h4>

                {products.length === 0 ? (
                  <p className="text-xs text-gray-400 italic text-center py-4">Tidak ada produk fisik bertipe stock-tracked untuk dihitung.</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          <th className="p-3">Nama Produk</th>
                          <th className="p-3 text-center">Stok Sistem</th>
                          <th className="p-3 text-center w-28">Stok Fisik</th>
                          <th className="p-3 text-right">Selisih</th>
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
                  disabled={submitLoading || products.length === 0}
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

      {/* Details View Modal */}
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
