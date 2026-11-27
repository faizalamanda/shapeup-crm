/**
 * ─── Universal High-Cardinality (> 1,000 Rows) Chunked Query Helper ─────────
 *
 * Standar Utama ShapeUp CRM untuk mengatasi batas bawaan PostgREST (`db-max-rows = 1000`).
 * Digunakan di seluruh modul (Customers, Products, Invoices, POS, Purchases, Stock Opname)
 * ketika mengambil populasi data bisnis yang berpotensi melebihi 1.000 baris.
 */

const DEFAULT_CHUNK_SIZE = 1000
const DEFAULT_MAX_ROWS = 50_000

/**
 * Mengeksekusi kueri Supabase secara bertahap menggunakan `.range(from, to)`
 * hingga seluruh baris selesai diambil (tanpa terpotong di baris ke-1.000).
 *
 * Contoh Penggunaan:
 * ```ts
 * const allRows = await fetchAllSupabaseRows((from, to) =>
 *   supabase
 *     .from('products')
 *     .select('id, name, price, sku')
 *     .eq('business_id', businessId)
 *     .order('name', { ascending: true })
 *     .order('id', { ascending: true })
 *     .range(from, to)
 * )
 * ```
 */
export async function fetchAllSupabaseRows<T = any>(
  rangeQueryFactory: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: any }>,
  chunkSize = DEFAULT_CHUNK_SIZE,
  maxRows = DEFAULT_MAX_ROWS
): Promise<T[]> {
  const allRows: T[] = []
  let offset = 0

  while (offset < maxRows) {
    const { data, error } = await rangeQueryFactory(offset, offset + chunkSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break

    for (let i = 0; i < data.length; i++) {
      allRows.push(data[i])
    }

    if (data.length < chunkSize) {
      break
    }
    offset += chunkSize
  }

  return allRows
}

/**
 * Mengambil seluruh katalog produk beserta variasinya untuk suatu unit bisnis
 * secara bertahap (Chunked Range Fetching), lengkap dengan fallback jika
 * relasi `product_variants` belum tersedia.
 */
export async function fetchAllBusinessProducts<T = any>(
  supabaseClient: any,
  businessId: string,
  options?: {
    selectWithVariants?: string
    selectVariantsOnly?: string
    selectFallback?: string
  }
): Promise<T[]> {
  if (!businessId) return []

  // Strip embedded product_variants(...) and product_modifiers(...) from base products query
  // to avoid PostgreSQL 8s lateral-join RLS statement_timeout (code 57014) on > 5,000 products.
  // Variants and modifiers are hydrated in parallel via direct indexed table queries (~200ms).
  const stripEmbeddedRelations = (clause: string) =>
    clause
      .replace(/,\s*product_variants\s*\([^)]*\)/g, '')
      .replace(/,\s*product_modifiers\s*\([^)]*\)/g, '')
      .trim()

  const primaryBaseSelect = stripEmbeddedRelations(
    options?.selectWithVariants ||
      'id, name, price, sku, unit, pricing_type, wholesale_tiers, cost_price, stock_quantity, stock_type'
  )
  const secondaryBaseSelect = stripEmbeddedRelations(
    options?.selectVariantsOnly ||
      'id, name, price, sku, cost_price, stock_quantity, stock_type'
  )
  const selectFallback = stripEmbeddedRelations(
    options?.selectFallback ||
      'id, name, price, sku, cost_price, stock_quantity, stock_type'
  )

  const wantsModifiers = Boolean(
    options?.selectWithVariants && options.selectWithVariants.includes('product_modifiers')
  )

  const [rows, directVars, directMods] = await Promise.all([
    (async () => {
      let fetched: T[] = []
      try {
        fetched = await fetchAllSupabaseRows<T>((from, to) =>
          supabaseClient
            .from('products')
            .select(primaryBaseSelect)
            .eq('business_id', businessId)
            .order('name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )
      } catch {
        if (secondaryBaseSelect && secondaryBaseSelect !== primaryBaseSelect) {
          try {
            fetched = await fetchAllSupabaseRows<T>((from, to) =>
              supabaseClient
                .from('products')
                .select(secondaryBaseSelect)
                .eq('business_id', businessId)
                .order('name', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to)
            )
          } catch {}
        }
        if (fetched.length === 0) {
          fetched = await fetchAllSupabaseRows<T>((from, to) =>
            supabaseClient
              .from('products')
              .select(selectFallback)
              .eq('business_id', businessId)
              .order('name', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
          )
        }
      }
      return fetched
    })(),
    (async () => {
      try {
        return await fetchAllSupabaseRows<any>((from, to) =>
          supabaseClient
            .from('product_variants')
            .select('*')
            .eq('business_id', businessId)
            .order('name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )
      } catch {
        return []
      }
    })(),
    (async () => {
      if (!wantsModifiers) return []
      try {
        return await fetchAllSupabaseRows<any>((from, to) =>
          supabaseClient
            .from('product_modifiers')
            .select('*')
            .eq('business_id', businessId)
            .order('id', { ascending: true })
            .range(from, to)
        )
      } catch {
        return []
      }
    })()
  ])

  if (rows.length > 0) {
    const vMap = new Map<string, any[]>()
    for (const v of directVars || []) {
      if (!vMap.has(v.product_id)) vMap.set(v.product_id, [])
      vMap.get(v.product_id)!.push(v)
    }

    const mMap = new Map<string, any[]>()
    for (const m of directMods || []) {
      if (!mMap.has(m.product_id)) mMap.set(m.product_id, [])
      mMap.get(m.product_id)!.push(m)
    }

    for (const r of rows as any[]) {
      r.product_variants = vMap.get(r.id) || []
      if (wantsModifiers) {
        r.product_modifiers = mMap.get(r.id) || []
      }
    }
  }

  return rows
}

