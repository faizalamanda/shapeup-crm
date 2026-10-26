import type { SupabaseClient } from '@supabase/supabase-js'
import { PriceGuardSettings, DEFAULT_PRICE_GUARD_SETTINGS } from './types'

interface CacheEntry {
  settings: PriceGuardSettings
  expiresAt: number
}

const settingsCache = new Map<string, CacheEntry>()
const CACHE_TTL = 60_000 // 60s

export function invalidatePriceGuardCache(businessId?: string) {
  if (businessId) {
    settingsCache.delete(businessId)
  } else {
    settingsCache.clear()
  }
}

/**
 * Fetch Price Guard Settings for a business.
 * Highly resilient: uses in-memory cache (60s), reads from price_guard_settings,
 * and falls back to integrations table (platform_name = 'pos_price_guard') if needed.
 */
export async function getPriceGuardSettings(
  businessId: string,
  supabase: SupabaseClient
): Promise<PriceGuardSettings> {
  if (!businessId) {
    return { ...DEFAULT_PRICE_GUARD_SETTINGS, business_id: '' }
  }

  const now = Date.now()
  const cached = settingsCache.get(businessId)
  if (cached && cached.expiresAt > now) {
    return cached.settings
  }

  let resolvedSettings: PriceGuardSettings = {
    ...DEFAULT_PRICE_GUARD_SETTINGS,
    business_id: businessId,
  }

  try {
    // 1. Try reading from price_guard_settings table
    const { data, error } = await supabase
      .from('price_guard_settings')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle()

    if (!error && data) {
      resolvedSettings = {
        business_id: businessId,
        global_enabled: Boolean(data.global_enabled),
        channels: Array.isArray(data.channels) ? data.channels : ['pos'],
        require_global_discount_auth: Boolean(data.require_global_discount_auth),
        require_approver_pin: Boolean(data.require_approver_pin),
        require_reason: Boolean(data.require_reason),
        updated_at: data.updated_at || null
      }
    } else if (error && (error.code === 'PGRST205' || error.message?.includes('does not exist'))) {
      // 2. Resilient fallback: read from integrations table
      const { data: intRows } = await supabase
        .from('integrations')
        .select('api_credentials')
        .eq('platform_name', 'pos_price_guard')
        .filter('api_credentials->>business_id', 'eq', businessId)
        .limit(1)

      const creds = intRows?.[0]?.api_credentials
      if (creds) {
        resolvedSettings = {
          business_id: businessId,
          global_enabled: Boolean(creds.global_enabled),
          channels: Array.isArray(creds.channels) ? creds.channels : ['pos'],
          require_global_discount_auth: Boolean(creds.require_global_discount_auth),
          require_approver_pin: Boolean(creds.require_approver_pin),
          require_reason: Boolean(creds.require_reason),
          updated_at: creds.updated_at || null
        }
      }
    }
  } catch (err) {
    console.warn('[PriceGuardSettings] Failed to load settings, using defaults:', err)
  }

  settingsCache.set(businessId, {
    settings: resolvedSettings,
    expiresAt: now + CACHE_TTL
  })

  return resolvedSettings
}

/**
 * Saves Price Guard settings for a business with dual-write resilience.
 */
export async function savePriceGuardSettings(
  businessId: string,
  settings: Partial<PriceGuardSettings>,
  userId: string,
  supabaseAdmin: SupabaseClient
): Promise<PriceGuardSettings> {
  const payload = {
    business_id: businessId,
    global_enabled: Boolean(settings.global_enabled),
    channels: Array.isArray(settings.channels) && settings.channels.length > 0 ? settings.channels : ['pos'],
    require_global_discount_auth: Boolean(settings.require_global_discount_auth),
    require_approver_pin: Boolean(settings.require_approver_pin),
    require_reason: Boolean(settings.require_reason),
    updated_by: userId,
    updated_at: new Date().toISOString()
  }

  // 1. Try upserting to price_guard_settings table
  let tableSaved = false
  try {
    const { error } = await supabaseAdmin
      .from('price_guard_settings')
      .upsert(payload, { onConflict: 'business_id' })

    if (!error) {
      tableSaved = true
    } else {
      console.warn('[PriceGuardSettings] Table upsert notice:', error.message)
    }
  } catch (err) {
    console.warn('[PriceGuardSettings] Table upsert exception:', err)
  }

  // 2. Always mirror to integrations table (platform_name = 'pos_price_guard')
  try {
    const { data: existing } = await supabaseAdmin
      .from('integrations')
      .select('id, api_credentials')
      .eq('platform_name', 'pos_price_guard')
      .filter('api_credentials->>business_id', 'eq', businessId)
      .limit(1)

    const intPayload = {
      user_id: userId,
      platform_name: 'pos_price_guard',
      store_url: 'internal://pos_price_guard',
      api_credentials: {
        ...payload,
        table_saved: tableSaved
      },
      is_active: true,
      last_sync_at: new Date().toISOString()
    }

    if (existing && existing.length > 0) {
      await supabaseAdmin
        .from('integrations')
        .update(intPayload)
        .eq('id', existing[0].id)
    } else {
      await supabaseAdmin
        .from('integrations')
        .insert(intPayload)
    }
  } catch (err) {
    console.warn('[PriceGuardSettings] Integration mirror exception:', err)
  }

  invalidatePriceGuardCache(businessId)

  return payload
}
