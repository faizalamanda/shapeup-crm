"use client"
import React, { useState } from 'react'
import { StockReportItem } from '../types'

interface StockReportTabProps {
  items: StockReportItem[]
  loading: boolean
  searchQuery: string
  selectedCategory: string
}

export default function StockReportTab({
  items,
  loading,
  searchQuery,
  selectedCategory,
}: StockReportTabProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const filteredItems = items.filter(item => {
    const matchesSearch =
      !searchQuery ||
      item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesCategory =
      !selectedCategory || item.categoryName === selectedCategory

    return matchesSearch && matchesCategory
  })

  const totalOnHand = filteredItems.reduce((sum, i) => sum + i.onHandQty, 0)
  const totalAvailable = filteredItems.reduce((sum, i) => sum + i.availableQty, 0)
  const totalReserved = filteredItems.reduce((sum, i) => sum + i.reservedQty, 0)
  const totalValue = filteredItems.reduce((sum, i) => sum + i.totalValue, 0)
  const totalIncoming = filteredItems.reduce((sum, i) => sum + i.incomingShipments, 0)
  const totalOutgoing = filteredItems.reduce((sum, i) => sum + i.outgoingItems, 0)

  // Pagination for low-end device optimization
  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1
  const paginatedItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="space-y-6">
      {/* Metrics Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-3.5 sm:p-4 shadow-xs">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6B6B63]">Total Stok Fisik</div>
          <div className="text-lg sm:text-xl font-bold text-[#1C1C1A] mt-1">{totalOnHand.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-[#82827A] mt-0.5">On Hand Quantity</div>
        </div>

        <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
          <div className="text-[11px] sm:text-xs font-semibold text-emerald-800">Stok Tersedia</div>
          <div className="text-lg sm:text-xl font-bold text-emerald-700 mt-1">{totalAvailable.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-emerald-600 mt-0.5">Free for Sale</div>
        </div>

        <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
          <div className="text-[11px] sm:text-xs font-semibold text-amber-800">Stok Terpesan</div>
          <div className="text-lg sm:text-xl font-bold text-amber-700 mt-1">{totalReserved.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-amber-600 mt-0.5">Reserved Orders</div>
        </div>

        <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
          <div className="text-[11px] sm:text-xs font-semibold text-blue-800">Total Nilai Stok</div>
          <div className="text-lg sm:text-xl font-bold text-blue-700 mt-1">{formatCurrency(totalValue)}</div>
          <div className="text-[10px] text-blue-600 mt-0.5">Inventory Valuation</div>
        </div>

        <div className="bg-teal-50/50 border border-teal-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
          <div className="text-[11px] sm:text-xs font-semibold text-teal-800">Penerimaan Barusan</div>
          <div className="text-lg sm:text-xl font-bold text-teal-700 mt-1">{totalIncoming.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-teal-600 mt-0.5">Incoming Shipments</div>
        </div>

        <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
          <div className="text-[11px] sm:text-xs font-semibold text-rose-800">Pengiriman Keluar</div>
          <div className="text-lg sm:text-xl font-bold text-rose-700 mt-1">{totalOutgoing.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-rose-600 mt-0.5">Outgoing Items</div>
        </div>
      </div>

      {/* Stock Report Data Table */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="p-3.5 sm:p-4 border-b border-[#E2E2DC] flex flex-wrap justify-between items-center gap-2 bg-white">
          <h3 className="text-xs sm:text-sm font-bold text-[#1C1C1A]">
            Daftar Stok Produk ({filteredItems.length} Produk)
          </h3>

          {/* Page size selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#6B6B63] text-[11px]">Tampilkan:</span>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded px-2 py-1 focus:outline-none"
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
                <th className="py-2.5 px-3 sm:px-4">SKU & Nama Produk</th>
                <th className="py-2.5 px-3 sm:px-4">Kategori</th>
                <th className="py-2.5 px-3 sm:px-4 text-right">Stok Fisik</th>
                <th className="py-2.5 px-3 sm:px-4 text-right">Stok Tersedia</th>
                <th className="py-2.5 px-3 sm:px-4 text-right">Stok Terpesan</th>
                <th className="py-2.5 px-3 sm:px-4 text-right">Cost Price</th>
                <th className="py-2.5 px-3 sm:px-4 text-right">Total Nilai</th>
                <th className="py-2.5 px-3 sm:px-4 text-center">Masuk / Keluar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#82827A]">
                    Memuat data laporan stok...
                  </td>
                </tr>
              ) : paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#82827A]">
                    Tidak ada data produk yang sesuai dengan filter.
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
              Halaman {currentPage} dari {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-3 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-xs transition-all cursor-pointer"
              >
                &larr; Seb.
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-3 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-xs transition-all cursor-pointer"
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
