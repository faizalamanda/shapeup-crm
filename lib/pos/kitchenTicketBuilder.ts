// ShapeUp POS Kitchen Production Ticket Builder & Multi-Station Dispatcher
import { PaperSize } from './printerAdapter'
import {
  KitchenStationId,
  KitchenSettings,
  getStoredKitchenSettings,
  resolveItemStation,
  KITCHEN_STATIONS
} from './kitchenSettings'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'

export interface KitchenTicketItem {
  name: string
  variant?: string
  quantity: number
  modifiers?: Array<{ group?: string; option: string }>
  note?: string
  station: KitchenStationId
}

export interface KitchenTicketData {
  stationId: KitchenStationId
  stationName: string
  stationLabel: string
  stationIcon: string
  businessName: string
  orderNumber: string
  ticketNumber?: string
  queueNumber?: string | number
  tableNumber?: string
  orderType: 'DINE-IN' | 'TAKEAWAY' | 'DELIVERY'
  timestamp: string
  cashierOrServer: string
  customerName?: string
  globalOrderNote?: string
  items: KitchenTicketItem[]
  paperSize: PaperSize
  isReprint?: boolean
  ticketKind?: 'NEW' | 'ADD-ON' | 'HOLD'
  printerDeviceId?: string | null
  printerConnectionType?: 'same_as_cashier' | 'system' | 'bluetooth' | 'lan'
  printerName?: string | null
  soundBuzzer?: boolean
  autoCut?: boolean
}

/**
 * Intelligent regex to extract Table Number from order note strings.
 * Matches patterns like:
 * - "Meja 04", "Meja 12", "Meja VIP"
 * - "Table 3", "T-04"
 * - "Lt 2 Meja 5"
 */
export function extractTableNumber(note?: string): string | undefined {
  if (!note || typeof note !== 'string') return undefined
  const clean = note.trim()
  if (!clean) return undefined

  const patterns = [
    /(?:meja|table|m|tb)[\s.:#-]*([a-zA-Z0-9\s-]+?)(?:,|\.|\n|$|-(?!\d))/i,
    /(?:area|lantai|lt)[\s.:#-]*([0-9a-zA-Z]+[\s\w]*meja[\s.:#-]*[0-9a-zA-Z]+)/i
  ]

  for (const pat of patterns) {
    const match = clean.match(pat)
    if (match && match[1]) {
      const extracted = match[1].trim()
      // Guard against false positives like "makan" or full sentences
      if (extracted.length <= 20 && !extracted.toLowerCase().includes('bayar')) {
        return extracted.toUpperCase().startsWith('MEJA') ? extracted.toUpperCase() : `MEJA ${extracted.toUpperCase()}`
      }
    }
  }

  return undefined
}

export interface BuildKitchenTicketOptions {
  businessName?: string
  settings?: KitchenSettings
  fallbackPaperSize?: PaperSize
  cashierName?: string
  timezone?: string
  isReprint?: boolean
  ticketKind?: 'NEW' | 'ADD-ON' | 'HOLD'
  tableNumber?: string
  queueNumber?: string | number
  globalOrderNote?: string
}

/**
 * Builds separate KitchenTicketData for each production station (e.g. Dapur Makanan & Bar Minuman),
 * or 1 unified ticket if separateStations is disabled.
 */
export function buildKitchenTicketsFromItems(
  rawItems: any[],
  baseOrderInfo: {
    orderNumber?: string
    customerName?: string
    orderNote?: string
    queueNumber?: string | number
    createdAt?: string | Date
    orderType?: string
  },
  options: BuildKitchenTicketOptions = {}
): KitchenTicketData[] {
  const settings = options.settings || getStoredKitchenSettings(options.fallbackPaperSize || '58mm')
  const businessName = options.businessName || 'ShapeUp F&B'
  const timezone = options.timezone || DEFAULT_TIMEZONE
  const effectivePaperSize = options.fallbackPaperSize || settings.paperSize || '58mm'

  const extractedNote = (
    options.globalOrderNote ||
    baseOrderInfo.orderNote ||
    ''
  ).trim()

  const detectedTable = options.tableNumber || extractTableNumber(extractedNote)
  const effectiveQueue = options.queueNumber || baseOrderInfo.queueNumber
  const orderNumber = baseOrderInfo.orderNumber || 'POS-DRAFT'
  const dateStr = formatDisplayDate(baseOrderInfo.createdAt || new Date(), 'time', timezone) || new Date().toLocaleTimeString('id-ID')
  const orderType: 'DINE-IN' | 'TAKEAWAY' | 'DELIVERY' = (
    baseOrderInfo.orderType?.toUpperCase() === 'TAKEAWAY' || extractedNote.toLowerCase().includes('takeaway') || extractedNote.toLowerCase().includes('bungkus')
  ) ? 'TAKEAWAY' : 'DINE-IN'

  // 1. Normalize items and assign stations
  const normalizedItems: KitchenTicketItem[] = []

  for (const item of rawItems) {
    const qty = Number(item.quantity || item.qty || 1)
    if (qty <= 0) continue

    const rawName = item.name || item.product_name || item.product?.name || 'Item Menu'
    const variantStr = (item.variant || item.variant_name || item.selectedVariant?.name || '').trim()
    const displayName = (variantStr && !rawName.toLowerCase().includes(variantStr.toLowerCase()))
      ? `${rawName} - ${variantStr}`
      : rawName

    const station = resolveItemStation(item, settings.categoryStationMap)

    let modifiersList: Array<{ group?: string; option: string }> = []
    if (Array.isArray(item.selectedModifiers)) {
      modifiersList = item.selectedModifiers.map((m: any) => ({
        group: m.group_name || m.group,
        option: m.option_name || m.name || m.option || String(m)
      }))
    }

    normalizedItems.push({
      name: displayName,
      variant: undefined,
      quantity: qty,
      modifiers: modifiersList.length > 0 ? modifiersList : undefined,
      note: item.note || item.item_note || undefined,
      station
    })
  }

  if (normalizedItems.length === 0) {
    return []
  }

  // 2. Group items by station or keep combined
  if (!settings.separateStations) {
    // Single combined Kitchen Ticket
    return [{
      stationId: 'kitchen',
      stationName: 'Dapur & Bar',
      stationLabel: 'DAPUR & BAR',
      stationIcon: '🍳',
      businessName,
      orderNumber,
      queueNumber: effectiveQueue,
      tableNumber: detectedTable,
      orderType,
      timestamp: dateStr,
      cashierOrServer: options.cashierName || 'Kasir / Waiter',
      customerName: baseOrderInfo.customerName || 'Pelanggan',
      globalOrderNote: extractedNote || undefined,
      items: normalizedItems,
      paperSize: effectivePaperSize,
      isReprint: options.isReprint,
      ticketKind: options.ticketKind || 'NEW'
    }]
  }

  // Separate stations: Dapur Makanan vs Bar Minuman
  const tickets: KitchenTicketData[] = []
  const stationGroups: Record<KitchenStationId, KitchenTicketItem[]> = {
    kitchen: [],
    bar: []
  }

  for (const item of normalizedItems) {
    if (item.station === 'bar') {
      stationGroups.bar.push(item)
    } else {
      stationGroups.kitchen.push(item)
    }
  }

  for (const stDef of KITCHEN_STATIONS) {
    const stationItems = stationGroups[stDef.id]
    if (stationItems && stationItems.length > 0) {
      tickets.push({
        stationId: stDef.id,
        stationName: stDef.name,
        stationLabel: stDef.label,
        stationIcon: stDef.icon,
        businessName,
        orderNumber,
        queueNumber: effectiveQueue,
        tableNumber: detectedTable,
        orderType,
        timestamp: dateStr,
        cashierOrServer: options.cashierName || 'Kasir / Waiter',
        customerName: baseOrderInfo.customerName || 'Pelanggan',
        globalOrderNote: extractedNote || undefined,
        items: stationItems,
        paperSize: effectivePaperSize,
        isReprint: options.isReprint,
        ticketKind: options.ticketKind || 'NEW'
      })
    }
  }

  return tickets
}

function escapeHtml(str: string = ''): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Generates printer-ready, high-contrast HTML for Kitchen Chits (System Print & Live Preview).
 * Zero financial clutter: no prices, no taxes, no discounts.
 * Maximum font weight on items, notes, table numbers, and queue numbers.
 */
export function generateKitchenTicketHtml(ticket: KitchenTicketData): string {
  const is58mm = ticket.paperSize === '58mm'
  const pageSizeCss = is58mm ? '58mm auto' : '80mm auto'
  const containerWidth = is58mm ? '48mm' : '72mm'
  const fontSize = is58mm ? '12px' : '14px'
  const containerPadding = is58mm ? '2mm 1mm' : '4mm 2mm'

  const itemsHtml = ticket.items.map((item, idx) => {
    const numPrefix = `${idx + 1}. `
    const modifiersHtml = item.modifiers && item.modifiers.length > 0
      ? item.modifiers.map(m => `
          <div style="font-weight: 700; font-size: 0.9em; padding-left: 14px; margin-top: 2px; color: #000;">
            * ${escapeHtml(m.option.toUpperCase())}
          </div>
        `).join('')
      : ''

    const noteHtml = item.note
      ? `<div style="font-style: italic; font-weight: 700; font-size: 0.9em; padding-left: 14px; margin-top: 2px; border-left: 2px solid #000; margin-left: 4px; padding-left: 6px;">
           Note: ${escapeHtml(item.note)}
         </div>`
      : ''

    return `
      <div style="margin-bottom: 8px; border-bottom: 1px dotted #ccc; padding-bottom: 6px;">
        <div style="display: flex; align-items: baseline; justify-content: space-between;">
          <div style="font-size: 1.15em; font-weight: 900; line-height: 1.2; word-break: break-word;">
            <span style="display: inline-block; min-width: 26px;">${item.quantity}x</span>
            <span>${escapeHtml(item.name.toUpperCase())}</span>
          </div>
        </div>
        ${modifiersHtml}
        ${noteHtml}
      </div>
    `
  }).join('')

  const reprintBanner = ticket.isReprint
    ? `<div style="text-align: center; border: 2px solid #000; font-weight: 900; font-size: 1.1em; padding: 3px; margin-bottom: 6px; letter-spacing: 1px;">
         *** CETAK ULANG (REPRINT) ***
       </div>`
    : ''

  const ticketKindLabel = ticket.ticketKind === 'ADD-ON'
    ? 'TAMBAHAN (ADD-ON)'
    : ticket.ticketKind === 'HOLD'
    ? 'PESANAN MEJA (HOLD)'
    : 'PESANAN BARU'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kitchen Ticket - ${escapeHtml(ticket.stationLabel)} - ${escapeHtml(ticket.orderNumber)}</title>
  <style>
    @page {
      size: ${pageSizeCss};
      margin: 0;
    }
    @media print {
      html, body {
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        color: #000 !important;
      }
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, monospace;
      font-size: ${fontSize};
      line-height: 1.35;
    }
    .ticket-container {
      width: ${containerWidth};
      max-width: ${containerWidth};
      margin: 0 auto;
      padding: ${containerPadding};
      box-sizing: border-box;
    }
    .solid-divider {
      border-top: 2px solid #000000;
      margin: 6px 0;
      width: 100%;
    }
    .dashed-divider {
      border-top: 1px dashed #000000;
      margin: 5px 0;
      width: 100%;
    }
  </style>
</head>
<body>
  <div class="ticket-container">
    ${reprintBanner}

    <!-- Station Header Banner -->
    <div style="text-align: center; border: 2px solid #000; padding: 4px 2px; margin-bottom: 4px;">
      <div style="font-size: 0.85em; font-weight: 700; letter-spacing: 0.5px;">NOTA PRODUKSI F&amp;B</div>
      <div style="font-size: 1.4em; font-weight: 900; letter-spacing: 1px; line-height: 1.1;">
        [ ${escapeHtml(ticket.stationLabel)} ]
      </div>
      <div style="font-size: 0.8em; font-weight: 700; margin-top: 2px;">
        STATUS: ${ticketKindLabel}
      </div>
    </div>

    <!-- Table Number or Queue Banner (Giant Visibility) -->
    ${ticket.tableNumber ? `
    <div style="text-align: center; background-color: #000; color: #fff; padding: 6px 2px; margin: 4px 0;">
      <div style="font-size: 1.6em; font-weight: 900; letter-spacing: 1px; line-height: 1.1;">
        ${escapeHtml(ticket.tableNumber)}
      </div>
      <div style="font-size: 0.85em; font-weight: 700;">TIPE: ${escapeHtml(ticket.orderType)}</div>
    </div>
    ` : ''}

    ${ticket.queueNumber ? `
    <div style="text-align: center; border: 1.5px solid #000; padding: 3px; margin: 4px 0;">
      <span style="font-size: 0.85em; font-weight: 700;">NO. ANTREAN: </span>
      <span style="font-size: 1.4em; font-weight: 900;">#${escapeHtml(String(ticket.queueNumber))}</span>
    </div>
    ` : ''}

    <!-- Metadata Section -->
    <div style="font-size: 0.9em; margin: 4px 0; line-height: 1.3;">
      <div style="display: flex; justify-content: space-between;">
        <span>Waktu Masuk:</span>
        <span style="font-weight: 700;">${escapeHtml(ticket.timestamp)}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>No. Ref:</span>
        <span style="font-weight: 700;">${escapeHtml(ticket.orderNumber)}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>Server/Kasir:</span>
        <span>${escapeHtml(ticket.cashierOrServer)}</span>
      </div>
      ${ticket.customerName && ticket.customerName !== 'Pelanggan Walk-in' ? `
      <div style="display: flex; justify-content: space-between;">
        <span>Tamu:</span>
        <span style="font-weight: 700;">${escapeHtml(ticket.customerName)}</span>
      </div>
      ` : ''}
    </div>

    <div class="solid-divider"></div>
    <div style="font-size: 0.85em; font-weight: 900; letter-spacing: 0.5px; margin-bottom: 4px;">
      QTY &nbsp; MENU &amp; INSTRUKSI MASAK
    </div>
    <div class="dashed-divider"></div>

    <!-- Items List -->
    <div style="margin: 6px 0;">
      ${itemsHtml}
    </div>

    <!-- Global Order Note -->
    ${ticket.globalOrderNote ? `
    <div class="solid-divider"></div>
    <div style="border: 1.5px dashed #000; padding: 5px; margin: 6px 0;">
      <div style="font-size: 0.8em; font-weight: 900; text-transform: uppercase;">Catatan Khusus Meja/Pesanan:</div>
      <div style="font-size: 1.05em; font-weight: 700; margin-top: 2px; word-break: break-word;">
        &gt;&gt; ${escapeHtml(ticket.globalOrderNote)} &lt;&lt;
      </div>
    </div>
    ` : ''}

    <div class="solid-divider"></div>
    <div style="text-align: center; font-size: 0.8em; font-weight: 700; margin-top: 4px;">
      -- AKHIR INSTRUKSI DAPUR --
    </div>
  </div>
</body>
</html>`
}

/**
 * Encodes a KitchenTicketData into raw ESC/POS byte sequence.
 * Includes Buzzer Beep alarm for cooks and Paper Auto-Cut.
 */
export function encodeKitchenTicketToEscPos(
  ticket: KitchenTicketData,
  options: { soundBuzzer?: boolean; autoCut?: boolean } = {}
): Uint8Array {
  const is80mm = ticket.paperSize === '80mm'
  const width = is80mm ? 48 : 32
  const divider = '-'.repeat(width)
  const solidDivider = '='.repeat(width)

  const bytes: number[] = []
  const textEncoder = new TextEncoder()

  const writeRaw = (...b: number[]) => bytes.push(...b)
  const writeText = (t: string) => {
    const encoded = textEncoder.encode(t)
    for (let i = 0; i < encoded.length; i++) bytes.push(encoded[i])
  }

  // 1. Initialize printer
  writeRaw(0x1B, 0x40)

  // 2. Optional Buzzer Alarm (Buzzer 2x with 200ms duration)
  if (options.soundBuzzer !== false) {
    writeRaw(0x1B, 0x42, 0x02, 0x02) // ESC B 2 2
  }

  // 3. Reprint Banner
  if (ticket.isReprint) {
    writeRaw(0x1B, 0x61, 0x01) // Center
    writeRaw(0x1D, 0x42, 0x01) // Inverted (White on black)
    writeText(' *** CETAK ULANG (REPRINT) *** \n')
    writeRaw(0x1D, 0x42, 0x00) // Inverted off
    writeRaw(0x1B, 0x61, 0x00) // Left
  }

  // 4. Station Banner Header
  writeRaw(0x1B, 0x61, 0x01) // Center
  writeRaw(0x1D, 0x21, 0x01) // Double height
  writeText(`[ ${ticket.stationLabel} ]\n`)
  writeRaw(0x1D, 0x21, 0x00) // Normal

  const ticketKindLabel = ticket.ticketKind === 'ADD-ON'
    ? 'TAMBAHAN (ADD-ON)'
    : ticket.ticketKind === 'HOLD'
    ? 'PESANAN MEJA (HOLD)'
    : 'PESANAN BARU'
  writeText(`STATUS: ${ticketKindLabel}\n`)
  writeText(solidDivider + '\n')

  // 5. Table Number (GIANT Double-width & Double-height)
  if (ticket.tableNumber) {
    writeRaw(0x1B, 0x61, 0x01) // Center
    writeRaw(0x1D, 0x21, 0x11) // Double width & height
    writeText(`${ticket.tableNumber}\n`)
    writeRaw(0x1D, 0x21, 0x00) // Normal
    writeText(`TIPE: ${ticket.orderType}\n`)
    writeText(solidDivider + '\n')
  }

  // 6. Queue Number Banner
  if (ticket.queueNumber) {
    writeRaw(0x1B, 0x61, 0x01) // Center
    writeText('NO. ANTREAN\n')
    writeRaw(0x1D, 0x21, 0x11) // Double width & height
    writeText(`#${ticket.queueNumber}\n`)
    writeRaw(0x1D, 0x21, 0x00) // Normal
    writeText(divider + '\n')
  }

  // 7. Metadata (Left aligned)
  writeRaw(0x1B, 0x61, 0x00) // Left
  writeText(`Waktu: ${ticket.timestamp} | Ref: ${ticket.orderNumber}\n`)
  writeText(`Server: ${ticket.cashierOrServer}\n`)
  if (ticket.customerName && ticket.customerName !== 'Pelanggan Walk-in') {
    writeText(`Tamu: ${ticket.customerName}\n`)
  }
  writeText(solidDivider + '\n')

  // 8. Items Section
  writeText('QTY   MENU & INSTRUKSI MASAK\n')
  writeText(divider + '\n')

  for (const item of ticket.items) {
    // Qty and Item Name in Bold / Double-height
    writeRaw(0x1B, 0x45, 0x01) // Bold ON
    writeText(`${item.quantity}x  ${item.name.toUpperCase()}\n`)
    writeRaw(0x1B, 0x45, 0x00) // Bold OFF

    // Modifiers
    if (item.modifiers && item.modifiers.length > 0) {
      for (const m of item.modifiers) {
        writeRaw(0x1B, 0x45, 0x01) // Bold ON
        writeText(`    * ${m.option.toUpperCase()}\n`)
        writeRaw(0x1B, 0x45, 0x00) // Bold OFF
      }
    }

    // Item note
    if (item.note) {
      writeText(`    Note: ${item.note}\n`)
    }

    writeText('\n')
  }

  // 9. Global Order Note
  if (ticket.globalOrderNote) {
    writeText(solidDivider + '\n')
    writeRaw(0x1B, 0x45, 0x01) // Bold ON
    writeText('CATATAN KHUSUS PESANAN:\n')
    writeText(`>> ${ticket.globalOrderNote} <<\n`)
    writeRaw(0x1B, 0x45, 0x00) // Bold OFF
  }

  writeText(solidDivider + '\n')
  writeRaw(0x1B, 0x61, 0x01) // Center
  writeText('-- AKHIR INSTRUKSI DAPUR --\n')
  writeRaw(0x1B, 0x61, 0x00) // Left

  // 10. Feed lines & Auto-Cut
  writeText('\n\n\n')
  if (options.autoCut !== false) {
    writeRaw(0x1D, 0x56, 0x41, 0x03) // GS V A (Feed 3 lines and cut)
  }

  return new Uint8Array(bytes)
}

