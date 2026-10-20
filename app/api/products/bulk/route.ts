import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'

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
}

interface BulkRequestBody {
  products: ProductImportRow[]
  duplicateAction?: 'skip' | 'update'
  defaultCategoryId?: string | null
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

    const { products, duplicateAction = 'skip', defaultCategoryId = null } = body

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
      // Query existing categories
      const { data: existingCats, error: catFetchErr } = await supabaseAdmin
        .from('categories')
        .select('id, name')
        .eq('business_id', businessId)
        .in('name', distinctCategoryNames)

      if (catFetchErr) {
        console.error('[ProductsBulk] Error fetching categories:', catFetchErr)
      } else if (existingCats) {
        existingCats.forEach(c => categoryNameToIdMap.set(c.name.toLowerCase(), c.id))
      }

      // Filter categories that need to be created
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
            .in('name', missingCategoryNames)

          refetchedCats?.forEach(c => categoryNameToIdMap.set(c.name.toLowerCase(), c.id))
        } else if (createdCats) {
          createdCats.forEach(c => categoryNameToIdMap.set(c.name.toLowerCase(), c.id))
        }
      }
    }

    // 4. Fetch existing products for duplicate detection (by SKU or Name)
    const incomingSkus = Array.from(
      new Set(
        products
          .map(p => (p.sku ? String(p.sku).trim() : ''))
          .filter(Boolean)
      )
    )
    const incomingNames = Array.from(
      new Set(
        products
          .map(p => (p.name ? String(p.name).trim().toLowerCase() : ''))
          .filter(Boolean)
      )
    )

    // Build query conditions
    const orConditions: string[] = []
    if (incomingSkus.length > 0) {
      orConditions.push(`sku.in.(${incomingSkus.map(s => `"${s.replace(/"/g, '')}"`).join(',')})`)
    }
    if (incomingNames.length > 0) {
      orConditions.push(`name.in.(${incomingNames.map(n => `"${n.replace(/"/g, '')}"`).join(',')})`)
    }

    let existingProductsMap = new Map<string, { id: string; sku: string | null; name: string }>()
    if (orConditions.length > 0) {
      const { data: existingProds, error: prodFetchErr } = await supabaseAdmin
        .from('products')
        .select('id, sku, name')
        .eq('business_id', businessId)
        .or(orConditions.join(','))

      if (prodFetchErr) {
        console.warn('[ProductsBulk] Error checking existing products:', prodFetchErr.message)
      } else if (existingProds) {
        existingProds.forEach(p => {
          if (p.sku) existingProductsMap.set(`sku:${p.sku.trim().toLowerCase()}`, p)
          if (p.name) existingProductsMap.set(`name:${p.name.trim().toLowerCase()}`, p)
        })
      }
    }

    // 5. Partition products into Inserts and Updates
    let insertedCount = 0
    let updatedCount = 0
    let skippedCount = 0

    const productsToInsert: any[] = []
    const productsToUpdate: { id: string; payload: any }[] = []

    for (let i = 0; i < products.length; i++) {
      const item = products[i]
      const rawName = item.name ? String(item.name).trim() : ''
      if (!rawName) {
        skippedCount++
        continue
      }

      const rawSku = item.sku ? String(item.sku).trim() : null
      const cleanPrice = Number(item.price) >= 0 ? Number(item.price) : 0
      const cleanCostPrice = Number(item.cost_price) >= 0 ? Number(item.cost_price) : 0
      const cleanStockQty = Number(item.stock_quantity) >= 0 ? Number(item.stock_quantity) : 0
      const cleanUnit = item.unit ? String(item.unit).trim() : 'pcs'
      const cleanType = item.type === 'service' ? 'service' : 'physical'
      const cleanStockType = ['tracked', 'available', 'unavailable'].includes(item.stock_type || '')
        ? (item.stock_type as 'tracked' | 'available' | 'unavailable')
        : (cleanType === 'physical' ? 'tracked' : 'available')
      const cleanHppType = item.hpp_type === 'variable' ? 'variable' : 'fixed'
      const cleanDesc = item.description ? String(item.description).trim() : null

      // Resolve category
      let resolvedCategoryId: string | null = null
      if (item.category && String(item.category).trim()) {
        const catKey = String(item.category).trim().toLowerCase()
        resolvedCategoryId = categoryNameToIdMap.get(catKey) || null
      }
      if (!resolvedCategoryId && defaultCategoryId) {
        resolvedCategoryId = defaultCategoryId
      }

      // Check duplicate
      let existingMatch = null
      if (rawSku) {
        existingMatch = existingProductsMap.get(`sku:${rawSku.toLowerCase()}`)
      }
      if (!existingMatch) {
        existingMatch = existingProductsMap.get(`name:${rawName.toLowerCase()}`)
      }

      const productPayload = {
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
        updated_at: new Date().toISOString()
      }

      if (existingMatch) {
        if (duplicateAction === 'update') {
          productsToUpdate.push({
            id: existingMatch.id,
            payload: productPayload
          })
        } else {
          skippedCount++
        }
      } else {
        productsToInsert.push(productPayload)
        // Mark in in-memory map to prevent duplicate in same file batch
        if (rawSku) {
          existingProductsMap.set(`sku:${rawSku.toLowerCase()}`, { id: 'pending', sku: rawSku, name: rawName })
        }
        existingProductsMap.set(`name:${rawName.toLowerCase()}`, { id: 'pending', sku: rawSku, name: rawName })
      }
    }

    // 6. Execute Inserts
    const insertedProductRows: any[] = []
    if (productsToInsert.length > 0) {
      const { data: insertedData, error: insErr } = await supabaseAdmin
        .from('products')
        .insert(productsToInsert)
        .select('id, name, sku, stock_quantity, cost_price, stock_type')

      if (insErr) {
        throw new Error(`Gagal menyimpan produk baru: ${insErr.message}`)
      }

      if (insertedData) {
        insertedProductRows.push(...insertedData)
        insertedCount += insertedData.length
      }
    }

    // 7. Execute Updates
    if (productsToUpdate.length > 0) {
      for (const item of productsToUpdate) {
        const { error: updErr } = await supabaseAdmin
          .from('products')
          .update(item.payload)
          .eq('id', item.id)

        if (updErr) {
          console.error(`Failed to update product ${item.id}:`, updErr)
          skippedCount++
        } else {
          updatedCount++
        }
      }
    }

    // 8. Event Sourcing: Record initial stock movements for new tracked products with stock > 0
    const productsNeedingStockMoves = insertedProductRows.filter(
      p => p.stock_type === 'tracked' && Number(p.stock_quantity) > 0
    )

    if (productsNeedingStockMoves.length > 0) {
      const stockMovesToInsert = productsNeedingStockMoves.map(p => ({
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
      }))

      const { error: stockMoveErr } = await supabaseAdmin
        .from('stock_moves')
        .insert(stockMovesToInsert)

      if (stockMoveErr) {
        console.warn('[ProductsBulk] Warning: Failed to insert stock moves:', stockMoveErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      insertedCount,
      updatedCount,
      skippedCount,
      totalProcessed: products.length,
      message: `Berhasil memproses ${products.length} produk (Ditambahkan: ${insertedCount}, Diperbarui: ${updatedCount}, Dilewati: ${skippedCount})`
    })

  } catch (err: any) {
    console.error('[ProductsBulk] Fatal import error:', err)
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan pada server.' }, { status: 500 })
  }
}
