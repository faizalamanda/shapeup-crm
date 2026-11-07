// ShapeUp POS Dynamic Production Station Routing Service (Headless Domain Engine)
import { PaperSize } from './printerAdapter'
import {
  KitchenTicketData,
  KitchenTicketItem,
  extractTableNumber
} from './kitchenTicketBuilder'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'

export interface ProductionStation {
  id: string
  name: string
  code?: string | null
  icon: string
  paper_size?: PaperSize
  is_active?: boolean
  is_default?: boolean
  categoryIds?: string[]
}

export interface RouteOrderOptions {
  businessName?: string
  cashierName?: string
  timezone?: string
  ticketKind?: 'NEW' | 'ADD-ON' | 'HOLD'
  isReprint?: boolean
  tableNumber?: string
  queueNumber?: string | number
  globalOrderNote?: string
}

/**
 * Pure Domain Routing Engine:
 * Maps an array of cart/order items to dynamic production stations based on product categories.
 * 
 * GOLDEN RULE:
 * Items belonging to unmapped categories (such as Clothing, Pants, Shoes in retail fashion)
 * are COMPLETELY EXCLUDED from production tickets.
 */
export function routeItemsToProductionStations(
  rawItems: any[],
  stations: ProductionStation[],
  categoriesMap: Map<string, string>, // category_id -> station_id
  baseOrderInfo: {
    orderNumber?: string
    customerName?: string
    orderNote?: string
    queueNumber?: string | number
    createdAt?: string | Date
    orderType?: string
  },
  options: RouteOrderOptions = {}
): KitchenTicketData[] {
  if (!stations || stations.length === 0 || !rawItems || rawItems.length === 0) {
    return []
  }

  const businessName = options.businessName || 'ShapeUp Store'
  const timezone = options.timezone || DEFAULT_TIMEZONE
  const orderNumber = baseOrderInfo.orderNumber || 'POS-ORDER'
  const extractedNote = (options.globalOrderNote || baseOrderInfo.orderNote || '').trim()
  const detectedTable = options.tableNumber || extractTableNumber(extractedNote)
  const effectiveQueue = options.queueNumber || baseOrderInfo.queueNumber
  const dateStr = formatDisplayDate(baseOrderInfo.createdAt || new Date(), 'time', timezone) || new Date().toLocaleTimeString('id-ID')
  const orderType: 'DINE-IN' | 'TAKEAWAY' | 'DELIVERY' = (
    baseOrderInfo.orderType?.toUpperCase() === 'TAKEAWAY' || extractedNote.toLowerCase().includes('takeaway') || extractedNote.toLowerCase().includes('bungkus')
  ) ? 'TAKEAWAY' : 'DINE-IN'

  // Map stationId -> list of items
  const stationBuckets = new Map<string, KitchenTicketItem[]>()
  for (const st of stations) {
    if (st.is_active !== false) {
      stationBuckets.set(st.id, [])
    }
  }

  // Iterate over raw items
  for (const item of rawItems) {
    const qty = Number(item.quantity || item.qty || 1)
    if (qty <= 0) continue

    const catId = item.category_id || item.product?.category_id || item.product?.category?.id
    if (!catId) continue

    // Find assigned station for this category
    const targetStationId = categoriesMap.get(catId)
    if (!targetStationId || !stationBuckets.has(targetStationId)) {
      // Unmapped category (e.g. fashion retail product) -> Skipped from production!
      continue
    }

    const rawName = item.name || item.product_name || item.product?.name || 'Item'
    const variantStr = (item.variant || item.variant_name || item.selectedVariant?.name || '').trim()
    const displayName = (variantStr && !rawName.toLowerCase().includes(variantStr.toLowerCase()))
      ? `${rawName} - ${variantStr}`
      : rawName

    let modifiersList: Array<{ group?: string; option: string }> = []
    if (Array.isArray(item.selectedModifiers)) {
      modifiersList = item.selectedModifiers.map((m: any) => ({
        group: m.group_name || m.group,
        option: m.option_name || m.name || m.option || String(m)
      }))
    }

    const ticketItem: KitchenTicketItem = {
      name: displayName,
      quantity: qty,
      modifiers: modifiersList.length > 0 ? modifiersList : undefined,
      note: item.note || item.item_note || undefined,
      station: (targetStationId as any)
    }

    stationBuckets.get(targetStationId)!.push(ticketItem)
  }

  // Build KitchenTicketData for stations that actually received items
  const resultTickets: KitchenTicketData[] = []

  for (const st of stations) {
    const itemsForStation = stationBuckets.get(st.id) || []
    if (itemsForStation.length > 0) {
      resultTickets.push({
        stationId: st.id as any,
        stationName: st.name,
        stationLabel: (st.code || st.name).toUpperCase(),
        stationIcon: st.icon || '🍳',
        businessName,
        orderNumber,
        queueNumber: effectiveQueue,
        tableNumber: detectedTable,
        orderType,
        timestamp: dateStr,
        cashierOrServer: options.cashierName || 'Kasir / Waiter',
        customerName: baseOrderInfo.customerName || 'Pelanggan',
        globalOrderNote: extractedNote || undefined,
        items: itemsForStation,
        paperSize: st.paper_size || '58mm',
        isReprint: options.isReprint,
        ticketKind: options.ticketKind || 'NEW'
      })
    }
  }

  return resultTickets
}

