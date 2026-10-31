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

    return {
      name: displayName,
      variant: undefined, // Dikosongkan agar cetak struk flat / tidak bertingkat
      quantity: qty,
      price: price,
      subtotal: subtotal,
      discount: Number(item.discount || 0),
      note: item.note || item.item_note || undefined
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
    orderNumber: 'POS-20261023-001',
    date: formatDisplayDate(new Date(), 'receipt', DEFAULT_TIMEZONE),
    cashierName: 'Faiz Jazuli',
    customerName: 'Budi Santoso (Member)',
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
