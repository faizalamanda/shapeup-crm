import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_RETURN_POLICY, ReturnPolicy, ApprovalMode, ReturnDisposition } from './types'

interface CacheEntry {
  policy: ReturnPolicy
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL = 60_000 // 60s (rarely-changing config)

export function invalidateReturnPolicyCache(businessId?: string) {
  if (businessId) cache.delete(businessId)
  else cache.clear()
}

const APPROVAL_MODES: ApprovalMode[] = ['off', 'always', 'above_amount', 'non_admin']
const DISPOSITIONS: ReturnDisposition[] = ['restock', 'quarantine', 'writeoff']

function normalize(businessId: string, row: any): ReturnPolicy {
  const d = DEFAULT_RETURN_POLICY
  const mode = APPROVAL_MODES.includes(row?.approval_mode) ? row.approval_mode : d.approval_mode
  const disp = DISPOSITIONS.includes(row?.default_disposition) ? row.default_disposition : d.default_disposition
  const days = Number(row?.return_window_days)
  const thr = Number(row?.approval_threshold)
  const fee = Number(row?.restocking_fee_pct)
  return {
    business_id: businessId,
    return_window_days: Number.isFinite(days) && days >= 0 ? Math.floor(days) : d.return_window_days,
    require_reason: row?.require_reason === undefined ? d.require_reason : Boolean(row.require_reason),
    approval_mode: mode,
    approval_threshold: Number.isFinite(thr) && thr >= 0 ? Math.round(thr) : d.approval_threshold,
    restocking_fee_pct: Number.isFinite(fee) ? Math.min(100, Math.max(0, fee)) : d.restocking_fee_pct,
    allow_store_credit: row?.allow_store_credit === undefined ? d.allow_store_credit : Boolean(row.allow_store_credit),
    default_disposition: disp
  }
}

/** Loads the return policy (cached 60s). Falls back to safe defaults when the table is missing. */
export async function getReturnPolicy(businessId: string, supabase: SupabaseClient): Promise<ReturnPolicy> {
  const now = Date.now()
  const cached = cache.get(businessId)
  if (cached && cached.expiresAt > now) return cached.policy

  let policy = normalize(businessId, null)
  try {
    const { data, error } = await supabase
      .from('pos_return_settings')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle()
    if (!error && data) policy = normalize(businessId, data)
  } catch (err) {
    console.warn('[ReturnPolicy] Failed to load, using defaults:', err)
  }

  cache.set(businessId, { policy, expiresAt: now + CACHE_TTL })
  return policy
}

export async function saveReturnPolicy(
  businessId: string,
  input: Partial<ReturnPolicy>,
  userId: string,
  supabaseAdmin: SupabaseClient
): Promise<ReturnPolicy> {
  const policy = normalize(businessId, input)
  const { error } = await supabaseAdmin.from('pos_return_settings').upsert(
    {
      business_id: businessId,
      return_window_days: policy.return_window_days,
      require_reason: policy.require_reason,
      approval_mode: policy.approval_mode,
      approval_threshold: policy.approval_threshold,
      restocking_fee_pct: policy.restocking_fee_pct,
      allow_store_credit: policy.allow_store_credit,
      default_disposition: policy.default_disposition,
      updated_by: userId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'business_id' }
  )
  if (error) throw new Error(error.message)
  invalidateReturnPolicyCache(businessId)
  return policy
}
