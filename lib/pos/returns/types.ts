// ShapeUp POS Returns Engine — shared types & constants (client + server safe).

export type ReturnDisposition = 'restock' | 'quarantine' | 'writeoff'

export type ReturnReasonCode =
  | 'wrong_size'
  | 'defective'
  | 'not_as_described'
  | 'changed_mind'
  | 'cashier_error'
  | 'other'

export interface ReturnReasonDef {
  code: ReturnReasonCode
  label: string
  /** Store-fault reasons waive the restocking fee. */
  waiveFee: boolean
  /** Suggested physical disposition for the returned goods. */
  suggestedDisposition: ReturnDisposition
}

export const RETURN_REASONS: ReturnReasonDef[] = [
  { code: 'wrong_size', label: 'Salah ukuran / model', waiveFee: false, suggestedDisposition: 'restock' },
  { code: 'defective', label: 'Rusak / cacat produk', waiveFee: true, suggestedDisposition: 'quarantine' },
  { code: 'not_as_described', label: 'Tidak sesuai deskripsi', waiveFee: true, suggestedDisposition: 'restock' },
  { code: 'changed_mind', label: 'Berubah pikiran', waiveFee: false, suggestedDisposition: 'restock' },
  { code: 'cashier_error', label: 'Salah input kasir', waiveFee: true, suggestedDisposition: 'restock' },
  { code: 'other', label: 'Lainnya', waiveFee: false, suggestedDisposition: 'restock' }
]

export const RETURN_REASON_MAP: Record<string, ReturnReasonDef> = Object.fromEntries(
  RETURN_REASONS.map((r) => [r.code, r])
)

export const DISPOSITION_LABELS: Record<ReturnDisposition, string> = {
  restock: 'Kembali ke rak (siap jual)',
  quarantine: 'Karantina (inspeksi)',
  writeoff: 'Buang / Write-off'
}

export type ApprovalMode = 'off' | 'always' | 'above_amount' | 'non_admin'

export interface ReturnPolicy {
  business_id: string
  return_window_days: number
  require_reason: boolean
  approval_mode: ApprovalMode
  approval_threshold: number
  restocking_fee_pct: number
  allow_store_credit: boolean
  default_disposition: ReturnDisposition
}

export const DEFAULT_RETURN_POLICY: Omit<ReturnPolicy, 'business_id'> = {
  return_window_days: 0,
  require_reason: true,
  approval_mode: 'off',
  approval_threshold: 0,
  restocking_fee_pct: 0,
  allow_store_credit: true,
  default_disposition: 'restock'
}

export type RefundMethod = 'original' | 'cash' | 'store_credit' | 'custom'

export type TenderKind = 'cash' | 'bank' | 'store_credit'

export interface SettlementLine {
  kind: TenderKind
  /** order_payments.payment_method value ('cash' | 'qris' | 'bank' | 'store_credit' | ...) */
  method: string
  accountId: string | null
  amount: number
  label: string
}

/** A returnable line of the original order (after subtracting previous returns). */
export interface ReturnableLine {
  ref: string
  productId: string | null
  variantId: string | null
  name: string
  variantName: string | null
  quantity: number
  returnedQty: number
  remainingQty: number
  /** Net value of the full line after item discount and global discount proration. */
  lineNet: number
  refundedAmount: number
  unitCost: number
  isCustom: boolean
  isReplacement: boolean
}

export interface ReturnRequestItem {
  ref: string
  qty: number
  disposition: ReturnDisposition
}

export interface ExchangeItemInput {
  productId: string
  variantId?: string | null
  name: string
  variantName?: string | null
  quantity: number
  unitPrice: number
}

export interface QuotedReturnItem {
  ref: string
  productId: string | null
  variantId: string | null
  name: string
  variantName: string | null
  qty: number
  unitNetPrice: number
  lineRefund: number
  unitCost: number
  disposition: ReturnDisposition
}

export interface ReturnQuote {
  items: QuotedReturnItem[]
  grossRefund: number
  restockingFee: number
  creditValue: number
  exchangeTotal: number
  newGrandTotal: number
  paidBefore: number
  dueBefore: number
  /** Money (or store credit) handed back to the customer. */
  refundOut: number
  /** Extra amount the customer must settle now (exchange upcharge). */
  shortfall: number
  /** Remaining open receivable after this operation. */
  dueAfter: number
  isFull: boolean
  returnStatus: 'partial' | 'full'
  hasExchange: boolean
}

export class ReturnError extends Error {
  status: number
  code: string
  constructor(message: string, code = 'RETURN_ERROR', status = 400) {
    super(message)
    this.name = 'ReturnError'
    this.code = code
    this.status = status
  }
}
