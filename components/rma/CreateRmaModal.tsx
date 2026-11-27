'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { useUserContext } from '@/components/UserContext'
import { computeReturnableLines, quoteReturn } from '@/lib/pos/returns/engine'
import { DEFAULT_RETURN_POLICY, ReturnableLine } from '@/lib/pos/returns/types'
import { invalidatePosCatalogCache } from '@/lib/posCatalogStore'
import {
  buildRmaWhatsAppMessage,
  RMA_DISPOSITION_OPTIONS,
  RMA_REASON_MAP,
  RMA_REASONS,
  RmaDisposition,
  RmaSettlementMethod
} from '@/lib/rma/types'

interface LineSelectionState {
  ref: string
  productId: string | null
  variantId: string | null
  name: string
  variantName: string | null
  quantity: number
  remainingQty: number
  lineNet: number
  unitCost: number
  isCustom: boolean
  isReplacement: boolean
  returnedQty: number
  refundedAmount: number
  selectedQty: number
  disposition: Exclude<RmaDisposition, 'pending'>
}

type PaymentAccountOption = {
  id: string
  code: string
  name: string
}

type OtherUnpaidOrderOption = {
  id: string
  order_number: string
  grand_total: number
  amount_paid: number
  remaining_balance: number
  payment_status: string
  order_date: string
}

type CreateRmaModalProps = {
  isOpen: boolean
  onClose: () => void
  order: any | null
  defaultExpressMode?: boolean
  onSuccess?: (res: any) => void
}

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Math.round(Number(val) || 0))

export function CreateRmaModal({
  isOpen,
  onClose,
  order,
  defaultExpressMode = false,
  onSuccess
}: CreateRmaModalProps) {
  const { activeBusiness } = useUserContext()
  const businessId = activeBusiness?.id || order?.business_id

  // Unconditional React Hooks at top (mobile-modal-ux Rule 10)
  const prevIsOpenRef = useRef(false)
  const prevOrderIdRef = useRef<string | null>(null)
  const isSubmittingRef = useRef(false)

  const [flowMode, setFlowMode] = useState<'ticket' | 'express'>('ticket')
  const [lines, setLines] = useState<LineSelectionState[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [reasonCode, setReasonCode] = useState<string>('defective')
  const [reasonNote, setReasonNote] = useState<string>('')
  const [returnCourier, setReturnCourier] = useState<string>('')
  const [returnTrackingNumber, setReturnTrackingNumber] = useState<string>('')
  const [settlementMethod, setSettlementMethod] = useState<RmaSettlementMethod>('credit_memo')
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [otherUnpaidOrders, setOtherUnpaidOrders] = useState<OtherUnpaidOrderOption[]>([])
  const [selectedTargetOrderId, setSelectedTargetOrderId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [createdResult, setCreatedResult] = useState<any | null>(null)

  const orderId = order?.id ? String(order.id) : null
  const customerObj = order?.customers || order?.customer || null
  const hasNamedCustomer = Boolean(order?.customer_id || customerObj?.id)

  // One-Time Transition Guard (AGENTS.md Rule 18) — prevents wiping input while typing!
  useEffect(() => {
    const isOpening = isOpen && !prevIsOpenRef.current
    const isOrderChanged = isOpen && orderId && orderId !== prevOrderIdRef.current
    prevIsOpenRef.current = isOpen
    if (orderId) prevOrderIdRef.current = orderId

    if (!isOpening && !isOrderChanged) return
    if (!order) return

    const dueNow = Math.max(0, Number(order.grand_total || 0) - Number(order.amount_paid || 0))
    setFlowMode(defaultExpressMode ? 'express' : 'ticket')
    setReasonCode('defective')
    setReasonNote('')
    setReturnCourier('')
    setReturnTrackingNumber('')
    setSettlementMethod(dueNow > 0 ? 'credit_memo' : hasNamedCustomer ? 'store_credit' : 'refund')
    setErrorMsg(null)
    setCreatedResult(null)
    isSubmittingRef.current = false

    // Instant 0ms synchronous line parsing from order prop!
    try {
      const { lines: syncLines } = computeReturnableLines(order, [])
      setLines(
        syncLines.map((l) => ({
          ...l,
          selectedQty: 0,
          disposition: 'restock'
        }))
      )
    } catch {
      setLines([])
    }
  }, [isOpen, orderId, order, defaultExpressMode, hasNamedCustomer])

  // Isolated Asynchronous Hydration (updates remainingQty & COA accounts WITHOUT touching user text inputs!)
  useEffect(() => {
    const targetOrderId = order?.id
    if (!isOpen || !targetOrderId) return

    let cancelled = false
    setLoadingPreview(true)

    const url = `/api/rma?mode=preview&order_id=${encodeURIComponent(targetOrderId)}${
      businessId ? `&business_id=${encodeURIComponent(businessId)}` : ''
    }`

    fetch(url)
      .then((res) => res.json().catch(() => null))
      .then((json) => {
        if (cancelled || !json?.success) return
        if (Array.isArray(json.returnableLines)) {
          setLines((prev) => {
            const prevMap = new Map(prev.map((p) => [p.ref, p]))
            return (json.returnableLines as ReturnableLine[]).map((l) => {
              const existing = prevMap.get(l.ref)
              return {
                ...l,
                selectedQty: existing ? Math.min(existing.selectedQty, l.remainingQty) : 0,
                disposition: existing?.disposition || 'restock'
              }
            })
          })
        }
        if (Array.isArray(json.paymentAccounts) && json.paymentAccounts.length > 0) {
          setPaymentAccounts(json.paymentAccounts)
          setSelectedAccountId((prevId) => prevId || json.paymentAccounts[0].id)
        }
        if (Array.isArray(json.otherUnpaidOrders)) {
          setOtherUnpaidOrders(json.otherUnpaidOrders)
          if (json.otherUnpaidOrders.length > 0) {
            setSelectedTargetOrderId((prevId) => prevId || json.otherUnpaidOrders[0].id)
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, order?.id, businessId])

  // 0ms Instant Client-Side Quote Calculation (Zero API Spinner!)
  const instantCalc = useMemo(() => {
    if (!order) return null
    const activeItems = lines.filter((l) => l.selectedQty > 0)
    if (activeItems.length === 0) return null

    try {
      const q = quoteReturn({
        lines,
        request: activeItems.map((l) => ({
          ref: l.ref,
          qty: l.selectedQty,
          disposition:
            l.disposition === 'writeoff'
              ? 'writeoff'
              : l.disposition === 'quarantine'
              ? 'quarantine'
              : 'restock'
        })),
        reasonCode,
        policy: DEFAULT_RETURN_POLICY,
        order: {
          grand_total: Number(order.grand_total || 0),
          amount_paid: Number(order.amount_paid || 0)
        }
      })

      const arCut = Math.max(0, q.creditValue - q.refundOut)
      return {
        ...q,
        arCut
      }
    } catch {
      return null
    }
  }, [lines, reasonCode, order])

  const updateLineQty = (ref: string, deltaOrVal: number, isAbsolute = false) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.ref !== ref) return l
        const nextQty = isAbsolute
          ? Math.max(0, Math.min(l.remainingQty, deltaOrVal))
          : Math.max(0, Math.min(l.remainingQty, l.selectedQty + deltaOrVal))
        return { ...l, selectedQty: nextQty }
      })
    )
  }

  const updateLineDisposition = (ref: string, disp: Exclude<RmaDisposition, 'pending'>) => {
    setLines((prev) => prev.map((l) => (l.ref === ref ? { ...l, disposition: disp } : l)))
  }

  const handleReasonChange = (newReason: string) => {
    setReasonCode(newReason)
    const suggested = RMA_REASON_MAP[newReason]?.suggestedDisposition || 'restock'
    setLines((prev) => prev.map((l) => ({ ...l, disposition: suggested })))
  }

  const handleSubmit = async () => {
    if (!order?.id || isSubmittingRef.current) return
    const selected = lines.filter((l) => l.selectedQty > 0)
    if (selected.length === 0) {
      setErrorMsg('Pilih minimal 1 barang yang akan diretur / dibuatkan Nota Kredit.')
      return
    }
    if (reasonCode === 'other' && reasonNote.trim().length < 3) {
      setErrorMsg('Mohon tuliskan keterangan singkat untuk alasan "Lainnya".')
      return
    }

    isSubmittingRef.current = true
    setSubmitting(true)
    setErrorMsg(null)

    try {
      const selectedAcc = paymentAccounts.find((a) => a.id === selectedAccountId)
      const res = await fetch('/api/rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          business_id: businessId || null,
          order_id: order.id,
          items: selected.map((s) => ({
            ref: s.ref,
            qty: s.selectedQty,
            disposition: s.disposition
          })),
          reason_code: reasonCode,
          reason_note: reasonNote.trim(),
          return_courier: returnCourier.trim(),
          return_tracking_number: returnTrackingNumber.trim(),
          express_complete: flowMode === 'express',
          settlement_method: settlementMethod,
          refund_account_id: settlementMethod === 'refund' ? selectedAccountId || null : null,
          refund_method_label: settlementMethod === 'refund' ? selectedAcc?.name || null : null,
          target_order_id:
            settlementMethod === 'apply_other_invoice' ? selectedTargetOrderId || null : null
        })
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || `Gagal menyimpan RMA (Status: ${res.status})`)
      }

      if (flowMode === 'express' && businessId && selected.some((s) => s.disposition === 'restock')) {
        invalidatePosCatalogCache(businessId, true)
      }

      setCreatedResult({
        ...json,
        itemsSummary: selected
          .map((s) => `${s.name}${s.variantName ? ` (${s.variantName})` : ''} x${s.selectedQty}`)
          .join(', ')
      })
      onSuccess?.(json)
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan jaringan')
    } finally {
      setSubmitting(false)
      isSubmittingRef.current = false
    }
  }

  // Guard return at the very bottom after all Hooks!
  if (!isOpen || !order) return null

  const customerPhone = String(customerObj?.phone || '').replace(/[^0-9]/g, '')
  const waHref =
    createdResult && customerPhone
      ? `https://wa.me/${customerPhone.startsWith('0') ? '62' + customerPhone.slice(1) : customerPhone}?text=${encodeURIComponent(
          buildRmaWhatsAppMessage({
            businessName: activeBusiness?.name || 'Toko Kami',
            rmaNumber: createdResult.rmaNumber,
            orderNumber: order.order_number || order.id,
            customerName: customerObj?.name,
            itemsSummary: createdResult.itemsSummary
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
          <span className="font-extrabold text-slate-900">
            Retur / RMA & Nota Kredit — #{order.order_number}
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            PSAK 115 & Multi-Wadah Otomatis
          </span>
        </div>
      }
      description={
        <span className="text-xs text-slate-500">
          Pelanggan: <strong className="text-slate-800">{customerObj?.name || 'Pelanggan Umum'}</strong> • Tagihan Saat Ini:{' '}
          <strong className="text-slate-800">{formatIDR(Number(order.grand_total || 0))}</strong> (Dibayar:{' '}
          {formatIDR(Number(order.amount_paid || 0))})
        </span>
      }
      footer={
        createdResult ? (
          <div className="flex items-center justify-between w-full flex-wrap gap-2">
            <div>
              {waHref && (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition"
                >
                  📲 Kirim Instruksi Retur ke WhatsApp
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-xl text-xs transition cursor-pointer"
            >
              Selesai & Tutup
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full flex-wrap gap-3">
            <div className="text-xs">
              {instantCalc ? (
                <span className="font-bold text-slate-700">
                  Nilai Kredit Retur:{' '}
                  <strong className="text-sm font-black text-blue-700 tabular-nums">
                    {formatIDR(instantCalc.creditValue)}
                  </strong>
                </span>
              ) : (
                <span className="text-slate-400 font-medium">
                  Pilih jumlah barang yang diretur di daftar item
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="px-4 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting || !instantCalc}
                onClick={handleSubmit}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs shadow-xs transition cursor-pointer"
              >
                {submitting
                  ? 'Memproses...'
                  : flowMode === 'express'
                  ? '⚡ Selesaikan Retur & Update Jurnal'
                  : '📋 Terbitkan Tiket RMA'}
              </button>
            </div>
          </div>
        )
      }
    >
      {createdResult ? (
        <div className="py-8 px-4 max-w-lg mx-auto text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl mx-auto font-black">
            ✓
          </div>
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Berhasil Diproses
            </div>
            <h3 className="text-xl font-black text-slate-900 font-mono">
              {createdResult.rmaNumber}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">{createdResult.message}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Item Retur:</span>
              <span className="font-bold text-slate-800 text-right">{createdResult.itemsSummary}</span>
            </div>
            {createdResult.expressComplete && (
              <div className="flex justify-between pt-1.5 border-t border-slate-200">
                <span className="text-slate-500">Total Tagihan Bersih Baru:</span>
                <span className="font-black text-blue-700 tabular-nums">
                  {formatIDR(Number(createdResult.newGrandTotal || 0))}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Dual-Speed Mode Selector (SMB Zero-Jargon UX) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFlowMode('ticket')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                flowMode === 'ticket'
                  ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="text-xs font-extrabold text-slate-900">
                📋 Mode 1: Buat Tiket RMA Dulu (Paket Belum Sampai)
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Terbitkan kode RMA & kirim instruksi ke WA pembeli. Stok rak & jurnal keuangan belum berubah sampai paket dicek gudang.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setFlowMode('express')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                flowMode === 'express'
                  ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="text-xs font-extrabold text-slate-900">
                ⚡ Mode 2: Selesaikan Langsung 1-Klik (Nota Kredit / Barang di Tangan)
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Langsung update kartu stok, potong tagihan Invoice (Credit Memo) / refund, dan posting jurnal akuntansi otomatis detik ini.
              </p>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT: Returnable Items & Reason */}
            <div className="lg:col-span-7 min-w-0 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800">
                    1. Pilih Barang & Jumlah Retur
                  </span>
                  {loadingPreview && (
                    <span className="text-[10px] text-slate-400 animate-pulse">
                      Menyinkronkan sisa kuota retur...
                    </span>
                  )}
                </div>

                <div className="divide-y divide-slate-100">
                  {lines.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      Tidak ada item pada pesanan ini yang dapat diretur.
                    </div>
                  ) : (
                    lines.map((line) => {
                      const exhausted = line.remainingQty <= 0
                      const unitNet =
                        line.quantity > 0 ? Math.round(line.lineNet / line.quantity) : 0
                      return (
                        <div key={line.ref} className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-extrabold text-slate-900">
                                {line.name}
                                {line.variantName ? ` — ${line.variantName}` : ''}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                Harga bersih prorata: <strong className="tabular-nums">{formatIDR(unitNet)}</strong> / pcs • Sisa bisa diretur:{' '}
                                <strong>{line.remainingQty}</strong> dari {line.quantity}
                              </div>
                            </div>

                            {exhausted ? (
                              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400 text-[10px] font-bold">
                                Sudah Diretur Penuh
                              </span>
                            ) : (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => updateLineQty(line.ref, -1)}
                                  className="size-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-black text-slate-700 cursor-pointer"
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  max={line.remainingQty}
                                  value={line.selectedQty}
                                  onChange={(e) =>
                                    updateLineQty(line.ref, Number(e.target.value || 0), true)
                                  }
                                  className="w-14 h-8 text-center text-xs font-extrabold border border-slate-300 rounded-lg tabular-nums"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateLineQty(line.ref, 1)}
                                  className="size-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-black text-slate-700 cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Condition selector shown when item selected & in Express Mode */}
                          {flowMode === 'express' && line.selectedQty > 0 && (
                            <div className="pt-2 border-t border-dashed border-slate-200">
                              <label className="block text-[11px] font-bold text-slate-600 mb-1.5">
                                Kondisi Fisik Barang Ini (Menentukan Wadah Stok & Jurnal):
                              </label>
                              <select
                                value={line.disposition}
                                onChange={(e) =>
                                  updateLineDisposition(
                                    line.ref,
                                    e.target.value as Exclude<RmaDisposition, 'pending'>
                                  )
                                }
                                className="w-full text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 bg-slate-50"
                              >
                                {RMA_DISPOSITION_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.shortLabel} — {opt.smbDescription}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Reason & Return Tracking */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="text-xs font-extrabold text-slate-800">
                  2. Alasan Retur & Info Pengiriman Balik
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Alasan Utama
                  </label>
                  <select
                    value={reasonCode}
                    onChange={(e) => handleReasonChange(e.target.value)}
                    className="w-full text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 bg-white"
                  >
                    {RMA_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Ekspedisi Balik (Opsional)
                    </label>
                    <input
                      type="text"
                      value={returnCourier}
                      onChange={(e) => setReturnCourier(e.target.value)}
                      placeholder="Contoh: J&T / JNE / Kurir Toko"
                      className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      No. Resi Retur (Opsional)
                    </label>
                    <input
                      type="text"
                      value={returnTrackingNumber}
                      onChange={(e) => setReturnTrackingNumber(e.target.value)}
                      placeholder="Nomor resi paket retur..."
                      className="w-full text-xs font-mono border border-slate-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Catatan Komplain / Kondisi (Opsional)
                  </label>
                  <textarea
                    rows={2}
                    value={reasonNote}
                    onChange={(e) => setReasonNote(e.target.value)}
                    placeholder="Contoh: Jahitan lengan kiri lepas, pembeli minta potong tagihan..."
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            {/* RIGHT: Live 0ms Financial Preview & Settlement Choice */}
            <div className="lg:col-span-5 min-w-0 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800">
                    Simulasi Dampak Tagihan (0ms)
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Otomatis Prorata Diskon
                  </span>
                </div>

                {!instantCalc ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Tambahkan qty item di sebelah kiri untuk melihat simulasi potongan tagihan / refund.
                  </p>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Tagihan Awal:</span>
                      <span className="font-bold tabular-nums">{formatIDR(Number(order.grand_total || 0))}</span>
                    </div>
                    <div className="flex justify-between text-rose-700 font-bold">
                      <span>Nilai Kredit Barang Retur:</span>
                      <span className="tabular-nums">−{formatIDR(instantCalc.creditValue)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-slate-200 font-black text-slate-900 text-sm">
                      <span>Tagihan Bersih Baru:</span>
                      <span className="tabular-nums text-blue-700">{formatIDR(instantCalc.newGrandTotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600 pt-1">
                      <span>Uang Sudah Masuk:</span>
                      <span className="font-bold text-emerald-700 tabular-nums">{formatIDR(instantCalc.paidBefore)}</span>
                    </div>

                    {instantCalc.arCut > 0 && (
                      <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-[11px] font-semibold leading-relaxed">
                        📄 <strong>Otomatis Potong Sisa Piutang (Nota Kredit):</strong> Sisa tagihan belum dibayar akan otomatis berkurang sebesar{' '}
                        <strong className="tabular-nums">{formatIDR(instantCalc.arCut)}</strong>.
                      </div>
                    )}

                    {instantCalc.refundOut > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold leading-relaxed">
                        💰 <strong>Hak Pengembalian ke Pelanggan:</strong> Terdapat kelebihan pembayaran sebesar{' '}
                        <strong className="tabular-nums">{formatIDR(instantCalc.refundOut)}</strong> yang dapat dijadikan Saldo Kredit Toko atau ditransfer balik.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {flowMode === 'express' && instantCalc && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-extrabold text-slate-800">
                    3. Penyelesaian Hak Pelanggan
                  </div>

                  {instantCalc.refundOut <= 0 ? (
                    <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                      Karena pesanan ini memiliki sisa tagihan (tempo / belum lunas), nilai retur akan otomatis diterbitkan sebagai{' '}
                      <strong className="text-slate-900">Nota Kredit Pemotong Piutang (`103000`)</strong> tanpa mengeluarkan kas.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {hasNamedCustomer && (
                        <label
                          className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer text-xs ${
                            settlementMethod === 'store_credit'
                              ? 'border-blue-600 bg-blue-50/50'
                              : 'border-slate-200'
                          }`}
                        >
                          <input
                            type="radio"
                            name="rmaSettlement"
                            checked={settlementMethod === 'store_credit'}
                            onChange={() => setSettlementMethod('store_credit')}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-extrabold text-slate-900">
                              🪙 Masukkan ke Saldo Kredit Pelanggan (Direkomendasikan)
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Kas bank tetap utuh; saldo dapat dipakai memotong tagihan/belanja berikutnya kapan saja.
                            </div>
                          </div>
                        </label>
                      )}

                      {hasNamedCustomer && otherUnpaidOrders.length > 0 && (
                        <label
                          className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer text-xs ${
                            settlementMethod === 'apply_other_invoice'
                              ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-500/20'
                              : 'border-slate-200'
                          }`}
                        >
                          <input
                            type="radio"
                            name="rmaSettlement"
                            checked={settlementMethod === 'apply_other_invoice'}
                            onChange={() => {
                              setSettlementMethod('apply_other_invoice')
                              if (!selectedTargetOrderId && otherUnpaidOrders[0]) {
                                setSelectedTargetOrderId(otherUnpaidOrders[0].id)
                              }
                            }}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div>
                              <div className="font-extrabold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                <span>📄 Potongkan Langsung ke Piutang Nota Lain</span>
                                <span className="px-1.5 py-0.5 text-[10px] font-black rounded bg-emerald-100 text-emerald-800">
                                  {otherUnpaidOrders.length} Nota Belum Lunas
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Langsung mengurangi sisa tagihan pada faktur/pesanan pelanggan yang belum lunas dalam 1 klik.
                              </div>
                            </div>

                            {settlementMethod === 'apply_other_invoice' && (
                              <div className="space-y-1.5">
                                <select
                                  value={selectedTargetOrderId}
                                  onChange={(e) => setSelectedTargetOrderId(e.target.value)}
                                  className="w-full text-xs font-bold border border-emerald-300 rounded-lg px-2.5 py-2 bg-white text-slate-900"
                                >
                                  {otherUnpaidOrders.map((uo) => (
                                    <option key={uo.id} value={uo.id}>
                                      #{uo.order_number} — Sisa Tagihan: {formatIDR(uo.remaining_balance)}
                                    </option>
                                  ))}
                                </select>
                                {(() => {
                                  const targetObj = otherUnpaidOrders.find((u) => u.id === selectedTargetOrderId)
                                  if (!targetObj) return null
                                  const cutAmt = Math.min(instantCalc.refundOut, targetObj.remaining_balance)
                                  const leftoverCredit = Math.max(0, instantCalc.refundOut - cutAmt)
                                  return (
                                    <div className="text-[11px] text-emerald-800 bg-emerald-100/70 px-2.5 py-1.5 rounded-lg font-semibold">
                                      ⚡ Nota <strong>#{targetObj.order_number}</strong> akan langsung terpotong{' '}
                                      <strong>{formatIDR(cutAmt)}</strong>
                                      {leftoverCredit > 0
                                        ? ` (Sisa lebih ${formatIDR(leftoverCredit)} otomatis tersimpan di Saldo Kredit Pelanggan).`
                                        : '.'}
                                    </div>
                                  )
                                })()}
                              </div>
                            )}
                          </div>
                        </label>
                      )}

                      <label
                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer text-xs ${
                          settlementMethod === 'refund'
                            ? 'border-blue-600 bg-blue-50/50'
                            : 'border-slate-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="rmaSettlement"
                          checked={settlementMethod === 'refund'}
                          onChange={() => setSettlementMethod('refund')}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0 space-y-2">
                          <div>
                            <div className="font-extrabold text-slate-900">
                              💸 Kembalikan Dana (Transfer Bank / Kas)
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Mencatat arus kas keluar dan memposting jurnal pengembalian dana otomatis.
                            </div>
                          </div>

                          {settlementMethod === 'refund' && paymentAccounts.length > 0 && (
                            <select
                              value={selectedAccountId}
                              onChange={(e) => setSelectedAccountId(e.target.value)}
                              className="w-full text-xs font-semibold border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
                            >
                              {paymentAccounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  [{acc.code}] {acc.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </FullScreenModal>
  )
}

