import { SupabaseClient } from '@supabase/supabase-js'

export type MoveType = 'receipt' | 'delivery' | 'transfer' | 'adjustment' | 'refund'
export type MoveStatus = 'done' | 'pending' | 'cancelled'

export interface StockMoveInput {
  businessId: string
  productId: string
  reference: string
  qty: number
  unitCost: number
  type: MoveType
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
  if (!moves || moves.length === 0) return { inserted: 0 }

  const businessId = moves[0].businessId
  const reference = moves[0].reference
  const productIds = moves.map(m => m.productId)

  // Batch Idempotency Check: avoid duplicate movement rows for same reference + product + type
  const { data: existing } = await supabase
    .from('stock_moves')
    .select('product_id, type')
    .eq('business_id', businessId)
    .eq('reference', reference)
    .in('product_id', productIds)

  const existingKeySet = new Set((existing || []).map(e => `${e.product_id}_${e.type}`))

  const newMoveRows = moves
    .filter(m => !existingKeySet.has(`${m.productId}_${m.type}`))
    .map(m => ({
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
    }))

  if (newMoveRows.length === 0) return { inserted: 0 }

  const { error } = await supabase
    .from('stock_moves')
    .insert(newMoveRows)

  if (error) {
    console.error('[StockLedger] Failed to record stock movements:', error.message)
    return { inserted: 0, error: error.message }
  }

  return { inserted: newMoveRows.length }
}
