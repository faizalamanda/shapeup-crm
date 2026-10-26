export interface PriceGuardSettings {
  business_id: string
  global_enabled: boolean
  channels: string[]
  require_global_discount_auth: boolean
  require_approver_pin: boolean
  require_reason: boolean
  updated_at?: string | null
}

export const DEFAULT_PRICE_GUARD_SETTINGS: PriceGuardSettings = {
  business_id: '',
  global_enabled: false,
  channels: ['pos'],
  require_global_discount_auth: false,
  require_approver_pin: false,
  require_reason: false,
  updated_at: null
}

export interface LineItemForPriceGuard {
  id?: string
  name?: string
  price: number // finalPrice or unitPrice
  discount?: number
  quantity: number
  variantId?: string | null
  variantName?: string | null
  isCustom?: boolean
  costPrice?: number
  preventBelowHpp?: boolean
  isGuarded?: boolean
  netUnitPrice?: number
  isViolated?: boolean
}

export interface PriceFloorCheckResult {
  hasViolations: boolean
  violatedItemIndices: number[]
  requiresGlobalDiscountAuth: boolean
  // High-level authorization required flags
  requireApproverPin: boolean
  requireReason: boolean
  isHardBlocked: boolean
}
