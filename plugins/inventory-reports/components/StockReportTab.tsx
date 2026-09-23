"use client"
import React, { useState, useEffect, useMemo } from 'react'
import { StockReportItem } from '../types'

interface StockReportTabProps {
  items: StockReportItem[]
  loading: boolean
  searchQuery: string
  selectedCategory: string
}

type SortField =
  | 'productName'
  | 'categoryName'
  | 'onHandQty'
  | 'availableQty'
  | 'reservedQty'
  | 'unitCost'
  | 'totalValue'
  | 'incomingShipments'

export default function StockReportTab({
  items,
  loading,
  searchQuery,
  selectedCategory,
}: StockReportTabProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('shapeup_inventory_page_size')
      if (saved) return Number(saved)
    }
    return 25
  })

  // Table Sorting state
  const [sortField, setSortField] = useState<SortField>('productName')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setCurrentPage(1)
    if (typeof window !== 'undefined') {
      localStorage.setItem('shapeup_inventory_page_size', String(size))
    }
  }

  // Handle Sort Toggle
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // Reset to page 1 on search or category filter change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedCategory])

  // Filtered Items (strict match based on searchQuery & selectedCategory)
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch =
        !searchQuery ||
        item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesCategory =
        !selectedCategory || item.categoryName === selectedCategory

      return matchesSearch && matchesCategory
    })
  }, [items, searchQuery, selectedCategory])

  // Sorted Items
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let valA: any = a[sortField]
      let valB: any = b[sortField]

      if (typeof valA === 'string') {
        valA = valA.toLowerCase()
        valB = (valB || '').toString().toLowerCase()
        return sortOrder === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA)
      }

      valA = Number(valA || 0)
      valB = Number(valB || 0)
      return sortOrder === 'asc' ? valA - valB : valB - valA
    })
  }, [filteredItems, sortField, sortOrder])

  // Robust summary metrics calculated strictly from filteredItems
  const totalOnHand = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.onHandQty || 0), 0),
    [filteredItems]
  )
  const totalAvailable = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.availableQty || 0), 0),
    [filteredItems]
  )
  const totalReserved = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.reservedQty || 0), 0),
    [filteredItems]
  )
  const totalValue = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.totalValue || 0), 0),
    [filteredItems]
  )
  const totalIncoming = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.incomingShipments || 0), 0),
    [filteredItems]
  )
  const totalOutgoing = useMemo(
    () => filteredItems.reduce((sum, i) => sum + (i.outgoingItems || 0), 0),
    [filteredItems]
  )

  // Pagination
  const totalPages = Math.ceil(sortedItems.length / pageSize) || 1
  const paginatedItems = useMemo(
    () => sortedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedItems, currentPage, pageSize]
  )

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  // Render Sort Arrow Helper
  const renderSortArrow = (field: SortField) => {
    if (sortField !== field) {
      return <span className="ml-1 text-slate-300 opacity-60">↕</span>
    }
    return <span className="ml-1 text-blue-600 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="space-y-6">
      {/* Metrics Summary Cards - Dynamically updated for search query */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-[#D6D6CE]">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6B6B63]">Total Stok Fisik</div>
          <div className="text-lg sm:text-xl font-bold text-[#1C1C1A] mt-1">{totalOnHand.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-[#82827A] mt-0.5">On Hand Quantity</div>
        </div>

        <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-emerald-300">
          <div className="text-[11px] sm:text-xs font-semibold text-emerald-800">Stok Tersedia</div>
          <div className="text-lg sm:text-xl font-bold text-emerald-700 mt-1">{totalAvailable.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-emerald-600 mt-0.5">Free for Sale</div>
        </div>

        <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-amber-300">
          <div className="text-[11px] sm:text-xs font-semibold text-amber-800">Stok Terpesan</div>
          <div className="text-lg sm:text-xl font-bold text-amber-700 mt-1">{totalReserved.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-amber-600 mt-0.5">Reserved Orders</div>
        </div>

        <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-blue-300">
          <div className="text-[11px] sm:text-xs font-semibold text-blue-800">Total Nilai Stok</div>
          <div className="text-lg sm:text-xl font-bold text-blue-700 mt-1">{formatCurrency(totalValue)}</div>
          <div className="text-[10px] text-blue-600 mt-0.5">Inventory Valuation</div>
        </div>

        <div className="bg-teal-50/50 border border-teal-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-teal-300">
          <div className="text-[11px] sm:text-xs font-semibold text-teal-800">Penerimaan Barusan</div>
          <div className="text-lg sm:text-xl font-bold text-teal-700 mt-1">{totalIncoming.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-teal-600 mt-0.5">Incoming Shipments</div>
        </div>

        <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-rose-300">
          <div className="text-[11px] sm:text-xs font-semibold text-rose-800">Pengiriman Keluar</div>
          <div className="text-lg sm:text-xl font-bold text-rose-700 mt-1">{totalOutgoing.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-rose-600 mt-0.5">Outgoing Items</div>
        </div>
      </div>

      {/* Stock Report Data Table */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="p-3.5 sm:p-4 border-b border-[#E2E2DC] flex flex-wrap justify-between items-center gap-2 bg-white">
          <div className="flex items-center gap-2">
            <h3 className="text-xs sm:text-sm font-bold text-[#1C1C1A]">
              Daftar Stok Produk ({filteredItems.length} Produk)
            </h3>
            {searchQuery && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded-full">
                Filter: &quot;{searchQuery}&quot;
              </span>
            )}
          </div>

          {/* Page size selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#6B6B63] text-[11px]">Tampilkan:</span>
            <select
              value={pageSize}
              onChange={e => handlePageSizeChange(Number(e.target.value))}
              className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded px-2 py-1 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value={15}>15 baris</option>
              <option value={25}>25 baris</option>
              <option value={50}>50 baris</option>
              <option value={100}>100 baris</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-left text-xs text-[#2D2D2A] min-w-[640px]">
            <thead className="bg-[#F7F7F5] text-[#6B6B63] uppercase tracking-wider font-bold border-b border-[#E2E2DC]">
              <tr>
                <th
                  onClick={() => handleSort('productName')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    SKU & Nama Produk {renderSortArrow('productName')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('categoryName')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    Kategori {renderSortArrow('categoryName')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('onHandQty')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Stok Fisik {renderSortArrow('onHandQty')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('availableQty')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Stok Tersedia {renderSortArrow('availableQty')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('reservedQty')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Stok Terpesan {renderSortArrow('reservedQty')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('unitCost')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Cost Price {renderSortArrow('unitCost')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('totalValue')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Total Nilai {renderSortArrow('totalValue')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('incomingShipments')}
                  className="py-2.5 px-3 sm:px-4 text-center cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-center">
                    Masuk / Keluar {renderSortArrow('incomingShipments')}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#82827A]">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      <span>Memuat data laporan stok...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#82827A]">
                    Tidak ada data produk yang sesuai dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                paginatedItems.map(item => (
                  <tr key={item.productId} className="hover:bg-[#F9F9F8] transition-colors">
                    <td className="py-2.5 px-3 sm:px-4">
                      <div className="font-bold text-[#1C1C1A] text-xs sm:text-sm">{item.productName}</div>
                      {item.sku && <div className="text-[10px] text-[#6B6B63] font-mono">SKU: {item.sku}</div>}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-[#6B6B63] text-[11px]">{item.categoryName}</td>
                    <td className="py-2.5 px-3 sm:px-4 text-right font-bold text-[#1C1C1A]">
                      {item.onHandQty} <span className="text-[10px] text-[#82827A] font-normal">{item.unit}</span>
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right text-emerald-700 font-bold">
                      {item.availableQty}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right text-amber-700 font-semibold">
                      {item.reservedQty > 0 ? `${item.reservedQty}` : '-'}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right text-[#2D2D2A] font-mono text-[11px]">
                      {formatCurrency(item.unitCost)}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right text-blue-700 font-extrabold font-mono text-[11px]">
                      {formatCurrency(item.totalValue)}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-center">
                      <div className="inline-flex items-center gap-1.5 text-[11px]">
                        <span className="text-emerald-700 font-bold">+{item.incomingShipments}</span>
                        <span className="text-[#A8A89E]">/</span>
                        <span className="text-rose-700 font-bold">-{item.outgoingItems}</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Navigation Footer */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-[#E2E2DC] flex items-center justify-between bg-[#F7F7F5] text-xs">
            <span className="text-[#6B6B63] text-[11px]">
              Menampilkan {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, sortedItems.length)} dari {sortedItems.length} barang (Halaman {currentPage} dari {totalPages})
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-3 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-xs transition-all cursor-pointer font-medium"
              >
                &larr; Seb.
              </button>
              <span className="px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-bold text-xs">
                {currentPage}
              </span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-3 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-xs transition-all cursor-pointer font-medium"
              >
                Lanjut &rarr;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
