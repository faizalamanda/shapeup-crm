/**
 * Shared Wholesale / Tiered Volume Pricing Helper (Single Source of Truth)
 * Used across ProductModal, POSWorkspace, VariantSelectorModal, and Invoice pages.
 */

export interface WholesaleTier {
  min_qty: number
  price: number
}

export interface WholesaleResolutionResult {
  unitPrice: number
  appliedTier: WholesaleTier | null
  isWholesale: boolean
}

export interface WholesaleValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

const DIMENSION_UNITS = new Set(['m2', 'cm2'])

/**
 * Returns true if the product unit uses dimension/metered area pricing,
 * which is currently excluded from automatic wholesale tier resolution.
 */
export function isDimensionUnit(unit?: string | null): boolean {
  if (!unit) return false
  return DIMENSION_UNITS.has(String(unit).trim().toLowerCase())
}

/**
 * Normalizes raw JSONB or form array into a clean, sorted ascending WholesaleTier[].
 */
export function normalizeWholesaleTiers(raw: unknown): WholesaleTier[] {
  if (!Array.isArray(raw)) return []

  const cleaned: WholesaleTier[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const minQty = Math.floor(Number((item as any).min_qty))
    const price = Math.round(Number((item as any).price))
    if (!Number.isFinite(minQty) || minQty < 2) continue
    if (!Number.isFinite(price) || price <= 0) continue
    cleaned.push({ min_qty: minQty, price })
  }

  // Deduplicate by min_qty (keep the last entry if duplicated) and sort ascending
  const byQty = new Map<number, WholesaleTier>()
  for (const tier of cleaned) {
    byQty.set(tier.min_qty, tier)
  }

  return Array.from(byQty.values()).sort((a, b) => a.min_qty - b.min_qty)
}

/**
 * Validates wholesale tiers for duplicates, invalid thresholds, and non-monotonic pricing.
 */
export function validateWholesaleTiers(
  rawTiers: { min_qty: number | string; price: number | string }[],
  basePrice: number,
  costPrice = 0
): WholesaleValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
    return { valid: true, errors, warnings }
  }

  const seenQty = new Set<number>()
  const parsed: WholesaleTier[] = []

  for (let i = 0; i < rawTiers.length; i++) {
    const row = rawTiers[i]
    const minQty = Number(row.min_qty)
    const price = Number(row.price)

    if (!Number.isFinite(minQty) || minQty < 2 || !Number.isInteger(minQty)) {
      errors.push(`Baris #${i + 1}: Min. Qty harus bilangan bulat minimal 2.`)
      continue
    }
    if (!Number.isFinite(price) || price <= 0) {
      errors.push(`Baris #${i + 1}: Harga grosir harus lebih dari Rp 0.`)
      continue
    }
    if (seenQty.has(minQty)) {
      errors.push(`Duplikat Min. Qty (${minQty}). Setiap segmen harus memiliki minimum qty yang berbeda.`)
      continue
    }
    seenQty.add(minQty)
    parsed.push({ min_qty: minQty, price: Math.round(price) })
  }

  const sorted = [...parsed].sort((a, b) => a.min_qty - b.min_qty)

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]
    if (basePrice > 0 && tier.price >= basePrice) {
      warnings.push(`Segmen ≥ ${tier.min_qty}: Harga grosir (${tier.price.toLocaleString('id-ID')}) tidak lebih murah dari harga normal (${basePrice.toLocaleString('id-ID')}).`)
    }
    if (i > 0 && tier.price >= sorted[i - 1].price) {
      warnings.push(`Segmen ≥ ${tier.min_qty}: Harga grosir sebaiknya lebih rendah dari segmen ≥ ${sorted[i - 1].min_qty}.`)
    }
    if (costPrice > 0 && tier.price < costPrice) {
      warnings.push(`Segmen ≥ ${tier.min_qty}: Harga grosir di bawah HPP (Rp ${costPrice.toLocaleString('id-ID')}).`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Resolves the effective unit price for a given quantity using All-Units Discount logic.
 * Returns basePrice when quantity does not reach any tier or when product is dimension-based.
 */
export function resolveWholesaleUnitPrice(params: {
  basePrice: number
  wholesaleTiers?: WholesaleTier[] | unknown
  qty: number
  isDimensionProduct?: boolean
}): WholesaleResolutionResult {
  const { basePrice, wholesaleTiers, qty, isDimensionProduct = false } = params
  const safeBase = Math.max(0, Number(basePrice) || 0)
  const safeQty = Math.max(0, Number(qty) || 0)

  if (isDimensionProduct || safeQty < 2) {
    return { unitPrice: safeBase, appliedTier: null, isWholesale: false }
  }

  const tiers = normalizeWholesaleTiers(wholesaleTiers)
  if (tiers.length === 0) {
    return { unitPrice: safeBase, appliedTier: null, isWholesale: false }
  }

  let matched: WholesaleTier | null = null
  for (const tier of tiers) {
    if (safeQty >= tier.min_qty) {
      matched = tier
    } else {
      break
    }
  }

  if (!matched) {
    return { unitPrice: safeBase, appliedTier: null, isWholesale: false }
  }

  return {
    unitPrice: matched.price,
    appliedTier: matched,
    isWholesale: true
  }
}

