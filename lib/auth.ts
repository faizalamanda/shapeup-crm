import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

export interface ExtractedUser {
  id: string
  email?: string
  role?: string
  user_metadata?: any
  app_metadata?: any
  exp?: number
}

interface CachedUserEntry {
  user: any | null
  error: any | null
  expiresAt: number
}

// In-memory cache for validated tokens (TTL = 15 seconds)
const userMemoryCache = new Map<string, CachedUserEntry>()

// In-flight deduplication map for concurrent auth checks with the same token
const inFlightAuthPromises = new Map<string, Promise<{ user: any | null; error: any | null }>>()

/**
 * Fast-path JWT decoder for cookies. Parses and validates JWT payload expiration offline
 * without hitting Supabase Auth network endpoints when token is unexpired.
 */
export function parseJwtUserFromCookies(cookiesList: Array<{ name: string; value: string }>): { user: ExtractedUser | null; isExpired: boolean } {
  try {
    const authChunks = cookiesList
      .filter(c => (c.name.startsWith('sb-') || c.name.includes('auth-token') || c.name.includes('supabase')) && Boolean(c.value))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (authChunks.length === 0) return { user: null, isExpired: true }

    const rawVal = authChunks.map(c => c.value).join('')
    if (!rawVal) return { user: null, isExpired: true }

    let sessionData: any = null

    if (rawVal.startsWith('{') || rawVal.startsWith('[')) {
      try { sessionData = JSON.parse(rawVal) } catch {}
    }

    if (!sessionData && (rawVal.startsWith('base64-') || !rawVal.startsWith('{'))) {
      const cleanB64 = rawVal.startsWith('base64-') ? rawVal.slice(7) : rawVal
      try {
        const decoded = typeof atob === 'function' ? atob(cleanB64) : Buffer.from(cleanB64, 'base64').toString('utf-8')
        sessionData = JSON.parse(decoded)
      } catch {}
    }

    if (!sessionData) return { user: null, isExpired: true }

    const accessToken = Array.isArray(sessionData) ? sessionData[0] : sessionData?.access_token
    if (!accessToken || typeof accessToken !== 'string') return { user: null, isExpired: true }

    const parts = accessToken.split('.')
    if (parts.length !== 3) return { user: null, isExpired: true }

    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payloadJson = typeof atob === 'function' ? atob(payloadB64) : Buffer.from(payloadB64, 'base64').toString('utf-8')
    const payload = JSON.parse(payloadJson)

    if (!payload || !payload.sub) return { user: null, isExpired: true }

    const nowSec = Math.floor(Date.now() / 1000)
    // Consider token expired if it expires within 10 seconds
    const isExpired = typeof payload.exp === 'number' ? (payload.exp <= nowSec + 10) : true

    const user: ExtractedUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      user_metadata: payload.user_metadata || {},
      app_metadata: payload.app_metadata || {},
      exp: payload.exp
    }

    return { user, isExpired }
  } catch {
    return { user: null, isExpired: true }
  }
}

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
  // Check if already resolved in current request context
  if ((request as any).locals?.authUser !== undefined) {
    return { user: (request as any).locals.authUser, error: null }
  }

  // 1. FAST PATH: Offline JWT validation from request cookies
  const allCookies = request.cookies.getAll()
  const { user: jwtUser, isExpired } = parseJwtUserFromCookies(allCookies)

  if (jwtUser && !isExpired) {
    if (!(request as any).locals) (request as any).locals = {}
    ;(request as any).locals.authUser = jwtUser
    return { user: jwtUser, error: null }
  }

  const tokenKey = getAuthTokenKey(request)
  const now = Date.now()

  // 2. Check in-memory TTL cache (15 seconds)
  const cached = userMemoryCache.get(tokenKey)
  if (cached && cached.expiresAt > now) {
    if (!(request as any).locals) (request as any).locals = {}
    ;(request as any).locals.authUser = cached.user
    return { user: cached.user, error: cached.error }
  }

  // 3. Check in-flight promise deduplication (Single-Flight Pattern)
  if (inFlightAuthPromises.has(tokenKey)) {
    const result = await inFlightAuthPromises.get(tokenKey)!
    if (!(request as any).locals) (request as any).locals = {}
    ;(request as any).locals.authUser = result.user
    return result
  }

  // Periodic cleanup of expired entries if cache gets large
  if (userMemoryCache.size > 200) {
    for (const [k, v] of userMemoryCache.entries()) {
      if (v.expiresAt <= now) userMemoryCache.delete(k)
    }
  }

  // 4. Initiate single network request to Supabase Auth with timeout protection
  const authPromise = (async () => {
    try {
      const getUserPromise = supabase.auth.getUser()
      const timeoutPromise = new Promise<{ data: { user: null }; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: { user: null }, error: new Error('Auth timeout') }), 4000)
      )

      const { data, error } = await Promise.race([getUserPromise, timeoutPromise])
      let user = data?.user ?? null
      
      // If network auth timed out or 504'd, but we have a recently expired JWT user from cookies,
      // fallback to jwtUser so middleware doesn't forcibly log out valid users during network lag.
      if (!user && jwtUser && error) {
        user = jwtUser as any
      }

      const result = { user, error: user ? null : (error ?? null) }

      if (user) {
        userMemoryCache.set(tokenKey, {
          user,
          error: null,
          expiresAt: Date.now() + 15000,
        })
      }

      return result
    } catch (err) {
      if (jwtUser) {
        return { user: jwtUser as any, error: null }
      }
      return { user: null, error: err }
    } finally {
      inFlightAuthPromises.delete(tokenKey)
    }
  })()

  inFlightAuthPromises.set(tokenKey, authPromise)

  const finalResult = await authPromise
  if (!(request as any).locals) (request as any).locals = {}
  ;(request as any).locals.authUser = finalResult.user
  return finalResult
}

