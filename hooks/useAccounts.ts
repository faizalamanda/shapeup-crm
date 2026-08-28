import { useState, useEffect, useCallback } from 'react'
import {
  Account,
  getCachedAccounts,
  fetchAccountsFromDB,
  invalidateAccountsCache
} from '@/lib/services/accountService'

export type { Account }

export function useAccounts(businessId: string | null | undefined) {
  const [accounts, setAccounts] = useState<Account[]>(() => {
    if (businessId) {
      const cached = getCachedAccounts(businessId)
      if (cached) return cached
    }
    return []
  })

  // Loading is only true if we don't have any cached data available
  const [loading, setLoading] = useState<boolean>(() => {
    if (businessId) {
      const cached = getCachedAccounts(businessId)
      return !cached || cached.length === 0
    }
    return true
  })

  const [isRevalidating, setIsRevalidating] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)

  const loadAccounts = useCallback(async (forceRefresh = false) => {
    if (!businessId) {
      setAccounts([])
      setLoading(false)
      return
    }

    if (forceRefresh) {
      invalidateAccountsCache(businessId)
    }

    const cached = getCachedAccounts(businessId)
    if (cached && cached.length > 0) {
      setAccounts(cached)
      setLoading(false)
      setIsRevalidating(true)
    } else {
      setLoading(true)
    }

    try {
      const fresh = await fetchAccountsFromDB(businessId)
      setAccounts(fresh)
      setError(null)
    } catch (err: any) {
      console.error('[useAccounts] Error loading accounts:', err)
      setError(err)
    } finally {
      setLoading(false)
      setIsRevalidating(false)
    }
  }, [businessId])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const refetch = useCallback(() => {
    return loadAccounts(true)
  }, [loadAccounts])

  return {
    accounts,
    loading,
    isRevalidating,
    error,
    refetch
  }
}
