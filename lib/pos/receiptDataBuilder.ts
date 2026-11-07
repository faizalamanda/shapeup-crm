// ShapeUp POS Unified Receipt Data Builder (Single Source of Truth)
import { ReceiptData, ReceiptItem, ReceiptLoyaltyInfo, PaperSize } from './printerAdapter'
import { getStoredReceiptSettings, ReceiptSettings } from './receiptSettings'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'

export interface ReceiptBuildOptions {
  businessName?: string
  settings?: ReceiptSettings
  cashierName?: string
  timezone?: string
  payments?: any[]
  loyaltyInfo?: ReceiptLoyaltyInfo
  orderNote?: string
  paperSize?: PaperSize
  cashReceived?: number
  changeAmount?: number
}

/**
 * Universal Receipt Data Builder:
 * Takes any order representation (Checkout payload, Supabase order row, Order History modal, etc.)
 * and normalizes it into a complete, consistent ReceiptData structure.
 */
export function buildReceiptDataFromOrder(order: any, options: ReceiptBuildOptions = {}): ReceiptData {
  const businessName = options.businessName || order.business_name || 'ShapeUp Store'
  const settings = options.settings || getStoredReceiptSettings(businessName)
  const timezone = options.timezone || DEFAULT_TIMEZONE

  // 1. Items Normalization
  let rawItems: any[] = []
  if (Array.isArray(order.items)) {
    rawItems = order.items
  } else if (Array.isArray(order.items_json)) {
    rawItems = order.items_json
  } else if (Array.isArray(order.line_items)) {
    rawItems = order.line_items
  } else if (typeof order.items_json === 'string') {
    try {
      const parsed = JSON.parse(order.items_json)
      if (Array.isArray(parsed)) rawItems = parsed
    } catch {
      rawItems = []
    }
  }

  const items: ReceiptItem[] = rawItems.map((item: any) => {
    const qty = Number(item.quantity || item.qty || 1)
    const price = Number(item.price || item.finalPrice || 0)
    const subtotal = Number(item.subtotal || item.total || (price * qty))

    const rawName = item.name || item.product_name || item.product?.name || 'Produk'
    const variantStr = (item.variant || item.variant_name || item.selectedVariant?.name || '').trim()

    // Format nama produk flat / tidak bertingkat (Nama Produk - Varian)
    const displayName = (variantStr && !rawName.toLowerCase().includes(variantStr.toLowerCase()))
      ? `${rawName} - ${variantStr}`
      : rawName

    let itemNote = item.note || item.item_note || undefined
    if (item.dimension_spec && item.dimension_spec.billable_area) {
      const areaNote = `Luas: ${item.dimension_spec.billable_area} ${item.dimension_spec.area_unit}`
      itemNote = itemNote ? `${areaNote} • ${itemNote}` : areaNote
    }

    return {
      name: displayName,
      variant: undefined, // Dikosongkan agar cetak struk flat / tidak bertingkat
      quantity: qty,
      price: price,
      subtotal: subtotal,
      discount: Number(item.discount || 0),
      note: itemNote
    }
  })

  // 2. Customer Normalization
  let customerName: string = 'Pelanggan Walk-in'
  if (order.customer) {
    if (Array.isArray(order.customer)) {
      customerName = order.customer[0]?.name || 'Pelanggan Walk-in'
    } else if (typeof order.customer === 'object') {
      customerName = order.customer.name || 'Pelanggan Walk-in'
    } else if (typeof order.customer === 'string') {
      customerName = order.customer
    }
  } else if (order.customer_name) {
    customerName = order.customer_name
  }

  // 3. Raw Source Data & Notes
  const raw = order.raw_source_data || {}
  const extractedNote = (
    options.orderNote ||
    order.order_note ||
    order.orderNote ||
    order.customer_note ||
    order.notes ||
    raw.customer_note ||
    raw.notes ||
    raw.order_note ||
    ''
  ).trim()

  // 4. Financial Calculations & Piutang / Settlement
  const grandTotal = Number(order.grand_total ?? order.total ?? 0)
  const isCompleted = order.status === 'completed'
  const isCancelled = order.status === 'cancelled'
  const amountPaid = Number(order.amount_paid ?? (isCompleted && !isCancelled ? grandTotal : 0))
  const outstandingAmount = Math.max(0, grandTotal - amountPaid)
  const paymentStatus: 'paid' | 'partial' | 'unpaid' =
    order.payment_status || (outstandingAmount <= 0.01 ? 'paid' : (amountPaid > 0 ? 'partial' : 'unpaid'))

  const discountTotal = Number(order.discount_amount || order.discount_total || 0)
  const taxTotal = Number(order.tax_total || order.tax_amount || 0)
  const subtotal = Number(order.subtotal || (grandTotal + discountTotal - taxTotal))

  // 5. Cash Received & Change Calculations
  let cashReceived = options.cashReceived !== undefined ? options.cashReceived : (raw.cash_received ? Number(raw.cash_received) : undefined)
  let changeAmount = options.changeAmount !== undefined ? options.changeAmount : (raw.change_amount ? Number(raw.change_amount) : undefined)

  const effectivePayments = options.payments || order.payments || raw.payments || []
  if (Array.isArray(effectivePayments) && effectivePayments.length > 0) {
    const cashPay = effectivePayments.slice().reverse().find(
      (p: any) => (p.payment_kind === 'payment' || !p.payment_kind) &&
                  (String(p.payment_method).toLowerCase() === 'cash' || String(p.payment_method).toLowerCase() === 'tunai')
    )
    if (cashPay) {
      cashReceived = Number(cashPay.cash_received || cashPay.amount || cashReceived || 0)
      changeAmount = Number(cashPay.change_amount || changeAmount || 0)
    }
  }

  const paymentMethod = order.payment_method || (effectivePayments.length > 1 ? 'Multi-Tender' : 'Tunai')

  // 6. Date Resolution
  const dateStr = formatDisplayDate(order.created_at || order.order_date || new Date(), 'receipt', timezone)

  return {
    businessName: settings.storeName || businessName,
    businessAddress: settings.address || undefined,
    businessPhone: settings.phone || undefined,
    orderNumber: order.order_number || order.orderNumber || 'POS-ORDER',
    date: dateStr,
    cashierName: options.cashierName || order.cashier_name || 'Kasir',
    customerName: customerName,
    queueNumber: order.queue_number || raw.queue_number || (options as any).queueNumber,
    showQueueNumber: Boolean(settings.showQueueNumber),
    showItemNumbering: settings.showItemNumbering,
    loyaltyInfo: settings.showLoyaltyPoints && options.loyaltyInfo ? options.loyaltyInfo : undefined,
    items: items,
    subtotal: subtotal,
    discountTotal: discountTotal,
    taxTotal: taxTotal,
    grandTotal: grandTotal,
    paymentMethod: paymentMethod,
    cashReceived: cashReceived && cashReceived > 0 ? cashReceived : undefined,
    changeAmount: changeAmount && changeAmount > 0 ? changeAmount : undefined,
    amountPaid: amountPaid,
    outstandingAmount: outstandingAmount,
    paymentStatus: paymentStatus,
    note: settings.footerNote || undefined,
    orderNote: extractedNote || undefined,
    paperSize: options.paperSize || settings.paperSize || '58mm'
  }
}

/**
 * Builds a realistic sample receipt for Live Preview (ReceiptSettingsModal).
 */
export function buildSampleReceiptData(settings: ReceiptSettings): ReceiptData {
  return {
    businessName: settings.storeName || 'NAMA TOKO',
    businessAddress: settings.address || 'Jl. Bisnis Ritel No. 12, Jakarta',
    businessPhone: settings.phone || '0812-3456-7890',
    orderNumber: `POS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-0042`,
    date: formatDisplayDate(new Date(), 'receipt', DEFAULT_TIMEZONE),
    cashierName: 'Faiz Jazuli',
    customerName: 'Budi Santoso (Member)',
    queueNumber: 42,
    showQueueNumber: Boolean(settings.showQueueNumber),
    showItemNumbering: settings.showItemNumbering,
    loyaltyInfo: settings.showLoyaltyPoints ? {
      tierName: 'Gold Member',
      tierBadge: '🥇',
      pointsEarned: 29,
      currentBalance: 340
    } : undefined,
    items: [
      {
        name: 'Kemeja Oxford Slimfit',
        variant: 'Putih / L',
        quantity: 1,
        price: 175000,
        subtotal: 175000,
        note: 'Bungkus plastik rapi terpisah'
      },
      {
        name: 'Kaos Polos Combed 30s',
        variant: 'Hitam / XL',
        quantity: 2,
        price: 65000,
        subtotal: 130000
      }
    ],
    subtotal: 305000,
    discountTotal: 15000,
    taxTotal: 0,
    grandTotal: 290000,
    paymentMethod: 'TUNAI',
    cashReceived: 300000,
    changeAmount: 10000,
    amountPaid: 290000,
    outstandingAmount: 0,
    paymentStatus: 'paid',
    orderNote: 'Meja 04 - Bawa pulang, titip kasir diambil jam 17:00',
    note: settings.footerNote || 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar/dikembalikan.',
    paperSize: settings.paperSize || '58mm'
  }
}

/**
 * Builds dedicated ReceiptData for a POS Sales Return / Exchange document (Credit Note).
 */
export function buildReturnReceiptData(
  order: any,
  returnDoc: any,
  options: ReceiptBuildOptions = {}
): ReceiptData {
  const businessName = options.businessName || order.business_name || 'ShapeUp Store'
  const settings = options.settings || getStoredReceiptSettings(businessName)
  const timezone = options.timezone || DEFAULT_TIMEZONE

  const isExchange = returnDoc.return_kind === 'exchange' || Boolean(returnDoc.exchange_total > 0)
  const receiptTitle = isExchange ? 'NOTA PENUKARAN BARANG' : 'NOTA RETUR PENJUALAN'

  // Items: returned items + exchange items
  const receiptItems: ReceiptItem[] = []

  const returnItems = returnDoc.items || returnDoc.pos_return_items || []
  returnItems.forEach((item: any) => {
    const rawName = item.name || 'Produk'
    const variantStr = (item.variant_name || '').trim()
    const displayName = variantStr && !rawName.toLowerCase().includes(variantStr.toLowerCase())
      ? `[RETUR] ${rawName} - ${variantStr}`
      : `[RETUR] ${rawName}`

    receiptItems.push({
      name: displayName,
      quantity: Math.abs(Number(item.qty || 1)),
      price: Number(item.unit_net_price || item.price || 0),
      subtotal: -Math.abs(Number(item.line_refund || (Number(item.unit_net_price || 0) * Number(item.qty || 1)))),
      note: item.disposition ? `Kondisi: ${item.disposition}` : undefined
    })
  })

  const exchangeItems = returnDoc.exchange_items || []
  exchangeItems.forEach((ex: any) => {
    const rawName = ex.name || 'Produk Pengganti'
    const variantStr = (ex.variantName || ex.variant_name || '').trim()
    const displayName = variantStr && !rawName.toLowerCase().includes(variantStr.toLowerCase())
      ? `[PENGGANTI] ${rawName} - ${variantStr}`
      : `[PENGGANTI] ${rawName}`

    receiptItems.push({
      name: displayName,
      quantity: Math.abs(Number(ex.quantity || 1)),
      price: Number(ex.unitPrice || ex.price || 0),
      subtotal: Math.abs(Number((ex.unitPrice || ex.price || 0) * (ex.quantity || 1)))
    })
  })

  // Customer name
  let customerName = 'Pelanggan Walk-in'
  if (order.customer?.name) customerName = order.customer.name
  else if (order.customer_name) customerName = order.customer_name

  const settlement = returnDoc.settlement_json || {}
  const refundLines = settlement.refund_lines || []
  const refundBreakdown = refundLines.map((l: any) => ({
    method: String(l.label || l.method || 'Refund').toUpperCase(),
    amount: Number(l.amount || 0)
  }))

  const dateStr = formatDisplayDate(returnDoc.created_at || new Date(), 'receipt', timezone)

  return {
    businessName: settings.storeName || businessName,
    businessAddress: settings.address || undefined,
    businessPhone: settings.phone || undefined,
    receiptTitle,
    returnNumber: returnDoc.return_number,
    originalOrderNumber: order.order_number || 'POS-ORDER',
    orderNumber: returnDoc.return_number,
    returnReason: returnDoc.reason_note
      ? `${returnDoc.reason_code} (${returnDoc.reason_note})`
      : returnDoc.reason_code,
    date: dateStr,
    cashierName: returnDoc.cashier_name || options.cashierName || 'Kasir',
    customerName,
    showItemNumbering: false,
    items: receiptItems,
    subtotal: Number(returnDoc.gross_refund || 0),
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: Number(returnDoc.refund_total || returnDoc.credit_value || 0),
    paymentMethod: refundBreakdown.length > 0 ? refundBreakdown.map((r: any) => r.method).join(', ') : 'REFUND',
    refundBreakdown,
    note: settings.footerNote || 'Nota bukti retur / penukaran barang resmi.',
    paperSize: options.paperSize || settings.paperSize || '58mm'
  }
}

/**
 * Builds dedicated ReceiptData for a Held Order (Bill Sementara / Pre-bill).
 */
export function buildHoldOrderReceiptData(
  heldOrder: any,
  options: ReceiptBuildOptions = {}
): ReceiptData {
  const businessName = options.businessName || 'ShapeUp Store'
  const settings = options.settings || getStoredReceiptSettings(businessName)
  const timezone = options.timezone || DEFAULT_TIMEZONE

  // Extract raw items from cart_json
  let rawItems: any[] = []
  if (Array.isArray(heldOrder.cart_json)) {
    rawItems = heldOrder.cart_json
  } else if (typeof heldOrder.cart_json === 'string') {
    try {
      const parsed = JSON.parse(heldOrder.cart_json)
      if (Array.isArray(parsed)) rawItems = parsed
    } catch {
      rawItems = []
    }
  }

  const receiptItems: ReceiptItem[] = rawItems.map((item: any) => {
    const qty = Number(item.quantity || item.qty || 1)
    const price = Number(item.price || item.finalPrice || 0)
    const subtotal = Number(item.subtotal || item.total || (price * qty))

    const rawName = item.name || item.product_name || item.product?.name || 'Produk'
    const variantStr = (item.variant || item.variant_name || item.selectedVariant?.name || '').trim()

    const displayName = (variantStr && !rawName.toLowerCase().includes(variantStr.toLowerCase()))
      ? `${rawName} - ${variantStr}`
      : rawName

    let itemNote = item.note || item.item_note || undefined
    if (item.dimension_spec && item.dimension_spec.billable_area) {
      const areaNote = `Luas: ${item.dimension_spec.billable_area} ${item.dimension_spec.area_unit}`
      itemNote = itemNote ? `${areaNote} • ${itemNote}` : areaNote
    }

    return {
      name: displayName,
      quantity: qty,
      price: price,
      subtotal: subtotal,
      discount: Number(item.discount || 0),
      note: itemNote
    }
  })

  const calculatedSubtotal = receiptItems.reduce((acc, it) => acc + (it.subtotal || 0), 0)
  const grandTotal = Number(heldOrder.grand_total ?? calculatedSubtotal)
  const discountTotal = Math.max(0, calculatedSubtotal - grandTotal)
  const shortId = (heldOrder.id || '').slice(0, 6).toUpperCase()

  return {
    businessName: settings.storeName || businessName,
    businessAddress: settings.address || undefined,
    businessPhone: settings.phone || undefined,
    receiptTitle: 'BILL SEMENTARA (PRE-BILL)',
    orderNumber: `#HLD-${shortId}`,
    orderNumberLabel: 'No. Nota Hold:',
    date: formatDisplayDate(heldOrder.created_at || new Date(), 'receipt', timezone),
    cashierName: options.cashierName || 'Kasir',
    customerName: heldOrder.customer_name || 'Pelanggan Walk-in',
    showItemNumbering: true,
    items: receiptItems,
    subtotal: calculatedSubtotal,
    discountTotal: discountTotal,
    taxTotal: 0,
    grandTotal: grandTotal,
    paymentMethod: 'Belum Dibayar (Draft)',
    paymentStatus: 'unpaid',
    orderNote: heldOrder.note ? String(heldOrder.note).trim() : undefined,
    note: '* INI BUKAN BUKTI PEMBAYARAN SAH *\nSilakan bawa nota ini ke kasir untuk menyelesaikan pembayaran.',
    paperSize: options.paperSize || settings.paperSize || '58mm'
  }
}

/**
 * Builds dedicated ReceiptData for a Batch Summary of all Held Orders (Rekap Pesanan Ditahan).
 */
export function buildHeldOrdersSummaryReceiptData(
  heldOrders: any[],
  options: ReceiptBuildOptions = {}
): ReceiptData {
  const businessName = options.businessName || 'ShapeUp Store'
  const settings = options.settings || getStoredReceiptSettings(businessName)
  const timezone = options.timezone || DEFAULT_TIMEZONE

  const totalHeldCount = heldOrders.length
  const totalAmount = heldOrders.reduce((sum, h) => sum + Number(h.grand_total || 0), 0)

  const items: ReceiptItem[] = heldOrders.map((h: any) => {
    const shortId = `#HLD-${(h.id || '').slice(0, 6).toUpperCase()}`
    const cust = h.customer_name || 'Walk-in'
    const itemCount = h.total_items || (Array.isArray(h.cart_json) ? h.cart_json.length : 1)
    const timeStr = formatDisplayDate(h.created_at, 'time', timezone)
    const noteStr = h.note ? ` | Note: ${h.note}` : ''

    return {
      name: `${shortId} - ${cust}`,
      variant: `${timeStr} (${itemCount} item)${noteStr}`,
      quantity: 1,
      price: Number(h.grand_total || 0),
      subtotal: Number(h.grand_total || 0)
    }
  })

  return {
    businessName: settings.storeName || businessName,
    businessAddress: settings.address || undefined,
    businessPhone: settings.phone || undefined,
    receiptTitle: 'DAFTAR TRANSAKSI DITAHAN (REKAP)',
    orderNumber: `REKAP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    orderNumberLabel: 'No. Rekap:',
    date: formatDisplayDate(new Date(), 'receipt', timezone),
    cashierName: options.cashierName || 'Kasir',
    customerName: `${totalHeldCount} Pesanan Ditahan`,
    showItemNumbering: true,
    items: items,
    subtotal: totalAmount,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: totalAmount,
    paymentMethod: 'DRAFT / HOLD',
    paymentStatus: 'unpaid',
    note: 'Laporan audit internal kasir.\nHarap periksa dan selesaikan pesanan tertahan sebelum pergantian/penutupan shift.',
    paperSize: options.paperSize || settings.paperSize || '58mm'
  }
}

