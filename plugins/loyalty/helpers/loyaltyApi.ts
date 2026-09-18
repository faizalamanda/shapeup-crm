// ─── Loyalty Program Plugin — API Helpers ─────────────────────────────────────
// Semua interaksi dengan Supabase untuk fitur Loyalty

import { SupabaseClient } from '@supabase/supabase-js'
import {
  LoyaltySettings,
  CustomerPoints,
  LoyaltyPointLedger,
  LoyaltySummaryStats,
  LoyaltyTier,
  DEFAULT_LOYALTY_SETTINGS,
  resolveTier,
  calculateEarnedPoints,
} from '../types'

// ─────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────

export async function fetchLoyaltySettings(
  supabase: SupabaseClient,
  businessId: string
): Promise<LoyaltySettings | null> {
  const { data, error } = await supabase
    .from('loyalty_settings')
    .select('*')
    .eq('business_id', businessId)
    .single()

  if (error && error.code === 'PGRST116') return null // No row found
  if (error) throw error
  return data as LoyaltySettings
}

export async function upsertLoyaltySettings(
  supabase: SupabaseClient,
  businessId: string,
  settings: Partial<Omit<LoyaltySettings, 'id' | 'business_id' | 'created_at' | 'updated_at'>>
): Promise<LoyaltySettings> {
  const { data, error } = await supabase
    .from('loyalty_settings')
    .upsert({ business_id: businessId, ...settings }, { onConflict: 'business_id' })
    .select('*')
    .single()

  if (error) throw error
  return data as LoyaltySettings
}

// ─────────────────────────────────────────────────────────────
// CUSTOMER POINTS
// ─────────────────────────────────────────────────────────────

export async function fetchCustomerPoints(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string
): Promise<CustomerPoints | null> {
  const { data, error } = await supabase
    .from('customer_points')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .single()

  if (error && error.code === 'PGRST116') return null
  if (error) throw error
  return data as CustomerPoints
}

export async function fetchCustomerPointHistory(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
  limit = 50
): Promise<LoyaltyPointLedger[]> {
  const { data, error } = await supabase
    .from('loyalty_point_ledger')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as LoyaltyPointLedger[]
}

// ─────────────────────────────────────────────────────────────
// EARN POINTS (called from orderLedger.ts on order complete)
// Idempotent: cek dulu apakah order sudah pernah dapat poin
// ─────────────────────────────────────────────────────────────

export async function earnPointsForOrder(
  supabase: SupabaseClient,
  params: {
    businessId: string
    customerId: string
    orderId: string
    orderAmount: number   // grand_total dari order
    orderNumber: string
  }
): Promise<{ success: boolean; points_earned: number; message: string }> {
  try {
    const { businessId, customerId, orderId, orderAmount, orderNumber } = params

    // 1. Fetch settings — if not enabled, skip
    const settings = await fetchLoyaltySettings(supabase, businessId)
    if (!settings || !settings.is_enabled) {
      return { success: true, points_earned: 0, message: 'Loyalty program not enabled' }
    }

    // 2. Idempotency check: apakah order ini sudah pernah dapat poin 'earned'?
    const { data: existingLedger } = await supabase
      .from('loyalty_point_ledger')
      .select('id')
      .eq('business_id', businessId)
      .eq('order_id', orderId)
      .eq('type', 'earned')
      .limit(1)

    if (existingLedger && existingLedger.length > 0) {
      return { success: true, points_earned: 0, message: 'Points already earned for this order' }
    }

    // 3. Get or create customer_points record
    let cp = await fetchCustomerPoints(supabase, businessId, customerId)

    if (!cp) {
      const { data: newCp, error: cpErr } = await supabase
        .from('customer_points')
        .insert({ business_id: businessId, customer_id: customerId })
        .select('*')
        .single()
      if (cpErr) throw cpErr
      cp = newCp as CustomerPoints
    }

    // 4. Resolve tier & multiplier
    const currentTier = resolveTier(cp.current_points, settings.tiers as LoyaltyTier[])
    const multiplier = currentTier.multiplier

    // 5. Calculate points earned from this order's grand_total
    const pointsEarned = calculateEarnedPoints(orderAmount, settings, multiplier)

    if (pointsEarned <= 0) {
      return { success: true, points_earned: 0, message: 'Order amount below minimum threshold' }
    }

    // 6. Calculate new balance
    const newBalance = cp.current_points + pointsEarned
    const newLifetimeEarned = cp.lifetime_earned + pointsEarned

    // 7. Resolve new tier after earning
    const newTier = resolveTier(newBalance, settings.tiers as LoyaltyTier[])

    // 8. Update customer_points
    const { error: updateErr } = await supabase
      .from('customer_points')
      .update({
        current_points: newBalance,
        lifetime_earned: newLifetimeEarned,
        tier: newTier.name,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', cp.id)

    if (updateErr) throw updateErr

    // 9. Write to ledger
    const { error: ledgerErr } = await supabase
      .from('loyalty_point_ledger')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        order_id: orderId,
        type: 'earned',
        points: pointsEarned,
        balance_after: newBalance,
        description: `Pembelian #${orderNumber} — Rp ${orderAmount.toLocaleString('id-ID')}`,
        multiplier_used: multiplier,
        order_amount: orderAmount,
      })

    if (ledgerErr) throw ledgerErr

    return { success: true, points_earned: pointsEarned, message: `Earned ${pointsEarned} points` }
  } catch (err: any) {
    console.error('[LoyaltyPlugin] earnPointsForOrder error:', err)
    return { success: false, points_earned: 0, message: err.message || 'Unknown error' }
  }
}

// ─────────────────────────────────────────────────────────────
// REVERSE POINTS (called on order cancelled/refunded/returned)
// ─────────────────────────────────────────────────────────────

export async function reversePointsForOrder(
  supabase: SupabaseClient,
  params: {
    businessId: string
    customerId: string
    orderId: string
    orderNumber: string
    reverseType: 'reversed'  // always 'reversed'
  }
): Promise<{ success: boolean; points_reversed: number; message: string }> {
  try {
    const { businessId, customerId, orderId, orderNumber } = params

    // 1. Find the original earned ledger entry for this order
    const { data: earnedEntries } = await supabase
      .from('loyalty_point_ledger')
      .select('*')
      .eq('business_id', businessId)
      .eq('order_id', orderId)
      .eq('type', 'earned')
      .limit(1)

    if (!earnedEntries || earnedEntries.length === 0) {
      return { success: true, points_reversed: 0, message: 'No points to reverse for this order' }
    }

    // 2. Check idempotency: apakah sudah pernah di-reverse?
    const { data: reversedEntries } = await supabase
      .from('loyalty_point_ledger')
      .select('id')
      .eq('business_id', businessId)
      .eq('order_id', orderId)
      .eq('type', 'reversed')
      .limit(1)

    if (reversedEntries && reversedEntries.length > 0) {
      return { success: true, points_reversed: 0, message: 'Points already reversed for this order' }
    }

    const earned = earnedEntries[0] as LoyaltyPointLedger
    const pointsToReverse = earned.points

    // 3. Get current customer_points
    const cp = await fetchCustomerPoints(supabase, businessId, customerId)
    if (!cp) {
      return { success: true, points_reversed: 0, message: 'No customer points record found' }
    }

    // 4. Ensure balance doesn't go negative
    const newBalance = Math.max(0, cp.current_points - pointsToReverse)
    const newLifetimeEarned = Math.max(0, cp.lifetime_earned - pointsToReverse)

    // 5. Fetch settings for tier resolution
    const settings = await fetchLoyaltySettings(supabase, businessId)
    const tiers = settings?.tiers as LoyaltyTier[] ?? DEFAULT_LOYALTY_SETTINGS.tiers
    const newTier = resolveTier(newBalance, tiers)

    // 6. Update customer_points
    const { error: updateErr } = await supabase
      .from('customer_points')
      .update({
        current_points: newBalance,
        lifetime_earned: newLifetimeEarned,
        tier: newTier.name,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', cp.id)

    if (updateErr) throw updateErr

    // 7. Write reversal to ledger
    const { error: ledgerErr } = await supabase
      .from('loyalty_point_ledger')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        order_id: orderId,
        type: 'reversed',
        points: -pointsToReverse,
        balance_after: newBalance,
        description: `Reversal poin untuk #${orderNumber}`,
        multiplier_used: earned.multiplier_used,
        order_amount: earned.order_amount,
      })

    if (ledgerErr) throw ledgerErr

    return { success: true, points_reversed: pointsToReverse, message: `Reversed ${pointsToReverse} points` }
  } catch (err: any) {
    console.error('[LoyaltyPlugin] reversePointsForOrder error:', err)
    return { success: false, points_reversed: 0, message: err.message || 'Unknown error' }
  }
}

// ─────────────────────────────────────────────────────────────
// MANUAL ADJUST (by staff)
// ─────────────────────────────────────────────────────────────

export async function manualAdjustPoints(
  supabase: SupabaseClient,
  params: {
    businessId: string
    customerId: string
    points: number          // positif atau negatif
    description: string
    createdBy: string       // user_id of staff
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { businessId, customerId, points, description, createdBy } = params

    // Get or create customer_points
    let cp = await fetchCustomerPoints(supabase, businessId, customerId)
    if (!cp) {
      const { data: newCp, error } = await supabase
        .from('customer_points')
        .insert({ business_id: businessId, customer_id: customerId })
        .select('*')
        .single()
      if (error) throw error
      cp = newCp as CustomerPoints
    }

    const newBalance = Math.max(0, cp.current_points + points)
    const newLifetimeEarned = points > 0 ? cp.lifetime_earned + points : cp.lifetime_earned

    // Fetch settings for tier
    const settings = await fetchLoyaltySettings(supabase, businessId)
    const tiers = settings?.tiers as LoyaltyTier[] ?? DEFAULT_LOYALTY_SETTINGS.tiers
    const newTier = resolveTier(newBalance, tiers)

    // Update points record
    const { error: updateErr } = await supabase
      .from('customer_points')
      .update({
        current_points: newBalance,
        lifetime_earned: newLifetimeEarned,
        tier: newTier.name,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', cp.id)

    if (updateErr) throw updateErr

    // Write to ledger
    const { error: ledgerErr } = await supabase
      .from('loyalty_point_ledger')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        order_id: null,
        type: 'adjusted',
        points,
        balance_after: newBalance,
        description,
        multiplier_used: 1.0,
        created_by: createdBy,
      })

    if (ledgerErr) throw ledgerErr

    return { success: true, message: 'Points adjusted successfully' }
  } catch (err: any) {
    return { success: false, message: err.message || 'Unknown error' }
  }
}

// ─────────────────────────────────────────────────────────────
// SUMMARY STATS for Loyalty Settings Page
// ─────────────────────────────────────────────────────────────

export async function fetchLoyaltySummaryStats(
  supabase: SupabaseClient,
  businessId: string,
  tiers: LoyaltyTier[]
): Promise<LoyaltySummaryStats> {
  const { data, error } = await supabase
    .from('customer_points')
    .select('current_points, lifetime_earned, lifetime_redeemed, tier')
    .eq('business_id', businessId)

  if (error) throw error
  const rows = data ?? []

  const tierMap: Record<string, { count: number; color: string }> = {}
  tiers.forEach(t => { tierMap[t.name] = { count: 0, color: t.color } })

  let totalPoints = 0, totalEarned = 0, totalRedeemed = 0

  for (const row of rows) {
    totalPoints += row.current_points ?? 0
    totalEarned += row.lifetime_earned ?? 0
    totalRedeemed += row.lifetime_redeemed ?? 0
    if (tierMap[row.tier]) {
      tierMap[row.tier].count++
    }
  }

  return {
    total_member_count: rows.length,
    total_points_outstanding: totalPoints,
    total_points_earned: totalEarned,
    total_points_redeemed: totalRedeemed,
    tier_distribution: tiers.map(t => ({
      tier: t.name,
      count: tierMap[t.name]?.count ?? 0,
      color: t.color,
    })),
  }
}
