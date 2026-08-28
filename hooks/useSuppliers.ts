import { useState, useEffect, useCallback } from 'react'
import {
  Supplier,
  getCachedSuppliers,
  fetchSuppliersFromAPI,
  invalidateSuppliersCache
} from '@/lib/services/supplierService'

export type { Supplier }

export function useSuppliers(businessId: string | null | undefined) {
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    if (businessId) {
      const cached = getCachedSuppliers(businessId)
      if (cached) return cached
    }
    return []
  })

  // Loading is only true if we don't have any cached data available
  const [loading, setLoading] = useState<boolean>(() => {
    if (businessId) {
      const cached = getCachedSuppliers(businessId)
      return !cached || cached.length === 0
    }
    return true
  })

  const [isRevalidating, setIsRevalidating] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)

  const loadSuppliers = useCallback(async (forceRefresh = false) => {
    if (!businessId) {
      setSuppliers([])
      setLoading(false)
      return
    }

    if (forceRefresh) {
      invalidateSuppliersCache(businessId)
    }

    const cached = getCachedSuppliers(businessId)
    if (cached && cached.length > 0) {
      setSuppliers(cached)
      setLoading(false)
      setIsRevalidating(true)
    } else {
      setLoading(true)
    }

    try {
      const fresh = await fetchSuppliersFromAPI(businessId)
      setSuppliers(fresh)
      setError(null)
    } catch (err: any) {
      console.error('[useSuppliers] Error loading suppliers:', err)
      setError(err)
    } finally {
      setLoading(false)
      setIsRevalidating(false)
    }
  }, [businessId])

  useEffect(() => {
    loadSuppliers()
  }, [loadSuppliers])

  const refetch = useCallback(() => {
    return loadSuppliers(true)
  }, [loadSuppliers])

  return {
    suppliers,
    setSuppliers,
    loading,
    isRevalidating,
    error,
    refetch
  }
}
