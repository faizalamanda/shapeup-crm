import * as XLSX from 'xlsx'
import { DEFAULT_TIMEZONE } from '@/lib/timeUtils'

export interface OrderExportOptions {
  orders: any[]
  format: 'xlsx' | 'csv'
  layout: 'multisheet' | 'summary' | 'items'
  fileName: string
  timezone?: string
}

/**
 * Formats a date into ISO-compliant date (YYYY-MM-DD) and time (HH:mm:ss) strings
 * based on the business timezone. This guarantees unambiguous date filtering in Excel
 * and chronological sorting matching ISO 8601 & Kimball dimensional standards.
 */
export function formatExportDateTime(
  dateInput?: string | Date | null,
  timezone: string = DEFAULT_TIMEZONE
): { date: string; time: string } {
  if (!dateInput) return { date: '-', time: '-' }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(d.getTime())) return { date: '-', time: '-' }

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d)

    const year = parts.find(p => p.type === 'year')?.value || '0000'
    const month = parts.find(p => p.type === 'month')?.value || '00'
    const day = parts.find(p => p.type === 'day')?.value || '00'
    const hour = parts.find(p => p.type === 'hour')?.value || '00'
    const minute = parts.find(p => p.type === 'minute')?.value || '00'
    const second = parts.find(p => p.type === 'second')?.value || '00'

    return {
      date: `${year}-${month}-${day}`, // YYYY-MM-DD
      time: `${hour}:${minute}:${second}`, // HH:mm:ss
    }
  } catch (e) {
    const iso = d.toISOString()
    return {
      date: iso.slice(0, 10),
      time: iso.slice(11, 19),
    }
  }
}

/**
 * Resolves the creator / operator attribution label for an order.
 * - POS: Returns cashier name (e.g. 'Kasir 1')
 * - Invoice / Manual: Returns user full_name or email
 * - Integrations: Returns 'Sistem (WooCommerce)', 'Sistem (Accurate Online)', etc.
 * - Fallback: Returns 'Sistem'
 */
export function resolveOrderCreator(o: any): string {
  if (o.created_by && typeof o.created_by === 'string' && o.created_by.trim() !== '') {
    return o.created_by.trim()
  }

  // POS Cashier check
  if (o.cashier_name && typeof o.cashier_name === 'string' && o.cashier_name.trim() !== '') {
    return o.cashier_name.trim()
  }
  if (o.raw_source_data?.cashier_name && typeof o.raw_source_data.cashier_name === 'string') {
    return o.raw_source_data.cashier_name.trim()
  }

  // Profile User check
  const profileName = o.creator?.full_name || o.creator?.email || o.user?.full_name || o.user?.email
  if (profileName && typeof profileName === 'string' && profileName.trim() !== '') {
    return profileName.trim()
  }

  // Integration Platform check
  const platform = String(o.source_platform || '').trim()
  const lowerPlat = platform.toLowerCase()
  if (lowerPlat && !['manual', 'pos', 'invoice'].includes(lowerPlat)) {
    return `Sistem (${platform})`
  }

  return 'Sistem'
}

/**
 * Builds rows for Order Summary (Sheet 1: 1 row per order)
 * Separates SKU and Product Name into distinct columns with synchronized multi-line wrap (\n).
 */
export function buildOrderSummaryRows(orders: any[], timezone: string = DEFAULT_TIMEZONE) {
  return orders.map(o => {
    const grandTotal = Math.round(Number(o.grand_total) || 0)
    const amountPaid = Math.round(Number(o.amount_paid) || 0)
    const outstanding = Math.max(0, grandTotal - amountPaid)

    const payStatusLabel = 
      o.payment_status === 'paid' ? 'Lunas' :
      o.payment_status === 'partial' ? 'Sebagian / DP' : 'Belum Bayar'

    const { date, time } = formatExportDateTime(o.order_date, timezone)

    // Parse items into separate multi-line SKU and Product Name columns
    const items = Array.isArray(o.items_json) && o.items_json.length > 0 ? o.items_json : []
    
    let skuSummary = '-'
    let productsSummary = 'Tanpa Rincian Produk'

    if (items.length > 0) {
      skuSummary = items.map((item: any) => {
        const sku = (item.sku && String(item.sku).trim() !== '') ? String(item.sku).trim() : '-'
        return sku
      }).join('\n')

      productsSummary = items.map((item: any) => {
        const qty = Number(item.quantity) || 1
        let variantDesc = item.variant_name || ''
        if (!variantDesc && Array.isArray(item.meta_data)) {
          variantDesc = item.meta_data
            .filter((m: any) => !m.key.startsWith('_'))
            .map((m: any) => `${m.display_key || m.key}: ${m.display_value || m.value}`)
            .join(', ')
        }
        const variantSuffix = variantDesc ? ` [${variantDesc}]` : ''
        return `${qty}x ${item.name || '-'}${variantSuffix}`
      }).join('\n')
    }

    // Resolve address from customer or raw_source_data
    const shipping = o.raw_source_data?.shipping
    const rawAddress = shipping
      ? [shipping.address_1, shipping.address_2, shipping.city, shipping.state, shipping.postcode].filter(Boolean).join(', ')
      : ''
    const resolvedAddress = o.customer?.address || rawAddress || '-'

    return {
      'No. Pesanan': String(o.order_number || o.id || '-'),
      'Tanggal': date,
      'Waktu': time,
      'Platform': o.source_platform || 'Manual',
      'Dibuat Oleh': resolveOrderCreator(o),
      'Status Pesanan': o.status || '-',
      'Status Pembayaran': payStatusLabel,
      'Metode Pembayaran': o.payment_method || '-',
      'Nama Pelanggan': o.customer?.name || 'Tanpa Nama',
      'No. WhatsApp / HP': o.customer?.phone ? String(o.customer.phone) : (shipping?.phone ? String(shipping.phone) : '-'),
      'Email Pelanggan': o.customer?.email || o.raw_source_data?.billing?.email || '-',
      'Alamat Pengiriman': resolvedAddress,
      'Kota / Kabupaten': shipping?.city || '-',
      'SKU Produk': skuSummary,
      'Nama Produk': productsSummary,
      'Total Qty': Number(o.total_qty) || 0,
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

    const { date, time } = formatExportDateTime(o.order_date, timezone)
    const items = Array.isArray(o.items_json) && o.items_json.length > 0 ? o.items_json : []

    if (items.length === 0) {
      // If no items_json recorded, create a placeholder row
      rows.push({
        'No. Pesanan': String(o.order_number || o.id || '-'),
        'Tanggal': date,
        'Waktu': time,
        'Platform': o.source_platform || 'Manual',
        'Dibuat Oleh': resolveOrderCreator(o),
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
        'Tanggal': date,
        'Waktu': time,
        'Platform': o.source_platform || 'Manual',
        'Dibuat Oleh': resolveOrderCreator(o),
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
 * Splits multi-line strings by \n so individual line lengths govern column widths.
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
        if (strVal.includes('\n')) {
          const lines = strVal.split('\n')
          for (const line of lines) {
            if (line.length > maxLen) {
              maxLen = Math.min(line.length, 60)
            }
          }
        } else {
          if (strVal.length > maxLen) {
            maxLen = Math.min(strVal.length, 60) // cap maximum width at 60 characters
          }
        }
      }
    }
    return { wch: Math.max(maxLen + 3, 10) }
  })
}

/**
 * Calculates row heights based on the maximum number of multi-line items.
 * Ensures Excel displays wrapped lines with adequate vertical breathing room.
 */
function calculateRowHeights(data: Record<string, any>[]): { hpt: number }[] {
  if (!data || data.length === 0) return []
  
  // Row 0 is header row
  const rows: { hpt: number }[] = [{ hpt: 24 }]
  for (let i = 0; i < data.length; i++) {
    const item = data[i]
    let maxLines = 1
    for (const key of Object.keys(item)) {
      const val = item[key]
      if (typeof val === 'string' && val.includes('\n')) {
        const count = val.split('\n').length
        if (count > maxLines) {
          maxLines = count
        }
      }
    }
    rows.push({ hpt: Math.max(20, maxLines * 18) })
  }
  return rows
}

/**
 * Enriches worksheet cells with wrapText alignment and styling for multi-line cells.
 */
function applyWorksheetStyles(ws: XLSX.WorkSheet) {
  if (!ws || !ws['!ref']) return

  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = ws[cellAddress]
      if (!cell) continue

      if (R === 0) {
        cell.s = {
          font: { bold: true },
          alignment: { vertical: 'center', horizontal: 'center' }
        }
      } else {
        if (typeof cell.v === 'string' && cell.v.includes('\n')) {
          cell.s = {
            alignment: { wrapText: true, vertical: 'top' }
          }
        }
      }
    }
  }
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
    // Sheet 1: Ringkasan Pesanan (1 baris per order, multi-line SKU/Produk)
    const summaryRows = buildOrderSummaryRows(orders, timezone)
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
    wsSummary['!cols'] = calculateColumnWidths(summaryRows)
    wsSummary['!rows'] = calculateRowHeights(summaryRows)
    applyWorksheetStyles(wsSummary)
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Pesanan')

    // Sheet 2: Rincian Produk (1NF Tidy Data per item)
    const itemRows = buildOrderItemRows(orders, timezone)
    const wsItems = XLSX.utils.json_to_sheet(itemRows)
    wsItems['!cols'] = calculateColumnWidths(itemRows)
    wsItems['!rows'] = calculateRowHeights(itemRows)
    applyWorksheetStyles(wsItems)
    XLSX.utils.book_append_sheet(wb, wsItems, 'Rincian Produk')
  } else if (layout === 'items') {
    const itemRows = buildOrderItemRows(orders, timezone)
    const wsItems = XLSX.utils.json_to_sheet(itemRows)
    wsItems['!cols'] = calculateColumnWidths(itemRows)
    wsItems['!rows'] = calculateRowHeights(itemRows)
    applyWorksheetStyles(wsItems)
    XLSX.utils.book_append_sheet(wb, wsItems, 'Rincian Produk')
  } else {
    // layout === 'summary'
    const summaryRows = buildOrderSummaryRows(orders, timezone)
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
    wsSummary['!cols'] = calculateColumnWidths(summaryRows)
    wsSummary['!rows'] = calculateRowHeights(summaryRows)
    applyWorksheetStyles(wsSummary)
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Pesanan')
  }

  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`, { bookType: 'xlsx' })
}

