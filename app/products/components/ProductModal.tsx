"use client"
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

type Category = {
  id: string
  name: string
}

type Product = {
  id?: string
  business_id?: string
  name: string
  sku: string | null
  description: string | null
  price: number
  cost_price: number
  type: 'physical' | 'service'
  category_id: string | null
  stock_type: 'tracked' | 'available' | 'unavailable'
  stock_quantity: number
  unit?: string
  hpp_type?: 'fixed' | 'variable'
}

type RecipeRow = {
  id?: string
  ingredient_product_id: string
  ingredient_name: string
  quantity: number
  unit: string
  cost_price: number
  stock_type: string
  stock_quantity: number
}

type ProductModalProps = {
  isOpen: boolean
  onClose: () => void
  onSave: () => void
  product: Product | null // if null, it is "Add New" mode
  businessId: string
}

const COMMON_UNITS = [
  'pcs',
  'gram',
  'kg',
  'ml',
  'liter',
  'yard',
  'meter',
  'cm',
  'roll',
  'pack',
  'box',
  'set'
]

// Custom Searchable Combobox for Ingredient Selection (typing support)
type IngredientComboboxProps = {
  options: Product[]
  selectedId: string
  onSelect: (productId: string) => void
  placeholder?: string
}

function IngredientSearchCombobox({ options, selectedId, onSelect, placeholder = 'Ketik untuk cari bahan baku / SKU...' }: IngredientComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedProduct = useMemo(() => options.find(o => o.id === selectedId), [options, selectedId])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.name.toLowerCase().includes(q) ||
      (o.sku && o.sku.toLowerCase().includes(q))
    )
  }, [options, query])

  return (
    <div className="relative flex-1 min-w-0 z-20" ref={containerRef}>
      <div className="relative flex items-center">
        <input
          type="text"
          className="w-full p-2.5 pr-8 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white placeholder:text-slate-400 placeholder:font-normal shadow-2xs transition-all"
          placeholder={placeholder}
          value={isOpen ? query : (selectedProduct ? `${selectedProduct.name} (Rp ${(selectedProduct.cost_price || 0).toLocaleString('id-ID')}/${selectedProduct.unit || 'pcs'})` : query)}
          onFocus={() => {
            setIsOpen(true)
            setQuery('')
          }}
          onChange={e => {
            const val = e.target.value
            setQuery(val)
            if (!isOpen) setIsOpen(true)
            if (selectedId) onSelect('')
          }}
        />
        {(selectedId || query) ? (
          <button
            type="button"
            onClick={() => {
              onSelect('')
              setQuery('')
              setIsOpen(false)
            }}
            className="absolute right-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold p-1 rounded-full hover:bg-slate-100 transition-colors"
            title="Hapus pilihan"
          >
            ✕
          </button>
        ) : (
          <span className="absolute right-3 text-slate-400 text-[10px] pointer-events-none">🔍</span>
        )}
      </div>

      {/* Dropdown menu - high z-index and shadow to float cleanly without clipping */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] divide-y divide-slate-100 animate-in fade-in slide-in-from-top-1 duration-150">
          {filteredOptions.length === 0 ? (
            <div className="p-3 text-center text-xs font-medium text-slate-400">
              {query ? `Bahan baku "${query}" tidak ditemukan.` : 'Tidak ada pilihan bahan baku.'}
            </div>
          ) : (
            filteredOptions.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelect(p.id!)
                  setQuery('')
                  setIsOpen(false)
                }}
                className={`w-full text-left p-3 hover:bg-indigo-50/80 transition-colors flex items-center justify-between gap-3 ${
                  selectedId === p.id ? 'bg-indigo-50 font-bold' : ''
                }`}
              >
                <div className="min-w-0 flex-1 pr-2">
                  <p className="text-xs font-bold text-slate-800 break-words leading-tight">{p.name}</p>
                  {p.sku && <p className="text-[10px] font-mono text-slate-400 mt-0.5">SKU: {p.sku}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-extrabold text-indigo-700">
                    Rp {(p.cost_price || 0).toLocaleString('id-ID')} <span className="text-[10px] font-normal text-slate-500">/ {p.unit || 'pcs'}</span>
                  </p>
                  {p.stock_type === 'tracked' && (
                    <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                      Stok: {p.stock_quantity} {p.unit || 'pcs'}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function ProductModal({ isOpen, onClose, onSave, product, businessId }: ProductModalProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [mounted, setMounted] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [availableProducts, setAvailableProducts] = useState<Product[]>([])
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
  const [unit, setUnit] = useState<string>('pcs')
  const [customUnit, setCustomUnit] = useState<string>('')
  const [hppType, setHppType] = useState<'fixed' | 'variable'>('fixed')

  // Recipe Builder State
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([])
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>('')
  const [ingredientQtyInput, setIngredientQtyInput] = useState<string>('1')
  const [loadingRecipes, setLoadingRecipes] = useState(false)

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

  // Load categories and all products for ingredients picker
  useEffect(() => {
    if (isOpen && businessId) {
      fetchCategories()
      fetchAvailableProducts()
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
        
        const initialUnit = product.unit || 'pcs'
        if (COMMON_UNITS.includes(initialUnit)) {
          setUnit(initialUnit)
          setCustomUnit('')
        } else {
          setUnit('custom')
          setCustomUnit(initialUnit)
        }

        setHppType(product.hpp_type || 'fixed')
        setShowNewCategoryInput(false)
        setNewCategoryName('')
        setCategoryError('')

        if (product.id) {
          fetchProductRecipes(product.id)
        } else {
          setRecipeRows([])
        }
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
        setUnit('pcs')
        setCustomUnit('')
        setHppType('fixed')
        setRecipeRows([])
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

  const fetchAvailableProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', businessId)
        .order('name', { ascending: true })

      if (!error && data) {
        setAvailableProducts(data)
      }
    } catch (err) {
      console.error('Error fetching available products:', err)
    }
  }

  const fetchProductRecipes = async (productId: string) => {
    setLoadingRecipes(true)
    try {
      const { data, error } = await supabase
        .from('product_recipes')
        .select('id, ingredient_product_id, quantity, unit, ingredient:products!ingredient_product_id(id, name, cost_price, stock_type, stock_quantity, unit)')
        .eq('product_id', productId)

      if (error) {
        console.warn('Note: product_recipes query fallback:', error.message)
        setRecipeRows([])
        return
      }

      if (data && data.length > 0) {
        const rows: RecipeRow[] = data.map((r: any) => {
          const ing = Array.isArray(r.ingredient) ? r.ingredient[0] : r.ingredient
          return {
            id: r.id,
            ingredient_product_id: r.ingredient_product_id,
            ingredient_name: ing?.name || 'Bahan Baku',
            quantity: Number(r.quantity || 0),
            unit: r.unit || ing?.unit || 'pcs',
            cost_price: Number(ing?.cost_price || 0),
            stock_type: ing?.stock_type || 'available',
            stock_quantity: Number(ing?.stock_quantity || 0)
          }
        })
        setRecipeRows(rows)
      } else {
        setRecipeRows([])
      }
    } catch (err) {
      console.error('Error fetching recipes:', err)
      setRecipeRows([])
    } finally {
      setLoadingRecipes(false)
    }
  }

  // Calculate dynamic recipe HPP
  const calculatedDynamicHpp = useMemo(() => {
    if (hppType !== 'variable' || recipeRows.length === 0) return 0
    return recipeRows.reduce((sum, r) => sum + (r.quantity * r.cost_price), 0)
  }, [hppType, recipeRows])

  // Unit of currently selected ingredient in combobox (read-only)
  const selectedIngredientUnit = useMemo(() => {
    if (!selectedIngredientId) return 'pcs'
    const found = availableProducts.find(p => p.id === selectedIngredientId)
    return found?.unit || 'pcs'
  }, [availableProducts, selectedIngredientId])

  const handleAddIngredient = () => {
    if (!selectedIngredientId) return alert('Pilih atau ketik nama bahan baku terlebih dahulu!')
    const qty = parseFloat(ingredientQtyInput)
    if (isNaN(qty) || qty <= 0) return alert('Jumlah bahan baku harus lebih dari 0!')

    // Check if ingredient already in recipe list
    if (recipeRows.some(r => r.ingredient_product_id === selectedIngredientId)) {
      return alert('Bahan baku ini sudah ada dalam daftar resep!')
    }

    const ingProd = availableProducts.find(p => p.id === selectedIngredientId)
    if (!ingProd) return

    const newRow: RecipeRow = {
      ingredient_product_id: ingProd.id!,
      ingredient_name: ingProd.name,
      quantity: qty,
      unit: ingProd.unit || 'pcs',
      cost_price: Number(ingProd.cost_price || 0),
      stock_type: ingProd.stock_type,
      stock_quantity: Number(ingProd.stock_quantity || 0)
    }

    setRecipeRows([...recipeRows, newRow])
    setSelectedIngredientId('')
    setIngredientQtyInput('1')
  }

  const handleRemoveIngredient = (ingredientProductId: string) => {
    setRecipeRows(recipeRows.filter(r => r.ingredient_product_id !== ingredientProductId))
  }

  const handleUpdateIngredientQty = (ingredientProductId: string, newQtyStr: string) => {
    const qty = parseFloat(newQtyStr)
    setRecipeRows(recipeRows.map(r => {
      if (r.ingredient_product_id === ingredientProductId) {
        return { ...r, quantity: isNaN(qty) ? 0 : qty }
      }
      return r
    }))
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

    const effectiveUnit = unit === 'custom' ? (customUnit.trim() || 'pcs') : unit
    const finalHpp = hppType === 'variable' ? calculatedDynamicHpp : Number(costPrice)

    if (hppType === 'variable' && recipeRows.length === 0) {
      return alert('Produk dengan HPP Variabel wajib memiliki minimal 1 bahan baku dalam formulasi resep!')
    }

    if (stockType === 'tracked' && stockQuantity < 0) {
      return alert('Jumlah stok tidak boleh kurang dari 0!')
    }

    setSaving(true)
    try {
      let finalCategoryId: string | null = categoryId ? categoryId : null

      // 1. Insert new category if typed
      if (showNewCategoryInput) {
        if (!newCategoryName.trim()) {
          setCategoryError('Nama kategori baru wajib diisi!')
          setSaving(false)
          return
        }

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
            if (catErr.code === '23505') {
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
      const productPayload: Record<string, any> = {
        business_id: businessId,
        name: name.trim(),
        sku: sku.trim() || null,
        description: description.trim() || null,
        price: Number(price),
        cost_price: finalHpp,
        type,
        category_id: finalCategoryId,
        stock_type: stockType,
        stock_quantity: stockType === 'tracked' ? Number(stockQuantity) : 0,
        unit: effectiveUnit,
        hpp_type: hppType,
        updated_at: new Date().toISOString()
      }

      let savedProductId = product?.id

      const executeSave = async (payload: Record<string, any>) => {
        if (product?.id) {
          const { data, error } = await supabase
            .from('products')
            .update(payload)
            .eq('id', product.id)
            .select('id')
            .single()
          return { data, error }
        } else {
          const { data, error } = await supabase
            .from('products')
            .insert(payload)
            .select('id')
            .single()
          return { data, error }
        }
      }

      let res = await executeSave(productPayload)

      // Fallback if DB schema cache doesn't have hpp_type or unit columns yet
      if (res.error && res.error.message && res.error.message.includes('schema cache')) {
        console.warn('PostgREST schema cache fallback triggered:', res.error.message)
        const fallbackPayload = { ...productPayload }
        delete fallbackPayload.hpp_type
        delete fallbackPayload.unit
        res = await executeSave(fallbackPayload)
      }

      if (res.error) throw res.error
      if (res.data?.id) savedProductId = res.data.id

      // 3. Save recipe rows if variable HPP
      if (savedProductId && hppType === 'variable') {
        try {
          await supabase
            .from('product_recipes')
            .delete()
            .eq('product_id', savedProductId)

          if (recipeRows.length > 0) {
            const recipesToInsert = recipeRows.map(r => ({
              business_id: businessId,
              product_id: savedProductId,
              ingredient_product_id: r.ingredient_product_id,
              quantity: Number(r.quantity),
              unit: r.unit || 'pcs'
            }))

            const { error: recipeErr } = await supabase
              .from('product_recipes')
              .insert(recipesToInsert)

            if (recipeErr) {
              console.warn('Note: product_recipes table fallback:', recipeErr.message)
            }
          }
        } catch (rErr) {
          console.warn('Note: Recipe save fallback:', rErr)
        }
      } else if (savedProductId && hppType === 'fixed') {
        try {
          await supabase
            .from('product_recipes')
            .delete()
            .eq('product_id', savedProductId)
        } catch (fErr) {
          // ignore
        }
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

  // Candidate ingredients for selection (excluding the product itself and already added ingredients)
  const availableIngredientsOptions = availableProducts.filter(
    p => p.id !== product?.id && !recipeRows.some(r => r.ingredient_product_id === p.id)
  )

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-xs flex justify-center items-start md:items-center p-3 md:p-6 overflow-y-auto z-[99] animate-in fade-in duration-200">
      <div 
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-2xl lg:max-w-5xl xl:max-w-6xl my-auto flex flex-col max-h-[92vh] overflow-hidden transform scale-100 transition-all duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 md:px-8 py-4 bg-slate-50 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight">
              {product ? 'Edit Produk' : 'Tambah Produk Baru'}
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">Kelola informasi produk, HPP resep/bahan baku, dan manajemen stok</p>
          </div>
          <button 
            onClick={onClose} 
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors text-lg font-light focus:outline-none"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Form Body - Ultra Spacious Workstation Layout (Responsive 2-column on desktop) */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 max-w-full">
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
            
            {/* LEFT COLUMN: Informasi Produk Utama */}
            <div className="lg:col-span-5 space-y-5">
              
              <div className="bg-slate-50/60 border border-slate-200/80 rounded-2xl p-4 space-y-4">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b border-slate-200/60 pb-2">
                  1. Informasi Produk
                </h4>

                {/* Tipe Produk */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Jenis Produk</label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setType('physical')}
                      className={`py-2.5 px-3 border rounded-xl font-bold text-xs text-center transition-all flex items-center justify-center gap-1.5 ${
                        type === 'physical'
                          ? 'border-blue-600 bg-blue-50/80 text-blue-700 shadow-xs ring-1 ring-blue-600/30'
                          : 'border-slate-200 hover:bg-white text-slate-600'
                      }`}
                    >
                      <span>📦</span>
                      <span>Produk Fisik</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setType('service')}
                      className={`py-2.5 px-3 border rounded-xl font-bold text-xs text-center transition-all flex items-center justify-center gap-1.5 ${
                        type === 'service'
                          ? 'border-blue-600 bg-blue-50/80 text-blue-700 shadow-xs ring-1 ring-blue-600/30'
                          : 'border-slate-200 hover:bg-white text-slate-600'
                      }`}
                    >
                      <span>⚡</span>
                      <span>Jasa/Layanan</span>
                    </button>
                  </div>
                </div>

                {/* Nama Produk */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Nama Produk *</label>
                  <input
                    type="text"
                    required
                    className="w-full p-3 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-semibold text-slate-800 transition-all placeholder:text-slate-400 bg-white"
                    placeholder="Contoh: Kopi Milk Tea 500ml, Kemeja Oversize Cotton..."
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>

                {/* SKU, Satuan (Unit) & Kategori */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">SKU / Kode Produk</label>
                    <input
                      type="text"
                      className="w-full p-2.5 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 transition-all placeholder:text-slate-300 bg-white"
                      placeholder="SKU-1002"
                      value={sku}
                      onChange={e => setSku(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Satuan Stok (Unit) *</label>
                    <select
                      className="w-full p-2.5 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 transition-all bg-white"
                      value={unit}
                      onChange={e => setUnit(e.target.value)}
                    >
                      {COMMON_UNITS.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                      <option value="custom">-- Kustom / Lainnya --</option>
                    </select>
                  </div>
                </div>

                {/* Custom Unit Input */}
                {unit === 'custom' && (
                  <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl animate-in fade-in duration-150">
                    <label className="block text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1">Tulis Satuan Kustom *</label>
                    <input
                      type="text"
                      required
                      className="w-full p-2 border border-amber-300 rounded-lg text-xs font-semibold text-slate-800 bg-white outline-none focus:border-amber-500"
                      placeholder="Contoh: porsi, botol, piring, yard..."
                      value={customUnit}
                      onChange={e => setCustomUnit(e.target.value)}
                    />
                  </div>
                )}

                {/* Kategori */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Kategori Produk</label>
                  <select
                    className="w-full p-2.5 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 transition-all bg-white"
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

                {/* Input Inline Kategori Baru */}
                {showNewCategoryInput && (
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 animate-in slide-in-from-top-2 duration-150">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nama Kategori Baru *</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 bg-white"
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
                        className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100"
                      >
                        Batal
                      </button>
                    </div>
                    {categoryError && (
                      <p className="text-[11px] font-bold text-red-600">{categoryError}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Stok & Deskripsi */}
              <div className="bg-slate-50/60 border border-slate-200/80 rounded-2xl p-4 space-y-4">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b border-slate-200/60 pb-2">
                  2. Stok & Deskripsi
                </h4>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Manajemen Stok</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setStockType('available')}
                      className={`py-2 px-2.5 border rounded-xl font-bold text-xs text-center transition-all ${
                        stockType === 'available'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-xs'
                          : 'border-slate-200 hover:bg-white text-slate-600'
                      }`}
                    >
                      Tersedia
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockType('unavailable')}
                      className={`py-2 px-2.5 border rounded-xl font-bold text-xs text-center transition-all ${
                        stockType === 'unavailable'
                          ? 'border-rose-600 bg-rose-50 text-rose-700 shadow-xs'
                          : 'border-slate-200 hover:bg-white text-slate-600'
                      }`}
                    >
                      Tidak Tersedia
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockType('tracked')}
                      className={`py-2 px-2.5 border rounded-xl font-bold text-xs text-center transition-all ${
                        stockType === 'tracked'
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                          : 'border-slate-200 hover:bg-white text-slate-600'
                      }`}
                    >
                      Ditrack
                    </button>
                  </div>

                  {stockType === 'tracked' && (
                    <div className="mt-3 p-3 bg-blue-50/50 border border-blue-100 rounded-xl space-y-1 animate-in slide-in-from-top-2 duration-150">
                      <div className="flex justify-between items-center">
                        <label className="block text-[10px] font-bold text-blue-800 uppercase tracking-wider">Jumlah Stok Tersedia *</label>
                        <span className="text-[10px] font-bold text-blue-600 uppercase">Satuan: {unit === 'custom' ? (customUnit || 'pcs') : unit}</span>
                      </div>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        required
                        className="w-full max-w-[160px] p-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 bg-white"
                        value={stockQuantity === 0 ? '' : stockQuantity}
                        onChange={e => setStockQuantity(e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Deskripsi Produk</label>
                  <textarea
                    className="w-full p-2.5 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-medium text-slate-800 transition-all min-h-[80px] placeholder:text-slate-350 bg-white"
                    placeholder="Catatan atau spesifikasi produk..."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: Modal HPP & Formulasi Resep (Spacious Workstation Box) */}
            <div className="lg:col-span-7 space-y-5">
              
              <div className="border border-indigo-100 bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/40 rounded-2xl p-5 space-y-4 shadow-xs max-w-full">
                
                <div className="flex justify-between items-center border-b border-indigo-100/80 pb-3">
                  <div>
                    <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                      3. Skema Modal HPP & Harga Jual
                    </h4>
                    <p className="text-[11px] text-indigo-700/80 font-medium mt-0.5">Tentukan bagaimana HPP (Harga Pokok Penjualan) dihitung</p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200/60">
                    {hppType === 'variable' ? '🧪 Variabel (Resep/BOM)' : '📌 Flat (Tetap)'}
                  </span>
                </div>

                {/* Toggle Switch */}
                <div className="grid grid-cols-2 gap-2 bg-slate-200/60 p-1.5 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setHppType('fixed')}
                    className={`py-2 px-3 rounded-lg font-bold text-xs text-center transition-all ${
                      hppType === 'fixed'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    📌 Flat / Manual
                  </button>
                  <button
                    type="button"
                    onClick={() => setHppType('variable')}
                    className={`py-2 px-3 rounded-lg font-bold text-xs text-center transition-all ${
                      hppType === 'variable'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🧪 Variabel Bahan Baku (BOM)
                  </button>
                </div>

                {/* If Flat / Manual HPP */}
                {hppType === 'fixed' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Harga Jual (Rp) *</label>
                      <input
                        type="number"
                        min="0"
                        required
                        className="w-full p-3 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-semibold text-slate-800 transition-all placeholder:text-slate-400 bg-white"
                        value={price === 0 ? '' : price}
                        onChange={e => setPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">HPP / Harga Modal Beli (Rp)</label>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-3 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-semibold text-slate-800 transition-all placeholder:text-slate-400 bg-white"
                        value={costPrice === 0 ? '' : costPrice}
                        onChange={e => setCostPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder="0"
                      />
                    </div>
                  </div>
                ) : (
                  /* If Variable HPP (Recipe / Bill of Materials Workstation Builder) */
                  <div className="space-y-4 pt-1 animate-in fade-in duration-200 max-w-full">
                    
                    {/* Prices Banner */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Harga Jual (Rp) *</label>
                        <input
                          type="number"
                          min="0"
                          required
                          className="w-full p-3 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-semibold text-slate-800 transition-all placeholder:text-slate-400 bg-white"
                          value={price === 0 ? '' : price}
                          onChange={e => setPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-1.5">Total HPP Variabel (Terkalkulasi)</label>
                        <div className="w-full p-2.5 border border-indigo-200/90 rounded-xl bg-indigo-50/90 text-sm font-black text-indigo-900 flex justify-between items-center shadow-2xs">
                          <span>Rp {calculatedDynamicHpp.toLocaleString('id-ID')}</span>
                          <span className="text-[10px] text-indigo-600 font-bold bg-indigo-100 px-2 py-0.5 rounded-full">otomatis dari resep</span>
                        </div>
                      </div>
                    </div>

                    {/* Formulasi Resep Workstation Card - overflow-visible relative to ensure combobox dropdown floats without clipping */}
                    <div className="bg-white border border-indigo-100 rounded-2xl p-4 space-y-4 shadow-xs max-w-full relative z-10">
                      
                      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
                        <div>
                          <h5 className="text-xs font-extrabold text-slate-800 tracking-tight flex items-center gap-1.5">
                            <span>🧩</span> Formulasi Komponen & Bahan Penyusun (BOM)
                          </h5>
                          <p className="text-[10px] text-slate-500 font-medium">Cari & pilih komponen atau bahan penyusun produk</p>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {recipeRows.length} Komponen
                        </span>
                      </div>

                      {/* Add Ingredient Bar with Searchable Typing Combobox & Read-only Unit Badge */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 max-w-full relative z-20">
                        <IngredientSearchCombobox
                          options={availableIngredientsOptions}
                          selectedId={selectedIngredientId}
                          onSelect={productId => setSelectedIngredientId(productId)}
                          placeholder="Cari komponen, bahan baku, atau SKU..."
                        />

                        <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-start">
                          {/* Quantity input with read-only Unit Badge next to it */}
                          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-1 pr-2.5 shadow-2xs">
                            <input
                              type="number"
                              step="any"
                              min="0.0001"
                              className="w-20 p-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-indigo-600 bg-white text-center"
                              placeholder="Jumlah"
                              value={ingredientQtyInput}
                              onChange={e => setIngredientQtyInput(e.target.value)}
                            />
                            <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50/90 px-2 py-1 rounded-md border border-indigo-100/80 uppercase select-none">
                              {selectedIngredientUnit}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={handleAddIngredient}
                            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 flex items-center gap-1"
                          >
                            <span>+</span>
                            <span>Tambah</span>
                          </button>
                        </div>
                      </div>

                      {/* Recipe List Table Container with max-height scroll for long recipe lists */}
                      {recipeRows.length === 0 ? (
                        <div className="text-center py-8 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                          <p className="text-xs font-bold text-slate-400">Belum ada komponen ditambahkan</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Cari dan pilih komponen penyusun di atas untuk membentuk HPP variabel produk ini</p>
                        </div>
                      ) : (
                        <div className="space-y-2 max-w-full max-h-[380px] overflow-y-auto pr-1">
                          {recipeRows.map((r) => {
                            const rowCost = r.quantity * r.cost_price
                            return (
                              <div
                                key={r.ingredient_product_id}
                                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/40 hover:bg-indigo-50/30 transition-colors border border-slate-200/80 rounded-xl overflow-hidden shadow-2xs max-w-full"
                              >
                                {/* Product Info Section (wraps/break-words safely if long) */}
                                <div className="flex-1 min-w-0 pr-2">
                                  <p className="text-xs font-bold text-slate-800 break-words leading-snug">
                                    {r.ingredient_name}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50/90 px-2 py-0.5 rounded-md border border-indigo-100">
                                      Modal: Rp {(r.cost_price || 0).toLocaleString('id-ID')} / {r.unit}
                                    </span>
                                    {r.stock_type === 'tracked' && (
                                      <span className="text-[10px] font-medium text-slate-400">
                                        Stok: {r.stock_quantity} {r.unit}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Quantity Input, Subtotal HPP, & Delete Button */}
                                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 w-full sm:w-auto">
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[10px] font-bold text-slate-400 sm:hidden">Takaran:</span>
                                    <input
                                      type="number"
                                      step="any"
                                      min="0.0001"
                                      className="w-20 p-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-center text-slate-800 outline-none focus:border-indigo-500 bg-white shadow-2xs"
                                      value={r.quantity}
                                      onChange={e => handleUpdateIngredientQty(r.ingredient_product_id, e.target.value)}
                                    />
                                    <span className="text-[11px] font-bold text-slate-600 min-w-[32px]">{r.unit}</span>
                                  </div>

                                  <div className="text-right shrink-0 min-w-[95px]">
                                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Subtotal HPP</p>
                                    <p className="text-xs font-black text-indigo-900">
                                      Rp {rowCost.toLocaleString('id-ID')}
                                    </p>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveIngredient(r.ingredient_product_id)}
                                    className="w-7 h-7 flex items-center justify-center shrink-0 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-bold"
                                    title="Hapus bahan baku"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>

            </div>

          </div>

        </form>

        {/* Footer */}
        <div className="px-6 md:px-8 py-4 bg-slate-50 border-t border-slate-200 flex gap-3 justify-end items-center">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-all"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-400 transition-all flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Menyimpan...</span>
              </>
            ) : (
              <span>Simpan Produk</span>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
