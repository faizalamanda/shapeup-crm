// ─── Loyalty Program Plugin — Index ───────────────────────────────────────────
// Self-contained plugin module untuk fitur Loyalty Member Program
// Default: DISABLED (is_enabled: false di loyalty_settings)

export const LOYALTY_PLUGIN = {
  id: 'loyalty',
  name: 'Loyalty Member Program',
  version: '1.0.0',
  description:
    'Program poin loyalitas pelanggan: earn poin dari setiap pembelian, sistem tier (Bronze/Silver/Gold/Platinum), histori poin, dan redeem poin sebagai diskon.',
  author: 'ShapeUp CRM Team',
  category: 'crm',
  icon: '⭐',
  isPremium: true,
  defaultEnabled: false,
}

// Re-export everything
export * from './types'
export * from './helpers/loyaltyApi'
