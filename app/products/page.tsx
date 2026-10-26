"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import ProductModal from './components/ProductModal'
import { useUserContext } from '@/components/UserContext'
import Link from 'next/link'

type Category = {
  id: string
  name: string
}

type Product = {
  id: string
  business_id: string
  name: string
  sku: string | null
  description: string | null
  price: number
  cost_price: number // HPP / Harga Modal Beli
  type: 'physical' | 'service'
  category_id: string | null
  stock_type: 'tracked' | 'available' | 'unavailable'
  stock_quantity: number
  unit?: string
  hpp_type?: 'fixed' | 'variable'
  created_at: string
  categories?: Category | Category[] | null // Supabase join
}

type ProductCachePayload = {
  products: Product[]
  categories: Category[]
  ts: number
  businessId: string
}

type SortField = 'sku' | 'name' | 'category' | 'type' | 'stock_type' | 'stock_quantity' | 'cost_price' | 'price'
type SortOrder = 'asc' | 'desc' | null

interface ToastState {
  id: number
  message: string
  type: 'success' | 'error' | 'loading' | 'warning'
}

interface DeleteModalState {
  isOpen: boolean
  mode: 'selected' | 'all' | 'single'
  singleProduct?: Product | null
  forceStockCleanup: boolean
  confirmText: string
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 menit
const STALE_RECHECK = 2 * 60 * 1000 // 2 menit

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Filters State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedStockType, setSelectedStockType] = useState('')

  // Sorting State
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>(null)

  // Selection State for Bulk Actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null)

  // Add/Edit Product Modal Control
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // Delete Confirmation Modal Control
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    isOpen: false,
    mode: 'selected',
    singleProduct: null,
    forceStockCleanup: false,
    confirmText: ''
  })

  // Toast Notification State
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, type: ToastState['type'] = 'success', duration = 4000) => {
    const id = Date.now()
    setToast({ id, message, type })
    if (type !== 'loading') {
      setTimeout(() => {
        setToast(current => (current?.id === id ? null : current))
      }, duration)
    }
  }, [])

  // Cache functions
  const readCache = (bid: string): ProductCachePayload | null => {
    try {
      const raw = sessionStorage.getItem(`su_products_data_${bid}`)
      if (!raw) return null
      const parsed: ProductCachePayload = JSON.parse(raw)
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null
      return parsed
    } catch {
      return null
    }
  }

  const writeCache = (bid: string, prods: Product[], cats: Category[]) => {
    try {
      const payload: ProductCachePayload = {
        products: prods,
        categories: cats,
        ts: Date.now(),
        businessId: bid
      }
      sessionStorage.setItem(`su_products_data_${bid}`, JSON.stringify(payload))
    } catch {
      // ignore silently if storage is full
    }
  }

  // Fetch Products & Categories
  const fetchProductsAndCategories = useCallback(async (businessId: string, background = false) => {
    if (!background) setLoading(true)
    try {
      // 1. Fetch categories
      const { data: catData, error: catErr } = await supabase
        .from('categories')
        .select('*')
        .eq('business_id', businessId)
        .order('name', { ascending: true })

      if (catErr) throw catErr
      const fetchedCats = catData || []
      setCategories(fetchedCats)

      // 2. Fetch products with categories join
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .select('*, categories(id, name)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })

      if (prodErr) throw prodErr
      const fetchedProds = prodData || []
      setProducts(fetchedProds)

      // Save to cache
      writeCache(businessId, fetchedProds, fetchedCats)
    } catch (err) {
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  const { activeBusiness, bizLoading, isOwner, currentUserRole, currentUserPermissions } = useUserContext()

  // RBAC Permission Resolution
  const isAdmin = useMemo(() => {
    return isOwner || currentUserRole === 'admin' || (currentUserPermissions && currentUserPermissions.includes('full_access'))
  }, [isOwner, currentUserRole, currentUserPermissions])

  const canDeleteProducts = useMemo(() => {
    return isAdmin || (currentUserPermissions && currentUserPermissions.includes('manage_products'))
  }, [isAdmin, currentUserPermissions])

  const canPurgeAllProducts = isAdmin

  // Fetch initial profile & active business ID from UserContext
  useEffect(() => {
    if (bizLoading) return
    if (activeBusiness?.id) {
      const businessId = activeBusiness.id
      setActiveBizId(businessId)
      setActiveBizName(activeBusiness.name || 'Bisnis Saya')

      // Cache-first strategy
      const cached = readCache(businessId)
      if (cached) {
        setProducts(cached.products)
        setCategories(cached.categories)
        setLoading(false)

        // Revalidate in background if stale
        const age = Date.now() - cached.ts
        if (age > STALE_RECHECK) {
          fetchProductsAndCategories(businessId, true)
        }
      } else {
        // No cache - full fetch
        fetchProductsAndCategories(businessId, false)
      }
    }
  }, [activeBusiness, bizLoading, fetchProductsAndCategories])

  // Formatting price helper
  const formatPrice = useCallback((val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val)
  }, [])

  const getCategoryName = useCallback((product: Product) => {
    if (!product.categories) return '-'
    const cat = Array.isArray(product.categories) ? product.categories[0] : product.categories
    return cat?.name || '-'
  }, [])

  // Trigger refresh (e.g. after add/edit)
  const refreshData = () => {
    if (activeBizId) {
      fetchProductsAndCategories(activeBizId, false)
    }
  }

  // Header Column Sort Handler (Tri-state: asc -> desc -> reset)
  const handleSort = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field)
      setSortOrder('asc')
    } else if (sortOrder === 'asc') {
      setSortOrder('desc')
    } else if (sortOrder === 'desc') {
      setSortField(null)
      setSortOrder(null)
    } else {
      setSortOrder('asc')
    }
  }

  // Render Sortable Header Th
  const renderSortHeader = (label: string, field: SortField, className = '') => {
    const isActive = sortField === field
    return (
      <th
        key={field}
        onClick={() => handleSort(field)}
        className={`p-4 cursor-pointer select-none group transition-colors hover:bg-gray-100/90 ${className}`}
        title={`Klik untuk mengurutkan berdasarkan ${label}`}
      >
        <div className="flex items-center gap-1.5">
          <span className={isActive ? 'text-blue-600 font-extrabold' : 'text-gray-500 font-bold'}>
            {label}
          </span>
          <span className="text-[10px] leading-none inline-flex items-center">
            {isActive ? (
              sortOrder === 'asc' ? (
                <span className="text-blue-600 font-bold">▲</span>
              ) : (
                <span className="text-blue-600 font-bold">▼</span>
              )
            ) : (
              <span className="text-gray-300 group-hover:text-gray-500 font-normal">↕</span>
            )}
          </span>
        </div>
      </th>
    )
  }

  // Filtered & Sorted Products list
  const filteredProducts = useMemo(() => {
    const filtered = products.filter(p => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.sku || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(searchQuery.toLowerCase())

      const matchesCategory = selectedCategory ? p.category_id === selectedCategory : true
      const matchesType = selectedType ? p.type === selectedType : true
      const matchesStockType = selectedStockType ? p.stock_type === selectedStockType : true

      return matchesSearch && matchesCategory && matchesType && matchesStockType
    })

    if (!sortField || !sortOrder) {
      return filtered
    }

    return [...filtered].sort((a, b) => {
      let comparison = 0

      switch (sortField) {
        case 'sku': {
          const skuA = (a.sku || '').trim().toLowerCase()
          const skuB = (b.sku || '').trim().toLowerCase()
          if (!skuA && !skuB) comparison = 0
          else if (!skuA) comparison = 1
          else if (!skuB) comparison = -1
          else comparison = skuA.localeCompare(skuB, 'id', { numeric: true, sensitivity: 'base' })
          break
        }
        case 'name': {
          comparison = a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
          break
        }
        case 'category': {
          const catA = getCategoryName(a).toLowerCase()
          const catB = getCategoryName(b).toLowerCase()
          comparison = catA.localeCompare(catB, 'id', { sensitivity: 'base' })
          break
        }
        case 'type': {
          comparison = a.type.localeCompare(b.type)
          break
        }
        case 'stock_type': {
          // Sort order preference: tracked -> available -> unavailable
          const stockTypePriority: Record<string, number> = { tracked: 1, available: 2, unavailable: 3 }
          const prioA = stockTypePriority[a.stock_type] || 99
          const prioB = stockTypePriority[b.stock_type] || 99
          comparison = prioA - prioB
          break
        }
        case 'stock_quantity': {
          const qtyA = a.stock_type === 'tracked' ? a.stock_quantity : -Infinity
          const qtyB = b.stock_type === 'tracked' ? b.stock_quantity : -Infinity
          comparison = qtyA - qtyB
          break
        }
        case 'cost_price': {
          comparison = a.cost_price - b.cost_price
          break
        }
        case 'price': {
          comparison = a.price - b.price
          break
        }
        default:
          comparison = 0
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [products, searchQuery, selectedCategory, selectedType, selectedStockType, sortField, sortOrder, getCategoryName])

  // ─── Selection Helpers ─────────────────────────────────────────────────────

  const allFilteredSelected = useMemo(() => {
    if (filteredProducts.length === 0) return false
    return filteredProducts.every(p => selectedIds.has(p.id))
  }, [filteredProducts, selectedIds])

  const someFilteredSelected = useMemo(() => {
    if (allFilteredSelected) return false
    return filteredProducts.some(p => selectedIds.has(p.id))
  }, [filteredProducts, selectedIds, allFilteredSelected])

  // Sync indeterminate state to header checkbox
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someFilteredSelected
    }
  }, [someFilteredSelected])

  const toggleSelectProduct = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      // Unselect all filtered items
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredProducts.forEach(p => next.delete(p.id))
        return next
      })
    } else {
      // Select all filtered items
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredProducts.forEach(p => next.add(p.id))
        return next
      })
    }
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  // ─── Delete Modals Helpers ─────────────────────────────────────────────────

  const openDeleteSelectedModal = () => {
    if (selectedIds.size === 0) return
    setDeleteModal({
      isOpen: true,
      mode: 'selected',
      singleProduct: null,
      forceStockCleanup: false,
      confirmText: ''
    })
  }

  const openDeleteAllModal = () => {
    setDeleteModal({
      isOpen: true,
      mode: 'all',
      singleProduct: null,
      forceStockCleanup: false,
      confirmText: ''
    })
  }

  const openDeleteSingleModal = (product: Product) => {
    setDeleteModal({
      isOpen: true,
      mode: 'single',
      singleProduct: product,
      forceStockCleanup: false,
      confirmText: ''
    })
  }

  // ─── Local Experience Optimistic Delete Execution ──────────────────────────

  const handleConfirmDelete = async () => {
    const { mode, singleProduct, forceStockCleanup } = deleteModal
    const targetIds =
      mode === 'single'
        ? (singleProduct ? [singleProduct.id] : [])
        : mode === 'selected'
        ? Array.from(selectedIds)
        : [] // for mode 'all'

    const targetCount = mode === 'all' ? products.length : targetIds.length

    // 1. Immediately close modal for zero perceived lag
    setDeleteModal(prev => ({ ...prev, isOpen: false }))

    // 2. Snapshot current state for optimistic rollback if network fails
    const previousProducts = [...products]
    const targetIdSet = new Set(targetIds)

    // 3. Optimistic local state update (instant UI reaction)
    const nextProducts = mode === 'all' ? [] : products.filter(p => !targetIdSet.has(p.id))
    setProducts(nextProducts)
    clearSelection()
    if (activeBizId) {
      writeCache(activeBizId, nextProducts, categories)
    }

    // 4. Floating progress feedback
    showToast(`Menghapus ${targetCount} produk...`, 'loading', 0)

    try {
      const res = await fetch('/api/products/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: mode === 'all' ? 'all' : 'selected',
          productIds: targetIds,
          forceStockCleanup
        })
      })

      const data = await res.json()

      if (!res.ok || data.success === false) {
        // If server reported blocked products due to stock movements
        if (data.blocked_count > 0 && Array.isArray(data.blocked_products)) {
          const blockedIdsSet = new Set(data.blocked_products.map((p: any) => p.id))
          // Restore only blocked products back into local state
          const restored = previousProducts.filter(
            p => blockedIdsSet.has(p.id) || nextProducts.some(np => np.id === p.id)
          )
          setProducts(restored)
          if (activeBizId) writeCache(activeBizId, restored, categories)

          showToast(
            data.message || `${data.blocked_count} produk tidak dapat dihapus karena memiliki riwayat stok.`,
            'warning',
            6000
          )
        } else {
          // Total rollback
          setProducts(previousProducts)
          if (activeBizId) writeCache(activeBizId, previousProducts, categories)
          showToast(data.error || data.message || 'Gagal menghapus produk.', 'error', 5000)
        }
        return
      }

      // Fully or partially successful
      showToast(data.message || `${targetCount} produk berhasil dihapus.`, 'success', 4000)

      // If some were blocked in mixed deletion, restore them
      if (data.blocked_count > 0 && Array.isArray(data.blocked_products)) {
        const blockedIdsSet = new Set(data.blocked_products.map((p: any) => p.id))
        const restored = previousProducts.filter(p => blockedIdsSet.has(p.id))
        setProducts(prev => [...prev, ...restored])
        if (activeBizId) writeCache(activeBizId, [...nextProducts, ...restored], categories)
      }
    } catch (err: any) {
      console.error('[BulkDelete] Network error:', err)
      // Rollback on network failure
      setProducts(previousProducts)
      if (activeBizId) writeCache(activeBizId, previousProducts, categories)
      showToast(`Terjadi kesalahan jaringan: ${err.message}. Data dikembalikan.`, 'error', 5000)
    }
  }

  // Open Modal Helper for Add / Edit
  const openAddModal = () => {
    setSelectedProduct(null)
    setIsModalOpen(true)
  }

  const openEditModal = (product: Product) => {
    const normalizedProduct = {
      ...product,
      category_id: product.category_id || null
    }
    setSelectedProduct(normalizedProduct)
    setIsModalOpen(true)
  }


  // Preview of selected products for confirmation dialog
  const selectedProductsPreview = useMemo(() => {
    if (deleteModal.mode === 'single' && deleteModal.singleProduct) {
      return [deleteModal.singleProduct]
    }
    return products.filter(p => selectedIds.has(p.id))
  }, [deleteModal.mode, deleteModal.singleProduct, products, selectedIds])

  const isDeleteAllConfirmed =
    deleteModal.mode !== 'all' ||
    deleteModal.confirmText.trim().toUpperCase() === 'HAPUS SEMUA'

  return (
    <div className="space-y-6 relative pb-20">
      
      {/* Page Header */}
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Produk & Inventori
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 uppercase animate-in fade-in">
                📍 {activeBizName}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight leading-none uppercase">
            Kelola Produk & Jasa
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Tambah, edit, dan atur status ketersediaan serta pencatatan stok produk Anda.
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full md:w-auto">
          {canPurgeAllProducts && products.length > 0 && (
            <button
              onClick={openDeleteAllModal}
              className="px-3.5 py-2.5 bg-white hover:bg-red-50 border border-red-200 text-red-600 hover:text-red-700 font-bold text-xs uppercase tracking-wider rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
              title="Hapus seluruh katalog produk di bisnis ini"
            >
              ⚠️ Hapus Semua
            </button>
          )}
          <Link
            href="/products/import"
            className="px-4 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
          >
            📥 Import Produk
          </Link>
          <button
            onClick={openAddModal}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
          >
            ➕ Tambah Produk
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          
          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Cari nama, SKU, atau deskripsi..."
              className="w-full p-2.5 pl-8 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-gray-400"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <span className="absolute left-3 top-3.5 text-gray-400 text-xs">🔍</span>
          </div>

          {/* Category Filter */}
          <div>
            <select
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
            >
              <option value="">Semua Kategori</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Product Type Filter */}
          <div>
            <select
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
            >
              <option value="">Semua Jenis Produk</option>
              <option value="physical">📦 Produk Fisik</option>
              <option value="service">⚡ Layanan / Jasa</option>
            </select>
          </div>

          {/* Stock Type Filter */}
          <div>
            <select
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              value={selectedStockType}
              onChange={e => setSelectedStockType(e.target.value)}
            >
              <option value="">Semua Status Stok</option>
              <option value="available">🟢 Tersedia</option>
              <option value="unavailable">🔴 Tidak Tersedia</option>
              <option value="tracked">🔵 Ditrack (Ada Jumlah)</option>
            </select>
          </div>

        </div>

        {/* Active Filters & Sort Clear Indicator */}
        {(searchQuery || selectedCategory || selectedType || selectedStockType || sortField) && (
          <div className="flex justify-between items-center pt-2 border-t border-gray-100 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Ditemukan {filteredProducts.length} produk hasil filter
              </span>
              {sortField && (
                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 flex items-center gap-1">
                  <span>Urutan:</span>
                  <span className="capitalize">{sortField.replace('_', ' ')}</span>
                  <span>{sortOrder === 'asc' ? '▲ (Naik)' : '▼ (Turun)'}</span>
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setSearchQuery('')
                setSelectedCategory('')
                setSelectedType('')
                setSelectedStockType('')
                setSortField(null)
                setSortOrder(null)
              }}
              className="text-[10px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest transition-all cursor-pointer"
            >
              ✖ Bersihkan Filter & Urutan
            </button>
          </div>
        )}
      </div>

      {/* SKELETON LOADER FOR MOBILE VIEW */}
      {loading && products.length === 0 && (
        <div className="grid grid-cols-1 gap-4 md:hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={`skeleton-card-${index}`} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3 animate-pulse">
              <div className="flex justify-between items-start">
                <div className="h-5 w-12 bg-slate-200 rounded" />
                <div className="h-4 w-16 bg-slate-200 rounded" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-3/4 bg-slate-200 rounded" />
                <div className="h-3 w-1/2 bg-slate-100 rounded" />
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                <div className="h-5 w-24 bg-slate-200 rounded" />
                <div className="h-7 w-16 bg-slate-200 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SKELETON LOADER FOR DESKTOP VIEW */}
      {loading && products.length === 0 && (
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[980px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                  {canDeleteProducts && (
                    <th className="p-4 w-12 text-center">
                      <div className="h-4 w-4 bg-slate-200 rounded mx-auto" />
                    </th>
                  )}
                  <th className="p-4">SKU</th>
                  <th className="p-4">Nama Produk</th>
                  <th className="p-4">Kategori</th>
                  <th className="p-4">Jenis</th>
                  <th className="p-4">Pelacakan</th>
                  <th className="p-4">Jumlah Stok</th>
                  <th className="p-4">Harga Modal (HPP)</th>
                  <th className="p-4">Harga Jual</th>
                  <th className="p-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Array.from({ length: 5 }).map((_, index) => (
                  <tr key={`skeleton-row-${index}`} className="animate-pulse">
                    {canDeleteProducts && (
                      <td className="p-4 w-12 text-center">
                        <div className="h-4 w-4 bg-slate-200 rounded mx-auto" />
                      </td>
                    )}
                    <td className="p-4">
                      <div className="h-4 w-16 bg-slate-200 rounded" />
                    </td>
                    <td className="p-4">
                      <div className="h-4 w-36 bg-slate-200 rounded" />
                      <div className="h-3 w-20 bg-slate-100 rounded mt-1.5" />
                    </td>
                    <td className="p-4">
                      <div className="h-4 w-20 bg-slate-200 rounded" />
                    </td>
                    <td className="p-4">
                      <div className="h-5 w-14 bg-slate-100 rounded" />
                    </td>
                    <td className="p-4">
                      <div className="h-5 w-16 bg-slate-100 rounded" />
                    </td>
                    <td className="p-4">
                      <div className="h-4 w-14 bg-slate-200 rounded" />
                    </td>
                    <td className="p-4">
                      <div className="h-4 w-20 bg-slate-200 rounded" />
                    </td>
                    <td className="p-4">
                      <div className="h-4 w-20 bg-slate-200 rounded" />
                    </td>
                    <td className="p-4 text-right">
                      <div className="h-8 w-16 bg-slate-200 rounded ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Products Display */}
      {(!loading || products.length > 0) && (
        <>
          {filteredProducts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-xs">
              <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">
                Tidak ada produk ditemukan
              </p>
              <p className="text-xs text-gray-400 font-medium">
                Cobalah ubah filter Anda atau tambahkan produk baru.
              </p>
            </div>
          ) : (
            <>
              {/* MOBILE VIEW (Card Grid) — hidden on desktop */}
              <div className="grid grid-cols-1 gap-4 md:hidden">
                {filteredProducts.map(p => {
                  const isChecked = selectedIds.has(p.id)
                  return (
                    <div
                      key={p.id}
                      className={`bg-white border rounded-xl p-4 shadow-sm space-y-3 transition-colors ${
                        isChecked ? 'border-blue-300 ring-2 ring-blue-500/20 bg-blue-50/20' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2.5">
                          {canDeleteProducts && (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectProduct(p.id)}
                              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300 cursor-pointer"
                            />
                          )}
                          <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            p.type === 'physical'
                              ? 'bg-blue-50 text-blue-700 border border-blue-100'
                              : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                          }`}>
                            {p.type === 'physical' ? 'Fisik' : 'Jasa'}
                          </span>
                          <span className="text-[10px] font-semibold text-gray-400">{getCategoryName(p)}</span>
                        </div>
                        
                        {/* Stock Badge */}
                        <div>
                          {p.stock_type === 'available' && (
                            <span className="text-[9px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100 uppercase">Tersedia</span>
                          )}
                          {p.stock_type === 'unavailable' && (
                            <span className="text-[9px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase">Tidak Tersedia</span>
                          )}
                          {p.stock_type === 'tracked' && (
                            <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 uppercase">
                              Stok: {p.stock_quantity} {p.unit || 'pcs'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-extrabold text-sm text-gray-800 leading-tight uppercase">{p.name}</h4>
                        {p.sku && (
                          <span className="text-[10px] font-mono text-gray-400 block mt-0.5">SKU: {p.sku}</span>
                        )}
                        {p.description && (
                          <p className="text-xs text-gray-500 font-medium mt-1 line-clamp-2">{p.description}</p>
                        )}
                      </div>

                      <div className="flex justify-between items-end pt-3 border-t border-gray-100">
                        <div className="flex flex-col gap-0.5">
                          {p.cost_price > 0 && (
                            <span className="text-[9px] font-semibold text-gray-400 uppercase">HPP: {formatPrice(p.cost_price)}</span>
                          )}
                          <span className="font-extrabold text-xs text-gray-900">Jual: {formatPrice(p.price)}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEditModal(p)}
                            className="p-1.5 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50 transition-colors text-xs font-bold cursor-pointer"
                          >
                            ✏️ Edit
                          </button>
                          {canDeleteProducts && (
                            <button
                              onClick={() => openDeleteSingleModal(p)}
                              className="p-1.5 border border-red-200 text-red-500 rounded-md hover:bg-red-50 transition-colors text-xs font-bold cursor-pointer"
                            >
                              🗑️ Hapus
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* DESKTOP VIEW (Table Grid) — hidden on mobile */}
              <div className="hidden md:block bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[980px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                        {canDeleteProducts && (
                          <th className="p-4 w-12 text-center">
                            <input
                              ref={selectAllCheckboxRef}
                              type="checkbox"
                              checked={allFilteredSelected}
                              onChange={toggleSelectAllFiltered}
                              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300 cursor-pointer"
                              title={allFilteredSelected ? 'Batal pilih semua' : 'Pilih semua di halaman/filter ini'}
                            />
                          </th>
                        )}
                        {renderSortHeader('SKU', 'sku', 'w-32')}
                        {renderSortHeader('Nama Produk', 'name', 'min-w-[180px]')}
                        {renderSortHeader('Kategori', 'category')}
                        {renderSortHeader('Jenis', 'type')}
                        {renderSortHeader('Pelacakan', 'stock_type')}
                        {renderSortHeader('Jumlah Stok', 'stock_quantity')}
                        {renderSortHeader('Harga Modal (HPP)', 'cost_price')}
                        {renderSortHeader('Harga Jual', 'price')}
                        <th className="p-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredProducts.map(p => {
                        const isChecked = selectedIds.has(p.id)
                        return (
                          <tr
                            key={p.id}
                            className={`transition-colors group ${
                              isChecked ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'hover:bg-slate-50'
                            }`}
                          >
                            {canDeleteProducts && (
                              <td className="p-4 w-12 text-center" onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelectProduct(p.id)}
                                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300 cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="p-4 whitespace-nowrap">
                              {p.sku ? (
                                <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200/80 px-2 py-0.5 rounded">
                                  {p.sku}
                                </span>
                              ) : (
                                <span className="text-gray-300 font-mono text-xs">-</span>
                              )}
                            </td>
                            <td className="p-4">
                              <div className="font-extrabold text-gray-900 uppercase text-xs tracking-tight">{p.name}</div>
                              {p.description && (
                                <p className="text-[11px] text-gray-400 font-normal line-clamp-1 mt-0.5">{p.description}</p>
                              )}
                            </td>
                            <td className="p-4 whitespace-nowrap">
                              <span className="text-xs font-bold text-gray-600">{getCategoryName(p)}</span>
                            </td>
                            <td className="p-4 whitespace-nowrap">
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                                p.type === 'physical'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                                  : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                              }`}>
                                {p.type === 'physical' ? 'Fisik' : 'Layanan'}
                              </span>
                            </td>
                            <td className="p-4 whitespace-nowrap">
                              {p.stock_type === 'tracked' && (
                                <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 uppercase">
                                  🔵 Ditrack
                                </span>
                              )}
                              {p.stock_type === 'available' && (
                                <span className="text-[9px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100 uppercase">
                                  🟢 Tersedia
                                </span>
                              )}
                              {p.stock_type === 'unavailable' && (
                                <span className="text-[9px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase">
                                  🔴 Tidak Tersedia
                                </span>
                              )}
                            </td>
                            <td className="p-4 whitespace-nowrap">
                              {p.stock_type === 'tracked' ? (
                                <div className="flex items-baseline gap-1">
                                  <span className={`text-xs font-black ${p.stock_quantity <= 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                    {p.stock_quantity}
                                  </span>
                                  <span className="text-[10px] text-gray-400 font-bold uppercase">{p.unit || 'pcs'}</span>
                                </div>
                              ) : p.stock_type === 'available' ? (
                                <span className="text-xs font-bold text-gray-400" title="Tidak dibatasi jumlah stok fisik">
                                  ∞ Bebas
                                </span>
                              ) : (
                                <span className="text-xs font-bold text-gray-300">-</span>
                              )}
                            </td>
                            <td className="p-4 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-gray-800">{formatPrice(p.cost_price)}</span>
                                {p.hpp_type === 'variable' ? (
                                  <span className="text-[9px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded w-fit mt-0.5">
                                    🧪 Resep / BOM
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-medium text-gray-400 mt-0.5">
                                    Flat
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4 whitespace-nowrap">
                              <span className="text-xs font-extrabold text-gray-900">{formatPrice(p.price)}</span>
                            </td>
                            <td className="p-4 text-right whitespace-nowrap">
                              <div className="flex gap-2 justify-end opacity-80 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => openEditModal(p)}
                                  className="p-2 text-gray-450 hover:text-blue-600 rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
                                  title="Edit Produk"
                                >
                                  ✏️
                                </button>
                                {canDeleteProducts && (
                                  <button
                                    onClick={() => openDeleteSingleModal(p)}
                                    className="p-2 text-gray-450 hover:text-red-600 rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
                                    title="Hapus Produk"
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ─── FLOATING ACTION DOCK (Bulk Selection Bar) ───────────────────────── */}
      {canDeleteProducts && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-auto max-w-[95vw] animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="bg-gray-900/95 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl border border-gray-700/80 flex items-center gap-4 flex-wrap justify-center">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs font-extrabold tracking-wide text-gray-100">
                {selectedIds.size} Produk Terpilih
              </span>
              {products.length > selectedIds.size && (
                <span className="text-[10px] text-gray-400 font-medium hidden sm:inline">
                  (dari {products.length} total)
                </span>
              )}
            </div>

            <div className="h-4 w-px bg-gray-700 hidden sm:block" />

            <div className="flex items-center gap-2">
              {filteredProducts.length > selectedIds.size && (
                <button
                  onClick={toggleSelectAllFiltered}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg border border-gray-600/60 transition-all cursor-pointer"
                >
                  Pilih Hasil Filter ({filteredProducts.length})
                </button>
              )}

              <button
                onClick={clearSelection}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-lg border border-gray-700 transition-all cursor-pointer"
              >
                Batal
              </button>

              <button
                onClick={openDeleteSelectedModal}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
              >
                🗑️ Hapus ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── DANGER CONFIRMATION MODAL ─────────────────────────────────────── */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center font-bold text-lg shrink-0">
                ⚠️
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900 leading-tight uppercase">
                  {deleteModal.mode === 'all'
                    ? 'Hapus SEMUA Produk Katalog'
                    : deleteModal.mode === 'selected'
                    ? `Hapus ${selectedIds.size} Produk Terpilih`
                    : `Hapus Produk "${deleteModal.singleProduct?.name}"`}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {deleteModal.mode === 'all'
                    ? `Perhatian: Seluruh ${products.length} produk di unit bisnis "${activeBizName}" akan dihapus permanen.`
                    : 'Tindakan ini permanen dan akan menghapus data varian serta resep HPP produk terkait.'}
                </p>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              
              {/* Product Preview List for Selected/Single Mode */}
              {deleteModal.mode !== 'all' && selectedProductsPreview.length > 0 && (
                <div>
                  <div className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                    Rincian Produk yang Akan Dihapus:
                  </div>
                  <div className="max-h-36 overflow-y-auto p-2.5 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-700 divide-y divide-gray-100 space-y-1">
                    {selectedProductsPreview.slice(0, 6).map(p => (
                      <div key={p.id} className="pt-1 first:pt-0 flex justify-between items-center gap-2">
                        <span className="font-bold truncate text-gray-800">{p.name}</span>
                        <span className="text-[10px] font-mono text-gray-400 shrink-0">{p.sku || '-'}</span>
                      </div>
                    ))}
                    {selectedProductsPreview.length > 6 && (
                      <div className="pt-1.5 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        +{selectedProductsPreview.length - 6} produk lainnya
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Force Stock Cleanup Checkbox (Option 1) */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 bg-amber-50/60 cursor-pointer text-xs transition-colors hover:bg-amber-50">
                <input
                  type="checkbox"
                  checked={deleteModal.forceStockCleanup}
                  onChange={e =>
                    setDeleteModal(prev => ({ ...prev, forceStockCleanup: e.target.checked }))
                  }
                  className="mt-0.5 w-4 h-4 text-amber-600 focus:ring-amber-500 rounded border-gray-300 cursor-pointer"
                />
                <div className="text-gray-700">
                  <span className="font-extrabold text-amber-950 block">
                    Paksa bersihkan riwayat mutasi stok
                  </span>
                  <span className="text-[11px] text-gray-600 leading-relaxed block mt-0.5 font-medium">
                    Jika dicentang, seluruh kartu stok dan mutasi gudang produk ini akan ikut dibersihkan. Jika tidak dicentang, produk dengan riwayat mutasi akan dilewati demi integritas buku besar.
                  </span>
                </div>
              </label>

              {/* Security Text Confirmation for "Hapus Semua" */}
              {deleteModal.mode === 'all' && (
                <div className="p-3.5 bg-red-50/70 border border-red-200 rounded-xl space-y-2">
                  <label className="block text-xs font-bold text-red-900">
                    Ketik <span className="font-mono bg-red-100 px-1 py-0.5 rounded text-red-700 select-all font-black">HAPUS SEMUA</span> untuk mengonfirmasi:
                  </label>
                  <input
                    type="text"
                    value={deleteModal.confirmText}
                    onChange={e => setDeleteModal(prev => ({ ...prev, confirmText: e.target.value }))}
                    placeholder="Ketik HAPUS SEMUA"
                    className="w-full p-2.5 border border-red-300 rounded-lg text-xs font-bold text-gray-900 bg-white outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 placeholder:text-gray-400"
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Batalkan
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={!isDeleteAllConfirmed}
                className={`px-5 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider text-white transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
                  isDeleteAllConfirmed
                    ? 'bg-red-600 hover:bg-red-700 active:scale-95'
                    : 'bg-gray-300 cursor-not-allowed opacity-60'
                }`}
              >
                🗑️ Ya, Hapus Sekarang
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ─── FLOATING TOAST NOTIFICATION ───────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200 max-w-sm">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-xs font-bold ${
            toast.type === 'loading'
              ? 'bg-gray-900 text-white border-gray-700'
              : toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : toast.type === 'warning'
              ? 'bg-amber-600 text-white border-amber-500'
              : 'bg-red-600 text-white border-red-500'
          }`}>
            <span className="text-sm">
              {toast.type === 'loading' && '⏳'}
              {toast.type === 'success' && '✨'}
              {toast.type === 'warning' && '⚠️'}
              {toast.type === 'error' && '❌'}
            </span>
            <span className="leading-snug flex-1">{toast.message}</span>
            {toast.type !== 'loading' && (
              <button
                onClick={() => setToast(null)}
                className="text-white/80 hover:text-white ml-2 text-sm leading-none cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Product Add / Edit Modal */}
      {activeBizId && (
        <ProductModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={refreshData}
          product={selectedProduct}
          businessId={activeBizId}
        />
      )}

    </div>
  )
}
