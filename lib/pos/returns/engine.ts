// ShapeUp POS Returns Engine — pure calculation core (no I/O).
//
// Theory:
//  - Event sourcing: a return is a NEW document; the original order lines are never rewritten.
//  - Double entry: sales returns post to the contra-revenue account (401100), not 401000.
//  - Settlement identity: after a return/exchange the customer owes `newGrandTotal`.
//      refundOut = max(0, paid - newGrandTotal)      (cash/store credit handed back)
//      shortfall = max(0, newGrandTotal - paid)       (exchange upcharge to collect)
//    Receivable is reduced BEFORE any cash leaves the drawer (customer still owing never gets cash).
//  - The receivable (103000) is the balancing plug of the journal, which keeps debit == credit
//    by construction.

import {
  ExchangeItemInput,
  QuotedReturnItem,
  RETURN_REASON_MAP,
  RefundMethod,
  ReturnDisposition,
  ReturnError,
  ReturnPolicy,
  ReturnQuote,
  ReturnRequestItem,
  ReturnableLine,
  SettlementLine
} from './types'

const round = (n: number) => Math.round(Number.isFinite(n) ? n : 0)
const num = (v: unknown, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// ─── 1. Order line parsing ────────────────────────────────────────────────────

export interface ParsedOrderLine {
  ref: string
  productId: string | null
  variantId: string | null
  name: string
  variantName: string | null
  quantity: number
  /** Net value of the line after item-level discount, before global discount proration. */
  lineNet: number
  unitCost: number
  isCustom: boolean
  isReplacement: boolean
}

export interface ParsedOrder {
  lines: ParsedOrderLine[]
  /** Order was exchanged through the legacy route (negative [RETUR] marker lines). */
  hasLegacyMarkers: boolean
  /** Legacy returned quantity keyed by `${product_id}|${variant_name}`. */
  legacyReturned: Map<string, number>
}

function parseItemsJson(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function parseOrderLines(order: { items_json?: unknown }): ParsedOrder {
  const raw = parseItemsJson(order?.items_json)
  const lines: ParsedOrderLine[] = []
  const legacyReturned = new Map<string, number>()
  let hasLegacyMarkers = false
  const seenRefs = new Set<string>()

  raw.forEach((item: any, idx: number) => {
    const name = String(item?.name || 'Produk')
    const qtyRaw = num(item?.quantity, 1)

    if (name.startsWith('[RETUR]')) {
      hasLegacyMarkers = true
      const key = `${item?.product_id || ''}|${item?.variant_name || ''}`
      legacyReturned.set(key, (legacyReturned.get(key) || 0) + Math.abs(qtyRaw))
      return
    }

    const isLegacyReplacement = name.startsWith('[PENGGANTI]')
    if (isLegacyReplacement) hasLegacyMarkers = true
    const isReplacement = isLegacyReplacement || Boolean(item?.exchange_return_id)

    const qty = Math.abs(qtyRaw)
    if (qty <= 0) return

    let ref = String(item?.id ?? `L${idx}`)
    if (seenRefs.has(ref)) ref = `${ref}#${idx}`
    seenRefs.add(ref)

    const price = num(item?.price)
    const totalRaw = item?.total
    const lineNet =
      totalRaw !== undefined && totalRaw !== null && totalRaw !== '' && Number.isFinite(Number(totalRaw))
        ? num(totalRaw)
        : price * qty

    const productId = isUuid(item?.product_id) ? item.product_id : (isUuid(item?.id) ? item.id : null)
    const variantId = isUuid(item?.variant_id) ? item.variant_id : (isUuid(item?.variation_id) ? item.variation_id : null)

    lines.push({
      ref,
      productId,
      variantId,
      name: isLegacyReplacement ? name.replace('[PENGGANTI]', '').trim() : name,
      variantName: item?.variant_name ? String(item.variant_name) : null,
      quantity: qty,
      lineNet,
      unitCost: num(item?.cost_price),
      isCustom: String(item?.id || '').startsWith('custom-') || !productId,
      isReplacement
    })
  })

  return { lines, hasLegacyMarkers, legacyReturned }
}

// ─── 2. Returnable lines (remaining quantity & value) ─────────────────────────

export interface PreviousReturnItem {
  order_item_ref: string
  qty: number
  line_refund: number
}

export interface ReturnableResult {
  lines: ReturnableLine[]
  ratio: number
}

/**
 * Builds the returnable view of an order: remaining qty and net value per line.
 * Global discount is prorated through `ratio`:
 *   ratio = originalGrandTotal / Σ(original line nets)   (capped to 1)
 * where originalGrandTotal = grand_total + returned_total − exchanged_in_total.
 */
export function computeReturnableLines(
  order: { grand_total?: unknown; returned_total?: unknown; exchanged_in_total?: unknown; items_json?: unknown },
  previousItems: PreviousReturnItem[]
): ReturnableResult {
  const parsed = parseOrderLines(order)

  const prevQty = new Map<string, number>()
  const prevRefund = new Map<string, number>()
  for (const p of previousItems) {
    prevQty.set(p.order_item_ref, (prevQty.get(p.order_item_ref) || 0) + num(p.qty))
    prevRefund.set(p.order_item_ref, (prevRefund.get(p.order_item_ref) || 0) + num(p.line_refund))
  }

  // Distribute legacy returned qty across matching lines (first come first served).
  const legacyLeft = new Map(parsed.legacyReturned)

  const originalLines = parsed.lines.filter((l) => !l.isReplacement)
  const sumOriginalNet = originalLines.reduce((s, l) => s + l.lineNet, 0)
  const originalGrand =
    num(order.grand_total) + num(order.returned_total) - num(order.exchanged_in_total)

  let ratio = 1
  if (!parsed.hasLegacyMarkers && sumOriginalNet > 0 && originalGrand > 0) {
    ratio = Math.min(1, Math.max(0, originalGrand / sumOriginalNet))
  }

  const lines: ReturnableLine[] = parsed.lines.map((l) => {
    const key = `${l.productId || ''}|${l.variantName || ''}`
    let legacyQty = 0
    const left = legacyLeft.get(key) || 0
    if (left > 0) {
      legacyQty = Math.min(left, l.quantity)
      legacyLeft.set(key, left - legacyQty)
    }

    const returnedQty = (prevQty.get(l.ref) || 0) + legacyQty
    const lineRatio = l.isReplacement ? 1 : ratio
    return {
      ref: l.ref,
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      variantName: l.variantName,
      quantity: l.quantity,
      returnedQty,
      remainingQty: Math.max(0, l.quantity - returnedQty),
      lineNet: round(l.lineNet * lineRatio),
      refundedAmount: prevRefund.get(l.ref) || 0,
      unitCost: l.unitCost,
      isCustom: l.isCustom,
      isReplacement: l.isReplacement
    }
  })

  return { lines, ratio }
}

/** Refund value for `qty` units of a line; the last remaining unit absorbs rounding drift. */
export function lineRefundFor(line: ReturnableLine, qty: number): number {
  if (qty >= line.remainingQty) {
    return Math.max(0, line.lineNet - line.refundedAmount)
  }
  return round((line.lineNet * qty) / line.quantity)
}

// ─── 3. Policy ────────────────────────────────────────────────────────────────

export interface PolicyContext {
  orderDate: string | Date | null
  isPrivilegedActor: boolean
  grossRefund: number
  reasonCode: string
  reasonNote?: string | null
  now?: Date
}

export interface PolicyDecision {
  requiresApproval: boolean
  reasons: string[]
}

export function evaluateReturnPolicy(policy: ReturnPolicy, ctx: PolicyContext): PolicyDecision {
  const reasons: string[] = []

  if (policy.require_reason) {
    const known = RETURN_REASON_MAP[ctx.reasonCode]
    if (!known) {
      throw new ReturnError('Alasan retur wajib dipilih.', 'REASON_REQUIRED', 400)
    }
    if (ctx.reasonCode === 'other' && !(ctx.reasonNote || '').trim()) {
      throw new ReturnError('Catatan wajib diisi jika alasan retur "Lainnya".', 'REASON_NOTE_REQUIRED', 400)
    }
  }

  switch (policy.approval_mode) {
    case 'always':
      reasons.push('Kebijakan toko: semua retur wajib otorisasi.')
      break
    case 'above_amount':
      if (ctx.grossRefund > policy.approval_threshold) {
        reasons.push('Nilai retur melebihi batas tanpa otorisasi.')
      }
      break
    case 'non_admin':
      if (!ctx.isPrivilegedActor) reasons.push('Retur oleh kasir wajib otorisasi Owner/Admin.')
      break
    default:
      break
  }

  if (policy.return_window_days > 0 && ctx.orderDate) {
    const orderTs = new Date(ctx.orderDate).getTime()
    const nowTs = (ctx.now || new Date()).getTime()
    if (Number.isFinite(orderTs)) {
      const ageDays = (nowTs - orderTs) / 86_400_000
      if (ageDays > policy.return_window_days && !ctx.isPrivilegedActor) {
        reasons.push(`Nota melewati batas retur ${policy.return_window_days} hari.`)
      }
    }
  }

  return { requiresApproval: reasons.length > 0, reasons }
}

// ─── 4. Quote ─────────────────────────────────────────────────────────────────

export interface QuoteInput {
  lines: ReturnableLine[]
  request: ReturnRequestItem[]
  reasonCode: string
  policy: Pick<ReturnPolicy, 'restocking_fee_pct'>
  order: { grand_total: number; amount_paid: number }
  exchange?: Array<ExchangeItemInput>
  trackedProductIds?: Set<string>
}

export function quoteReturn(input: QuoteInput): ReturnQuote {
  const lineMap = new Map(input.lines.map((l) => [l.ref, l]))
  const items: QuotedReturnItem[] = []

  const requested = input.request.filter((r) => num(r.qty) > 0)
  if (requested.length === 0) {
    throw new ReturnError('Pilih minimal 1 barang yang akan diretur.', 'NO_ITEMS', 400)
  }

  const seen = new Set<string>()
  for (const req of requested) {
    if (seen.has(req.ref)) {
      throw new ReturnError('Baris retur duplikat terdeteksi.', 'DUPLICATE_LINE', 400)
    }
    seen.add(req.ref)

    const line = lineMap.get(req.ref)
    if (!line) {
      throw new ReturnError('Item retur tidak ditemukan pada nota ini.', 'LINE_NOT_FOUND', 400)
    }
    const qty = num(req.qty)
    // Fractional quantities are only allowed when returning the exact remainder (weighted goods).
    if (!Number.isInteger(qty) && Math.abs(qty - line.remainingQty) > 1e-9) {
      throw new ReturnError(`Qty retur "${line.name}" harus bilangan bulat.`, 'QTY_INVALID', 400)
    }
    if (qty > line.remainingQty + 1e-9) {
      throw new ReturnError(
        `Qty retur "${line.name}" (${qty}) melebihi sisa yang dapat diretur (${line.remainingQty}).`,
        'QTY_EXCEEDED',
        400
      )
    }

    const lineRefund = lineRefundFor(line, qty)
    const tracked = Boolean(line.productId && input.trackedProductIds?.has(line.productId))
    items.push({
      ref: line.ref,
      productId: line.productId,
      variantId: line.variantId,
      name: line.name,
      variantName: line.variantName,
      qty,
      unitNetPrice: qty > 0 ? round(lineRefund / qty) : 0,
      lineRefund,
      unitCost: tracked ? line.unitCost : 0,
      disposition: req.disposition
    })
  }

  const grossRefund = items.reduce((s, i) => s + i.lineRefund, 0)

  const reasonDef = RETURN_REASON_MAP[input.reasonCode]
  const feePct = num(input.policy.restocking_fee_pct)
  const restockingFee =
    feePct > 0 && !(reasonDef?.waiveFee) ? round((grossRefund * feePct) / 100) : 0

  const creditValue = grossRefund - restockingFee

  const exchangeTotal = (input.exchange || []).reduce(
    (s, e) => s + round(num(e.unitPrice) * num(e.quantity)),
    0
  )

  const gt = num(input.order.grand_total)
  const paidBefore = Math.max(0, num(input.order.amount_paid))
  const dueBefore = Math.max(0, gt - paidBefore)

  const newGrandTotal = Math.max(0, gt - grossRefund + restockingFee + exchangeTotal)
  const refundOut = Math.max(0, paidBefore - newGrandTotal)
  const shortfall = Math.max(0, newGrandTotal - paidBefore)

  // Full return = nothing left to return on any original line AND no exchange.
  const touched = new Map(items.map((i) => [i.ref, i.qty]))
  const allReturned = input.lines.every((l) => l.remainingQty - (touched.get(l.ref) || 0) <= 1e-9)
  const hasExchange = (input.exchange || []).length > 0
  const isFull = allReturned && !hasExchange

  return {
    items,
    grossRefund,
    restockingFee,
    creditValue,
    exchangeTotal,
    newGrandTotal,
    paidBefore,
    dueBefore,
    refundOut,
    shortfall,
    dueAfter: 0, // finalized by finalizeSettlement()
    isFull,
    returnStatus: isFull ? 'full' : 'partial',
    hasExchange
  }
}

// ─── 5. Settlement ────────────────────────────────────────────────────────────

export interface PaymentRow {
  id?: string
  payment_kind: 'payment' | 'refund' | 'void' | string
  amount: number
  payment_method: string
  payment_method_account_id: string | null
  created_at?: string
}

export interface TenderGroup {
  method: string
  accountId: string | null
  net: number
  lastAt: number
}

/** Net money still held per tender (payments − refunds − voids), newest tender first. */
export function groupTenders(rows: PaymentRow[]): TenderGroup[] {
  const map = new Map<string, TenderGroup>()
  for (const r of rows) {
    const method = String(r.payment_method || 'cash').toLowerCase()
    const key = `${method}|${r.payment_method_account_id || ''}`
    const g = map.get(key) || { method, accountId: r.payment_method_account_id || null, net: 0, lastAt: 0 }
    const amt = num(r.amount)
    if (r.payment_kind === 'payment') {
      g.net += amt
      const t = r.created_at ? new Date(r.created_at).getTime() : 0
      if (Number.isFinite(t) && t > g.lastAt) g.lastAt = t
    } else if (r.payment_kind === 'refund' || r.payment_kind === 'void') {
      g.net -= amt
    }
    map.set(key, g)
  }
  return Array.from(map.values())
    .filter((g) => g.net > 0.5)
    .sort((a, b) => b.lastAt - a.lastAt)
}

export interface AccountIds {
  cashDefault: string
  bankDefault: string
  receivable: string
  salesReturns: string
  otherIncome: string
  sales: string
  cogs: string
  inventory: string
  storeCredit: string
}

const isCashMethod = (m: string) => {
  const s = String(m || '').toLowerCase()
  return s === 'cash' || s.includes('tunai')
}

export interface RefundRequest {
  method: RefundMethod
  /** Required when method === 'custom'. */
  lines?: Array<{ method: string; accountId?: string | null; amount: number }>
}

export function buildRefundLines(params: {
  amount: number
  request: RefundRequest
  tenders: TenderGroup[]
  accounts: AccountIds
  cashAccountId: string
  allowStoreCredit: boolean
  hasNamedCustomer: boolean
}): SettlementLine[] {
  const { amount, request, tenders, accounts, cashAccountId } = params
  if (amount <= 0.5) return []

  const cashLine = (amt: number): SettlementLine => ({
    kind: 'cash', method: 'cash', accountId: cashAccountId, amount: amt, label: 'Tunai (Laci Kasir)'
  })
  const scLine = (amt: number): SettlementLine => ({
    kind: 'store_credit', method: 'store_credit', accountId: accounts.storeCredit, amount: amt, label: 'Saldo Kredit Toko'
  })

  const ensureStoreCreditAllowed = () => {
    if (!params.allowStoreCredit) {
      throw new ReturnError('Saldo kredit toko dinonaktifkan pada pengaturan retur.', 'STORE_CREDIT_DISABLED', 400)
    }
    if (!params.hasNamedCustomer) {
      throw new ReturnError('Saldo kredit toko hanya untuk pelanggan terdaftar (bukan tamu).', 'STORE_CREDIT_NEEDS_CUSTOMER', 400)
    }
  }

  if (request.method === 'cash') return [cashLine(amount)]

  if (request.method === 'store_credit') {
    ensureStoreCreditAllowed()
    return [scLine(amount)]
  }

  if (request.method === 'custom') {
    const custom = (request.lines || []).filter((l) => num(l.amount) > 0)
    const total = custom.reduce((s, l) => s + round(num(l.amount)), 0)
    if (Math.abs(total - amount) > 1) {
      throw new ReturnError(
        `Total rincian refund (${total}) harus sama dengan nilai refund (${amount}).`,
        'REFUND_SPLIT_MISMATCH',
        400
      )
    }
    return custom.map((l) => {
      const method = String(l.method || 'cash').toLowerCase()
      if (method === 'store_credit') {
        ensureStoreCreditAllowed()
        return scLine(round(num(l.amount)))
      }
      if (isCashMethod(method)) return cashLine(round(num(l.amount)))
      return {
        kind: 'bank' as const,
        method,
        accountId: l.accountId || accounts.bankDefault,
        amount: round(num(l.amount)),
        label: method.toUpperCase()
      }
    })
  }

  // 'original' — reverse each original tender (newest first), capped by what it still holds.
  const lines: SettlementLine[] = []
  let left = amount
  for (const t of tenders) {
    if (left <= 0.5) break
    const take = Math.min(left, t.net)
    if (take <= 0.5) continue
    if (isCashMethod(t.method)) {
      lines.push({ ...cashLine(round(take)), accountId: t.accountId || cashAccountId })
    } else if (t.method === 'store_credit') {
      // Original tender was store credit → give the credit back as store credit.
      lines.push(scLine(round(take)))
    } else {
      lines.push({
        kind: 'bank',
        method: t.method,
        accountId: t.accountId || accounts.bankDefault,
        amount: round(take),
        label: t.method.toUpperCase()
      })
    }
    left -= take
  }
  if (left > 0.5) lines.push(cashLine(round(left)))
  return lines
}

// ─── 6. Journal ───────────────────────────────────────────────────────────────

export interface JournalLine {
  account_id: string
  debit: number
  credit: number
}

export function buildReturnJournal(params: {
  quote: ReturnQuote
  accounts: AccountIds
  refundLines: SettlementLine[]
  paymentInLines: SettlementLine[]
  /** Cost of replacement items leaving the shelf (tracked only). */
  exchangeCost: number
}): JournalLine[] {
  const { quote, accounts, refundLines, paymentInLines, exchangeCost } = params
  const lines: JournalLine[] = []
  const dr = (account_id: string, amount: number) => {
    if (amount > 0.001) lines.push({ account_id, debit: round(amount), credit: 0 })
  }
  const cr = (account_id: string, amount: number) => {
    if (amount > 0.001) lines.push({ account_id, debit: 0, credit: round(amount) })
  }

  dr(accounts.salesReturns, quote.grossRefund)
  cr(accounts.otherIncome, quote.restockingFee)
  cr(accounts.sales, quote.exchangeTotal)

  // Inventory / COGS: restock & quarantine come back at cost; write-off keeps the COGS as loss.
  const returnedCost = quote.items
    .filter((i) => i.disposition !== 'writeoff')
    .reduce((s, i) => s + i.unitCost * i.qty, 0)
  const net = round(returnedCost) - round(exchangeCost)
  if (net > 0) {
    dr(accounts.inventory, net)
    cr(accounts.cogs, net)
  } else if (net < 0) {
    dr(accounts.cogs, -net)
    cr(accounts.inventory, -net)
  }

  for (const l of refundLines) cr(l.accountId || accounts.cashDefault, l.amount)
  for (const l of paymentInLines) dr(l.accountId || accounts.cashDefault, l.amount)

  const totalDr = lines.reduce((s, l) => s + l.debit, 0)
  const totalCr = lines.reduce((s, l) => s + l.credit, 0)
  const diff = totalDr - totalCr
  // Receivable is the balancing plug (decreases when debit-heavy).
  if (diff > 0) cr(accounts.receivable, diff)
  else if (diff < 0) dr(accounts.receivable, -diff)

  return lines
}

/** Validates the exchange upcharge rule: no new unsecured debt is created. */
export function finalizeSettlement(quote: ReturnQuote, paymentInTotal: number): ReturnQuote {
  const pay = round(paymentInTotal)
  if (pay > quote.shortfall + 1) {
    throw new ReturnError(
      `Pembayaran selisih (${pay}) melebihi kekurangan yang harus dibayar (${quote.shortfall}).`,
      'OVERPAYMENT',
      400
    )
  }
  const paidAfter = quote.paidBefore - quote.refundOut + pay
  const dueAfter = Math.max(0, quote.newGrandTotal - paidAfter)
  if (dueAfter > quote.dueBefore + 1) {
    throw new ReturnError(
      `Selisih tukar tambah Rp ${quote.shortfall.toLocaleString('id-ID')} harus dibayar lunas saat ini.`,
      'UPCHARGE_UNPAID',
      400
    )
  }
  return { ...quote, dueAfter }
}

export function generateReturnNumber(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  const tail = now.getTime().toString(36).slice(-3).toUpperCase()
  return `RET-${y}${m}${d}-${tail}${rand}`
}

export type { ReturnDisposition }
