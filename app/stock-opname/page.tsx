"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { PageLayout } from '@/components/ui/PageLayout'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { formatDisplayDate } from '@/lib/timeUtils'

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

type StockMove = {
  id: string
  created_at: string
  product_id: string
  type: string
  qty: number
  unit_cost: number | null
  origin_location_id: string | null
  destination_location_id: string | null
  reference: string | null
  source_type: string | null
  source_id: string | null
  system_stock: number
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

type OpnameDraft = {
  opname_number: string
  date: string
  notes: string
  items: OpnameItem[]
  updated_at: number
}

export default function StockOpnamePage() {
  const [opnames, setOpnames] = useState<StockOpname[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Sync & Caching state
  const [syncStatus, setSyncStatus] = useState<'cached' | 'live' | 'syncing'>('syncing')
  const [hasSavedDraft, setHasSavedDraft] = useState(false)
  const [savedDraftData, setSavedDraftData] = useState<OpnameDraft | null>(null)
  const [draftLastSavedTime, setDraftLastSavedTime] = useState<string | null>(null)

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedOpname, setSelectedOpname] = useState<StockOpname | null>(null)
  
  const [selectedOpnameMoves, setSelectedOpnameMoves] = useState<StockMove[]>([])
  const [movesLoading, setMovesLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<'fisik' | 'jurnal_stok' | 'jurnal_keuangan'>('fisik')

  // Success Modal State
  const [successData, setSuccessData] = useState<StockOpname | null>(null)

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
  const activeTimezone = activeBusiness?.timezone

  // 1. Initial SWR Read-Through from LocalStorage (0ms perceived load)
  useEffect(() => {
    if (!activeBizId) return

    // Read cached opnames list
    const cacheKey = `su_stock_opnames_${activeBizId}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setOpnames(parsed)
          setLoading(false)
          setSyncStatus('cached')
        }
      } catch (e) {
        console.warn('Failed to parse cached opnames:', e)
      }
    }

    // Read cached products catalog
    const prodCacheKey = `su_stock_products_${activeBizId}`
    const cachedProds = localStorage.getItem(prodCacheKey)
    if (cachedProds) {
      try {
        const parsedProds = JSON.parse(cachedProds)
        if (Array.isArray(parsedProds) && parsedProds.length > 0) {
          setProducts(parsedProds)
        }
      } catch (e) {
        console.warn('Failed to parse cached products:', e)
      }
    }

    // Check for unfinished draft
    const draftKey = `su_opname_draft_${activeBizId}`
    const draftRaw = localStorage.getItem(draftKey)
    if (draftRaw) {
      try {
        const parsedDraft = JSON.parse(draftRaw) as OpnameDraft
        if (parsedDraft && Array.isArray(parsedDraft.items) && parsedDraft.items.length > 0) {
          setSavedDraftData(parsedDraft)
          setHasSavedDraft(true)
        }
      } catch (e) {
        console.warn('Failed to parse draft:', e)
      }
    }
  }, [activeBizId])

  // 2. Network Fetch Opnames (Background Reconciliation)
  const fetchOpnames = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setSyncStatus('syncing')
    try {
      const res = await fetch('/api/stock-opname')
      if (!res.ok) throw new Error('Gagal memuat stock opname')
      const data = await res.json()
      if (Array.isArray(data)) {
        setOpnames(data)
        setSyncStatus('live')
        if (activeBizId) {
          try {
            localStorage.setItem(`su_stock_opnames_${activeBizId}`, JSON.stringify(data))
          } catch (e) {
            console.warn('Failed to store opnames in localStorage:', e)
          }
        }
      }
    } catch (err) {
      console.error('Error fetching opnames:', err)
    } finally {
      setLoading(false)
    }
  }, [activeBizId])

  useEffect(() => {
    fetchOpnames()
  }, [fetchOpnames])

  // 3. Network Fetch Products when activeBizId is available
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
        if (mounted && data) {
          setProducts(data)
          try {
            localStorage.setItem(`su_stock_products_${activeBizId}`, JSON.stringify(data))
          } catch (e) {
            console.warn('Failed to cache products:', e)
          }
        }
      } catch (err) {
        console.error('Error fetching products:', err)
      }
    }
    fetchProducts()
    
    return () => { mounted = false }
  }, [activeBizId])

  // 4. Auto-save Draft to LocalStorage (Debounced)
  useEffect(() => {
    if (!activeBizId || !isModalOpen) return
    if (formItems.length === 0 && !formNotes.trim()) return

    const timer = setTimeout(() => {
      try {
        const draft: OpnameDraft = {
          opname_number: formOpnameNumber,
          date: formDate,
          notes: formNotes,
          items: formItems,
          updated_at: Date.now()
        }
        localStorage.setItem(`su_opname_draft_${activeBizId}`, JSON.stringify(draft))
        setSavedDraftData(draft)
        setHasSavedDraft(true)
        setDraftLastSavedTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      } catch (e) {
        console.warn('Failed to auto-save opname draft:', e)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [activeBizId, isModalOpen, formOpnameNumber, formDate, formNotes, formItems])

  // Restore Draft
  const restoreDraft = useCallback(() => {
    if (!savedDraftData) return
    setFormOpnameNumber(savedDraftData.opname_number || `OPN-${Date.now().toString().slice(-6)}`)
    setFormDate(savedDraftData.date || new Date().toISOString().split('T')[0])
    setFormNotes(savedDraftData.notes || '')
    setFormItems(savedDraftData.items || [])
    setHasSavedDraft(false)
  }, [savedDraftData])

  // Discard Draft
  const discardDraft = useCallback(() => {
    if (!activeBizId) return
    try {
      localStorage.removeItem(`su_opname_draft_${activeBizId}`)
    } catch (e) {
      console.warn('Failed to remove draft:', e)
    }
    setSavedDraftData(null)
    setHasSavedDraft(false)
    setDraftLastSavedTime(null)
  }, [activeBizId])

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
    // If no active draft is in form, generate fresh number
    if (formItems.length === 0) {
      setFormOpnameNumber(`OPN-${Date.now().toString().slice(-6)}`)
      setFormDate(new Date().toISOString().split('T')[0])
      setFormNotes('')
      setFormItems([])
    }
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

  // Load all remaining products at once
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
    const qty = parseInt(val, 10)
    const updated = formItems.map(item => {
      if (item.product_id === product_id) {
        return { ...item, actual_quantity: isNaN(qty) ? 0 : Math.max(0, qty) }
      }
      return item
    })
    setFormItems(updated)
  }

  // Stepper increment / decrement
  const incrementQty = (product_id: string) => {
    setFormItems(prev => prev.map(item => {
      if (item.product_id === product_id) {
        return { ...item, actual_quantity: (item.actual_quantity || 0) + 1 }
      }
      return item
    }))
  }

  const decrementQty = (product_id: string) => {
    setFormItems(prev => prev.map(item => {
      if (item.product_id === product_id) {
        return { ...item, actual_quantity: Math.max(0, (item.actual_quantity || 0) - 1) }
      }
      return item
    }))
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

      // Optimistic Update List & LocalStorage Cache
      setOpnames(prev => {
        const updated = [newOpname, ...prev]
        if (activeBizId) {
          try {
            localStorage.setItem(`su_stock_opnames_${activeBizId}`, JSON.stringify(updated))
          } catch (e) {
            console.warn('Failed to update opnames cache:', e)
          }
        }
        return updated
      })

      // Clear draft since it is successfully recorded
      discardDraft()
      
      // Success flow
      setSuccessData(newOpname)

    } catch (err: unknown) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan stock opname'
      alert(msg)
    } finally {
      setSubmitLoading(false)
    }
  }

  // View Details modal
  const openDetailModal = async (opname: StockOpname) => {
    setSelectedOpname(opname)
    setDetailTab('fisik')
    setIsDetailOpen(true)
    setSelectedOpnameMoves([])
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
      console.error('Error fetching stock moves:', err)
    } finally {
      setMovesLoading(false)
    }
  }

  // Filter opnames by search
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

  // Calculation helpers for Form summary
  const formStats = useMemo(() => {
    let excessCount = 0
    let shrinkageCount = 0
    let matchCount = 0

    for (const item of formItems) {
      const diff = item.actual_quantity - item.recorded_quantity
      if (diff > 0) excessCount++
      else if (diff < 0) shrinkageCount++
      else matchCount++
    }

    return { excessCount, shrinkageCount, matchCount, total: formItems.length }
  }, [formItems])

  const formatCurrency = (val: number) => `Rp ${Math.round(val || 0).toLocaleString('id-ID')}`

  return (
    <PageLayout
      title="Stock Opname"
      description="Lakukan perhitungan fisik stok di gudang secara berkala untuk mencocokkan jumlah sistem serta catat selisih penyusutan."
      width="xl"
      eyebrow={
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
            Produk & Inventori
          </span>
          {activeBizName && (
            <span className="text-[9px] font-black tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 uppercase">
              📍 {activeBizName}
            </span>
          )}
        </div>
      }
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchOpnames(true)}
            className="p-2 md:px-3 md:py-2 text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 rounded-lg border border-gray-200 shadow-2xs transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
            title="Segarkan data dari server"
          >
            <span>🔄</span>
            <span className="hidden md:inline">Segarkan</span>
          </button>
          <button
            onClick={openAddModal}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
          >
            <span>➕</span>
            <span className="hidden sm:inline">Mulai Stock Opname</span>
            <span className="sm:hidden">Opname Baru</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4 pb-20 md:pb-6 animate-in fade-in duration-300">
        
        {/* Unsaved Draft Banner (Resilience notification) */}
        {hasSavedDraft && savedDraftData && !isModalOpen && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-xs animate-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl shrink-0">🛡️</span>
              <div>
                <p className="font-extrabold text-amber-900">Draf Stock Opname Tersimpan</p>
                <p className="text-amber-700 text-[11px] font-medium mt-0.5">
                  Tersimpan draf perhitungan fisik belum selesai (<strong>{savedDraftData.items?.length || 0} barang</strong>, {savedDraftData.opname_number}).
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                onClick={() => {
                  restoreDraft()
                  setIsModalOpen(true)
                }}
                className="flex-1 sm:flex-none px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] uppercase tracking-wider rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
              >
                Lanjutkan Draf
              </button>
              <button
                onClick={discardDraft}
                className="px-3 py-2 bg-white hover:bg-amber-100 text-amber-800 font-bold text-[11px] uppercase tracking-wider rounded-lg border border-amber-300 transition-colors cursor-pointer"
              >
                Buang
              </button>
            </div>
          </div>
        )}

        {/* Sync Status Badge & Search Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            {syncStatus === 'cached' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                <span className="animate-pulse">⚡</span> Sync: Tampil dari Cache (0ms)
              </span>
            )}
            {syncStatus === 'live' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                ✓ Live Database
              </span>
            )}
            {syncStatus === 'syncing' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                <span className="animate-spin">🔄</span> Menyinkronkan...
              </span>
            )}
          </div>
          <span className="text-[11px] font-bold text-gray-500">
            Total {filteredOpnames.length} Dokumen
          </span>
        </div>

        {/* Search Bar */}
        <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-xs px-3.5 py-2.5">
          <span className="text-gray-400 mr-2.5 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Cari berdasarkan No. Dokumen, Catatan, atau Nama Produk..."
            className="flex-1 bg-transparent text-xs font-semibold text-gray-800 outline-none placeholder:text-gray-400 py-0.5"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="text-gray-400 hover:text-gray-600 text-xs font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Content Section: Skeleton / Empty / Dual-View List */}
        {loading && opnames.length === 0 ? (
          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
              Memuat data stock opname...
            </div>
          </div>
        ) : opnames.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-xs">
            <span className="text-4xl block mb-2">📝</span>
            <h3 className="text-sm font-extrabold text-gray-800 uppercase tracking-wide">Belum ada stock opname</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              Lakukan perhitungan fisik stok pertama Anda untuk mencocokkan kuantitas produk gudang dengan saldo sistem.
            </p>
            <button
              onClick={openAddModal}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all inline-flex items-center gap-2 cursor-pointer active:scale-95"
            >
              ➕ Mulai Opname Sekarang
            </button>
          </div>
        ) : filteredOpnames.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-xs italic">
            Tidak ada dokumen stock opname yang cocok dengan kata kunci &quot;{searchQuery}&quot;
          </div>
        ) : (
          <div>
            {/* DESKTOP TABLE VIEW (hidden on mobile, block on md:) */}
            <div className="hidden md:block bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                    <th className="p-4">No. Dokumen</th>
                    <th className="p-4">Tanggal</th>
                    <th className="p-4">Catatan / Memo</th>
                    <th className="p-4">Jumlah Produk</th>
                    <th className="p-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                  {filteredOpnames.map(o => {
                    const itemsCount = Array.isArray(o.items_json) ? o.items_json.length : 0
                    return (
                      <tr key={o.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 font-bold text-gray-900 font-mono">{o.opname_number}</td>
                        <td className="p-4 text-gray-600">
                          📅 {formatDisplayDate(o.date, 'short', activeTimezone)}
                        </td>
                        <td className="p-4 text-gray-500 max-w-xs truncate">{o.notes || '-'}</td>
                        <td className="p-4">
                          <span className="bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full border border-slate-200 text-[10px] font-bold">
                            {itemsCount} Produk
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => openDetailModal(o)}
                            className="px-3 py-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
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

            {/* MOBILE CARD VIEW (block on mobile, hidden on md:) */}
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {filteredOpnames.map(o => {
                const itemsCount = Array.isArray(o.items_json) ? o.items_json.length : 0
                return (
                  <div 
                    key={o.id}
                    onClick={() => openDetailModal(o)}
                    className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs space-y-3 active:bg-gray-50/80 transition-colors cursor-pointer"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-extrabold text-sm text-gray-900 font-mono tracking-tight">
                          {o.opname_number}
                        </div>
                        <div className="text-[11px] font-semibold text-gray-500 mt-0.5 flex items-center gap-1">
                          <span>📅</span>
                          <span>{formatDisplayDate(o.date, 'short', activeTimezone)}</span>
                        </div>
                      </div>
                      <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                        {itemsCount} Produk
                      </span>
                    </div>

                    {o.notes && (
                      <p className="text-xs text-gray-600 font-medium line-clamp-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                        {o.notes}
                      </p>
                    )}

                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {o.transaction_id ? '✓ Jurnal Terposting' : 'Tanpa Penyesuaian'}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetailModal(o)
                        }}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] uppercase tracking-wider rounded-lg border border-blue-200 transition-colors flex items-center gap-1 cursor-pointer min-h-[36px]"
                      >
                        <span>👁️ Lihat Hasil</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* MOBILE STICKY FLOATING ACTION BUTTON */}
        <div className="md:hidden fixed bottom-4 right-4 left-4 z-20">
          <button
            onClick={openAddModal}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
          >
            <span>➕</span>
            <span>Mulai Stock Opname</span>
          </button>
        </div>

        {/* ----------------- CREATE MODAL ----------------- */}
        <FullScreenModal
          isOpen={isModalOpen && !successData}
          onClose={() => setIsModalOpen(false)}
          title="📝 Form Input Perhitungan Fisik (Stock Opname)"
          description="Hitung stok fisik di gudang dan catat selisih untuk penyesuaian otomatis ke kartu stok & akuntansi."
          desktopSize="xl"
          footer={
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5 w-full">
              <div className="text-xs font-semibold text-gray-500 hidden sm:block">
                {formItems.length > 0 && (
                  <span>
                    {formStats.total} Barang ({formStats.matchCount} Pas, {formStats.excessCount} Lebih, {formStats.shrinkageCount} Susut)
                  </span>
                )}
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 sm:flex-none px-4 py-2.5 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer min-h-[44px]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitLoading || formItems.length === 0}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer min-h-[44px]"
                >
                  {submitLoading ? 'Menyimpan...' : 'Simpan Opname'}
                </button>
              </div>
            </div>
          }
        >
          <div className="p-4 sm:p-6 space-y-4">
            
            {/* Draft auto-save indicator */}
            {draftLastSavedTime && (
              <div className="flex items-center justify-between bg-blue-50/70 border border-blue-100 rounded-lg px-3 py-1.5 text-[11px] text-blue-700 font-medium">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Draf tersimpan otomatis di perangkat ({draftLastSavedTime})
                </span>
                <button
                  type="button"
                  onClick={discardDraft}
                  className="text-blue-900 font-bold hover:underline cursor-pointer"
                >
                  Reset Form
                </button>
              </div>
            )}

            {/* Document Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  No. Dokumen Opname *
                </label>
                <input
                  type="text"
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white font-mono"
                  value={formOpnameNumber}
                  onChange={e => setFormOpnameNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  Tanggal Perhitungan *
                </label>
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
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Catatan / Memo Penyesuaian
              </label>
              <input
                type="text"
                placeholder="Contoh: Penyesuaian stok triwulan II, barang rusak di gudang"
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
              />
            </div>

            {/* Product Items Section */}
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-600">
                    Daftar Produk Fisik Dihitung ({formItems.length})
                  </h4>
                  <p className="text-[11px] text-gray-400 font-medium">
                    Pilih produk yang ingin di-opname lalu masukkan jumlah fisik aktual.
                  </p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={openSelectorModal}
                    className="flex-1 sm:flex-none px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 min-h-[40px]"
                  >
                    <span>🔍 Cari & Pilih Produk</span>
                    <span className="bg-blue-800/60 px-1.5 py-0.2 rounded-full text-[10px]">
                      {formItems.length}
                    </span>
                  </button>
                  {availableProducts.length > 0 && (
                    <button
                      type="button"
                      onClick={handleLoadAllProducts}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer min-h-[40px]"
                      title="Tambah seluruh produk sekaligus"
                    >
                      ⚡ Muat Semua ({availableProducts.length})
                    </button>
                  )}
                </div>
              </div>

              {products.length === 0 ? (
                <p className="text-xs text-gray-400 italic text-center py-6">
                  Tidak ada produk fisik bertipe stock-tracked dalam sistem bisnis ini.
                </p>
              ) : formItems.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center bg-slate-50/50 space-y-2">
                  <span className="text-3xl block">📦</span>
                  <h5 className="text-xs font-extrabold text-gray-700 uppercase tracking-wide">
                    Belum Ada Produk Dipilih
                  </h5>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    Klik tombol di bawah untuk membuka popup pencarian dan memilih produk yang sedang dihitung di gudang.
                  </p>
                  <button
                    type="button"
                    onClick={openSelectorModal}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-xs transition-all inline-flex items-center gap-2 cursor-pointer active:scale-95 mt-2 min-h-[40px]"
                  >
                    🔍 Pilih Produk Untuk Dihitung
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  
                  {/* Summary Metric Chips */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-gray-500">Ringkasan:</span>
                    <span className="bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-800">
                      Total: {formStats.total}
                    </span>
                    <span className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-emerald-700">
                      Lebih: {formStats.excessCount}
                    </span>
                    <span className="bg-rose-50 border border-rose-200 px-2 py-0.5 rounded text-rose-700">
                      Susut: {formStats.shrinkageCount}
                    </span>
                    <span className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                      Pas: {formStats.matchCount}
                    </span>
                  </div>

                  {/* DESKTOP TABLE VIEW FOR FORM ITEMS (hidden on md:, block on desktop) */}
                  <div className="hidden md:block border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          <th className="p-3">Nama Produk</th>
                          <th className="p-3 text-center">Stok Sistem</th>
                          <th className="p-3 text-center w-36">Stok Fisik Aktual</th>
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
                              <td className="p-3 text-center text-gray-500 font-medium">
                                {item.recorded_quantity}
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => decrementQty(item.product_id)}
                                    className="w-7 h-7 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded cursor-pointer flex items-center justify-center"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    inputMode="numeric"
                                    required
                                    className="w-16 p-1 border border-gray-300 rounded text-center font-bold text-gray-900 bg-white"
                                    value={item.actual_quantity}
                                    onChange={e => handleActualQtyChange(item.product_id, e.target.value)}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => incrementQty(item.product_id)}
                                    className="w-7 h-7 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded cursor-pointer flex items-center justify-center"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="p-3 text-right font-bold">
                                {diff === 0 && <span className="text-gray-400">0 (Pas)</span>}
                                {diff > 0 && <span className="text-emerald-600">+{diff} (Lebih)</span>}
                                {diff < 0 && <span className="text-rose-500">{diff} (Susut)</span>}
                              </td>
                              <td className="p-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveProduct(item.product_id)}
                                  className="text-gray-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
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

                  {/* MOBILE CARDS VIEW FOR FORM ITEMS (block on mobile, hidden on md:) */}
                  <div className="grid grid-cols-1 gap-2.5 md:hidden">
                    {formItems.map(item => {
                      const diff = item.actual_quantity - item.recorded_quantity
                      return (
                        <div 
                          key={item.product_id}
                          className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-2xs space-y-3"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <h5 className="font-extrabold text-xs text-gray-900 leading-snug">
                                {item.name}
                              </h5>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                Stok Sistem: <strong>{item.recorded_quantity} pcs</strong>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveProduct(item.product_id)}
                              className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 hover:text-rose-600 border border-gray-200 flex items-center justify-center text-sm cursor-pointer"
                              title="Hapus item"
                            >
                              🗑️
                            </button>
                          </div>

                          {/* Stepper Control and Visual Difference */}
                          <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => decrementQty(item.product_id)}
                                className="w-10 h-10 bg-slate-100 active:bg-slate-200 text-slate-800 font-extrabold text-lg rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer select-none"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="0"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                required
                                className="w-16 h-10 border border-gray-300 rounded-lg text-center font-black text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                                value={item.actual_quantity}
                                onChange={e => handleActualQtyChange(item.product_id, e.target.value)}
                              />
                              <button
                                type="button"
                                onClick={() => incrementQty(item.product_id)}
                                className="w-10 h-10 bg-blue-50 active:bg-blue-100 text-blue-700 font-extrabold text-lg rounded-lg border border-blue-200 flex items-center justify-center cursor-pointer select-none"
                              >
                                +
                              </button>
                            </div>

                            <div className="text-right">
                              {diff === 0 && (
                                <span className="inline-block text-[10px] font-bold px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                  Pas (0)
                                </span>
                              )}
                              {diff > 0 && (
                                <span className="inline-block text-[10px] font-extrabold px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  ▲ +{diff} (Lebih)
                                </span>
                              )}
                              {diff < 0 && (
                                <span className="inline-block text-[10px] font-extrabold px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200">
                                  ▼ {diff} (Susut)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                </div>
              )}
            </div>

          </div>
        </FullScreenModal>

        {/* ----------------- PRODUCT SELECTOR SUB-MODAL ----------------- */}
        <FullScreenModal
          isOpen={isSelectorOpen}
          onClose={() => setIsSelectorOpen(false)}
          title={`🔍 Cari & Pilih Produk Fisik (${tempSelectedIds.length} Dipilih)`}
          description="Centang produk yang ingin dimasukkan ke dalam daftar perhitungan stok opname."
          desktopSize="lg"
          footer={
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5 w-full">
              <span className="text-xs font-bold text-gray-600">
                {tempSelectedIds.length} produk terpilih
              </span>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsSelectorOpen(false)}
                  className="flex-1 sm:flex-none px-4 py-2.5 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-100 transition-colors cursor-pointer min-h-[44px]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={confirmSelector}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 cursor-pointer min-h-[44px]"
                >
                  Gunakan Produk Dipilih ({tempSelectedIds.length})
                </button>
              </div>
            </div>
          }
        >
          <div className="flex flex-col h-full space-y-3 p-3.5 sm:p-4">
            <div className="relative shrink-0">
              <input
                type="text"
                placeholder="🔍 Ketik nama produk atau SKU..."
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
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-md border border-blue-100 uppercase tracking-wider cursor-pointer"
                >
                  ☑️ Pilih Semua ({selectorFilteredProducts.length})
                </button>
                <button
                  type="button"
                  onClick={deselectAllFiltered}
                  className="text-[10px] font-bold text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-md border border-gray-200 uppercase tracking-wider cursor-pointer"
                >
                  🟩 Batal Pilih
                </button>
              </div>
              <span className="text-[11px] font-bold text-gray-500">
                {tempSelectedIds.length} / {products.length}
              </span>
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-gray-100 min-h-[300px] border border-gray-200 rounded-xl bg-gray-50 p-1.5 sm:p-2">
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
                      className={`p-3 rounded-lg transition-all cursor-pointer flex justify-between items-center my-1 border select-none ${
                        isChecked
                          ? 'bg-blue-50/90 border-blue-200 text-blue-900 shadow-2xs'
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
                      <div className="text-right shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
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

        {/* ----------------- DETAIL MODAL ----------------- */}
        <FullScreenModal
          isOpen={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          title="👁️ Rincian Hasil Stock Opname & Jurnal"
          desktopSize="lg"
          footer={
            <div className="flex justify-end w-full">
              <button
                onClick={() => setIsDetailOpen(false)}
                className="w-full sm:w-auto px-5 py-2.5 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer min-h-[44px]"
              >
                Tutup
              </button>
            </div>
          }
        >
          {selectedOpname && (
            <div className="p-4 sm:p-6 space-y-4">
              
              {/* Document Overview Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-bold text-gray-700 bg-gray-50 p-3.5 rounded-lg border border-gray-200">
                <div>No. Dokumen:
                  <div className="text-gray-900 font-mono mt-0.5">{selectedOpname.opname_number}</div>
                </div>
                <div>Tanggal:
                  <div className="text-gray-900 mt-0.5">
                    📅 {formatDisplayDate(selectedOpname.date, 'short', activeTimezone)}
                  </div>
                </div>
                <div className="col-span-2 md:col-span-2">Status Ledger:
                  <div className="mt-0.5">
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
                </div>
                {selectedOpname.notes && (
                  <div className="col-span-2 md:col-span-4 border-t border-gray-200 pt-2.5 mt-0.5">
                    Memo/Keterangan:
                    <div className="text-gray-600 font-medium italic break-words mt-0.5">{selectedOpname.notes}</div>
                  </div>
                )}
              </div>

              {/* Responsive Tabs */}
              <div className="flex border-b border-gray-200 space-x-4 overflow-x-auto">
                <button 
                  onClick={() => setDetailTab('fisik')}
                  className={`pb-2.5 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap cursor-pointer ${
                    detailTab === 'fisik' 
                      ? 'text-blue-600 border-b-2 border-blue-600' 
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  📦 Fisik
                </button>
                <button 
                  onClick={() => setDetailTab('jurnal_stok')}
                  className={`pb-2.5 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap cursor-pointer ${
                    detailTab === 'jurnal_stok' 
                      ? 'text-blue-600 border-b-2 border-blue-600' 
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  📊 Jurnal Stok
                </button>
                <button 
                  onClick={() => setDetailTab('jurnal_keuangan')}
                  className={`pb-2.5 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap cursor-pointer ${
                    detailTab === 'jurnal_keuangan' 
                      ? 'text-blue-600 border-b-2 border-blue-600' 
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  📒 Jurnal Keuangan
                </button>
              </div>

              {/* TAB 1: FISIK */}
              {detailTab === 'fisik' && (
                <div className="space-y-3 animate-in fade-in duration-200">
                  {/* Desktop Table View */}
                  <div className="hidden md:block border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold uppercase">
                        <tr>
                          <th className="p-3">Nama Barang</th>
                          <th className="p-3 text-center">Sistem</th>
                          <th className="p-3 text-center">Fisik</th>
                          <th className="p-3 text-right">Selisih</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-semibold text-gray-700">
                        {(Array.isArray(selectedOpname.items_json) ? selectedOpname.items_json : []).map((item, idx) => {
                          const diff = item.actual_quantity - item.recorded_quantity
                          return (
                            <tr key={idx} className="hover:bg-gray-50/50">
                              <td className="p-3 font-bold text-gray-900">{item.name}</td>
                              <td className="p-3 text-center text-gray-400">{item.recorded_quantity}</td>
                              <td className="p-3 text-center text-gray-950 font-bold">{item.actual_quantity}</td>
                              <td className="p-3 text-right">
                                {diff === 0 && <span className="text-gray-400">-</span>}
                                {diff > 0 && <span className="text-emerald-600 font-bold">+{diff} (Lebih)</span>}
                                {diff < 0 && <span className="text-rose-500 font-bold">{diff} (Susut)</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="grid grid-cols-1 gap-2.5 md:hidden">
                    {(Array.isArray(selectedOpname.items_json) ? selectedOpname.items_json : []).map((item, idx) => {
                      const diff = item.actual_quantity - item.recorded_quantity
                      return (
                        <div key={idx} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                          <div className="font-bold text-xs text-gray-900">{item.name}</div>
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-100">
                            <div className="text-[11px] text-gray-500">
                              Sistem: <span className="font-semibold text-gray-700">{item.recorded_quantity}</span> | Fisik: <span className="font-bold text-gray-950">{item.actual_quantity}</span>
                            </div>
                            <div>
                              {diff === 0 && <span className="text-[10px] font-bold text-gray-400">0 (Pas)</span>}
                              {diff > 0 && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">+{diff} (Lebih)</span>}
                              {diff < 0 && <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">{diff} (Susut)</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* TAB 2: JURNAL STOK */}
              {detailTab === 'jurnal_stok' && (
                <div className="space-y-3 animate-in fade-in duration-200">
                  {movesLoading ? (
                    <div className="text-center p-6 text-xs text-gray-500 font-medium">Memuat kartu stok mutasi...</div>
                  ) : selectedOpnameMoves.length === 0 ? (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500 font-medium">
                      Tidak ada mutasi stok yang dicatat (jumlah fisik sama dengan sistem).
                    </div>
                  ) : (
                    <div>
                      {/* Desktop Table View */}
                      <div className="hidden md:block border border-gray-200 rounded-lg overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
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
                              const prodName = products.find(p => p.id === move.product_id)?.name || 'Produk'
                              const isNegative = move.origin_location_id !== null
                              const qtyDisplay = isNegative ? `-${move.qty}` : `+${move.qty}`
                              const qtyColor = isNegative ? 'text-rose-500' : 'text-emerald-600'
                              
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

                      {/* Mobile Cards View */}
                      <div className="grid grid-cols-1 gap-2.5 md:hidden">
                        {selectedOpnameMoves.map(move => {
                          const prodName = products.find(p => p.id === move.product_id)?.name || 'Produk'
                          const isNegative = move.origin_location_id !== null
                          const qtyDisplay = isNegative ? `-${move.qty}` : `+${move.qty}`
                          const qtyColor = isNegative ? 'text-rose-600 bg-rose-50 border-rose-100' : 'text-emerald-700 bg-emerald-50 border-emerald-100'

                          return (
                            <div key={move.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                              <div className="flex justify-between items-start gap-2">
                                <div className="font-bold text-xs text-gray-900">{prodName}</div>
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${qtyColor}`}>
                                  {qtyDisplay}
                                </span>
                              </div>
                              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-gray-100 text-gray-500">
                                <span className="uppercase text-[9px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded">
                                  {move.type}
                                </span>
                                <span>
                                  Saldo Sistem: <strong className="text-gray-900 font-mono">{move.system_stock}</strong>
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: JURNAL KEUANGAN */}
              {detailTab === 'jurnal_keuangan' && (
                <div className="space-y-3 animate-in fade-in duration-200">
                  {selectedOpname.transactions?.journal_lines && selectedOpname.transactions.journal_lines.length > 0 ? (
                    <div>
                      {/* Desktop Table View */}
                      <div className="hidden md:block border border-gray-200 rounded-lg overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
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
                              const name = jl.accounts?.name || 'Akun'
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
                                    {debit > 0 ? formatCurrency(debit) : '-'}
                                  </td>
                                  <td className="p-3 text-right font-mono text-gray-900 font-semibold">
                                    {credit > 0 ? formatCurrency(credit) : '-'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot className="bg-slate-50 border-t border-gray-200 text-xs font-bold text-gray-900">
                            <tr>
                              <td className="p-3 uppercase text-[10px] tracking-wider text-gray-500">Total Balancing</td>
                              <td className="p-3 text-right font-mono text-emerald-700">
                                {formatCurrency(selectedOpname.transactions.journal_lines.reduce((s, l) => s + (l.debit || 0), 0))}
                              </td>
                              <td className="p-3 text-right font-mono text-emerald-700">
                                {formatCurrency(selectedOpname.transactions.journal_lines.reduce((s, l) => s + (l.credit || 0), 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* Mobile Cards View */}
                      <div className="space-y-2.5 md:hidden">
                        {selectedOpname.transactions.journal_lines.map((jl) => {
                          const code = jl.accounts?.code || '---'
                          const name = jl.accounts?.name || 'Akun'
                          const debit = jl.debit || 0
                          const credit = jl.credit || 0
                          return (
                            <div key={jl.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
                              <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                                <span className="font-mono text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                  [{code}]
                                </span>
                                <span>{name}</span>
                              </div>
                              <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-100">
                                <span className="text-[11px] text-gray-500">
                                  {debit > 0 ? 'Posisi: Debet' : 'Posisi: Kredit'}
                                </span>
                                <span className="font-mono font-bold text-gray-900">
                                  {debit > 0 ? formatCurrency(debit) : formatCurrency(credit)}
                                </span>
                              </div>
                            </div>
                          )
                        })}

                        {/* Mobile Balancing summary card */}
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center text-xs font-bold text-gray-900">
                          <span className="uppercase text-[10px] text-gray-500">Total Balancing</span>
                          <span className="font-mono text-emerald-700">
                            {formatCurrency(selectedOpname.transactions.journal_lines.reduce((s, l) => s + (l.debit || 0), 0))}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500 font-medium">
                      Tidak ada entri jurnal keuangan yang dibuat untuk hasil opname ini (selisih stok = 0).
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </FullScreenModal>

        {/* ----------------- SUCCESS MODAL OVERLAY ----------------- */}
        {successData && (
          <div className="fixed inset-0 z-[60] bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
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
                    // Keep modal open for continuous entry
                  }}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer min-h-[44px]"
                >
                  Buat Data Lagi
                </button>
                <button
                  onClick={() => {
                    setSuccessData(null)
                    setIsModalOpen(false)
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer min-h-[44px]"
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
