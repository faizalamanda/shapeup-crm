import { supabase } from '@/lib/supabase'

export type Account = {
  id: string
  code: string
  name: string
  type: string
}

// In-memory cache for ultra-fast synchronous lookup
const accountsMemoryCache = new Map<string, { data: Account[]; timestamp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes fresh TTL

function getCacheKey(businessId: string): string {
  return `cache_accounts_${businessId}`
}

/**
 * Reads accounts from local cache synchronously (0ms)
 */
export function getCachedAccounts(businessId: string): Account[] | null {
  if (!businessId) return null

  // 1. Check in-memory cache first
  const mem = accountsMemoryCache.get(businessId)
  if (mem && mem.data) {
    return mem.data
  }

  // 2. Fallback to localStorage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = localStorage.getItem(getCacheKey(businessId))
      if (saved) {
        const parsed = JSON.parse(saved) as Account[]
        if (Array.isArray(parsed)) {
          accountsMemoryCache.set(businessId, { data: parsed, timestamp: Date.now() })
          return parsed
        }
      }
    } catch (e) {
      console.error('[accountService] Error reading localStorage cache:', e)
    }
  }

  return null
}

/**
 * Fetches fresh accounts from DB and updates both memory and localStorage cache
 */
export async function fetchAccountsFromDB(businessId: string): Promise<Account[]> {
  if (!businessId) return []

  const { data, error } = await supabase
    .from('accounts')
    .select('id, code, name, type')
    .eq('business_id', businessId)
    .order('code', { ascending: true })

  if (error) {
    console.error('[accountService] Error fetching accounts:', error.message)
    throw error
  }

  const accounts = (data || []) as Account[]

  // Update memory cache
  accountsMemoryCache.set(businessId, { data: accounts, timestamp: Date.now() })

  // Update localStorage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(getCacheKey(businessId), JSON.stringify(accounts))
    } catch (e) {
      console.error('[accountService] Error setting localStorage cache:', e)
    }
  }

  return accounts
}

/**
 * SWR-style fetcher: Returns cached data immediately if available,
 * and handles background revalidation.
 */
export async function getAccounts(businessId: string): Promise<{ data: Account[]; isStale: boolean }> {
  const cached = getCachedAccounts(businessId)
  
  if (cached) {
    // Trigger background fetch to revalidate silently
    fetchAccountsFromDB(businessId).catch(err => {
      console.warn('[accountService] Background revalidation failed:', err)
    })
    return { data: cached, isStale: true }
  }

  // If no cache, fetch synchronously
  const fresh = await fetchAccountsFromDB(businessId)
  return { data: fresh, isStale: false }
}

/**
 * Invalidates cache for a specific business (e.g., when new accounts are created)
 */
export function invalidateAccountsCache(businessId: string): void {
  if (!businessId) return
  accountsMemoryCache.delete(businessId)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.removeItem(getCacheKey(businessId))
    } catch (e) {}
  }
}
