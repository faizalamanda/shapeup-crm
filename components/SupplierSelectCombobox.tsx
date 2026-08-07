"use client"

import { useState, useEffect, useRef } from 'react'

export type SupplierComboboxItem = {
  id: string
  name: string
  phone?: string | null
  email?: string | null
}

interface SupplierSelectComboboxProps {
  suppliers: SupplierComboboxItem[]
  selectedSupplierId: string
  onSelectSupplier: (supplierId: string) => void
  onAddNewSupplier?: (query?: string) => void
  disabled?: boolean
  placeholder?: string
}

export function SupplierSelectCombobox({
  suppliers,
  selectedSupplierId,
  onSelectSupplier,
  onAddNewSupplier,
  disabled = false,
  placeholder = 'Cari & pilih pemasok (ketik nama)...'
}: SupplierSelectComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId)

  // Sync input value when supplier selection changes from outside
  useEffect(() => {
    if (selectedSupplier) {
      setSearchQuery('')
    }
  }, [selectedSupplier])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredSuppliers = suppliers.filter(s => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      s.name.toLowerCase().includes(q) ||
      (s.phone && s.phone.toLowerCase().includes(q)) ||
      (s.email && s.email.toLowerCase().includes(q))
    )
  })

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Input box */}
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          value={isOpen ? searchQuery : (selectedSupplier ? selectedSupplier.name : searchQuery)}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true)
              setSearchQuery('')
            }
          }}
          onChange={e => {
            setSearchQuery(e.target.value)
            if (!isOpen) setIsOpen(true)
          }}
          className="w-full p-2.5 pr-14 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-800 disabled:bg-gray-50 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {selectedSupplierId && !disabled && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                onSelectSupplier('')
                setSearchQuery('')
                setIsOpen(false)
              }}
              className="p-1 text-xs text-gray-400 hover:text-red-600 font-bold transition-colors cursor-pointer"
              title="Hapus pilihan pemasok"
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
        <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50 divide-y divide-gray-100 animate-in fade-in zoom-in-95 duration-100">
          {filteredSuppliers.length > 0 ? (
            filteredSuppliers.map(s => {
              const isSelected = s.id === selectedSupplierId
              return (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={() => {
                    onSelectSupplier(s.id)
                    setSearchQuery('')
                    setIsOpen(false)
                  }}
                  className={`w-full text-left p-2.5 text-xs transition-colors flex items-center justify-between cursor-pointer ${
                    isSelected ? 'bg-blue-50/70 font-bold text-blue-900' : 'hover:bg-gray-50 text-gray-800 font-medium'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-gray-900 text-xs">🏢 {s.name}</span>
                    {(s.phone || s.email) && (
                      <span className="text-[10px] text-gray-500 font-mono">
                        {s.phone ? `📱 ${s.phone}` : ''} {s.email ? `• ✉️ ${s.email}` : ''}
                      </span>
                    )}
                  </div>
                  {isSelected && <span className="text-blue-600 font-bold text-xs">✓ Terpilih</span>}
                </button>
              )
            })
          ) : (
            <div className="p-3 text-xs text-gray-500 font-medium text-center">
              Pemasok &quot;{searchQuery}&quot; tidak ditemukan.
            </div>
          )}

          {onAddNewSupplier && (
            <button
              type="button"
              onMouseDown={() => {
                setIsOpen(false)
                onAddNewSupplier(searchQuery.trim())
              }}
              className="w-full text-left p-2.5 text-xs text-blue-700 hover:bg-blue-50 font-black border-t border-gray-100 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              ➕ {searchQuery.trim() ? `Tambah "${searchQuery.trim()}" sebagai Pemasok Baru` : 'Tambah Pemasok Baru'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
