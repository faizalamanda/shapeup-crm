import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseJwtUserFromCookies, isInvalidTokenError } from './auth'

/**
 * Custom fetch wrapper with 6s timeout protection to prevent hanging HTTP requests
 * when Supabase Auth or API server is slow/degraded (e.g. 504 Gateway Timeout).
 */
function fetchWithTimeout(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 6000)

  if (options?.signal) {
    options.signal.addEventListener('abort', () => controller.abort())
  }

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId))
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: fetchWithTimeout,
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method can be called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}

interface ServerCachedUserEntry {
  user: any | null
  error: any | null
  expiresAt: number
}

// In-memory cache & in-flight promise map for server-side API routes
const serverUserCache = new Map<string, ServerCachedUserEntry>()
const inFlightServerAuthPromises = new Map<string, Promise<{ user: any | null; error: any | null }>>()

function getCookieTokenKey(cookiesList: Array<{ name: string; value: string }>): string {
  const authCookies = cookiesList
    .filter(c => (c.name.startsWith('sb-') || c.name.includes('auth-token') || c.name.includes('supabase')) && Boolean(c.value))
    .map(c => `${c.name}=${c.value}`)
    .sort()
    .join(';')
  return authCookies || 'anonymous'
}

/**
 * Fast & safe helper to retrieve the authenticated user in Server Components / API Routes.
 * Checks unexpired JWT from cookies offline before calling network endpoints.
 * Deduplicates parallel API route calls to prevent network storms to Supabase Auth.
 */
export async function getAuthUser(supabaseClient?: SupabaseClient) {
  const cookieStore = await cookies()
  const cookiesList = cookieStore.getAll()

  // 1. Fast path: check unexpired JWT in cookie
  const { user: jwtUser, isExpired } = parseJwtUserFromCookies(cookiesList)
  if (jwtUser && !isExpired) {
    return { user: jwtUser, error: null }
  }

  const tokenKey = getCookieTokenKey(cookiesList)
  const now = Date.now()

  // 2. Check in-memory TTL cache (10 seconds)
  const cached = serverUserCache.get(tokenKey)
  if (cached && cached.expiresAt > now) {
    return { user: cached.user, error: cached.error }
  }

  // 3. Check in-flight promise deduplication (Single-Flight Pattern)
  if (inFlightServerAuthPromises.has(tokenKey)) {
    return await inFlightServerAuthPromises.get(tokenKey)!
  }

  // Periodic cleanup if cache grows
  if (serverUserCache.size > 200) {
    for (const [k, v] of serverUserCache.entries()) {
      if (v.expiresAt <= now) serverUserCache.delete(k)
    }
  }

  // 4. Fallback single network request to Supabase Auth with strict 3.5s timeout
  const authPromise = (async () => {
    try {
      const client = supabaseClient || (await createClient())
      const getUserPromise = client.auth.getUser()
      const timeoutPromise = new Promise<{ data: { user: null }; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: { user: null }, error: new Error('Auth timeout') }), 3500)
      )

      const { data, error } = await Promise.race([getUserPromise, timeoutPromise])
      let user = data?.user ?? null
      const isRevokedOrInvalid = isInvalidTokenError(error)

      // Fallback to jwtUser ONLY IF the error is NOT a revoked/invalid token error.
      if (!user && jwtUser && error && !isRevokedOrInvalid) {
        user = jwtUser as any
      }

      if (isRevokedOrInvalid) {
        user = null
      }

      const result = { user, error: user ? null : (error ?? null) }

      if (user) {
        serverUserCache.set(tokenKey, {
          user,
          error: null,
          expiresAt: Date.now() + 10000,
        })
      }

      return result
    } catch (err) {
      if (jwtUser && !isInvalidTokenError(err)) {
        return { user: jwtUser as any, error: null }
      }
      return { user: null, error: err }
    } finally {
      inFlightServerAuthPromises.delete(tokenKey)
    }
  })()

  inFlightServerAuthPromises.set(tokenKey, authPromise)
  return await authPromise
}

