"use client"

import { useState, useEffect, useRef } from 'react'

export type ProductComboboxItem = {
  id: string
  variant_id?: string | null
  name: string
  price: number
  sku: string | null
  cost_price: number | null
  stock_quantity?: number | null
  stock_type?: string | null
  is_variant?: boolean
}

const formatIDR = (value: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value)
}

interface ProductSelectComboboxProps {
  products: ProductComboboxItem[]
  selectedProductId: string | null
  selectedVariantId?: string | null
  selectedProductName: string
  onSelectProduct: (product: ProductComboboxItem) => void
  onClearProduct: () => void
  onAddNewProduct?: (searchQuery: string) => void
  onChangeCustomName?: (name: string) => void
  disabled?: boolean
  placeholder?: string
  showCostPrice?: boolean
}

export function ProductSelectCombobox({
  products,
  selectedProductId,
  selectedVariantId = null,
  selectedProductName,
  onSelectProduct,
  onClearProduct,
  onAddNewProduct,
  onChangeCustomName,
  disabled = false,
  placeholder = 'Nama Produk',
  showCostPrice = false
}: ProductSelectComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Find stored product match (variant-aware)
  const selectedProduct = products.find(p => {
    if (selectedProductId && p.id === selectedProductId) {
      if (selectedVariantId) {
        return p.variant_id === selectedVariantId
      }
      if (!p.variant_id) {
        return true
      }
    }
    if (selectedProductName && p.name.toLowerCase() === selectedProductName.toLowerCase()) {
      return true
    }
    return false
  })

  // Close dropdown on outside click & reset search query if no product selected
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
        // Strict-select mode: if no valid product is linked (no ID) and custom names
        // are not allowed, clear the dangling text so invalid data can't be saved.
        if (!onChangeCustomName && !selectedProductId) {
          onClearProduct()
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [selectedProductId, onChangeCustomName, onClearProduct])

  const filteredProducts = products.filter(p => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q))
    )
  })

  // DOM Windowing: Limit rendered nodes to 50 items for 0ms dropdown open latency on > 1,000 products
  const MAX_VISIBLE_ITEMS = 50
  const visibleProducts = filteredProducts.slice(0, MAX_VISIBLE_ITEMS)

  const hasSelection = Boolean(selectedProduct || selectedProductName)

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          value={
            isOpen
              ? searchQuery
              : (selectedProduct ? selectedProduct.name : selectedProductName || searchQuery)
          }
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true)
              setSearchQuery('')
            }
          }}
          onChange={e => {
            const val = e.target.value
            setSearchQuery(val)
            if (!isOpen) setIsOpen(true)
            if (onChangeCustomName) {
              onChangeCustomName(val)
            }
          }}
          className="w-full p-2 pr-14 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-800 disabled:bg-gray-50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {hasSelection && !disabled && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                onClearProduct()
                setSearchQuery('')
                setIsOpen(false)
              }}
              className="p-1 text-xs text-gray-400 hover:text-red-600 font-bold transition-colors cursor-pointer"
              title="Hapus pilihan produk"
            >
              ✕
            </button>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setIsOpen(!isOpen)}
            className="p-1 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            {isOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Dropdown list */}
      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50 divide-y divide-gray-100 animate-in fade-in zoom-in-95 duration-100">
          {visibleProducts.length > 0 ? (
            <>
              {visibleProducts.map(p => {
                const itemKey = p.variant_id ? `${p.id}_${p.variant_id}` : p.id
                const isSelected =
                  (selectedProductId === p.id && ((selectedVariantId && p.variant_id === selectedVariantId) || (!selectedVariantId && !p.variant_id))) ||
                  (selectedProductName && (p.name || '').toLowerCase() === selectedProductName.toLowerCase())
                const displayPrice = showCostPrice ? (p.cost_price ?? p.price) : p.price
                const isTracked = !p.stock_type || p.stock_type === 'tracked'
                const hasStockInfo = isTracked && p.stock_quantity !== undefined && p.stock_quantity !== null

                return (
                  <button
                    key={itemKey}
                    type="button"
                    onMouseDown={() => {
                      onSelectProduct(p)
                      setSearchQuery('')
                      setIsOpen(false)
                    }}
                    className={`w-full text-left p-2.5 text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      isSelected ? 'bg-blue-50/70 font-bold text-blue-900' : 'hover:bg-gray-50 text-gray-800 font-medium'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-bold text-gray-900">📦 {p.name}</span>
                      {p.sku && <span className="ml-1.5 text-[10px] font-mono text-gray-500">(SKU: {p.sku})</span>}
                      {hasStockInfo && (
                        <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                          Number(p.stock_quantity) > 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}>
                          Stok: {p.stock_quantity}
                        </span>
                      )}
                    </div>
                    <span className="text-blue-700 font-bold shrink-0">{formatIDR(displayPrice)}</span>
                  </button>
                )
              })}
              {filteredProducts.length > MAX_VISIBLE_ITEMS && (
                <div className="px-3 py-2 bg-slate-50 text-[11px] text-gray-500 font-semibold text-center">
                  Menampilkan {MAX_VISIBLE_ITEMS} dari {filteredProducts.length.toLocaleString('id-ID')} item — ketik nama atau SKU untuk memfilter
                </div>
              )}
            </>
          ) : (
            <div className="p-3 text-xs text-gray-500 font-medium text-center">
              Produk &quot;{searchQuery}&quot; tidak ditemukan.
            </div>
          )}

          {/* Quick Add Product action or Custom Name option */}
          {searchQuery.trim() && onChangeCustomName && (
            <button
              type="button"
              onMouseDown={() => {
                setIsOpen(false)
                onChangeCustomName(searchQuery.trim())
              }}
              className="w-full text-left p-2.5 text-xs text-blue-700 hover:bg-blue-50 font-bold border-t border-gray-100 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              ✏️ Gunakan &quot;{searchQuery.trim()}&quot; sebagai nama manual
            </button>
          )}

          {onAddNewProduct && (
            <button
              type="button"
              onMouseDown={() => {
                setIsOpen(false)
                onAddNewProduct(searchQuery.trim())
              }}
              className="w-full text-left p-2.5 text-xs text-blue-700 hover:bg-blue-50 font-black border-t border-gray-100 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              ➕ {searchQuery.trim() ? `Tambah "${searchQuery.trim()}" sebagai Produk Baru` : 'Tambah Produk Baru'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
