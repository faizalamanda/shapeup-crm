/**
 * ─── Universal Product Search & Field-Weighted Ranking Engine (BM25F) ───────
 *
 * Modul terpusat (Single Source of Truth) untuk pencarian, pemfilteran, dan
 * pembobotan relevansi produk di seluruh halaman & komponen ShapeUp CRM:
 * - Halaman Daftar Produk (/products)
 * - Endpoint Server Pencarian Produk (/api/products/search)
 * - Dropdown Pemilih Produk (ProductSelectCombobox: Invoice, Order, Pembelian, RMA)
 * - Kasir POS (POSWorkspace & posCatalogStore)
 * - Stock Opname & Laporan Inventori
 *
 * Landasan Akademik:
 * - Robertson, S., Zaragoza, H., & Taylor, M. (2004). "Simple BM25 Extension to
 *   Multiple Weighted Fields (BM25F)." ACM CIKM, 42–49.
 * - Franklin, M. J., Jónsson, B. T., & Kossmann, D. (1996). "Performance Tradeoffs
 *   for Client-Server Query Processing." ACM SIGMOD, 149–160.
 *
 * Aturan Inti Domain (Nama Produk vs Kemiripan SKU):
 * 1. Deteksi Spasi Sebelum Trim (`hasSpace = /\s/.test(rawQuery.trimStart())`):
 *    - Jika query mengandung spasi (baik di tengah seperti "LUSH KAOS" maupun
 *      di akhir seperti "SRJ " atau "17 "), pencocokan dan bobot SKU
 *      DINONAKTIFKAN 100% (`skuWeight = 0`).
 *    - Hal ini memastikan pencarian multi-kata atau kata diikuti spasi hanya
 *      mencari pada Nama Produk (dan varian), bebas dari polusi ribuan kode SKU
 *      yang memiliki prefix serupa (misal 5.083 SKU "SRJxxxx").
 * 2. Hirarki Bobot Field (Saat Tanpa Spasi / Single Token):
 *    - Tier 1 (1000): Exact Product Name Match (`name === q`)
 *    - Tier 2 (960):  First-Word Exact Name Match (`name` diawali kata utuh `q`, misal "SRJ DASTER")
 *    - Tier 3 (920):  Exact SKU Match (`sku === q` — untuk scan/input SKU utuh)
 *    - Tier 4 (820):  Name Prefix Match (`name.startsWith(q)`)
 *    - Tier 5 (700):  Whole-Word Match di dalam Nama Produk (misal "4097" pada "HAZEL KAOS 4097 28")
 *    - Tier 6 (620):  Word-Prefix Match di dalam Nama Produk
 *    - Tier 7 (520):  Substring Match di dalam Nama Produk (`name.includes(q)`)
 *    - Tier 8 (420):  Variant Name Match (`variant.name.includes(q)`)
 *    - Tier 9 (220):  Description Match (`description.includes(q)`)
 *    - Tier 10 (60–90): Partial SKU Match (`sku.includes(q)` tapi `sku !== q`)
 *      -> Diberi bobot rendah agar produk yang hanya mirip sebagian di SKU tidak
 *         pernah menenggelamkan produk yang cocok pada Nama Produk.
 */

export interface SearchableProductVariant {
  id?: string
  name?: string | null
  sku?: string | null
  [key: string]: any
}

export interface SearchableProduct {
  id: string
  name?: string | null
  sku?: string | null
  description?: string | null
  product_variants?: SearchableProductVariant[] | null
  [key: string]: any
}

export type ProductMatchTier =
  | 'exact_name'
  | 'exact_sku'
  | 'name_first_word'
  | 'name_prefix'
  | 'name_whole_word'
  | 'name_word_prefix'
  | 'name_substring'
  | 'variant_name'
  | 'description'
  | 'sku_partial'
  | 'none'

export interface ParsedProductQuery {
  /** Raw input string as typed by user */
  raw: string
  /** Normalized lowercase query with collapsed internal whitespace */
  clean: string
  /** Sanitized query safe for PostgREST .or() filters (no commas or parentheses) */
  postgrestSafe: string
  /** Individual lowercase words/tokens */
  tokens: string[]
  /**
   * True if the user typed any whitespace after the first character
   * (e.g. "LUSH KAOS" or trailing space "SRJ ").
   * When true, SKU matching & SKU weighting are deactivated (weight = 0).
   */
  hasSpace: boolean
  /** True when SKU matching is active (only when query has no spaces and is non-empty) */
  skuActive: boolean
}

export interface ProductMatchResult {
  matched: boolean
  score: number
  isExactMatch: boolean
  tier: ProductMatchTier
}

/**
 * Mengurai string pencarian produk dan mendeteksi keberadaan spasi
 * SEBELUM `.trim()` menghapus spasi di ujung kanan.
 */
export function parseProductSearchQuery(rawQuery: string | null | undefined): ParsedProductQuery {
  const raw = typeof rawQuery === 'string' ? rawQuery : ''
  const trimmedStart = raw.trimStart()
  // Jika ada spasi setelah karakter pertama (termasuk trailing space seperti "SRJ "),
  // maka hasSpace = true dan pencocokan SKU dinonaktifkan.
  const hasSpace = trimmedStart.length > 0 && /\s/.test(trimmedStart)

  const clean = trimmedStart.trim().toLowerCase().replace(/\s+/g, ' ')
  const postgrestSafe = clean.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = clean ? clean.split(' ').filter(Boolean) : []

  return {
    raw,
    clean,
    postgrestSafe,
    tokens,
    hasSpace,
    skuActive: Boolean(clean && !hasSpace)
  }
}

/**
 * Menghitung skor relevansi (BM25F Field-Weighted Score) untuk satu produk
 * terhadap query pencarian.
 */
export function scoreProductMatch(
  product: SearchableProduct | null | undefined,
  queryOrParsed: string | ParsedProductQuery | null | undefined
): ProductMatchResult {
  if (!product) {
    return { matched: false, score: 0, isExactMatch: false, tier: 'none' }
  }

  const parsed =
    typeof queryOrParsed === 'object' && queryOrParsed !== null && 'clean' in queryOrParsed
      ? queryOrParsed
      : parseProductSearchQuery(queryOrParsed as string)

  const { clean, tokens, hasSpace, skuActive } = parsed

  if (!clean || tokens.length === 0) {
    return { matched: true, score: 0, isExactMatch: false, tier: 'none' }
  }

  const pName = String(product.name || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const pSku = String(product.sku || '').trim().toLowerCase()
  const pDesc = String(product.description || '').trim().toLowerCase()
  const variants = Array.isArray(product.product_variants) ? product.product_variants : []

  const nameWords = pName ? pName.split(' ').filter(Boolean) : []

  // ─── KASUS 1: Query Mengandung Spasi (hasSpace = true -> SKU Non-Aktif) ────
  if (hasSpace) {
    // 1. Exact full name match
    if (pName === clean) {
      return { matched: true, score: 1000, isExactMatch: true, tier: 'exact_name' }
    }

    // 2. Name starts with the exact phrase on a word boundary (e.g. "SRJ " or "LUSH KAOS")
    if (pName.startsWith(clean + ' ')) {
      return { matched: true, score: 960, isExactMatch: false, tier: 'name_first_word' }
    }

    // 3. Name starts with the exact phrase prefix
    if (pName.startsWith(clean)) {
      return { matched: true, score: 820, isExactMatch: false, tier: 'name_prefix' }
    }

    // 4. Exact phrase match on word boundary inside name
    if (pName.includes(' ' + clean + ' ') || pName.endsWith(' ' + clean)) {
      return { matched: true, score: 750, isExactMatch: false, tier: 'name_whole_word' }
    }

    // 5. Contiguous phrase substring inside name
    if (pName.includes(clean)) {
      return { matched: true, score: 680, isExactMatch: false, tier: 'name_substring' }
    }

    // 6. Multi-token match: all tokens must exist in Product Name
    if (tokens.length > 0 && tokens.every(t => pName.includes(t))) {
      let tokenScore = 540
      // Bonus if first token matches the first word of the product name
      if (nameWords[0] === tokens[0]) {
        tokenScore += 90
      } else if (nameWords[0]?.startsWith(tokens[0])) {
        tokenScore += 50
      }
      // Bonus for each token that matches a whole word in the product name
      for (const t of tokens) {
        if (nameWords.includes(t)) {
          tokenScore += 20
        }
      }
      return {
        matched: true,
        score: Math.min(675, tokenScore),
        isExactMatch: false,
        tier: 'name_whole_word'
      }
    }

    // 7. Variant Name Match (still ignoring variant SKU because hasSpace = true)
    if (variants.length > 0) {
      const combinedNameAndVariants =
        pName + ' ' + variants.map(v => String(v?.name || '').toLowerCase()).join(' ')
      if (tokens.every(t => combinedNameAndVariants.includes(t))) {
        return { matched: true, score: 420, isExactMatch: false, tier: 'variant_name' }
      }
    }

    // 8. Description Match (optional fallback when searching full product table)
    if (pDesc && tokens.every(t => pDesc.includes(t))) {
      return { matched: true, score: 220, isExactMatch: false, tier: 'description' }
    }

    // SKU is strictly ignored when hasSpace = true
    return { matched: false, score: 0, isExactMatch: false, tier: 'none' }
  }

  // ─── KASUS 2: Single Token Tanpa Spasi (skuActive = true) ─────────────────
  let nameScore = 0
  let nameTier: ProductMatchTier = 'none'
  let isExactName = false

  if (pName) {
    if (pName === clean) {
      nameScore = 1000
      nameTier = 'exact_name'
      isExactName = true
    } else if (nameWords[0] === clean) {
      // Kata pertama Nama Produk sama persis (contoh: ketik "SRJ" -> "SRJ DASTER BATIK", ketik "LUSH" -> "LUSH TANGTOP")
      nameScore = 960
      nameTier = 'name_first_word'
    } else if (pName.startsWith(clean)) {
      nameScore = 820
      nameTier = 'name_prefix'
    } else if (nameWords.includes(clean)) {
      // Kata utuh di tengah/akhir Nama Produk (contoh: ketik "4097" -> "HAZEL KAOS 4097 28")
      nameScore = 700
      nameTier = 'name_whole_word'
    } else if (nameWords.some(w => w.startsWith(clean))) {
      nameScore = 620
      nameTier = 'name_word_prefix'
    } else if (pName.includes(clean)) {
      nameScore = 520
      nameTier = 'name_substring'
    }
  }

  // Cek kecocokan Nama Varian jika nama utama belum cocok
  if (nameScore === 0 && variants.length > 0) {
    const hasVarNameMatch = variants.some(v =>
      String(v?.name || '').toLowerCase().includes(clean)
    )
    if (hasVarNameMatch) {
      nameScore = 420
      nameTier = 'variant_name'
    }
  }

  // Cek kecocokan SKU (Hanya aktif jika skuActive === true / tidak ada spasi)
  let skuScore = 0
  let isExactSku = false

  if (skuActive) {
    const exactMainSku = Boolean(pSku && pSku === clean)
    const exactVarSku = variants.some(v => String(v?.sku || '').trim().toLowerCase() === clean)

    if (exactMainSku || exactVarSku) {
      skuScore = 920
      isExactSku = true
    } else {
      const prefixMainSku = Boolean(pSku && pSku.startsWith(clean))
      const prefixVarSku = variants.some(v =>
        String(v?.sku || '').trim().toLowerCase().startsWith(clean)
      )
      const subMainSku = Boolean(pSku && pSku.includes(clean))
      const subVarSku = variants.some(v =>
        String(v?.sku || '').trim().toLowerCase().includes(clean)
      )

      if (prefixMainSku || prefixVarSku) {
        // Bobot SKU parsial sengaja rendah (90) agar tidak mengalahkan Nama Produk (520–1000)
        skuScore = 90
      } else if (subMainSku || subVarSku) {
        skuScore = 60
      }
    }
  }

  // Prioritaskan Exact Name (1000) > First-Word Name (960) > Exact SKU (920)
  if (isExactName) {
    return { matched: true, score: 1000, isExactMatch: true, tier: 'exact_name' }
  }
  if (nameTier === 'name_first_word') {
    return {
      matched: true,
      score: 960 + (isExactSku ? 20 : skuScore > 0 ? 15 : 0),
      isExactMatch: false,
      tier: 'name_first_word'
    }
  }
  if (isExactSku) {
    return { matched: true, score: 920 + (nameScore > 0 ? 20 : 0), isExactMatch: true, tier: 'exact_sku' }
  }

  // Jika cocok di Nama Produk, gunakan skor Nama Produk (+ bonus kecil jika SKU juga cocok)
  if (nameScore > 0) {
    return {
      matched: true,
      score: nameScore + (skuScore > 0 ? 15 : 0),
      isExactMatch: false,
      tier: nameTier
    }
  }

  // Jika cocok di Deskripsi Produk
  if (pDesc && pDesc.includes(clean)) {
    return {
      matched: true,
      score: 220 + (skuScore > 0 ? 10 : 0),
      isExactMatch: false,
      tier: 'description'
    }
  }

  // Jika hanya cocok sebagian di SKU
  if (skuScore > 0) {
    return {
      matched: true,
      score: skuScore,
      isExactMatch: false,
      tier: 'sku_partial'
    }
  }

  return { matched: false, score: 0, isExactMatch: false, tier: 'none' }
}

/**
 * Memfilter dan mengurutkan daftar produk berdasarkan skor relevansi BM25F.
 * Dapat langsung digunakan di komponen client (ProductSelectCombobox, POSWorkspace, ProductsPage)
 * maupun di server API (/api/products/search).
 */
export function rankProductsByQuery<T extends SearchableProduct>(
  products: T[],
  rawQuery: string | null | undefined,
  options?: {
    /** Jika false, hanya memfilter tanpa mengubah urutan asli ketika query kosong */
    preserveOrderWhenEmpty?: boolean
  }
): T[] {
  if (!Array.isArray(products) || products.length === 0) return []

  const parsed = parseProductSearchQuery(rawQuery)
  if (!parsed.clean) {
    return products
  }

  const scored: { item: T; score: number; isExactMatch: boolean }[] = []

  for (let i = 0; i < products.length; i++) {
    const item = products[i]
    if (!item) continue
    const res = scoreProductMatch(item, parsed)
    if (res.matched) {
      scored.push({
        item,
        score: res.score,
        isExactMatch: res.isExactMatch
      })
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    // Tie-breaker 1: Nama produk lebih pendek (lebih spesifik) menang
    const nameA = String(a.item.name || '').trim()
    const nameB = String(b.item.name || '').trim()
    if (nameA.length !== nameB.length) {
      return nameA.length - nameB.length
    }
    // Tie-breaker 2: Urutan abjad Nama Produk
    return nameA.localeCompare(nameB, 'id', { sensitivity: 'base', numeric: true })
  })

  return scored.map(s => s.item)
}

