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

  const selectWithVariants =
    options?.selectWithVariants ||
    'id, name, price, sku, cost_price, stock_quantity, stock_type, product_variants(id, name, sku, price, cost_price, stock_quantity)'
  const selectVariantsOnly =
    options?.selectVariantsOnly ||
    'id, name, price, sku, cost_price, stock_quantity, stock_type, product_variants(id, name, sku, price, cost_price, stock_quantity)'
  const selectFallback =
    options?.selectFallback ||
    'id, name, price, sku, cost_price, stock_quantity, stock_type'

  let rows: T[] = []
  try {
    rows = await fetchAllSupabaseRows<T>((from, to) =>
      supabaseClient
        .from('products')
        .select(selectWithVariants)
        .eq('business_id', businessId)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (err1) {
    if (selectVariantsOnly && selectVariantsOnly !== selectWithVariants) {
      try {
        rows = await fetchAllSupabaseRows<T>((from, to) =>
          supabaseClient
            .from('products')
            .select(selectVariantsOnly)
            .eq('business_id', businessId)
            .order('name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )
      } catch (err2) {}
    }
    if (rows.length === 0) {
      rows = await fetchAllSupabaseRows<T>((from, to) =>
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

  // Self-healing direct table hydration: if embedded join fell back and product_variants is missing,
  // hydrate variants directly from product_variants table so variants NEVER disappear or return empty.
  if (rows.length > 0 && (rows[0] as any)?.product_variants === undefined) {
    try {
      const { data: directVars } = await supabaseClient
        .from('product_variants')
        .select('*')
        .eq('business_id', businessId)
        .order('name', { ascending: true })
      if (directVars) {
        const vMap = new Map<string, any[]>()
        for (const v of directVars) {
          if (!vMap.has(v.product_id)) vMap.set(v.product_id, [])
          vMap.get(v.product_id)!.push(v)
        }
        for (const r of rows as any[]) {
          r.product_variants = vMap.get(r.id) || []
        }
      }
    } catch {
      // ignore if product_variants table does not exist
    }
  }

  return rows
}

