"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import ProductModal from './components/ProductModal'

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
  created_at: string
  categories?: Category | Category[] | null // Supabase join
}

type ProductCachePayload = {
  products: Product[]
  categories: Category[]
  ts: number
  businessId: string
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 menit
const STALE_RECHECK = 2 * 60 * 1000 // 2 menit

export default function ProductsPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

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

  // Modal Control
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

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

  // Fetch initial profile & active business ID
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
            await fetchProductsAndCategories(businessId, false)
          }
        }
      } catch (err) {
        console.error('Error loading profile:', err)
        setLoading(false)
      }
    }
    loadProfile()
  }, [fetchProductsAndCategories])

  // Trigger refresh (e.g. after add/edit/delete)
  const refreshData = () => {
    if (activeBizId) {
      fetchProductsAndCategories(activeBizId, false)
    }
  }

  // Filtered Products list
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.sku || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(searchQuery.toLowerCase())

      const matchesCategory = selectedCategory ? p.category_id === selectedCategory : true
      const matchesType = selectedType ? p.type === selectedType : true
      const matchesStockType = selectedStockType ? p.stock_type === selectedStockType : true

      return matchesSearch && matchesCategory && matchesType && matchesStockType
    })
  }, [products, searchQuery, selectedCategory, selectedType, selectedStockType])

  // Delete Action
  const handleDeleteProduct = async (id: string, name: string) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus produk "${name}"?`)) return

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)

      if (error) throw error

      const updatedProds = products.filter(p => p.id !== id)
      setProducts(updatedProds)
      if (activeBizId) {
        writeCache(activeBizId, updatedProds, categories)
      }
    } catch (err: any) {
      console.error('Error deleting product:', err)
      alert('Gagal menghapus produk: ' + err.message)
    }
  }

  // Open Modal Helper
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

  // Formatting price helper
  const formatPrice = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val)
  }

  const getCategoryName = (product: Product) => {
    if (!product.categories) return '-'
    const cat = Array.isArray(product.categories) ? product.categories[0] : product.categories
    return cat?.name || '-'
  }

  return (
    <div className="space-y-6">
      
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
        <button
          onClick={openAddModal}
          className="w-full md:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98"
        >
          ➕ Tambah Produk
        </button>
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

        {/* Active Filters Clear Indicator */}
        {(searchQuery || selectedCategory || selectedType || selectedStockType) && (
          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Ditemukan {filteredProducts.length} produk hasil filter
            </span>
            <button
              onClick={() => {
                setSearchQuery('')
                setSelectedCategory('')
                setSelectedType('')
                setSelectedStockType('')
              }}
              className="text-[10px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest transition-all"
            >
              ✖ Bersihkan Filter
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
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                <th className="p-4">SKU / Nama</th>
                <th className="p-4">Kategori</th>
                <th className="p-4">Jenis</th>
                <th className="p-4">Stok</th>
                <th className="p-4">Harga Modal (HPP)</th>
                <th className="p-4">Harga Jual</th>
                <th className="p-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, index) => (
                <tr key={`skeleton-row-${index}`} className="animate-pulse">
                  <td className="p-4">
                    <div className="h-4 w-32 bg-slate-200 rounded" />
                    <div className="h-3 w-16 bg-slate-100 rounded mt-1.5" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-20 bg-slate-200 rounded" />
                  </td>
                  <td className="p-4">
                    <div className="h-5 w-14 bg-slate-100 rounded" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-16 bg-slate-200 rounded" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-24 bg-slate-200 rounded" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-24 bg-slate-200 rounded" />
                  </td>
                  <td className="p-4 text-right">
                    <div className="h-8 w-16 bg-slate-200 rounded ml-auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Products Display (rendered only when not loading or if we already have cached products loaded) */}
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
                {filteredProducts.map(p => (
                  <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded-full uppercase mr-2 ${
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
                            Stok: {p.stock_quantity}
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
                          className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 transition-colors text-xs font-bold"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p.id, p.name)}
                          className="p-1.5 border border-red-200 text-red-500 rounded-md hover:bg-red-50 transition-colors text-xs font-bold"
                        >
                          🗑️ Hapus
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* DESKTOP VIEW (Table Grid) — hidden on mobile */}
              <div className="hidden md:block bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                      <th className="p-4">SKU / Nama</th>
                      <th className="p-4">Kategori</th>
                      <th className="p-4">Jenis</th>
                      <th className="p-4">Stok</th>
                      <th className="p-4">Harga Modal (HPP)</th>
                      <th className="p-4">Harga Jual</th>
                      <th className="p-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredProducts.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="p-4">
                          <div className="font-bold text-gray-800 uppercase text-xs">{p.name}</div>
                          {p.sku ? (
                            <div className="text-[10px] font-mono text-gray-400 mt-0.5">SKU: {p.sku}</div>
                          ) : (
                            <div className="text-[10px] font-mono text-gray-350 mt-0.5">-</div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className="text-xs font-bold text-gray-500">{getCategoryName(p)}</span>
                        </td>
                        <td className="p-4">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                            p.type === 'physical'
                              ? 'bg-blue-50 text-blue-700 border border-blue-100'
                              : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                          }`}>
                            {p.type === 'physical' ? 'Fisik' : 'Layanan'}
                          </span>
                        </td>
                        <td className="p-4">
                          {p.stock_type === 'available' && (
                            <span className="text-[9px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100 uppercase">Tersedia</span>
                          )}
                          {p.stock_type === 'unavailable' && (
                            <span className="text-[9px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase">Tidak Tersedia</span>
                          )}
                          {p.stock_type === 'tracked' && (
                            <div className="flex flex-col">
                              <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 uppercase w-fit">
                                Ditrack
                              </span>
                              <span className="text-[11px] font-bold text-gray-600 mt-1">Stok: {p.stock_quantity}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className="text-xs font-bold text-gray-500">{formatPrice(p.cost_price)}</span>
                        </td>
                        <td className="p-4">
                          <span className="text-xs font-extrabold text-gray-900">{formatPrice(p.price)}</span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex gap-2 justify-end opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEditModal(p)}
                              className="p-2 text-gray-450 hover:text-blue-600 rounded-md hover:bg-gray-100 transition-colors"
                              title="Edit Produk"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(p.id, p.name)}
                              className="p-2 text-gray-450 hover:text-red-600 rounded-md hover:bg-gray-100 transition-colors"
                              title="Hapus Produk"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* Product Modal */}
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
