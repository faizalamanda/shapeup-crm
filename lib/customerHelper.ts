/**
 * ─── Universal Customer Directory & Resolution Helper ──────────────────────
 *
 * Single Source of Truth (SSOT) untuk pengambilan, pencarian, normalisasi nomor
 * telepon simetris (08 <-> 628), pembuatan/resolusi pelanggan, serta manajemen
 * cache in-memory di sisi server.
 *
 * Arsitektur & Standar Akademik:
 * 1. Bypass PostgREST 1.000-Row Ceiling: Menggunakan Chunked Range Fetching
 *    (.range(from, to)) sehingga bisnis dengan > 1.000 pelanggan (seperti Bisnis Tanem)
 *    dimuat 100% utuh tanpa Lexicographical Starvation.
 * 2. Single-Flight Deduplication & L1 Server Cache (TTL 60s): Mencegah stampede
 *    kueri berulang saat halaman Invoice, POS, dan Customer diakses bersamaan.
 * 3. Symmetric E.164 Phone Canonicalization: Menjamin pencarian "0812..." cocok
 *    dengan data tersimpan "62812..." maupun sebaliknya, baik di memori maupun SQL.
 * 4. Instant Cache Coherence: Setiap mutasi (POST/PATCH/DELETE/Bulk) langsung
 *    memperbarui atau meng-invalidate cache bisnis terkait.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuid } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CustomerDirectoryItem {
  id: string
  business_id?: string
  name: string
  phone: string
  email: string | null
  category?: string | null
  address_data?: any
  metadata?: any
  loyalty_points?: number
  loyalty_tier?: string
}

interface ServerCustomerCacheEntry {
  customers: CustomerDirectoryItem[]
  timestamp: number
}

// ─── Global Singleton Cache (Survives HMR & Warm Lambda Invocations) ────────

const CACHE_TTL_MS = 60_000 // 60 seconds
const CHUNK_SIZE = 1000

const globalRef = globalThis as unknown as {
  __suCustomerDirCache?: Map<string, ServerCustomerCacheEntry>
  __suCustomerDirInFlight?: Map<string, Promise<CustomerDirectoryItem[]>>
}

const customerCache: Map<string, ServerCustomerCacheEntry> =
  globalRef.__suCustomerDirCache || new Map<string, ServerCustomerCacheEntry>()
if (!globalRef.__suCustomerDirCache) {
  globalRef.__suCustomerDirCache = customerCache
}

const inFlightMap: Map<string, Promise<CustomerDirectoryItem[]>> =
  globalRef.__suCustomerDirInFlight || new Map<string, Promise<CustomerDirectoryItem[]>>()
if (!globalRef.__suCustomerDirInFlight) {
  globalRef.__suCustomerDirInFlight = inFlightMap
}

// ─── Phone Canonicalization & Search Variants ───────────────────────────────

/**
 * Menormalisasi nomor telepon ke bentuk kanonik penyimpanan database (628...).
 * Contoh:
 *   "0812-3456-7890" -> "6281234567890"
 *   "+62 812 3456"   -> "628123456"
 *   "8123456789"     -> "628123456789"
 */
export function normalizePhoneCanonical(rawPhone: string | null | undefined): string {
  if (!rawPhone) return ''
  let clean = String(rawPhone).replace(/\D/g, '')
  if (!clean) return ''

  if (clean.startsWith('0062')) {
    clean = '62' + clean.substring(4)
  } else if (clean.startsWith('0')) {
    clean = '62' + clean.substring(1)
  } else if (clean.startsWith('8')) {
    clean = '62' + clean
  }
  return clean
}

/**
 * Menghasilkan varian pencarian nomor telepon secara simetris.
 * Jika user mengetik "08123", menghasilkan ["08123", "628123", "8123"].
 * Jika user mengetik "628123", menghasilkan ["628123", "08123", "8123"].
 */
export function buildPhoneSearchVariants(rawQuery: string): string[] {
  const digits = String(rawQuery || '').replace(/\D/g, '')
  if (!digits || digits.length < 2) return []

  const variants = new Set<string>([digits])

  if (digits.startsWith('0')) {
    const withoutZero = digits.substring(1)
    if (withoutZero) {
      variants.add('62' + withoutZero)
      variants.add(withoutZero)
    }
  } else if (digits.startsWith('62')) {
    const without62 = digits.substring(2)
    if (without62) {
      variants.add('0' + without62)
      variants.add(without62)
    }
  } else if (digits.startsWith('8')) {
    variants.add('62' + digits)
    variants.add('0' + digits)
  }

  return Array.from(variants)
}

/**
 * Predikat pencocokan pelanggan yang aman dari null (Null-Safe) dan mendukung
 * pencocokan nomor telepon simetris (08 <-> 628).
 */
export function matchesCustomerQuery(
  customer: { name?: string | null; phone?: string | null; email?: string | null; metadata?: any },
  rawQuery: string
): boolean {
  const q = String(rawQuery || '').trim().toLowerCase()
  if (!q) return true

  const name = String(customer.name || '').toLowerCase()
  if (name.includes(q)) return true

  const email = String(customer.email || '').toLowerCase()
  if (email && email.includes(q)) return true

  const rawPhone = String(customer.phone || '').toLowerCase()
  if (rawPhone && rawPhone.includes(q)) return true

  // Marketplace profiles matching (e.g. shopee: 'budi99', tiktok: '@budi')
  const mkProfiles = customer.metadata?.marketplace_profiles
  if (mkProfiles && typeof mkProfiles === 'object') {
    for (const val of Object.values(mkProfiles)) {
      if (typeof val === 'string' && val.toLowerCase().includes(q)) return true
    }
  }

  // Symmetric phone digit matching
  const phoneDigits = rawPhone.replace(/\D/g, '')
  if (phoneDigits) {
    const variants = buildPhoneSearchVariants(q)
    for (const v of variants) {
      if (phoneDigits.includes(v)) return true
    }
  }

  return false
}

// ─── Sanitizer for Customer Row ─────────────────────────────────────────────

function sanitizeCustomerRow(row: any): CustomerDirectoryItem {
  return {
    id: String(row.id || row.customer_id || ''),
    business_id: row.business_id,
    name: row.name ? String(row.name).trim() : 'Tanpa Nama',
    phone: row.phone ? String(row.phone).trim() : '',
    email: row.email ? String(row.email).trim() : null,
    category: row.category || 'General',
    address_data: row.address_data ?? null,
    metadata: row.metadata ?? null,
    loyalty_points: row.loyalty_points !== undefined ? Number(row.loyalty_points || 0) : undefined,
    loyalty_tier: row.loyalty_tier || undefined,
  }
}

// ─── Cache Management ───────────────────────────────────────────────────────

/**
 * Menghapus cache pelanggan untuk bisnis tertentu di server.
 */
export function invalidateCustomerCache(businessId: string): void {
  if (!businessId) return
  customerCache.delete(businessId)
}

/**
 * Memperbarui atau menyisipkan satu entitas pelanggan langsung ke dalam
 * cache server (In-Place Cache Upsert) agar pembacaan berikutnya tetap 0ms
 * tanpa perlu mengunduh ulang seluruh chunk dari database.
 */
export function upsertCustomerInServerCache(
  businessId: string,
  customer: CustomerDirectoryItem
): void {
  if (!businessId || !customer?.id) return
  const entry = customerCache.get(businessId)
  if (!entry) return

  const clean = sanitizeCustomerRow(customer)
  const list = [...entry.customers]
  const existingIdx = list.findIndex(c => c.id === clean.id)

  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], ...clean }
  } else {
    list.push(clean)
  }

  list.sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }))
  customerCache.set(businessId, {
    customers: list,
    timestamp: Date.now()
  })
}

// ─── Full Directory Chunked Loader (Bypasses 1,000 PostgREST Limit) ─────────

/**
 * Memuat SELURUH pelanggan milik bisnis secara utuh dengan Chunked Range Fetching
 * (.range(from, to)) sehingga tidak pernah terpotong batas 1.000 baris PostgREST.
 */
export async function fetchAllBusinessCustomers(
  businessId: string,
  supabaseAdmin: SupabaseClient,
  forceRefresh = false
): Promise<CustomerDirectoryItem[]> {
  if (!businessId) return []

  const now = Date.now()
  if (!forceRefresh) {
    const cached = customerCache.get(businessId)
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.customers
    }
  }

  // Single-flight deduplication
  const inflight = inFlightMap.get(businessId)
  if (inflight && !forceRefresh) {
    return inflight
  }

  const fetchPromise = (async () => {
    try {
      const allRows: CustomerDirectoryItem[] = []
      let offset = 0

      while (true) {
        const { data, error } = await supabaseAdmin
          .from('customers')
          .select('id, business_id, name, phone, email, category, address_data, metadata')
          .eq('business_id', businessId)
          .order('name', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + CHUNK_SIZE - 1)

        if (error) throw error
        if (!data || data.length === 0) break

        for (const row of data) {
          allRows.push(sanitizeCustomerRow(row))
        }

        if (data.length < CHUNK_SIZE) {
          break
        }
        offset += CHUNK_SIZE

        // Safety ceiling (50,000 customers) to prevent infinite loops
        if (offset >= 50_000) break
      }

      customerCache.set(businessId, {
        customers: allRows,
        timestamp: Date.now()
      })

      return allRows
    } finally {
      inFlightMap.delete(businessId)
    }
  })()

  inFlightMap.set(businessId, fetchPromise)
  return fetchPromise
}

// ─── Hybrid Search & Hydration Query ────────────────────────────────────────

export async function queryBusinessCustomers(
  businessId: string,
  supabaseAdmin: SupabaseClient,
  options?: {
    search?: string
    limit?: number
    includeId?: string | null
    forceRefresh?: boolean
  }
): Promise<{ customers: CustomerDirectoryItem[]; total: number }> {
  const rawSearch = (options?.search || '').trim()
  const includeId = isUuid(options?.includeId) ? options!.includeId!.trim() : null
  const limit = options?.limit && Number.isFinite(options.limit) && options.limit > 0
    ? Math.min(10_000, options.limit)
    : 0

  // 1. Load complete directory (0ms if cached, chunked if cold)
  const fullList = await fetchAllBusinessCustomers(
    businessId,
    supabaseAdmin,
    options?.forceRefresh
  )

  // 2. Filter by search query if provided (using symmetric phone + name + email matching)
  let filtered = rawSearch
    ? fullList.filter(c => matchesCustomerQuery(c, rawSearch))
    : fullList

  // 3. Fallback direct DB search if search query yielded 0 results in cached list
  //    (e.g. customer was just added by an external webhook < 60s ago)
  if (rawSearch && filtered.length === 0) {
    const safeSearch = rawSearch.replace(/[,()]/g, ' ').trim()
    if (safeSearch) {
      const phoneVariants = buildPhoneSearchVariants(safeSearch)
      const orClauses = [
        `name.ilike.%${safeSearch}%`,
        `phone.ilike.%${safeSearch}%`,
        `email.ilike.%${safeSearch}%`,
        ...phoneVariants.map(v => `phone.ilike.%${v}%`)
      ]
      const uniqueClauses = Array.from(new Set(orClauses)).join(',')

      const { data: dbMatches } = await supabaseAdmin
        .from('customers')
        .select('id, business_id, name, phone, email, category, address_data, metadata')
        .eq('business_id', businessId)
        .or(uniqueClauses)
        .order('name', { ascending: true })
        .limit(50)

      if (dbMatches && dbMatches.length > 0) {
        const sanitizedMatches = dbMatches.map(sanitizeCustomerRow)
        for (const m of sanitizedMatches) {
          upsertCustomerInServerCache(businessId, m)
        }
        filtered = sanitizedMatches
      }
    }
  }

  const total = filtered.length

  // 4. Apply optional limit
  let result = limit > 0 ? filtered.slice(0, limit) : filtered

  // 5. Ensure `includeId` (e.g., selectedCustomerId on Edit Invoice) is always present
  if (includeId && !result.some(c => c.id === includeId)) {
    const inFull = fullList.find(c => c.id === includeId)
    if (inFull) {
      result = [inFull, ...result]
    } else {
      const { data: singleCust } = await supabaseAdmin
        .from('customers')
        .select('id, business_id, name, phone, email, category, address_data, metadata')
        .eq('business_id', businessId)
        .eq('id', includeId)
        .maybeSingle()

      if (singleCust) {
        const sanitized = sanitizeCustomerRow(singleCust)
        upsertCustomerInServerCache(businessId, sanitized)
        result = [sanitized, ...result]
      }
    }
  }

  return { customers: result, total }
}

// ─── Unified Customer Resolution / Creation ─────────────────────────────────

export interface ResolveOrCreateCustomerInput {
  businessId: string
  customerId?: string | null
  name?: string | null
  phone?: string | null
  email?: string | null
  category?: string | null
  address_data?: any
  metadata?: any
  marketplace_profiles?: Record<string, string | null | undefined> | null
  /**
   * Jika true (default di Invoice/POS/Order Manual), ketika nomor telepon sudah
   * terdaftar di bisnis ini, kembalikan customer yang sudah ada tanpa melempar error.
   * Jika false (seperti di form Buat Customer Baru /customers/new), kembalikan flag
   * conflict agar UI dapat memberi tahu pengguna.
   */
  reuseExistingOnPhoneMatch?: boolean
}

export interface ResolveOrCreateCustomerResult {
  customer: CustomerDirectoryItem
  isExisting: boolean
}

export async function resolveOrCreateCustomer(
  input: ResolveOrCreateCustomerInput,
  supabaseAdmin: SupabaseClient
): Promise<ResolveOrCreateCustomerResult> {
  const {
    businessId,
    customerId,
    name,
    phone,
    email,
    category = 'General',
    address_data = null,
    metadata = null,
    marketplace_profiles = null,
    reuseExistingOnPhoneMatch = true
  } = input

  // Merge marketplace_profiles into metadata cleanly
  const existingMeta = (metadata && typeof metadata === 'object') ? { ...metadata } : {}
  const rawProfiles = marketplace_profiles || existingMeta.marketplace_profiles || {}
  const cleanMarketplaceProfiles: Record<string, string> = {}

  if (rawProfiles && typeof rawProfiles === 'object') {
    for (const [key, val] of Object.entries(rawProfiles)) {
      if (val !== null && val !== undefined) {
        const s = String(val).trim()
        if (s) cleanMarketplaceProfiles[key.toLowerCase()] = s
      }
    }
  }

  const finalMetadata = {
    ...existingMeta,
    ...(Object.keys(cleanMarketplaceProfiles).length > 0
      ? { marketplace_profiles: cleanMarketplaceProfiles }
      : {})
  }

  // 1. If a valid UUID customerId is provided, verify and return it
  if (isUuid(customerId)) {
    const cleanId = customerId.trim()
    const cached = customerCache.get(businessId)?.customers.find(c => c.id === cleanId)
    if (cached) {
      return { customer: cached, isExisting: true }
    }

    const { data: byId } = await supabaseAdmin
      .from('customers')
      .select('id, business_id, name, phone, email, category, address_data, metadata')
      .eq('business_id', businessId)
      .eq('id', cleanId)
      .maybeSingle()

    if (byId) {
      const sanitized = sanitizeCustomerRow(byId)
      upsertCustomerInServerCache(businessId, sanitized)
      return { customer: sanitized, isExisting: true }
    }
  }

  // 2. Validate customer name
  const cleanName = String(name || '').trim()
  const cleanPhone = normalizePhoneCanonical(phone)

  if (!cleanName) {
    throw new Error('Nama pelanggan wajib diisi')
  }

  // 3A. Phone Matching: Check if phone number already exists in this business
  if (cleanPhone) {
    const phoneVariants = buildPhoneSearchVariants(cleanPhone)
    const { data: existingList, error: phoneErr } = await supabaseAdmin
      .from('customers')
      .select('id, business_id, name, phone, email, category, address_data, metadata')
      .eq('business_id', businessId)
      .in('phone', phoneVariants.length > 0 ? phoneVariants : [cleanPhone])
      .limit(1)

    if (phoneErr) throw phoneErr

    const existing = existingList && existingList.length > 0 ? existingList[0] : null

    if (existing) {
      if (!reuseExistingOnPhoneMatch) {
        const conflictErr: any = new Error(
          `Nomor HP sudah terdaftar atas nama pelanggan: ${existing.name}`
        )
        conflictErr.statusCode = 400
        conflictErr.existingCustomer = sanitizeCustomerRow(existing)
        throw conflictErr
      }

      // Optionally enrich address_data, email, or marketplace_profiles
      const existingMk = existing.metadata?.marketplace_profiles || {}
      const mergedMk = { ...existingMk, ...cleanMarketplaceProfiles }
      const hasNewMk = Object.keys(cleanMarketplaceProfiles).some(k => !existingMk[k])

      const needsEnrich =
        (!existing.email && email) ||
        (!existing.address_data && address_data) ||
        hasNewMk

      if (needsEnrich) {
        const updatedMeta = {
          ...(existing.metadata || {}),
          ...(Object.keys(mergedMk).length > 0 ? { marketplace_profiles: mergedMk } : {})
        }

        const { data: enriched } = await supabaseAdmin
          .from('customers')
          .update({
            email: existing.email || (email ? String(email).trim() : null),
            address_data: existing.address_data || address_data || null,
            metadata: updatedMeta
          })
          .eq('id', existing.id)
          .eq('business_id', businessId)
          .select('id, business_id, name, phone, email, category, address_data, metadata')
          .single()

        if (enriched) {
          const sanitized = sanitizeCustomerRow(enriched)
          upsertCustomerInServerCache(businessId, sanitized)
          return { customer: sanitized, isExisting: true }
        }
      }

      const sanitized = sanitizeCustomerRow(existing)
      upsertCustomerInServerCache(businessId, sanitized)
      return { customer: sanitized, isExisting: true }
    }
  }

  // 3B. Marketplace Profile Matching: If phone is absent, try matching by marketplace handle
  if (!cleanPhone && Object.keys(cleanMarketplaceProfiles).length > 0) {
    for (const [rawKey, handleVal] of Object.entries(cleanMarketplaceProfiles)) {
      const safeKey = rawKey.replace(/[^a-zA-Z0-9_]/g, '')
      if (safeKey && handleVal && typeof handleVal === 'string' && handleVal.trim()) {
        const cleanHandle = handleVal.trim()
        const { data: matchedRows, error: mkErr } = await supabaseAdmin
          .from('customers')
          .select('id, business_id, name, phone, email, category, address_data, metadata')
          .eq('business_id', businessId)
          .filter(`metadata->marketplace_profiles->>${safeKey}`, 'eq', cleanHandle)
          .limit(1)

        if (!mkErr && matchedRows && matchedRows.length > 0) {
          const existing = matchedRows[0]
          // Enrich address_data or email if missing
          const needsEnrich = (!existing.email && email) || (!existing.address_data && address_data)
          if (needsEnrich) {
            const { data: enriched } = await supabaseAdmin
              .from('customers')
              .update({
                email: existing.email || (email ? String(email).trim() : null),
                address_data: existing.address_data || address_data || null,
              })
              .eq('id', existing.id)
              .eq('business_id', businessId)
              .select('id, business_id, name, phone, email, category, address_data, metadata')
              .single()

            if (enriched) {
              const sanitized = sanitizeCustomerRow(enriched)
              upsertCustomerInServerCache(businessId, sanitized)
              return { customer: sanitized, isExisting: true }
            }
          }

          const sanitized = sanitizeCustomerRow(existing)
          upsertCustomerInServerCache(businessId, sanitized)
          return { customer: sanitized, isExisting: true }
        }
      }
    }
  }

  // 4. Insert new customer
  const { data: created, error: insertErr } = await supabaseAdmin
    .from('customers')
    .insert({
      business_id: businessId,
      name: cleanName,
      phone: cleanPhone || '',
      email: email ? String(email).trim() : null,
      category: category || 'General',
      address_data: address_data || null,
      metadata: Object.keys(finalMetadata).length > 0 ? finalMetadata : null,
    })
    .select('id, business_id, name, phone, email, category, address_data, metadata')
    .single()

  if (insertErr) throw insertErr

  const sanitized = sanitizeCustomerRow(created)
  upsertCustomerInServerCache(businessId, sanitized)

  return { customer: sanitized, isExisting: false }
}

