"use client"

import { useState, useMemo, useEffect, useRef } from 'react'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'
import { supabase } from '@/lib/supabase'
import { PosSalesType, resolvePosItemPrice } from '@/lib/posCatalogStore'

export interface DimensionSpec {
  length: number
  width: number
  input_unit: 'cm' | 'm'
  calc_area: number
  billable_area: number
  area_unit: 'm2' | 'cm2'
  rate_per_unit: number
  cost_price_per_unit: number
  min_area: number
}

export type VariantOption = {
  id: string
  name: string
  price: number
  price_tiers?: any
  costPrice?: number
  cost_price?: number
  stockQuantity?: number
}

interface ModifierOption {
  id: string
  name: string
  priceExtra: number
  costPrice?: number
}

interface ModifierGroup {
  id: string
  name: string
  required?: boolean
  type: 'radio' | 'checkbox'
  options: ModifierOption[]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  product: any | null
  salesType?: PosSalesType
  initialValues?: {
    length?: number
    width?: number
    input_unit?: 'cm' | 'm'
    quantity?: number
    note?: string
    selectedVariant?: VariantOption | null
    selectedModifiers?: any[]
  } | null
  onAddToCart: (itemData: {
    product: any
    selectedVariant?: VariantOption
    quantity: number
    finalPrice: number
    note: string
    dimension_spec: DimensionSpec
    selectedModifiers?: { group: string; name: string; priceExtra: number; costPrice?: number }[]
  }) => void
}

export default function PrintingDimensionModal({
  isOpen,
  onClose,
  product,
  salesType = 'basic',
  initialValues,
  onAddToCart,
}: Props) {
  useModalBackHandler(isOpen, onClose)

  const lengthInputRef = useRef<HTMLInputElement>(null)

  // Target area unit from product: 'm2' (default) or 'cm2'
  const areaUnit: 'm2' | 'cm2' = useMemo(() => {
    const raw = String(product?.unit || '').toLowerCase()
    return raw.includes('cm') ? 'cm2' : 'm2'
  }, [product?.unit])

  // Form State
  const [inputUnit, setInputUnit] = useState<'cm' | 'm'>('cm')
  const [length, setLength] = useState<string>('0')
  const [width, setWidth] = useState<string>('0')
  const [quantityInput, setQuantityInput] = useState<string>('1')
  const [note, setNote] = useState<string>('')
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({})
  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(null)

  // Fallback state if variants or modifiers need on-the-fly fetch (Self-Healing resilience)
  const [fetchedVariants, setFetchedVariants] = useState<VariantOption[]>([])
  const [fetchedModifiers, setFetchedModifiers] = useState<any[]>([])
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)

  // Fetch variants & modifiers from DB if not preloaded
  useEffect(() => {
    if (!isOpen || !product?.id) {
      setFetchedVariants([])
      setFetchedModifiers([])
      setIsLoadingDetails(false)
      return
    }

    const rawVars = (product as any).product_variants || product.variants
    const hasPreloadedVars = Array.isArray(rawVars) && rawVars.length > 0
    const rawMods = (product as any).product_modifiers || product.modifiers
    const hasPreloadedMods = Array.isArray(rawMods) && rawMods.length > 0

    if (!hasPreloadedVars || !hasPreloadedMods) {
      let active = true
      setIsLoadingDetails(true)

      Promise.all([
        !hasPreloadedVars
          ? supabase
              .from('product_variants')
              .select('*')
              .eq('product_id', product.id)
              .order('created_at', { ascending: true })
          : Promise.resolve({ data: null, error: null }),
        !hasPreloadedMods
          ? supabase
              .from('product_modifiers')
              .select('*')
              .eq('product_id', product.id)
              .order('created_at', { ascending: true })
          : Promise.resolve({ data: null, error: null })
      ]).then(([varRes, modRes]) => {
        if (!active) return
        setIsLoadingDetails(false)
        if (!varRes.error && varRes.data && varRes.data.length > 0) {
          const parentFallbackPrice = resolvePosItemPrice(product, salesType, Number(product.price || 0))
          setFetchedVariants(
            varRes.data.map((v: any) => ({
              id: v.id,
              name: v.name || '',
              price: resolvePosItemPrice(v, salesType, parentFallbackPrice),
              price_tiers: v.price_tiers || null,
              costPrice: Number(v.cost_price ?? v.costPrice ?? 0),
              cost_price: Number(v.cost_price ?? v.costPrice ?? 0),
              stockQuantity: Number(v.stock_quantity ?? 0)
            }))
          )
        }
        if (!modRes.error && modRes.data && modRes.data.length > 0) {
          setFetchedModifiers(modRes.data)
        }
      })

      return () => {
        active = false
      }
    } else {
      setFetchedVariants([])
      setFetchedModifiers([])
      setIsLoadingDetails(false)
    }
  }, [isOpen, product, salesType])

  // Resolve variants with Sales Type awareness
  const variants: VariantOption[] = useMemo(() => {
    if (!product) return []
    const parentFallbackPrice = resolvePosItemPrice(product, salesType, Number(product.price || 0))
    const raw = (product as any).product_variants || product.variants
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((v: any) => ({
        id: v?.id || '',
        name: v?.name || '',
        price: resolvePosItemPrice(v, salesType, parentFallbackPrice),
        price_tiers: v?.price_tiers || null,
        costPrice: Number(v?.cost_price ?? v?.costPrice ?? 0),
        cost_price: Number(v?.cost_price ?? v?.costPrice ?? 0),
        stockQuantity: Number(v?.stock_quantity ?? 0)
      }))
    }
    if (fetchedVariants.length > 0) {
      return fetchedVariants
    }
    return []
  }, [product, fetchedVariants, salesType])

  // Parse & normalize modifier groups from database flat rows or object models
  const modifierGroups: ModifierGroup[] = useMemo(() => {
    if (!product) return []
    const raw =
      (Array.isArray((product as any).product_modifiers) && (product as any).product_modifiers.length > 0
        ? (product as any).product_modifiers
        : null) ||
      (Array.isArray(product.modifiers) && product.modifiers.length > 0 ? product.modifiers : null) ||
      fetchedModifiers

    if (!Array.isArray(raw) || raw.length === 0) return []

    // Case 1: Database flat rows format (from product_modifiers table or posCatalogStore)
    if (raw[0]?.group_name || raw[0]?.option_name) {
      const map: Record<string, ModifierGroup> = {}
      for (const m of raw) {
        if (!m) continue
        const gName = (m.group_name || 'Finishing / Add-on').trim()
        const groupId = `g-${gName}`
        if (!map[groupId]) {
          map[groupId] = {
            id: groupId,
            name: gName,
            required: Boolean(m.is_required),
            type: m.is_required ? 'radio' : 'checkbox',
            options: []
          }
        }
        map[groupId].options.push({
          id: m.id || `${gName}-${m.option_name}`,
          name: m.option_name || '',
          priceExtra: Number(m.price_extra ?? m.price ?? 0),
          costPrice: Number(m.cost_price || 0)
        })
      }
      return Object.values(map)
    }

    // Case 2: Pre-grouped options format (fallback)
    return raw.map((m: any) => ({
      id: m.id || m.group_name || m.name,
      name: m.group_name || m.name || 'Finishing / Add-on',
      required: Boolean(m.is_required),
      type: m.type === 'multiple' ? 'checkbox' : (m.is_required ? 'radio' : 'checkbox'),
      options: (m.options || []).map((opt: any) => ({
        id: opt.id || opt.name,
        name: opt.name || opt.option_name,
        priceExtra: Number(opt.priceExtra ?? opt.price_extra ?? opt.price ?? 0),
        costPrice: Number(opt.costPrice ?? opt.cost_price ?? 0)
      }))
    }))
  }, [product, fetchedModifiers])

  const quantity = useMemo(() => {
    const val = parseInt(quantityInput, 10)
    return isNaN(val) || val < 1 ? 1 : val
  }, [quantityInput])

  // Initialize form when opened or product changes
  useEffect(() => {
    if (isOpen && product) {
      if (initialValues) {
        setLength(String(initialValues.length ?? 0))
        setWidth(String(initialValues.width ?? 0))
        setInputUnit(initialValues.input_unit || 'cm')
        setQuantityInput(String(initialValues.quantity && initialValues.quantity > 0 ? initialValues.quantity : 1))
        setNote(initialValues.note || '')

        // Restore selected variant if editing
        if (initialValues.selectedVariant) {
          const matched = variants.find(v => v.id === initialValues.selectedVariant?.id)
          setSelectedVariant(matched || initialValues.selectedVariant)
        } else if (variants.length > 0) {
          setSelectedVariant(variants[0])
        } else {
          setSelectedVariant(null)
        }

        // Restore selected modifiers if editing
        if (Array.isArray(initialValues.selectedModifiers) && initialValues.selectedModifiers.length > 0) {
          const restored: Record<string, string[]> = {}
          for (const m of initialValues.selectedModifiers) {
            const grp = modifierGroups.find(g => g.name.toLowerCase() === (m.group || '').toLowerCase())
            if (grp) {
              const opt = grp.options.find(o => o.name.toLowerCase() === (m.name || '').toLowerCase())
              if (opt) {
                if (!restored[grp.id]) restored[grp.id] = []
                restored[grp.id].push(opt.id)
              }
            }
          }
          setSelectedModifiers(restored)
        } else {
          setSelectedModifiers({})
        }
      } else {
        // Defaults: 0 x 0
        setInputUnit('cm')
        setLength('0')
        setWidth('0')
        setQuantityInput('1')
        setNote('')
        setSelectedVariant(variants.length > 0 ? variants[0] : null)

        // Set default required modifiers
        const initialMods: Record<string, string[]> = {}
        for (const g of modifierGroups) {
          if (g.required && g.options.length > 0) {
            initialMods[g.id] = [g.options[0].id]
          }
        }
        setSelectedModifiers(initialMods)
      }

      // Auto-focus length input after mount
      setTimeout(() => {
        lengthInputRef.current?.focus()
        lengthInputRef.current?.select()
      }, 100)
    }
  }, [isOpen, product, initialValues, variants, modifierGroups])

  // Numerical inputs
  const numLength = Math.max(0, parseFloat(length) || 0)
  const numWidth = Math.max(0, parseFloat(width) || 0)

  // Calculate area in product's area unit
  const calcArea = useMemo(() => {
    if (numLength <= 0 || numWidth <= 0) return 0

    if (areaUnit === 'm2') {
      if (inputUnit === 'cm') {
        // (cm x cm) / 10,000 = m2
        return parseFloat(((numLength * numWidth) / 10000).toFixed(4))
      } else {
        // m x m = m2
        return parseFloat((numLength * numWidth).toFixed(4))
      }
    } else {
      // cm2
      if (inputUnit === 'cm') {
        // cm x cm = cm2
        return parseFloat((numLength * numWidth).toFixed(2))
      } else {
        // (m x m) * 10,000 = cm2
        return parseFloat(((numLength * numWidth) * 10000).toFixed(2))
      }
    }
  }, [numLength, numWidth, inputUnit, areaUnit])

  // Minimum area floor
  const minArea = Number(product?.min_area || 0)
  const billableArea = useMemo(() => {
    if (calcArea <= 0) return 0
    if (minArea > 0 && calcArea < minArea) {
      return minArea
    }
    return calcArea
  }, [calcArea, minArea])

  const isMinAreaApplied = minArea > 0 && calcArea > 0 && calcArea < minArea

  // Rates & Totals (Variant-Aware)
  const ratePerUnit = useMemo(() => {
    if (selectedVariant) {
      return Number(selectedVariant.price || 0)
    }
    return resolvePosItemPrice(product, salesType, Number(product?.price || 0))
  }, [selectedVariant, product, salesType])

  const costPricePerUnit = useMemo(() => {
    if (selectedVariant) {
      const vCost = Number(selectedVariant.cost_price ?? selectedVariant.costPrice ?? 0)
      if (vCost > 0) return vCost
    }
    return Number(product?.cost_price ?? 0)
  }, [selectedVariant, product])

  // Calculate modifiers extra cost
  const modifiersCost = useMemo(() => {
    let sum = 0
    modifierGroups.forEach((group) => {
      const selected = selectedModifiers[group.id] || []
      group.options.forEach((opt) => {
        if (selected.includes(opt.id)) {
          sum += opt.priceExtra
        }
      })
    })
    return sum
  }, [modifierGroups, selectedModifiers])

  const modifiersCostPrice = useMemo(() => {
    let sum = 0
    modifierGroups.forEach((group) => {
      const selected = selectedModifiers[group.id] || []
      group.options.forEach((opt) => {
        if (selected.includes(opt.id)) {
          sum += Number(opt.costPrice || 0)
        }
      })
    })
    return sum
  }, [modifierGroups, selectedModifiers])

  // Piece price (1 sheet)
  const pieceBasePrice = Math.round(billableArea * ratePerUnit)
  const finalPiecePrice = pieceBasePrice + modifiersCost
  const grandTotal = finalPiecePrice * quantity

  // Preset buttons
  const applyPreset = (presetL: number, presetW: number) => {
    if (inputUnit === 'm') {
      setLength(String(presetL / 100))
      setWidth(String(presetW / 100))
    } else {
      setLength(String(presetL))
      setWidth(String(presetW))
    }
  }

  const handleModifierToggle = (groupId: string, optionId: string, isMultiple = false, isRequired = false) => {
    setSelectedModifiers((prev) => {
      const curr = prev[groupId] || []
      if (isMultiple) {
        if (curr.includes(optionId)) {
          return { ...prev, [groupId]: curr.filter((id) => id !== optionId) }
        } else {
          return { ...prev, [groupId]: [...curr, optionId] }
        }
      } else {
        // Single select (radio)
        if (curr.includes(optionId)) {
          if (!isRequired) {
            return { ...prev, [groupId]: [] }
          }
          return prev
        } else {
          return { ...prev, [groupId]: [optionId] }
        }
      }
    })
  }

  const handleConfirm = () => {
    if (!product || numLength <= 0 || numWidth <= 0) return

    // Display Dimension string, e.g. "200 × 100 cm"
    const lengthInCm = inputUnit === 'cm' ? numLength : numLength * 100
    const widthInCm = inputUnit === 'cm' ? numWidth : numWidth * 100
    const dimDisplay = `${lengthInCm} × ${widthInCm} cm`

    // Extract selected modifier objects with standard POS attributes (group, name, priceExtra, costPrice)
    const flattenedModifiers: { group: string; name: string; priceExtra: number; costPrice?: number }[] = []
    modifierGroups.forEach((group) => {
      const selected = selectedModifiers[group.id] || []
      group.options.forEach((opt) => {
        if (selected.includes(opt.id)) {
          flattenedModifiers.push({
            group: group.name,
            name: opt.name,
            priceExtra: opt.priceExtra,
            costPrice: opt.costPrice || 0
          })
        }
      })
    })

    const dimSpec: DimensionSpec = {
      length: numLength,
      width: numWidth,
      input_unit: inputUnit,
      calc_area: calcArea,
      billable_area: billableArea,
      area_unit: areaUnit,
      rate_per_unit: ratePerUnit,
      cost_price_per_unit: costPricePerUnit,
      min_area: minArea
    }

    // Compose formatted product display name: e.g. "Spanduk Flexi - 340g (200 × 100 cm)"
    const rawName = product.baseName || product.name
    const variantName = selectedVariant?.name
    const baseNameWithVariant = (variantName && !rawName.toLowerCase().includes(variantName.toLowerCase()))
      ? `${rawName} - ${variantName}`
      : rawName
    const displayName = `${baseNameWithVariant} (${dimDisplay})`

    const resolvedVariant = selectedVariant ? {
      ...selectedVariant,
      cost_price: costPricePerUnit,
      costPrice: costPricePerUnit
    } : undefined

    onAddToCart({
      product: {
        ...product,
        name: displayName,
        baseName: rawName,
        price: finalPiecePrice,
        cost_price: Math.round(billableArea * costPricePerUnit) + modifiersCostPrice
      },
      selectedVariant: resolvedVariant,
      quantity,
      finalPrice: finalPiecePrice,
      note: note.trim(),
      dimension_spec: dimSpec,
      selectedModifiers: flattenedModifiers
    })

    onClose()
  }

  if (!isOpen || !product) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50/70 via-white to-slate-50/70 shrink-0">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200">
                📐 Layanan Percetakan
              </span>
              <span className="text-xs font-bold text-slate-500">
                Rp {ratePerUnit.toLocaleString('id-ID')} / {areaUnit === 'm2' ? 'm²' : 'cm²'}
              </span>
            </div>
            <h3 className="font-black text-slate-900 text-base mt-1 truncate">
              {product.baseName || product.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center text-sm font-bold transition shrink-0 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Loading indicator if fetching on-the-fly */}
          {isLoadingDetails && (
            <div className="py-2 px-3 bg-indigo-50/60 border border-indigo-100 rounded-xl flex items-center justify-center gap-2 text-indigo-700 text-xs font-bold">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span>Memuat variasi dan opsi kustomisasi...</span>
            </div>
          )}

          {/* Varian Selection (If Product has Variants e.g. Flexi 280g vs 340g, Tebal 5mm vs 8mm) */}
          {!isLoadingDetails && variants.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🏷️ Pilihan Bahan / Variasi SKU</span>
                  <span className="text-rose-500">*</span>
                </label>
                {selectedVariant && (
                  <span className="text-xs font-black text-indigo-700">
                    Rp {Number(selectedVariant.price || 0).toLocaleString('id-ID')} / {areaUnit === 'm2' ? 'm²' : 'cm²'}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {variants.map((v) => {
                  const isSelected = selectedVariant?.id === v.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVariant(v)}
                      className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs ring-1 ring-indigo-600'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className="text-xs font-black leading-snug line-clamp-2">{v.name}</span>
                      <div className="mt-1 flex items-center justify-between gap-1 flex-wrap">
                        <span className={`text-[11px] font-black ${isSelected ? 'text-indigo-100' : 'text-indigo-600'}`}>
                          Rp {Number(v.price || 0).toLocaleString('id-ID')}
                        </span>
                        {v.stockQuantity !== undefined && v.stockQuantity > 0 && (
                          <span className={`text-[9px] font-bold px-1 rounded ${
                            isSelected ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-100 text-slate-500'
                          }`}>
                            Stok: {v.stockQuantity}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Unit Toggle & Input Row */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <span>📏 Dimensi Fisik Cetakan</span>
              </label>
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setInputUnit('cm')}
                  className={`px-2.5 py-1 rounded-md font-bold transition ${
                    inputUnit === 'cm'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Centimeter (cm)
                </button>
                <button
                  type="button"
                  onClick={() => setInputUnit('m')}
                  className={`px-2.5 py-1 rounded-md font-bold transition ${
                    inputUnit === 'm'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Meter (m)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Panjang ({inputUnit}) *
                </label>
                <div className="relative flex items-center">
                  <input
                    ref={lengthInputRef}
                    type="number"
                    step={inputUnit === 'm' ? '0.01' : '1'}
                    min="0"
                    value={length}
                    onChange={(e) => setLength(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="0"
                    className="w-full p-2.5 pr-10 border border-slate-300 rounded-xl text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                  />
                  <span className="absolute right-3 text-xs font-bold text-slate-400 select-none">
                    {inputUnit}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Lebar ({inputUnit}) *
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step={inputUnit === 'm' ? '0.01' : '1'}
                    min="0"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="0"
                    className="w-full p-2.5 pr-10 border border-slate-300 rounded-xl text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                  />
                  <span className="absolute right-3 text-xs font-bold text-slate-400 select-none">
                    {inputUnit}
                  </span>
                </div>
              </div>
            </div>

            {/* Popular Presets */}
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                Pintasan:
              </span>
              {[
                { label: '100×100', l: 100, w: 100 },
                { label: '200×100', l: 200, w: 100 },
                { label: '300×100', l: 300, w: 100 },
                { label: '160×60 (X-Banner)', l: 160, w: 60 },
                { label: '200×80 (Y-Banner)', l: 200, w: 80 }
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset.l, preset.w)}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-slate-600 hover:text-indigo-700 rounded-md text-[11px] font-semibold transition cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Area & Price Realtime Calculator Card */}
          <div className="p-3.5 bg-indigo-50/80 border border-indigo-200/80 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-indigo-900">Luas Terhitung:</span>
              <div className="text-right">
                <span className="font-black text-indigo-950 text-sm">
                  {calcArea} {areaUnit === 'm2' ? 'm²' : 'cm²'}
                </span>
                {inputUnit === 'cm' && areaUnit === 'm2' && (
                  <span className="text-[10px] text-slate-500 ml-1.5">
                    ({(numLength * numWidth).toLocaleString('id-ID')} cm²)
                  </span>
                )}
              </div>
            </div>

            {isMinAreaApplied && (
              <div className="p-2 bg-amber-100/90 border border-amber-300 rounded-lg text-[11px] text-amber-900 font-semibold flex items-center gap-1.5">
                <span>⚠️</span>
                <span>
                  Luas di bawah batas minimum (<strong>{minArea} {areaUnit === 'm2' ? 'm²' : 'cm²'}</strong>). Penagihan dibulatkan ke luas minimum.
                </span>
              </div>
            )}

            <div className="flex justify-between items-center text-xs border-t border-indigo-200/60 pt-2">
              <span className="font-semibold text-indigo-900">Harga per Lembar:</span>
              <div className="text-right">
                <span className="font-black text-indigo-950 text-base">
                  Rp {finalPiecePrice.toLocaleString('id-ID')}
                </span>
                <span className="text-[10px] text-slate-500 block">
                  {billableArea} {areaUnit === 'm2' ? 'm²' : 'cm²'} × Rp {ratePerUnit.toLocaleString('id-ID')}
                  {modifiersCost > 0 && ` + Finishing Rp ${modifiersCost.toLocaleString('id-ID')}`}
                </span>
              </div>
            </div>
          </div>

          {/* Modifiers / Finishing (If any) */}
          {modifierGroups.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                🛠️ Opsi Finishing / Tambahan
              </label>
              {modifierGroups.map((group) => (
                <div key={group.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700">{group.name}</span>
                    {group.required ? (
                      <span className="text-[9px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.2 rounded font-bold">Wajib</span>
                    ) : (
                      <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.2 rounded font-semibold">Opsional</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.options.map((opt) => {
                      const isSelected = (selectedModifiers[group.id] || []).includes(opt.id)
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleModifierToggle(group.id, opt.id, group.type === 'checkbox', Boolean(group.required))}
                          className={`p-2.5 rounded-xl border text-left text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-600/30'
                              : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span className="truncate">{opt.name}</span>
                          <span className="text-[10px] text-slate-500 font-semibold shrink-0 ml-1">
                            {opt.priceExtra > 0 ? `+Rp ${opt.priceExtra.toLocaleString('id-ID')}` : 'Gratis'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quantity & Notes Section */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
              {/* Quantity Stepper */}
              <div>
                <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Jumlah Lembar *</span>
                  <span className="text-[10px] text-indigo-600 font-bold">Qty Cetakan</span>
                </label>
                <div className="flex items-center bg-slate-50 border border-slate-300 rounded-xl p-1 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setQuantityInput((prev) => String(Math.max(1, (parseInt(prev, 10) || 1) - 1)))}
                    disabled={quantity <= 1}
                    className="w-10 h-10 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center justify-center font-black text-lg transition shadow-2xs shrink-0 cursor-pointer active:scale-95 select-none"
                    title="Kurangi 1 lembar"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(e.target.value)}
                    onBlur={() => setQuantityInput(String(quantity))}
                    className="flex-1 min-w-0 text-center font-black text-slate-900 text-base bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantityInput((prev) => String((parseInt(prev, 10) || 0) + 1))}
                    className="w-10 h-10 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center font-black text-lg transition shadow-2xs shrink-0 cursor-pointer active:scale-95 select-none"
                    title="Tambah 1 lembar"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Quick Qty Presets (1, 2, 3, 5, 10, 20) */}
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Pintasan Jumlah:
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 2, 3, 5, 10, 20].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuantityInput(String(q))}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                        quantity === q
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-2xs ring-1 ring-indigo-500/20'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Note / File Name */}
            <div>
              <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                Nama File Desain / Catatan Kerja
              </label>
              <input
                type="text"
                placeholder="Contoh: banner_kelurahan_final.pdf, ring 4 pojok..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white placeholder:text-slate-400 shadow-2xs"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              Total ({quantity} Lembar)
            </div>
            <div className="text-xl font-black text-slate-900">
              Rp {grandTotal.toLocaleString('id-ID')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 border border-slate-200 hover:bg-white text-slate-600 font-bold rounded-xl text-xs transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={numLength <= 0 || numWidth <= 0}
              className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer flex items-center gap-1.5"
            >
              <span>+ Tambah ke Pesanan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

