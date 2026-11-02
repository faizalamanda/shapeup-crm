"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import {
  DISPOSITION_LABELS,
  RefundMethod,
  ReturnDisposition,
  RETURN_REASONS,
  ReturnReasonCode,
  ReturnPolicy,
  ReturnableLine,
  ExchangeItemInput
} from '@/lib/pos/returns/types'
import { computeReturnableLines, quoteReturn } from '@/lib/pos/returns/engine'
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

interface FlatCatalogItem {
  id: string
  productId: string
  variantId?: string | null
  product: any
  variant?: any
  displayName: string
  sku?: string
  price: number
  stockQuantity: number | null
  isVariant: boolean
}

type Props = {
  isOpen: boolean
  onClose: () => void
  order: any
  businessId?: string
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
  const { activeBusiness } = useUserContext()
  const effectiveBusinessId = businessId || order?.business_id || activeBusiness?.id

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
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [searchingServer, setSearchingServer] = useState(false)
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

    // 1. Synchronously populate lines from order prop immediately (0ms latency)!
    try {
      const { lines: initialReturnables } = computeReturnableLines(order, [])
      if (initialReturnables.length > 0) {
        setReturnLines(
          initialReturnables.map((l) => ({
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
        )
        setLoadingLines(false)
      } else {
        setLoadingLines(true)
      }
    } catch (err) {
      console.warn('Sync order parse error:', err)
      setLoadingLines(true)
    }

    // 2. Fetch server-side preview quote to check previous returns & business policy
    fetch('/api/pos/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'quote',
        order_id: order.id,
        items: [] // empty to load initial returnables
      })
    })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          console.warn('Quote preview warning:', data.error)
          return
        }
        if (data.returnableLines && data.returnableLines.length > 0) {
          setReturnLines((prev) => {
            const prevMap = new Map(prev.map((p) => [p.ref, p]))
            return data.returnableLines.map((l: any) => {
              const existing = prevMap.get(l.ref)
              return {
                ref: l.ref,
                productId: l.productId,
                variantId: l.variantId,
                name: l.name,
                variantName: l.variantName,
                quantity: l.quantity,
                remainingQty: l.remainingQty,
                lineNet: l.lineNet,
                unitPrice: Math.round(l.remainingQty > 0 ? l.lineNet / l.remainingQty : l.lineNet / l.quantity),
                selectedQty: existing ? Math.min(existing.selectedQty, l.remainingQty) : 0,
                disposition: existing?.disposition || 'restock'
              }
            })
          })
        }
        if (data.policy) setPolicy(data.policy)
      })
      .catch((err) => {
        console.error('Failed to load returnable lines from server:', err)
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
    async function loadCatalog() {
      if (!effectiveBusinessId) {
        setLoadingCatalog(false)
        return
      }
      setLoadingCatalog(true)
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, sku, price, stock_quantity, stock_type, product_variants(id, name, sku, price, stock_quantity)')
          .eq('business_id', effectiveBusinessId)
          .order('name', { ascending: true })
          .limit(300)

        if (!error && data) {
          setCatalog(data)
        } else {
          console.warn('Query with product_variants failed, retrying standard products:', error?.message)
          const { data: fallbackData } = await supabase
            .from('products')
            .select('id, name, sku, price, stock_quantity, stock_type')
            .eq('business_id', effectiveBusinessId)
            .order('name', { ascending: true })
            .limit(300)

          if (fallbackData) setCatalog(fallbackData)
        }
      } catch (catErr) {
        console.warn('Catalog load error:', catErr)
      } finally {
        setLoadingCatalog(false)
      }
    }

    loadCatalog()
  }, [isOpen, order?.id, effectiveBusinessId])

  // Live server search for exchange catalog
  useEffect(() => {
    if (!productSearch.trim() || !effectiveBusinessId || !isOpen) return

    const cleanQ = productSearch.trim().replace(/[,()]/g, '')
    if (!cleanQ) return

    const timer = setTimeout(async () => {
      setSearchingServer(true)
      try {
        // 1. Search products by name or sku
        const { data: matchedProds } = await supabase
          .from('products')
          .select('id, name, sku, price, stock_quantity, stock_type, product_variants(id, name, sku, price, stock_quantity)')
          .eq('business_id', effectiveBusinessId)
          .or(`name.ilike.%${cleanQ}%,sku.ilike.%${cleanQ}%`)
          .limit(50)

        // 2. Also search product_variants by name or sku
        const { data: matchedVars } = await supabase
          .from('product_variants')
          .select('product_id')
          .eq('business_id', effectiveBusinessId)
          .or(`name.ilike.%${cleanQ}%,sku.ilike.%${cleanQ}%`)
          .limit(50)

        const variantParentIds = (matchedVars || [])
          .map((v: any) => v.product_id)
          .filter((id: string) => !matchedProds?.some((p: any) => p.id === id))

        let extraProds: any[] = []
        if (variantParentIds.length > 0) {
          const { data: fetchedParents } = await supabase
            .from('products')
            .select('id, name, sku, price, stock_quantity, stock_type, product_variants(id, name, sku, price, stock_quantity)')
            .eq('business_id', effectiveBusinessId)
            .in('id', variantParentIds)

          if (fetchedParents) extraProds = fetchedParents
        }

        const combinedFound = [...(matchedProds || []), ...extraProds]

        if (combinedFound.length > 0) {
          setCatalog((prev) => {
            const map = new Map(prev.map((p) => [p.id, p]))
            for (const item of combinedFound) {
              map.set(item.id, item)
            }
            return Array.from(map.values())
          })
        }
      } catch (err) {
        console.warn('Server live search error:', err)
      } finally {
        setSearchingServer(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [productSearch, effectiveBusinessId, isOpen])

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

  // Instant Client-Side Math Preview (0ms Latency for Cashier)
  const clientQuote = useMemo(() => {
    if (!order?.id || activeReturnItems.length === 0) return null
    try {
      const mockLines: ReturnableLine[] = returnLines.map((l) => ({
        ref: l.ref,
        productId: l.productId,
        variantId: l.variantId,
        name: l.name,
        variantName: l.variantName,
        quantity: l.quantity,
        returnedQty: Math.max(0, l.quantity - l.remainingQty),
        remainingQty: l.remainingQty,
        lineNet: l.lineNet,
        refundedAmount: 0,
        unitCost: 0,
        isCustom: false,
        isReplacement: false
      }))

      const exchangeInputs: ExchangeItemInput[] = (mode === 'exchange' ? exchangeBasket : []).map((i) => ({
        productId: i.productId,
        variantId: i.variantId || null,
        name: i.name,
        variantName: i.variantName || null,
        quantity: i.quantity,
        unitPrice: i.unitPrice
      }))

      const activePolicy: ReturnPolicy = policy || {
        business_id: effectiveBusinessId || '',
        return_window_days: 0,
        require_reason: false,
        approval_mode: 'off',
        approval_threshold: 0,
        restocking_fee_pct: 0,
        allow_store_credit: true,
        default_disposition: 'restock'
      }

      return quoteReturn({
        lines: mockLines,
        request: activeReturnItems,
        reasonCode,
        policy: activePolicy,
        order: {
          grand_total: Number(order.grand_total || 0),
          amount_paid: Number(order.amount_paid || 0)
        },
        exchange: exchangeInputs
      })
    } catch {
      return null
    }
  }, [order, returnLines, activeReturnItems, exchangeBasket, mode, reasonCode, policy, effectiveBusinessId])

  const activeQuote = clientQuote || liveQuote

  // Recalculate Live Quote when selections change (items, basket, mode, reason)
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
  }, [order?.id, activeReturnItems, mode, exchangeBasket, reasonCode]) // returnMethod excluded to prevent button freeze on payment switch

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

  // Flat Discrete Catalog Search (Shopify & Inventory Reports standard: all variants are individual rows)
  const flatCatalog = useMemo<FlatCatalogItem[]>(() => {
    if (!productSearch.trim()) return []

    const rawQ = productSearch.trim().toLowerCase()
    const tokens = rawQ.split(/\s+/).filter(Boolean)
    const rows: FlatCatalogItem[] = []

    for (const prod of catalog) {
      const hasVariants = Array.isArray(prod.product_variants) && prod.product_variants.length > 0
      if (hasVariants) {
        for (const v of prod.product_variants) {
          const vName = v.name || v.title || ''
          const displayName = `${prod.name} - ${vName}`
          const sku = v.sku || prod.sku || ''
          const price = Number(v.price || prod.price || 0)
          const stock = v.stock_quantity ?? 0

          const searchTarget = `${displayName} ${sku}`.toLowerCase()
          const isMatch = tokens.every((tok) => searchTarget.includes(tok))
          if (isMatch) {
            rows.push({
              id: `${prod.id}_${v.id}`,
              productId: prod.id,
              variantId: v.id,
              product: prod,
              variant: v,
              displayName,
              sku,
              price,
              stockQuantity: stock,
              isVariant: true
            })
          }
        }
      } else {
        const displayName = prod.name
        const sku = prod.sku || ''
        const price = Number(prod.price || 0)
        const stock = prod.stock_quantity ?? null

        const searchTarget = `${displayName} ${sku}`.toLowerCase()
        const isMatch = tokens.every((tok) => searchTarget.includes(tok))
        if (isMatch) {
          rows.push({
            id: prod.id,
            productId: prod.id,
            variantId: null,
            product: prod,
            variant: null,
            displayName,
            sku,
            price,
            stockQuantity: stock,
            isVariant: false
          })
        }
      }
    }

    return rows
  }, [catalog, productSearch])

  // Add replacement item
  const addExchangeItem = (prod: any, variant?: any) => {
    const vId = variant ? variant.id : null
    const vName = variant ? (variant.name || variant.title) : null
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
    // Automatically close search list upon selection
    setProductSearch('')
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
          activeQuote && activeQuote.shortfall > 0
            ? {
                method: shortfallMethod,
                amount: activeQuote.shortfall,
                cashReceived: shortfallMethod === 'cash' ? cashReceived || activeQuote.shortfall : activeQuote.shortfall,
                changeAmount:
                  shortfallMethod === 'cash' && cashReceived > activeQuote.shortfall
                    ? cashReceived - activeQuote.shortfall
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
          gross_refund: activeQuote?.grossRefund,
          refund_total: activeQuote?.refundOut,
          credit_value: activeQuote?.creditValue,
          exchange_total: activeQuote?.exchangeTotal,
          items: activeQuote?.items || [],
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
                <span className="font-bold text-slate-800">{formatIDR(activeQuote?.creditValue || 0)}</span>
              </div>
              {activeQuote?.refundOut > 0 && (
                <div className="flex justify-between text-emerald-600 font-bold border-t border-slate-200 pt-2">
                  <span>Dana Dikembalikan (Refund):</span>
                  <span>{formatIDR(activeQuote.refundOut)}</span>
                </div>
              )}
              {activeQuote?.shortfall > 0 && (
                <div className="flex justify-between text-indigo-600 font-bold border-t border-slate-200 pt-2">
                  <span>Selisih Diterima Kasir:</span>
                  <span>{formatIDR(activeQuote.shortfall)}</span>
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
                        className={`py-3.5 px-3 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors border ${
                          isSelected ? 'bg-indigo-50/50 border-indigo-200 shadow-2xs' : 'border-slate-100 hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={line.remainingQty <= 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                updateQty(line.ref, line.selectedQty > 0 ? 0 : Math.min(1, line.remainingQty))
                              } else {
                                updateQty(line.ref, -line.selectedQty)
                              }
                            }}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                          />
                          <div
                            className="flex-1 min-w-0 cursor-pointer select-none"
                            onClick={() => {
                              if (line.selectedQty === 0 && line.remainingQty > 0) {
                                updateQty(line.ref, 1)
                              } else if (line.selectedQty > 0) {
                                updateQty(line.ref, -line.selectedQty)
                              }
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-800 truncate">{line.name}</span>
                              {line.variantName && (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium shrink-0">
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
                  <div className="relative">
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="🔍 Cari nama produk, varian, atau SKU..."
                      className="w-full py-2.5 pl-3.5 pr-10 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                    />
                    {searchingServer ? (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-indigo-600 font-bold animate-pulse">
                        Mencari...
                      </span>
                    ) : productSearch ? (
                      <button
                        type="button"
                        onClick={() => setProductSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>

                  {productSearch.trim().length > 0 && (
                    <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200/80 rounded-2xl bg-white shadow-2xs animate-in fade-in duration-150">
                      {searchingServer && catalog.length === 0 ? (
                        <div className="p-5 text-center text-xs text-slate-400 font-medium flex items-center justify-center gap-2">
                          <span className="animate-spin text-sm">⏳</span> Mencari produk...
                        </div>
                      ) : flatCatalog.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500 space-y-1">
                          <p className="font-bold text-slate-700">Tidak ada produk ditemukan</p>
                          <p className="text-[11px] text-slate-400">
                            Tidak ada produk atau varian yang cocok dengan &quot;{productSearch}&quot;.
                          </p>
                        </div>
                      ) : (
                        flatCatalog.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-3"
                          >
                            <div className="flex-1 min-w-0">
                              <span className="font-extrabold text-slate-900 text-xs block truncate">
                                {item.displayName}
                              </span>
                              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                                {item.sku && (
                                  <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                                    {item.sku}
                                  </span>
                                )}
                                <span>
                                  Harga: <strong className="text-slate-700">{formatIDR(item.price)}</strong>
                                </span>
                                <span>
                                  • Stok:{' '}
                                  <strong
                                    className={
                                      item.stockQuantity !== null && item.stockQuantity <= 0
                                        ? 'text-rose-600'
                                        : 'text-slate-700'
                                    }
                                  >
                                    {item.stockQuantity ?? '∞'}
                                  </strong>
                                </span>
                                {item.stockQuantity !== null && item.stockQuantity <= 0 && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 font-bold border border-rose-200/60">
                                    Habis
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => addExchangeItem(item.product, item.variant)}
                              className="shrink-0 text-xs px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black rounded-xl shadow-2xs transition-all flex items-center gap-1"
                            >
                              + Pilih
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 4: RINGKASAN SETTLEMENT & PEMBAYARAN */}
            {activeQuote && (
              <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300 block">
                  Kalkulasi Bersih & Rekonsiliasi
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-b border-slate-800 pb-4">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nilai Retur Kotor:</span>
                    <span className="font-bold text-slate-200">{formatIDR(activeQuote.grossRefund)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Biaya Restocking:</span>
                    <span className="font-bold text-amber-300">
                      {activeQuote.restockingFee > 0 ? `-${formatIDR(activeQuote.restockingFee)}` : 'Rp 0'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nilai Kredit Bersih:</span>
                    <span className="font-bold text-emerald-400">{formatIDR(activeQuote.creditValue)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Belanja Pengganti:</span>
                    <span className="font-bold text-indigo-300">{formatIDR(activeQuote.exchangeTotal)}</span>
                  </div>
                </div>

                {/* Settlement Identity Action */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                  <div>
                    <span className="text-xs text-indigo-200 block">
                      {activeQuote.refundOut > 0
                        ? 'Pengembalian Dana ke Pelanggan (Refund):'
                        : activeQuote.shortfall > 0
                        ? 'Pelanggan Bayar Selisih (Tukar Tambah):'
                        : 'Even Exchange (Tanpa Selisih Nilai)'}
                    </span>
                    <span className="text-2xl font-black text-white tabular-nums">
                      {formatIDR(activeQuote.refundOut > 0 ? activeQuote.refundOut : activeQuote.shortfall)}
                    </span>
                  </div>

                  {/* Refund Method Selector (when money goes out) */}
                  {activeQuote.refundOut > 0 && (
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
                  {activeQuote.shortfall > 0 && (
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
                {activeQuote.shortfall > 0 && shortfallMethod === 'cash' && (
                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Uang Tunai Diterima:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={cashReceived || ''}
                        onChange={(e) => setCashReceived(Number(e.target.value) || 0)}
                        placeholder={String(activeQuote.shortfall)}
                        className="w-32 py-1.5 px-3 bg-slate-800 border border-slate-700 rounded-xl text-right font-black text-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                      {cashReceived > activeQuote.shortfall && (
                        <span className="text-emerald-400 font-bold text-[11px]">
                          Kembalian: {formatIDR(cashReceived - activeQuote.shortfall)}
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
                disabled={submitting || !activeQuote || activeReturnItems.length === 0}
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
