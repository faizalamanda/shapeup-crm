"use client"

import { useState, useEffect, useRef } from 'react'

export type CustomerComboboxItem = {
  id: string
  name: string
  phone: string
  email: string | null
  address_data?: any
}

interface CustomerSelectComboboxProps {
  customers: CustomerComboboxItem[]
  selectedCustomerId: string
  onSelectCustomer: (customerId: string) => void
  onAddNewCustomer: (query?: string) => void
  disabled?: boolean
}

export function CustomerSelectCombobox({
  customers,
  selectedCustomerId,
  onSelectCustomer,
  onAddNewCustomer,
  disabled = false
}: CustomerSelectComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

  // Sync input value when customer selection changes from outside
  useEffect(() => {
    if (selectedCustomer) {
      setSearchQuery('')
    }
  }, [selectedCustomer])

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

  const filteredCustomers = customers.filter(c => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    )
  })

  return (
    <div className="relative w-full" ref={containerRef}>
      <label className="text-xs font-bold text-[#70706E] block mb-1">Customer</label>

      {/* Input box */}
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          placeholder="Cari & pilih customer (ketik nama / no HP)..."
          value={isOpen ? searchQuery : (selectedCustomer ? `${selectedCustomer.name} (${selectedCustomer.phone})` : searchQuery)}
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
          className="w-full p-2.5 pr-16 text-sm rounded-xl border border-[#EBEBEA] bg-white disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {selectedCustomerId && !disabled && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                onSelectCustomer('')
                setSearchQuery('')
                setIsOpen(false)
              }}
              className="p-1 text-xs text-gray-400 hover:text-rose-600 font-bold transition-colors"
              title="Hapus pilihan customer"
            >
              ✕
            </button>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setIsOpen(!isOpen)}
            className="p-1 text-xs text-gray-400 hover:text-gray-600"
          >
            {isOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Dropdown list */}
      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-[#EBEBEA] rounded-xl shadow-lg z-50 divide-y divide-gray-50 animate-in fade-in zoom-in-95 duration-100">
          {filteredCustomers.length > 0 ? (
            filteredCustomers.map(c => {
              const isSelected = c.id === selectedCustomerId
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={() => {
                    onSelectCustomer(c.id)
                    setSearchQuery('')
                    setIsOpen(false)
                  }}
                  className={`w-full text-left p-3 text-xs transition-colors flex items-center justify-between ${
                    isSelected ? 'bg-blue-50/70 font-bold text-blue-900' : 'hover:bg-gray-50 text-slate-800 font-medium'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-900 text-xs">👤 {c.name}</span>
                    <span className="text-[11px] text-slate-500 font-mono">📱 {c.phone} {c.email ? `• ✉️ ${c.email}` : ''}</span>
                  </div>
                  {isSelected && <span className="text-blue-600 font-bold text-xs">✓ Selected</span>}
                </button>
              )
            })
          ) : (
            <div className="p-3 text-xs text-slate-500 font-medium text-center">
              Customer &quot;{searchQuery}&quot; tidak ditemukan.
            </div>
          )}

          {/* Add New Customer button inside dropdown */}
          <button
            type="button"
            onMouseDown={() => {
              setIsOpen(false)
              onAddNewCustomer(searchQuery.trim())
            }}
            className="w-full text-left p-3 text-xs text-[#1E40AF] hover:bg-[#1E40AF]/5 font-black border-t border-gray-100 flex items-center gap-1.5 transition-colors"
          >
            ➕ {searchQuery.trim() ? `Tambah "${searchQuery.trim()}" sebagai Customer Baru` : 'Tambah Customer Baru'}
          </button>
        </div>
      )}
    </div>
  )
}
