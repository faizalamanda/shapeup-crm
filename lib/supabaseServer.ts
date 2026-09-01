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

/**
 * Fast & safe helper to retrieve the authenticated user in Server Components / API Routes.
 * Checks unexpired JWT from cookies offline before calling network endpoints.
 */
export async function getAuthUser(supabaseClient?: SupabaseClient) {
  const cookieStore = await cookies()
  const cookiesList = cookieStore.getAll()

  // 1. Fast path: check unexpired JWT in cookie
  const { user: jwtUser, isExpired } = parseJwtUserFromCookies(cookiesList)
  if (jwtUser && !isExpired) {
    return { user: jwtUser, error: null }
  }

  // 2. If expired or no JWT, fallback to supabase.auth.getUser()
  const client = supabaseClient || (await createClient())

  try {
    const getUserPromise = client.auth.getUser()
    const timeoutPromise = new Promise<{ data: { user: null }; error: any }>((resolve) =>
      setTimeout(() => resolve({ data: { user: null }, error: new Error('Auth timeout') }), 4000)
    )

    const { data, error } = await Promise.race([getUserPromise, timeoutPromise])
    if (data?.user) {
      return { user: data.user, error: null }
    }

    if (jwtUser && !isInvalidTokenError(error)) {
      return { user: jwtUser as any, error: null }
    }

    return { user: null, error: error ?? null }
  } catch (err) {
    if (jwtUser && !isInvalidTokenError(err)) {
      return { user: jwtUser as any, error: null }
    }
    return { user: null, error: err }
  }
}
