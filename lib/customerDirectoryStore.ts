"use client"

/**
 * ─── Client-Side Reactive Customer Directory Store ─────────────────────────
 *
 * Arsitektur State Pelanggan Terpusat (Write Once, Use Everywhere, Update Propagates Globally):
 * 1. L1 Cache (In-Memory Map per businessId): Akses 0ms saat navigasi antar halaman
 *    (Invoice <-> POS <-> Order Manual <-> Customers).
 * 2. L2 Cache (sessionStorage `su_cust_dir_v1_${businessId}`): Akses 0ms saat reload,
 *    dengan Stale-While-Revalidate (SWR) background sync.
 * 3. Cross-Component & Cross-Tab Reactivity (Observer + BroadcastChannel):
 *    Memanggil `notifyCustomerDirectoryUpdate()` dari halaman manapun akan langsung
 *    memperbarui seluruh dropdown/tabel pelanggan yang terbuka tanpa perlu reload.
 * 4. Symmetric Phone Matching (08 <-> 628): Memastikan pencarian nomor HP dengan
 *    awalan 08..., +628..., atau 628... selalu menemukan pelanggan secara akurat.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useUserContext } from '@/components/UserContext'
import {
  type CustomerDirectoryItem,
  normalizePhoneCanonical,
  buildPhoneSearchVariants,
  matchesCustomerQuery
} from '@/lib/customerHelper'
import { isUuid } from '@/lib/utils'

export {
  type CustomerDirectoryItem,
  normalizePhoneCanonical,
  buildPhoneSearchVariants,
  matchesCustomerQuery
}

// ─── Constants & Storage Keys ───────────────────────────────────────────────

const L1_STALE_MS = 60_000        // Background recheck after 60s
const L2_TTL_MS = 5 * 60_000      // sessionStorage valid for 5 minutes
const BROADCAST_CHANNEL_NAME = 'shapeup_customer_sync_v1'
const CUSTOM_EVENT_NAME = 'shapeup:customer_updated'

function getL2Key(businessId: string): string {
  return `su_cust_dir_v1_${businessId}`
}

function getAnalyticsCacheKey(businessId: string): string {
  return `su_customers_v2_${businessId}`
}

// ─── L1 In-Memory Store & Observer Registry ─────────────────────────────────

interface L1Entry {
  customers: CustomerDirectoryItem[]
  ts: number
}

const l1Store = new Map<string, L1Entry>()
const inFlightClientFetches = new Map<string, Promise<CustomerDirectoryItem[]>>()
const listeners = new Set<(businessId: string) => void>()

function emitChange(businessId: string) {
  for (const listener of listeners) {
    try {
      listener(businessId)
    } catch (e) {
      console.error('[CustomerDirectoryStore] Listener error:', e)
    }
  }
}

// ─── L2 SessionStorage Helpers ──────────────────────────────────────────────

function readL2Cache(businessId: string): L1Entry | null {
  if (typeof window === 'undefined' || !businessId) return null
  try {
    const raw = sessionStorage.getItem(getL2Key(businessId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as L1Entry
    if (!parsed || !Array.isArray(parsed.customers)) return null
    if (Date.now() - parsed.ts > L2_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeL2Cache(businessId: string, customers: CustomerDirectoryItem[], ts = Date.now()) {
  if (typeof window === 'undefined' || !businessId) return
  try {
    // For high-cardinality datasets (> 500 rows), strip heavy CRM metadata in L2 sessionStorage
    // while keeping full objects in L1 RAM to guarantee 5MB sessionStorage quota safety
    const slimCustomers = customers.length > 500
      ? customers.map(({ metadata, ...rest }) => rest)
      : customers

    sessionStorage.setItem(
      getL2Key(businessId),
      JSON.stringify({ customers: slimCustomers, ts })
    )
  } catch {
    // Fallback: if sessionStorage quota is still exceeded, store ultra-compact index
    try {
      const compact = customers.slice(0, 3000).map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address_data: c.address_data
      }))
      sessionStorage.setItem(
        getL2Key(businessId),
        JSON.stringify({ customers: compact, ts })
      )
    } catch {
      // Ignore storage quota errors
    }
  }
}

function clearAnalyticsCache(businessId?: string) {
  if (typeof window === 'undefined') return
  try {
    if (businessId) {
      sessionStorage.removeItem(getAnalyticsCacheKey(businessId))
    } else {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i)
        if (k && (k.startsWith('su_customers_v2_') || k.startsWith('su_cust_dir_v1_'))) {
          sessionStorage.removeItem(k)
        }
      }
    }
  } catch {}
}

// ─── Normalize & Sort Helper ────────────────────────────────────────────────

function normalizeCustomerObject(raw: any): CustomerDirectoryItem {
  return {
    id: String(raw.id || raw.customer_id || ''),
    business_id: raw.business_id,
    name: raw.name ? String(raw.name).trim() : 'Tanpa Nama',
    phone: raw.phone ? String(raw.phone).trim() : '',
    email: raw.email ? String(raw.email).trim() : null,
    category: raw.category || 'General',
    address_data: raw.address_data ?? null,
    metadata: raw.metadata ?? null,
    loyalty_points: raw.loyalty_points !== undefined ? Number(raw.loyalty_points || 0) : undefined,
    loyalty_tier: raw.loyalty_tier || undefined,
  }
}

function sortCustomersByName(list: CustomerDirectoryItem[]): CustomerDirectoryItem[] {
  return [...list].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' })
  )
}

// ─── Internal Upsert / Delete / Invalidate on Store ─────────────────────────

function applyLocalMutation(
  businessId: string,
  action: 'upsert' | 'delete' | 'invalidate',
  customer?: any
) {
  clearAnalyticsCache(businessId)

  if (action === 'invalidate') {
    if (businessId) {
      l1Store.delete(businessId)
      if (typeof window !== 'undefined') {
        try { sessionStorage.removeItem(getL2Key(businessId)) } catch {}
      }
      emitChange(businessId)
    } else {
      const keys = Array.from(l1Store.keys())
      l1Store.clear()
      keys.forEach(k => emitChange(k))
    }
    return
  }

  const targetBizIds = businessId
    ? [businessId]
    : Array.from(l1Store.keys())

  for (const bid of targetBizIds) {
    const currentEntry = l1Store.get(bid) || readL2Cache(bid)
    if (!currentEntry) {
      emitChange(bid)
      continue
    }

    const cleanCust = customer ? normalizeCustomerObject(customer) : null
    if (!cleanCust?.id) {
      emitChange(bid)
      continue
    }

    let nextList = [...currentEntry.customers]
    if (action === 'delete') {
      nextList = nextList.filter(c => c.id !== cleanCust.id)
    } else {
      const idx = nextList.findIndex(c => c.id === cleanCust.id)
      if (idx >= 0) {
        nextList[idx] = { ...nextList[idx], ...cleanCust }
      } else {
        nextList.push(cleanCust)
      }
      nextList = sortCustomersByName(nextList)
    }

    const now = Date.now()
    l1Store.set(bid, { customers: nextList, ts: now })
    writeL2Cache(bid, nextList, now)
    emitChange(bid)
  }
}

// ─── Global Broadcast Channel Setup ─────────────────────────────────────────

let broadcastChannel: BroadcastChannel | null = null

if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    broadcastChannel.onmessage = (event) => {
      const data = event.data
      if (data && data.type === 'CUSTOMER_MUTATION') {
        applyLocalMutation(data.businessId || '', data.action || 'invalidate', data.customer)
      }
    }
  } catch {}
}

/**
 * Panggil fungsi ini setiap kali ada penambahan, pengeditan, penghapusan,
 * atau impor pelanggan di komponen manapun agar seluruh halaman (Invoice, POS,
 * Halaman Customer, Order Manual) langsung terupdate seketika (0ms).
 */
export function notifyCustomerDirectoryUpdate(
  customer?: any,
  action: 'upsert' | 'delete' | 'invalidate' = 'upsert',
  explicitBusinessId?: string
): void {
  const bid = explicitBusinessId || customer?.business_id || ''
  applyLocalMutation(bid, action, customer)

  if (typeof window !== 'undefined') {
    try {
      broadcastChannel?.postMessage({
        type: 'CUSTOMER_MUTATION',
        businessId: bid,
        action,
        customer
      })
    } catch {}

    try {
      window.dispatchEvent(
        new CustomEvent(CUSTOM_EVENT_NAME, {
          detail: { businessId: bid, action, customer }
        })
      )
    } catch {}
  }
}

// ─── Core Fetcher from /api/customers ───────────────────────────────────────

export async function fetchCustomerDirectoryForBusiness(
  businessId: string,
  options?: {
    forceRefresh?: boolean
    includeCustomerId?: string | null
  }
): Promise<CustomerDirectoryItem[]> {
  if (!businessId) return []

  const force = Boolean(options?.forceRefresh)
  const includeId = isUuid(options?.includeCustomerId) ? options!.includeCustomerId!.trim() : null

  if (!force) {
    const l1 = l1Store.get(businessId)
    if (l1 && Date.now() - l1.ts < L1_STALE_MS) {
      if (!includeId || l1.customers.some(c => c.id === includeId)) {
        return l1.customers
      }
    }
  }

  const existingPromise = inFlightClientFetches.get(businessId)
  if (existingPromise && !force && !includeId) {
    return existingPromise
  }

  const fetchTask = (async () => {
    try {
      const params = new URLSearchParams()
      params.set('business_id', businessId)
      if (force) params.set('refresh', '1')
      if (includeId) params.set('include_id', includeId)

      const res = await fetch(`/api/customers?${params.toString()}`)
      const json = await res.json().catch(() => null)

      if (res.ok && json?.success && Array.isArray(json.customers)) {
        const list = (json.customers as any[]).map(normalizeCustomerObject)
        const now = Date.now()
        l1Store.set(businessId, { customers: list, ts: now })
        writeL2Cache(businessId, list, now)
        emitChange(businessId)
        return list
      }
      return l1Store.get(businessId)?.customers || []
    } catch (err) {
      console.error('[CustomerDirectoryStore] Fetch error:', err)
      return l1Store.get(businessId)?.customers || []
    } finally {
      inFlightClientFetches.delete(businessId)
    }
  })()

  if (!includeId) {
    inFlightClientFetches.set(businessId, fetchTask)
  }
  return fetchTask
}

// ─── React Hook: useCustomerDirectory ───────────────────────────────────────

export interface UseCustomerDirectoryOptions {
  businessId?: string | null
  includeCustomerId?: string | null
  enabled?: boolean
}

export function useCustomerDirectory(options?: UseCustomerDirectoryOptions) {
  const { activeBusiness } = useUserContext()
  const resolvedBusinessId = (options?.businessId || activeBusiness?.id || '').trim()
  const includeCustomerId = isUuid(options?.includeCustomerId)
    ? options!.includeCustomerId!.trim()
    : null
  const enabled = options?.enabled !== false

  const [customers, setCustomers] = useState<CustomerDirectoryItem[]>(() => {
    if (!resolvedBusinessId) return []
    const l1 = l1Store.get(resolvedBusinessId)
    if (l1) return l1.customers
    const l2 = readL2Cache(resolvedBusinessId)
    if (l2) {
      l1Store.set(resolvedBusinessId, l2)
      return l2.customers
    }
    return []
  })

  const [loading, setLoading] = useState<boolean>(() => {
    if (!resolvedBusinessId) return true
    return !l1Store.has(resolvedBusinessId) && !readL2Cache(resolvedBusinessId)
  })
  const [isSyncing, setIsSyncing] = useState<boolean>(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Subscribe to store updates for resolvedBusinessId
  useEffect(() => {
    if (!resolvedBusinessId || !enabled) return

    // Hydrate immediately from L1 or L2
    const l1 = l1Store.get(resolvedBusinessId) || readL2Cache(resolvedBusinessId)
    if (l1) {
      l1Store.set(resolvedBusinessId, l1)
      setCustomers(l1.customers)
      setLoading(false)
    }

    const handleStoreChange = (changedBid: string) => {
      if (!mountedRef.current) return
      if (!changedBid || changedBid === resolvedBusinessId) {
        const latest = l1Store.get(resolvedBusinessId)
        if (latest) {
          setCustomers(latest.customers)
          setLoading(false)
        } else {
          // Invalidated -> trigger background refresh
          setIsSyncing(true)
          fetchCustomerDirectoryForBusiness(resolvedBusinessId, {
            forceRefresh: true,
            includeCustomerId
          }).finally(() => {
            if (mountedRef.current) {
              setIsSyncing(false)
              setLoading(false)
            }
          })
        }
      }
    }

    listeners.add(handleStoreChange)

    // Initial or SWR fetch
    const isStale = !l1 || Date.now() - l1.ts >= L1_STALE_MS
    const missingIncluded = Boolean(
      includeCustomerId && (!l1 || !l1.customers.some(c => c.id === includeCustomerId))
    )

    if (isStale || missingIncluded) {
      if (!l1) setLoading(true)
      else setIsSyncing(true)

      fetchCustomerDirectoryForBusiness(resolvedBusinessId, {
        forceRefresh: missingIncluded,
        includeCustomerId
      }).then((fresh) => {
        if (mountedRef.current) {
          setCustomers(fresh)
          setLoading(false)
          setIsSyncing(false)
        }
      })
    }

    return () => {
      listeners.delete(handleStoreChange)
    }
  }, [resolvedBusinessId, includeCustomerId, enabled])

  const refresh = useCallback(async () => {
    if (!resolvedBusinessId) return []
    setIsSyncing(true)
    try {
      const fresh = await fetchCustomerDirectoryForBusiness(resolvedBusinessId, {
        forceRefresh: true,
        includeCustomerId
      })
      if (mountedRef.current) {
        setCustomers(fresh)
      }
      return fresh
    } finally {
      if (mountedRef.current) {
        setIsSyncing(false)
        setLoading(false)
      }
    }
  }, [resolvedBusinessId, includeCustomerId])

  const upsertCustomer = useCallback(
    (customer: any) => {
      notifyCustomerDirectoryUpdate(customer, 'upsert', resolvedBusinessId)
    },
    [resolvedBusinessId]
  )

  const removeCustomer = useCallback(
    (customerId: string) => {
      notifyCustomerDirectoryUpdate({ id: customerId }, 'delete', resolvedBusinessId)
    },
    [resolvedBusinessId]
  )

  const searchServer = useCallback(
    async (query: string): Promise<CustomerDirectoryItem[]> => {
      if (!resolvedBusinessId || !query.trim()) return []
      try {
        const params = new URLSearchParams({
          business_id: resolvedBusinessId,
          search: query.trim(),
          limit: '50'
        })
        const res = await fetch(`/api/customers?${params.toString()}`)
        const json = await res.json().catch(() => null)
        if (res.ok && json?.success && Array.isArray(json.customers)) {
          const found = (json.customers as any[]).map(normalizeCustomerObject)
          // Merge any newly discovered customers into L1/L2
          const current = l1Store.get(resolvedBusinessId)?.customers || []
          const currentIds = new Set(current.map(c => c.id))
          let added = false
          const merged = [...current]
          for (const item of found) {
            if (item.id && !currentIds.has(item.id)) {
              merged.push(item)
              currentIds.add(item.id)
              added = true
            }
          }
          if (added) {
            const sorted = sortCustomersByName(merged)
            const now = Date.now()
            l1Store.set(resolvedBusinessId, { customers: sorted, ts: now })
            writeL2Cache(resolvedBusinessId, sorted, now)
            emitChange(resolvedBusinessId)
          }
          return found
        }
      } catch (err) {
        console.error('[useCustomerDirectory] searchServer error:', err)
      }
      return []
    },
    [resolvedBusinessId]
  )

  return {
    customers,
    businessId: resolvedBusinessId,
    loading,
    isSyncing,
    refresh,
    upsertCustomer,
    removeCustomer,
    searchServer
  }
}

