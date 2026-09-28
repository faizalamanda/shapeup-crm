"use client"
import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { StockReportItem, StockMove, PaginationMeta } from '../types'

interface ProductDetailModalProps {
  productId: string | null
  initialStockItem: StockReportItem | null
  onClose: () => void
}

type ModalTab = 'details' | 'valuation' | 'moves'

export default function ProductDetailModal({
  productId,
  initialStockItem,
  onClose,
}: ProductDetailModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('details')

  // Tab 2 (Valuation) state & loader
  const [valuationData, setValuationData] = useState<any>(null)
  const [loadingValuation, setLoadingValuation] = useState(false)
  const [errorValuation, setErrorValuation] = useState<string | null>(null)

  // Tab 3 (Moves) state, loader & pagination controls
  const [moves, setMoves] = useState<StockMove[] | null>(null)
  const [movesLimit, setMovesLimit] = useState<number>(50)
  const [movesPage, setMovesPage] = useState<number>(1)
  const [movesMeta, setMovesMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 50,
    totalItems: 0,
    totalPages: 1,
  })
  const [loadingMoves, setLoadingMoves] = useState(false)
  const [errorMoves, setErrorMoves] = useState<string | null>(null)

  // Prevent background scrolling while modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  // Lazy load Tab 2 (Valuation) data ONLY when Tab 2 is selected
  useEffect(() => {
    if (activeTab === 'valuation' && !valuationData && !loadingValuation && productId) {
      setLoadingValuation(true)
      setErrorValuation(null)
      const unitCost = initialStockItem?.unitCost ?? 0
      const onHandQty = initialStockItem?.onHandQty ?? 0
      fetch(`/api/inventory/reports?action=product_valuation&productId=${productId}&unitCost=${unitCost}&onHandQty=${onHandQty}`)
        .then(res => res.json())
        .then(json => {
          if (json.success && json.valuation) {
            setValuationData(json.valuation)
          } else {
            setErrorValuation(json.error || 'Gagal memuat valuasi persediaan')
          }
        })
        .catch(err => setErrorValuation(err.message || 'Gagal memuat valuasi persediaan'))
        .finally(() => setLoadingValuation(false))
    }
  }, [activeTab, valuationData, loadingValuation, productId, initialStockItem])

  // ⚡ Fast Indexed Fetch for Move History
  const fetchMoveHistory = useCallback(
    async (targetPage = movesPage, targetLimit = movesLimit) => {
      if (!productId) return
      try {
        setLoadingMoves(true)
        setErrorMoves(null)

        const res = await fetch(`/api/inventory/reports?action=product_moves&productId=${productId}&page=${targetPage}&limit=${targetLimit}`)
        const json = await res.json()

        if (json.success && json.moves) {
          setMoves(json.moves)
          if (json.pagination) {
            setMovesMeta(json.pagination)
          }
        } else {
          setErrorMoves(json.error || 'Gagal memuat mutasi stok')
        }
      } catch (err: any) {
        setErrorMoves(err.message || 'Gagal memuat mutasi stok')
      } finally {
        setLoadingMoves(false)
      }
    },
    [productId, movesPage, movesLimit]
  )

  // Trigger fetch when tab moves is opened or limit/page changes
  useEffect(() => {
    if (activeTab === 'moves' && productId) {
      fetchMoveHistory(movesPage, movesLimit)
    }
  }, [activeTab, movesPage, movesLimit, productId, fetchMoveHistory])

  const handleLimitChange = (newLimit: number) => {
    setMovesLimit(newLimit)
    setMovesPage(1)
  }

  if (!productId || !initialStockItem) return null

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0)

  const formatNumber = (val: number) => (val || 0).toLocaleString('id-ID')

  const prodName = initialStockItem.productName
  const sku = initialStockItem.sku || '-'
  const category = initialStockItem.categoryName || 'Tanpa Kategori'
  const unit = initialStockItem.unit || 'Pcs'

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E2E2DC] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-[#E2E2DC] flex items-center justify-between bg-[#F7F7F5]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold shrink-0">
              📦
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-extrabold text-[#1C1C1A] tracking-tight">
                  {prodName}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  {category}
                </span>
              </div>
              <p className="text-xs text-[#6B6B63] mt-0.5 font-mono">
                SKU: <span className="font-semibold text-[#1C1C1A]">{sku}</span> | Satuan: {unit}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#EAEAEA] hover:bg-[#DEDED8] text-[#1C1C1A] flex items-center justify-center transition-colors cursor-pointer text-sm font-bold shrink-0"
            title="Tutup Modal"
          >
            ✕
          </button>
        </div>

        {/* Top Summary Cards Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-[#FAFAFA] border-b border-[#E2E2DC]">
          <div className="bg-white p-3 rounded-xl border border-[#E2E2DC] shadow-2xs">
            <div className="text-[10px] font-semibold text-[#6B6B63] uppercase">Stok Fisik (On Hand)</div>
            <div className="text-base font-bold text-[#1C1C1A] mt-0.5">
              {formatNumber(initialStockItem.onHandQty)}{' '}
              <span className="text-xs font-normal text-[#82827A]">{unit}</span>
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-emerald-200 shadow-2xs">
            <div className="text-[10px] font-semibold text-emerald-800 uppercase">Stok Tersedia</div>
            <div className="text-base font-bold text-emerald-700 mt-0.5">
              {formatNumber(initialStockItem.availableQty)}{' '}
              <span className="text-xs font-normal text-emerald-600">{unit}</span>
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-blue-200 shadow-2xs">
            <div className="text-[10px] font-semibold text-blue-800 uppercase">Harga Modal (Cost)</div>
            <div className="text-base font-bold text-blue-700 mt-0.5">
              {formatCurrency(initialStockItem.unitCost)}
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-indigo-200 shadow-2xs">
            <div className="text-[10px] font-semibold text-indigo-800 uppercase">Total Nilai Stok</div>
            <div className="text-base font-bold text-indigo-700 mt-0.5">
              {formatCurrency(initialStockItem.totalValue)}
            </div>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex border-b border-[#E2E2DC] bg-white px-4">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'details'
                ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                : 'border-transparent text-[#6B6B63] hover:text-[#1C1C1A]'
            }`}
          >
            📋 Detail Keterangan
          </button>
          <button
            onClick={() => setActiveTab('valuation')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'valuation'
                ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                : 'border-transparent text-[#6B6B63] hover:text-[#1C1C1A]'
            }`}
          >
            <span>💰 Penilaian Stok (Valuation)</span>
            {loadingValuation && (
              <span className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('moves')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'moves'
                ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                : 'border-transparent text-[#6B6B63] hover:text-[#1C1C1A]'
            }`}
          >
            <span>📜 Riwayat Move History</span>
            {loadingMoves && (
              <span className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            )}
            {movesMeta.totalItems > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-700 font-extrabold">
                {movesMeta.totalItems}
              </span>
            )}
          </button>
        </div>

        {/* Modal Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 min-h-[240px]">
          {/* TAB 1: DETAIL KETERANGAN (Instant Load - 0ms!) */}
          {activeTab === 'details' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl p-4">
                <h4 className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-3">
                  Informasi Utama Produk
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-xs">
                  <div>
                    <span className="text-[#6B6B63]">Nama Produk:</span>
                    <div className="font-bold text-[#1C1C1A]">{prodName}</div>
                  </div>

                  <div>
                    <span className="text-[#6B6B63]">SKU (Kode Barang):</span>
                    <div className="font-bold text-[#1C1C1A] font-mono">{sku}</div>
                  </div>

                  <div>
                    <span className="text-[#6B6B63]">Kategori:</span>
                    <div className="font-bold text-[#1C1C1A]">{category}</div>
                  </div>

                  <div>
                    <span className="text-[#6B6B63]">Satuan Unit:</span>
                    <div className="font-bold text-[#1C1C1A]">{unit}</div>
                  </div>

                  <div>
                    <span className="text-[#6B6B63]">Harga Modal (Cost Price):</span>
                    <div className="font-extrabold text-blue-700 font-mono">
                      {formatCurrency(initialStockItem.unitCost)}
                    </div>
                  </div>

                  <div>
                    <span className="text-[#6B6B63]">Harga Jual (Selling Price):</span>
                    <div className="font-extrabold text-emerald-700 font-mono">
                      {formatCurrency(initialStockItem.price || 0)}
                    </div>
                  </div>

                  <div>
                    <span className="text-[#6B6B63]">Tipe HPP:</span>
                    <div className="font-semibold text-[#1C1C1A] capitalize">
                      {initialStockItem.hppType || 'fixed'}
                    </div>
                  </div>

                  <div>
                    <span className="text-[#6B6B63]">Total Nilai Inventori:</span>
                    <div className="font-extrabold text-indigo-700 font-mono">
                      {formatCurrency(initialStockItem.totalValue)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Stock Breakdown */}
              <div className="bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl p-4">
                <h4 className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-3">
                  Rincian Stok Persediaan
                </h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-white p-3 rounded-lg border border-[#E2E2DC]">
                    <div className="text-[10px] text-[#6B6B63]">Stok Fisik (On Hand)</div>
                    <div className="text-sm font-bold text-[#1C1C1A] mt-0.5">
                      {formatNumber(initialStockItem.onHandQty)} {unit}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-emerald-200">
                    <div className="text-[10px] text-emerald-700">Tersedia untuk Dijual</div>
                    <div className="text-sm font-bold text-emerald-700 mt-0.5">
                      {formatNumber(initialStockItem.availableQty)} {unit}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-amber-200">
                    <div className="text-[10px] text-amber-700">Terpesan (Reserved)</div>
                    <div className="text-sm font-bold text-amber-700 mt-0.5">
                      {formatNumber(initialStockItem.reservedQty)} {unit}
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl p-4">
                <h4 className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-2">
                  Keterangan / Deskripsi Produk
                </h4>
                <p className="text-xs text-[#6B6B63] leading-relaxed">
                  {initialStockItem.description || 'Tidak ada deskripsi tambahan untuk produk ini.'}
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: VALUATION (Lazy Loaded on Click) */}
          {activeTab === 'valuation' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              {loadingValuation ? (
                <div className="py-12 text-center text-[#82827A] flex flex-col items-center justify-center gap-2">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-medium">Menghitung valuasi stok produk (FIFO/LIFO/AVCO)...</span>
                </div>
              ) : errorValuation ? (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-xs font-medium">
                  ⚠️ {errorValuation}
                </div>
              ) : (
                <>
                  <div className="text-xs text-[#6B6B63]">
                    Perbandingan penilaian stok produk <strong>{prodName}</strong> berdasarkan metode akuntansi standar:
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { key: 'fifo', name: 'FIFO (First-In First-Out)', data: valuationData?.fifo },
                      { key: 'lifo', name: 'LIFO (Last-In First-Out)', data: valuationData?.lifo },
                      { key: 'avco', name: 'AVCO (Weighted Average)', data: valuationData?.avco },
                      { key: 'standard', name: 'Standard Cost (Harga Modal)', data: valuationData?.standard },
                    ].map(v => {
                      const itemVal = v.data?.itemBreakdown?.[0]
                      return (
                        <div key={v.key} className="bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl p-4">
                          <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-2 mb-2">
                            <span className="text-xs font-extrabold text-[#1C1C1A]">{v.name}</span>
                          </div>

                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="text-[#6B6B63]">Harga Unit Cost:</span>
                              <span className="font-bold text-[#1C1C1A] font-mono">
                                {formatCurrency(itemVal?.unitCostCalculated || initialStockItem.unitCost)}
                              </span>
                            </div>

                            <div className="flex justify-between">
                              <span className="text-[#6B6B63]">Total Valuasi Stok:</span>
                              <span className="font-extrabold text-blue-700 font-mono">
                                {formatCurrency(itemVal?.totalValueCalculated || initialStockItem.totalValue)}
                              </span>
                            </div>

                            <div className="flex justify-between pt-1 border-t border-[#E2E2DC]">
                              <span className="text-[#6B6B63]">Selisih vs Standard:</span>
                              <span
                                className={`font-bold font-mono ${
                                  (itemVal?.varianceVsStandard || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                }`}
                              >
                                {(itemVal?.varianceVsStandard || 0) >= 0 ? '+' : ''}
                                {formatCurrency(itemVal?.varianceVsStandard || 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 3: MOVE HISTORY (Ultra-Fast & Paginated) */}
          {activeTab === 'moves' && (
            <div className="space-y-3 animate-in fade-in duration-100">
              {/* Controls bar: Limit selector & Refresh */}
              <div className="flex items-center justify-between gap-2 bg-[#F7F7F5] p-2.5 rounded-xl border border-[#E2E2DC] text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#1C1C1A]">Tampilkan:</span>
                  <select
                    value={movesLimit}
                    onChange={e => handleLimitChange(Number(e.target.value))}
                    className="bg-white border border-[#E2E2DC] rounded px-2 py-1 text-xs font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value={20}>20 baris</option>
                    <option value={50}>50 baris</option>
                    <option value={100}>100 baris</option>
                    <option value={200}>200 baris</option>
                  </select>
                </div>

                <div className="text-[11px] text-[#6B6B63]">
                  Total {movesMeta.totalItems} transaksi mutasi ditemukan
                </div>
              </div>

              {loadingMoves ? (
                <div className="py-12 text-center text-[#82827A] flex flex-col items-center justify-center gap-2">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-medium">Memuat mutasi stok terindeks (~10ms)...</span>
                </div>
              ) : errorMoves ? (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-xs font-medium">
                  ⚠️ {errorMoves}
                </div>
              ) : !moves || moves.length === 0 ? (
                <div className="py-10 text-center text-[#82827A] border border-dashed border-[#E2E2DC] rounded-xl text-xs">
                  Belum ada catatan mutasi atau pergerakan stok untuk produk ini.
                </div>
              ) : (
                <div className="border border-[#E2E2DC] rounded-xl overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-[#2D2D2A]">
                      <thead className="bg-[#F7F7F5] text-[#6B6B63] uppercase tracking-wider font-bold border-b border-[#E2E2DC]">
                        <tr>
                          <th className="py-2.5 px-3">Waktu</th>
                          <th className="py-2.5 px-3">No. Referensi</th>
                          <th className="py-2.5 px-3">Tipe Mutasi</th>
                          <th className="py-2.5 px-3">Asal / Tujuan</th>
                          <th className="py-2.5 px-3 text-right">Qty</th>
                          <th className="py-2.5 px-3 text-right">Harga Unit</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E2DC]">
                        {moves.map(m => {
                          const typeBadge =
                            m.type === 'receipt'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : m.type === 'delivery'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : m.type === 'adjustment'
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-slate-50 text-slate-700 border-slate-200'

                          const typeLabel =
                            m.type === 'receipt'
                              ? 'Penerimaan'
                              : m.type === 'delivery'
                              ? 'Pengiriman'
                              : m.type === 'adjustment'
                              ? 'Opname'
                              : 'Transfer'

                          return (
                            <tr key={m.id} className="hover:bg-[#F9F9F8]">
                              <td className="py-2 px-3 text-[11px] text-[#6B6B63] whitespace-nowrap">
                                {new Date(m.created_at).toLocaleString('id-ID', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </td>
                              <td className="py-2 px-3 font-mono font-bold text-[#1C1C1A]">
                                {m.reference}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${typeBadge}`}
                                >
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-[11px] text-[#6B6B63]">
                                {m.origin_location_name || 'System'} &rarr;{' '}
                                {m.destination_location_name || 'System'}
                              </td>
                              <td className="py-2 px-3 text-right font-bold text-[#1C1C1A]">
                                {m.type === 'receipt' ? `+${m.qty}` : m.type === 'delivery' ? `-${m.qty}` : m.qty}{' '}
                                <span className="text-[10px] text-[#82827A] font-normal">{unit}</span>
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-[11px] text-[#2D2D2A]">
                                {formatCurrency(m.unit_cost)}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    m.status === 'done'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : m.status === 'pending'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {m.status.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Moves Modal Pagination Footer */}
                  {movesMeta.totalPages > 1 && (
                    <div className="p-2.5 border-t border-[#E2E2DC] flex items-center justify-between bg-[#F7F7F5] text-xs">
                      <span className="text-[#6B6B63] text-[11px]">
                        Halaman {movesMeta.page} dari {movesMeta.totalPages}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          disabled={movesPage <= 1 || loadingMoves}
                          onClick={() => setMovesPage(p => Math.max(1, p - 1))}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 rounded text-xs transition-all cursor-pointer"
                        >
                          &larr; Seb.
                        </button>
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-bold text-xs">
                          {movesPage}
                        </span>
                        <button
                          disabled={movesPage >= movesMeta.totalPages || loadingMoves}
                          onClick={() => setMovesPage(p => Math.min(movesMeta.totalPages, p + 1))}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-[#E2E2DC] disabled:opacity-40 rounded text-xs transition-all cursor-pointer"
                        >
                          Lanjut &rarr;
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-[#E2E2DC] flex items-center justify-end bg-[#F7F7F5]">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-[#1C1C1A] text-xs font-bold transition-all cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof window === 'undefined') return null
  return createPortal(modalContent, document.body)
}
