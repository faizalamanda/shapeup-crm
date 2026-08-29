import { SupabaseClient } from '@supabase/supabase-js'
import { calculateProductHpp } from './recipeHelper'

export interface ItemizedHppInput {
  item: {
    name?: string
    sku?: string
    quantity?: number | string
    price?: number | string
    total?: number | string
    cost_of_goods_sold?: any
    meta_data?: any[]
    product_id?: string
  }
  dbProduct?: {
    id: string
    name: string
    sku?: string | null
    type?: string
    stock_type?: string
    cost_price: number
    stock_quantity?: number
    unit?: string
  } | null
}

export interface ItemizedHppBreakdown {
  productId: string | null
  productName: string
  sku: string | null
  qty: number
  unitCost: number
  totalCost: number
  isVariableHpp: boolean
}

export interface ItemizedHppLineResult {
  journalLines: Array<{
    transaction_id: string
    account_id: string
    debit: number
    credit: number
    description: string
  }>
  totalCogs: number
  itemizedBreakdown: ItemizedHppBreakdown[]
}

/**
 * Format currency IDR for Odoo-style line descriptions
 */
function formatAmount(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0
  }).format(Math.round(amount))
}

/**
 * World-Class Odoo-Style Itemized HPP & Inventory Journal Lines Helper.
 * Generates itemized Debit HPP & Credit Persediaan journal lines with Odoo ERP standard formatting:
 * `[SKU] Nama Produk - {Qty} {Unit} @ Rp {Cost}`
 *
 * @param itemsWithProducts Array of order item and matched DB product
 * @param accountMap COA mapping containing '501000' (HPP) & '102000' (Persediaan Barang)
 * @param transactionId Header transaction ID
 * @param supabase Optional Supabase client to resolve recipe / Variable HPP
 */
export async function generateItemizedHppJournalLines(
  itemsWithProducts: ItemizedHppInput[],
  accountMap: Record<string, string>,
  transactionId: string,
  supabase?: SupabaseClient
): Promise<ItemizedHppLineResult> {
  const hppAccountId = accountMap['501000']
  const inventoryAccountId = accountMap['102000']

  const journalLines: ItemizedHppLineResult['journalLines'] = []
  const itemizedBreakdown: ItemizedHppBreakdown[] = []
  let totalCogs = 0

  if (!hppAccountId || !inventoryAccountId) {
    console.warn('[hppHelper] Missing HPP (501000) or Inventory (102000) account mapping.')
    return { journalLines: [], totalCogs: 0, itemizedBreakdown: [] }
  }

  for (const { item, dbProduct } of itemsWithProducts) {
    const qty = Math.max(1, parseFloat(String(item.quantity || 1)) || 1)
    const prodName = dbProduct?.name || item.name || 'Produk'
    const sku = dbProduct?.sku || item.sku || null
    const prodType = dbProduct?.type || 'physical'
    const unit = dbProduct?.unit || 'Pcs'

    // Skip non-physical items (e.g. services / digital)
    if (prodType !== 'physical') continue

    let effectiveCost = Number(dbProduct?.cost_price || 0)
    let isVariableHpp = false

    // Check if dynamic recipe / Variable HPP calculation applies
    if (dbProduct?.id && supabase) {
      const { isVariable, unitHpp } = await calculateProductHpp(dbProduct.id, supabase)
      if (isVariable && unitHpp > 0) {
        effectiveCost = unitHpp
        isVariableHpp = true
      }
    }

    // Fallback: If cost_price is missing or 0, try extraction from item metadata or 50% default
    if (effectiveCost <= 0) {
      if (item.cost_of_goods_sold && typeof item.cost_of_goods_sold === 'object') {
        const val = parseFloat(item.cost_of_goods_sold.value)
        if (!isNaN(val) && val > 0) effectiveCost = val
      }

      if (effectiveCost <= 0 && Array.isArray(item.meta_data)) {
        const cogMeta = item.meta_data.find((m: any) =>
          ['_wc_cog_item_cost', '_cog_item_cost', 'cost_price', 'cost', 'hpp'].includes(m.key)
        )
        if (cogMeta) {
          const val = parseFloat(cogMeta.value)
          if (!isNaN(val) && val > 0) effectiveCost = val
        }
      }

      if (effectiveCost <= 0) {
        const itemPrice = parseFloat(String(item.price || item.total || 0)) || 0
        if (itemPrice > 0) {
          effectiveCost = itemPrice * 0.5
        }
      }
    }

    const itemTotalCogs = effectiveCost * qty
    if (itemTotalCogs <= 0) continue

    totalCogs += itemTotalCogs

    // Odoo-style Label Format: [SKU] Nama Produk - Qty Unit @ Rp Cost
    const skuTag = sku ? `[${sku}] ` : ''
    const odooLabel = `${skuTag}${prodName} - ${qty} ${unit} @ Rp ${formatAmount(effectiveCost)}`

    // Debit Line: HPP (Cost of Goods Sold)
    journalLines.push({
      transaction_id: transactionId,
      account_id: hppAccountId,
      debit: itemTotalCogs,
      credit: 0,
      description: `HPP - ${odooLabel}`
    })

    // Credit Line: Persediaan Barang (Stock Valuation)
    journalLines.push({
      transaction_id: transactionId,
      account_id: inventoryAccountId,
      debit: 0,
      credit: itemTotalCogs,
      description: `Persediaan Barang - ${odooLabel}`
    })

    itemizedBreakdown.push({
      productId: dbProduct?.id || null,
      productName: prodName,
      sku: sku || null,
      qty: qty,
      unitCost: effectiveCost,
      totalCost: itemTotalCogs,
      isVariableHpp: isVariableHpp
    })
  }

  return {
    journalLines,
    totalCogs,
    itemizedBreakdown
  }
}
