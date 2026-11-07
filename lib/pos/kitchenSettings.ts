// ShapeUp POS Kitchen & Bar Printer Settings & Multi-Station Mapping
import { PaperSize } from './printerAdapter'

export type KitchenStationId = 'kitchen' | 'bar'

export interface KitchenStationDefinition {
  id: KitchenStationId
  name: string
  label: string
  icon: string
  defaultPaperSize?: PaperSize
}

export const KITCHEN_STATIONS: KitchenStationDefinition[] = [
  {
    id: 'kitchen',
    name: 'Dapur Makanan',
    label: 'DAPUR UTAMA',
    icon: '🍳'
  },
  {
    id: 'bar',
    name: 'Bar Minuman',
    label: 'BAR & MINUMAN',
    icon: '🍹'
  }
]

export interface KitchenSettings {
  enabled: boolean
  autoPrintOnPayment: boolean
  autoPrintOnHold: boolean
  separateStations: boolean // true = split into separate tickets for Kitchen and Bar; false = 1 combined kitchen ticket
  paperSize?: PaperSize
  categoryStationMap: Record<string, KitchenStationId> // categoryId or categoryName lowercase -> station
  soundBuzzer: boolean
  autoCutPaper: boolean
  showTableNumber: boolean
  showItemNumbering: boolean
}

export const KITCHEN_SETTINGS_STORAGE_KEY = 'shapeup_pos_kitchen_settings'

export const DEFAULT_KITCHEN_SETTINGS: KitchenSettings = {
  enabled: true,
  autoPrintOnPayment: false,
  autoPrintOnHold: false,
  separateStations: true,
  categoryStationMap: {},
  soundBuzzer: true,
  autoCutPaper: true,
  showTableNumber: true,
  showItemNumbering: true
}

export function getStoredKitchenSettings(fallbackPaperSize: PaperSize = '58mm'): KitchenSettings {
  if (typeof window === 'undefined') {
    return {
      ...DEFAULT_KITCHEN_SETTINGS,
      paperSize: fallbackPaperSize
    }
  }

  try {
    const raw = localStorage.getItem(KITCHEN_SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        enabled: parsed.enabled !== undefined ? Boolean(parsed.enabled) : true,
        autoPrintOnPayment: Boolean(parsed.autoPrintOnPayment),
        autoPrintOnHold: Boolean(parsed.autoPrintOnHold),
        separateStations: parsed.separateStations !== undefined ? Boolean(parsed.separateStations) : true,
        paperSize: parsed.paperSize || fallbackPaperSize,
        categoryStationMap: parsed.categoryStationMap || {},
        soundBuzzer: parsed.soundBuzzer !== undefined ? Boolean(parsed.soundBuzzer) : true,
        autoCutPaper: parsed.autoCutPaper !== undefined ? Boolean(parsed.autoCutPaper) : true,
        showTableNumber: parsed.showTableNumber !== undefined ? Boolean(parsed.showTableNumber) : true,
        showItemNumbering: parsed.showItemNumbering !== undefined ? Boolean(parsed.showItemNumbering) : true
      }
    }
  } catch (e) {
    console.warn('[KitchenSettings] Failed reading settings from localStorage:', e)
  }

  return {
    ...DEFAULT_KITCHEN_SETTINGS,
    paperSize: fallbackPaperSize
  }
}

export function saveStoredKitchenSettings(settings: KitchenSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KITCHEN_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('[KitchenSettings] Failed saving settings to localStorage:', e)
  }
}

const BAR_KEYWORDS = [
  'minum', 'drink', 'beverage', 'kopi', 'coffee', 'tea', 'teh', 'jus', 'juice',
  'boba', 'cocktail', 'mocktail', 'latte', 'espresso', 'es ', 'ice', 'smoothie',
  'shake', 'soda', 'syrup', 'sirup', 'beer', 'wine', 'air mineral', 'botol'
]

/**
 * Smart Classifier to auto-route an item or category to 'bar' or 'kitchen'
 */
export function resolveItemStation(
  item: { name?: string; category_id?: string; category_name?: string; product?: any },
  categoryMap: Record<string, KitchenStationId> = {}
): KitchenStationId {
  // 1. Direct category ID mapping
  const catId = item.category_id || item.product?.category_id
  if (catId && categoryMap[catId]) {
    return categoryMap[catId]
  }

  // 2. Category name mapping
  const catName = (item.category_name || item.product?.category?.name || item.product?.category_name || '').toLowerCase().trim()
  if (catName && categoryMap[catName]) {
    return categoryMap[catName]
  }

  // 3. Keyword heuristic on category name
  if (catName) {
    if (BAR_KEYWORDS.some(kw => catName.includes(kw))) {
      return 'bar'
    }
  }

  // 4. Keyword heuristic on product item name
  const itemName = (item.name || item.product?.name || '').toLowerCase()
  if (BAR_KEYWORDS.some(kw => itemName.includes(kw))) {
    return 'bar'
  }

  // Default station is kitchen
  return 'kitchen'
}

