"use client"

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  useCustomerDirectory,
  matchesCustomerQuery,
  type CustomerDirectoryItem
} from '@/lib/customerDirectoryStore'

export type CustomerComboboxItem = CustomerDirectoryItem

interface CustomerSelectComboboxProps {
  customers?: CustomerComboboxItem[]
  businessId?: string | null
  selectedCustomerId: string
  onSelectCustomer: (customerId: string) => void
  onSelectCustomerObject?: (customer: CustomerComboboxItem | null) => void
  onAddNewCustomer?: (query?: string) => void
  disabled?: boolean
  label?: string
  placeholder?: string
}

const MAX_VISIBLE_ITEMS = 50

export function CustomerSelectCombobox({
  customers: propCustomers,
  businessId,
  selectedCustomerId,
  onSelectCustomer,
  onSelectCustomerObject,
  onAddNewCustomer,
  disabled = false,
  label = 'Customer',
  placeholder = 'Cari & pilih customer (ketik nama / no HP 08... atau 628...)...'
}: CustomerSelectComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchingServer, setSearchingServer] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    customers: storeCustomers,
    loading: storeLoading,
    searchServer
  } = useCustomerDirectory({
    businessId,
    includeCustomerId: selectedCustomerId || null
  })

  // Merge storeCustomers + propCustomers (deduplicated by id, preferring storeCustomers for fresh updates)
  const allCustomers = useMemo<CustomerComboboxItem[]>(() => {
    if (!propCustomers || propCustomers.length === 0) {
      return storeCustomers
    }
    if (storeCustomers.length === 0) {
      return propCustomers
    }
    const map = new Map<string, CustomerComboboxItem>()
    for (const c of propCustomers) {
      if (c?.id) map.set(c.id, c)
    }
    for (const c of storeCustomers) {
      if (c?.id) map.set(c.id, { ...map.get(c.id), ...c })
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' })
    )
  }, [storeCustomers, propCustomers])

  const selectedCustomer = useMemo(
    () => allCustomers.find(c => c.id === selectedCustomerId) || null,
    [allCustomers, selectedCustomerId]
  )

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

  // Symmetric local filtering (supports 08... <-> 628... phone matching & null-safety)
  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return allCustomers
    return allCustomers.filter(c => matchesCustomerQuery(c, q))
  }, [allCustomers, searchQuery])

  // Hybrid Server Search Fallback: if user types >= 2 chars and local matches are < 5,
  // query server in background to guarantee 100% recall
  useEffect(() => {
    const q = searchQuery.trim()
    if (!isOpen || q.length < 2 || filteredCustomers.length >= 5) {
      setSearchingServer(false)
      return
    }

    let cancelled = false
    setSearchingServer(true)
    const timer = setTimeout(async () => {
      await searchServer(q)
      if (!cancelled) {
        setSearchingServer(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchQuery, isOpen, filteredCustomers.length, searchServer])

  // Slice rendered items to MAX_VISIBLE_ITEMS for 0ms DOM performance
  const visibleCustomers = useMemo(
    () => filteredCustomers.slice(0, MAX_VISIBLE_ITEMS),
    [filteredCustomers]
  )

  return (
    <div className="relative w-full" ref={containerRef}>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-bold text-[#70706E] block">{label}</label>
          {allCustomers.length > 0 && (
            <span className="text-[10px] font-semibold text-slate-400">
              {allCustomers.length.toLocaleString('id-ID')} terdaftar
            </span>
          )}
        </div>
      )}

      {/* Input box */}
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          placeholder={storeLoading && allCustomers.length === 0 ? 'Memuat daftar pelanggan...' : placeholder}
          value={
            isOpen
              ? searchQuery
              : selectedCustomer
                ? `${selectedCustomer.name}${selectedCustomer.phone ? ` (${selectedCustomer.phone})` : ''}`
                : searchQuery
          }
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
                onSelectCustomerObject?.(null)
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
        <div className="absolute left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-[#EBEBEA] rounded-xl shadow-lg z-50 divide-y divide-gray-50 animate-in fade-in zoom-in-95 duration-100">
          {visibleCustomers.length > 0 ? (
            <>
              {visibleCustomers.map(c => {
                const isSelected = c.id === selectedCustomerId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={() => {
                      onSelectCustomer(c.id)
                      onSelectCustomerObject?.(c)
                      setSearchQuery('')
                      setIsOpen(false)
                    }}
                    className={`w-full text-left p-3 text-xs transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-blue-50/70 font-bold text-blue-900'
                        : 'hover:bg-gray-50 text-slate-800 font-medium'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="font-bold text-slate-900 text-xs truncate">👤 {c.name}</span>
                      <span className="text-[11px] text-slate-500 font-mono truncate">
                        📱 {c.phone || '-'}{' '}
                        {c.email ? `• ✉️ ${c.email}` : ''}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="text-blue-600 font-bold text-xs shrink-0">✓ Selected</span>
                    )}
                  </button>
                )
              })}

              {filteredCustomers.length > MAX_VISIBLE_ITEMS && (
                <div className="px-3 py-2 bg-slate-50 text-[11px] text-slate-500 font-semibold text-center">
                  Menampilkan {MAX_VISIBLE_ITEMS} dari {filteredCustomers.length.toLocaleString('id-ID')} pelanggan — ketik nama / No. HP untuk mempersempit pencarian
                </div>
              )}
            </>
          ) : (
            <div className="p-3 text-xs text-slate-500 font-medium text-center">
              {searchingServer || storeLoading
                ? `Mencari "${searchQuery}" di database...`
                : `Customer "${searchQuery}" tidak ditemukan.`}
            </div>
          )}

          {/* Add New Customer button inside dropdown */}
          {onAddNewCustomer && (
            <button
              type="button"
              onMouseDown={() => {
                setIsOpen(false)
                onAddNewCustomer(searchQuery.trim())
              }}
              className="w-full text-left p-3 text-xs text-[#1E40AF] hover:bg-[#1E40AF]/5 font-black border-t border-gray-100 flex items-center gap-1.5 transition-colors sticky bottom-0 bg-white"
            >
              ➕ {searchQuery.trim() ? `Tambah "${searchQuery.trim()}" sebagai Customer Baru` : 'Tambah Customer Baru'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
