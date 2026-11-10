"use client"
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'
import { invalidatePosCatalogCache, PosPriceTiers } from '@/lib/posCatalogStore'

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
  price_tiers?: PosPriceTiers | null
  cost_price: number
  type: 'physical' | 'service'
  category_id: string | null
  stock_type: 'tracked' | 'available' | 'unavailable'
  stock_quantity: number
  min_stock_alert?: number
  external_id?: string | null
  unit?: string
  pricing_type?: 'standard' | 'area'
  min_area?: number
  min_price?: number
  hpp_type?: 'fixed' | 'variable'
  prevent_below_hpp?: boolean
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

type VariantRow = {
  id?: string
  name: string
  sku: string
  price: number
  dine_in_price?: number | null
  take_away_price?: number | null
  cost_price: number
  stock_quantity: number
  min_stock_alert?: number
  external_id?: string | null
}

type ModifierOptionForm = {
  id?: string
  option_name: string
  price_extra: number
  cost_price: number
}

type ModifierGroupForm = {
  group_name: string
  is_required: boolean
  options: ModifierOptionForm[]
}

type MatrixAttribute = {
  name: string
  values: string
}

type ModalTab = 'general' | 'variants' | 'modifiers' | 'recipe'

type ProductModalProps = {
  isOpen: boolean
  onClose: () => void
  onSave: () => void
  product: Product | null // if null, it is "Add New" mode
  businessId: string
}

const COMMON_UNITS = [
  'pcs',
  'm2',
  'cm2',
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
  useModalBackHandler(isOpen, onClose)

  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<ModalTab>('general')
  const [categories, setCategories] = useState<Category[]>([])
  const [availableProducts, setAvailableProducts] = useState<Product[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form State
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState<number>(0)
  const [enableMultiPrice, setEnableMultiPrice] = useState(false)
  const [dineInPrice, setDineInPrice] = useState<number>(0)
  const [takeAwayPrice, setTakeAwayPrice] = useState<number>(0)
  const [costPrice, setCostPrice] = useState<number>(0)
  const [type, setType] = useState<'physical' | 'service'>('physical')
  const [categoryId, setCategoryId] = useState<string>('')
  const [stockType, setStockType] = useState<'tracked' | 'available' | 'unavailable'>('available')
  const [stockQuantity, setStockQuantity] = useState<number>(0)
  const [minStockAlert, setMinStockAlert] = useState<number>(0)
  const [unit, setUnit] = useState<string>('pcs')
  const [customUnit, setCustomUnit] = useState<string>('')
  const [pricingType, setPricingType] = useState<'standard' | 'area'>('standard')
  const [minArea, setMinArea] = useState<number>(0)
  const [minPrice, setMinPrice] = useState<number>(0)
  const [hppType, setHppType] = useState<'fixed' | 'variable'>('fixed')
  const [preventBelowHpp, setPreventBelowHpp] = useState(false)
  const [globalPriceGuardEnabled, setGlobalPriceGuardEnabled] = useState(false)

  // Recipe Builder State
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([])
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>('')
  const [ingredientQtyInput, setIngredientQtyInput] = useState<string>('1')
  const [loadingRecipes, setLoadingRecipes] = useState(false)

  // New Category State
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState('')

  // Variant Rows State
  const [variantRows, setVariantRows] = useState<VariantRow[]>([])
  const [loadingVariants, setLoadingVariants] = useState(false)

  // Modifier Groups State
  const [modifierGroups, setModifierGroups] = useState<ModifierGroupForm[]>([])
  const [businessModifierTemplates, setBusinessModifierTemplates] = useState<ModifierGroupForm[]>([])
  const [loadingModifiers, setLoadingModifiers] = useState(false)

  // Matrix Generator State (Shopee / WooCommerce Dynamic Attributes Standard)
  const [showMatrixGen, setShowMatrixGen] = useState(false)
  const [matrixAttributes, setMatrixAttributes] = useState<MatrixAttribute[]>([
    { name: 'Warna', values: 'Hitam, Putih, Merah' },
    { name: 'Ukuran', values: 'S, M, L, XL' }
  ])
  const [preserveExistingVariants, setPreserveExistingVariants] = useState(true)
  const [bulkMatrixPrice, setBulkMatrixPrice] = useState<number>(0)
  const [bulkMatrixCostPrice, setBulkMatrixCostPrice] = useState<number>(0)
  const [bulkMatrixStock, setBulkMatrixStock] = useState<number>(10)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Lock html & body scroll completely when open (prevents background scroll chaining)
  useEffect(() => {
    if (isOpen) {
      const prevBodyOverflow = document.body.style.overflow
      const prevHtmlOverflow = document.documentElement.style.overflow
      const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      document.documentElement.style.overscrollBehavior = 'none'
      return () => {
        document.body.style.overflow = prevBodyOverflow
        document.documentElement.style.overflow = prevHtmlOverflow
        document.documentElement.style.overscrollBehavior = prevHtmlOverscroll
      }
    }
  }, [isOpen])

  // Load categories, products, modifier templates, and check global price guard
  useEffect(() => {
    if (isOpen && businessId) {
      fetchCategories()
      fetchAvailableProducts()
      fetchBusinessModifierTemplates()

      const checkGuard = async () => {
        try {
          const { data, error } = await supabase
            .from('price_guard_settings')
            .select('global_enabled')
            .eq('business_id', businessId)
            .maybeSingle()
          if (!error && data) {
            setGlobalPriceGuardEnabled(Boolean(data.global_enabled))
            return
          }
          const { data: intRows } = await supabase
            .from('integrations')
            .select('api_credentials')
            .eq('platform_name', 'pos_price_guard')
            .filter('api_credentials->>business_id', 'eq', businessId)
            .limit(1)
          const creds = intRows?.[0]?.api_credentials
          if (creds) {
            setGlobalPriceGuardEnabled(Boolean(creds.global_enabled))
          }
        } catch {
          // Ignore error silently
        }
      }
      checkGuard()
    }
  }, [isOpen, businessId])

  // Populate form on edit mode
  useEffect(() => {
    if (isOpen) {
      setActiveTab('general')
      if (product) {
        setName(product.name || '')
        setSku(product.sku || '')
        setDescription(product.description || '')
        setPrice(product.price || 0)

        const tiers = (product as any).price_tiers
        const dPrice = Number(tiers?.dine_in || 0)
        const tPrice = Number(tiers?.take_away || 0)
        setDineInPrice(dPrice)
        setTakeAwayPrice(tPrice)
        setEnableMultiPrice(dPrice > 0 || tPrice > 0)

        setCostPrice(product.cost_price || 0)
        setType(product.type || 'physical')
        setCategoryId(product.category_id || '')
        setStockType(product.stock_type || 'available')
        setStockQuantity(product.stock_quantity || 0)
        setMinStockAlert(Number((product as any).min_stock_alert || 0))

        const initialUnit = product.unit || 'pcs'
        if (COMMON_UNITS.includes(initialUnit)) {
          setUnit(initialUnit)
          setCustomUnit('')
        } else {
          setUnit('custom')
          setCustomUnit(initialUnit)
        }

        setHppType(product.hpp_type || 'fixed')
        setPricingType(product.pricing_type || 'standard')
        setMinArea(Number(product.min_area) || 0)
        setMinPrice(Number(product.min_price) || 0)
        setPreventBelowHpp(Boolean((product as any)?.prevent_below_hpp))
        setShowNewCategoryInput(false)
        setNewCategoryName('')
        setCategoryError('')

        if (product.id) {
          fetchProductRecipes(product.id)
          fetchProductVariants(product.id)
          fetchProductModifiers(product.id)
        } else {
          setRecipeRows([])
          setVariantRows([])
          setModifierGroups([])
        }
      } else {
        setName('')
        setSku('')
        setDescription('')
        setPrice(0)
        setEnableMultiPrice(false)
        setDineInPrice(0)
        setTakeAwayPrice(0)
        setCostPrice(0)
        setType('physical')
        setCategoryId('')
        setStockType('available')
        setStockQuantity(0)
        setMinStockAlert(0)
        setUnit('pcs')
        setCustomUnit('')
        setHppType('fixed')
        setPricingType('standard')
        setMinArea(0)
        setMinPrice(0)
        setPreventBelowHpp(false)
        setRecipeRows([])
        setVariantRows([])
        setModifierGroups([])
        setShowMatrixGen(false)
        setMatrixAttributes([
          { name: 'Warna', values: 'Hitam, Putih, Merah' },
          { name: 'Ukuran', values: 'S, M, L, XL' }
        ])
        setPreserveExistingVariants(true)
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
    } catch {
      setRecipeRows([])
    } finally {
      setLoadingRecipes(false)
    }
  }

  const fetchProductVariants = async (productId: string) => {
    setLoadingVariants(true)
    try {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: true })

      if (!error && data) {
        let hasVariantTiers = false
        const mapped = data.map((v: any) => {
          const dPrice = Number(v.price_tiers?.dine_in || 0)
          const tPrice = Number(v.price_tiers?.take_away || 0)
          if (dPrice > 0 || tPrice > 0) hasVariantTiers = true
          return {
            id: v.id,
            name: v.name,
            sku: v.sku || '',
            price: Number(v.price || 0),
            dine_in_price: dPrice > 0 ? dPrice : null,
            take_away_price: tPrice > 0 ? tPrice : null,
            cost_price: Number(v.cost_price || 0),
            stock_quantity: Number(v.stock_quantity || 0),
            min_stock_alert: Number(v.min_stock_alert || 0),
            external_id: v.external_id || null
          }
        })
        setVariantRows(mapped)
        if (hasVariantTiers) setEnableMultiPrice(true)

        // Smart attribute detection from existing variant names (e.g. "Hitam - S", "Putih - M")
        if (mapped.length > 0) {
          const sampleNames = mapped.map((m: any) => (m.name || '').split(' - ').map((s: string) => s.trim()))
          const partsCount = sampleNames[0]?.length || 1
          const isConsistent = sampleNames.every((p: string[]) => p.length === partsCount)
          if (isConsistent && partsCount > 0) {
            const detectedAttrs: MatrixAttribute[] = []
            for (let i = 0; i < partsCount; i++) {
              const uniqueVals = Array.from(new Set(sampleNames.map((p: string[]) => p[i]).filter(Boolean)))
              const defaultName = partsCount === 1 ? 'Varian' : (i === 0 ? 'Warna' : (i === 1 ? 'Ukuran' : (i === 2 ? 'Bahan' : `Atribut ${i + 1}`)))
              detectedAttrs.push({
                name: defaultName,
                values: uniqueVals.join(', ')
              })
            }
            if (detectedAttrs.length > 0) {
              setMatrixAttributes(detectedAttrs)
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching variants:', err)
    } finally {
      setLoadingVariants(false)
    }
  }

  const fetchProductModifiers = async (productId: string) => {
    setLoadingModifiers(true)
    try {
      const { data, error } = await supabase
        .from('product_modifiers')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: true })

      if (!error && data && data.length > 0) {
        const groupMap = new Map<string, ModifierGroupForm>()
        for (const m of data) {
          const gName = m.group_name || 'Level / Topping'
          if (!groupMap.has(gName)) {
            groupMap.set(gName, {
              group_name: gName,
              is_required: Boolean(m.is_required),
              options: []
            })
          }
          groupMap.get(gName)!.options.push({
            id: m.id,
            option_name: m.option_name || '',
            price_extra: Number(m.price_extra || 0),
            cost_price: Number(m.cost_price || 0)
          })
        }
        setModifierGroups(Array.from(groupMap.values()))
      } else {
        setModifierGroups([])
      }
    } catch {
      setModifierGroups([])
    } finally {
      setLoadingModifiers(false)
    }
  }

  // Fetch distinct modifier groups in this business so user can 1-click apply existing modifier sets (Moka Library style)
  const fetchBusinessModifierTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('product_modifiers')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true })
        .limit(500)

      if (!error && data && data.length > 0) {
        const templateMap = new Map<string, ModifierGroupForm>()
        for (const m of data) {
          const gName = (m.group_name || '').trim()
          if (!gName) continue
          const key = gName.toLowerCase()
          if (!templateMap.has(key)) {
            templateMap.set(key, {
              group_name: gName,
              is_required: Boolean(m.is_required),
              options: []
            })
          }
          const grp = templateMap.get(key)!
          const optName = (m.option_name || '').trim()
          if (optName && !grp.options.some(o => o.option_name.toLowerCase() === optName.toLowerCase())) {
            grp.options.push({
              option_name: optName,
              price_extra: Number(m.price_extra || 0),
              cost_price: Number(m.cost_price || 0)
            })
          }
        }
        setBusinessModifierTemplates(Array.from(templateMap.values()))
      }
    } catch {
      // ignore
    }
  }

  // Preview total combinations calculated from active matrix attributes
  const previewCombinationsCount = useMemo(() => {
    const activeArrays = matrixAttributes
      .map(a => a.values.split(',').map(s => s.trim()).filter(Boolean))
      .filter(arr => arr.length > 0)
    if (activeArrays.length === 0) return 0
    return activeArrays.reduce((acc, curr) => acc * curr.length, 1)
  }, [matrixAttributes])

  const handleGenerateMatrix = () => {
    const activeAttrs = matrixAttributes
      .map(a => ({
        name: a.name.trim() || 'Varian',
        values: a.values.split(',').map(s => s.trim()).filter(Boolean)
      }))
      .filter(a => a.values.length > 0)

    if (activeAttrs.length === 0) {
      alert('Masukkan setidaknya satu tipe variasi beserta pilihan nilainya!')
      return
    }

    const valueArrays = activeAttrs.map(a => a.values)
    const combinations: string[][] = valueArrays.reduce<string[][]>(
      (acc, curr) => {
        if (acc.length === 0) return curr.map(item => [item])
        const res: string[][] = []
        for (const a of acc) {
          for (const c of curr) {
            res.push([...a, c])
          }
        }
        return res
      },
      []
    )

    if (combinations.length === 0) {
      alert('Tidak ada kombinasi varian yang dapat dibuat.')
      return
    }

    if (combinations.length > 250) {
      const confirmContinue = confirm(
        `Kombinasi atribut menghasilkan ${combinations.length} varian. Lanjutkan pembuatan?`
      )
      if (!confirmContinue) return
    }

    const baseSkuVal = sku ? sku.trim() : (name ? name.slice(0, 3).toUpperCase() : 'SKU')
    const finalPriceVal = Number(bulkMatrixPrice || price || 0)
    const parentEffectiveCost = hppType === 'variable' ? calculatedDynamicHpp : (Number(costPrice) || 0)
    const finalCostVal = Number(bulkMatrixCostPrice || parentEffectiveCost)
    const finalStockVal = Number(bulkMatrixStock || 0)

    // Map existing variants by normalized name for non-destructive merge
    const existingMap = new Map<string, VariantRow>()
    if (preserveExistingVariants) {
      for (const v of variantRows) {
        if (v.name) existingMap.set(v.name.trim().toLowerCase(), v)
      }
    }

    const generated: VariantRow[] = combinations.map(combo => {
      const comboName = combo.join(' - ')
      const existing = existingMap.get(comboName.toLowerCase())

      if (existing && preserveExistingVariants) {
        // PRESERVE historical ID, price, cost_price, SKU, and stock!
        return {
          ...existing,
          name: comboName // maintain standardized formatting
        }
      }

      // Generate clean SKU suffix
      const skuSuffix = combo
        .map(c => c.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'VAR')
        .join('-')

      return {
        name: comboName,
        sku: `${baseSkuVal}-${skuSuffix}`,
        price: finalPriceVal,
        dine_in_price: dineInPrice > 0 ? dineInPrice : null,
        take_away_price: takeAwayPrice > 0 ? takeAwayPrice : null,
        cost_price: finalCostVal,
        stock_quantity: finalStockVal
      }
    })

    setVariantRows(generated)
    setShowMatrixGen(false)
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
      setActiveTab('recipe')
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

      // Build price_tiers JSONB cleanly
      const productPriceTiers: PosPriceTiers = {}
      if (enableMultiPrice) {
        if (Number(dineInPrice) > 0) productPriceTiers.dine_in = Number(dineInPrice)
        if (Number(takeAwayPrice) > 0) productPriceTiers.take_away = Number(takeAwayPrice)
      }

      // If base price is 0 and Dine-In/Take-Away price is filled, smart coalesce to prevent Rp 0 base price
      const effectiveBasePrice =
        Number(price) > 0
          ? Number(price)
          : Number(productPriceTiers.dine_in || productPriceTiers.take_away || 0)

      // 2. Insert or update product
      const productPayload: Record<string, any> = {
        business_id: businessId,
        name: name.trim(),
        sku: sku.trim() || null,
        description: description.trim() || null,
        price: effectiveBasePrice,
        price_tiers: productPriceTiers,
        cost_price: finalHpp,
        type,
        category_id: finalCategoryId,
        stock_type: stockType,
        stock_quantity: stockType === 'tracked'
          ? (variantRows.length > 0 ? variantRows.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0) : Number(stockQuantity))
          : 0,
        min_stock_alert: Number(minStockAlert) || 0,
        unit: effectiveUnit,
        pricing_type: pricingType,
        min_area: Number(minArea) || 0,
        min_price: Number(minPrice) || 0,
        hpp_type: hppType,
        prevent_below_hpp: globalPriceGuardEnabled ? true : preventBelowHpp,
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

      // Stage 1 Fallback: if price_tiers or min_stock_alert column not migrated yet
      if (res.error && res.error.message && (res.error.message.includes('price_tiers') || res.error.message.includes('min_stock_alert') || res.error.message.includes('schema cache') || res.error.message.includes('column'))) {
        const fallbackStage1 = { ...productPayload }
        delete fallbackStage1.price_tiers
        delete fallbackStage1.min_stock_alert
        res = await executeSave(fallbackStage1)
      }

      // Stage 2 Fallback: legacy schema fallback
      if (res.error && res.error.message && (res.error.message.includes('schema cache') || res.error.message.includes('prevent_below_hpp') || res.error.message.includes('pricing_type') || res.error.message.includes('min_area') || res.error.message.includes('column'))) {
        const fallbackPayload = { ...productPayload }
        delete fallbackPayload.price_tiers
        delete fallbackPayload.min_stock_alert
        delete fallbackPayload.hpp_type
        delete fallbackPayload.unit
        delete fallbackPayload.pricing_type
        delete fallbackPayload.min_area
        delete fallbackPayload.min_price
        delete fallbackPayload.prevent_below_hpp
        res = await executeSave(fallbackPayload)
      }

      if (res.error) throw res.error
      if (res.data?.id) savedProductId = res.data.id

      // Record initial opening stock for standard product if newly created with stock > 0 and no variants
      if (!product?.id && savedProductId && variantRows.length === 0 && stockType === 'tracked' && Number(stockQuantity) > 0) {
        try {
          await supabase.from('stock_moves').insert({
            business_id: businessId,
            product_id: savedProductId,
            type: 'receipt',
            bucket: 'main',
            qty: Number(stockQuantity),
            reference: 'STOK-AWAL',
            description: `Stok awal produk: ${name.trim()}`,
            status: 'done'
          })
        } catch (smErr) {
          console.warn('Note: initial product stock_moves fallback:', smErr)
        }
      }

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

            await supabase.from('product_recipes').insert(recipesToInsert)
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
        } catch {
          // ignore
        }
      }

      // 4. Save product variants (with price_tiers & schema fallback)
      if (savedProductId) {
        try {
          if (product?.id) {
            const currentIds = variantRows.filter(v => v.id).map(v => v.id)
            if (currentIds.length > 0) {
              await supabase
                .from('product_variants')
                .delete()
                .eq('product_id', savedProductId)
                .not('id', 'in', `(${currentIds.join(',')})`)
            } else if (variantRows.length === 0) {
              await supabase
                .from('product_variants')
                .delete()
                .eq('product_id', savedProductId)
            }
          }

          if (variantRows.length > 0) {
            for (const v of variantRows) {
              if (!v.name.trim()) continue
              const vTiers: PosPriceTiers = {}
              if (enableMultiPrice) {
                if (Number(v.dine_in_price) > 0) vTiers.dine_in = Number(v.dine_in_price)
                if (Number(v.take_away_price) > 0) vTiers.take_away = Number(v.take_away_price)
              }
              const vEffectivePrice =
                Number(v.price) > 0
                  ? Number(v.price)
                  : Number(vTiers.dine_in || vTiers.take_away || effectiveBasePrice || 0)

              const parentEffectiveCost = hppType === 'variable' ? calculatedDynamicHpp : (Number(costPrice) || 0)
              const vEffectiveCostPrice =
                Number(v.cost_price) > 0
                  ? Number(v.cost_price)
                  : parentEffectiveCost

              const vPayload: Record<string, any> = {
                business_id: businessId,
                product_id: savedProductId,
                name: v.name.trim(),
                sku: v.sku ? v.sku.trim() : null,
                price: vEffectivePrice,
                price_tiers: vTiers,
                cost_price: vEffectiveCostPrice,
                stock_quantity: Number(v.stock_quantity) || 0
              }

              if (v.id) {
                const { error: updVErr } = await supabase.from('product_variants').update(vPayload).eq('id', v.id)
                if (updVErr) {
                  const fallbackV = { ...vPayload }
                  delete fallbackV.price_tiers
                  await supabase.from('product_variants').update(fallbackV).eq('id', v.id)
                }
              } else {
                let { data: newV, error: insVErr } = await supabase
                  .from('product_variants')
                  .insert(vPayload)
                  .select('id')
                  .single()

                if (insVErr) {
                  const fallbackV = { ...vPayload }
                  delete fallbackV.price_tiers
                  const retryV = await supabase.from('product_variants').insert(fallbackV).select('id').single()
                  newV = retryV.data
                }

                if (newV?.id && stockType === 'tracked' && Number(v.stock_quantity) > 0) {
                  try {
                    await supabase.from('stock_moves').insert({
                      business_id: businessId,
                      product_id: savedProductId,
                      variant_id: newV.id,
                      type: 'receipt',
                      bucket: 'main',
                      qty: Number(v.stock_quantity),
                      reference: 'STOK-AWAL-VARIAN',
                      description: `Stok awal variasi: ${v.name.trim()}`,
                      status: 'done'
                    })
                  } catch (smErr) {
                    console.warn('Note: initial variant stock_moves fallback:', smErr)
                  }
                }
              }
            }
          }
        } catch (vErr) {
          console.warn('Note: Variant save fallback:', vErr)
        }
      }

      // 5. Save product modifiers (with schema fallback for cost_price)
      if (savedProductId) {
        try {
          await supabase
            .from('product_modifiers')
            .delete()
            .eq('product_id', savedProductId)

          const modPayloads: Record<string, any>[] = []
          modifierGroups.forEach((grp) => {
            const gName = grp.group_name.trim()
            if (!gName) return
            grp.options.forEach((opt) => {
              const oName = opt.option_name.trim()
              if (!oName) return
              modPayloads.push({
                business_id: businessId,
                product_id: savedProductId,
                group_name: gName,
                option_name: oName,
                price_extra: Number(opt.price_extra || 0),
                cost_price: Number(opt.cost_price || 0),
                is_required: Boolean(grp.is_required)
              })
            })
          })

          if (modPayloads.length > 0) {
            const { error: modErr } = await supabase.from('product_modifiers').insert(modPayloads)
            if (modErr) {
              const fallbackMods = modPayloads.map(({ cost_price, ...rest }) => rest)
              await supabase.from('product_modifiers').insert(fallbackMods)
            }
          }
        } catch (mErr) {
          console.warn('Note: Modifiers save fallback:', mErr)
        }
      }

      // 6. Immediately invalidate POS Catalog L1 + L2 + BroadcastChannel so POS never disconnects!
      invalidatePosCatalogCache(businessId, true)

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

  const availableIngredientsOptions = availableProducts.filter(
    p => p.id !== product?.id && !recipeRows.some(r => r.ingredient_product_id === p.id)
  )

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex justify-center items-center p-0 sm:p-3 md:p-4 overflow-hidden overscroll-none z-[99] animate-in fade-in duration-200"
    >
      <div
        className="bg-slate-50 border-0 sm:border sm:border-slate-200/90 rounded-none sm:rounded-2xl shadow-2xl w-screen h-[100dvh] sm:w-[96vw] sm:max-w-5xl sm:h-[94dvh] sm:max-h-[94dvh] flex flex-col overflow-hidden overscroll-contain transform scale-100 transition-all duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Sticky Workstation Header (Mekari Jurnal / Shopify Standard) */}
        <div className="bg-white border-b border-slate-200 shrink-0 px-4 sm:px-6 md:px-8 py-3.5">
          <div className="max-w-4xl mx-auto flex justify-between items-center gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/60 text-[10px] font-black uppercase tracking-wider">
                  {product ? 'Edit Katalog' : 'Produk Baru'}
                </span>
                <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight truncate">
                  {product ? (name || product.name) : 'Tambah Produk Baru'}
                </h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5 truncate">
                Manajemen Katalog Terpadu — Informasi Utama, Skema Harga, Variasi SKU, Opsi Tambahan, & Komposisi HPP
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors text-lg font-light focus:outline-none cursor-pointer shrink-0"
              aria-label="Tutup"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sticky Segmented Navigation Tabs (Centered to match Workstation Canvas) */}
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 md:px-8 shrink-0">
          <div className="max-w-4xl mx-auto pt-2 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              className={`px-4 py-2.5 rounded-t-xl text-xs font-extrabold transition border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'general'
                  ? 'bg-slate-50 text-blue-700 border-blue-600'
                  : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50/60'
              }`}
            >
              <span>📦</span>
              <span>Info & Harga Utama</span>
              {enableMultiPrice && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-emerald-100 text-emerald-800">
                  Multi-Harga
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('variants')}
              className={`px-4 py-2.5 rounded-t-xl text-xs font-extrabold transition border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'variants'
                  ? 'bg-slate-50 text-blue-700 border-blue-600'
                  : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50/60'
              }`}
            >
              <span>🏷️</span>
              <span>Varian SKU</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                variantRows.length > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-200/80 text-slate-500'
              }`}>
                {variantRows.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('modifiers')}
              className={`px-4 py-2.5 rounded-t-xl text-xs font-extrabold transition border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'modifiers'
                  ? 'bg-slate-50 text-purple-700 border-purple-600'
                  : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50/60'
              }`}
            >
              <span>✨</span>
              <span>Opsi Tambahan / Modifier</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                modifierGroups.length > 0 ? 'bg-purple-100 text-purple-700' : 'bg-slate-200/80 text-slate-500'
              }`}>
                {modifierGroups.length}
              </span>
            </button>

            <button
              type="button"
              disabled={hppType !== 'variable'}
              title={
                hppType === 'variable'
                  ? 'Kelola komposisi bahan baku & resep HPP'
                  : 'Aktifkan "Variabel Resep (BOM)" di tab Info & Harga Utama terlebih dahulu untuk membuka tab ini'
              }
              onClick={() => {
                if (hppType !== 'variable') return
                setActiveTab('recipe')
              }}
              className={`px-4 py-2.5 rounded-t-xl text-xs font-extrabold transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                hppType !== 'variable'
                  ? 'text-slate-400 border-transparent opacity-60 cursor-not-allowed select-none'
                  : activeTab === 'recipe'
                    ? 'bg-slate-50 text-indigo-700 border-indigo-600 cursor-pointer'
                    : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50/60 cursor-pointer'
              }`}
            >
              <span>🧪</span>
              <span>Resep & BOM HPP</span>
              {hppType !== 'variable' ? (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-slate-200/80 text-slate-500">
                  🔒 Nonaktif
                </span>
              ) : (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  recipeRows.length > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200/80 text-slate-500'
                }`}>
                  {recipeRows.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Single Isolated Scrollable Workstation Body (Centered Canvas max-w-4xl) */}
        <form
          onSubmit={handleSave}
          className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 md:px-8 py-6"
        >
          <div className="max-w-4xl mx-auto space-y-6">
          {/* ================================================================= */}
          {/* TAB 1: INFO & HARGA UTAMA                                         */}
          {/* ================================================================= */}
          {activeTab === 'general' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start animate-in fade-in duration-150">
              {/* LEFT COLUMN: Identitas & Stok */}
              <div className="lg:col-span-6 space-y-5">
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b border-slate-200/60 pb-2">
                    1. Identitas Produk
                  </h4>

                  {/* Jenis Produk */}
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
                        <span>Produk Fisik / Menu</span>
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
                        <span>Jasa / Layanan</span>
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
                      placeholder="Contoh: Kopi Susu, Nasi Goreng Jawa, Kemeja Flannel..."
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </div>

                  {/* SKU & Satuan */}
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

                  {showNewCategoryInput && (
                    <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 animate-in slide-in-from-top-2 duration-150">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nama Kategori Baru *</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 bg-white"
                          placeholder="Contoh: PANGANAN, MINUMAN..."
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

                  {/* Skema Harga Standar vs Dimensi Unit */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Skema Kalkulasi Unit</label>
                      <span className="text-[10px] font-bold text-slate-500">
                        {pricingType === 'area' ? '📐 Dimensi Unit (P × L)' : '📌 Standar (Per Pcs/Unit)'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPricingType('standard')
                          if (unit === 'm2' || unit === 'cm2') setUnit('pcs')
                        }}
                        className={`py-2 px-3 border rounded-xl font-bold text-xs text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                          pricingType === 'standard'
                            ? 'border-indigo-600 bg-indigo-50/80 text-indigo-700 shadow-xs ring-1 ring-indigo-600/30'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                      >
                        <span>📌</span>
                        <span>Standar / Tetap</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPricingType('area')
                          if (unit !== 'm2' && unit !== 'cm2') setUnit('m2')
                        }}
                        className={`py-2 px-3 border rounded-xl font-bold text-xs text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                          pricingType === 'area'
                            ? 'border-indigo-600 bg-indigo-50/80 text-indigo-700 shadow-xs ring-1 ring-indigo-600/30'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                      >
                        <span>📐</span>
                        <span>Dimensi Unit (P × L)</span>
                      </button>
                    </div>
                    {pricingType === 'area' && (
                      <div className="mt-2.5 p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2 text-xs">
                        <p className="text-[10px] font-medium text-indigo-800/90 leading-relaxed">
                          Kalkulasi otomatis berdasarkan ukuran <strong>Panjang × Lebar</strong> saat transaksi (cocok untuk kaca, kain, keramik, karpet, spanduk, akrilik, kayu, dll).
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-indigo-950 uppercase">Ukuran Minimum Order</label>
                            <div className="flex items-center gap-1 mt-1">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full p-2 border border-indigo-300 rounded-lg text-xs font-bold text-slate-800 bg-white outline-none"
                                placeholder="0"
                                value={minArea === 0 ? '' : minArea}
                                onChange={e => setMinArea(e.target.value === '' ? 0 : Number(e.target.value))}
                              />
                              <span className="text-[11px] font-bold text-indigo-700 shrink-0">{unit}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-indigo-950 uppercase">Satuan Dimensi</label>
                            <select
                              className="w-full mt-1 p-2 border border-indigo-300 rounded-lg text-xs font-bold text-slate-800 bg-white outline-none"
                              value={unit}
                              onChange={e => setUnit(e.target.value)}
                            >
                              <option value="m2">m² (Meter Persegi)</option>
                              <option value="cm2">cm² (Centimeter Persegi)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stok & Deskripsi */}
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b border-slate-200/60 pb-2">
                    2. Manajemen Stok & Catatan
                  </h4>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Status Pelacakan Stok</label>
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
                        Tersedia (Non-Lacak)
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
                        Habis / Nonaktif
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
                        Ditrack (Lacak Stok)
                      </button>
                    </div>

                    {stockType === 'tracked' && (
                      <div className="mt-3 p-3 bg-blue-50/50 border border-blue-100 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in slide-in-from-top-2 duration-150">
                        <div>
                          <label className="block text-[10px] font-bold text-blue-800 uppercase tracking-wider mb-1">
                            {variantRows.length > 0 ? 'Total Stok Varian' : 'Jumlah Stok Fisik *'}
                          </label>
                          {variantRows.length > 0 ? (
                            <input
                              type="number"
                              disabled
                              className="w-full p-2 border border-blue-200 rounded-lg text-xs font-bold text-blue-900 bg-blue-100/60 cursor-not-allowed"
                              value={variantRows.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0)}
                            />
                          ) : (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              required
                              className="w-full p-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 bg-white"
                              value={stockQuantity === 0 ? '' : stockQuantity}
                              onChange={e => setStockQuantity(e.target.value === '' ? 0 : Number(e.target.value))}
                              placeholder="0"
                            />
                          )}
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-blue-800 uppercase tracking-wider mb-1">
                            Batas Peringatan Stok (Alert)
                          </label>
                          <input
                            type="number"
                            min="0"
                            className="w-full p-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-semibold text-slate-800 bg-white"
                            value={minStockAlert === 0 ? '' : minStockAlert}
                            onChange={e => setMinStockAlert(e.target.value === '' ? 0 : Number(e.target.value))}
                            placeholder="Contoh: 5"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Deskripsi / Catatan Produk</label>
                    <textarea
                      className="w-full p-2.5 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-xs font-medium text-slate-800 transition-all min-h-[70px] bg-white"
                      placeholder="Catatan atau spesifikasi produk..."
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Harga Jual, Multi-Harga (Dine-In/Take Away), & HPP */}
              <div className="lg:col-span-6 space-y-5">
                <div className="border border-indigo-100 bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/40 rounded-2xl p-5 space-y-4 shadow-xs">
                  <div className="flex justify-between items-center border-b border-indigo-100/80 pb-3">
                    <div>
                      <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                        3. Harga Jual & Modal HPP
                      </h4>
                      <p className="text-[11px] text-indigo-700/80 font-medium mt-0.5">
                        Harga dasar, opsi harga Dine-In/Take Away, dan perhitungan modal
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200/60">
                      {hppType === 'variable' ? '🧪 Resep BOM' : '📌 HPP Flat'}
                    </span>
                  </div>

                  {/* Toggle Skema HPP */}
                  <div className="grid grid-cols-2 gap-2 bg-slate-200/60 p-1.5 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setHppType('fixed')}
                      className={`py-2 px-3 rounded-lg font-bold text-xs text-center transition-all cursor-pointer ${
                        hppType === 'fixed'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      📌 HPP Flat / Manual
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHppType('variable')
                      }}
                      className={`py-2 px-3 rounded-lg font-bold text-xs text-center transition-all cursor-pointer ${
                        hppType === 'variable'
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      🧪 Variabel Resep (BOM)
                    </button>
                  </div>

                  {/* Harga Jual Utama & HPP */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        Harga Jual Dasar (Basic) *
                      </label>
                      <input
                        type="number"
                        min="0"
                        required
                        className="w-full p-3 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-bold text-slate-900 bg-white"
                        value={price === 0 ? '' : price}
                        onChange={e => setPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder="0"
                      />
                    </div>

                    {hppType === 'fixed' ? (
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                          HPP / Harga Modal (Rp)
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="w-full p-3 border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-sm font-bold text-slate-900 bg-white"
                          value={costPrice === 0 ? '' : costPrice}
                          onChange={e => setCostPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                          placeholder="0"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-1.5">
                          Total HPP Resep (Otomatis)
                        </label>
                        <div className="w-full p-3 border border-indigo-200 rounded-xl bg-indigo-50 text-sm font-black text-indigo-900 flex justify-between items-center">
                          <span>Rp {calculatedDynamicHpp.toLocaleString('id-ID')}</span>
                          <button
                            type="button"
                            onClick={() => setActiveTab('recipe')}
                            className="text-[10px] text-white bg-indigo-600 hover:bg-indigo-700 font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                          >
                            Atur Resep ({recipeRows.length}) →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Progressive Disclosure: Harga Khusus Channel / Tipe Layanan */}
                  <div className="p-3.5 rounded-2xl border border-slate-200/90 bg-white space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                          <span>🍽️</span> Harga Khusus Tipe Layanan (Dine-In / Take Away)
                        </span>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                          Opsional. Atur tarif berbeda berdasarkan tipe layanan (misal: Makan di Tempat vs Bungkus / Pesan Antar). Jika dikosongkan, sistem otomatis memakai Harga Jual Dasar.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={enableMultiPrice}
                          onChange={e => setEnableMultiPrice(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-5.5 bg-slate-200 rounded-full peer peer-checked:bg-emerald-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4.5 after:w-4.5 after:transition-all"></div>
                      </label>
                    </div>

                    {enableMultiPrice && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 animate-in fade-in duration-150">
                        <div>
                          <label className="block text-[10px] font-bold text-indigo-700 uppercase mb-1">
                            🍽️ Harga Dine-In (Makan di Tempat)
                          </label>
                          <input
                            type="number"
                            min="0"
                            className="w-full p-2.5 border border-indigo-200 rounded-xl text-xs font-bold text-slate-800 bg-indigo-50/30 outline-none focus:border-indigo-600"
                            placeholder={price > 0 ? `Sama dgn Dasar (Rp ${price.toLocaleString('id-ID')})` : 'Contoh: 15000'}
                            value={dineInPrice === 0 ? '' : dineInPrice}
                            onChange={e => setDineInPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-emerald-700 uppercase mb-1">
                            🛍️ Harga Take Away (Bungkus)
                          </label>
                          <input
                            type="number"
                            min="0"
                            className="w-full p-2.5 border border-emerald-200 rounded-xl text-xs font-bold text-slate-800 bg-emerald-50/30 outline-none focus:border-emerald-600"
                            placeholder={price > 0 ? `Sama dgn Dasar (Rp ${price.toLocaleString('id-ID')})` : 'Contoh: 15000'}
                            value={takeAwayPrice === 0 ? '' : takeAwayPrice}
                            onChange={e => setTakeAwayPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Ringkasan Cepat Varian & Modifier (Quick Jump Cards) */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('variants')}
                      className="p-3 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/30 transition text-left flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Varian Produk</p>
                        <p className="text-xs font-extrabold text-slate-800 mt-0.5">
                          {variantRows.length > 0 ? `${variantRows.length} Variasi Aktif` : 'Produk Tunggal'}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-blue-600">Kelola →</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('modifiers')}
                      className="p-3 rounded-xl border border-slate-200 bg-white hover:border-purple-400 hover:bg-purple-50/30 transition text-left flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Opsi Tambahan</p>
                        <p className="text-xs font-extrabold text-slate-800 mt-0.5">
                          {modifierGroups.length > 0 ? `${modifierGroups.length} Grup Opsi` : 'Belum Ada'}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-purple-600">Kelola →</span>
                    </button>
                  </div>

                  {/* Proteksi Harga Jual Minimum HPP */}
                  <div className={`p-3.5 rounded-2xl border transition-all ${
                    globalPriceGuardEnabled || preventBelowHpp
                      ? 'bg-blue-50/70 border-blue-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm">🛡️</span>
                          <span className="text-xs font-bold text-slate-900">
                            Proteksi Harga Jual Minimum HPP di POS
                          </span>
                          {globalPriceGuardEnabled && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-600 text-white uppercase">
                              Global Aktif
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">
                          Cegah kasir menjual atau memberi diskon hingga jatuh di bawah modal HPP tanpa PIN Otorisasi.
                        </p>
                      </div>

                      <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                        <input
                          type="checkbox"
                          disabled={globalPriceGuardEnabled}
                          checked={globalPriceGuardEnabled || preventBelowHpp}
                          onChange={(e) => setPreventBelowHpp(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className={`w-10 h-5.5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4.5 after:w-4.5 after:transition-all ${
                          globalPriceGuardEnabled
                            ? 'peer-checked:bg-blue-500 opacity-80 cursor-not-allowed'
                            : 'peer-checked:bg-blue-600'
                        }`}></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: VARIAN SKU & MULTI-HARGA VARIAN                            */}
          {/* ================================================================= */}
          {activeTab === 'variants' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="bg-slate-50/70 border border-slate-200/90 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 pb-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <span>🏷️</span> Variasi Produk (Panas/Es, Ukuran, Paket, atau Warna)
                    </h4>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      Setiap variasi memiliki harga, SKU, HPP, dan kartu stok mandiri.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white px-3 py-1.5 rounded-xl border border-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableMultiPrice}
                        onChange={e => setEnableMultiPrice(e.target.checked)}
                        className="rounded text-emerald-600"
                      />
                      <span>🍽️ Harga Dine-In / Take Away</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowMatrixGen(!showMatrixGen)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1 cursor-pointer ${
                        showMatrixGen
                          ? 'bg-purple-600 text-white'
                          : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200/60'
                      }`}
                    >
                      <span>⚡</span>
                      <span>{showMatrixGen ? 'Tutup Generator' : 'Generator Matriks'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVariantRows(prev => [
                          ...prev,
                          {
                            name: '',
                            sku: sku ? `${sku}-${prev.length + 1}` : '',
                            price: price || 0,
                            dine_in_price: dineInPrice > 0 ? dineInPrice : null,
                            take_away_price: takeAwayPrice > 0 ? takeAwayPrice : null,
                            cost_price: hppType === 'variable' ? calculatedDynamicHpp : (costPrice || 0),
                            stock_quantity: 0
                          }
                        ])
                      }}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1 cursor-pointer"
                    >
                      <span>➕</span>
                      <span>Tambah Varian</span>
                    </button>
                  </div>
                </div>

                {showMatrixGen && (
                  <div className="p-4 sm:p-5 bg-purple-50/60 border border-purple-200/90 rounded-2xl space-y-4 animate-in fade-in duration-150">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-200/60 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-purple-950 uppercase tracking-wide">
                            ⚡ Generator Matriks Variasi (Standar Shopee / WooCommerce)
                          </span>
                          <span className="text-[10px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200">
                            {previewCombinationsCount > 0 ? `${previewCombinationsCount} Kombinasi` : '0 Kombinasi'}
                          </span>
                        </div>
                        <p className="text-[11px] text-purple-800/80 font-medium mt-0.5">
                          Kustomisasi nama grup atribut (misal: Warna, Ukuran, Rasa, Bahan) dan tambahkan opsi tak terbatas.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowMatrixGen(false)}
                        className="text-xs font-bold text-slate-500 hover:text-slate-800 self-end sm:self-auto cursor-pointer"
                      >
                        ✕ Tutup
                      </button>
                    </div>

                    {/* Dynamic Attribute Groups List (Shopee / WooCommerce Multi-tier) */}
                    <div className="space-y-3">
                      {matrixAttributes.map((attr, aIdx) => {
                        const parsedOptions = attr.values.split(',').map(s => s.trim()).filter(Boolean)
                        return (
                          <div key={aIdx} className="bg-white border border-purple-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1">
                                <span className="text-[10px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md uppercase shrink-0">
                                  Tipe #{aIdx + 1}
                                </span>
                                <input
                                  type="text"
                                  placeholder="Nama Tipe Variasi (contoh: Warna, Ukuran, Rasa, Bahan)"
                                  className="p-1.5 px-2.5 border border-slate-200 rounded-lg text-xs font-extrabold text-slate-900 outline-none focus:border-purple-600 w-full sm:max-w-xs bg-slate-50/50 focus:bg-white"
                                  value={attr.name}
                                  onChange={e => {
                                    const val = e.target.value
                                    setMatrixAttributes(prev => {
                                      const copy = [...prev]
                                      copy[aIdx] = { ...copy[aIdx], name: val }
                                      return copy
                                    })
                                  }}
                                />
                              </div>

                              {/* Quick Preset Buttons */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] text-slate-400 font-semibold hidden md:inline">Preset:</span>
                                {['Warna', 'Ukuran', 'Rasa', 'Bahan', 'Level'].map(preset => (
                                  <button
                                    key={preset}
                                    type="button"
                                    onClick={() => {
                                      setMatrixAttributes(prev => {
                                        const copy = [...prev]
                                        copy[aIdx] = { ...copy[aIdx], name: preset }
                                        return copy
                                      })
                                    }}
                                    className={`text-[10px] px-2 py-0.5 rounded-md border transition cursor-pointer ${
                                      attr.name.toLowerCase() === preset.toLowerCase()
                                        ? 'bg-purple-600 text-white border-purple-600 font-bold'
                                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-purple-50'
                                    }`}
                                  >
                                    {preset}
                                  </button>
                                ))}
                                {matrixAttributes.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setMatrixAttributes(prev => prev.filter((_, i) => i !== aIdx))}
                                    className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-md transition font-bold ml-1 cursor-pointer"
                                    title="Hapus tipe variasi ini"
                                  >
                                    🗑️ Hapus
                                  </button>
                                )}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                Pilihan Nilai / Opsi (Pisahkan dengan tanda koma)
                              </label>
                              <input
                                type="text"
                                placeholder={
                                  attr.name.toLowerCase().includes('warna')
                                    ? 'Contoh: Merah, Hitam, Putih, Navy, Hijau'
                                    : attr.name.toLowerCase().includes('ukuran')
                                      ? 'Contoh: S, M, L, XL, XXL'
                                      : 'Contoh: Opsi 1, Opsi 2, Opsi 3'
                                }
                                className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 bg-white outline-none focus:border-purple-600"
                                value={attr.values}
                                onChange={e => {
                                  const val = e.target.value
                                  setMatrixAttributes(prev => {
                                    const copy = [...prev]
                                    copy[aIdx] = { ...copy[aIdx], values: val }
                                    return copy
                                  })
                                }}
                              />
                            </div>

                            {/* Live Parsed Badges */}
                            {parsedOptions.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                                  {parsedOptions.length} opsi:
                                </span>
                                {parsedOptions.map((opt, oIdx) => (
                                  <span key={oIdx} className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60">
                                    {opt}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* Add Attribute Group Button */}
                      {matrixAttributes.length < 5 && (
                        <button
                          type="button"
                          onClick={() => {
                            setMatrixAttributes(prev => [
                              ...prev,
                              {
                                name: prev.length === 1 ? 'Ukuran' : (prev.length === 2 ? 'Bahan' : `Atribut ${prev.length + 1}`),
                                values: ''
                              }
                            ])
                          }}
                          className="text-xs font-bold text-purple-700 hover:text-purple-900 bg-white hover:bg-purple-50 border border-dashed border-purple-300 px-3.5 py-2 rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <span>➕</span>
                          <span>Tambah Tipe Variasi / Atribut Baru (Maks. 5 Tingkat)</span>
                        </button>
                      )}
                    </div>

                    {/* Bulk Setup for New Combinations & Preservation Settings */}
                    <div className="p-3.5 bg-white border border-purple-200/80 rounded-xl space-y-3">
                      <span className="text-xs font-black text-slate-800 uppercase tracking-wide block">
                        Pengaturan Massal untuk Varian Baru:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                            Harga Jual Massal (Rp)
                          </label>
                          <input
                            type="number"
                            min="0"
                            placeholder={String(price || 10000)}
                            className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 bg-white outline-none focus:border-purple-600"
                            value={bulkMatrixPrice === 0 ? '' : bulkMatrixPrice}
                            onChange={e => setBulkMatrixPrice(Number(e.target.value) || 0)}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                            Modal HPP Massal (Rp)
                          </label>
                          <input
                            type="number"
                            min="0"
                            placeholder={String(costPrice || 0)}
                            className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 bg-white outline-none focus:border-purple-600"
                            value={bulkMatrixCostPrice === 0 ? '' : bulkMatrixCostPrice}
                            onChange={e => setBulkMatrixCostPrice(Number(e.target.value) || 0)}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                            Stok Awal Massal
                          </label>
                          <input
                            type="number"
                            min="0"
                            placeholder="10"
                            className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 bg-white outline-none focus:border-purple-600"
                            value={bulkMatrixStock === 0 ? '' : bulkMatrixStock}
                            onChange={e => setBulkMatrixStock(Number(e.target.value) || 0)}
                          />
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={preserveExistingVariants}
                            onChange={e => setPreserveExistingVariants(e.target.checked)}
                            className="rounded text-purple-600 w-4 h-4 cursor-pointer"
                          />
                          <span>Pertahankan ID, Harga, SKU & Stok varian lama yang namanya cocok (Aman)</span>
                        </label>

                        <div className="flex items-center gap-2 justify-end shrink-0">
                          <button
                            type="button"
                            onClick={() => setShowMatrixGen(false)}
                            className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                          >
                            Batal
                          </button>
                          <button
                            type="button"
                            onClick={handleGenerateMatrix}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
                          >
                            <span>⚡ Buat {previewCombinationsCount > 0 ? `${previewCombinationsCount} Kombinasi` : 'Variasi'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {variantRows.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-slate-200 rounded-2xl bg-white">
                    <p className="text-xs font-bold text-slate-600">Produk Tunggal (Belum Ada Varian)</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-md mx-auto">
                      Tambahkan varian jika produk ini memiliki pilihan seperti <strong>Panas / Es</strong>, <strong>Kecil / Besar</strong>, atau <strong>Ukuran S / M / L</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {variantRows.map((v, vIdx) => (
                      <div key={vIdx} className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-3">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                          <span className="text-[11px] font-extrabold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-100">
                            Varian #{vIdx + 1}: {v.name || 'Baru'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setVariantRows(prev => prev.filter((_, i) => i !== vIdx))}
                            className="text-slate-400 hover:text-rose-600 text-xs font-bold px-2 py-0.5 rounded-md hover:bg-rose-50 transition cursor-pointer"
                          >
                            ✕ Hapus
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                          <div className="sm:col-span-3">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Nama Varian *</label>
                            <input
                              type="text"
                              required
                              placeholder="Contoh: Panas / Es"
                              className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-blue-600"
                              value={v.name}
                              onChange={e => {
                                const val = e.target.value
                                setVariantRows(prev => {
                                  const copy = [...prev]
                                  copy[vIdx] = { ...copy[vIdx], name: val }
                                  return copy
                                })
                              }}
                            />
                          </div>

                          <div className="sm:col-span-3">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">SKU / ID Varian</label>
                            <input
                              type="text"
                              placeholder="SKU-VAR"
                              className="w-full p-2 border border-slate-200 rounded-lg text-xs font-mono font-semibold text-slate-800 outline-none focus:border-blue-600"
                              value={v.sku}
                              onChange={e => {
                                const val = e.target.value
                                setVariantRows(prev => {
                                  const copy = [...prev]
                                  copy[vIdx] = { ...copy[vIdx], sku: val }
                                  return copy
                                })
                              }}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[9px] font-bold text-slate-600 uppercase mb-1">Harga Dasar (Rp)</label>
                            <input
                              type="number"
                              min="0"
                              className="w-full p-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 outline-none focus:border-blue-600"
                              value={v.price}
                              onChange={e => {
                                const val = Number(e.target.value) || 0
                                setVariantRows(prev => {
                                  const copy = [...prev]
                                  copy[vIdx] = { ...copy[vIdx], price: val }
                                  return copy
                                })
                              }}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[9px] font-bold text-indigo-700 uppercase mb-1">Modal HPP (Rp)</label>
                            <input
                              type="number"
                              min="0"
                              placeholder={costPrice > 0 ? `${costPrice} (Utama)` : 'Ikut HPP Utama'}
                              className="w-full p-2 border border-indigo-200 bg-indigo-50/40 rounded-lg text-xs font-semibold text-indigo-900 outline-none focus:border-indigo-600"
                              value={v.cost_price === 0 ? '' : v.cost_price}
                              onChange={e => {
                                const val = Number(e.target.value) || 0
                                setVariantRows(prev => {
                                  const copy = [...prev]
                                  copy[vIdx] = { ...copy[vIdx], cost_price: val }
                                  return copy
                                })
                              }}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Stok Varian</label>
                            <input
                              type="number"
                              min="0"
                              className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-blue-600"
                              value={v.stock_quantity}
                              onChange={e => {
                                const val = Number(e.target.value) || 0
                                setVariantRows(prev => {
                                  const copy = [...prev]
                                  copy[vIdx] = { ...copy[vIdx], stock_quantity: val }
                                  return copy
                                })
                              }}
                            />
                          </div>
                        </div>

                        {enableMultiPrice && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 bg-slate-50/60 p-2.5 rounded-xl">
                            <div>
                              <label className="block text-[9px] font-bold text-indigo-700 uppercase mb-1">
                                🍽️ Harga Dine-In Varian (Rp)
                              </label>
                              <input
                                type="number"
                                min="0"
                                placeholder={`Default: Rp ${(v.price || 0).toLocaleString('id-ID')}`}
                                className="w-full p-1.5 border border-indigo-200 rounded-lg text-xs font-bold text-slate-800 bg-white outline-none"
                                value={v.dine_in_price ? v.dine_in_price : ''}
                                onChange={e => {
                                  const val = e.target.value === '' ? null : Number(e.target.value)
                                  setVariantRows(prev => {
                                    const copy = [...prev]
                                    copy[vIdx] = { ...copy[vIdx], dine_in_price: val }
                                    return copy
                                  })
                                }}
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-emerald-700 uppercase mb-1">
                                🛍️ Harga Take Away Varian (Rp)
                              </label>
                              <input
                                type="number"
                                min="0"
                                placeholder={`Default: Rp ${(v.price || 0).toLocaleString('id-ID')}`}
                                className="w-full p-1.5 border border-emerald-200 rounded-lg text-xs font-bold text-slate-800 bg-white outline-none"
                                value={v.take_away_price ? v.take_away_price : ''}
                                onChange={e => {
                                  const val = e.target.value === '' ? null : Number(e.target.value)
                                  setVariantRows(prev => {
                                    const copy = [...prev]
                                    copy[vIdx] = { ...copy[vIdx], take_away_price: val }
                                    return copy
                                  })
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: OPSI TAMBAHAN / MODIFIER & TAMBAHAN HARGA (+RP)            */}
          {/* ================================================================= */}
          {activeTab === 'modifiers' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="bg-white border border-purple-200/80 rounded-2xl p-5 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-100 pb-3">
                  <div>
                    <h4 className="text-sm font-black text-purple-950 flex items-center gap-2">
                      <span>✨</span> Grup Opsi Tambahan (Modifier / Topping / Kustomisasi)
                    </h4>
                    <p className="text-xs text-slate-600 font-medium mt-0.5">
                      Atur pilihan tambahan seperti <strong>Level</strong>, <strong>Topping</strong>, <strong>Ekstra Komponen</strong>, atau <strong>Kustomisasi Layanan</strong> beserta tambahan harga (+Rp) dan modal HPP.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setModifierGroups(prev => [
                        ...prev,
                        {
                          group_name: prev.length === 0 ? 'Pilihan Tambahan' : `Grup Opsi ${prev.length + 1}`,
                          is_required: false,
                          options: [
                            { option_name: 'Opsi 1', price_extra: 0, cost_price: 0 },
                            { option_name: 'Opsi 2', price_extra: 2000, cost_price: 0 }
                          ]
                        }
                      ])
                    }}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-xs shrink-0 cursor-pointer"
                  >
                    ➕ Tambah Grup Opsi
                  </button>
                </div>

                {/* Reusable Master Modifier Templates (1-Click Apply from other products in the same business) */}
                {businessModifierTemplates.length > 0 && (
                  <div className="p-3 bg-white border border-purple-200/80 rounded-xl flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs">
                      <span className="font-extrabold text-purple-950">📋 Gunakan Grup Modifier yang Sudah Ada:</span>
                      <span className="text-slate-500 ml-1 text-[11px]">Klik untuk menempelkan grup beserta opsi & harganya ke produk ini</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {businessModifierTemplates.map((tpl, idx) => {
                        const alreadyAdded = modifierGroups.some(
                          g => g.group_name.trim().toLowerCase() === tpl.group_name.trim().toLowerCase()
                        )
                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => {
                              setModifierGroups(prev => [
                                ...prev,
                                {
                                  group_name: tpl.group_name,
                                  is_required: tpl.is_required,
                                  options: tpl.options.map(o => ({ ...o }))
                                }
                              ])
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                              alreadyAdded
                                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                : 'bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-200'
                            }`}
                          >
                            {alreadyAdded ? `✓ ${tpl.group_name}` : `+ ${tpl.group_name} (${tpl.options.length} opsi)`}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {modifierGroups.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-purple-200 rounded-2xl bg-white">
                    <p className="text-xs font-bold text-slate-600">Belum Ada Grup Modifier pada Produk Ini</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-md mx-auto">
                      Klik <strong>"+ Tambah Grup Modifier"</strong> di atas untuk membuat pilihan seperti Level Pedas (+Rp) atau Extra Topping (+Rp).
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {modifierGroups.map((grp, gIdx) => (
                      <div key={gIdx} className="p-4 bg-white border border-purple-200 rounded-2xl shadow-2xs space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-2.5 flex-1">
                            <span className="text-xs font-black text-purple-700 bg-purple-100 px-2.5 py-1 rounded-lg">
                              Grup #{gIdx + 1}
                            </span>
                            <input
                              type="text"
                              placeholder="Nama Grup (Contoh: Level Pedas, Topping)"
                              className="flex-1 max-w-xs p-2 border border-slate-200 rounded-xl text-xs font-extrabold text-slate-900 outline-none focus:border-purple-600"
                              value={grp.group_name}
                              onChange={e => {
                                const val = e.target.value
                                setModifierGroups(prev => {
                                  const copy = [...prev]
                                  copy[gIdx] = { ...copy[gIdx], group_name: val }
                                  return copy
                                })
                              }}
                            />
                          </div>

                          <div className="flex items-center gap-3">
                            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={grp.is_required}
                                onChange={e => {
                                  const checked = e.target.checked
                                  setModifierGroups(prev => {
                                    const copy = [...prev]
                                    copy[gIdx] = { ...copy[gIdx], is_required: checked }
                                    return copy
                                  })
                                }}
                                className="rounded text-purple-600"
                              />
                              <span>Wajib Dipilih Kasir</span>
                            </label>
                            <button
                              type="button"
                              onClick={() => setModifierGroups(prev => prev.filter((_, i) => i !== gIdx))}
                              className="text-xs font-bold text-rose-600 hover:bg-rose-50 px-2.5 py-1 rounded-lg transition cursor-pointer"
                            >
                              🗑️ Hapus Grup
                            </button>
                          </div>
                        </div>

                        {/* Options Table */}
                        <div className="space-y-2">
                          <div className="grid grid-cols-12 gap-2 text-[10px] font-black text-slate-400 uppercase px-1">
                            <div className="col-span-5">Nama Opsi (Contoh: Level 3 / Extra Keju)</div>
                            <div className="col-span-3">Tambahan Harga (+Rp)</div>
                            <div className="col-span-3">Tambahan Modal HPP (Rp)</div>
                            <div className="col-span-1 text-right">Aksi</div>
                          </div>

                          {grp.options.map((opt, oIdx) => (
                            <div key={oIdx} className="grid grid-cols-12 gap-2 items-center">
                              <div className="col-span-5">
                                <input
                                  type="text"
                                  placeholder="Nama opsi..."
                                  className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-purple-600"
                                  value={opt.option_name}
                                  onChange={e => {
                                    const val = e.target.value
                                    setModifierGroups(prev => {
                                      const copy = [...prev]
                                      const opts = [...copy[gIdx].options]
                                      opts[oIdx] = { ...opts[oIdx], option_name: val }
                                      copy[gIdx] = { ...copy[gIdx], options: opts }
                                      return copy
                                    })
                                  }}
                                />
                              </div>
                              <div className="col-span-3">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0 (Gratis)"
                                  className="w-full p-2 border border-purple-200 bg-purple-50/30 rounded-lg text-xs font-bold text-purple-900 outline-none focus:border-purple-600"
                                  value={opt.price_extra === 0 ? '' : opt.price_extra}
                                  onChange={e => {
                                    const val = e.target.value === '' ? 0 : Number(e.target.value)
                                    setModifierGroups(prev => {
                                      const copy = [...prev]
                                      const opts = [...copy[gIdx].options]
                                      opts[oIdx] = { ...opts[oIdx], price_extra: val }
                                      copy[gIdx] = { ...copy[gIdx], options: opts }
                                      return copy
                                    })
                                  }}
                                />
                              </div>
                              <div className="col-span-3">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  className="w-full p-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none focus:border-purple-600"
                                  value={opt.cost_price === 0 ? '' : opt.cost_price}
                                  onChange={e => {
                                    const val = e.target.value === '' ? 0 : Number(e.target.value)
                                    setModifierGroups(prev => {
                                      const copy = [...prev]
                                      const opts = [...copy[gIdx].options]
                                      opts[oIdx] = { ...opts[oIdx], cost_price: val }
                                      copy[gIdx] = { ...copy[gIdx], options: opts }
                                      return copy
                                    })
                                  }}
                                />
                              </div>
                              <div className="col-span-1 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModifierGroups(prev => {
                                      const copy = [...prev]
                                      copy[gIdx] = {
                                        ...copy[gIdx],
                                        options: copy[gIdx].options.filter((_, i) => i !== oIdx)
                                      }
                                      return copy
                                    })
                                  }}
                                  className="text-slate-400 hover:text-rose-600 font-bold text-xs p-1 cursor-pointer"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={() => {
                              setModifierGroups(prev => {
                                const copy = [...prev]
                                copy[gIdx] = {
                                  ...copy[gIdx],
                                  options: [
                                    ...copy[gIdx].options,
                                    { option_name: '', price_extra: 0, cost_price: 0 }
                                  ]
                                }
                                return copy
                              })
                            }}
                            className="text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>+ Tambah Opsi Pilihan</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: RESEP & BOM HPP                                            */}
          {/* ================================================================= */}
          {activeTab === 'recipe' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-indigo-50/60 border border-indigo-200 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-200/60 pb-3">
                  <div>
                    <h4 className="text-sm font-black text-indigo-950 flex items-center gap-2">
                      <span>🧪</span> Formulasi Resep & Komponen Penyusun (Bill of Materials)
                    </h4>
                    <p className="text-xs text-indigo-800/80 font-medium mt-0.5">
                      Hitung HPP otomatis berdasarkan takaran bahan baku atau paket menu (Bundle).
                    </p>
                  </div>
                  <div className="px-4 py-2 rounded-xl bg-white border border-indigo-200 text-right shrink-0">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase block">Total HPP Resep</span>
                    <span className="text-sm font-black text-indigo-950">
                      Rp {calculatedDynamicHpp.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>

                {/* Add Ingredient Bar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 max-w-full relative z-20">
                  <IngredientSearchCombobox
                    options={availableIngredientsOptions}
                    selectedId={selectedIngredientId}
                    onSelect={productId => setSelectedIngredientId(productId)}
                    placeholder="Cari komponen, bahan baku, atau SKU..."
                  />

                  <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-start">
                    <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 pr-2.5 shadow-2xs">
                      <input
                        type="number"
                        step="any"
                        min="0.0001"
                        className="w-20 p-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-indigo-600 bg-white text-center"
                        placeholder="Jumlah"
                        value={ingredientQtyInput}
                        onChange={e => setIngredientQtyInput(e.target.value)}
                      />
                      <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100 uppercase select-none">
                        {selectedIngredientUnit}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddIngredient}
                      className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 flex items-center gap-1 cursor-pointer"
                    >
                      <span>+</span>
                      <span>Tambah Bahan</span>
                    </button>
                  </div>
                </div>

                {recipeRows.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-indigo-200 rounded-2xl bg-white">
                    <p className="text-xs font-bold text-slate-500">Belum Ada Bahan Baku / Komponen Paket</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Cari dan tambahkan komponen di atas untuk menghitung HPP otomatis.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recipeRows.map((r) => {
                      const rowCost = r.quantity * r.cost_price
                      return (
                        <div
                          key={r.ingredient_product_id}
                          className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl shadow-2xs"
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            <p className="text-xs font-bold text-slate-800 break-words leading-snug">
                              {r.ingredient_name}
                            </p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                                Modal: Rp {(r.cost_price || 0).toLocaleString('id-ID')} / {r.unit}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                step="any"
                                min="0.0001"
                                className="w-20 p-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-center text-slate-800 outline-none focus:border-indigo-500 bg-white"
                                value={r.quantity}
                                onChange={e => handleUpdateIngredientQty(r.ingredient_product_id, e.target.value)}
                              />
                              <span className="text-[11px] font-bold text-slate-600 min-w-[32px]">{r.unit}</span>
                            </div>

                            <div className="text-right min-w-[95px]">
                              <p className="text-[9px] text-slate-400 font-bold uppercase">Subtotal HPP</p>
                              <p className="text-xs font-black text-indigo-900">
                                Rp {rowCost.toLocaleString('id-ID')}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveIngredient(r.ingredient_product_id)}
                              className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-bold cursor-pointer"
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
        </form>

        {/* Sticky Workstation Footer (Centered max-w-4xl to align with form canvas) */}
        <div className="px-4 sm:px-6 md:px-8 py-3.5 bg-white border-t border-slate-200 shrink-0">
          <div className="max-w-4xl mx-auto flex gap-3 justify-between items-center">
            <div className="text-[11px] text-slate-500 hidden sm:flex items-center gap-3">
              {variantRows.length > 0 && <span>🏷️ <strong>{variantRows.length}</strong> Varian</span>}
              {modifierGroups.length > 0 && <span>✨ <strong>{modifierGroups.length}</strong> Grup Opsi</span>}
              {enableMultiPrice && <span>🍽️ Multi-Harga Aktif</span>}
              {hppType === 'variable' && <span>🧪 Resep BOM ({recipeRows.length} komponen)</span>}
            </div>
            <div className="flex gap-3 ml-auto w-full sm:w-auto justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="px-5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-all cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-400 transition-all flex items-center gap-2 cursor-pointer"
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
        </div>
      </div>
    </div>,
    document.body
  )
}
