'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate } from '@/lib/timeUtils'
import { invalidatePosCatalogCache } from '@/lib/posCatalogStore'
import { QuarantineReturnItem } from '../types'

export default function PendingReturnsTab() {
  const { activeBusiness } = useUserContext()
  const businessId = activeBusiness?.id
  const [moves, setMoves] = useState<QuarantineReturnItem[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved'>('all')

  const loadReturns = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMsg(null)
      const url = businessId
        ? `/api/inventory/returns?business_id=${encodeURIComponent(businessId)}`
        : '/api/inventory/returns'
      const res = await fetch(url)
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Gagal memuat data retur (Status: ${res.status})`)

      setMoves(Array.isArray(json) ? json : [])
      setSelectedIds(new Set())
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    loadReturns()
  }, [loadReturns])

  const executeQuarantineAction = async (
    targetIds: string[],
    action: 'terima' | 'hilang' | 'rtv'
  ) => {
    if (targetIds.length === 0) return
    const actionLabel =
      action === 'terima'
        ? 'MASUK RAK GUDANG UTAMA (SIAP JUAL)'
        : action === 'rtv'
        ? 'DIKLAIM / DIRETUR KE SUPPLIER (RTV)'
        : 'RUSAK / HILANG (CATAT KERUGIAN)'

    if (
      !window.confirm(
        `Konfirmasi proses ${targetIds.length} item karantina sebagai: ${actionLabel}?`
      )
    ) {
      return
    }

    const isBulk = targetIds.length > 1
    if (isBulk) setBulkProcessing(true)
    else setProcessingId(targetIds[0])

    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/inventory/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId || undefined,
          moveIds: targetIds,
          action
        })
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Gagal memproses retur (Status: ${res.status})`)

      if (action === 'terima' && businessId) {
        invalidatePosCatalogCache(businessId, true)
      }

      setSuccessMsg(json?.message || 'Aksi berhasil diproses')
      await loadReturns()
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setProcessingId(null)
      setBulkProcessing(false)
    }
  }

  const filteredMoves = useMemo(() => {
    if (statusFilter === 'pending') return moves.filter((m) => m.is_actionable)
    if (statusFilter === 'resolved') return moves.filter((m) => !m.is_actionable)
    return moves
  }, [moves, statusFilter])

  const actionableVisibleIds = useMemo(
    () => filteredMoves.filter((m) => m.is_actionable).map((m) => m.move_id),
    [filteredMoves]
  )

  const pendingCount = useMemo(() => moves.filter((m) => m.is_actionable).length, [moves])
  const resolvedCount = useMemo(() => moves.filter((m) => !m.is_actionable).length, [moves])

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllActionable = () => {
    if (actionableVisibleIds.length === 0) return
    const allSelected = actionableVisibleIds.every((id) => selectedIds.has(id))
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(actionableVisibleIds))
    }
  }

  return (
    <div className="space-y-4 min-w-0">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-extrabold text-slate-900">
              Antrean Fisik Karantina Gudang
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
              Varian & HPP Terjaga
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Verifikasi fisik barang retur yang tertahan di ruang karantina sebelum masuk ke stok rak utama, diklaim ke supplier, atau dihapusbukukan.
          </p>
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Semua ({moves.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              statusFilter === 'pending'
                ? 'bg-amber-100 text-amber-900 shadow-2xs border border-amber-300'
                : 'text-amber-800 hover:text-amber-900'
            }`}
          >
            <span>Menunggu QC</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-600 text-white font-extrabold">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('resolved')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              statusFilter === 'resolved'
                ? 'bg-emerald-100 text-emerald-900 shadow-2xs border border-emerald-300'
                : 'text-emerald-800 hover:text-emerald-900'
            }`}
          >
            Selesai ({resolvedCount})
          </button>
        </div>
      </div>

      {/* Bulk 1-Click QC Action Bar (High-Velocity Monday Morning COD Batch Processing) */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-sm">
          <div className="text-xs font-bold">
            ⚡ <span className="font-extrabold">{selectedIds.size} item karantina</span> dipilih — Proses sekaligus dalam 1 klik:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={bulkProcessing}
              onClick={() => executeQuarantineAction(Array.from(selectedIds), 'terima')}
              className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-500 hover:bg-emerald-600 text-white transition cursor-pointer disabled:opacity-50"
            >
              {bulkProcessing ? 'Memproses...' : 'Masuk Rak Utama'}
            </button>
            <button
              type="button"
              disabled={bulkProcessing}
              onClick={() => executeQuarantineAction(Array.from(selectedIds), 'rtv')}
              className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-amber-500 hover:bg-amber-600 text-slate-950 transition cursor-pointer disabled:opacity-50"
            >
              Klaim Supplier (RTV)
            </button>
            <button
              type="button"
              disabled={bulkProcessing}
              onClick={() => executeQuarantineAction(Array.from(selectedIds), 'hilang')}
              className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer disabled:opacity-50"
            >
              Rusak / Hilang
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 text-rose-700 p-3.5 rounded-xl border border-rose-200 text-xs font-semibold flex items-center justify-between gap-2">
          <span>⚠️ {errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-bold px-2">
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 text-emerald-800 p-3.5 rounded-xl border border-emerald-200 text-xs font-semibold flex items-center justify-between gap-2">
          <span>✅ {successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} className="font-bold px-2">
            ✕
          </button>
        </div>
      )}

      {/* Unified Table */}
      <div className="overflow-x-auto bg-white rounded-xl shadow-2xs border border-slate-200/90">
        <table className="min-w-full text-left text-xs text-slate-800">
          <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="py-3.5 px-4 w-10">
                {actionableVisibleIds.length > 0 && (
                  <input
                    type="checkbox"
                    checked={
                      actionableVisibleIds.length > 0 &&
                      actionableVisibleIds.every((id) => selectedIds.has(id))
                    }
                    onChange={toggleSelectAllActionable}
                    className="rounded border-slate-300 cursor-pointer"
                    aria-label="Pilih semua barang karantina yang menunggu verifikasi"
                  />
                )}
              </th>
              <th className="py-3.5 px-4 whitespace-nowrap">Tanggal Masuk</th>
              <th className="py-3.5 px-4">No. Referensi</th>
              <th className="py-3.5 px-4">Produk & Varian</th>
              <th className="py-3.5 px-4 text-right">Qty</th>
              <th className="py-3.5 px-4 text-center">Status</th>
              <th className="py-3.5 px-4 text-center">Keputusan Gudang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <span>Memuat antrean karantina...</span>
                  </div>
                </td>
              </tr>
            ) : filteredMoves.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {statusFilter === 'pending'
                    ? 'Tidak ada barang di ruang karantina yang menunggu pengecekan.'
                    : statusFilter === 'resolved'
                    ? 'Belum ada riwayat barang karantina yang diselesaikan.'
                    : 'Belum ada data barang retur di karantina.'}
                </td>
              </tr>
            ) : (
              filteredMoves.slice(0, 100).map((m) => {
                const statusBadge =
                  m.status === 'received'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : m.status === 'rtv'
                    ? 'bg-orange-50 text-orange-800 border-orange-200'
                    : m.status === 'lost'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-amber-50 text-amber-800 border-amber-300'

                const isSelected = selectedIds.has(m.move_id)
                const busy = processingId === m.move_id || bulkProcessing

                return (
                  <tr
                    key={m.move_id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isSelected ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4">
                      {m.is_actionable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(m.move_id)}
                          className="rounded border-slate-300 cursor-pointer"
                          aria-label={`Pilih ${m.product_name}`}
                        />
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-500">
                      {formatDisplayDate(m.return_date, 'datetime', activeBusiness?.timezone)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {m.reference}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{m.product_name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {m.product_sku && (
                          <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                            SKU: {m.product_sku}
                          </span>
                        )}
                        {m.variant_name && (
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                            Varian: {m.variant_name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-extrabold text-slate-900 tabular-nums whitespace-nowrap">
                      {m.return_qty}{' '}
                      <span className="text-[10px] font-normal text-slate-400">
                        {m.product_unit || 'Pcs'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${statusBadge}`}
                      >
                        {m.status_label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      {m.is_actionable ? (
                        <div className="flex gap-1.5 justify-center items-center flex-wrap">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => executeQuarantineAction([m.move_id], 'terima')}
                            className="px-2.5 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all cursor-pointer disabled:opacity-50"
                            title="Barang layak jual: pindahkan ke rak Gudang Utama (+stok varian aktif)"
                          >
                            Masuk Rak
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => executeQuarantineAction([m.move_id], 'rtv')}
                            className="px-2.5 py-1.5 text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                            title="Barang cacat pabrik: klaim / retur ke Supplier (RTV)"
                          >
                            Klaim Supplier
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => executeQuarantineAction([m.move_id], 'hilang')}
                            className="px-2.5 py-1.5 text-[11px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                            title="Barang rusak parah atau hilang: catat beban kerugian retur (502100)"
                          >
                            Rusak / Hilang
                          </button>
                        </div>
                      ) : (
                        <div className="text-left text-[11px] text-slate-500 space-y-0.5 max-w-[210px] mx-auto">
                          <div className="font-semibold text-slate-800">
                            {m.status === 'received'
                              ? 'Masuk ke Gudang Utama'
                              : m.status === 'rtv'
                              ? 'Diklaim ke Supplier (RTV)'
                              : 'Dicatat Kerugian Retur'}
                          </div>
                          {m.resolved_at && (
                            <div className="text-[10px] text-slate-400">
                              {formatDisplayDate(m.resolved_at, 'datetime', activeBusiness?.timezone)}
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
