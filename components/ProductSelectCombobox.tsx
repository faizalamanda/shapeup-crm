"use client"

import { useState, useEffect, useRef } from 'react'

export type ProductComboboxItem = {
  id: string
  name: string
  price: number
  sku: string | null
  cost_price: number | null
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

  // Find stored product match
  const selectedProduct = products.find(
    p => (selectedProductId && p.id === selectedProductId) || (selectedProductName && p.name.toLowerCase() === selectedProductName.toLowerCase())
  )

  // Close dropdown on outside click & reset search query if no product selected
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredProducts = products.filter(p => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q))
    )
  })

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
          {filteredProducts.length > 0 ? (
            filteredProducts.map(p => {
              const isSelected = selectedProductId === p.id || (selectedProductName && p.name.toLowerCase() === selectedProductName.toLowerCase())
              const displayPrice = showCostPrice ? (p.cost_price ?? p.price) : p.price
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={() => {
                    onSelectProduct(p)
                    setSearchQuery('')
                    setIsOpen(false)
                  }}
                  className={`w-full text-left p-2.5 text-xs transition-colors flex items-center justify-between cursor-pointer ${
                    isSelected ? 'bg-blue-50/70 font-bold text-blue-900' : 'hover:bg-gray-50 text-gray-800 font-medium'
                  }`}
                >
                  <div>
                    <span className="font-bold text-gray-900">📦 {p.name}</span>
                    {p.sku && <span className="ml-1.5 text-[10px] font-mono text-gray-500">(SKU: {p.sku})</span>}
                  </div>
                  <span className="text-blue-700 font-bold">{formatIDR(displayPrice)}</span>
                </button>
              )
            })
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
