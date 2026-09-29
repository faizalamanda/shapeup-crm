"use client"
import React, { useState } from 'react'
import { StockReportItem, InventoryReportMetrics, PaginationMeta } from '../types'
import ProductDetailModal from './ProductDetailModal'

interface StockReportTabProps {
  items: StockReportItem[]
  metrics: InventoryReportMetrics | null
  pagination: PaginationMeta
  loading: boolean
  searchQuery: string
  selectedCategory: string
  onPageChange: (page: number) => void
  onPageSizeChange: (limit: number) => void
  sortField: SortField
  sortOrder: 'asc' | 'desc'
  onSortChange: (field: SortField) => void
}

export type SortField =
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
  metrics,
  pagination,
  loading,
  searchQuery,
  selectedCategory,
  onPageChange,
  onPageSizeChange,
  sortField,
  sortOrder,
  onSortChange,
}: StockReportTabProps) {
  // Selected Product for Detail Modal
  const [selectedProduct, setSelectedProduct] = useState<StockReportItem | null>(null)

  // Items are already sorted from server
  const sortedItems = items

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  const renderSortArrow = (field: SortField) => {
    if (sortField !== field) {
      return <span className="ml-1 text-slate-300 opacity-60">↕</span>
    }
    return <span className="ml-1 text-blue-600 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
  }

  const { page, limit, totalItems, totalPages } = pagination

  return (
    <div className="space-y-6">
      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          productId={selectedProduct.productId}
          initialStockItem={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {/* Metrics Summary Cards (From Fast Server Summary) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-[#D6D6CE]">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6B6B63]">Total Jenis Produk</div>
          <div className="text-lg sm:text-xl font-bold text-[#1C1C1A] mt-1">
            {metrics ? metrics.totalProducts.toLocaleString('id-ID') : '...'}
          </div>
          <div className="text-[10px] text-[#82827A] mt-0.5">Master Data Catalog</div>
        </div>

        <div className="bg-white border border-[#E2E2DC] rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-[#D6D6CE]">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6B6B63]">Total Stok Fisik</div>
          <div className="text-lg sm:text-xl font-bold text-[#1C1C1A] mt-1">
            {metrics ? metrics.totalStockQty.toLocaleString('id-ID') : '...'}
          </div>
          <div className="text-[10px] text-[#82827A] mt-0.5">Total Units On Hand</div>
        </div>

        <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-blue-300">
          <div className="text-[11px] sm:text-xs font-semibold text-blue-800">Total Nilai Persediaan</div>
          <div className="text-lg sm:text-xl font-bold text-blue-700 mt-1">
            {metrics ? formatCurrency(metrics.totalValuation) : '...'}
          </div>
          <div className="text-[10px] text-blue-600 mt-0.5">Inventory Valuation</div>
        </div>

        <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-amber-300">
          <div className="text-[11px] sm:text-xs font-semibold text-amber-800">Stok Sedikit (≤ 5)</div>
          <div className="text-lg sm:text-xl font-bold text-amber-700 mt-1">
            {metrics ? metrics.lowStockCount.toLocaleString('id-ID') : '...'}
          </div>
          <div className="text-[10px] text-amber-600 mt-0.5">Perlu Reorder</div>
        </div>

        <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-3.5 sm:p-4 shadow-xs transition-all hover:border-rose-300">
          <div className="text-[11px] sm:text-xs font-semibold text-rose-800">Stok Habis / Minus</div>
          <div className="text-lg sm:text-xl font-bold text-rose-700 mt-1">
            {metrics ? metrics.outOfStockCount.toLocaleString('id-ID') : '...'}
          </div>
          <div className="text-[10px] text-rose-600 mt-0.5">Stok Kosong</div>
        </div>
      </div>

      {/* Stock Report Data Table */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="p-3.5 sm:p-4 border-b border-[#E2E2DC] flex flex-wrap justify-between items-center gap-2 bg-white">
          <div className="flex items-center gap-2">
            <h3 className="text-xs sm:text-sm font-bold text-[#1C1C1A]">
              Daftar Stok Produk ({totalItems} Produk)
            </h3>
            {searchQuery && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded-full">
                Search: &quot;{searchQuery}&quot;
              </span>
            )}
            {selectedCategory && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-indigo-100 text-indigo-700 rounded-full">
                Kategori: &quot;{selectedCategory}&quot;
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#6B6B63] text-[11px]">Tampilkan per halaman:</span>
            <select
              value={limit}
              onChange={e => onPageSizeChange(Number(e.target.value))}
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
                  onClick={() => onSortChange('productName')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    SKU & Nama Produk {renderSortArrow('productName')}
                  </div>
                </th>
                <th
                  onClick={() => onSortChange('categoryName')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    Kategori {renderSortArrow('categoryName')}
                  </div>
                </th>
                <th
                  onClick={() => onSortChange('onHandQty')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Stok Fisik {renderSortArrow('onHandQty')}
                  </div>
                </th>
                <th
                  onClick={() => onSortChange('unitCost')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Cost Price {renderSortArrow('unitCost')}
                  </div>
                </th>
                <th
                  onClick={() => onSortChange('totalValue')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Total Nilai {renderSortArrow('totalValue')}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#82827A]">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      <span>Memuat data halaman {page}...</span>
                    </div>
                  </td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#82827A]">
                    Tidak ada data produk yang sesuai dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                sortedItems.map(item => (
                  <tr key={item.productId} className="hover:bg-[#F9F9F8] transition-colors">
                    <td className="py-2.5 px-3 sm:px-4">
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(item)}
                        className="text-left group cursor-pointer focus:outline-none"
                        title="Klik untuk melihat detail, valuation & move history produk ini"
                      >
                        <div className="font-bold text-blue-600 group-hover:text-blue-800 group-hover:underline text-xs sm:text-sm transition-colors flex items-center gap-1.5">
                          <span>{item.productName}</span>
                          <span className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-500 transition-opacity">
                            🔍
                          </span>
                        </div>
                        {item.sku && (
                          <div className="text-[10px] text-[#6B6B63] font-mono">SKU: {item.sku}</div>
                        )}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-[#6B6B63] text-[11px]">{item.categoryName}</td>
                    <td className="py-2.5 px-3 sm:px-4 text-right font-bold text-[#1C1C1A]">
                      <span className={item.onHandQty <= 0 ? 'text-rose-600 font-extrabold' : item.onHandQty <= 5 ? 'text-amber-600 font-extrabold' : ''}>
                        {item.onHandQty}
                      </span>{' '}
                      <span className="text-[10px] text-[#82827A] font-normal">{item.unit}</span>
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right text-[#2D2D2A] font-mono text-[11px]">
                      {formatCurrency(item.unitCost)}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right text-blue-700 font-extrabold font-mono text-[11px]">
                      {formatCurrency(item.totalValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Server Pagination Controls */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-[#E2E2DC] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#F7F7F5] text-xs">
            <span className="text-[#6B6B63] text-[11px]">
              Menampilkan {((page - 1) * limit) + 1} - {Math.min(page * limit, totalItems)} dari {totalItems} barang (Halaman {page} dari {totalPages})
            </span>

            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 1 || loading}
                onClick={() => onPageChange(1)}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-[11px] font-medium transition-all cursor-pointer"
                title="Halaman Pertama"
              >
                &laquo;
              </button>

              <button
                disabled={page <= 1 || loading}
                onClick={() => onPageChange(page - 1)}
                className="px-3 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-xs font-medium transition-all cursor-pointer"
              >
                &larr; Seb.
              </button>

              <span className="px-3 py-1 bg-blue-600 text-white font-bold text-xs rounded shadow-xs">
                {page} / {totalPages}
              </span>

              <button
                disabled={page >= totalPages || loading}
                onClick={() => onPageChange(page + 1)}
                className="px-3 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-xs font-medium transition-all cursor-pointer"
              >
                Lanjut &rarr;
              </button>

              <button
                disabled={page >= totalPages || loading}
                onClick={() => onPageChange(totalPages)}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 text-[#1C1C1A] rounded text-[11px] font-medium transition-all cursor-pointer"
                title="Halaman Terakhir"
              >
                &raquo;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
