import { SupabaseClient } from '@supabase/supabase-js'
import { calculateProductHpp } from './recipeHelper'

const productCacheBySku: Record<string, Record<string, any>> = {}
const productCacheByName: Record<string, Record<string, any>> = {}

export async function resolveOrderProducts(
  items: any[],
  businessId: string,
  defaultHppPct: number,
  supabase: SupabaseClient
) {
  const matchedProducts: { item: any; dbProduct: any }[] = []

  for (const item of items) {
    let dbProd = null
    const sku = item.sku ? String(item.sku).trim() : ''
    const name = item.name ? String(item.name).trim() : ''

    // Check cache first
    if (sku && productCacheBySku[businessId]?.[sku]) {
      dbProd = productCacheBySku[businessId][sku]
    } else if (name && productCacheByName[businessId]?.[name.toLowerCase()]) {
      dbProd = productCacheByName[businessId][name.toLowerCase()]
    }

    // Priority 1: SKU
    if (sku) {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', businessId)
        .eq('sku', sku)
        .limit(1)
      if (data && data.length > 0) dbProd = data[0]
    }

    // Priority 2: Name
    if (!dbProd && name) {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', businessId)
        .ilike('name', name)
        .limit(1)
      if (data && data.length > 0) dbProd = data[0]
    }

    let extractedCostPrice = 0
    if (item.cost_of_goods_sold && typeof item.cost_of_goods_sold === 'object') {
      const val = parseFloat(item.cost_of_goods_sold.value)
      if (!isNaN(val) && val > 0) extractedCostPrice = val
    }
    if (extractedCostPrice <= 0 && Array.isArray(item.meta_data)) {
      const cogMeta = item.meta_data.find((m: any) => 
        ['_wc_cog_item_cost', '_cog_item_cost', 'cost_price', 'cost', 'hpp'].includes(m.key)
      )
      if (cogMeta) {
        const val = parseFloat(cogMeta.value)
        if (!isNaN(val) && val > 0) extractedCostPrice = val
      }
    }
    const itemPrice = parseFloat(item.price || item.total || 0) || 0
    if (extractedCostPrice <= 0 && defaultHppPct > 0) {
      extractedCostPrice = itemPrice * (defaultHppPct / 100)
    }

    // Auto-create product
    if (!dbProd && name) {
      const { data: newProd, error: newProdErr } = await supabase
        .from('products')
        .insert({
          business_id: businessId,
          name: name,
          sku: sku || null,
          price: itemPrice,
          cost_price: extractedCostPrice,
          type: 'physical',
          stock_type: 'tracked',
          stock_quantity: 0
        })
        .select('*')
        .single()
      if (newProdErr) {
        console.error(`Failed to auto-create product: ${newProdErr.message}`)
      } else {
        dbProd = newProd
      }
    }

    if (dbProd) {
      // Add/Update Cache
      if (!productCacheBySku[businessId]) productCacheBySku[businessId] = {}
      if (!productCacheByName[businessId]) productCacheByName[businessId] = {}
      if (dbProd.sku) productCacheBySku[businessId][dbProd.sku] = dbProd
      if (dbProd.name) productCacheByName[businessId][dbProd.name.toLowerCase()] = dbProd

      matchedProducts.push({ item, dbProduct: dbProd })
    }
  }

  return matchedProducts
}

export async function applyStockMovement(
  businessId: string,
  matchedProducts: { item: any; dbProduct: any }[],
  direction: 'deduct' | 'restore',
  reference: string,
  supabase: SupabaseClient
) {
  // Determine move type
  const moveType = direction === 'deduct' ? 'delivery' : 'receipt'

  for (const { item, dbProduct } of matchedProducts) {
    const itemQty = parseFloat(item.quantity) || 1

    // Check if product has Variable HPP (Recipe / Ingredients)
    const { isVariable, ingredients } = await calculateProductHpp(dbProduct.id, supabase)

    if (isVariable && ingredients.length > 0) {
      // Move ingredients
      for (const recipe of ingredients) {
        const ingProd = recipe.ingredient
        if (ingProd && ingProd.stock_type === 'tracked') {
          const neededQty = Number(recipe.quantity) * itemQty
          await recordStockMove(businessId, ingProd, neededQty, direction, reference, moveType, supabase)
        }
      }
    } else if (dbProduct.stock_type === 'tracked') {
      // Move physical product
      await recordStockMove(businessId, dbProduct, itemQty, direction, reference, moveType, supabase)
    }
  }
}

async function recordStockMove(
  businessId: string,
  dbProduct: any,
  qty: number,
  direction: 'deduct' | 'restore',
  reference: string,
  moveType: string,
  supabase: SupabaseClient
) {
  if (qty <= 0) return

  // Idempotency Check: check if stock_move already exists for this reference + product + moveType
  const { data: existingMoves } = await supabase
    .from('stock_moves')
    .select('id')
    .eq('business_id', businessId)
    .eq('product_id', dbProduct.id)
    .eq('reference', reference)
    .eq('type', moveType)
    .limit(1)

  if (existingMoves && existingMoves.length > 0) {
    // Stock already moved for this order, skip to prevent double deduction
    return
  }

  const delta = direction === 'deduct' ? -qty : qty
  const unitCost = Number(dbProduct.cost_price) || 0

  const { data: currentProd } = await supabase
    .from('products')
    .select('stock_quantity')
    .eq('id', dbProduct.id)
    .single()
  
  const currentStock = currentProd ? Number(currentProd.stock_quantity || 0) : 0
  const newStock = Math.max(0, currentStock + delta)

  const { error: stockErr } = await supabase
    .from('products')
    .update({ stock_quantity: newStock })
    .eq('id', dbProduct.id)

  if (stockErr) {
    console.error(`Failed to adjust stock for product ${dbProduct.id}: ${stockErr.message}`)
    return
  }

  // 2. Insert into stock_moves
  const { error: moveErr } = await supabase
    .from('stock_moves')
    .insert({
      business_id: businessId,
      product_id: dbProduct.id,
      reference: reference,
      qty: qty,
      unit_cost: unitCost,
      status: 'done',
      type: moveType
    })

  if (moveErr) {
    console.error(`Failed to insert stock move for ${dbProduct.id}: ${moveErr.message}`)
  }
}
