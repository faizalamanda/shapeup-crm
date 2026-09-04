import InventoryReportsMain from './components/InventoryReportsMain'

export const INVENTORY_REPORTS_PLUGIN = {
  id: 'inventory_reports',
  name: 'Inventory & Stock Reports',
  version: '1.0.0',
  description: 'Laporan persediaan stok serba ada (Stock Report, Location Report, Move History, Move Analysis Pivot & Charts, Valuation FIFO/LIFO/AVCO).',
  author: 'ShapeUp CRM Team',
  category: 'inventory',
  icon: '📦',
  component: InventoryReportsMain,
}

export default InventoryReportsMain
export * from './types'
export * from './inventoryHelper'
