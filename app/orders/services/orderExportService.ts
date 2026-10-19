import * as XLSX from 'xlsx'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'

export interface OrderExportOptions {
  orders: any[]
  format: 'xlsx' | 'csv'
  layout: 'multisheet' | 'summary' | 'items'
  fileName: string
  timezone?: string
}

/**
 * Builds rows for Order Summary (Sheet 1: 1 row per order)
 */
export function buildOrderSummaryRows(orders: any[], timezone: string = DEFAULT_TIMEZONE) {
  return orders.map(o => {
    const grandTotal = Math.round(Number(o.grand_total) || 0)
    const amountPaid = Math.round(Number(o.amount_paid) || 0)
    const outstanding = Math.max(0, grandTotal - amountPaid)

    const payStatusLabel = 
      o.payment_status === 'paid' ? 'Lunas' :
      o.payment_status === 'partial' ? 'Sebagian / DP' : 'Belum Bayar'

    // Combine line item summary: e.g. "2x Believe Flower | 1x Kaos Polos"
    const itemsSummary = Array.isArray(o.items_json) && o.items_json.length > 0
      ? o.items_json.map((i: any) => `${i.quantity || 1}x ${i.name || '-'}`).join(' | ')
      : '-'

    // Resolve address from customer or raw_source_data
    const shipping = o.raw_source_data?.shipping
    const rawAddress = shipping
      ? [shipping.address_1, shipping.address_2, shipping.city, shipping.state, shipping.postcode].filter(Boolean).join(', ')
      : ''
    const resolvedAddress = o.customer?.address || rawAddress || '-'

    return {
      'No. Pesanan': String(o.order_number || o.id || '-'),
      'Tanggal Transaksi': o.order_date ? formatDisplayDate(o.order_date, 'full', timezone) : '-',
      'Platform': o.source_platform || 'Manual',
      'Nama Pelanggan': o.customer?.name || 'Tanpa Nama',
      'No. WhatsApp / HP': o.customer?.phone ? String(o.customer.phone) : (shipping?.phone ? String(shipping.phone) : '-'),
      'Email Pelanggan': o.customer?.email || o.raw_source_data?.billing?.email || '-',
      'Alamat Pengiriman': resolvedAddress,
      'Kota / Kabupaten': shipping?.city || '-',
      'Status Pesanan': o.status || '-',
      'Status Pembayaran': payStatusLabel,
      'Metode Pembayaran': o.payment_method || '-',
      'Total Qty': Number(o.total_qty) || 0,
      'Ringkasan Produk': itemsSummary,
      'Subtotal (Rp)': Math.round(Number(o.subtotal) || 0),
      'Diskon (Rp)': Math.round(Number(o.discount_amount) || 0),
      'Ongkir (Rp)': Math.round(Number(o.shipping_cost) || 0),
      'Biaya Lainnya (Rp)': Math.round(Number(o.other_fees) || 0),
      'Total Transaksi (Rp)': grandTotal,
      'Nominal Terbayar (Rp)': amountPaid,
      'Sisa Tagihan (Rp)': outstanding,
    }
  })
}

/**
 * Builds rows for Itemized Detail (Sheet 2: 1 row per product item)
 */
export function buildOrderItemRows(orders: any[], timezone: string = DEFAULT_TIMEZONE) {
  const rows: any[] = []

  orders.forEach(o => {
    const payStatusLabel = 
      o.payment_status === 'paid' ? 'Lunas' :
      o.payment_status === 'partial' ? 'Sebagian / DP' : 'Belum Bayar'

    const items = Array.isArray(o.items_json) && o.items_json.length > 0 ? o.items_json : []

    if (items.length === 0) {
      // If no items_json recorded, create a placeholder row
      rows.push({
        'No. Pesanan': String(o.order_number || o.id || '-'),
        'Tanggal Transaksi': o.order_date ? formatDisplayDate(o.order_date, 'full', timezone) : '-',
        'Platform': o.source_platform || 'Manual',
        'Nama Pelanggan': o.customer?.name || 'Tanpa Nama',
        'No. WhatsApp / HP': o.customer?.phone ? String(o.customer.phone) : '-',
        'SKU Produk': '-',
        'Nama Produk': 'Tanpa Rincian Produk',
        'Variasi / Modifiers': '-',
        'Qty': Number(o.total_qty) || 1,
        'Harga Satuan (Rp)': Math.round(Number(o.subtotal) || 0),
        'Subtotal Item (Rp)': Math.round(Number(o.subtotal) || 0),
        'Diskon Item (Rp)': Math.round(Number(o.discount_amount) || 0),
        'Total Item (Rp)': Math.round(Number(o.grand_total) || 0),
        'Status Pesanan': o.status || '-',
        'Status Pembayaran': payStatusLabel,
      })
      return
    }

    items.forEach((item: any) => {
      const qty = Number(item.quantity) || 1
      const price = Math.round(Number(item.price) || 0)
      const lineSubtotal = Math.round(Number(item.subtotal || (qty * price)))
      const lineTotal = Math.round(Number(item.total || (qty * price)))
      const lineDiscount = Math.max(0, lineSubtotal - lineTotal)

      // Variation info from variant_name or meta_data
      let variantDesc = item.variant_name || ''
      if (!variantDesc && Array.isArray(item.meta_data)) {
        variantDesc = item.meta_data
          .filter((m: any) => !m.key.startsWith('_'))
          .map((m: any) => `${m.display_key || m.key}: ${m.display_value || m.value}`)
          .join(', ')
      }

      rows.push({
        'No. Pesanan': String(o.order_number || o.id || '-'),
        'Tanggal Transaksi': o.order_date ? formatDisplayDate(o.order_date, 'full', timezone) : '-',
        'Platform': o.source_platform || 'Manual',
        'Nama Pelanggan': o.customer?.name || 'Tanpa Nama',
        'No. WhatsApp / HP': o.customer?.phone ? String(o.customer.phone) : '-',
        'SKU Produk': item.sku || '-',
        'Nama Produk': item.name || '-',
        'Variasi / Modifiers': variantDesc || '-',
        'Qty': qty,
        'Harga Satuan (Rp)': price,
        'Subtotal Item (Rp)': lineSubtotal,
        'Diskon Item (Rp)': lineDiscount,
        'Total Item (Rp)': lineTotal,
        'Status Pesanan': o.status || '-',
        'Status Pembayaran': payStatusLabel,
      })
    })
  })

  return rows
}

/**
 * Calculates responsive column widths for an XLSX worksheet.
 */
function calculateColumnWidths(data: Record<string, any>[]): { wch: number }[] {
  if (!data || data.length === 0) return []

  const keys = Object.keys(data[0])
  return keys.map(key => {
    let maxLen = key.length
    for (let i = 0; i < Math.min(data.length, 500); i++) {
      const val = data[i][key]
      if (val !== null && val !== undefined) {
        const strVal = String(val)
        if (strVal.length > maxLen) {
          maxLen = Math.min(strVal.length, 60) // cap maximum width at 60 characters
        }
      }
    }
    return { wch: Math.max(maxLen + 3, 10) }
  })
}

/**
 * Executes the file generation and triggers the browser download.
 */
export function exportOrdersToFile({
  orders,
  format,
  layout,
  fileName,
  timezone = DEFAULT_TIMEZONE,
}: OrderExportOptions) {
  if (!orders || orders.length === 0) {
    throw new Error('Tidak ada data pesanan untuk diekspor')
  }

  const wb = XLSX.utils.book_new()

  if (format === 'csv') {
    // CSV format is single-sheet
    const rows = layout === 'items' 
      ? buildOrderItemRows(orders, timezone)
      : buildOrderSummaryRows(orders, timezone)

    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, 'Orders')
    XLSX.writeFile(wb, fileName.endsWith('.csv') ? fileName : `${fileName}.csv`, { bookType: 'csv' })
    return
  }

  // Excel (.xlsx) format
  if (layout === 'multisheet') {
    // Sheet 1: Ringkasan Pesanan
    const summaryRows = buildOrderSummaryRows(orders, timezone)
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
    wsSummary['!cols'] = calculateColumnWidths(summaryRows)
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Pesanan')

    // Sheet 2: Rincian Produk
    const itemRows = buildOrderItemRows(orders, timezone)
    const wsItems = XLSX.utils.json_to_sheet(itemRows)
    wsItems['!cols'] = calculateColumnWidths(itemRows)
    XLSX.utils.book_append_sheet(wb, wsItems, 'Rincian Produk')
  } else if (layout === 'items') {
    const itemRows = buildOrderItemRows(orders, timezone)
    const wsItems = XLSX.utils.json_to_sheet(itemRows)
    wsItems['!cols'] = calculateColumnWidths(itemRows)
    XLSX.utils.book_append_sheet(wb, wsItems, 'Rincian Produk')
  } else {
    // layout === 'summary'
    const summaryRows = buildOrderSummaryRows(orders, timezone)
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
    wsSummary['!cols'] = calculateColumnWidths(summaryRows)
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Pesanan')
  }

  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`, { bookType: 'xlsx' })
}
