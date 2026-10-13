'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate } from '@/lib/timeUtils'
import { QuarantineReturnItem } from '../types'

export default function PendingReturnsTab() {
  const { activeBusiness } = useUserContext()
  const [moves, setMoves] = useState<QuarantineReturnItem[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved'>('all')

  const loadReturns = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMsg(null)
      const res = await fetch('/api/inventory/returns')
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Gagal memuat data retur (Status: ${res.status})`)
      
      setMoves(Array.isArray(json) ? json : [])
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReturns()
  }, [loadReturns])

  const handleAction = async (moveId: string, action: 'terima' | 'hilang') => {
    const actionLabel = action === 'terima' ? 'DITERIMA DI GUDANG UTAMA' : 'HILANG / RUSAK'
    if (!window.confirm(`Yakin ingin memproses barang ini sebagai ${actionLabel}?`)) return

    setProcessingId(moveId)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/inventory/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moveId, action })
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Gagal memproses retur (Status: ${res.status})`)

      setSuccessMsg(json?.message || 'Aksi berhasil diproses')
      await loadReturns()
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setProcessingId(null)
    }
  }

  // Filtered rows for fast view switching (Semua / Menunggu Verifikasi / Selesai)
  const filteredMoves = useMemo(() => {
    if (statusFilter === 'pending') return moves.filter(m => m.is_actionable)
    if (statusFilter === 'resolved') return moves.filter(m => !m.is_actionable)
    return moves
  }, [moves, statusFilter])

  const pendingCount = useMemo(() => moves.filter(m => m.is_actionable).length, [moves])
  const resolvedCount = useMemo(() => moves.filter(m => !m.is_actionable).length, [moves])

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-[#E2E2DC] shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-extrabold text-[#1C1C1A]">
              Daftar Retur & Karantina
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
              Audit Trail Permanen
            </span>
          </div>
          <p className="text-xs text-[#6B6B63] mt-0.5">
            Daftar terpadu barang dari pesanan batal/retur. Semua pergerakan tersimpan permanen dan status terverifikasi langsung dari database.
          </p>
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto bg-[#F7F7F5] p-1 rounded-lg border border-[#E2E2DC] text-xs">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white text-[#1C1C1A] shadow-2xs border border-[#E2E2DC]'
                : 'text-[#6B6B63] hover:text-[#1C1C1A]'
            }`}
          >
            Semua ({moves.length})
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1 ${
              statusFilter === 'pending'
                ? 'bg-amber-100 text-amber-900 shadow-2xs border border-amber-300'
                : 'text-amber-800 hover:text-amber-900'
            }`}
          >
            <span>⏳ Menunggu</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-extrabold">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setStatusFilter('resolved')}
            className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
              statusFilter === 'resolved'
                ? 'bg-emerald-100 text-emerald-900 shadow-2xs border border-emerald-300'
                : 'text-emerald-800 hover:text-emerald-900'
            }`}
          >
            ✓ Selesai ({resolvedCount})
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 text-rose-700 p-3.5 rounded-xl border border-rose-200 text-xs font-semibold flex items-center gap-2">
          <span>⚠️</span>
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 text-emerald-800 p-3.5 rounded-xl border border-emerald-200 text-xs font-semibold flex items-center gap-2">
          <span>✅</span>
          <span>{successMsg}</span>
        </div>
      )}

      {/* Unified Table */}
      <div className="overflow-x-auto bg-white rounded-xl shadow-xs border border-[#E2E2DC]">
        <table className="min-w-full text-left text-xs text-[#2D2D2A]">
          <thead className="bg-[#F7F7F5] text-[11px] font-bold text-[#6B6B63] uppercase border-b border-[#E2E2DC]">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">TANGGAL RETUR</th>
              <th className="px-4 py-3">NO. REFERENSI</th>
              <th className="px-4 py-3">PRODUK</th>
              <th className="px-4 py-3 text-right">QTY RETUR</th>
              <th className="px-4 py-3 text-center">STATUS</th>
              <th className="px-4 py-3 text-center">TINDAKAN / RIWAYAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E2DC]">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[#82827A]">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <span>Memuat data retur & karantina...</span>
                  </div>
                </td>
              </tr>
            ) : filteredMoves.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[#82827A]">
                  {statusFilter === 'pending'
                    ? 'Tidak ada barang retur yang menunggu verifikasi.'
                    : statusFilter === 'resolved'
                    ? 'Belum ada barang retur yang telah diselesaikan.'
                    : 'Belum ada data barang retur atau pesanan batal.'}
                </td>
              </tr>
            ) : (
              filteredMoves.map((m) => {
                const statusBadge =
                  m.status === 'received'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : m.status === 'lost'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-amber-50 text-amber-800 border-amber-300'

                const statusIcon =
                  m.status === 'received'
                    ? '✓'
                    : m.status === 'lost'
                    ? '✕'
                    : '⏳'

                return (
                  <tr key={m.move_id} className="hover:bg-[#F9F9F8] transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-[#6B6B63]">
                      {formatDisplayDate(m.return_date, 'datetime', activeBusiness?.timezone)}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[#1C1C1A]">
                      {m.reference}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#1C1C1A]">{m.product_name}</div>
                      {m.product_sku && (
                        <div className="text-[10px] text-[#6B6B63] font-mono mt-0.5">
                          SKU: {m.product_sku}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[#1C1C1A] whitespace-nowrap">
                      {m.return_qty}{' '}
                      <span className="text-[10px] font-normal text-[#82827A]">
                        {m.product_unit || 'Pcs'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${statusBadge}`}
                      >
                        <span>{statusIcon}</span>
                        <span>{m.status_label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {m.is_actionable ? (
                        <div className="flex gap-2 justify-center items-center">
                          <button
                            disabled={processingId === m.move_id}
                            onClick={() => handleAction(m.move_id, 'terima')}
                            className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all shadow-2xs cursor-pointer disabled:opacity-50"
                            title="Terima barang fisik ke rak Gudang Utama dan tambahkan ke stok aktif siap jual"
                          >
                            {processingId === m.move_id ? '...' : 'Terima & Jual'}
                          </button>
                          <button
                            disabled={processingId === m.move_id}
                            onClick={() => handleAction(m.move_id, 'hilang')}
                            className="px-3 py-1.5 text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                            title="Barang rusak atau hilang di ekspedisi: Hapus dari karantina dan bukukan jurnal kerugian"
                          >
                            {processingId === m.move_id ? '...' : 'Hilang / Rusak'}
                          </button>
                        </div>
                      ) : (
                        <div className="text-left text-[11px] text-[#6B6B63] space-y-0.5 max-w-[220px] mx-auto">
                          <div className="font-medium text-[#1C1C1A]">
                            {m.status === 'received' ? 'Masuk ke Gudang Utama' : 'Dicatat Beban Kerugian'}
                          </div>
                          {m.resolved_at && (
                            <div className="text-[10px] text-[#82827A]">
                              {formatDisplayDate(m.resolved_at, 'datetime', activeBusiness?.timezone)}
                            </div>
                          )}
                          {m.resolution_reference && (
                            <div className="text-[9px] font-mono text-[#82827A] truncate" title={m.resolution_reference}>
                              Ref: {m.resolution_reference}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
