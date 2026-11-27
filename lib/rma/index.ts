/**
 * ShapeUp CRM — Unified Return, Credit Memo & RMA Module Entry Point
 * ("Sekali Edit, Berubah Semua" — Single Source of Truth across POS, Invoice, Orders, Webhooks, & Inventory)
 */

export * from './types'
export * from './rmaService'
export {
  buildDispositionInventoryLines,
  buildRefundLines,
  buildReturnJournal,
  computeReturnableLines,
  evaluateReturnPolicy,
  finalizeSettlement,
  groupTenders,
  lineRefundFor,
  parseOrderLines,
  quoteReturn
} from '@/lib/pos/returns/engine'
export { getReturnPolicy, saveReturnPolicy, invalidateReturnPolicyCache } from '@/lib/pos/returns/settings'

