export type LocationType = 'internal' | 'vendor' | 'customer' | 'inventory_loss'

export interface InventoryLocation {
  id: string
  business_id: string
  name: string
  type: LocationType
  code: string
  is_default: boolean
  created_at: string
}

export type MoveType = 'receipt' | 'delivery' | 'transfer' | 'adjustment'
export type MoveStatus = 'done' | 'pending' | 'cancelled'

export interface StockMove {
  id: string
  business_id: string
  product_id: string
  product_name?: string
  product_sku?: string | null
  reference: string
  origin_location_id: string | null
  origin_location_name?: string
  destination_location_id: string | null
  destination_location_name?: string
  qty: number
  unit_cost: number
  lot_number?: string | null
  status: MoveStatus
  type: MoveType
  created_at: string
}

export interface StockReportItem {
  productId: string
  productName: string
  sku: string | null
  categoryName: string
  unit: string
  onHandQty: number
  availableQty: number
  reservedQty: number
  unitCost: number
  totalValue: number
  incomingShipments: number
  outgoingItems: number
  locationBreakdown: Record<string, { locationName: string; qty: number; reserved: number }>
}

export interface LocationReportSummary {
  locationId: string
  locationName: string
  locationCode: string
  locationType: LocationType
  isDefault: boolean
  totalProductsCount: number
  totalQty: number
  reservedQty: number
  availableQty: number
  totalValue: number
  incomingQty: number
  outgoingQty: number
}

export interface ValuationMethodResult {
  method: 'FIFO' | 'LIFO' | 'AVCO' | 'STANDARD'
  methodName: string
  description: string
  totalValuation: number
  itemBreakdown: Array<{
    productId: string
    productName: string
    sku: string | null
    qtyOnHand: number
    unitCostCalculated: number
    totalValueCalculated: number
    standardCost: number
    varianceVsStandard: number
  }>
}

export interface PivotGroupRow {
  groupKey: string
  groupLabel: string
  subRows?: PivotGroupRow[]
  totalQtyIn: number
  totalQtyOut: number
  netMovement: number
  totalValue: number
  moveCount: number
}

export interface InventoryReportsFilter {
  searchQuery: string
  categoryId: string
  locationId: string
  statusFilter: MoveStatus | 'all'
  lotNumberFilter: string
  dateFrom: string
  dateTo: string
  valuationMethod: 'FIFO' | 'LIFO' | 'AVCO' | 'STANDARD'
}
