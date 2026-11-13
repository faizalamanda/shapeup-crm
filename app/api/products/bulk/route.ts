import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { isUuid } from '@/lib/utils'
import { getOrCreateDefaultAccounts } from '@/lib/accountHelper'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { postJournalTransaction } from '@/lib/journalHelper'

interface ProductVariantImportRow {
  name: string
  sku?: string | null
  price?: number
  cost_price?: number
  stock_quantity?: number
  price_tiers?: { dine_in?: number | null; take_away?: number | null } | null
  min_stock_alert?: number | null
  external_id?: string | null
}

interface ProductImportRow {
  name: string
  sku?: string | null
  price?: number
  cost_price?: number
  category?: string | null
  stock_quantity?: number
  unit?: string
  type?: 'physical' | 'service'
  stock_type?: 'tracked' | 'available' | 'unavailable'
  description?: string | null
  hpp_type?: 'fixed' | 'variable'
  price_tiers?: { dine_in?: number | null; take_away?: number | null } | null
  min_stock_alert?: number | null
  external_id?: string | null
  variants?: ProductVariantImportRow[]
  modifier_groups?: string[]
}

interface BulkRequestBody {
  products: ProductImportRow[]
  duplicateAction?: 'skip' | 'update'
  defaultCategoryId?: string | null
  defaultStockType?: 'tracked' | 'available' | 'unavailable'
  defaultType?: 'physical' | 'service'
}

export async function POST(req: Request) {
  // 1. Auth & Business Context
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error

  const { businessId, supabaseAdmin } = ctx

  try {
    // 2. Parse request body safely
    const body: BulkRequestBody = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.products) || body.products.length === 0) {
      return NextResponse.json({ error: 'Data produk tidak boleh kosong.' }, { status: 400 })
    }

    const { products, duplicateAction = 'skip', defaultCategoryId = null, defaultStockType = 'tracked', defaultType = 'physical' } = body

    // 3. Resolve and auto-create Categories in batch
    const distinctCategoryNames = Array.from(
      new Set(
        products
          .map(p => (p.category ? String(p.category).trim() : ''))
          .filter(Boolean)
      )
    )

    const categoryNameToIdMap = new Map<string, string>()

    if (distinctCategoryNames.length > 0) {
      // Query all existing categories for this business to ensure 100% case-insensitive matching
      const { data: existingCats, error: catFetchErr } = await supabaseAdmin
        .from('categories')
        .select('id, name')
        .eq('business_id', businessId)

      if (catFetchErr) {
        console.error('[ProductsBulk] Error fetching categories:', catFetchErr)
      } else if (existingCats) {
        existingCats.forEach(c => categoryNameToIdMap.set(c.name.trim().toLowerCase(), c.id))
      }

      // Filter categories that truly do not exist in this business yet
      const missingCategoryNames = distinctCategoryNames.filter(
        name => !categoryNameToIdMap.has(name.toLowerCase())
      )

      if (missingCategoryNames.length > 0) {
        const categoriesToInsert = missingCategoryNames.map(name => ({
          business_id: businessId,
          name: name
        }))

        const { data: createdCats, error: catInsertErr } = await supabaseAdmin
          .from('categories')
          .insert(categoriesToInsert)
          .select('id, name')

        if (catInsertErr) {
          // If conflict due to concurrent insert, fallback fetch
          const { data: refetchedCats } = await supabaseAdmin
            .from('categories')
            .select('id, name')
            .eq('business_id', businessId)

          refetchedCats?.forEach(c => categoryNameToIdMap.set(c.name.trim().toLowerCase(), c.id))
        } else if (createdCats) {
          createdCats.forEach(c => categoryNameToIdMap.set(c.name.trim().toLowerCase(), c.id))
        }
      }
    }

    // 4. Fetch existing products for duplicate detection safely without fragile PostgREST .or() string concatenation
    const incomingSkusSet = new Set<string>()
    products.forEach(p => {
      if (p.sku) {
        const s = String(p.sku).trim()
        if (s) {
          incomingSkusSet.add(s)
          incomingSkusSet.add(s.toUpperCase())
          incomingSkusSet.add(s.toLowerCase())
        }
      }
    })
    const incomingSkus = Array.from(incomingSkusSet)

    const incomingNamesSet = new Set<string>()
    products.forEach(p => {
      if (p.name) {
        const n = String(p.name).trim()
        if (n) {
          incomingNamesSet.add(n)
          incomingNamesSet.add(n.toLowerCase())
        }
      }
    })
    const incomingNames = Array.from(incomingNamesSet)

    const existingProductsMap = new Map<string, {
      id: string
      sku: string | null
      name: string
      stock_quantity: number
      cost_price: number
      stock_type: string
    }>()

    const [prodsBySkuRes, prodsByNameRes] = await Promise.all([
      incomingSkus.length > 0
        ? supabaseAdmin
            .from('products')
            .select('id, sku, name, stock_quantity, cost_price, stock_type')
            .eq('business_id', businessId)
            .in('sku', incomingSkus)
        : Promise.resolve({ data: [] as any[], error: null }),
      incomingNames.length > 0
        ? supabaseAdmin
            .from('products')
            .select('id, sku, name, stock_quantity, cost_price, stock_type')
            .eq('business_id', businessId)
            .in('name', incomingNames)
        : Promise.resolve({ data: [] as any[], error: null })
    ])

    if (prodsBySkuRes.data) {
      prodsBySkuRes.data.forEach(p => {
        if (p.sku) existingProductsMap.set(`sku:${p.sku.trim().toLowerCase()}`, p)
      })
    }
    if (prodsByNameRes.data) {
      prodsByNameRes.data.forEach(p => {
        if (p.name) existingProductsMap.set(`name:${p.name.trim().toLowerCase()}`, p)
      })
    }

    // 5. Partition products into Inserts and Updates
    let insertedCount = 0
    let updatedCount = 0
    let skippedCount = 0
    const failedItems: { index: number; name: string; sku?: string | null; reason: string }[] = []

    const productsToInsert: { originalIndex: number; payload: any; variants: ProductVariantImportRow[]; modifierGroups: string[] }[] = []
    const productsToUpdate: { originalIndex: number; id: string; existingStock: number; payload: any; variants: ProductVariantImportRow[]; modifierGroups: string[] }[] = []

    const stripExtendedProductCols = (payload: any) => {
      const { price_tiers, min_stock_alert, external_id, ...safePayload } = payload
      return safePayload
    }

    for (let i = 0; i < products.length; i++) {
      const item = products[i]
      const rawName = item.name ? String(item.name).trim() : ''
      if (!rawName) {
        skippedCount++
        failedItems.push({
          index: i,
          name: item.name || '-',
          sku: item.sku || null,
          reason: 'Nama produk kosong atau tidak valid'
        })
        continue
      }

      const rawSku = item.sku ? String(item.sku).trim() : null
      const cleanPrice = Number(item.price) >= 0 ? Number(item.price) : 0
      const cleanCostPrice = Number(item.cost_price) >= 0 ? Number(item.cost_price) : 0
      const rawStockNumber = Number(item.stock_quantity) >= 0 ? Number(item.stock_quantity) : 0
      // Preserve up to 4 decimal places (matches numeric(15,4) for kg/liter/gram raw materials)
      const cleanStockQty = Math.round(rawStockNumber * 10000) / 10000
      const cleanUnit = item.unit ? String(item.unit).trim() : 'pcs'
      const cleanType = item.type === 'service' ? 'service' : (item.type === 'physical' ? 'physical' : (defaultType === 'service' ? 'service' : 'physical'))

      // Determine stock_type based on explicit row value, then fallback to defaultStockType
      let cleanStockType: 'tracked' | 'available' | 'unavailable' = 'available'
      if (item.stock_type === 'unavailable') {
        cleanStockType = 'unavailable'
      } else if (item.stock_type === 'available') {
        cleanStockType = 'available'
      } else if (item.stock_type === 'tracked') {
        cleanStockType = 'tracked'
      } else if (cleanStockQty > 0) {
        cleanStockType = 'tracked'
      } else if (defaultStockType === 'unavailable') {
        cleanStockType = 'unavailable'
      } else if (defaultStockType === 'available') {
        cleanStockType = 'available'
      } else if (cleanType === 'service') {
        cleanStockType = 'available'
      } else {
        cleanStockType = 'tracked'
      }

      const cleanHppType = item.hpp_type === 'variable' ? 'variable' : 'fixed'
      const cleanDesc = item.description ? String(item.description).trim() : null
      const cleanMinStockAlert = Number(item.min_stock_alert) > 0 ? Math.round(Number(item.min_stock_alert)) : 0
      const cleanExternalId = item.external_id ? String(item.external_id).trim() : null
      const cleanPriceTiers: Record<string, number> = {}
      if (item.price_tiers && typeof item.price_tiers === 'object') {
        if (Number(item.price_tiers.dine_in) > 0) cleanPriceTiers.dine_in = Math.round(Number(item.price_tiers.dine_in))
        if (Number(item.price_tiers.take_away) > 0) cleanPriceTiers.take_away = Math.round(Number(item.price_tiers.take_away))
      }

      const cleanVariants: ProductVariantImportRow[] = Array.isArray(item.variants)
        ? item.variants.filter(v => v && v.name && String(v.name).trim())
        : []
      const cleanModifierGroups: string[] = Array.isArray(item.modifier_groups)
        ? Array.from(new Set(item.modifier_groups.map(m => String(m || '').trim()).filter(Boolean)))
        : []

      // Resolve category
      let resolvedCategoryId: string | null = null
      if (item.category && String(item.category).trim()) {
        const catKey = String(item.category).trim().toLowerCase()
        resolvedCategoryId = categoryNameToIdMap.get(catKey) || null
      }
      if (!resolvedCategoryId && defaultCategoryId) {
        resolvedCategoryId = defaultCategoryId
      }

      // Check duplicate:
      // STRICT SKU-FIRST RULE:
      // If SKU is provided, match ONLY by SKU. Do NOT collapse different SKU variants just because they share the same name!
      // If SKU is not provided, fallback to matching by product name.
      let existingMatch = null
      if (rawSku) {
        existingMatch = existingProductsMap.get(`sku:${rawSku.toLowerCase()}`)
      } else {
        existingMatch = existingProductsMap.get(`name:${rawName.toLowerCase()}`)
      }

      const productPayload: any = {
        business_id: businessId,
        name: rawName,
        sku: rawSku || null,
        description: cleanDesc,
        price: cleanPrice,
        cost_price: cleanCostPrice,
        type: cleanType,
        category_id: resolvedCategoryId,
        stock_type: cleanStockType,
        stock_quantity: cleanStockType === 'tracked' ? cleanStockQty : 0,
        unit: cleanUnit,
        hpp_type: cleanHppType,
        price_tiers: cleanPriceTiers,
        min_stock_alert: cleanMinStockAlert,
        external_id: cleanExternalId,
        updated_at: new Date().toISOString()
      }

      if (existingMatch) {
        if (duplicateAction === 'update') {
          productsToUpdate.push({
            originalIndex: i,
            id: existingMatch.id,
            existingStock: Number(existingMatch.stock_quantity || 0),
            payload: productPayload,
            variants: cleanVariants,
            modifierGroups: cleanModifierGroups
          })
        } else {
          skippedCount++
        }
      } else {
        productsToInsert.push({
          originalIndex: i,
          payload: productPayload,
          variants: cleanVariants,
          modifierGroups: cleanModifierGroups
        })
        // Mark in in-memory map to prevent duplicates within the same batch
        const pendingObj = {
          id: 'pending',
          sku: rawSku,
          name: rawName,
          stock_quantity: cleanStockQty,
          cost_price: cleanCostPrice,
          stock_type: cleanStockType
        }
        if (rawSku) {
          existingProductsMap.set(`sku:${rawSku.toLowerCase()}`, pendingObj)
        } else {
          existingProductsMap.set(`name:${rawName.toLowerCase()}`, pendingObj)
        }
      }
    }

    // 6. Execute Inserts (with schema fallback for extended Moka columns)
    const insertedProductRows: Array<{ id: string; name: string; sku: string | null; stock_quantity: number; cost_price: number; stock_type: string; variants: ProductVariantImportRow[]; modifierGroups: string[] }> = []
    if (productsToInsert.length > 0) {
      const payloads = productsToInsert.map(p => p.payload)
      let { data: insertedData, error: insErr } = await supabaseAdmin
        .from('products')
        .insert(payloads)
        .select('id, name, sku, stock_quantity, cost_price, stock_type')

      if (insErr && (insErr.message?.includes('price_tiers') || insErr.message?.includes('min_stock_alert') || insErr.message?.includes('external_id') || insErr.code === '42703' || insErr.code === 'PGRST204')) {
        const fallbackPayloads = productsToInsert.map(p => stripExtendedProductCols(p.payload))
        const retryRes = await supabaseAdmin
          .from('products')
          .insert(fallbackPayloads)
          .select('id, name, sku, stock_quantity, cost_price, stock_type')
        insertedData = retryRes.data
        insErr = retryRes.error
      }

      if (insErr) {
        console.error('[ProductsBulk] Insert chunk failed, retrying rows:', insErr)
        // If bulk insert failed, fallback to individual row insert to salvage valid rows
        for (const item of productsToInsert) {
          let { data: singleData, error: singleErr } = await supabaseAdmin
            .from('products')
            .insert(item.payload)
            .select('id, name, sku, stock_quantity, cost_price, stock_type')
            .maybeSingle()

          if (singleErr && (singleErr.message?.includes('price_tiers') || singleErr.message?.includes('min_stock_alert') || singleErr.message?.includes('external_id') || singleErr.code === '42703' || singleErr.code === 'PGRST204')) {
            const retrySingle = await supabaseAdmin
              .from('products')
              .insert(stripExtendedProductCols(item.payload))
              .select('id, name, sku, stock_quantity, cost_price, stock_type')
              .maybeSingle()
            singleData = retrySingle.data
            singleErr = retrySingle.error
          }

          if (singleErr) {
            failedItems.push({
              index: item.originalIndex,
              name: item.payload.name,
              sku: item.payload.sku,
              reason: singleErr.message || 'Gagal menyimpan produk'
            })
          } else if (singleData) {
            insertedProductRows.push({ ...singleData, variants: item.variants, modifierGroups: item.modifierGroups })
            insertedCount++
          }
        }
      } else if (insertedData) {
        insertedData.forEach((row, idx) => {
          const src = productsToInsert[idx]
          insertedProductRows.push({
            ...row,
            variants: src?.variants || [],
            modifierGroups: src?.modifierGroups || []
          })
        })
        insertedCount += insertedData.length
      }
    }

    // 7. Execute Updates in parallel chunks of 10 to eliminate N+1 timeout risk
    const updatedProductRows: Array<{ id: string; cost_price: number; stock_type: string; variants: ProductVariantImportRow[]; modifierGroups: string[] }> = []
    if (productsToUpdate.length > 0) {
      const CHUNK_SIZE = 10
      for (let i = 0; i < productsToUpdate.length; i += CHUNK_SIZE) {
        const chunk = productsToUpdate.slice(i, i + CHUNK_SIZE)
        const results = await Promise.all(
          chunk.map(async item => {
            let { error: updErr } = await supabaseAdmin
              .from('products')
              .update(item.payload)
              .eq('id', item.id)

            if (updErr && (updErr.message?.includes('price_tiers') || updErr.message?.includes('min_stock_alert') || updErr.message?.includes('external_id') || updErr.code === '42703' || updErr.code === 'PGRST204')) {
              const retryUpd = await supabaseAdmin
                .from('products')
                .update(stripExtendedProductCols(item.payload))
                .eq('id', item.id)
              updErr = retryUpd.error
            }
            return { item, error: updErr }
          })
        )

        for (const res of results) {
          if (res.error) {
            console.error(`Failed to update product ${res.item.id}:`, res.error)
            skippedCount++
            failedItems.push({
              index: res.item.originalIndex,
              name: res.item.payload.name,
              sku: res.item.payload.sku,
              reason: res.error.message || 'Gagal memperbarui produk'
            })
          } else {
            updatedCount++
            updatedProductRows.push({
              id: res.item.id,
              cost_price: Number(res.item.payload.cost_price || 0),
              stock_type: res.item.payload.stock_type,
              variants: res.item.variants,
              modifierGroups: res.item.modifierGroups
            })
          }
        }
      }
    }

    // 7b. Process Discrete Product Variants (SPU -> SKU) & Modifier Groups
    const allProcessedProductsForSubEntities = [
      ...insertedProductRows.map(p => ({ id: p.id, cost_price: Number(p.cost_price || 0), stock_type: p.stock_type, variants: p.variants, modifierGroups: p.modifierGroups, isNewProduct: true })),
      ...updatedProductRows.map(p => ({ id: p.id, cost_price: Number((p as any).cost_price || 0), stock_type: p.stock_type, variants: p.variants, modifierGroups: p.modifierGroups, isNewProduct: false }))
    ]

    const newlyInsertedVariantStockMoves: any[] = []

    const productsWithVariants = allProcessedProductsForSubEntities.filter(p => p.variants && p.variants.length > 0)
    if (productsWithVariants.length > 0) {
      const parentIds = productsWithVariants.map(p => p.id)
      const { data: existingVars } = await supabaseAdmin
        .from('product_variants')
        .select('id, product_id, name, sku, stock_quantity')
        .eq('business_id', businessId)
        .in('product_id', parentIds)

      const existingVarByKey = new Map<string, any>()
      if (existingVars) {
        existingVars.forEach(ev => {
          if (ev.sku) existingVarByKey.set(`${ev.product_id}:sku:${String(ev.sku).trim().toLowerCase()}`, ev)
          if (ev.name) existingVarByKey.set(`${ev.product_id}:name:${String(ev.name).trim().toLowerCase()}`, ev)
        })
      }

      const variantsToInsert: Array<{ parentStockType: string; payload: any }> = []
      const variantsToUpdate: Array<{ id: string; payload: any }> = []

      for (const prod of productsWithVariants) {
        for (const v of prod.variants) {
          const vName = String(v.name || '').trim()
          if (!vName) continue
          const vSku = v.sku ? String(v.sku).trim() : null
          const vPrice = Number(v.price) >= 0 ? Number(v.price) : 0
          const vCost = Number(v.cost_price) > 0 ? Number(v.cost_price) : Number(prod.cost_price || 0)
          const vStock = prod.stock_type === 'tracked' && Number(v.stock_quantity) > 0 ? Math.round(Number(v.stock_quantity)) : 0
          const vMinAlert = Number(v.min_stock_alert) > 0 ? Math.round(Number(v.min_stock_alert)) : 0
          const vExtId = v.external_id ? String(v.external_id).trim() : null
          const vTiers: Record<string, number> = {}
          if (v.price_tiers && typeof v.price_tiers === 'object') {
            if (Number(v.price_tiers.dine_in) > 0) vTiers.dine_in = Math.round(Number(v.price_tiers.dine_in))
            if (Number(v.price_tiers.take_away) > 0) vTiers.take_away = Math.round(Number(v.price_tiers.take_away))
          }

          const existingVar = (vSku ? existingVarByKey.get(`${prod.id}:sku:${vSku.toLowerCase()}`) : null) ||
                              existingVarByKey.get(`${prod.id}:name:${vName.toLowerCase()}`)

          if (existingVar) {
            variantsToUpdate.push({
              id: existingVar.id,
              payload: {
                name: vName,
                sku: vSku,
                price: vPrice,
                cost_price: vCost,
                price_tiers: vTiers,
                min_stock_alert: vMinAlert,
                external_id: vExtId,
                updated_at: new Date().toISOString()
              }
            })
          } else {
            variantsToInsert.push({
              parentStockType: prod.stock_type,
              payload: {
                business_id: businessId,
                product_id: prod.id,
                name: vName,
                sku: vSku,
                price: vPrice,
                cost_price: vCost,
                stock_quantity: vStock,
                price_tiers: vTiers,
                min_stock_alert: vMinAlert,
                external_id: vExtId
              }
            })
          }
        }
      }

      if (variantsToInsert.length > 0) {
        const varPayloads = variantsToInsert.map(x => x.payload)
        let { data: insVars, error: insVarErr } = await supabaseAdmin
          .from('product_variants')
          .insert(varPayloads)
          .select('id, product_id, stock_quantity, cost_price')

        if (insVarErr && (insVarErr.message?.includes('price_tiers') || insVarErr.message?.includes('min_stock_alert') || insVarErr.message?.includes('external_id') || insVarErr.code === '42703' || insVarErr.code === 'PGRST204')) {
          const safeVarPayloads = varPayloads.map(p => stripExtendedProductCols(p))
          const retryVar = await supabaseAdmin
            .from('product_variants')
            .insert(safeVarPayloads)
            .select('id, product_id, stock_quantity, cost_price')
          insVars = retryVar.data
          insVarErr = retryVar.error
        }

        if (!insVarErr && insVars) {
          insVars.forEach((iv, idx) => {
            const meta = variantsToInsert[idx]
            if (meta?.parentStockType === 'tracked' && Number(iv.stock_quantity) > 0) {
              newlyInsertedVariantStockMoves.push({
                business_id: businessId,
                product_id: iv.product_id,
                variant_id: iv.id,
                reference: 'STOK-AWAL-IMPORT',
                qty: Number(iv.stock_quantity),
                unit_cost: Number(iv.cost_price || 0),
                type: 'adjustment',
                status: 'done',
                bucket: 'main',
                source_type: 'manual',
                origin_location_id: null,
                destination_location_id: null,
                lot_number: null,
                created_at: new Date().toISOString()
              })
            }
          })
        }
      }

      if (variantsToUpdate.length > 0) {
        const CHUNK_SIZE = 15
        for (let i = 0; i < variantsToUpdate.length; i += CHUNK_SIZE) {
          const chunk = variantsToUpdate.slice(i, i + CHUNK_SIZE)
          await Promise.all(
            chunk.map(async vItem => {
              const { error: vUpdErr } = await supabaseAdmin
                .from('product_variants')
                .update(vItem.payload)
                .eq('id', vItem.id)
              if (vUpdErr && (vUpdErr.message?.includes('price_tiers') || vUpdErr.message?.includes('min_stock_alert') || vUpdErr.message?.includes('external_id') || vUpdErr.code === '42703' || vUpdErr.code === 'PGRST204')) {
                await supabaseAdmin
                  .from('product_variants')
                  .update(stripExtendedProductCols(vItem.payload))
                  .eq('id', vItem.id)
              }
            })
          )
        }
      }
    }

    // 7c. Process Modifier Groups (Moka Modifier Set compatibility)
    const productsWithModifiers = allProcessedProductsForSubEntities.filter(p => p.modifierGroups && p.modifierGroups.length > 0)
    if (productsWithModifiers.length > 0) {
      try {
        // Fetch existing business modifier templates so if the user already defined options for "Level", we reuse them
        const { data: existingBizMods } = await supabaseAdmin
          .from('product_modifiers')
          .select('product_id, group_name, option_name, price_extra, is_required')
          .eq('business_id', businessId)

        const templateByGroup = new Map<string, Array<{ option_name: string; price_extra: number; is_required: boolean }>>()
        const existingProductGroupSet = new Set<string>()

        if (existingBizMods) {
          existingBizMods.forEach((m: any) => {
            const gKey = String(m.group_name || '').trim().toLowerCase()
            const optText = String(m.option_name || '').trim()
            if (!gKey || !optText) return
            existingProductGroupSet.add(`${m.product_id}:${gKey}`)
            if (!templateByGroup.has(gKey)) {
              templateByGroup.set(gKey, [])
            }
            const list = templateByGroup.get(gKey)!
            if (!list.some(opt => opt.option_name.toLowerCase() === optText.toLowerCase())) {
              list.push({
                option_name: optText,
                price_extra: Number(m.price_extra || 0),
                is_required: Boolean(m.is_required)
              })
            }
          })
        }

        const modifiersToInsert: any[] = []
        for (const prod of productsWithModifiers) {
          for (const rawGroupName of prod.modifierGroups) {
            const gName = String(rawGroupName || '').trim()
            const gKey = gName.toLowerCase()
            if (!gName || existingProductGroupSet.has(`${prod.id}:${gKey}`)) continue

            const templateOptions = templateByGroup.get(gKey)
            if (templateOptions && templateOptions.length > 0) {
              templateOptions.forEach(opt => {
                modifiersToInsert.push({
                  business_id: businessId,
                  product_id: prod.id,
                  group_name: gName,
                  option_name: opt.option_name,
                  price_extra: opt.price_extra,
                  is_required: opt.is_required
                })
              })
            } else {
              // Create starter options for newly discovered Moka Modifier Set
              const defaultOpts = gKey.includes('level')
                ? ['Level 1', 'Level 2', 'Level 3']
                : [`Standar (${gName})`]
              defaultOpts.forEach(optName => {
                modifiersToInsert.push({
                  business_id: businessId,
                  product_id: prod.id,
                  group_name: gName,
                  option_name: optName,
                  price_extra: 0,
                  is_required: false
                })
              })
            }
            existingProductGroupSet.add(`${prod.id}:${gKey}`)
          }
        }

        if (modifiersToInsert.length > 0) {
          await supabaseAdmin.from('product_modifiers').insert(modifiersToInsert)
        }
      } catch (modErr) {
        console.warn('[ProductsBulk] Non-critical modifier import warning:', modErr)
      }
    }

    // 8. Event Sourcing: Record initial stock movements for new & updated tracked products
    const stockMovesToInsert: any[] = [...newlyInsertedVariantStockMoves]

    // 8a. Initial stock moves for new tracked products WITHOUT discrete variants where stock > 0
    const newProductsNeedingStockMoves = insertedProductRows.filter(
      p => p.stock_type === 'tracked' && Number(p.stock_quantity) > 0 && (!p.variants || p.variants.length === 0)
    )
    for (const p of newProductsNeedingStockMoves) {
      stockMovesToInsert.push({
        business_id: businessId,
        product_id: p.id,
        reference: 'STOK-AWAL-IMPORT',
        qty: Number(p.stock_quantity),
        unit_cost: Number(p.cost_price || 0),
        type: 'adjustment',
        status: 'done',
        bucket: 'main',
        source_type: 'manual',
        origin_location_id: null,
        destination_location_id: null,
        lot_number: null,
        created_at: new Date().toISOString()
      })
    }

    // 8b. Adjustment stock moves for updated tracked products where stock changed
    if (duplicateAction === 'update' && productsToUpdate.length > 0) {
      for (const item of productsToUpdate) {
        if (item.payload.stock_type === 'tracked') {
          // products.stock_quantity is atomically synced by trg_sync_product_stock_from_moves
          const currentStock = Number(item.existingStock || 0)
          const targetStock = Number(item.payload.stock_quantity || 0)
          const diff = Math.round((targetStock - currentStock) * 10000) / 10000

          if (diff !== 0) {
            stockMovesToInsert.push({
              business_id: businessId,
              product_id: item.id,
              reference: 'PENYESUAIAN-STOK-IMPORT',
              qty: Math.abs(diff),
              unit_cost: Number(item.payload.cost_price || 0),
              type: 'adjustment',
              status: 'done',
              bucket: 'main',
              source_type: 'manual',
              // diff > 0 -> origin null (penambahan stok)
              // diff < 0 -> origin dummy UUID (pengurangan stok)
              origin_location_id: diff < 0 ? '00000000-0000-0000-0000-000000000000' : null,
              destination_location_id: null,
              lot_number: null,
              created_at: new Date().toISOString()
            })
          }
        }
      }
    }

    if (stockMovesToInsert.length > 0) {
      const { error: stockMoveErr } = await supabaseAdmin
        .from('stock_moves')
        .insert(stockMovesToInsert)

      if (stockMoveErr) {
        console.warn('[ProductsBulk] Warning: Failed to insert stock moves:', stockMoveErr.message)
      } else {
        // Post opening stock & stock adjustment journals so GL Persediaan (102000) stays in sync with stock_moves
        try {
          let initialStockValue = 0
          let adjustUpValue = 0
          let adjustDownValue = 0

          for (const m of stockMovesToInsert) {
            const val = Math.round(Number(m.qty || 0) * Number(m.unit_cost || 0))
            if (val <= 0) continue
            if (m.reference === 'STOK-AWAL-IMPORT') {
              initialStockValue += val
            } else if (m.reference === 'PENYESUAIAN-STOK-IMPORT') {
              if (m.origin_location_id) {
                adjustDownValue += val
              } else {
                adjustUpValue += val
              }
            }
          }

          const todayStr = new Date().toISOString().split('T')[0]

          if (initialStockValue > 0) {
            const defaultAccMap = await getOrCreateDefaultAccounts(businessId, supabaseAdmin)
            const accPersediaan = defaultAccMap['102000']
            const accModal = defaultAccMap['301000']
            if (accPersediaan && accModal) {
              await postJournalTransaction(
                businessId,
                null,
                todayStr,
                `Saldo Awal Persediaan (Import Produk)`,
                [
                  { account_id: accPersediaan, debit: initialStockValue, credit: 0 },
                  { account_id: accModal, debit: 0, credit: initialStockValue }
                ],
                supabaseAdmin,
                true
              )
            }
          }

          if (adjustUpValue > 0 || adjustDownValue > 0) {
            const expAccMap = await ensureExpenseAccounts(businessId, supabaseAdmin)
            const accPersediaan = expAccMap['102000']
            const accPenyesuaian = expAccMap['502000']
            if (accPersediaan && accPenyesuaian) {
              const adjLines: any[] = []
              if (adjustUpValue > 0) {
                adjLines.push({ account_id: accPersediaan, debit: adjustUpValue, credit: 0 })
                adjLines.push({ account_id: accPenyesuaian, debit: 0, credit: adjustUpValue })
              }
              if (adjustDownValue > 0) {
                adjLines.push({ account_id: accPenyesuaian, debit: adjustDownValue, credit: 0 })
                adjLines.push({ account_id: accPersediaan, debit: 0, credit: adjustDownValue })
              }
              if (adjLines.length > 0) {
                await postJournalTransaction(
                  businessId,
                  null,
                  todayStr,
                  `Penyesuaian Persediaan (Import Produk)`,
                  adjLines,
                  supabaseAdmin,
                  true
                )
              }
            }
          }
        } catch (journalErr: any) {
          console.warn('[ProductsBulk] Warning: Failed to post opening stock journal:', journalErr?.message)
        }
      }
    }

    return NextResponse.json({
      success: true,
      insertedCount,
      updatedCount,
      skippedCount,
      failedItems,
      totalProcessed: products.length,
      message: `Berhasil memproses ${products.length} produk (Ditambahkan: ${insertedCount}, Diperbarui: ${updatedCount}, Dilewati: ${skippedCount}, Gagal: ${failedItems.length})`
    })

  } catch (err: any) {
    console.error('[ProductsBulk] Fatal import error:', err)
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan pada server.' }, { status: 500 })
  }
}

// ─── BULK DELETE HANDLER ───────────────────────────────────────────────────

interface BulkDeleteRequestBody {
  mode: 'selected' | 'all'
  productIds?: string[]
  forceStockCleanup?: boolean
}

export async function DELETE(req: Request) {
  // 1. Auth & Business Context
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error

  const { businessId, supabaseAdmin, user } = ctx

  try {
    // 2. Authorization check: Owner, Admin, or Staff with manage_products
    const [bizOwnerRes, staffRes] = await Promise.all([
      supabaseAdmin
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .eq('owner_id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('business_staff')
        .select('role, permissions')
        .eq('business_id', businessId)
        .eq('profile_id', user.id)
        .maybeSingle()
    ])

    const isOwner = !!bizOwnerRes.data
    const staffRole = staffRes.data?.role
    const staffPerms: string[] = Array.isArray(staffRes.data?.permissions) ? staffRes.data.permissions : []

    const isAdmin = isOwner || staffRole === 'admin' || staffPerms.includes('full_access')
    const hasProductPerm = isAdmin || staffPerms.includes('manage_products')

    // 3. Parse request body safely
    const body: BulkDeleteRequestBody = await req.json().catch(() => null)
    if (!body || !body.mode) {
      return NextResponse.json({ error: 'Payload tidak valid. Parameter "mode" wajib disertakan.' }, { status: 400 })
    }

    const { mode, productIds = [], forceStockCleanup = false } = body

    // Guard 1: Purge All Products is strictly restricted to Owner / Admin
    if (mode === 'all' && !isAdmin) {
      return NextResponse.json(
        { error: 'Akses ditolak: Hanya pemilik bisnis atau admin yang berhak mereset seluruh produk katalog.' },
        { status: 403 }
      )
    }

    // Guard 2: Selective Deletion requires at least manage_products permission
    if (!hasProductPerm) {
      return NextResponse.json(
        { error: 'Akses ditolak: Anda tidak memiliki izin kelola produk (manage_products).' },
        { status: 403 }
      )
    }

    const sanitizedProductIds = Array.isArray(productIds) ? productIds.filter(isUuid) : []

    // 4. Try RPC first if available
    try {
      const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('bulk_delete_products', {
        p_business_id: businessId,
        p_product_ids: mode === 'all' ? null : sanitizedProductIds,
        p_purge_all: mode === 'all',
        p_force_stock_cleanup: !!forceStockCleanup
      })

      if (!rpcErr && rpcResult && typeof rpcResult === 'object') {
        const isSuccess = rpcResult.success !== false
        return NextResponse.json(rpcResult, { status: isSuccess ? 200 : 400 })
      }
    } catch (rpcEx) {
      console.warn('[ProductsBulk] RPC bulk_delete_products call exception, falling back to direct query:', rpcEx)
    }

    // Fallback: Direct database queries using supabaseAdmin
    let targetProducts: { id: string; name: string; sku: string | null }[] = []

    if (mode === 'all') {
      const { data: prods, error: fetchErr } = await supabaseAdmin
        .from('products')
        .select('id, name, sku')
        .eq('business_id', businessId)

      if (fetchErr) throw fetchErr
      targetProducts = prods || []
    } else {
      if (sanitizedProductIds.length === 0) {
        return NextResponse.json({ error: 'Tidak ada ID produk valid yang dipilih.' }, { status: 400 })
      }

      const { data: prods, error: fetchErr } = await supabaseAdmin
        .from('products')
        .select('id, name, sku')
        .eq('business_id', businessId)
        .in('id', sanitizedProductIds)

      if (fetchErr) throw fetchErr
      targetProducts = prods || []
    }

    if (targetProducts.length === 0) {
      return NextResponse.json({
        success: true,
        deleted_count: 0,
        blocked_count: 0,
        message: 'Tidak ada produk yang ditemukan untuk dihapus.'
      })
    }

    const targetIds = targetProducts.map(p => p.id)
    let blockedIds: string[] = []
    let blockedProducts: { id: string; name: string; sku: string | null }[] = []

    // 5. Check stock_moves constraint if forceStockCleanup is FALSE
    if (!forceStockCleanup) {
      const chunkSize = 150
      const movesProductIdsSet = new Set<string>()

      for (let i = 0; i < targetIds.length; i += chunkSize) {
        const chunk = targetIds.slice(i, i + chunkSize)
        const { data: moves, error: movesErr } = await supabaseAdmin
          .from('stock_moves')
          .select('product_id')
          .eq('business_id', businessId)
          .in('product_id', chunk)

        if (!movesErr && moves) {
          moves.forEach(m => movesProductIdsSet.add(m.product_id))
        }
      }

      blockedIds = Array.from(movesProductIdsSet)
      blockedProducts = targetProducts.filter(p => blockedIds.includes(p.id))
    }

    const deletableProducts = targetProducts.filter(p => !blockedIds.includes(p.id))
    const deletableIds = deletableProducts.map(p => p.id)

    if (deletableIds.length === 0) {
      return NextResponse.json({
        success: false,
        deleted_count: 0,
        blocked_count: blockedIds.length,
        blocked_products: blockedProducts,
        message: `${blockedIds.length} produk tidak dapat dihapus karena memiliki riwayat mutasi stok. Aktifkan opsi "Paksa hapus riwayat stok" jika Anda ingin menghapusnya secara permanen.`
      }, { status: 400 })
    }

    // 6. Delete in chunks of 150
    const chunkSize = 150

    if (forceStockCleanup) {
      for (let i = 0; i < targetIds.length; i += chunkSize) {
        const chunk = targetIds.slice(i, i + chunkSize)
        await supabaseAdmin
          .from('stock_moves')
          .delete()
          .eq('business_id', businessId)
          .in('product_id', chunk)
      }
    }

    // Clean up inventory_stock_summary
    for (let i = 0; i < deletableIds.length; i += chunkSize) {
      const chunk = deletableIds.slice(i, i + chunkSize)
      await supabaseAdmin
        .from('inventory_stock_summary')
        .delete()
        .eq('business_id', businessId)
        .in('product_id', chunk)
    }

    // Delete products
    let totalDeleted = 0
    for (let i = 0; i < deletableIds.length; i += chunkSize) {
      const chunk = deletableIds.slice(i, i + chunkSize)
      const { error: delErr } = await supabaseAdmin
        .from('products')
        .delete()
        .eq('business_id', businessId)
        .in('id', chunk)

      if (delErr) {
        console.error('[ProductsBulk] Error deleting products chunk:', delErr)
        throw delErr
      }
      totalDeleted += chunk.length
    }

    return NextResponse.json({
      success: true,
      deleted_count: totalDeleted,
      blocked_count: blockedIds.length,
      blocked_products: blockedProducts,
      message: blockedIds.length > 0
        ? `${totalDeleted} produk berhasil dihapus. ${blockedIds.length} produk dilewati karena memiliki riwayat mutasi stok.`
        : `${totalDeleted} produk berhasil dihapus secara permanen.`
    })

  } catch (err: any) {
    console.error('[ProductsBulk] Fatal delete error:', err)
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan pada server saat menghapus produk.' }, { status: 500 })
  }
}

