'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { PageLayout } from '@/components/ui/PageLayout'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'
import { exportJsonToFile } from '@/lib/fileExporter'
import PendingReturnsTab from '@/plugins/inventory-reports/components/PendingReturnsTab'
import { RMA_REASON_MAP, RmaRequestRecord } from '@/lib/rma/types'
import { RmaDetailModal } from './components/RmaDetailModal'

type StageTab =
  | 'all'
  | 'awaiting_parcel'
  | 'needs_qc'
  | 'ready_settle'
  | 'settled'
  | 'quarantine_bin'

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Math.round(Number(val) || 0))

export default function RmaHubPage() {
  const { activeBusiness } = useUserContext()
  const businessId = activeBusiness?.id
  const timezone = (activeBusiness as any)?.timezone || DEFAULT_TIMEZONE

  const [stageTab, setStageTab] = useState<StageTab>('all')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [rmas, setRmas] = useState<RmaRequestRecord[]>([])
  const [summary, setSummary] = useState({
    awaiting_parcel: 0,
    needs_qc: 0,
    ready_settle: 0,
    settled: 0,
    total_net_credit: 0,
    top_reason: null as { code: string; count: number } | null
  })
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [selectedRma, setSelectedRma] = useState<RmaRequestRecord | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchRmas = useCallback(async () => {
    if (stageTab === 'quarantine_bin') return
    setLoading(true)
    setErrorMsg(null)
    try {
      const params = new URLSearchParams()
      if (businessId) params.set('business_id', businessId)
      if (stageTab !== 'all') params.set('stage', stageTab)
      if (debouncedSearch) params.set('search', debouncedSearch)

      const res = await fetch(`/api/rma?${params.toString()}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || `Gagal memuat daftar RMA (Status: ${res.status})`)
      }

      const list: RmaRequestRecord[] = Array.isArray(json?.rmas) ? json.rmas : []
      setRmas(list)
      if (json?.summary) {
        setSummary(json.summary)
      }
      setSelectedRma((prev) => (prev ? list.find((x) => x.id === prev.id) || null : null))
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }, [businessId, stageTab, debouncedSearch])

  // Immediate page fetching on mount (AGENTS.md Performance Rule 6)
  useEffect(() => {
    fetchRmas()
  }, [fetchRmas])

  const handleExportExcel = () => {
    if (rmas.length === 0) return
    const rows = rmas.map((r) => ({
      'No. RMA': r.rma_number,
      Tanggal: formatDisplayDate(r.created_at, 'datetime', timezone),
      'No. Pesanan / Invoice': r.orders?.order_number || '-',
      Pelanggan: r.orders?.customers?.name || 'Umum',
      Saluran: r.channel,
      Alasan: RMA_REASON_MAP[r.reason_code]?.label || r.reason_code,
      'Status Fisik Gudang': r.fulfillment_stage,
      'Status Keuangan': r.settlement_stage,
      'Metode Penyelesaian': r.settlement_method || '-',
      'Nilai Kredit Bersih (IDR)': Number(r.net_credit_amount || 0),
      'Potong Piutang Invoice (IDR)': Number(r.credit_memo_amount || 0),
      'Refund Kas/Bank (IDR)': Number(r.refund_paid_amount || 0),
      'Saldo Kredit Toko (IDR)': Number(r.store_credit_issued || 0)
    }))

    exportJsonToFile({
      fileName: `Laporan_RMA_${new Date().toISOString().split('T')[0]}`,
      format: 'xlsx',
      sheets: [{ sheetName: 'Daftar RMA', rows }]
    })
  }

  return (
    <PageLayout
      title="Pusat Retur, Nota Kredit & RMA"
      description="Kelola tiket komplain pelanggan, verifikasi fisik gudang (karantina vs masuk rak), klaim supplier, dan potongan tagihan Invoice secara terpadu."
      width="xl"
      mobileBackFallback="/onboarding"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/orders"
            className="px-3.5 py-2 text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl shadow-2xs transition"
          >
            + Dari Daftar Orders
          </Link>
          <Link
            href="/orders/invoices"
            className="px-3.5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-2xs transition"
          >
            + Buat Nota Kredit Invoice
          </Link>
        </div>
      }
    >
      <div className="space-y-5 min-w-0">
        {/* 4 Responsive KPI Cards (page-layout-ux Rule 2.1: sm:grid-cols-2 xl:grid-cols-4) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-2xs min-w-0 overflow-hidden">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Menunggu Paket Kurir
            </div>
            <div className="text-xl 2xl:text-2xl font-black text-slate-900 mt-1 tabular-nums truncate">
              {summary.awaiting_parcel} Tiket
            </div>
            <div className="text-[11px] text-slate-400 mt-1 truncate">
              Stok & kas aman belum berubah
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-2xs min-w-0 overflow-hidden">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
              Siap Penyelesaian / Kredit
            </div>
            <div className="text-xl 2xl:text-2xl font-black text-amber-700 mt-1 tabular-nums truncate">
              {summary.ready_settle} Dokumen
            </div>
            <div className="text-[11px] text-slate-400 mt-1 truncate">
              Perlu potong tagihan / refund
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-2xs min-w-0 overflow-hidden">
            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
              Total Nilai Retur / Kredit
            </div>
            <div
              className="text-xl 2xl:text-2xl font-black text-slate-900 mt-1 tabular-nums truncate"
              title={formatIDR(summary.total_net_credit)}
            >
              {formatIDR(summary.total_net_credit)}
            </div>
            <div className="text-[11px] text-emerald-700 font-semibold mt-1 truncate">
              {summary.settled} RMA selesai dijurnal
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-2xs min-w-0 overflow-hidden">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Alasan Retur Terbanyak
            </div>
            <div className="text-sm xl:text-base font-extrabold text-slate-900 mt-1.5 truncate">
              {summary.top_reason
                ? RMA_REASON_MAP[summary.top_reason.code]?.label || summary.top_reason.code
                : 'Belum ada data'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 truncate">
              {summary.top_reason
                ? `${summary.top_reason.count} kejadian tercatat`
                : 'Evaluasi kualitas & ukuran'}
            </div>
          </div>
        </div>

        {/* 2-Row Toolbar to prevent horizontal clipping on 13-14" laptops (page-layout-ux Rule 2.3) */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs space-y-3 min-w-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {[
              { id: 'all', label: 'Semua Tiket RMA' },
              { id: 'awaiting_parcel', label: `Menunggu Paket (${summary.awaiting_parcel})` },
              { id: 'ready_settle', label: `Siap Refund / Kredit (${summary.ready_settle})` },
              { id: 'settled', label: `Selesai (${summary.settled})` },
              { id: 'quarantine_bin', label: '📦 Antrean Fisik Karantina' }
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setStageTab(t.id as StageTab)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                  stageTab === t.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {stageTab !== 'quarantine_bin' && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari No. RMA, No. Resi Balik, atau catatan..."
                className="w-full sm:w-80 text-xs border border-slate-300 rounded-xl px-3.5 py-2 bg-slate-50 focus:bg-white"
              />
              <button
                type="button"
                disabled={rmas.length === 0}
                onClick={handleExportExcel}
                className="px-3.5 py-2 text-xs font-bold bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 border border-slate-200 rounded-xl cursor-pointer"
              >
                📥 Export Excel (.xlsx)
              </button>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
            ⚠️ {errorMsg}
          </div>
        )}

        {stageTab === 'quarantine_bin' ? (
          <PendingReturnsTab />
        ) : (
          <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0">
            {/* Desktop Table (hidden md:table) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-3.5 px-5">No. RMA & Tanggal</th>
                    <th className="py-3.5 px-4">Pesanan / Pelanggan</th>
                    <th className="py-3.5 px-4">Alasan & Item</th>
                    <th className="py-3.5 px-4">Status Gudang</th>
                    <th className="py-3.5 px-4">Penyelesaian</th>
                    <th className="py-3.5 px-4 text-right">Nilai Kredit</th>
                    <th className="py-3.5 px-5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        Memuat daftar RMA...
                      </td>
                    </tr>
                  ) : rmas.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        Belum ada dokumen RMA pada filter ini. Buka Pesanan atau Invoice untuk membuat tiket RMA / Nota Kredit.
                      </td>
                    </tr>
                  ) : (
                    rmas.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3.5 px-5">
                          <div className="font-mono font-black text-slate-900">{r.rma_number}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {formatDisplayDate(r.created_at, 'datetime', timezone)}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-blue-700">
                            #{r.orders?.order_number || '-'}
                          </div>
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            {r.orders?.customers?.name || 'Pelanggan Umum'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          <div className="font-bold text-slate-800 truncate">
                            {RMA_REASON_MAP[r.reason_code]?.label || r.reason_code}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {(r.rma_items || []).map((i) => `${i.name} x${i.qty}`).join(', ')}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                              r.fulfillment_stage === 'inspected'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : r.fulfillment_stage === 'received_quarantine'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {r.fulfillment_stage === 'inspected'
                              ? '✓ Selesai QC'
                              : r.fulfillment_stage === 'received_quarantine'
                              ? '📦 Di Karantina'
                              : '⏳ Tunggu Paket'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                              r.settlement_stage === 'settled'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                          >
                            {r.settlement_stage === 'settled'
                              ? r.credit_memo_amount > 0
                                ? '✓ Nota Kredit'
                                : r.store_credit_issued > 0
                                ? '✓ Saldo Kredit'
                                : '✓ Refund Lunas'
                              : 'Belum Diselesaikan'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-black text-slate-900 tabular-nums">
                          {formatIDR(Number(r.net_credit_amount || 0))}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedRma(r)}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer"
                          >
                            Proses / Detail
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Interactive Cards (block md:hidden — mobile-modal-ux Rule 7) */}
            <div className="block md:hidden divide-y divide-slate-100">
              {loading ? (
                <div className="p-8 text-center text-xs text-slate-400">Memuat daftar RMA...</div>
              ) : rmas.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  Belum ada dokumen RMA pada filter ini.
                </div>
              ) : (
                rmas.map((r) => (
                  <div key={r.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-black text-xs text-slate-900">
                          {r.rma_number}
                        </div>
                        <div className="text-[11px] font-bold text-blue-700">
                          #{r.orders?.order_number || '-'} • {r.orders?.customers?.name || 'Umum'}
                        </div>
                      </div>
                      <div className="font-black text-sm text-slate-900 tabular-nums">
                        {formatIDR(Number(r.net_credit_amount || 0))}
                      </div>
                    </div>

                    <div className="text-xs text-slate-600">
                      {RMA_REASON_MAP[r.reason_code]?.label || r.reason_code} —{' '}
                      {(r.rma_items || []).map((i) => `${i.name} x${i.qty}`).join(', ')}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedRma(r)}
                      className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-extrabold text-xs cursor-pointer"
                    >
                      Buka & Proses RMA
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <RmaDetailModal
        isOpen={Boolean(selectedRma)}
        onClose={() => setSelectedRma(null)}
        rma={selectedRma}
        onUpdated={fetchRmas}
      />
    </PageLayout>
  )
}

