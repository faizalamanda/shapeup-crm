import { SupabaseClient } from '@supabase/supabase-js'
import { recordStockMovements, StockMoveInput } from './stockLedger'

export type RecipeIngredient = {
  id?: string
  business_id?: string
  product_id?: string
  ingredient_product_id: string
  quantity: number
  unit: string
  notes?: string | null
  ingredient?: {
    id: string
    name: string
    cost_price: number
    stock_type: string
    stock_quantity: number
    unit: string
  }
}

export type ProductHppResult = {
  isVariable: boolean
  unitHpp: number
  ingredients: RecipeIngredient[]
}

// ─── HPP Batch Cache (TTL 60 seconds) ─────────────────────────────────────
// Recipe data rarely changes (biasanya 1x/hari), aman di-cache untuk
// menghilangkan query ke product_recipes pada transaksi POS berturut-turut.

interface HppProductCacheEntry {
  data: ProductHppResult
  expiresAt: number
}

const hppProductCache = new Map<string, HppProductCacheEntry>()
const HPP_CACHE_TTL = 60_000 // 60 seconds

/**
 * Invalidate HPP cache. Call this when recipes or ingredient cost_price change.
 */
export function invalidateHppCache() {
  hppProductCache.clear()
}

/**
 * Calculates dynamic HPP for multiple products in a SINGLE batch query.
 * Results are cached per product ID (60s TTL) so any cart combination gets instant cache hits.
 * Returns Map<productId, ProductHppResult>
 */
export async function calculateProductsHppBatch(
  productIds: string[],
  supabase: SupabaseClient
): Promise<Map<string, ProductHppResult>> {
  const result = new Map<string, ProductHppResult>()
  const validIds = Array.from(new Set(productIds.filter(Boolean)))
  if (validIds.length === 0) return result

  // 1. Resolve per-product cache hits and collect only missing IDs
  const now = Date.now()
  const missingIds: string[] = []
  for (const pId of validIds) {
    const cached = hppProductCache.get(pId)
    if (cached && cached.expiresAt > now) {
      result.set(pId, cached.data)
    } else {
      missingIds.push(pId)
    }
  }

  if (missingIds.length === 0) {
    return result
  }

  // Periodic cache cleanup
  if (hppProductCache.size > 500) {
    for (const [k, v] of hppProductCache.entries()) {
      if (v.expiresAt <= now) hppProductCache.delete(k)
    }
  }

  try {
    const { data: recipes, error } = await supabase
      .from('product_recipes')
      .select('id, business_id, product_id, ingredient_product_id, quantity, unit, notes, ingredient:products!ingredient_product_id(id, name, cost_price, stock_type, stock_quantity, unit)')
      .in('product_id', missingIds)

    if (error || !recipes) {
      console.error('Error in calculateProductsHppBatch:', error)
      return result
    }

    const grouped = new Map<string, any[]>()
    for (const r of recipes) {
      const pId = r.product_id
      if (!grouped.has(pId)) grouped.set(pId, [])
      grouped.get(pId)!.push(r)
    }

    const expiresAt = Date.now() + HPP_CACHE_TTL
    for (const pId of missingIds) {
      const pRecipes = grouped.get(pId)
      if (!pRecipes || pRecipes.length === 0) {
        const emptyRes: ProductHppResult = { isVariable: false, unitHpp: 0, ingredients: [] }
        result.set(pId, emptyRes)
        hppProductCache.set(pId, { data: emptyRes, expiresAt })
        continue
      }

      let unitHpp = 0
      const formattedRecipes: RecipeIngredient[] = []

      for (const r of pRecipes) {
        const ingObj = Array.isArray(r.ingredient) ? r.ingredient[0] : r.ingredient
        const ingCost = Number(ingObj?.cost_price || 0)
        const qty = Number(r.quantity || 0)
        unitHpp += ingCost * qty

        formattedRecipes.push({
          id: r.id,
          business_id: r.business_id,
          product_id: r.product_id,
          ingredient_product_id: r.ingredient_product_id,
          quantity: qty,
          unit: r.unit || 'pcs',
          notes: r.notes,
          ingredient: ingObj ? {
            id: ingObj.id,
            name: ingObj.name,
            cost_price: Number(ingObj.cost_price || 0),
            stock_type: ingObj.stock_type,
            stock_quantity: Number(ingObj.stock_quantity || 0),
            unit: ingObj.unit || 'pcs'
          } : undefined
        })
      }

      const prodRes: ProductHppResult = { isVariable: true, unitHpp, ingredients: formattedRecipes }
      result.set(pId, prodRes)
      hppProductCache.set(pId, { data: prodRes, expiresAt })
    }

    return result
  } catch (err) {
    console.error('Error in calculateProductsHppBatch execution:', err)
    return result
  }
}

/**
 * Calculates dynamic HPP for a product based on its recipe ingredients.
 * Returns { isVariable: boolean, unitHpp: number, ingredients: RecipeIngredient[] }
 */

export async function calculateProductHpp(
  productId: string,
  supabase: SupabaseClient
): Promise<{ isVariable: boolean; unitHpp: number; ingredients: RecipeIngredient[] }> {
  if (!productId) return { isVariable: false, unitHpp: 0, ingredients: [] }

  try {
    const { data: recipes, error } = await supabase
      .from('product_recipes')
      .select('id, business_id, product_id, ingredient_product_id, quantity, unit, notes, ingredient:products!ingredient_product_id(id, name, cost_price, stock_type, stock_quantity, unit)')
      .eq('product_id', productId)

    if (error || !recipes || recipes.length === 0) {
      return { isVariable: false, unitHpp: 0, ingredients: [] }
    }

    let unitHpp = 0
    const formattedRecipes: RecipeIngredient[] = []

    for (const r of recipes) {
      const ingObj = Array.isArray(r.ingredient) ? r.ingredient[0] : r.ingredient
      const ingCost = Number(ingObj?.cost_price || 0)
      const qty = Number(r.quantity || 0)
      unitHpp += ingCost * qty

      formattedRecipes.push({
        id: r.id,
        business_id: r.business_id,
        product_id: r.product_id,
        ingredient_product_id: r.ingredient_product_id,
        quantity: qty,
        unit: r.unit || 'pcs',
        notes: r.notes,
        ingredient: ingObj ? {
          id: ingObj.id,
          name: ingObj.name,
          cost_price: Number(ingObj.cost_price || 0),
          stock_type: ingObj.stock_type,
          stock_quantity: Number(ingObj.stock_quantity || 0),
          unit: ingObj.unit || 'pcs'
        } : undefined
      })
    }

    return { isVariable: true, unitHpp, ingredients: formattedRecipes }
  } catch (err) {
    console.error(`Error calculating recipe HPP for product ${productId}:`, err)
    return { isVariable: false, unitHpp: 0, ingredients: [] }
  }
}

/**
 * Restocks inventory upon refund/cancellation of an order.
 * Restocks raw materials for Variable HPP products, or product stock for Fixed HPP.
 */
export async function processOrderInventoryRestock(
  productId: string,
  refundQuantity: number,
  supabase: SupabaseClient,
  reference?: string,
  orderId?: string
): Promise<void> {
  if (!productId || refundQuantity <= 0) return

  try {
    const { isVariable, ingredients } = await calculateProductHpp(productId, supabase)

    const { data: mainProd } = await supabase
      .from('products')
      .select('id, business_id, cost_price, stock_type, stock_quantity')
      .eq('id', productId)
      .single()

    if (!mainProd) return

    const stockMoveInputs: StockMoveInput[] = []
    const refStr = reference || `REFUND-${productId.slice(0, 6)}`

    if (isVariable && ingredients.length > 0) {
      for (const recipe of ingredients) {
        const ingProd = recipe.ingredient
        if (ingProd && ingProd.stock_type === 'tracked') {
          const addQty = Number(recipe.quantity) * Number(refundQuantity)
          stockMoveInputs.push({
            businessId: mainProd.business_id,
            productId: ingProd.id,
            reference: refStr,
            qty: addQty,
            unitCost: Number(ingProd.cost_price || 0),
            type: 'refund',
            sourceType: 'refund',
            sourceId: orderId,
            status: 'done'
          })
        }
      }
    } else if (mainProd.stock_type === 'tracked') {
      stockMoveInputs.push({
        businessId: mainProd.business_id,
        productId: mainProd.id,
        reference: refStr,
        qty: Number(refundQuantity),
        unitCost: Number(mainProd.cost_price || 0),
        type: 'refund',
        sourceType: 'refund',
        sourceId: orderId,
        status: 'done'
      })
    }

    if (stockMoveInputs.length > 0) {
      await recordStockMovements(stockMoveInputs, supabase)
    }
  } catch (err) {
    console.error(`Error in processOrderInventoryRestock for product ${productId}:`, err)
  }
}
