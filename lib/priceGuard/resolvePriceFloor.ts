import { PriceGuardSettings, LineItemForPriceGuard, PriceFloorCheckResult } from './types'

/**
 * Pure evaluation function for Price Floor Guard.
 * Executed identically on client (POS Workspace) and server (/api/pos/order).
 */
export function evaluatePriceFloor(
  settings: PriceGuardSettings | null | undefined,
  items: LineItemForPriceGuard[],
  globalDiscountAmount: number = 0
): PriceFloorCheckResult {
  const effectiveSettings = settings || {
    business_id: '',
    global_enabled: false,
    channels: ['pos'],
    require_global_discount_auth: false,
    require_approver_pin: false,
    require_reason: false
  }

  // Check if channel is enabled (defaults to true if channel is pos)
  const isPosActive = effectiveSettings.channels?.includes('pos') ?? true
  if (!isPosActive) {
    return {
      hasViolations: false,
      violatedItemIndices: [],
      requiresGlobalDiscountAuth: false,
      requireApproverPin: false,
      requireReason: false,
      isHardBlocked: false
    }
  }

  const violatedIndices: number[] = []

  items.forEach((item, idx) => {
    const isCustom = item.isCustom || String(item.id || '').startsWith('custom-')
    const cost = Number(item.costPrice || 0)

    // A product is guarded if either global_enabled is true OR the product has prevent_below_hpp enabled
    // Only applies if cost > 0 and it's not a custom manual keypad item
    const isGuarded = (effectiveSettings.global_enabled || Boolean(item.preventBelowHpp)) && cost > 0 && !isCustom

    if (isGuarded) {
      const netUnitPrice = Math.max(0, Number(item.price || 0) - Number(item.discount || 0))
      // Strictly cannot be less than cost_price
      if (netUnitPrice < cost) {
        violatedIndices.push(idx)
      }
    }
  })

  const hasViolations = violatedIndices.length > 0
  const requiresGlobalDiscountAuth =
    Boolean(effectiveSettings.require_global_discount_auth) && Number(globalDiscountAmount) > 0

  const needsAuthorization = hasViolations || requiresGlobalDiscountAuth

  // If neither PIN nor reason is checked in settings, it is a hard block
  const isHardBlocked =
    needsAuthorization &&
    !effectiveSettings.require_approver_pin &&
    !effectiveSettings.require_reason

  return {
    hasViolations,
    violatedItemIndices: violatedIndices,
    requiresGlobalDiscountAuth,
    requireApproverPin: Boolean(effectiveSettings.require_approver_pin),
    requireReason: Boolean(effectiveSettings.require_reason),
    isHardBlocked
  }
}
