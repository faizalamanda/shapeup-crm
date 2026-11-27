import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { fetchAllSupabaseRows } from '@/lib/chunkedQueryHelper'
import {
  parseProductSearchQuery,
  scoreProductMatch,
  SearchableProduct
} from '@/lib/productSearchHelper'
import { isUuid } from '@/lib/utils'

const VALID_SORT_FIELDS = new Set([
  'sku',
  'name',
  'category',
  'type',
  'stock_type',
  'stock_quantity',
  'cost_price',
  'price',
  'created_at'
])

/**
 * GET /api/products/search
 *
 * Endpoint universal berkecepatan tinggi (~90–350 ms) untuk pencarian, pemfilteran,
 * pengurutan, dan paginasi katalog produk dengan algoritma pembobotan BM25F
 * (`lib/productSearchHelper.ts`).
 *
 * Query Params:
 * - business_id (opsional, divalidasi oleh getApiContext)
 * - search / q  (string pencarian mentah; spasi di akhir dipertahankan untuk mematikan bobot SKU)
 * - category_id (UUID kategori)
 * - type        ('physical' | 'service')
 * - stock_type  ('tracked' | 'available' | 'unavailable')
 * - sort_field  ('sku' | 'name' | 'category' | 'type' | 'stock_type' | 'stock_quantity' | 'cost_price' | 'price')
 * - sort_order  ('asc' | 'desc')
 * - page        (default: 1)
 * - limit       (default: 25, max: 500)
 * - ids_only    ('true' jika hanya membutuhkan seluruh daftar ID hasil filter untuk bulk select)
 * - include_categories ('true' untuk menyertakan daftar kategori bisnis dalam 1 roundtrip)
 */
export async function GET(req: Request) {
  const ctx = await getApiContext({ req })
  if (ctx.error) return ctx.error
  const { businessId, supabaseAdmin } = ctx

  try {
    const url = new URL(req.url)

    // Pertahankan rawSearch (jangan di-trim dulu) agar spasi di akhir ("SRJ ") terdeteksi
    const rawSearch = url.searchParams.get('search') ?? url.searchParams.get('q') ?? ''
    const parsedQuery = parseProductSearchQuery(rawSearch)

    const rawCat = (url.searchParams.get('category_id') || '').trim()
    const categoryId = isUuid(rawCat) ? rawCat : ''

    const rawType = (url.searchParams.get('type') || '').trim()
    const productType = rawType === 'physical' || rawType === 'service' ? rawType : ''

    const rawStockType = (url.searchParams.get('stock_type') || '').trim()
    const stockType =
      rawStockType === 'tracked' || rawStockType === 'available' || rawStockType === 'unavailable'
        ? rawStockType
        : ''

    const rawSortField = (url.searchParams.get('sort_field') || '').trim()
    const sortField = VALID_SORT_FIELDS.has(rawSortField) ? rawSortField : ''

    const rawSortOrder = (url.searchParams.get('sort_order') || '').trim().toLowerCase()
    const sortOrder: 'asc' | 'desc' | '' =
      rawSortOrder === 'asc' || rawSortOrder === 'desc' ? rawSortOrder : ''

    const rawPage = parseInt(url.searchParams.get('page') || '1', 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

    const rawLimit = parseInt(url.searchParams.get('limit') || '25', 10)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 25

    const idsOnly = url.searchParams.get('ids_only') === 'true'
    const includeCategories = url.searchParams.get('include_categories') === 'true'

    const from = (page - 1) * limit
    const to = from + limit - 1

    // 1. Ambil daftar categories bisnis (sangat ringan, dipakai untuk join kategori di memori & dropdown filter)
    const { data: categoriesData, error: catErr } = await supabaseAdmin
      .from('categories')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name', { ascending: true })

    if (catErr) throw catErr
    const categories = categoriesData || []
    const categoryMap = new Map<string, { id: string; name: string }>()
    for (const c of categories) {
      categoryMap.set(c.id, { id: c.id, name: c.name })
    }

    // Helper untuk menerapkan filter dropdown (category, type, stock_type) ke query builder
    const applyDropdownFilters = (qBuilder: any) => {
      let qb = qBuilder.eq('business_id', businessId)
      if (categoryId) qb = qb.eq('category_id', categoryId)
      if (productType) qb = qb.eq('type', productType)
      if (stockType) qb = qb.eq('stock_type', stockType)
      return qb
    }

    // Helper pembanding eksplisit jika user mengklik header sort kolom tabel
    const compareProductsByField = (a: any, b: any, field: string, order: 'asc' | 'desc') => {
      let cmp = 0
      switch (field) {
        case 'sku': {
          const skuA = String(a.sku || '').trim().toLowerCase()
          const skuB = String(b.sku || '').trim().toLowerCase()
          if (!skuA && !skuB) cmp = 0
          else if (!skuA) cmp = 1
          else if (!skuB) cmp = -1
          else cmp = skuA.localeCompare(skuB, 'id', { numeric: true, sensitivity: 'base' })
          break
        }
        case 'name': {
          cmp = String(a.name || '').localeCompare(String(b.name || ''), 'id', {
            sensitivity: 'base',
            numeric: true
          })
          break
        }
        case 'category': {
          const catA = (categoryMap.get(a.category_id)?.name || '-').toLowerCase()
          const catB = (categoryMap.get(b.category_id)?.name || '-').toLowerCase()
          cmp = catA.localeCompare(catB, 'id', { sensitivity: 'base' })
          break
        }
        case 'type': {
          cmp = String(a.type || '').localeCompare(String(b.type || ''))
          break
        }
        case 'stock_type': {
          const prio: Record<string, number> = { tracked: 1, available: 2, unavailable: 3 }
          cmp = (prio[a.stock_type] || 99) - (prio[b.stock_type] || 99)
          break
        }
        case 'stock_quantity': {
          const qtyA = a.stock_type === 'tracked' ? Number(a.stock_quantity || 0) : -Infinity
          const qtyB = b.stock_type === 'tracked' ? Number(b.stock_quantity || 0) : -Infinity
          cmp = qtyA - qtyB
          break
        }
        case 'cost_price': {
          cmp = Number(a.cost_price || 0) - Number(b.cost_price || 0)
          break
        }
        case 'price': {
          cmp = Number(a.price || 0) - Number(b.price || 0)
          break
        }
        default:
          cmp = 0
      }
      return order === 'asc' ? cmp : -cmp
    }

    // ─── MODE 1: Hanya Mengambil Semua ID Hasil Filter (Untuk "Pilih Hasil Filter") ───
    if (idsOnly) {
      let idRows: { id: string; name?: string; sku?: string; description?: string }[] = []

      if (!parsedQuery.clean) {
        idRows = await fetchAllSupabaseRows((rFrom, rTo) =>
          applyDropdownFilters(supabaseAdmin.from('products').select('id'))
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(rFrom, rTo)
        )
      } else if (parsedQuery.hasSpace) {
        // Spasi aktif -> SKU non-aktif, hanya filter berdasarkan token pada name / description
        idRows = await fetchAllSupabaseRows((rFrom, rTo) => {
          let qb = applyDropdownFilters(
            supabaseAdmin.from('products').select('id, name, description')
          )
          for (const token of parsedQuery.tokens) {
            const safeToken = token.replace(/[,()]/g, '')
            if (safeToken) {
              qb = qb.or(`name.ilike.%${safeToken}%,description.ilike.%${safeToken}%`)
            }
          }
          return qb.order('id', { ascending: true }).range(rFrom, rTo)
        })
        idRows = idRows.filter(r => scoreProductMatch(r, parsedQuery).matched)
      } else {
        const safeQ = parsedQuery.postgrestSafe
        idRows = await fetchAllSupabaseRows((rFrom, rTo) =>
          applyDropdownFilters(supabaseAdmin.from('products').select('id, name, sku, description'))
            .or(`name.ilike.%${safeQ}%,sku.ilike.%${safeQ}%,description.ilike.%${safeQ}%`)
            .order('id', { ascending: true })
            .range(rFrom, rTo)
        )
      }

      return NextResponse.json({
        ids: idRows.map(r => r.id),
        totalCount: idRows.length
      })
    }

    let pageProducts: any[] = []
    let totalCount = 0
    let overallTotalCount = 0

    // Ambil total produk bisnis secara keseluruhan (head count cepat ~15ms) untuk tombol "Hapus Semua"
    const totalBizCountPromise = supabaseAdmin
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)

    // ─── MODE 2: Tanpa Kata Kunci Pencarian (Direct Paginated Query Shipping ~90ms) ───
    if (!parsedQuery.clean) {
      // Jika sort berdasarkan nama kategori (foreign table) atau stock_type/stock_quantity khusus,
      // tarik rows terfilter dengan chunked helper lalu sort di server
      if (sortField && sortOrder && (sortField === 'category' || sortField === 'stock_type' || sortField === 'stock_quantity')) {
        const allFiltered = await fetchAllSupabaseRows<any>((rFrom, rTo) =>
          applyDropdownFilters(supabaseAdmin.from('products').select('*'))
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(rFrom, rTo)
        )
        allFiltered.sort((a, b) => compareProductsByField(a, b, sortField, sortOrder))
        totalCount = allFiltered.length
        pageProducts = allFiltered.slice(from, to + 1)
      } else {
        // Direct SQL ORDER BY + LIMIT/OFFSET (.range(from, to)) -> ~90ms!
        let qb = applyDropdownFilters(
          supabaseAdmin.from('products').select('*', { count: 'exact' })
        )

        if (sortField && sortOrder) {
          qb = qb.order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false })
        } else {
          qb = qb.order('created_at', { ascending: false })
        }
        qb = qb.order('id', { ascending: true }).range(from, to)

        const { data: rows, count, error: qErr } = await qb
        if (qErr) throw qErr

        pageProducts = rows || []
        totalCount = count ?? pageProducts.length
      }
    } else {
      // ─── MODE 3: Pencarian Aktif dengan Pembobotan BM25F (Nama Produk vs SKU) ───
      const safeQ = parsedQuery.postgrestSafe

      if (parsedQuery.hasSpace) {
        // KASUS 3A: Query Mengandung Spasi ("SRJ ", "LUSH KAOS", dll.)
        // -> Bobot & Pencocokan SKU DINONAKTIFKAN 100% (skuActive = false)
        const [nameMatchedRows, variantMatchedRows] = await Promise.all([
          fetchAllSupabaseRows<any>((rFrom, rTo) => {
            let qb = applyDropdownFilters(supabaseAdmin.from('products').select('*'))
            // Gunakan token pertama di SQL untuk menyaring kandidat dengan cepat,
            // lalu seluruh token divalidasi & diberi skor oleh scoreProductMatch
            const firstToken = (parsedQuery.tokens[0] || '').replace(/[,()]/g, '')
            if (firstToken) {
              qb = qb.or(`name.ilike.%${firstToken}%,description.ilike.%${firstToken}%`)
            }
            return qb
              .order('created_at', { ascending: false })
              .order('id', { ascending: true })
              .range(rFrom, rTo)
          }),
          (async () => {
            try {
              const firstToken = (parsedQuery.tokens[0] || '').replace(/[,()]/g, '')
              if (!firstToken) return []
              const { data: vRows } = await supabaseAdmin
                .from('product_variants')
                .select('product_id, name, sku')
                .eq('business_id', businessId)
                .ilike('name', `%${firstToken}%`)
                .limit(200)
              return vRows || []
            } catch {
              return []
            }
          })()
        ])

        const candidateMap = new Map<string, any>()
        for (const p of nameMatchedRows) {
          if (p?.id) candidateMap.set(p.id, p)
        }

        // Jika ada varian yang namanya cocok namun produk induknya belum terambil
        const missingParentIds = Array.from(
          new Set(
            variantMatchedRows
              .map((v: any) => v.product_id)
              .filter((pid: string) => pid && !candidateMap.has(pid))
          )
        )
        if (missingParentIds.length > 0) {
          const { data: extraParents } = await applyDropdownFilters(
            supabaseAdmin.from('products').select('*')
          ).in('id', missingParentIds.slice(0, 200))
          for (const ep of extraParents || []) {
            if (ep?.id) candidateMap.set(ep.id, ep)
          }
        }

        // Lampirkan varian kandidat untuk penilaian skor
        if (variantMatchedRows.length > 0) {
          for (const v of variantMatchedRows) {
            const parent = candidateMap.get(v.product_id)
            if (parent) {
              if (!Array.isArray(parent.product_variants)) parent.product_variants = []
              parent.product_variants.push(v)
            }
          }
        }

        // Hitung skor BM25F (SKU otomatis diabaikan karena hasSpace = true)
        const scoredCandidates: { item: any; score: number }[] = []
        for (const item of candidateMap.values()) {
          const res = scoreProductMatch(item, parsedQuery)
          if (res.matched) {
            scoredCandidates.push({ item, score: res.score })
          }
        }

        if (sortField && sortOrder) {
          scoredCandidates.sort((a, b) =>
            compareProductsByField(a.item, b.item, sortField, sortOrder)
          )
        } else {
          scoredCandidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            const nameA = String(a.item.name || '').trim()
            const nameB = String(b.item.name || '').trim()
            if (nameA.length !== nameB.length) return nameA.length - nameB.length
            return nameA.localeCompare(nameB, 'id', { sensitivity: 'base', numeric: true })
          })
        }

        totalCount = scoredCandidates.length
        pageProducts = scoredCandidates.slice(from, to + 1).map(s => s.item)
      } else {
        // KASUS 3B: Single Token Tanpa Spasi (contoh: "LUSH", "SRJ", "KAOS", "SRJ3505", "4097")
        // Jalankan 2 jalur paralel:
        // 1) Jalur Prioritas Tinggi (Nama Produk, Deskripsi, & Exact SKU) -> diambil 100% semua barisnya via chunked fetch!
        // 2) Jalur Prioritas Rendah (Partial SKU) -> diambil sesuai window halaman + count exact agar jika ada 5.083 SKU "SRJxxxx" tetap super cepat (~120ms)!
        const partialFetchWindow = Math.min(2000, Math.max(250, to + 100))

        const [highPriorityRows, partialSkuRes, variantMatchedRows] = await Promise.all([
          fetchAllSupabaseRows<any>((rFrom, rTo) =>
            applyDropdownFilters(supabaseAdmin.from('products').select('*'))
              .or(`name.ilike.%${safeQ}%,description.ilike.%${safeQ}%,sku.ilike.${safeQ}`)
              .order('created_at', { ascending: false })
              .order('id', { ascending: true })
              .range(rFrom, rTo)
          ),
          applyDropdownFilters(
            supabaseAdmin.from('products').select('*', { count: 'exact' })
          )
            .ilike('sku', `%${safeQ}%`)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(0, partialFetchWindow - 1),
          (async () => {
            try {
              const { data: vRows } = await supabaseAdmin
                .from('product_variants')
                .select('product_id, name, sku')
                .eq('business_id', businessId)
                .or(`name.ilike.%${safeQ}%,sku.ilike.%${safeQ}%`)
                .limit(200)
              return vRows || []
            } catch {
              return []
            }
          })()
        ])

        const candidateMap = new Map<string, any>()
        const highPriorityIds = new Set<string>()

        for (const p of highPriorityRows) {
          if (p?.id) {
            candidateMap.set(p.id, p)
            highPriorityIds.add(p.id)
          }
        }

        // Hitung berapa baris di highPriorityRows yang juga memiliki SKU mengandung safeQ (irisan himpunan)
        let overlapSkuCount = 0
        for (const p of highPriorityRows) {
          if (String(p?.sku || '').toLowerCase().includes(safeQ)) {
            overlapSkuCount++
          }
        }

        const partialSkuRows = partialSkuRes.data || []
        const totalSkuMatches = partialSkuRes.count ?? partialSkuRows.length

        for (const p of partialSkuRows) {
          if (p?.id && !candidateMap.has(p.id)) {
            candidateMap.set(p.id, p)
          }
        }

        // Jika ada varian yang cocok namun produk induknya belum ada di candidateMap
        const missingParentIds = Array.from(
          new Set(
            variantMatchedRows
              .map((v: any) => v.product_id)
              .filter((pid: string) => pid && !candidateMap.has(pid))
          )
        )
        let extraVariantParentCount = 0
        if (missingParentIds.length > 0) {
          const { data: extraParents } = await applyDropdownFilters(
            supabaseAdmin.from('products').select('*')
          ).in('id', missingParentIds.slice(0, 200))
          for (const ep of extraParents || []) {
            if (ep?.id && !candidateMap.has(ep.id)) {
              candidateMap.set(ep.id, ep)
              extraVariantParentCount++
            }
          }
        }

        if (variantMatchedRows.length > 0) {
          for (const v of variantMatchedRows) {
            const parent = candidateMap.get(v.product_id)
            if (parent) {
              if (!Array.isArray(parent.product_variants)) parent.product_variants = []
              parent.product_variants.push(v)
            }
          }
        }

        // Beri skor BM25F pada seluruh kandidat:
        // Semua produk yang Nama Produknya cocok (misal 22 produk "LUSH" atau 48 produk "SRJ ...")
        // mendapat skor 520–1000, sedangkan yang hanya cocok sebagian di SKU mendapat skor 60–90!
        const scoredCandidates: { item: any; score: number }[] = []
        for (const item of candidateMap.values()) {
          const res = scoreProductMatch(item, parsedQuery)
          if (res.matched) {
            scoredCandidates.push({ item, score: res.score })
          }
        }

        if (sortField && sortOrder) {
          scoredCandidates.sort((a, b) =>
            compareProductsByField(a.item, b.item, sortField, sortOrder)
          )
        } else {
          scoredCandidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            const nameA = String(a.item.name || '').trim()
            const nameB = String(b.item.name || '').trim()
            if (nameA.length !== nameB.length) return nameA.length - nameB.length
            return nameA.localeCompare(nameB, 'id', { sensitivity: 'base', numeric: true })
          })
        }

        // Total gabungan mengikuti prinsip Inklusi-Eksklusi:
        // |Name U SKU| = |Name| + |SKU| - |Name ∩ SKU| + |ExtraVariants|
        const exactUnionCount =
          highPriorityIds.size + Math.max(0, totalSkuMatches - overlapSkuCount) + extraVariantParentCount
        totalCount = Math.max(scoredCandidates.length, exactUnionCount)
        pageProducts = scoredCandidates.slice(from, to + 1).map(s => s.item)
      }
    }

    // 2. Hydrate categories, product_variants, dan product_modifiers HANYA untuk produk di halaman aktif (~15ms!)
    const pageProductIds = pageProducts.map(p => p.id).filter(Boolean)
    const [variantsRes, modifiersRes, totalBizRes] = await Promise.all([
      pageProductIds.length > 0
        ? supabaseAdmin
            .from('product_variants')
            .select('*')
            .eq('business_id', businessId)
            .in('product_id', pageProductIds)
            .order('name', { ascending: true })
        : Promise.resolve({ data: [] }),
      pageProductIds.length > 0
        ? supabaseAdmin
            .from('product_modifiers')
            .select('*')
            .eq('business_id', businessId)
            .in('product_id', pageProductIds)
        : Promise.resolve({ data: [] }),
      totalBizCountPromise
    ])

    overallTotalCount = totalBizRes.count ?? totalCount

    const variantsByProduct = new Map<string, any[]>()
    for (const v of variantsRes.data || []) {
      if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, [])
      variantsByProduct.get(v.product_id)!.push(v)
    }

    const modifiersByProduct = new Map<string, any[]>()
    for (const m of modifiersRes.data || []) {
      if (!modifiersByProduct.has(m.product_id)) modifiersByProduct.set(m.product_id, [])
      modifiersByProduct.get(m.product_id)!.push(m)
    }

    const hydratedProducts = pageProducts.map(p => ({
      ...p,
      categories: p.category_id ? categoryMap.get(p.category_id) || null : null,
      product_variants: variantsByProduct.get(p.id) || [],
      product_modifiers: modifiersByProduct.get(p.id) || []
    }))

    return NextResponse.json({
      products: hydratedProducts,
      totalCount,
      overallTotalCount,
      page,
      limit,
      queryMeta: {
        hasSpace: parsedQuery.hasSpace,
        skuActive: parsedQuery.skuActive,
        cleanQuery: parsedQuery.clean
      },
      ...(includeCategories ? { categories } : {})
    })
  } catch (err: any) {
    console.error('[API /api/products/search] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Gagal memuat daftar produk' },
      { status: 500 }
    )
  }
}

