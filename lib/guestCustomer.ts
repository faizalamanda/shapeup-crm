/**
 * ─── Guest Customer Resolution Module ──────────────────────────────────────
 * 
 * Modul reusable untuk resolve "guest" customer ID.
 * Digunakan di POS order dan tempat lain yang butuh guest customer.
 * 
 * Fitur:
 * - In-memory cache per business (TTL 5 menit) → menghilangkan DB call
 * - Auto-create jika belum ada
 * - Thread-safe deduplication (single-flight)
 * 
 * USAGE:
 *   import { resolveGuestCustomerId } from '@/lib/guestCustomer'
 *   const guestId = await resolveGuestCustomerId(businessId, supabaseAdmin)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Cache ────────────────────────────────────────────────────────────────

interface GuestCacheEntry {
  customerId: string
  expiresAt: number
}

const guestCache = new Map<string, GuestCacheEntry>()
const inFlightGuest = new Map<string, Promise<string>>()

const GUEST_CACHE_TTL = 300_000 // 5 minutes

// ─── Main ─────────────────────────────────────────────────────────────────

/**
 * Resolves the guest (walk-in) customer ID for a given business.
 * Creates one if it doesn't exist. Result is cached in-memory.
 */
export async function resolveGuestCustomerId(
  businessId: string,
  supabase: SupabaseClient
): Promise<string> {
  const now = Date.now()

  // 1. Check cache
  const cached = guestCache.get(businessId)
  if (cached && cached.expiresAt > now) {
    return cached.customerId
  }

  // 2. Deduplication — don't fire multiple DB calls
  if (inFlightGuest.has(businessId)) {
    return inFlightGuest.get(businessId)!
  }

  const promise = _resolveGuest(businessId, supabase)
  inFlightGuest.set(businessId, promise)

  try {
    const result = await promise
    guestCache.set(businessId, {
      customerId: result,
      expiresAt: now + GUEST_CACHE_TTL
    })
    return result
  } finally {
    inFlightGuest.delete(businessId)
  }
}

async function _resolveGuest(businessId: string, supabase: SupabaseClient): Promise<string> {
  const { data: guestCust } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .eq('phone', '0')
    .maybeSingle()

  if (guestCust) {
    return guestCust.id
  }

  const { data: newGuest, error: guestErr } = await supabase
    .from('customers')
    .insert({
      business_id: businessId,
      phone: '0',
      name: 'Customer Tamu',
      email: 'guest@business.com'
    })
    .select('id')
    .single()

  if (guestErr) {
    throw new Error('Gagal membuat akun Customer Tamu: ' + guestErr.message)
  }

  return newGuest.id
}

/**
 * Invalidate guest customer cache for a specific business.
 */
export function invalidateGuestCache(businessId: string) {
  guestCache.delete(businessId)
}
