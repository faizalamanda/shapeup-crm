/**
 * ─── Unified API Context Module ────────────────────────────────────────────
 * 
 * Modul reusable untuk mendapatkan auth user + active business ID dalam satu call.
 * Digunakan di semua API route (POS, Invoice, Purchases, Expenses, dll).
 * 
 * Fitur:
 * - JWT fast-path (tanpa network call ke Supabase Auth jika token masih valid)
 * - In-memory cache profile (TTL 30 detik)
 * - Deduplication in-flight auth calls
 * - Singleton admin client
 * 
 * USAGE:
 *   import { getApiContext } from '@/lib/apiContext'
 * 
 *   export async function POST(req: Request) {
 *     const ctx = await getApiContext()
 *     if (ctx.error) return ctx.error  // NextResponse 401/400
 *     const { user, businessId, supabase } = ctx
 *     // ... business logic
 *   }
 */

import { createClient, getAuthUser, getAdminSupabase } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────

export interface ApiContext {
  user: any
  businessId: string
  supabase: SupabaseClient
  supabaseAdmin: SupabaseClient
  error?: never
}

export interface ApiContextError {
  user?: never
  businessId?: never
  supabase?: never
  supabaseAdmin?: never
  error: NextResponse
}

export type ApiContextResult = ApiContext | ApiContextError

// ─── Profile Cache ────────────────────────────────────────────────────────

interface ProfileCacheEntry {
  activeBusinessId: string
  expiresAt: number
}

const profileCache = new Map<string, ProfileCacheEntry>()
const PROFILE_CACHE_TTL = 30_000 // 30 seconds

// In-memory permission cache for requested business IDs (0ms fast-path, TTL 60 seconds)
const userBizAccessCache = new Map<string, { authorized: boolean; expiresAt: number }>()
const ACCESS_CACHE_TTL = 60_000 // 60 seconds

// ─── Singleton Admin Client ───────────────────────────────────────────────

let _adminClient: SupabaseClient | null = null

function getAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = getAdminSupabase()
  }
  return _adminClient
}

// ─── Main Entry Point ─────────────────────────────────────────────────────

/**
 * Resolves authenticated user + active business ID in one call.
 * Returns a discriminated union — check `ctx.error` to determine success/failure.
 * 
 * @param options.requireBusiness - If false, skips business ID lookup (default: true)
 * @param options.existingSupabase - Reuse an existing Supabase client
 * @param options.req - Incoming Request object to inspect requested business_id / x-business-id
 * @param options.requestedBusinessId - Explicit requested business ID override
 */
export async function getApiContext(options?: {
  requireBusiness?: boolean
  existingSupabase?: SupabaseClient
  req?: Request
  requestedBusinessId?: string
}): Promise<ApiContextResult> {
  const requireBusiness = options?.requireBusiness !== false
  const supabase = options?.existingSupabase ?? await createClient()

  // 1. Auth — uses JWT fast-path, no network call if token is valid
  const { user, error: authErr } = await getAuthUser(supabase)
  if (authErr || !user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // 2. Business ID — cached for 30 seconds
  if (!requireBusiness) {
    return {
      user,
      businessId: '',
      supabase,
      supabaseAdmin: getAdmin()
    }
  }

  // 2a. Check explicit requested business ID from param, query string, or header
  let reqBizId: string | null = null
  if (options?.requestedBusinessId && typeof options.requestedBusinessId === 'string') {
    reqBizId = options.requestedBusinessId.trim()
  } else if (options?.req) {
    try {
      const url = new URL(options.req.url)
      const qBiz = url.searchParams.get('business_id')
      const hBiz = options.req.headers.get('x-business-id')
      reqBizId = qBiz || hBiz || null
    } catch {}
  }

  const now = Date.now()
  const cached = profileCache.get(user.id)

  // 0ms Fast-Path: If requested business matches currently cached active business, return instantly (0ms)
  if (cached && cached.expiresAt > now) {
    if (!reqBizId || cached.activeBusinessId === reqBizId) {
      return {
        user,
        businessId: cached.activeBusinessId,
        supabase,
        supabaseAdmin: getAdmin()
      }
    }
  }

  // 0ms Fast-Path for explicit reqBizId from userBizAccessCache
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (reqBizId && UUID_REGEX.test(reqBizId)) {
    const accessKey = `${user.id}:${reqBizId}`
    const accessEntry = userBizAccessCache.get(accessKey)
    if (accessEntry && accessEntry.expiresAt > now) {
      if (!accessEntry.authorized) {
        return {
          error: NextResponse.json({ error: 'Akses ke unit bisnis ini ditolak' }, { status: 403 })
        }
      }
      return {
        user,
        businessId: reqBizId,
        supabase,
        supabaseAdmin: getAdmin()
      }
    }

    const admin = getAdmin()
    const [{ data: owned }, { data: staff }] = await Promise.all([
      admin.from('businesses').select('id').eq('id', reqBizId).eq('owner_id', user.id).maybeSingle(),
      admin.from('business_staff').select('business_id').eq('business_id', reqBizId).eq('profile_id', user.id).maybeSingle()
    ])

    const isAuthorized = Boolean(owned?.id || staff?.business_id)
    userBizAccessCache.set(accessKey, { authorized: isAuthorized, expiresAt: now + ACCESS_CACHE_TTL })

    if (isAuthorized) {
      return {
        user,
        businessId: reqBizId,
        supabase,
        supabaseAdmin: admin
      }
    } else {
      return {
        error: NextResponse.json({ error: 'Akses ke unit bisnis ini ditolak' }, { status: 403 })
      }
    }
  }

  // If no explicit business requested and profileCache hit
  if (cached && cached.expiresAt > now) {
    return {
      user,
      businessId: cached.activeBusinessId,
      supabase,
      supabaseAdmin: getAdmin()
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_business_id')
    .eq('id', user.id)
    .single()

  let activeBusinessId = profile?.active_business_id || ''

  if (!activeBusinessId) {
    // Fallback/Auto-heal for new users or missing active_business_id
    const admin = getAdmin()
    const { data: owned } = await admin
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)

    if (owned && owned.length > 0) {
      activeBusinessId = owned[0].id
    } else {
      const { data: staff } = await admin
        .from('business_staff')
        .select('business_id')
        .eq('profile_id', user.id)
        .limit(1)

      if (staff && staff.length > 0) {
        activeBusinessId = staff[0].business_id
      }
    }

    if (activeBusinessId) {
      await admin
        .from('profiles')
        .upsert({ id: user.id, active_business_id: activeBusinessId }, { onConflict: 'id' })
    }
  }

  if (!activeBusinessId) {
    return {
      error: NextResponse.json(
        { error: 'Active business not found for user profile' },
        { status: 400 }
      )
    }
  }

  // Cache the result
  profileCache.set(user.id, {
    activeBusinessId,
    expiresAt: now + PROFILE_CACHE_TTL
  })

  // Periodic cleanup
  if (profileCache.size > 100) {
    for (const [k, v] of profileCache.entries()) {
      if (v.expiresAt <= now) profileCache.delete(k)
    }
  }

  return {
    user,
    businessId: activeBusinessId,
    supabase,
    supabaseAdmin: getAdmin()
  }
}

/**
 * Invalidate profile and business access cache for a specific user (e.g., when switching business).
 */
export function invalidateProfileCache(userId: string) {
  profileCache.delete(userId)
  for (const k of userBizAccessCache.keys()) {
    if (k.startsWith(`${userId}:`)) {
      userBizAccessCache.delete(k)
    }
  }
}
