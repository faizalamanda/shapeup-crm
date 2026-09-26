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
 */
export async function getApiContext(options?: {
  requireBusiness?: boolean
  existingSupabase?: SupabaseClient
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

  const now = Date.now()
  const cached = profileCache.get(user.id)
  if (cached && cached.expiresAt > now) {
    return {
      user,
      businessId: cached.activeBusinessId,
      supabase,
      supabaseAdmin: getAdmin()
    }
  }

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('active_business_id')
    .eq('id', user.id)
    .single()

  if (profErr || !profile?.active_business_id) {
    return {
      error: NextResponse.json(
        { error: 'Active business not found for user profile' },
        { status: 400 }
      )
    }
  }

  // Cache the result
  profileCache.set(user.id, {
    activeBusinessId: profile.active_business_id,
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
    businessId: profile.active_business_id,
    supabase,
    supabaseAdmin: getAdmin()
  }
}

/**
 * Invalidate profile cache for a specific user (e.g., when switching business).
 */
export function invalidateProfileCache(userId: string) {
  profileCache.delete(userId)
}
