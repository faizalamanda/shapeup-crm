import { SupabaseClient } from '@supabase/supabase-js'

export type MoveType = 'receipt' | 'delivery' | 'transfer' | 'adjustment' | 'refund'
export type MoveStatus = 'done' | 'pending' | 'cancelled'
export type MoveSourceType = 'purchase' | 'order' | 'stock_opname' | 'refund' | 'manual'

export interface StockMoveInput {
  businessId: string
  productId: string
  reference: string
  qty: number
  unitCost: number
  type: MoveType
  /** Stable ID of the business document that produced this movement. */
  sourceType?: MoveSourceType
  sourceId?: string
  status?: MoveStatus
  originLocationId?: string | null
  destinationLocationId?: string | null
  lotNumber?: string | null
  createdAt?: string
}

/**
 * Reusable SaaS Stock Movement Ledger Module.
 * Idempotently records stock movements into public.stock_moves.
 * 
 * Used across:
 * - lib/inventoryHelper.ts (POS Checkout & Invoices)
 * - app/api/purchases/route.ts (Vendor Receipts)
 * - app/api/stock-opname/route.ts (Stock Adjustments)
 * - app/api/pos/refund/route.ts (Stock Refunds)
 */
export async function recordStockMovements(
  moves: StockMoveInput[],
  supabase: SupabaseClient
) {
  if (!moves || moves.length === 0) return { inserted: 0, insertedProductIds: [] }

  const businessId = moves[0].businessId
  const reference = moves[0].reference
  const productIds = moves.map(m => m.productId)

  if (moves.some(m => m.businessId !== businessId)) {
    throw new Error('All stock movements in a batch must belong to one business')
  }

  const sourceType = moves[0].sourceType
  const sourceId = moves[0].sourceId
  if (moves.some(m => m.sourceType !== sourceType || m.sourceId !== sourceId)) {
    throw new Error('All stock movements in a batch must share one source')
  }

  // A document UUID is the primary idempotency key. Reference is retained only
  // A document UUID is the primary idempotency key. Reference is retained only
  // for display and for older callers that do not yet have a source document.
  let existingMovesData: any[] = []
  if (sourceType && sourceId) {
    const [{ data: existingBySource }, { data: existingByRef }] = await Promise.all([
      supabase
        .from('stock_moves')
        .select('product_id, type, source_type, source_id, reference')
        .eq('business_id', businessId)
        .in('product_id', productIds)
        .eq('source_type', sourceType)
        .eq('source_id', sourceId),
      supabase
        .from('stock_moves')
        .select('product_id, type, source_type, source_id, reference')
        .eq('business_id', businessId)
        .in('product_id', productIds)
        .eq('reference', reference)
    ])
    existingMovesData = [...(existingBySource || []), ...(existingByRef || [])]
  } else {
    const { data: existing } = await supabase
      .from('stock_moves')
      .select('product_id, type, source_type, source_id, reference')
      .eq('business_id', businessId)
      .in('product_id', productIds)
      .eq('reference', reference)
    existingMovesData = existing || []
  }

  const existingKeySet = new Set(
    existingMovesData.flatMap(e => [
      e.source_type && e.source_id ? `${e.product_id}_${e.source_type}_${e.source_id}_${e.type}` : null,
      e.reference ? `${e.product_id}_${e.reference}_${e.type}` : null
    ]).filter(Boolean)
  )

  const buildRows = (includeSource: boolean) => {
    return moves
      .filter(m => {
        const keyBySource = m.sourceType && m.sourceId ? `${m.productId}_${m.sourceType}_${m.sourceId}_${m.type}` : null
        const keyByRef = m.reference ? `${m.productId}_${m.reference}_${m.type}` : null
        if (keyBySource && existingKeySet.has(keyBySource)) return false
        if (keyByRef && existingKeySet.has(keyByRef)) return false
        return true
      })
      .map(m => {
        const row: Record<string, any> = {
          business_id: m.businessId,
          product_id: m.productId,
          reference: m.reference,
          qty: Math.abs(m.qty),
          unit_cost: m.unitCost || 0,
          status: m.status || 'done',
          type: m.type,
          origin_location_id: m.originLocationId || null,
          destination_location_id: m.destinationLocationId || null,
          lot_number: m.lotNumber || null,
          created_at: m.createdAt || new Date().toISOString()
        }
        if (includeSource && m.sourceType) row.source_type = m.sourceType
        if (includeSource && m.sourceId) row.source_id = m.sourceId
        return row
      })
  }

  let newMoveRows = buildRows(true)
  if (newMoveRows.length === 0) return { inserted: 0, insertedProductIds: [] }

  let { error } = await supabase
    .from('stock_moves')
    .insert(newMoveRows)

  // If DB does not have source_type / source_id columns yet, fallback to inserting without them
  if (error && error.code === 'PGRST204') {
    newMoveRows = buildRows(false)
    if (newMoveRows.length === 0) return { inserted: 0, insertedProductIds: [] }
    const fallbackRes = await supabase
      .from('stock_moves')
      .insert(newMoveRows)
    error = fallbackRes.error
  }

  if (error) {
    console.error('[StockLedger] Failed to record stock movements:', error.message)
    return { inserted: 0, insertedProductIds: [], error: error.message }
  }

  const insertedProductIds = Array.from(new Set(newMoveRows.map(r => r.product_id)))
  return { inserted: newMoveRows.length, insertedProductIds }
}
