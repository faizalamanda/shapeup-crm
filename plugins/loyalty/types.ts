// ─── Loyalty Program Plugin — Types ───────────────────────────────────────────
// Semua type definitions untuk fitur Loyalty Member Program

export type LoyaltyPointType = 'earned' | 'redeemed' | 'expired' | 'adjusted' | 'reversed'

export interface LoyaltyTier {
  name: string
  min_points: number
  color: string
  multiplier: number
  badge_icon: string
}

export interface LoyaltySettings {
  id: string
  business_id: string
  is_enabled: boolean
  program_name: string

  // Earning
  amount_per_point: number       // Rp X = 1 poin
  min_transaction: number        // minimum transaksi

  // Redemption
  redemption_enabled: boolean
  points_per_redemption: number  // X poin
  redemption_value: number       // = Rp Y diskon
  max_redemption_pct: number     // max % dari transaksi

  // Expiry
  expiry_enabled: boolean
  expiry_months: number

  // Tiers
  tiers: LoyaltyTier[]

  created_at: string
  updated_at: string
}

export interface CustomerPoints {
  id: string
  business_id: string
  customer_id: string
  current_points: number
  lifetime_earned: number
  lifetime_redeemed: number
  tier: string
  last_activity_at: string | null
  created_at: string
  updated_at: string
}

export interface LoyaltyPointLedger {
  id: string
  business_id: string
  customer_id: string
  order_id: string | null
  type: LoyaltyPointType
  points: number              // positif = tambah, negatif = kurang
  balance_after: number
  description: string | null
  multiplier_used: number
  order_amount: number | null
  created_by: string | null
  created_at: string
}

export interface LoyaltySummaryStats {
  total_member_count: number
  total_points_outstanding: number
  total_points_earned: number
  total_points_redeemed: number
  tier_distribution: { tier: string; count: number; color: string }[]
}

// Default settings untuk bisnis baru
export const DEFAULT_LOYALTY_SETTINGS: Omit<LoyaltySettings, 'id' | 'business_id' | 'created_at' | 'updated_at'> = {
  is_enabled: false,
  program_name: 'Member Loyalty',
  amount_per_point: 10000,
  min_transaction: 0,
  redemption_enabled: true,
  points_per_redemption: 100,
  redemption_value: 10000,
  max_redemption_pct: 50,
  expiry_enabled: false,
  expiry_months: 12,
  tiers: [
    { name: 'Bronze', min_points: 0,    color: '#cd7f32', multiplier: 1.0, badge_icon: '🥉' },
    { name: 'Silver', min_points: 500,  color: '#9ca3af', multiplier: 1.5, badge_icon: '🥈' },
    { name: 'Gold',   min_points: 2000, color: '#f59e0b', multiplier: 2.0, badge_icon: '🥇' },
    { name: 'Platinum', min_points: 5000, color: '#8b5cf6', multiplier: 3.0, badge_icon: '💎' },
  ],
}

// Utility: resolve tier dari total poin customer
export function resolveTier(points: number, tiers: LoyaltyTier[]): LoyaltyTier {
  const sorted = [...tiers].sort((a, b) => b.min_points - a.min_points)
  return sorted.find(t => points >= t.min_points) ?? tiers[0]
}

// Utility: hitung poin yang didapat dari 1 order
export function calculateEarnedPoints(
  orderAmount: number,
  settings: Pick<LoyaltySettings, 'amount_per_point' | 'min_transaction'>,
  multiplier: number = 1.0
): number {
  if (orderAmount < settings.min_transaction) return 0
  const basePoints = Math.floor(orderAmount / settings.amount_per_point)
  return Math.floor(basePoints * multiplier)
}
