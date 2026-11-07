"use client"

import { useState, useMemo, useEffect, useRef } from 'react'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

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

interface ModifierOption {
  id: string
  name: string
  price: number
}

interface ModifierGroup {
  id: string
  name: string
  type?: 'radio' | 'checkbox'
  options: ModifierOption[]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  product: any | null
  initialValues?: {
    length?: number
    width?: number
    input_unit?: 'cm' | 'm'
    quantity?: number
    note?: string
    selectedModifiers?: any[]
  } | null
  onAddToCart: (itemData: {
    product: any
    quantity: number
    finalPrice: number
    note: string
    dimension_spec: DimensionSpec
    selectedModifiers?: any[]
  }) => void
}

export default function PrintingDimensionModal({
  isOpen,
  onClose,
  product,
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
  const [length, setLength] = useState<string>('200')
  const [width, setWidth] = useState<string>('100')
  const [quantity, setQuantity] = useState<number>(1)
  const [note, setNote] = useState<string>('')
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({})

  // Initialize form when opened or product changes
  useEffect(() => {
    if (isOpen && product) {
      if (initialValues) {
        setLength(String(initialValues.length ?? (initialValues.input_unit === 'm' ? '2' : '200')))
        setWidth(String(initialValues.width ?? (initialValues.input_unit === 'm' ? '1' : '100')))
        setInputUnit(initialValues.input_unit || 'cm')
        setQuantity(initialValues.quantity && initialValues.quantity > 0 ? initialValues.quantity : 1)
        setNote(initialValues.note || '')
      } else {
        // Defaults: 200 x 100 cm (or 2 x 1 m)
        setInputUnit('cm')
        setLength('200')
        setWidth('100')
        setQuantity(1)
        setNote('')
        setSelectedModifiers({})
      }

      // Auto-focus length input after mount
      setTimeout(() => {
        lengthInputRef.current?.focus()
        lengthInputRef.current?.select()
      }, 100)
    }
  }, [isOpen, product, initialValues])

  // Parse modifier groups from product
  const modifierGroups: ModifierGroup[] = useMemo(() => {
    if (!product?.product_modifiers || !Array.isArray(product.product_modifiers)) return []
    return product.product_modifiers.map((m: any) => ({
      id: m.id || m.group_name || m.name,
      name: m.group_name || m.name || 'Finishing / Add-on',
      type: m.type === 'multiple' ? 'checkbox' : 'radio',
      options: (m.options || []).map((opt: any) => ({
        id: opt.id || opt.name,
        name: opt.name,
        price: Number(opt.price || 0)
      }))
    }))
  }, [product?.product_modifiers])

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

  // Calculate modifiers extra cost
  const modifiersCost = useMemo(() => {
    let sum = 0
    modifierGroups.forEach((group) => {
      const selected = selectedModifiers[group.id] || []
      group.options.forEach((opt) => {
        if (selected.includes(opt.id)) {
          sum += opt.price
        }
      })
    })
    return sum
  }, [modifierGroups, selectedModifiers])

  // Rates & Totals
  const ratePerUnit = Number(product?.price || 0)
  const costPricePerUnit = Number(product?.cost_price || 0)

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

  const handleModifierToggle = (groupId: string, optionId: string, isMultiple = false) => {
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
          return { ...prev, [groupId]: [] }
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

    // Extract selected modifier objects
    const flattenedModifiers: any[] = []
    modifierGroups.forEach((group) => {
      const selected = selectedModifiers[group.id] || []
      group.options.forEach((opt) => {
        if (selected.includes(opt.id)) {
          flattenedModifiers.push({
            group: group.name,
            name: opt.name,
            price: opt.price
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

    // Compose formatted product display name
    const rawName = product.name
    const displayName = `${rawName} (${dimDisplay})`

    onAddToCart({
      product: {
        ...product,
        name: displayName,
        baseName: rawName,
        price: finalPiecePrice,
        cost_price: Math.round(billableArea * costPricePerUnit)
      },
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
              {product.name}
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
                    placeholder="200"
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
                    placeholder="100"
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
            <div className="space-y-3 pt-1 border-t border-slate-100">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                🛠️ Opsi Finishing / Tambahan
              </label>
              {modifierGroups.map((group) => (
                <div key={group.id} className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600">{group.name}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {group.options.map((opt) => {
                      const isSelected = (selectedModifiers[group.id] || []).includes(opt.id)
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleModifierToggle(group.id, opt.id, group.type === 'checkbox')}
                          className={`p-2.5 rounded-xl border text-left text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-600/30'
                              : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span className="truncate">{opt.name}</span>
                          <span className="text-[10px] text-slate-500 font-semibold shrink-0 ml-1">
                            {opt.price > 0 ? `+Rp ${opt.price.toLocaleString('id-ID')}` : 'Gratis'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quantity & Notes Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-slate-100">
            {/* Quantity */}
            <div className="sm:col-span-1">
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                Jumlah Lembar *
              </label>
              <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="w-9 h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-base flex items-center justify-center transition select-none cursor-pointer"
                >
                  -
                </button>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 text-center font-black text-slate-900 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="w-9 h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-base flex items-center justify-center transition select-none cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            {/* Note / File Name */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                Nama File Desain / Catatan Kerja
              </label>
              <input
                type="text"
                placeholder="Contoh: banner_kelurahan_final.pdf, ring 4 pojok..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
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

