"use client"
import React, { useState, useMemo, useEffect } from 'react'
import { StockMove, MoveStatus } from '../types'

interface MoveHistoryTabProps {
  moves: StockMove[]
  loading: boolean
  searchQuery: string
  statusFilter: MoveStatus | 'all'
  lotFilter: string
  setStatusFilter: (status: MoveStatus | 'all') => void
  setLotFilter: (lot: string) => void
}

type SortField =
  | 'created_at'
  | 'reference'
  | 'product_name'
  | 'type'
  | 'lot_number'
  | 'qty'
  | 'unit_cost'
  | 'status'

export default function MoveHistoryTab({
  moves,
  loading,
  searchQuery,
  statusFilter,
  lotFilter,
  setStatusFilter,
  setLotFilter,
}: MoveHistoryTabProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('shapeup_inventory_page_size')
      if (saved) return Number(saved)
    }
    return 25
  })

  // Table Sorting State
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setCurrentPage(1)
    if (typeof window !== 'undefined') {
      localStorage.setItem('shapeup_inventory_page_size', String(size))
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, lotFilter])

  const filteredMoves = useMemo(() => {
    return moves.filter(m => {
      const matchesSearch =
        !searchQuery ||
        (m.product_name && m.product_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (m.reference && m.reference.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (m.lot_number && m.lot_number.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesStatus = statusFilter === 'all' || m.status === statusFilter

      const matchesLot = !lotFilter || (m.lot_number && m.lot_number.toLowerCase().includes(lotFilter.toLowerCase()))

      return matchesSearch && matchesStatus && matchesLot
    })
  }, [moves, searchQuery, statusFilter, lotFilter])

  const sortedMoves = useMemo(() => {
    return [...filteredMoves].sort((a, b) => {
      let valA: any = a[sortField]
      let valB: any = b[sortField]

      if (sortField === 'created_at') {
        const timeA = new Date(valA || 0).getTime()
        const timeB = new Date(valB || 0).getTime()
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA
      }

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
  }, [filteredMoves, sortField, sortOrder])

  // Pagination
  const totalPages = Math.ceil(sortedMoves.length / pageSize) || 1
  const paginatedMoves = useMemo(
    () => sortedMoves.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedMoves, currentPage, pageSize]
  )

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  const getStatusBadge = (status: MoveStatus) => {
    switch (status) {
      case 'done':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Selesai (Done)</span>
      case 'pending':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Pending / Processing</span>
      case 'cancelled':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Dibatalkan</span>
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">{status}</span>
    }
  }

  const getTypeTag = (type: string) => {
    switch (type) {
      case 'receipt':
        return <span className="text-emerald-700 font-bold">Penerimaan (Receipt)</span>
      case 'delivery':
        return <span className="text-rose-700 font-bold">Pengiriman (Delivery)</span>
      case 'transfer':
        return <span className="text-blue-700 font-bold">Transfer Gudang</span>
      case 'adjustment':
        return <span className="text-amber-700 font-bold">Penyesuaian Opname</span>
      default:
        return <span>{type}</span>
    }
  }

  const renderSortArrow = (field: SortField) => {
    if (sortField !== field) {
      return <span className="ml-1 text-slate-300 opacity-60">↕</span>
    }
    return <span className="ml-1 text-blue-600 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="space-y-4">
      {/* Move History Filters Toolbar */}
      <div className="flex flex-wrap gap-3 items-center justify-between bg-white p-3.5 rounded-xl border border-[#E2E2DC] shadow-xs">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#6B6B63]">Status:</span>
            <select
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value as any)
                setCurrentPage(1)
              }}
              className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="all">Semua Status</option>
              <option value="done">Selesai (Done)</option>
              <option value="pending">Pending / Processing</option>
              <option value="cancelled">Dibatalkan</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-[#6B6B63]">Lot/Batch:</span>
            <input
              type="text"
              placeholder="Cari Lot / Batch..."
              value={lotFilter}
              onChange={e => {
                setLotFilter(e.target.value)
                setCurrentPage(1)
              }}
              className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 w-32 sm:w-auto"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-[#6B6B63]">
          <span>Log Mutasi: <strong className="text-[#1C1C1A]">{filteredMoves.length}</strong></span>
          <select
            value={pageSize}
            onChange={e => handlePageSizeChange(Number(e.target.value))}
            className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded px-2 py-1 focus:outline-none cursor-pointer"
          >
            <option value={15}>15 baris</option>
            <option value={25}>25 baris</option>
            <option value={50}>50 baris</option>
            <option value={100}>100 baris</option>
          </select>
        </div>
      </div>

      {/* Move History Table */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-left text-xs text-[#2D2D2A] min-w-[700px]">
            <thead className="bg-[#F7F7F5] text-[#6B6B63] uppercase tracking-wider font-bold border-b border-[#E2E2DC]">
              <tr>
                <th
                  onClick={() => handleSort('created_at')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    Waktu {renderSortArrow('created_at')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('reference')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    No. Referensi {renderSortArrow('reference')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('product_name')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    Nama Produk {renderSortArrow('product_name')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('type')}
                  className="py-2.5 px-3 sm:px-4 cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center">
                    Tipe Mutasi {renderSortArrow('type')}
                  </div>
                </th>
                <th className="py-2.5 px-3 sm:px-4">Asal ➔ Tujuan</th>
                <th
                  onClick={() => handleSort('lot_number')}
                  className="py-2.5 px-3 sm:px-4 text-center cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-center">
                    Lot / Batch {renderSortArrow('lot_number')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('qty')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Jumlah {renderSortArrow('qty')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('unit_cost')}
                  className="py-2.5 px-3 sm:px-4 text-right cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-end">
                    Harga Unit {renderSortArrow('unit_cost')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('status')}
                  className="py-2.5 px-3 sm:px-4 text-center cursor-pointer hover:bg-[#ECECE8] transition-colors select-none"
                >
                  <div className="flex items-center justify-center">
                    Status {renderSortArrow('status')}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#82827A]">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      <span>Memuat riwayat mutasi stok...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedMoves.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#82827A]">
                    Tidak ditemukan log mutasi persediaan.
                  </td>
                </tr>
              ) : (
                paginatedMoves.map(m => (
                  <tr key={m.id} className="hover:bg-[#F9F9F8] transition-colors">
                    <td className="py-2.5 px-3 sm:px-4 text-[#6B6B63] font-mono text-[11px]">
                      {formatDate(m.created_at)}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 font-mono font-bold text-blue-700">
                      {m.reference}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 font-bold text-[#1C1C1A]">
                      {m.product_name}
                      {m.product_sku && <div className="text-[10px] text-[#6B6B63] font-mono">SKU: {m.product_sku}</div>}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4">{getTypeTag(m.type)}</td>
                    <td className="py-2.5 px-3 sm:px-4 text-[#2D2D2A]">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-[#6B6B63]">{m.origin_location_name || '-'}</span>
                        <span className="text-[#A8A89E]">➔</span>
                        <span className="text-emerald-700 font-semibold">{m.destination_location_name || '-'}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-center font-mono">
                      {m.lot_number ? (
                        <span className="px-2 py-0.5 bg-[#F7F7F5] border border-[#E2E2DC] text-[#1C1C1A] rounded text-[11px]">
                          {m.lot_number}
                        </span>
                      ) : (
                        <span className="text-[#A8A89E]">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right font-bold text-[#1C1C1A]">
                      {m.qty}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-[#6B6B63] text-[11px]">
                      {formatCurrency(m.unit_cost)}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-center">{getStatusBadge(m.status)}</td>
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
              Menampilkan {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, sortedMoves.length)} dari {sortedMoves.length} mutasi (Halaman {currentPage} dari {totalPages})
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
