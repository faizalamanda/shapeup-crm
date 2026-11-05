"use client"

/**
 * ─── Client-Side Reactive POS Catalog & Category Store ──────────────────────
 *
 * Arsitektur State Katalog Kasir Terpusat (5-Pillar Zero-Latency Architecture):
 * 1. L1 Cache (In-Memory RAM Map per businessId): Akses 0ms saat navigasi POSHub <-> POSWorkspace.
 * 2. L2 Cache (sessionStorage `su_pos_cat_v1_${businessId}`): Akses 0ms saat reload browser.
 * 3. Speculative Background Prefetching: Mengunduh katalog produk saat kasir membuka POSHub.
 * 4. Stale-While-Revalidate (SWR): Menampilkan katalog lokal seketika (0ms), revalidasi di background.
 * 5. Optimistic Local Stock Mutation: Mengurangi stok produk di memori setelah transaksi sukses.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchAllBusinessProducts } from '@/lib/chunkedQueryHelper'

// ─── Types & Constants ───────────────────────────────────────────────────────

export interface PosCatalogItem {
  id: string
  business_id: string
  name: string
  sku?: string | null
  price: number
  cost_price: number
  stock_quantity: number
  stock_type: string
  category_id?: string | null
  type?: string
  has_variants?: boolean
  prevent_below_hpp?: boolean
  product_variants?: any[]
  product_modifiers?: any[]
  [key: string]: any
}

export interface PosCategoryItem {
  id: string
  business_id: string
  name: string
  color?: string
  [key: string]: any
}

interface L1PosCatalogEntry {
  products: PosCatalogItem[]
  categories: PosCategoryItem[]
  ts: number
}

const L1_STALE_MS = 60_000        // Background recheck after 60s
const L2_TTL_MS = 10 * 60_000     // sessionStorage valid for 10 minutes
const BROADCAST_CHANNEL_NAME = 'shapeup_pos_catalog_sync_v1'
const CUSTOM_EVENT_NAME = 'shapeup:pos_catalog_updated'

export const POS_SLIM_PRODUCT_SELECT_VARIANTS =
  'id, business_id, name, sku, price, cost_price, stock_quantity, stock_type, category_id, type, has_variants, prevent_below_hpp, product_variants(*), product_modifiers(*)'

export const POS_SLIM_PRODUCT_SELECT_FALLBACK =
  'id, business_id, name, sku, price, cost_price, stock_quantity, stock_type, category_id, type, has_variants, prevent_below_hpp'

function getL2Key(businessId: string): string {
  return `su_pos_cat_v1_${businessId}`
}

// ─── L1 In-Memory Store & In-Flight Registry ────────────────────────────────

const l1Store = new Map<string, L1PosCatalogEntry>()
const inFlightFetches = new Map<string, Promise<{ products: PosCatalogItem[]; categories: PosCategoryItem[] }>>()
const listeners = new Set<(businessId: string) => void>()

function emitChange(businessId: string) {
  listeners.forEach((listener) => {
    try {
      listener(businessId)
    } catch (e) {
      console.error('[posCatalogStore] Listener error:', e)
    }
  })
}

// ─── L2 SessionStorage Cache Helpers ────────────────────────────────────────

function readL2Cache(businessId: string): L1PosCatalogEntry | null {
  if (typeof window === 'undefined' || !businessId) return null
  try {
    const raw = sessionStorage.getItem(getL2Key(businessId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as L1PosCatalogEntry
    if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.categories)) return null
    if (Date.now() - parsed.ts > L2_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeL2Cache(
  businessId: string,
  products: PosCatalogItem[],
  categories: PosCategoryItem[],
  ts = Date.now()
) {
  if (typeof window === 'undefined' || !businessId) return
  try {
    // Quota guard: for very large product catalogs (> 500 items), strip description/extra metadata
    const slimProducts = products.length > 500
      ? products.map((p) => ({
          id: p.id,
          business_id: p.business_id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          cost_price: p.cost_price,
          stock_quantity: p.stock_quantity,
          stock_type: p.stock_type,
          category_id: p.category_id,
          type: p.type,
          has_variants: p.has_variants,
          prevent_below_hpp: p.prevent_below_hpp,
          product_variants: p.product_variants,
          product_modifiers: p.product_modifiers,
        }))
      : products

    sessionStorage.setItem(
      getL2Key(businessId),
      JSON.stringify({ products: slimProducts, categories, ts })
    )
  } catch {
    // If quota exceeded, silently continue (L1 RAM cache still works 100%)
  }
}

// ─── Global Broadcast Channel Setup ─────────────────────────────────────────

let broadcastChannel: BroadcastChannel | null = null

if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    broadcastChannel.onmessage = (event) => {
      const data = event.data
      if (data && data.type === 'POS_CATALOG_MUTATION' && data.businessId) {
        if (data.action === 'invalidate') {
          invalidatePosCatalogCache(data.businessId, false)
        } else if (data.action === 'stock_decrement' && Array.isArray(data.soldItems)) {
          applyLocalStockDecrement(data.businessId, data.soldItems, false)
        }
      }
    }
  } catch {}
}

// ─── Invalidate & Local Stock Mutation ──────────────────────────────────────

export function invalidatePosCatalogCache(businessId?: string, broadcast = true): void {
  if (businessId) {
    l1Store.delete(businessId)
    if (typeof window !== 'undefined') {
      try { sessionStorage.removeItem(getL2Key(businessId)) } catch {}
    }
    emitChange(businessId)
  } else {
    l1Store.clear()
    if (typeof window !== 'undefined') {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i)
          if (k && k.startsWith('su_pos_cat_v1_')) {
            sessionStorage.removeItem(k)
          }
        }
      } catch {}
    }
    listeners.forEach((fn) => fn(''))
  }

  if (broadcast && typeof window !== 'undefined') {
    try {
      broadcastChannel?.postMessage({
        type: 'POS_CATALOG_MUTATION',
        businessId,
        action: 'invalidate'
      })
      window.dispatchEvent(
        new CustomEvent(CUSTOM_EVENT_NAME, {
          detail: { businessId, action: 'invalidate' }
        })
      )
    } catch {}
  }
}

export function applyLocalStockDecrement(
  businessId: string,
  soldItems: { productId: string; variantId?: string; quantity: number }[],
  broadcast = true
): void {
  if (!businessId || !soldItems || soldItems.length === 0) return

  const entry = l1Store.get(businessId) || readL2Cache(businessId)
  if (!entry) return

  const nextProducts = entry.products.map((p) => {
    const sold = soldItems.find((s) => s.productId === p.id)
    if (!sold) return p

    let updatedProduct = { ...p }

    // If item has variants and variant was sold
    if (sold.variantId && Array.isArray(p.product_variants)) {
      const nextVariants = p.product_variants.map((v: any) => {
        if (v.id === sold.variantId) {
          return {
            ...v,
            stock_quantity: Math.max(0, Number(v.stock_quantity || 0) - sold.quantity)
          }
        }
        return v
      })
      updatedProduct.product_variants = nextVariants
    }

    // Decrement main product physical stock if tracked
    if (p.stock_type === 'tracked') {
      updatedProduct.stock_quantity = Math.max(0, Number(p.stock_quantity || 0) - sold.quantity)
    }

    return updatedProduct
  })

  const now = Date.now()
  l1Store.set(businessId, { products: nextProducts, categories: entry.categories, ts: now })
  writeL2Cache(businessId, nextProducts, entry.categories, now)
  emitChange(businessId)

  if (broadcast && typeof window !== 'undefined') {
    try {
      broadcastChannel?.postMessage({
        type: 'POS_CATALOG_MUTATION',
        businessId,
        action: 'stock_decrement',
        soldItems
      })
      window.dispatchEvent(
        new CustomEvent(CUSTOM_EVENT_NAME, {
          detail: { businessId, action: 'stock_decrement', soldItems }
        })
      )
    } catch {}
  }
}

// ─── Fetcher & Prefetcher ───────────────────────────────────────────────────

export async function fetchPosCatalog(
  supabaseClient: any,
  businessId: string,
  options?: { forceRefresh?: boolean }
): Promise<{ products: PosCatalogItem[]; categories: PosCategoryItem[] }> {
  if (!businessId) return { products: [], categories: [] }

  const force = Boolean(options?.forceRefresh)

  if (!force) {
    const l1 = l1Store.get(businessId)
    if (l1 && Date.now() - l1.ts < L1_STALE_MS) {
      return { products: l1.products, categories: l1.categories }
    }
  }

  const existingPromise = inFlightFetches.get(businessId)
  if (existingPromise && !force) {
    return existingPromise
  }

  const fetchTask = (async () => {
    try {
      const [prods, catsRes] = await Promise.all([
        fetchAllBusinessProducts<PosCatalogItem>(supabaseClient, businessId, {
          selectWithVariants: POS_SLIM_PRODUCT_SELECT_VARIANTS,
          selectFallback: POS_SLIM_PRODUCT_SELECT_FALLBACK,
        }),
        supabaseClient
          .from('categories')
          .select('id, business_id, name, color')
          .eq('business_id', businessId)
          .order('name', { ascending: true })
      ])

      const cleanProducts = prods || []
      const cleanCategories = (catsRes?.data as PosCategoryItem[]) || []

      const now = Date.now()
      l1Store.set(businessId, { products: cleanProducts, categories: cleanCategories, ts: now })
      writeL2Cache(businessId, cleanProducts, cleanCategories, now)
      emitChange(businessId)

      return { products: cleanProducts, categories: cleanCategories }
    } catch (err) {
      console.error('[posCatalogStore] Fetch error:', err)

      // Fallback sistem lama jika chunked range query gagal: eksekusi direct query biasa
      try {
        const [directProds, directCats] = await Promise.all([
          supabaseClient
            .from('products')
            .select('id, business_id, name, sku, price, cost_price, stock_quantity, stock_type, category_id, type')
            .eq('business_id', businessId)
            .order('name', { ascending: true })
            .limit(1000),
          supabaseClient
            .from('categories')
            .select('id, business_id, name, color')
            .eq('business_id', businessId)
            .order('name', { ascending: true })
        ])

        if (directProds?.data && Array.isArray(directProds.data) && directProds.data.length > 0) {
          const fallbackProds = directProds.data as PosCatalogItem[]
          const fallbackCats = (directCats?.data as PosCategoryItem[]) || []
          const now = Date.now()
          l1Store.set(businessId, { products: fallbackProds, categories: fallbackCats, ts: now })
          writeL2Cache(businessId, fallbackProds, fallbackCats, now)
          emitChange(businessId)
          return { products: fallbackProds, categories: fallbackCats }
        }
      } catch (legacyErr) {
        console.warn('[posCatalogStore] Emergency direct fallback failed:', legacyErr)
      }

      const fallback = l1Store.get(businessId) || readL2Cache(businessId)
      return {
        products: Array.isArray(fallback?.products) ? fallback.products : [],
        categories: Array.isArray(fallback?.categories) ? fallback.categories : []
      }
    } finally {
      inFlightFetches.delete(businessId)
    }
  })()

  inFlightFetches.set(businessId, fetchTask)
  return fetchTask
}

/**
 * Panggil fungsi ini di POSHub saat kasir melihat sesi shift.
 * Menjamin saat kasir menekan "Buka Register Kasir", katalog sudah 100% siap di memori RAM (0ms).
 */
export function prefetchPosCatalog(supabaseClient: any, businessId: string): void {
  if (!businessId) return
  const l1 = l1Store.get(businessId)
  if (l1 && Date.now() - l1.ts < L1_STALE_MS) {
    return // Already fresh in memory
  }
  fetchPosCatalog(supabaseClient, businessId).catch(() => {})
}

// ─── React Hook: usePosCatalog ──────────────────────────────────────────────

export function usePosCatalog(
  supabaseClient: any,
  businessId?: string | null,
  options?: { enabled?: boolean }
) {
  const resolvedBid = (businessId || '').trim()
  const enabled = options?.enabled !== false

  const [state, setState] = useState<{
    products: PosCatalogItem[]
    categories: PosCategoryItem[]
    loading: boolean
    isSyncing: boolean
  }>(() => {
    if (!resolvedBid) {
      return { products: [], categories: [], loading: false, isSyncing: false }
    }
    const l1 = l1Store.get(resolvedBid)
    if (l1) {
      return { products: l1.products, categories: l1.categories, loading: false, isSyncing: false }
    }
    const l2 = readL2Cache(resolvedBid)
    if (l2) {
      l1Store.set(resolvedBid, l2)
      return { products: l2.products, categories: l2.categories, loading: false, isSyncing: false }
    }
    return { products: [], categories: [], loading: true, isSyncing: false }
  })

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!resolvedBid || !enabled) return

    // Immediately hydrate from L1 or L2 if available
    const l1 = l1Store.get(resolvedBid) || readL2Cache(resolvedBid)
    if (l1) {
      l1Store.set(resolvedBid, l1)
      setState((prev) => ({
        ...prev,
        products: l1.products,
        categories: l1.categories,
        loading: false
      }))
    }

    const handleStoreChange = (changedBid: string) => {
      if (!mountedRef.current) return
      if (!changedBid || changedBid === resolvedBid) {
        const latest = l1Store.get(resolvedBid)
        if (latest) {
          setState((prev) => ({
            ...prev,
            products: latest.products,
            categories: latest.categories,
            loading: false
          }))
        }
      }
    }

    listeners.add(handleStoreChange)

    // Check if stale or empty
    const isStale = !l1 || Date.now() - l1.ts >= L1_STALE_MS
    if (isStale) {
      if (!l1) {
        setState((prev) => ({ ...prev, loading: true }))
      } else {
        setState((prev) => ({ ...prev, isSyncing: true }))
      }

      fetchPosCatalog(supabaseClient, resolvedBid).then((fresh) => {
        if (mountedRef.current) {
          setState({
            products: fresh.products,
            categories: fresh.categories,
            loading: false,
            isSyncing: false
          })
        }
      })
    }

    return () => {
      listeners.delete(handleStoreChange)
    }
  }, [resolvedBid, enabled, supabaseClient])

  const refresh = useCallback(async () => {
    if (!resolvedBid) return { products: [], categories: [] }
    setState((prev) => ({ ...prev, isSyncing: true }))
    try {
      const fresh = await fetchPosCatalog(supabaseClient, resolvedBid, { forceRefresh: true })
      if (mountedRef.current) {
        setState({
          products: fresh.products,
          categories: fresh.categories,
          loading: false,
          isSyncing: false
        })
      }
      return fresh
    } finally {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, isSyncing: false, loading: false }))
      }
    }
  }, [resolvedBid, supabaseClient])

  const updateLocalStock = useCallback(
    (soldItems: { productId: string; variantId?: string; quantity: number }[]) => {
      applyLocalStockDecrement(resolvedBid, soldItems)
    },
    [resolvedBid]
  )

  return {
    products: Array.isArray(state.products) ? state.products : [],
    categories: Array.isArray(state.categories) ? state.categories : [],
    loading: state.loading,
    isSyncing: state.isSyncing,
    refresh,
    updateLocalStock
  }
}
