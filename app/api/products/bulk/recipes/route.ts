import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { invalidateHppCache } from '@/lib/recipeHelper'

interface RecipeImportRow {
  product_ref: string
  ingredient_ref: string
  quantity: number
  notes?: string | null
  _rowNumber?: number
}

interface BulkRecipeRequestBody {
  recipes: RecipeImportRow[]
  mode?: 'replace' | 'merge'
  business_id?: string
}

interface ProductLookupRow {
  id: string
  sku: string | null
  name: string
  unit: string | null
}

/**
 * Resolves a product or raw material by SKU first (exact case-insensitive),
 * then falls back to Name (exact case-insensitive) with an ambiguity guard.
 */
function resolveProductRef(
  rawRef: string,
  skuMap: Map<string, ProductLookupRow>,
  nameMap: Map<string, ProductLookupRow[]>
): { match?: ProductLookupRow; error?: string } {
  const clean = String(rawRef || '').trim()
  if (!clean) {
    return { error: 'Referensi produk/bahan kosong' }
  }

  const key = clean.toLowerCase()
  const bySku = skuMap.get(key)
  if (bySku) {
    return { match: bySku }
  }

  const byName = nameMap.get(key)
  if (!byName || byName.length === 0) {
    return { error: `Item "${clean}" tidak ditemukan di database` }
  }

  if (byName.length > 1) {
    return {
      error: `Nama "${clean}" ambigu (${byName.length} item memiliki nama sama). Harap isi menggunakan kode SKU.`
    }
  }

  return { match: byName[0] }
}

/**
 * Checks whether adding edge (productId -> ingredientId) creates a cycle in the BOM DAG.
 */
function createsCycle(
  productId: string,
  ingredientId: string,
  adjacency: Map<string, Set<string>>
): boolean {
  if (productId === ingredientId) return true
  const visited = new Set<string>()
  const stack = [ingredientId]
  while (stack.length > 0) {
    const curr = stack.pop()!
    if (curr === productId) return true
    if (visited.has(curr)) continue
    visited.add(curr)
    const neighbors = adjacency.get(curr)
    if (neighbors) {
      for (const next of neighbors) {
        if (!visited.has(next)) stack.push(next)
      }
    }
  }
  return false
}

export async function POST(req: Request) {
  const body: BulkRecipeRequestBody | null = await req.json().catch(() => null)
  const reqBizId = typeof body?.business_id === 'string' ? body.business_id : undefined

  const ctx = await getApiContext({ req, requestedBusinessId: reqBizId })
  if (ctx.error) return ctx.error

  const { businessId, supabaseAdmin } = ctx

  try {
    if (!body || !Array.isArray(body.recipes) || body.recipes.length === 0) {
      return NextResponse.json({ error: 'Data resep tidak boleh kosong.' }, { status: 400 })
    }

    const mode: 'replace' | 'merge' = body.mode === 'merge' ? 'merge' : 'replace'

    // 1. Fetch all business products using chunked range fetching (bypasses 1,000-row PostgREST cap)
    const allProducts: ProductLookupRow[] = []
    const CHUNK_SIZE = 1000
    let from = 0
    while (true) {
      const { data: chunk, error: prodErr } = await supabaseAdmin
        .from('products')
        .select('id, sku, name, unit')
        .eq('business_id', businessId)
        .range(from, from + CHUNK_SIZE - 1)

      if (prodErr) {
        throw new Error(`Gagal memuat master produk: ${prodErr.message}`)
      }
      if (!chunk || chunk.length === 0) break
      allProducts.push(...(chunk as ProductLookupRow[]))
      if (chunk.length < CHUNK_SIZE) break
      from += CHUNK_SIZE
    }

    // Build SKU-first and Name-fallback lookup maps
    const skuMap = new Map<string, ProductLookupRow>()
    const nameMap = new Map<string, ProductLookupRow[]>()
    for (const p of allProducts) {
      if (p.sku && String(p.sku).trim()) {
        skuMap.set(String(p.sku).trim().toLowerCase(), p)
      }
      if (p.name && String(p.name).trim()) {
        const nKey = String(p.name).trim().toLowerCase()
        const list = nameMap.get(nKey) || []
        list.push(p)
        nameMap.set(nKey, list)
      }
    }

    // 2. Fetch existing recipe edges for DAG cycle detection
    const adjacency = new Map<string, Set<string>>()
    const { data: existingRecipes } = await supabaseAdmin
      .from('product_recipes')
      .select('product_id, ingredient_product_id')
      .eq('business_id', businessId)

    if (existingRecipes) {
      for (const r of existingRecipes) {
        if (!adjacency.has(r.product_id)) adjacency.set(r.product_id, new Set())
        adjacency.get(r.product_id)!.add(r.ingredient_product_id)
      }
    }

    // 3. Validate & resolve every incoming recipe row
    const failedItems: Array<{
      rowNumber: number
      product_ref: string
      ingredient_ref: string
      quantity: number
      reason: string
    }> = []

    const validMap = new Map<
      string,
      {
        product_id: string
        ingredient_product_id: string
        quantity: number
        unit: string
        notes: string | null
      }
    >()

    // If replace mode, clear existing edges of affected products from cycle-check graph first
    if (mode === 'replace') {
      for (const row of body.recipes) {
        const prodRes = resolveProductRef(row.product_ref, skuMap, nameMap)
        if (prodRes.match) {
          adjacency.delete(prodRes.match.id)
        }
      }
    }

    for (let i = 0; i < body.recipes.length; i++) {
      const row = body.recipes[i]
      const rowNum = row._rowNumber ?? i + 2
      const rawProd = String(row.product_ref || '').trim()
      const rawIng = String(row.ingredient_ref || '').trim()
      const cleanQty = Math.round((Number(row.quantity) || 0) * 10000) / 10000

      if (!rawProd) {
        failedItems.push({
          rowNumber: rowNum,
          product_ref: rawProd,
          ingredient_ref: rawIng,
          quantity: cleanQty,
          reason: 'SKU / Nama Produk Jadi kosong'
        })
        continue
      }

      if (!rawIng) {
        failedItems.push({
          rowNumber: rowNum,
          product_ref: rawProd,
          ingredient_ref: rawIng,
          quantity: cleanQty,
          reason: 'SKU / Nama Bahan Baku kosong'
        })
        continue
      }

      if (!(cleanQty > 0)) {
        failedItems.push({
          rowNumber: rowNum,
          product_ref: rawProd,
          ingredient_ref: rawIng,
          quantity: cleanQty,
          reason: 'Jumlah takaran resep harus lebih besar dari 0'
        })
        continue
      }

      const prodRes = resolveProductRef(rawProd, skuMap, nameMap)
      if (!prodRes.match) {
        failedItems.push({
          rowNumber: rowNum,
          product_ref: rawProd,
          ingredient_ref: rawIng,
          quantity: cleanQty,
          reason: `Produk Jadi: ${prodRes.error}`
        })
        continue
      }

      const ingRes = resolveProductRef(rawIng, skuMap, nameMap)
      if (!ingRes.match) {
        failedItems.push({
          rowNumber: rowNum,
          product_ref: rawProd,
          ingredient_ref: rawIng,
          quantity: cleanQty,
          reason: `Bahan Baku: ${ingRes.error}`
        })
        continue
      }

      const product = prodRes.match
      const ingredient = ingRes.match

      if (product.id === ingredient.id) {
        failedItems.push({
          rowNumber: rowNum,
          product_ref: rawProd,
          ingredient_ref: rawIng,
          quantity: cleanQty,
          reason: 'Produk tidak boleh menggunakan dirinya sendiri sebagai bahan baku'
        })
        continue
      }

      if (createsCycle(product.id, ingredient.id, adjacency)) {
        failedItems.push({
          rowNumber: rowNum,
          product_ref: rawProd,
          ingredient_ref: rawIng,
          quantity: cleanQty,
          reason: 'Relasi resep memicu siklus melingkar (circular dependency)'
        })
        continue
      }

      if (!adjacency.has(product.id)) adjacency.set(product.id, new Set())
      adjacency.get(product.id)!.add(ingredient.id)

      const pairKey = `${product.id}::${ingredient.id}`
      const existingPair = validMap.get(pairKey)
      validMap.set(pairKey, {
        product_id: product.id,
        ingredient_product_id: ingredient.id,
        quantity: existingPair ? Math.round((existingPair.quantity + cleanQty) * 10000) / 10000 : cleanQty,
        unit: ingredient.unit ? String(ingredient.unit).trim() : 'pcs',
        notes: row.notes ? String(row.notes).trim() : existingPair?.notes ?? null
      })
    }

    const validRecipes = Array.from(validMap.values())
    if (validRecipes.length === 0) {
      return NextResponse.json({
        success: false,
        upsertedCount: 0,
        affectedProductsCount: 0,
        failedItems,
        message: 'Tidak ada baris resep valid yang dapat disimpan.'
      }, { status: 400 })
    }

    // 4. Execute atomic Semi-Modular RPC
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('upsert_product_recipes_bulk_v1', {
      payload: {
        business_id: businessId,
        mode,
        recipes: validRecipes
      }
    })

    if (rpcErr) {
      throw new Error(`Gagal menyimpan resep (RPC): ${rpcErr.message}`)
    }

    invalidateHppCache()

    return NextResponse.json({
      success: true,
      upsertedCount: rpcRes?.upserted_count ?? validRecipes.length,
      affectedProductsCount: rpcRes?.affected_products_count ?? 0,
      failedItems,
      message: `Berhasil menyimpan ${rpcRes?.upserted_count ?? validRecipes.length} baris resep untuk ${rpcRes?.affected_products_count ?? 0} produk.`
    })
  } catch (err: any) {
    console.error('[ProductsBulkRecipes] Fatal error:', err)
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan pada server.' }, { status: 500 })
  }
}

