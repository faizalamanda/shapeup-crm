// ShapeUp POS Mode Resolver (Retail Fashion vs Hospitality F&B)
export type PosMode = 'retail' | 'fnb' | 'custom'

export interface PosModeResolution {
  mode: PosMode
  isRetail: boolean
  isFnb: boolean
  enableProductionTickets: boolean
}

const RETAIL_INDUSTRIES = ['fashion', 'retail', 'services', 'tech', 'manufacturing', 'healthcare']
const FNB_INDUSTRIES = ['fnb', 'resto', 'cafe', 'restaurant', 'bakery', 'coffee']

/**
 * Resolves whether the active business should operate in Retail mode or F&B mode.
 * Retail mode: Pure retail/fashion workflow (zero kitchen buttons, zero kitchen jargon).
 * F&B mode: Active kitchen/bar production stations, table management, cooking modifiers.
 */
export function resolvePosMode(business?: any, localOverrideMode?: PosMode | null): PosModeResolution {
  // 1. Explicit local override if configured
  if (localOverrideMode) {
    const isRetail = localOverrideMode === 'retail'
    const isFnb = localOverrideMode === 'fnb'
    return {
      mode: localOverrideMode,
      isRetail,
      isFnb,
      enableProductionTickets: !isRetail
    }
  }

  // 2. Business pos_mode column from database
  const bizPosMode = (business?.pos_mode as PosMode) || undefined
  if (bizPosMode && (bizPosMode === 'retail' || bizPosMode === 'fnb' || bizPosMode === 'custom')) {
    const isRetail = bizPosMode === 'retail'
    const isFnb = bizPosMode === 'fnb'
    return {
      mode: bizPosMode,
      isRetail,
      isFnb,
      enableProductionTickets: !isRetail
    }
  }

  // 3. Smart Fallback via business.industry
  const industry = (business?.industry || '').toLowerCase().trim()
  if (FNB_INDUSTRIES.some(ind => industry.includes(ind))) {
    return {
      mode: 'fnb',
      isRetail: false,
      isFnb: true,
      enableProductionTickets: true
    }
  }

  // Default is strictly Retail (e.g. fashion retail store)
  return {
    mode: 'retail',
    isRetail: true,
    isFnb: false,
    enableProductionTickets: false
  }
}

