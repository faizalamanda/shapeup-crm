"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { supabase } from '@/lib/supabase'
import {
  DISPOSITION_LABELS,
  RefundMethod,
  ReturnDisposition,
  RETURN_REASONS,
  ReturnReasonCode
} from '@/lib/pos/returns/types'
import { getPrinterAdapter } from '@/lib/pos/printerAdapter'
import { getStoredReceiptSettings } from '@/lib/pos/receiptSettings'
import { buildReturnReceiptData } from '@/lib/pos/receiptDataBuilder'

interface ReturnLineState {
  ref: string
  productId: string | null
  variantId: string | null
  name: string
  variantName: string | null
  quantity: number
  remainingQty: number
  lineNet: number
  unitPrice: number
  selectedQty: number
  disposition: ReturnDisposition
}

interface ExchangeItemState {
  productId: string
  variantId?: string | null
  name: string
  variantName?: string | null
  quantity: number
  unitPrice: number
  stockQuantity?: number
}

interface ApproverOption {
  id: string
  name: string
  role: string
  has_pin: boolean
}

type Props = {
  isOpen: boolean
  onClose: () => void
  order: any
  businessId: string
  timezone?: string
  cashierName?: string
  currentShiftId?: string | null
  onSuccess?: () => void
}

export default function POSReturnModal({
  isOpen,
  onClose,
  order,
  businessId,
  timezone,
  cashierName = 'Kasir',
  currentShiftId,
  onSuccess
}: Props) {
  // Modes: 'return' (Retur Saja) | 'exchange' (Tukar Tambah)
  const [mode, setMode] = useState<'return' | 'exchange'>('return')

  // Step 1: Items to return
  const [returnLines, setReturnLines] = useState<ReturnLineState[]>([])
  const [loadingLines, setLoadingLines] = useState(true)

  // Step 2: Reason & Note
  const [reasonCode, setReasonCode] = useState<ReturnReasonCode>('wrong_size')
  const [reasonNote, setReasonNote] = useState('')

  // Step 3 (Exchange): Replacement basket & catalog search
  const [catalog, setCatalog] = useState<any[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [exchangeBasket, setExchangeBasket] = useState<ExchangeItemState[]>([])

  // Step 4: Settlement method
  const [returnMethod, setReturnMethod] = useState<RefundMethod>('original')
  const [shortfallMethod, setShortfallMethod] = useState<'cash' | 'qris' | 'bank'>('cash')
  const [cashReceived, setCashReceived] = useState<number>(0)

  // Live Quote calculation
  const [liveQuote, setLiveQuote] = useState<any | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [policy, setPolicy] = useState<any | null>(null)
  const [requireApproval, setRequireApproval] = useState(false)
  const [approvalReason, setApprovalReason] = useState('')

  // Manager Approval PIN state
  const [approvers, setApprovers] = useState<ApproverOption[]>([])
  const [selectedApproverId, setSelectedApproverId] = useState<string>('')
  const [approverPin, setApproverPin] = useState<string>('')
  const [showPin, setShowPin] = useState(false)

  // Submission & Success states
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [completedReturn, setCompletedReturn] = useState<any | null>(null)
  const [printingReceipt, setPrintingReceipt] = useState(false)

  // Reset modal when order changes or opens
  useEffect(() => {
    if (!isOpen || !order?.id) return

    setMode('return')
    setReasonCode('wrong_size')
    setReasonNote('')
    setExchangeBasket([])
    setReturnMethod('original')
    setShortfallMethod('cash')
    setCashReceived(0)
    setErrorMsg(null)
    setCompletedReturn(null)
    setApproverPin('')

    // Load returnable lines from preview quote
    setLoadingLines(true)
    fetch('/api/pos/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'quote',
        order_id: order.id,
        items: [] // empty to load initial returnables
      })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.returnableLines) {
          const lines: ReturnLineState[] = data.returnableLines.map((l: any) => ({
            ref: l.ref,
            productId: l.productId,
            variantId: l.variantId,
            name: l.name,
            variantName: l.variantName,
            quantity: l.quantity,
            remainingQty: l.remainingQty,
            lineNet: l.lineNet,
            unitPrice: Math.round(l.remainingQty > 0 ? l.lineNet / l.remainingQty : l.lineNet / l.quantity),
            selectedQty: 0,
            disposition: 'restock'
          }))
          setReturnLines(lines)
        }
        if (data.policy) setPolicy(data.policy)
      })
      .catch((err) => {
        console.error('Failed to load returnable lines:', err)
        setErrorMsg('Gagal memuat daftar produk yang dapat diretur.')
      })
      .finally(() => setLoadingLines(false))

    // Load Approvers in case approval is needed
    fetch('/api/pos/price-authorizations')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.approvers) {
          setApprovers(data.approvers)
          if (data.approvers.length > 0) {
            setSelectedApproverId(data.approvers[0].id)
          }
        }
      })
      .catch(() => {})

    // Load products catalog for exchange replacement
    supabase
      .from('products')
      .select('id, name, price, stock_quantity, stock_type, product_variants(id, title, price, stock_quantity)')
      .eq('business_id', businessId)
      .order('name', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (data) setCatalog(data)
      })
  }, [isOpen, order?.id, businessId])

  // Filtered return request items
  const activeReturnItems = useMemo(() => {
    return returnLines
      .filter((l) => l.selectedQty > 0)
      .map((l) => ({
        ref: l.ref,
        qty: l.selectedQty,
        disposition: l.disposition
      }))
  }, [returnLines])

  // Recalculate Live Quote when selections change
  const triggerLiveQuote = useCallback(async () => {
    if (!order?.id || activeReturnItems.length === 0) {
      setLiveQuote(null)
      setRequireApproval(false)
      return
    }

    setQuoting(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/pos/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quote',
          order_id: order.id,
          items: activeReturnItems,
          exchange_items: mode === 'exchange' ? exchangeBasket : [],
          return_method: returnMethod,
          reason_code: reasonCode
        })
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setLiveQuote(data.quote)
        setRequireApproval(Boolean(data.requireApproval))
        setApprovalReason(data.approvalReason || '')
        if (data.policy) setPolicy(data.policy)
      } else {
        setErrorMsg(data.error || 'Gagal menghitung nilai retur.')
      }
    } catch (err: any) {
      console.error('Quote error:', err)
    } finally {
      setQuoting(false)
    }
  }, [order?.id, activeReturnItems, mode, exchangeBasket, returnMethod, reasonCode])

  useEffect(() => {
    const timer = setTimeout(() => {
      triggerLiveQuote()
    }, 250)
    return () => clearTimeout(timer)
  }, [triggerLiveQuote])

  // Stepper handlers
  const updateQty = (ref: string, delta: number) => {
    setReturnLines((prev) =>
      prev.map((line) => {
        if (line.ref === ref) {
          const next = Math.max(0, Math.min(line.remainingQty, line.selectedQty + delta))
          return { ...line, selectedQty: next }
        }
        return line
      })
    )
  }

  const setDisposition = (ref: string, disp: ReturnDisposition) => {
    setReturnLines((prev) =>
      prev.map((line) => (line.ref === ref ? { ...line, disposition: disp } : line))
    )
  }

  // Quick helper: Select All Remaining
  const handleSelectAll = () => {
    setReturnLines((prev) =>
      prev.map((line) => ({ ...line, selectedQty: line.remainingQty }))
    )
  }

  // Quick helper: Clear All
  const handleClearAll = () => {
    setReturnLines((prev) => prev.map((line) => ({ ...line, selectedQty: 0 })))
  }

  // Exchange catalog search
  const filteredCatalog = useMemo(() => {
    if (!productSearch.trim()) return catalog.slice(0, 25)
    const q = productSearch.toLowerCase()
    return catalog.filter((p) => p.name?.toLowerCase().includes(q))
  }, [catalog, productSearch])

  // Add replacement item
  const addExchangeItem = (prod: any, variant?: any) => {
    const vId = variant ? variant.id : null
    const vName = variant ? variant.title : null
    const price = variant ? Number(variant.price || prod.price) : Number(prod.price)

    setExchangeBasket((prev) => {
      const idx = prev.findIndex((i) => i.productId === prod.id && i.variantId === vId)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx].quantity += 1
        return copy
      }
      return [
        ...prev,
        {
          productId: prod.id,
          variantId: vId,
          name: prod.name,
          variantName: vName,
          quantity: 1,
          unitPrice: price,
          stockQuantity: variant ? variant.stock_quantity : prod.stock_quantity
        }
      ]
    })
  }

  const removeExchangeItem = (index: number) => {
    setExchangeBasket((prev) => prev.filter((_, i) => i !== index))
  }

  const updateExchangeQty = (index: number, delta: number) => {
    setExchangeBasket((prev) => {
      const copy = [...prev]
      const next = copy[index].quantity + delta
      if (next <= 0) return prev.filter((_, i) => i !== index)
      copy[index].quantity = next
      return copy
    })
  }

  // Format IDR helper
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  // Submit Handler
  const handleSubmitReturn = async () => {
    if (activeReturnItems.length === 0) {
      setErrorMsg('Pilih minimal 1 barang untuk diretur.')
      return
    }

    if (requireApproval && (!selectedApproverId || approverPin.length !== 6)) {
      setErrorMsg('Otorisasi Manajer diperlukan. Pilih approver dan masukkan 6 digit PIN.')
      return
    }

    setSubmitting(true)
    setErrorMsg(null)

    try {
      const payload = {
        action: 'execute',
        order_id: order.id,
        items: activeReturnItems,
        exchange_items: mode === 'exchange' ? exchangeBasket : [],
        return_method: returnMethod,
        shift_id: currentShiftId,
        reason_code: reasonCode,
        reason_note: reasonNote,
        approver_id: requireApproval ? selectedApproverId : null,
        approver_pin: requireApproval ? approverPin : null,
        payment_in:
          liveQuote && liveQuote.shortfall > 0
            ? {
                method: shortfallMethod,
                amount: liveQuote.shortfall,
                cashReceived: shortfallMethod === 'cash' ? cashReceived || liveQuote.shortfall : liveQuote.shortfall,
                changeAmount:
                  shortfallMethod === 'cash' && cashReceived > liveQuote.shortfall
                    ? cashReceived - liveQuote.shortfall
                    : 0
              }
            : undefined
      }

      const res = await fetch('/api/pos/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memproses transaksi retur.')
      }

      setCompletedReturn(data)
      if (onSuccess) onSuccess()
    } catch (err: any) {
      console.error('Submit return error:', err)
      setErrorMsg(err.message || 'Terjadi kesalahan saat memproses retur.')
    } finally {
      setSubmitting(false)
    }
  }

  // Print Thermal Credit Note Receipt
  const handlePrintReceipt = async () => {
    if (!completedReturn || !order) return
    setPrintingReceipt(true)
    try {
      const receiptData = buildReturnReceiptData(
        order,
        {
          return_number: completedReturn.returnNumber,
          return_kind: mode,
          reason_code: reasonCode,
          reason_note: reasonNote,
          cashier_name: cashierName,
          gross_refund: liveQuote?.grossRefund,
          refund_total: liveQuote?.refundOut,
          credit_value: liveQuote?.creditValue,
          exchange_total: liveQuote?.exchangeTotal,
          items: liveQuote?.items || [],
          exchange_items: exchangeBasket,
          settlement_json: { refund_lines: completedReturn.refundLines || [] }
        },
        { cashierName, timezone }
      )

      const settings = getStoredReceiptSettings(order.business_name)
      const adapter = getPrinterAdapter(settings.connectionType || 'system')
      await adapter.print(receiptData, settings.paperSize || '58mm')
    } catch (err: any) {
      console.error('Thermal print error:', err)
      alert('Gagal mencetak struk thermal: ' + (err.message || 'Printer tidak merespon'))
    } finally {
      setPrintingReceipt(false)
    }
  }

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Retur & Tukar Barang #${order?.order_number || ''}`}
    >
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        {/* SUCCESS VIEW */}
        {completedReturn ? (
          <div className="bg-white rounded-3xl p-6 sm:p-8 text-center space-y-5 border border-slate-200 shadow-xl max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mx-auto shadow-inner">
              ✓
            </div>
            <div>
              <span className="text-xs uppercase font-black tracking-widest text-emerald-600">
                Transaksi Berhasil
              </span>
              <h2 className="text-xl font-black text-slate-800 mt-1">
                {mode === 'exchange' ? 'Pertukaran Barang Selesai' : 'Retur Penjualan Selesai'}
              </h2>
              <div className="mt-2 inline-block px-3 py-1 bg-slate-100 rounded-lg text-xs font-mono font-bold text-slate-700">
                {completedReturn.returnNumber}
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 text-left text-xs space-y-2 border border-slate-100">
              <div className="flex justify-between text-slate-600">
                <span>Nilai Retur Bersih:</span>
                <span className="font-bold text-slate-800">{formatIDR(liveQuote?.creditValue || 0)}</span>
              </div>
              {liveQuote?.refundOut > 0 && (
                <div className="flex justify-between text-emerald-600 font-bold border-t border-slate-200 pt-2">
                  <span>Dana Dikembalikan (Refund):</span>
                  <span>{formatIDR(liveQuote.refundOut)}</span>
                </div>
              )}
              {liveQuote?.shortfall > 0 && (
                <div className="flex justify-between text-indigo-600 font-bold border-t border-slate-200 pt-2">
                  <span>Selisih Diterima Kasir:</span>
                  <span>{formatIDR(liveQuote.shortfall)}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={handlePrintReceipt}
                disabled={printingReceipt}
                className="flex-1 py-3 px-4 rounded-xl bg-slate-900 text-white font-bold text-sm shadow-md hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>🖨️</span>
                <span>{printingReceipt ? 'Mencetak...' : 'Cetak Struk Retur'}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 px-4 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-all"
              >
                Tutup Selesai
              </button>
            </div>
          </div>
        ) : (
          /* WORKFLOW VIEW */
          <div className="space-y-6">
            {/* MODE SWITCHER */}
            <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-2 max-w-md mx-auto">
              <button
                type="button"
                onClick={() => setMode('return')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                  mode === 'return'
                    ? 'bg-white text-slate-900 shadow-md ring-1 ring-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>↩️</span>
                <span>Retur Saja (Refund)</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('exchange')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                  mode === 'exchange'
                    ? 'bg-white text-indigo-900 shadow-md ring-1 ring-indigo-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>🔄</span>
                <span>Tukar Barang (Exchange)</span>
              </button>
            </div>

            {/* ERROR BANNER */}
            {errorMsg && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-3">
                <span className="text-lg">⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* STEP 1: PILIH PRODUK YANG AKAN DIRETUR */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-slate-800 text-sm">1. Pilih Produk yang Diretur</h3>
                  <p className="text-[11px] text-slate-500">
                    Tentukan jumlah unit dan kondisi fisik barang yang dikembalikan.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-[11px] font-bold text-indigo-600 hover:underline px-2 py-1 rounded bg-indigo-50"
                  >
                    Pilih Semua
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-[11px] font-bold text-slate-500 hover:underline px-2 py-1 rounded bg-slate-100"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {loadingLines ? (
                <div className="py-8 text-center text-xs text-slate-400">Memuat rincian nota pesanan...</div>
              ) : returnLines.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Tidak ada barang yang dapat diretur pada pesanan ini.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {returnLines.map((line) => {
                    const isSelected = line.selectedQty > 0
                    return (
                      <div
                        key={line.ref}
                        className={`py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                          isSelected ? 'bg-indigo-50/40 -mx-2 px-2 rounded-xl' : ''
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-800 truncate">{line.name}</span>
                            {line.variantName && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                {line.variantName}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span>Sisa: <strong className="text-slate-700">{line.remainingQty}</strong> unit</span>
                            <span>•</span>
                            <span>Net Unit: <strong>{formatIDR(line.unitPrice)}</strong></span>
                          </div>
                        </div>

                        {/* Controls: Disposition & Stepper */}
                        <div className="flex items-center gap-3">
                          {isSelected && (
                            <select
                              value={line.disposition}
                              onChange={(e) => setDisposition(line.ref, e.target.value as ReturnDisposition)}
                              className="text-[11px] font-medium py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="restock">🟢 Rak (Siap Jual)</option>
                              <option value="quarantine">🟡 Karantina (Inspeksi)</option>
                              <option value="writeoff">🔴 Buang (Write-off)</option>
                            </select>
                          )}

                          <div className="flex items-center border border-slate-200 rounded-xl bg-white shadow-2xs">
                            <button
                              type="button"
                              onClick={() => updateQty(line.ref, -1)}
                              disabled={line.selectedQty <= 0}
                              className="w-8 h-8 flex items-center justify-center font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30 rounded-l-xl"
                            >
                              -
                            </button>
                            <span className="w-9 text-center font-black text-xs text-slate-800 tabular-nums">
                              {line.selectedQty}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQty(line.ref, 1)}
                              disabled={line.selectedQty >= line.remainingQty}
                              className="w-8 h-8 flex items-center justify-center font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30 rounded-r-xl"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* STEP 2: ALASAN & CATATAN RETUR */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
              <h3 className="font-black text-slate-800 text-sm">2. Alasan Pengembalian</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Kategori Alasan *
                  </label>
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value as ReturnReasonCode)}
                    className="w-full py-2.5 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {RETURN_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Catatan Tambahan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={reasonNote}
                    onChange={(e) => setReasonNote(e.target.value)}
                    placeholder="Contoh: Jahitan saku lepas, minta ganti warna navy"
                    className="w-full py-2.5 px-3 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* STEP 3 (IF EXCHANGE): PILIH BARANG PENGGANTI */}
            {mode === 'exchange' && (
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-slate-800 text-sm">3. Pilih Barang Pengganti</h3>
                    <p className="text-[11px] text-slate-500">Cari produk baru dari katalog toko.</p>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                    {exchangeBasket.length} item dipilih
                  </span>
                </div>

                {/* Basket */}
                {exchangeBasket.length > 0 && (
                  <div className="bg-slate-50 rounded-xl p-3 divide-y divide-slate-200/60 border border-slate-200">
                    {exchangeBasket.map((item, idx) => (
                      <div key={idx} className="py-2 flex items-center justify-between text-xs">
                        <div>
                          <div className="font-bold text-slate-800">
                            {item.name} {item.variantName ? `(${item.variantName})` : ''}
                          </div>
                          <div className="text-[10px] text-slate-500">{formatIDR(item.unitPrice)} / unit</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateExchangeQty(idx, -1)}
                            className="w-6 h-6 rounded bg-white border border-slate-300 font-black text-slate-600 hover:bg-slate-100"
                          >
                            -
                          </button>
                          <span className="font-black w-6 text-center">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateExchangeQty(idx, 1)}
                            className="w-6 h-6 rounded bg-white border border-slate-300 font-black text-slate-600 hover:bg-slate-100"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => removeExchangeItem(idx)}
                            className="text-rose-500 hover:text-rose-700 ml-2 font-bold text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Catalog Search */}
                <div className="space-y-2">
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="🔍 Cari nama produk pengganti..."
                    className="w-full py-2 px-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {filteredCatalog.map((prod) => {
                      const hasVariants = prod.product_variants && prod.product_variants.length > 0
                      return (
                        <div key={prod.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-50">
                          <div>
                            <span className="font-semibold text-slate-800 block">{prod.name}</span>
                            <span className="text-[10px] text-slate-500">{formatIDR(prod.price)}</span>
                          </div>
                          {hasVariants ? (
                            <div className="flex flex-wrap gap-1">
                              {prod.product_variants.map((v: any) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => addExchangeItem(prod, v)}
                                  className="text-[10px] px-2 py-1 bg-indigo-50 text-indigo-700 font-bold rounded hover:bg-indigo-100"
                                >
                                  + {v.title}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addExchangeItem(prod)}
                              className="text-xs px-3 py-1 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 shadow-2xs"
                            >
                              + Pilih
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: RINGKASAN SETTLEMENT & PEMBAYARAN */}
            {liveQuote && (
              <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300 block">
                  Kalkulasi Bersih & Rekonsiliasi
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-b border-slate-800 pb-4">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nilai Retur Kotor:</span>
                    <span className="font-bold text-slate-200">{formatIDR(liveQuote.grossRefund)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Biaya Restocking:</span>
                    <span className="font-bold text-amber-300">
                      {liveQuote.restockingFee > 0 ? `-${formatIDR(liveQuote.restockingFee)}` : 'Rp 0'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nilai Kredit Bersih:</span>
                    <span className="font-bold text-emerald-400">{formatIDR(liveQuote.creditValue)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Belanja Pengganti:</span>
                    <span className="font-bold text-indigo-300">{formatIDR(liveQuote.exchangeTotal)}</span>
                  </div>
                </div>

                {/* Settlement Identity Action */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                  <div>
                    <span className="text-xs text-indigo-200 block">
                      {liveQuote.refundOut > 0
                        ? 'Pengembalian Dana ke Pelanggan (Refund):'
                        : liveQuote.shortfall > 0
                        ? 'Pelanggan Bayar Selisih (Tukar Tambah):'
                        : 'Even Exchange (Tanpa Selisih Nilai)'}
                    </span>
                    <span className="text-2xl font-black text-white tabular-nums">
                      {formatIDR(liveQuote.refundOut > 0 ? liveQuote.refundOut : liveQuote.shortfall)}
                    </span>
                  </div>

                  {/* Refund Method Selector (when money goes out) */}
                  {liveQuote.refundOut > 0 && (
                    <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setReturnMethod('original')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          returnMethod === 'original' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-300'
                        }`}
                      >
                        Metode Asal
                      </button>
                      <button
                        type="button"
                        onClick={() => setReturnMethod('cash')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          returnMethod === 'cash' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-300'
                        }`}
                      >
                        💵 Tunai Kasir
                      </button>
                      {policy?.allow_store_credit && (
                        <button
                          type="button"
                          onClick={() => setReturnMethod('store_credit')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            returnMethod === 'store_credit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-300'
                          }`}
                        >
                          🎟️ Kredit Toko
                        </button>
                      )}
                    </div>
                  )}

                  {/* Payment In Method Selector (when customer pays extra) */}
                  {liveQuote.shortfall > 0 && (
                    <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setShortfallMethod('cash')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          shortfallMethod === 'cash' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-300'
                        }`}
                      >
                        💵 Tunai
                      </button>
                      <button
                        type="button"
                        onClick={() => setShortfallMethod('qris')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          shortfallMethod === 'qris' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-300'
                        }`}
                      >
                        📱 QRIS
                      </button>
                      <button
                        type="button"
                        onClick={() => setShortfallMethod('bank')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          shortfallMethod === 'bank' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-300'
                        }`}
                      >
                        💳 Transfer/EDC
                      </button>
                    </div>
                  )}
                </div>

                {/* Cash payment keypad input if shortfall is cash */}
                {liveQuote.shortfall > 0 && shortfallMethod === 'cash' && (
                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Uang Tunai Diterima:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={cashReceived || ''}
                        onChange={(e) => setCashReceived(Number(e.target.value) || 0)}
                        placeholder={String(liveQuote.shortfall)}
                        className="w-32 py-1.5 px-3 bg-slate-800 border border-slate-700 rounded-xl text-right font-black text-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                      {cashReceived > liveQuote.shortfall && (
                        <span className="text-emerald-400 font-bold text-[11px]">
                          Kembalian: {formatIDR(cashReceived - liveQuote.shortfall)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MANAGER PIN AUTHORIZATION (WHEN REQUIRED BY POLICY) */}
            {requireApproval && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
                  <span>🔒</span>
                  <span>Otorisasi Manajer Diperlukan</span>
                </div>
                <p className="text-[11px] text-amber-700 font-medium">
                  {approvalReason || 'Kebijakan unit bisnis mewajibkan otorisasi Manajer untuk transaksi ini.'}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-1">
                      Pilih Manajer / Admin *
                    </label>
                    <select
                      value={selectedApproverId}
                      onChange={(e) => setSelectedApproverId(e.target.value)}
                      className="w-full py-2 px-3 rounded-xl border border-amber-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {approvers.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.role})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-1">
                      6 Digit PIN Otorisasi *
                    </label>
                    <div className="relative">
                      <input
                        type={showPin ? 'text' : 'password'}
                        value={approverPin}
                        onChange={(e) => setApproverPin(e.target.value.slice(0, 6))}
                        placeholder="••••••"
                        maxLength={6}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full py-2 pl-3 pr-10 rounded-xl border border-amber-300 bg-white text-xs font-black tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                      >
                        {showPin ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ACTION BUTTONS */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3.5 px-4 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmitReturn}
                disabled={submitting || quoting || activeReturnItems.length === 0}
                className="flex-2 py-3.5 px-6 rounded-xl bg-slate-900 text-white font-bold text-xs shadow-lg hover:bg-slate-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span>✓</span>
                <span>
                  {submitting
                    ? 'Memproses Transaksi...'
                    : mode === 'exchange'
                    ? 'Konfirmasi Penukaran Barang'
                    : 'Konfirmasi Retur Penjualan'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </FullScreenModal>
  )
}
