"use client"
import React, { useState } from 'react'
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
  const [pageSize, setPageSize] = useState(25)

  const filteredMoves = moves.filter(m => {
    const matchesSearch =
      !searchQuery ||
      (m.product_name && m.product_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (m.reference && m.reference.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (m.lot_number && m.lot_number.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesStatus = statusFilter === 'all' || m.status === statusFilter

    const matchesLot = !lotFilter || (m.lot_number && m.lot_number.toLowerCase().includes(lotFilter.toLowerCase()))

    return matchesSearch && matchesStatus && matchesLot
  })

  // Pagination for low-end device optimization
  const totalPages = Math.ceil(filteredMoves.length / pageSize) || 1
  const paginatedMoves = filteredMoves.slice((currentPage - 1) * pageSize, currentPage * pageSize)

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
              className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
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
            onChange={e => {
              setPageSize(Number(e.target.value))
              setCurrentPage(1)
            }}
            className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded px-2 py-1 focus:outline-none"
          >
            <option value={15}>15 baris</option>
            <option value={25}>25 baris</option>
            <option value={50}>50 baris</option>
          </select>
        </div>
      </div>

      {/* Move History Table */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-left text-xs text-[#2D2D2A] min-w-[700px]">
            <thead className="bg-[#F7F7F5] text-[#6B6B63] uppercase tracking-wider font-bold border-b border-[#E2E2DC]">
              <tr>
                <th className="py-2.5 px-3 sm:px-4">Waktu</th>
                <th className="py-2.5 px-3 sm:px-4">No. Referensi</th>
                <th className="py-2.5 px-3 sm:px-4">Nama Produk</th>
                <th className="py-2.5 px-3 sm:px-4">Tipe Mutasi</th>
                <th className="py-2.5 px-3 sm:px-4">Asal ➔ Tujuan</th>
                <th className="py-2.5 px-3 sm:px-4 text-center">Lot / Batch</th>
                <th className="py-2.5 px-3 sm:px-4 text-right">Jumlah</th>
                <th className="py-2.5 px-3 sm:px-4 text-right">Harga Unit</th>
                <th className="py-2.5 px-3 sm:px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#82827A]">
                    Memuat riwayat mutasi stok...
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
