import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

/**
 * Retrieve the authenticated Supabase user, caching the result in request.locals.
 * Subsequent calls within the same middleware execution will reuse the cached user.
 * Includes a timeout to avoid long middleware execution.
 */
export async function getCachedUser(
  request: NextRequest,
  supabase: SupabaseClient
): Promise<{ user: any | null; error: any | null }> {
  // @ts-ignore - we augment the request object with a custom property
  if ((request as any).locals?.authUser !== undefined) {
    // @ts-ignore
    return { user: (request as any).locals.authUser, error: null }
  }

  // Perform getUser with a 4‑second timeout as currently used in middleware
  const getUserWithTimeout = async () => {
    try {
      const authPromise = supabase.auth.getUser()
      const timeoutPromise = new Promise<{ data: { user: null }; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: { user: null }, error: new Error('Auth timeout') }), 4000)
      )
      return await Promise.race([authPromise, timeoutPromise])
    } catch (err) {
      return { data: { user: null }, error: err }
    }
  }

  const { data: { user }, error } = await getUserWithTimeout()
  // @ts-ignore
  if (!(request as any).locals) (request as any).locals = {}
  // @ts-ignore
  ;(request as any).locals.authUser = user ?? null
  return { user, error }
}
