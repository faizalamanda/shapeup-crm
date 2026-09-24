import { SupabaseClient } from '@supabase/supabase-js'
import { calculateProductHpp, calculateProductsHppBatch } from './recipeHelper'

const productCacheBySku: Record<string, Record<string, any>> = {}
const productCacheByName: Record<string, Record<string, any>> = {}
const productCacheById: Record<string, Record<string, any>> = {}

export async function resolveOrderProducts(
  items: any[],
  businessId: string,
  defaultHppPct: number,
  supabase: SupabaseClient
) {
  const matchedProducts: { item: any; dbProduct: any }[] = []
  if (!items || items.length === 0) return matchedProducts

  if (!productCacheBySku[businessId]) productCacheBySku[businessId] = {}
  if (!productCacheByName[businessId]) productCacheByName[businessId] = {}
  if (!productCacheById[businessId]) productCacheById[businessId] = {}

  // 1. Identify what needs to be fetched from DB
  const unCachedIds: string[] = []
  const unCachedSkus: string[] = []
  const unCachedNames: string[] = []

  for (const item of items) {
    const rawId = item.id || item.product_id
    const id = (rawId && !String(rawId).startsWith('custom-')) ? String(rawId) : ''
    const sku = item.sku ? String(item.sku).trim() : ''
    const name = item.name ? String(item.name).trim() : ''

    let cached = null
    if (id && productCacheById[businessId]?.[id]) {
      cached = productCacheById[businessId][id]
    } else if (sku && productCacheBySku[businessId]?.[sku]) {
      cached = productCacheBySku[businessId][sku]
    } else if (name && productCacheByName[businessId]?.[name.toLowerCase()]) {
      cached = productCacheByName[businessId][name.toLowerCase()]
    }

    if (!cached) {
      if (id && !unCachedIds.includes(id)) unCachedIds.push(id)
      if (sku && !unCachedSkus.includes(sku)) unCachedSkus.push(sku)
      if (name && !unCachedNames.includes(name)) unCachedNames.push(name)
    }
  }

  // 2. Batch fetch by ID, SKU, and Name
  if (unCachedIds.length > 0) {
    const { data: idProds } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .in('id', unCachedIds)
    if (idProds) {
      idProds.forEach(p => {
        if (p.sku) productCacheBySku[businessId][p.sku] = p
        if (p.name) productCacheByName[businessId][p.name.toLowerCase()] = p
        productCacheById[businessId][p.id] = p
      })
    }
  }

  const remainingSkus = unCachedSkus.filter(s => !productCacheBySku[businessId][s])
  if (remainingSkus.length > 0) {
    const { data: skuProds } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .in('sku', remainingSkus)
    if (skuProds) {
      skuProds.forEach(p => {
        if (p.sku) productCacheBySku[businessId][p.sku] = p
        if (p.name) productCacheByName[businessId][p.name.toLowerCase()] = p
        productCacheById[businessId][p.id] = p
      })
    }
  }

  const remainingNames = unCachedNames.filter(n => !productCacheByName[businessId][n.toLowerCase()])
  if (remainingNames.length > 0) {
    const { data: nameProds } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .in('name', remainingNames)
    if (nameProds) {
      nameProds.forEach(p => {
        if (p.sku) productCacheBySku[businessId][p.sku] = p
        if (p.name) productCacheByName[businessId][p.name.toLowerCase()] = p
        productCacheById[businessId][p.id] = p
      })
    }
  }

  // 3. Match items with DB products
  for (const item of items) {
    const rawId = item.id || item.product_id
    const id = (rawId && !String(rawId).startsWith('custom-')) ? String(rawId) : ''
    const sku = item.sku ? String(item.sku).trim() : ''
    const name = item.name ? String(item.name).trim() : ''

    let dbProd = (id && productCacheById[businessId]?.[id]) ||
                 (sku && productCacheBySku[businessId]?.[sku]) ||
                 (name && productCacheByName[businessId]?.[name.toLowerCase()]) || null

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
      if (dbProd.sku) productCacheBySku[businessId][dbProd.sku] = dbProd
      if (dbProd.name) productCacheByName[businessId][dbProd.name.toLowerCase()] = dbProd
      productCacheById[businessId][dbProd.id] = dbProd

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
  if (!matchedProducts || matchedProducts.length === 0) return

  const moveType = direction === 'deduct' ? 'delivery' : 'receipt'

  // 1. Batch fetch recipes for all matched products
  const productIds = matchedProducts.map(m => m.dbProduct.id)
  const hppMap = await calculateProductsHppBatch(productIds, supabase)

  // 2. Build target stock movements list
  const targetMoves = new Map<string, { dbProduct: any; qty: number }>()

  for (const { item, dbProduct } of matchedProducts) {
    const itemQty = parseFloat(item.quantity) || 1
    const hppInfo = hppMap.get(dbProduct.id)

    if (hppInfo?.isVariable && hppInfo.ingredients.length > 0) {
      for (const recipe of hppInfo.ingredients) {
        const ingProd = recipe.ingredient
        if (ingProd && ingProd.stock_type === 'tracked') {
          const neededQty = Number(recipe.quantity) * itemQty
          const current = targetMoves.get(ingProd.id)
          if (current) {
            current.qty += neededQty
          } else {
            targetMoves.set(ingProd.id, { dbProduct: ingProd, qty: neededQty })
          }
        }
      }
    } else if (dbProduct.stock_type === 'tracked') {
      const current = targetMoves.get(dbProduct.id)
      if (current) {
        current.qty += itemQty
      } else {
        targetMoves.set(dbProduct.id, { dbProduct, qty: itemQty })
      }
    }
  }

  if (targetMoves.size === 0) return

  const targetProductIds = Array.from(targetMoves.keys())

  // 3. Batch Idempotency Check
  const { data: existingMoves } = await supabase
    .from('stock_moves')
    .select('product_id')
    .eq('business_id', businessId)
    .eq('reference', reference)
    .eq('type', moveType)
    .in('product_id', targetProductIds)

  const existingSet = new Set((existingMoves || []).map(m => m.product_id))
  const remainingTargetIds = targetProductIds.filter(id => !existingSet.has(id))

  if (remainingTargetIds.length === 0) return

  // 4. Batch fetch current stock_quantity for remaining products
  const { data: currentProds } = await supabase
    .from('products')
    .select('id, stock_quantity, cost_price')
    .in('id', remainingTargetIds)

  const stockMap = new Map<string, { stock_quantity: number; cost_price: number }>()
  if (currentProds) {
    currentProds.forEach(p => {
      stockMap.set(p.id, {
        stock_quantity: Number(p.stock_quantity || 0),
        cost_price: Number(p.cost_price || 0)
      })
    })
  }

  // 5. Build parallel updates and batch insert records
  const updatePromises: Promise<any>[] = []
  const stockMoveInserts: any[] = []

  for (const pId of remainingTargetIds) {
    const moveInfo = targetMoves.get(pId)
    if (!moveInfo || moveInfo.qty <= 0) continue

    const currentData = stockMap.get(pId) || { stock_quantity: 0, cost_price: Number(moveInfo.dbProduct.cost_price || 0) }
    const delta = direction === 'deduct' ? -moveInfo.qty : moveInfo.qty
    const newStock = Math.max(0, currentData.stock_quantity + delta)

    updatePromises.push(
      supabase
        .from('products')
        .update({ stock_quantity: newStock })
        .eq('id', pId)
    )

    stockMoveInserts.push({
      business_id: businessId,
      product_id: pId,
      reference: reference,
      qty: moveInfo.qty,
      unit_cost: currentData.cost_price,
      status: 'done',
      type: moveType
    })
  }

  if (updatePromises.length > 0) {
    await Promise.all(updatePromises)
  }

  if (stockMoveInserts.length > 0) {
    const { error: batchMoveErr } = await supabase
      .from('stock_moves')
      .insert(stockMoveInserts)

    if (batchMoveErr) {
      console.error('Failed batch inserting stock moves:', batchMoveErr.message)
    }
  }
}
