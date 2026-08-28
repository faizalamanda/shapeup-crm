export type Supplier = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
}

const suppliersMemoryCache = new Map<string, { data: Supplier[]; timestamp: number }>()

function getCacheKey(businessId: string): string {
  return `cache_suppliers_${businessId}`
}

/**
 * Reads suppliers from local cache synchronously (0ms)
 */
export function getCachedSuppliers(businessId: string): Supplier[] | null {
  if (!businessId) return null

  // 1. Check in-memory cache
  const mem = suppliersMemoryCache.get(businessId)
  if (mem && mem.data) {
    return mem.data
  }

  // 2. Fallback to localStorage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = localStorage.getItem(getCacheKey(businessId))
      if (saved) {
        const parsed = JSON.parse(saved) as Supplier[]
        if (Array.isArray(parsed)) {
          suppliersMemoryCache.set(businessId, { data: parsed, timestamp: Date.now() })
          return parsed
        }
      }
    } catch (e) {
      console.error('[supplierService] Error reading localStorage cache:', e)
    }
  }

  return null
}

/**
 * Fetches fresh suppliers from API and updates both memory and localStorage cache
 */
export async function fetchSuppliersFromAPI(businessId: string): Promise<Supplier[]> {
  if (!businessId) return []

  const res = await fetch('/api/suppliers')
  if (!res.ok) {
    throw new Error('Failed to fetch suppliers')
  }

  const suppliers = (await res.json()) as Supplier[]

  // Update memory cache
  suppliersMemoryCache.set(businessId, { data: suppliers, timestamp: Date.now() })

  // Update localStorage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(getCacheKey(businessId), JSON.stringify(suppliers))
    } catch (e) {
      console.error('[supplierService] Error setting localStorage cache:', e)
    }
  }

  return suppliers
}

/**
 * SWR-style fetcher: Returns cached data immediately if available,
 * and handles background revalidation.
 */
export async function getSuppliers(businessId: string): Promise<{ data: Supplier[]; isStale: boolean }> {
  const cached = getCachedSuppliers(businessId)
  
  if (cached) {
    // Trigger background fetch to revalidate silently
    fetchSuppliersFromAPI(businessId).catch(err => {
      console.warn('[supplierService] Background revalidation failed:', err)
    })
    return { data: cached, isStale: true }
  }

  // If no cache, fetch synchronously
  const fresh = await fetchSuppliersFromAPI(businessId)
  return { data: fresh, isStale: false }
}

/**
 * Invalidates cache for a specific business (e.g., when a new supplier is created)
 */
export function invalidateSuppliersCache(businessId: string): void {
  if (!businessId) return
  suppliersMemoryCache.delete(businessId)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.removeItem(getCacheKey(businessId))
    } catch (e) {}
  }
}
