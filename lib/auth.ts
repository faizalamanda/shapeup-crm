import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

interface CachedUserEntry {
  user: any | null
  error: any | null
  expiresAt: number
}

// In-memory cache for validated tokens (TTL = 15 seconds)
const userMemoryCache = new Map<string, CachedUserEntry>()

// In-flight deduplication map for concurrent auth checks with the same token
const inFlightAuthPromises = new Map<string, Promise<{ user: any | null; error: any | null }>>()

function getAuthTokenKey(request: NextRequest): string {
  const authHeader = request.headers.get('authorization')
  if (authHeader) return authHeader

  const allCookies = request.cookies.getAll()
  const authCookies = allCookies
    .filter(c => c.name.startsWith('sb-') || c.name.includes('auth-token') || c.name.includes('supabase'))
    .map(c => `${c.name}=${c.value}`)
    .sort()
    .join(';')

  return authCookies || 'anonymous'
}

/**
 * Retrieve the authenticated Supabase user, deduplicating parallel requests
 * and caching the result in memory (TTL 15s) and request.locals.
 */
export async function getCachedUser(
  request: NextRequest,
  supabase: SupabaseClient
): Promise<{ user: any | null; error: any | null }> {
  // @ts-ignore - check if already resolved in current request context
  if ((request as any).locals?.authUser !== undefined) {
    // @ts-ignore
    return { user: (request as any).locals.authUser, error: null }
  }

  const tokenKey = getAuthTokenKey(request)
  const now = Date.now()

  // 1. Check in-memory TTL cache (15 seconds)
  const cached = userMemoryCache.get(tokenKey)
  if (cached && cached.expiresAt > now) {
    // @ts-ignore
    if (!(request as any).locals) (request as any).locals = {}
    // @ts-ignore
    ;(request as any).locals.authUser = cached.user
    return { user: cached.user, error: cached.error }
  }

  // 2. Check in-flight promise deduplication (Single-Flight Pattern)
  if (inFlightAuthPromises.has(tokenKey)) {
    const result = await inFlightAuthPromises.get(tokenKey)!
    // @ts-ignore
    if (!(request as any).locals) (request as any).locals = {}
    // @ts-ignore
    ;(request as any).locals.authUser = result.user
    return result
  }

  // Periodic cleanup of expired entries if cache gets large
  if (userMemoryCache.size > 200) {
    for (const [k, v] of userMemoryCache.entries()) {
      if (v.expiresAt <= now) userMemoryCache.delete(k)
    }
  }

  // 3. Initiate single network request to Supabase Auth
  const authPromise = (async () => {
    try {
      const getUserPromise = supabase.auth.getUser()
      const timeoutPromise = new Promise<{ data: { user: null }; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: { user: null }, error: new Error('Auth timeout') }), 4000)
      )

      const { data, error } = await Promise.race([getUserPromise, timeoutPromise])
      const user = data?.user ?? null
      const result = { user, error: error ?? null }

      // Cache valid response in memory for 15 seconds
      userMemoryCache.set(tokenKey, {
        user,
        error: result.error,
        expiresAt: Date.now() + 15000,
      })

      return result
    } catch (err) {
      return { user: null, error: err }
    } finally {
      inFlightAuthPromises.delete(tokenKey)
    }
  })()

  inFlightAuthPromises.set(tokenKey, authPromise)

  const finalResult = await authPromise
  // @ts-ignore
  if (!(request as any).locals) (request as any).locals = {}
  // @ts-ignore
  ;(request as any).locals.authUser = finalResult.user
  return finalResult
}

