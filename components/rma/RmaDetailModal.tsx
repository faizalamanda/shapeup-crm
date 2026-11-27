'use client'

import React, { useState, useEffect, useRef } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'
import { invalidatePosCatalogCache } from '@/lib/posCatalogStore'
import {
  buildRmaWhatsAppMessage,
  RMA_DISPOSITION_MAP,
  RMA_DISPOSITION_OPTIONS,
  RMA_REASON_MAP,
  RmaDisposition,
  RmaRequestRecord,
  RmaSettlementMethod
} from '@/lib/rma/types'

// Client-Side SWR Cache for Stock Moves & Financial Ledger (api-modules Perf Rule 12)
const stockMovesSwrCache = new Map<string, any[]>()
const journalSwrCache = new Map<string, any[]>()

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Math.round(Number(val) || 0))

type Props = {
  isOpen: boolean
  onClose: () => void
  rma: RmaRequestRecord | null
  onUpdated?: () => void
}

export function RmaDetailModal({ isOpen, onClose, rma, onUpdated }: Props) {
  const { activeBusiness } = useUserContext()
  const timezone = (activeBusiness as any)?.timezone || DEFAULT_TIMEZONE
  const businessId = activeBusiness?.id || rma?.business_id

  // Unconditional Hooks at top (mobile-modal-ux Rule 10)
  const prevIsOpenRef = useRef(false)
  const prevRmaIdRef = useRef<string | null>(null)

  const [activeTab, setActiveTab] = useState<'overview' | 'stock_ledger' | 'financial_ledger'>('overview')
  const [itemDispositions, setItemDispositions] = useState<Record<string, Exclude<RmaDisposition, 'pending'>>>({})
  const [courierInput, setCourierInput] = useState('')
  const [resiInput, setResiInput] = useState('')
  const [settlementMethod, setSettlementMethod] = useState<RmaSettlementMethod>('credit_memo')
  const [paymentAccounts, setPaymentAccounts] = useState<Array<{ id: string; code: string; name: string }>>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Lazy-loaded Tab 2 (Stock Moves) & Tab 3 (Financial Journal) states
  const [stockMoves, setStockMoves] = useState<any[]>([])
  const [stockFromCache, setStockFromCache] = useState(false)
  const [loadingStock, setLoadingStock] = useState(false)

  const [transactions, setTransactions] = useState<any[]>([])
  const [journalFromCache, setJournalFromCache] = useState(false)
  const [loadingJournal, setLoadingJournal] = useState(false)

  const rmaId = rma?.id || null

  // One-Time Transition Guard (AGENTS.md Rule 18)
  useEffect(() => {
    const isOpening = isOpen && !prevIsOpenRef.current
    const isRmaChanged = isOpen && rmaId && rmaId !== prevRmaIdRef.current
    prevIsOpenRef.current = isOpen
    if (rmaId) prevRmaIdRef.current = rmaId

    if (!isOpening && !isRmaChanged) return
    if (!rma) return

    setActiveTab('overview')
    setErrorMsg(null)
    setSuccessMsg(null)
    setCourierInput(rma.return_courier || '')
    setResiInput(rma.return_tracking_number || '')

    const suggested = RMA_REASON_MAP[rma.reason_code]?.suggestedDisposition || 'restock'
    const initDisp: Record<string, Exclude<RmaDisposition, 'pending'>> = {}
    for (const it of rma.rma_items || []) {
      initDisp[it.id] =
        it.disposition && it.disposition !== 'pending'
          ? (it.disposition as Exclude<RmaDisposition, 'pending'>)
          : suggested
    }
    setItemDispositions(initDisp)

    const orderGrand = Number(rma.orders?.grand_total || 0)
    const orderPaid = Number(rma.orders?.amount_paid || 0)
    const hasDebt = orderGrand - orderPaid > 0.5
    const hasCustomer = Boolean(rma.customer_id || rma.orders?.customers?.id)
    setSettlementMethod(hasDebt ? 'credit_memo' : hasCustomer ? 'store_credit' : 'refund')
  }, [isOpen, rmaId, rma])

  // Load COA payment accounts once when open & settlement pending
  useEffect(() => {
    const targetOrderId = rma?.order_id
    if (!isOpen || !targetOrderId || rma?.settlement_stage === 'settled') return

    fetch(
      `/api/rma?mode=preview&order_id=${encodeURIComponent(targetOrderId)}${
        businessId ? `&business_id=${encodeURIComponent(businessId)}` : ''
      }`
    )
      .then((r) => r.json().catch(() => null))
      .then((json) => {
        if (Array.isArray(json?.paymentAccounts) && json.paymentAccounts.length > 0) {
          setPaymentAccounts(json.paymentAccounts)
          setSelectedAccountId((prev) => prev || json.paymentAccounts[0].id)
        }
      })
      .catch(() => {})
  }, [isOpen, rma?.order_id, rma?.settlement_stage, businessId])

  // Lazy-load Tab 2: Jurnal Stok (SWR Pattern — inventory-ledger Rule)
  useEffect(() => {
    const currentRmaId = rma?.id
    const currentRmaNumber = rma?.rma_number
    if (!isOpen || activeTab !== 'stock_ledger' || !currentRmaId || !currentRmaNumber) return

    const cached = stockMovesSwrCache.get(currentRmaId)
    if (cached) {
      setStockMoves(cached)
      setStockFromCache(true)
    } else {
      setLoadingStock(true)
    }

    async function fetchMoves() {
      try {
        const { data, error } = await supabase
          .from('v_stock_moves_ledger')
          .select('*, products(name, sku)')
          .ilike('reference', `${currentRmaNumber}%`)
          .order('created_at', { ascending: false })

        if (!error && data) {
          stockMovesSwrCache.set(currentRmaId!, data)
          setStockMoves(data)
          setStockFromCache(false)
        }
      } finally {
        setLoadingStock(false)
      }
    }
    fetchMoves()
  }, [isOpen, activeTab, rma?.id, rma?.rma_number])

  // Lazy-load Tab 3: Jurnal Keuangan (SWR Pattern — inventory-ledger Rule)
  useEffect(() => {
    const currentRmaId = rma?.id
    const currentOrderId = rma?.order_id
    const currentRmaNumber = rma?.rma_number
    if (!isOpen || activeTab !== 'financial_ledger' || !currentRmaId || !currentOrderId) return

    const cached = journalSwrCache.get(currentRmaId)
    if (cached) {
      setTransactions(cached)
      setJournalFromCache(true)
    } else {
      setLoadingJournal(true)
    }

    async function fetchFinancials() {
      try {
        const { data, error } = await supabase
          .from('transactions')
          .select('id, date, description, journal_lines(id, debit, credit, accounts(code, name))')
          .eq('order_id', currentOrderId)
          .ilike('description', `%${currentRmaNumber}%`)
          .order('date', { ascending: true })

        if (!error && data) {
          journalSwrCache.set(currentRmaId!, data)
          setTransactions(data)
          setJournalFromCache(false)
        }
      } finally {
        setLoadingJournal(false)
      }
    }
    fetchFinancials()
  }, [isOpen, activeTab, rma?.id, rma?.order_id, rma?.rma_number])

  const handleInspectSubmit = async () => {
    if (!rma) return
    setSubmitting(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const payloadItems = (rma.rma_items || []).map((it) => ({
        rma_item_id: it.id,
        disposition: itemDispositions[it.id] || 'restock'
      }))

      const res = await fetch('/api/rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inspect',
          business_id: businessId || null,
          rma_id: rma.id,
          return_courier: courierInput.trim(),
          return_tracking_number: resiInput.trim(),
          items: payloadItems
        })
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Gagal menyimpan QC gudang')

      if (businessId && payloadItems.some((i) => i.disposition === 'restock')) {
        invalidatePosCatalogCache(businessId, true)
      }
      stockMovesSwrCache.delete(rma.id)
      journalSwrCache.delete(rma.id)

      setSuccessMsg(json?.message || 'Hasil QC gudang berhasil disimpan.')
      onUpdated?.()
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSettleSubmit = async () => {
    if (!rma) return
    setSubmitting(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const acc = paymentAccounts.find((a) => a.id === selectedAccountId)
      const res = await fetch('/api/rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settle',
          business_id: businessId || null,
          rma_id: rma.id,
          settlement_method: settlementMethod,
          refund_account_id: settlementMethod === 'refund' ? selectedAccountId || null : null,
          refund_method_label: settlementMethod === 'refund' ? acc?.name || null : null
        })
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Gagal menyelesaikan RMA')

      journalSwrCache.delete(rma.id)
      setSuccessMsg(json?.message || 'Penyelesaian hak pelanggan berhasil diposting.')
      onUpdated?.()
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Guard return at the very bottom after all Hooks!
  if (!isOpen || !rma) return null

  const needsInspection =
    rma.fulfillment_stage === 'requested' || rma.fulfillment_stage === 'approved'
  const canSettle =
    rma.settlement_stage === 'pending' &&
    rma.fulfillment_stage !== 'rejected' &&
    rma.fulfillment_stage !== 'cancelled'

  const orderGrand = Number(rma.orders?.grand_total || 0)
  const orderPaid = Number(rma.orders?.amount_paid || 0)
  const newGrandEst = Math.max(0, orderGrand - Number(rma.net_credit_amount || 0))
  const refundEligible = Math.max(0, orderPaid - newGrandEst)

  const customerPhone = String(rma.orders?.customers?.phone || '').replace(/[^0-9]/g, '')
  const itemsSummary = (rma.rma_items || [])
    .map((i) => `${i.name}${i.variant_name ? ` (${i.variant_name})` : ''} x${i.qty}`)
    .join(', ')

  const waHref = customerPhone
    ? `https://wa.me/${customerPhone.startsWith('0') ? '62' + customerPhone.slice(1) : customerPhone}?text=${encodeURIComponent(
        buildRmaWhatsAppMessage({
          businessName: activeBusiness?.name || 'Toko Kami',
          rmaNumber: rma.rma_number,
          orderNumber: rma.orders?.order_number || rma.order_id,
          customerName: rma.orders?.customers?.name,
          itemsSummary
        })
      )}`
    : null

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="xl"
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-black text-slate-900">{rma.rma_number}</span>
          <span className="text-xs font-bold text-slate-500">
            • Pesanan #{rma.orders?.order_number || '-'}
          </span>
        </div>
      }
      description={
        <span className="text-xs text-slate-500">
          Pelanggan: <strong className="text-slate-800">{rma.orders?.customers?.name || 'Umum'}</strong> • Dibuat:{' '}
          {formatDisplayDate(rma.created_at, 'datetime', timezone)}
        </span>
      }
      footer={
        <div className="flex items-center justify-between w-full flex-wrap gap-2">
          <div>
            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition"
              >
                📲 Chat WA Pelanggan
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-extrabold rounded-xl text-xs transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Touch-Friendly 3-Tab ERP Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap cursor-pointer transition ${
              activeTab === 'overview'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            1. Rincian & Tindak Lanjut RMA
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stock_ledger')}
            className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap cursor-pointer transition ${
              activeTab === 'stock_ledger'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            2. Jurnal Stok Multi-Wadah
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('financial_ledger')}
            className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap cursor-pointer transition ${
              activeTab === 'financial_ledger'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            3. Jurnal Keuangan (GL)
          </button>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
            ⚠️ {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
            ✅ {successMsg}
          </div>
        )}

        {/* TAB 1: OVERVIEW & PROGRESSIVE ACTIONS */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* 3-Step Visual Stepper */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/60">
                <div className="text-[10px] font-black uppercase text-emerald-700">
                  Tahap 1 • Gatekeeping
                </div>
                <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                  ✓ Tiket RMA Disetujui
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Alasan: {RMA_REASON_MAP[rma.reason_code]?.label || rma.reason_code}
                </div>
              </div>

              <div
                className={`p-3.5 rounded-xl border ${
                  !needsInspection
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-amber-300 bg-amber-50/70'
                }`}
              >
                <div className="text-[10px] font-black uppercase text-slate-600">
                  Tahap 2 • Fisik Gudang
                </div>
                <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                  {needsInspection
                    ? '⏳ Menunggu Paket & QC Gudang'
                    : rma.fulfillment_stage === 'received_quarantine'
                    ? '📦 Diterima di Karantina'
                    : '✓ Selesai Dicek Gudang'}
                </div>
                {rma.return_tracking_number && (
                  <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                    Resi: {rma.return_courier ? `${rma.return_courier} - ` : ''}
                    {rma.return_tracking_number}
                  </div>
                )}
              </div>

              <div
                className={`p-3.5 rounded-xl border ${
                  rma.settlement_stage === 'settled'
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-blue-200 bg-blue-50/60'
                }`}
              >
                <div className="text-[10px] font-black uppercase text-slate-600">
                  Tahap 3 • Penyelesaian Keuangan
                </div>
                <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                  {rma.settlement_stage === 'settled'
                    ? '✓ Selesai Dijurnal'
                    : '⏳ Menunggu Penyelesaian'}
                </div>
                <div className="text-[11px] font-bold text-blue-700 mt-0.5 tabular-nums">
                  Nilai Kredit: {formatIDR(Number(rma.net_credit_amount || 0))}
                </div>
              </div>
            </div>

            {/* Items & Warehouse Inspection Box */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-800">
                  Daftar Barang Retur & Hasil QC Gudang
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {(rma.rma_items || []).map((it) => {
                  const dispInfo = RMA_DISPOSITION_MAP[it.disposition]
                  return (
                    <div key={it.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-slate-900">
                          {it.name}
                          {it.variant_name ? ` — ${it.variant_name}` : ''}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Qty: <strong>{it.qty}</strong> • Nilai Retur:{' '}
                          <strong className="tabular-nums">{formatIDR(Number(it.line_refund || 0))}</strong>
                        </div>
                      </div>

                      {needsInspection ? (
                        <select
                          value={itemDispositions[it.id] || 'restock'}
                          onChange={(e) =>
                            setItemDispositions((prev) => ({
                              ...prev,
                              [it.id]: e.target.value as Exclude<RmaDisposition, 'pending'>
                            }))
                          }
                          className="text-xs font-bold border border-slate-300 rounded-lg px-3 py-2 bg-slate-50"
                        >
                          {RMA_DISPOSITION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.shortLabel}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                            dispInfo?.badgeClass || 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {dispInfo?.shortLabel || it.disposition}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {needsInspection && (
                <div className="p-4 bg-amber-50/50 border-t border-amber-200 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={courierInput}
                      onChange={(e) => setCourierInput(e.target.value)}
                      placeholder="Nama Kurir Balik (opsional)"
                      className="text-xs bg-white border border-slate-300 rounded-lg px-3 py-2"
                    />
                    <input
                      type="text"
                      value={resiInput}
                      onChange={(e) => setResiInput(e.target.value)}
                      placeholder="No. Resi Paket Retur (opsional)"
                      className="text-xs font-mono bg-white border border-slate-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleInspectSubmit}
                      className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs transition cursor-pointer"
                    >
                      {submitting ? 'Menyimpan...' : '📦 Konfirmasi Paket Tiba & Simpan QC Gudang'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Financial Settlement Box */}
            {canSettle && (
              <div className="bg-white border border-blue-200 rounded-xl p-4 space-y-3 shadow-2xs">
                <div className="text-xs font-extrabold text-slate-900">
                  Penyelesaian Hak Pelanggan ({formatIDR(Number(rma.net_credit_amount || 0))})
                </div>

                {refundEligible <= 0 ? (
                  <p className="text-xs text-slate-600 bg-blue-50/70 p-3 rounded-lg border border-blue-200">
                    📄 Tagihan asal belum lunas. Klik tombol di bawah untuk menerbitkan{' '}
                    <strong>Nota Kredit Pemotong Tagihan (`103000 Piutang Usaha`)</strong> secara otomatis.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Boolean(rma.customer_id || rma.orders?.customers?.id) && (
                      <button
                        type="button"
                        onClick={() => setSettlementMethod('store_credit')}
                        className={`p-3 rounded-xl border text-left text-xs cursor-pointer ${
                          settlementMethod === 'store_credit'
                            ? 'border-blue-600 bg-blue-50/60 font-bold'
                            : 'border-slate-200'
                        }`}
                      >
                        🪙 Masukkan ke Saldo Kredit Toko ({formatIDR(refundEligible)})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSettlementMethod('refund')}
                      className={`p-3 rounded-xl border text-left text-xs cursor-pointer ${
                        settlementMethod === 'refund'
                          ? 'border-blue-600 bg-blue-50/60 font-bold'
                          : 'border-slate-200'
                      }`}
                    >
                      💸 Transfer Refund Bank / Kas ({formatIDR(refundEligible)})
                    </button>
                  </div>
                )}

                {refundEligible > 0 && settlementMethod === 'refund' && paymentAccounts.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Pilih Rekening Kas / Bank Pengeluar Dana:
                    </label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="w-full text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 bg-white"
                    >
                      {paymentAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          [{acc.code}] {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleSettleSubmit}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs transition cursor-pointer"
                  >
                    {submitting
                      ? 'Memposting Jurnal...'
                      : refundEligible <= 0
                      ? '📄 Terbitkan Nota Kredit & Potong Tagihan'
                      : '✓ Selesaikan & Posting Jurnal Keuangan'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: STOCK MOVES LEDGER */}
        {activeTab === 'stock_ledger' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600">
                Riwayat Kartu Stok (`v_stock_moves_ledger`)
              </span>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {stockFromCache ? '⚡ Sync: Data Tampil dari Cache (0ms)' : '✓ Live Database'}
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
              <table className="min-w-[560px] w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Waktu</th>
                    <th className="py-3 px-4">Produk</th>
                    <th className="py-3 px-4">Wadah</th>
                    <th className="py-3 px-4 text-right">Mutasi</th>
                    <th className="py-3 px-4 text-right">Saldo Rak Utama</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingStock ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        Memuat kartu stok...
                      </td>
                    </tr>
                  ) : stockMoves.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        Belum ada pergerakan stok fisik (paket belum diterima gudang).
                      </td>
                    </tr>
                  ) : (
                    stockMoves.map((m: any) => {
                      const isPositive =
                        m.type === 'receipt' || (m.type === 'adjustment' && !m.origin_location_id)
                      return (
                        <tr key={m.id}>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                            {formatDisplayDate(m.created_at, 'datetime', timezone)}
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-900">
                            {m.products?.name || m.reference}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                              {m.bucket === 'quarantine'
                                ? '📦 Karantina'
                                : m.bucket === 'in_transit'
                                ? '🚚 In-Transit'
                                : '🏢 Gudang Utama'}
                            </span>
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-black tabular-nums ${
                              isPositive ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {isPositive ? `+${m.qty}` : `-${m.qty}`}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-800">
                            {m.system_stock ?? '-'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: FINANCIAL JOURNAL */}
        {activeTab === 'financial_ledger' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600">
                Jurnal Akuntansi Double-Entry Terkait RMA Ini
              </span>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {journalFromCache ? '⚡ Sync: Data Tampil dari Cache (0ms)' : '✓ Live Database'}
              </span>
            </div>

            {loadingJournal ? (
              <div className="py-8 text-center text-xs text-slate-400">Memuat jurnal akuntansi...</div>
            ) : transactions.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                Belum ada jurnal keuangan yang diposting untuk tiket RMA ini.
              </div>
            ) : (
              transactions.map((tx: any) => (
                <div key={tx.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-extrabold text-slate-800">{tx.description}</span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {formatDisplayDate(tx.date, 'datetime', timezone)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[460px] w-full text-left text-xs">
                      <thead className="bg-slate-50/50 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-400">
                        <tr>
                          <th className="py-2.5 px-4">Akun COA</th>
                          <th className="py-2.5 px-4 text-right">Debit</th>
                          <th className="py-2.5 px-4 text-right">Kredit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(tx.journal_lines || []).map((jl: any) => (
                          <tr key={jl.id}>
                            <td className="py-2.5 px-4 font-bold text-slate-800">
                              <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                                {jl.accounts?.code || '-'}
                              </span>
                              {jl.accounts?.name || '-'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums">
                              {Number(jl.debit) > 0 ? formatIDR(Number(jl.debit)) : '-'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums">
                              {Number(jl.credit) > 0 ? formatIDR(Number(jl.credit)) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </FullScreenModal>
  )
}

