"use client"
import { useState, useMemo, useEffect } from 'react'

export type VariantOption = {
  id: string
  name: string
  price: number
  costPrice?: number
  stockQuantity?: number
}

export type ModifierGroup = {
  id: string
  name: string
  required?: boolean
  options: {
    id: string
    name: string
    priceExtra: number
  }[]
}

type Props = {
  isOpen: boolean
  onClose: () => void
  product: {
    id: string
    name: string
    price: number
    stock_quantity: number
    variants?: VariantOption[]
    product_variants?: any[]
    modifiers?: ModifierGroup[]
    product_modifiers?: any[]
  } | null
  onAddToCart: (item: {
    product: any
    selectedVariant?: VariantOption
    selectedModifiers: { group: string; name: string; priceExtra: number }[]
    note: string
    finalPrice: number
  }) => void
}

export default function VariantSelectorModal({ isOpen, onClose, product, onAddToCart }: Props) {
  if (!isOpen || !product) return null

  // Resolve real database variants or props
  const variants: VariantOption[] = useMemo(() => {
    const raw = (product as any).product_variants || product.variants
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((v: any) => ({
        id: v.id,
        name: v.name,
        price: Number(v.price ?? product.price),
        costPrice: Number(v.cost_price ?? 0),
        stockQuantity: Number(v.stock_quantity ?? 0)
      }))
    }
    return []
  }, [product])

  // Resolve real database modifiers or props
  const modifierGroups: ModifierGroup[] = useMemo(() => {
    const raw = (product as any).product_modifiers || product.modifiers
    if (Array.isArray(raw) && raw.length > 0) {
      if (raw[0].group_name) {
        const map: Record<string, ModifierGroup> = {}
        for (const m of raw) {
          const gName = m.group_name || 'Kustomisasi'
          if (!map[gName]) {
            map[gName] = {
              id: `g-${gName}`,
              name: gName,
              required: Boolean(m.is_required),
              options: []
            }
          }
          map[gName].options.push({
            id: m.id,
            name: m.option_name,
            priceExtra: Number(m.price_extra || 0)
          })
        }
        return Object.values(map)
      }
      return raw
    }
    return []
  }, [product])

  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(variants[0] || null)
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, { group: string; name: string; priceExtra: number }>>({})
  const [note, setNote] = useState('')

  useEffect(() => {
    if (product) {
      setSelectedVariant(variants[0] || null)
      const initialMods: Record<string, { group: string; name: string; priceExtra: number }> = {}
      for (const g of modifierGroups) {
        if (g.required && g.options.length > 0) {
          initialMods[g.id] = { group: g.name, name: g.options[0].name, priceExtra: g.options[0].priceExtra }
        }
      }
      setSelectedModifiers(initialMods)
      setNote('')
    }
  }, [product, variants, modifierGroups])

  // Calculate final unit price
  const extraTotal = Object.values(selectedModifiers).reduce((acc, m) => acc + m.priceExtra, 0)
  const basePrice = selectedVariant ? selectedVariant.price : product.price
  const finalPrice = basePrice + extraTotal

  const handleToggleModifier = (group: ModifierGroup, opt: { id: string; name: string; priceExtra: number }) => {
    setSelectedModifiers(prev => {
      const copy = { ...prev }
      if (copy[group.id]?.name === opt.name && !group.required) {
        delete copy[group.id]
      } else {
        copy[group.id] = { group: group.name, name: opt.name, priceExtra: opt.priceExtra }
      }
      return copy
    })
  }

  const handleConfirm = () => {
    onAddToCart({
      product,
      selectedVariant: selectedVariant || undefined,
      selectedModifiers: Object.values(selectedModifiers),
      note,
      finalPrice
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h3 className="font-bold text-gray-900 text-lg leading-tight">{product.name}</h3>
            <p className="text-xs text-gray-500">Pilih opsi varian dan modifier produk</p>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-gray-700 flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* Varian Selection */}
          {variants.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Opsi Varian <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {variants.map((v) => {
                  const isSelected = selectedVariant?.id === v.id
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVariant(v)}
                      className={`p-3 text-left rounded-xl border font-medium transition flex flex-col justify-between ${
                        isSelected 
                          ? 'border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-1 ring-indigo-500' 
                          : 'border-gray-200 hover:border-gray-300 text-gray-800'
                      }`}
                    >
                      <span className="text-sm font-semibold">{v.name}</span>
                      <span className="text-xs text-indigo-600 font-bold mt-1">
                        Rp {v.price.toLocaleString('id-ID')}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Modifier Groups */}
          {modifierGroups.map((group) => (
            <div key={group.id} className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  {group.name}
                </label>
                {group.required ? (
                  <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-medium">Wajib</span>
                ) : (
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Opsional</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.options.map((opt) => {
                  const isSelected = selectedModifiers[group.id]?.name === opt.name
                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleToggleModifier(group, opt)}
                      className={`px-3 py-2.5 rounded-xl border text-left text-xs transition flex items-center justify-between ${
                        isSelected 
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-medium' 
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span>{opt.name}</span>
                      {opt.priceExtra > 0 && (
                        <span className="text-[11px] font-semibold text-indigo-600">+Rp {opt.priceExtra.toLocaleString('id-ID')}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Catatan Item */}
          <div className="pt-2">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Catatan Pesanan (Notes)
            </label>
            <input 
              type="text" 
              placeholder="Contoh: Tanpa sedotan, pisahkan es..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/80 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">Total Harga Item</div>
            <div className="text-lg font-bold text-gray-900">
              Rp {finalPrice.toLocaleString('id-ID')}
            </div>
          </div>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold rounded-xl text-sm transition shadow-sm text-center"
          >
            + Tambahkan ke Cart
          </button>
        </div>
      </div>
    </div>
  )
}
