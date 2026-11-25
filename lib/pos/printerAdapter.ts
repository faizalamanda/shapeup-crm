// ShapeUp POS Hardware-Agnostic Printer Abstraction Layer

export type PaperWidthUnit = 'mm' | 'cm' | 'in' | 'px' | 'chars'
export type PaperSizePreset = '58mm' | '76mm' | '80mm' | '104mm' | '120mm' | '241mm' | 'A4'
export type PaperSize = PaperSizePreset | string
export type ConnectionType = 'bluetooth' | 'lan' | 'system' | 'pdf'

export interface ResolvedPaperDimensions {
  rawPaperSize: string
  isCustom: boolean
  isPageSheet: boolean
  isDotMatrixContinuous?: boolean
  widthMm: number
  printableWidthMm: number
  unit: PaperWidthUnit
  inputValue: number
  escPosColumns: number
  maxLogoDots: number
  cssPageSize: string
  cssContainerWidth: string
  cssFontSize: string
  cssKitchenFontSize: string
  cssPadding: string
  previewIframeWidthPx: number
  displayLabel: string
}

const DOTS_PER_MM_203DPI = 8 // 203.2 DPI standard thermal printhead
const FONT_A_CHAR_DOTS = 12  // 12x24 Font A standard ESC/POS

/**
 * Default empirical printable width (heating element width) for a given physical roll width (mm).
 * Preserves 100% exact backward compatibility:
 * - 58mm -> 48mm
 * - 76mm -> 63mm (42 chars)
 * - 80mm -> 72mm
 * - 210mm (A4) -> 180mm
 */
export function computeDefaultPrintableWidthMm(widthMm: number): number {
  const w = Math.max(25, Math.min(350, Number(widthMm) || 58))
  if (Math.abs(w - 58) < 0.5) return 48
  if (Math.abs(w - 76) < 0.5) return 63
  if (Math.abs(w - 80) < 0.5) return 72
  if (Math.abs(w - 104) < 0.5) return 96
  if (Math.abs(w - 120.65) < 1) return 100 // Continuous Form 4.75" (NCR Bagi 2 Vertikal)
  if (Math.abs(w - 210) < 1) return 180
  if (Math.abs(w - 241.3) < 1.5) return 203 // Continuous Form 9.5" (Epson LX-310 Full NCR)
  if (w < 55) return Math.max(20, Number((w - 8).toFixed(1)))
  if (w <= 65) return Math.max(24, Number((w - 10).toFixed(1)))
  if (w <= 130) return Math.max(30, Number((w - 8).toFixed(1)))
  return Math.max(60, Number((w - 30).toFixed(1)))
}

/**
 * Converts a user input value in the chosen unit ('mm' | 'cm' | 'in' | 'px' | 'chars')
 * to physical paper roll width in millimeters (mm).
 */
export function convertUnitToMm(value: number, unit: PaperWidthUnit): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 58
  switch (unit) {
    case 'mm':
      return Number(num.toFixed(2))
    case 'cm':
      return Number((num * 10).toFixed(2))
    case 'in':
      return Number((num * 25.4).toFixed(2))
    case 'px':
      // Total physical dots at 203 DPI (8 dots/mm)
      return Number((num / DOTS_PER_MM_203DPI).toFixed(2))
    case 'chars': {
      // Printable width = chars * 12 / 8 = chars * 1.5 mm, plus standard margin compensation
      const printableMm = (num * FONT_A_CHAR_DOTS) / DOTS_PER_MM_203DPI
      const marginMm = printableMm <= 50 ? 10 : 8
      return Number((printableMm + marginMm).toFixed(2))
    }
    default:
      return Number(num.toFixed(2))
  }
}

/**
 * Converts physical paper width (mm) and printable width (mm) back into the target unit for UI display.
 */
export function convertMmToUnit(widthMm: number, unit: PaperWidthUnit, printableWidthMm?: number): number {
  const w = Number(widthMm) || 58
  const eff = Number(printableWidthMm) || computeDefaultPrintableWidthMm(w)
  switch (unit) {
    case 'mm':
      return Number(w.toFixed(1))
    case 'cm':
      return Number((w / 10).toFixed(2))
    case 'in':
      return Number((w / 25.4).toFixed(2))
    case 'px':
      return Math.round(w * DOTS_PER_MM_203DPI)
    case 'chars':
      return Math.max(16, Math.floor((eff * DOTS_PER_MM_203DPI) / FONT_A_CHAR_DOTS))
    default:
      return Number(w.toFixed(1))
  }
}

/**
 * Serializes a custom paper specification into a canonical PaperSize token string:
 * Format: "custom:<inputValue>:<unit>:<printableWidthMm>"
 * Example: "custom:7.6:cm:63" or "custom:76:mm:64"
 */
export function buildCustomPaperSizeToken(
  inputValue: number,
  unit: PaperWidthUnit,
  customPrintableWidthMm?: number
): PaperSize {
  const validUnits: PaperWidthUnit[] = ['mm', 'cm', 'in', 'px', 'chars']
  const safeUnit: PaperWidthUnit = validUnits.includes(unit) ? unit : 'mm'
  const rawMm = convertUnitToMm(inputValue, safeUnit)
  const clampedMm = Math.max(30, Math.min(300, rawMm))
  const safeInput = convertMmToUnit(clampedMm, safeUnit, customPrintableWidthMm)

  // If unit is chars and user didn't override printable width, compute exact printable width for that char count
  let effMm =
    customPrintableWidthMm && Number.isFinite(customPrintableWidthMm) && customPrintableWidthMm > 0
      ? Number(customPrintableWidthMm)
      : safeUnit === 'chars'
      ? Number((((Math.max(16, Math.round(inputValue)) * FONT_A_CHAR_DOTS) / DOTS_PER_MM_203DPI)).toFixed(1))
      : computeDefaultPrintableWidthMm(clampedMm)

  effMm = Math.max(20, Math.min(clampedMm, Number(effMm.toFixed(1))))
  return `custom:${safeInput}:${safeUnit}:${effMm}`
}

/**
 * Sanitizes and validates any incoming paper_size string (from API or storage).
 * Accepts '58mm', '76mm', '80mm', '104mm', 'A4', or 'custom:<val>:<unit>[:<effMm>]'.
 */
export function sanitizePaperSize(raw: unknown): PaperSize {
  if (typeof raw !== 'string' || !raw.trim()) return '58mm'
  const clean = raw.trim()
  if (['58mm', '76mm', '80mm', '104mm', '120mm', '241mm', 'A4'].includes(clean)) {
    return clean as PaperSize
  }
  if (clean.startsWith('custom:')) {
    const dims = resolvePaperDimensions(clean)
    return buildCustomPaperSizeToken(dims.inputValue, dims.unit, dims.printableWidthMm)
  }
  // Check if numeric mm string like "72mm" or "112mm"
  const mmMatch = clean.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|in|px|chars)$/i)
  if (mmMatch) {
    const val = parseFloat(mmMatch[1])
    const unit = mmMatch[2].toLowerCase() as PaperWidthUnit
    return buildCustomPaperSizeToken(val, unit)
  }
  return '58mm'
}

/**
 * Formats a human-readable badge/label for any PaperSize preset or custom token.
 */
export function formatPaperSizeLabel(paperSize?: PaperSize): string {
  const dims = resolvePaperDimensions(paperSize)
  return dims.displayLabel
}

/**
 * Universal Pure Function: Resolves full physical, CSS, ESC/POS, and raster logo dimensions
 * from any PaperSize string ('58mm', '80mm', 'A4', '76mm', or 'custom:<val>:<unit>:<eff>').
 *
 * Guarantees 100% backward-compatible parity for existing '58mm', '80mm', and 'A4' users.
 */
export function resolvePaperDimensions(paperSize?: PaperSize): ResolvedPaperDimensions {
  const raw = (typeof paperSize === 'string' && paperSize.trim()) ? paperSize.trim() : '58mm'

  // 1. Exact Fast-Path for Legacy '58mm' (100% identical to original hardcoded values)
  if (raw === '58mm') {
    return {
      rawPaperSize: '58mm',
      isCustom: false,
      isPageSheet: false,
      widthMm: 58,
      printableWidthMm: 48,
      unit: 'mm',
      inputValue: 58,
      escPosColumns: 32,
      maxLogoDots: 320,
      cssPageSize: '58mm auto',
      cssContainerWidth: '48mm',
      cssFontSize: '11px',
      cssKitchenFontSize: '12px',
      cssPadding: '2mm 1mm',
      previewIframeWidthPx: 236,
      displayLabel: 'Thermal 58mm'
    }
  }

  // 2. Exact Fast-Path for Legacy '80mm' (100% identical to original hardcoded values)
  if (raw === '80mm') {
    return {
      rawPaperSize: '80mm',
      isCustom: false,
      isPageSheet: false,
      widthMm: 80,
      printableWidthMm: 72,
      unit: 'mm',
      inputValue: 80,
      escPosColumns: 48,
      maxLogoDots: 480,
      cssPageSize: '80mm auto',
      cssContainerWidth: '72mm',
      cssFontSize: '13px',
      cssKitchenFontSize: '14px',
      cssPadding: '4mm 2mm',
      previewIframeWidthPx: 320,
      displayLabel: 'Thermal 80mm'
    }
  }

  // 3. Exact Fast-Path for Legacy 'A4' (100% identical to original hardcoded values)
  if (raw === 'A4') {
    return {
      rawPaperSize: 'A4',
      isCustom: false,
      isPageSheet: true,
      widthMm: 210,
      printableWidthMm: 180,
      unit: 'mm',
      inputValue: 210,
      escPosColumns: 48,
      maxLogoDots: 512,
      cssPageSize: 'A4 portrait',
      cssContainerWidth: '180mm',
      cssFontSize: '13px',
      cssKitchenFontSize: '14px',
      cssPadding: '15mm 10mm',
      previewIframeWidthPx: 520,
      displayLabel: 'Halaman A4'
    }
  }

  // 4. Preset '76mm' (Impact Dot-Matrix TM-U220 Standard)
  if (raw === '76mm') {
    return {
      rawPaperSize: '76mm',
      isCustom: false,
      isPageSheet: false,
      widthMm: 76,
      printableWidthMm: 63,
      unit: 'mm',
      inputValue: 76,
      escPosColumns: 42,
      maxLogoDots: 424,
      cssPageSize: '76mm auto',
      cssContainerWidth: '63mm',
      cssFontSize: '12px',
      cssKitchenFontSize: '13px',
      cssPadding: '3mm 1.5mm',
      previewIframeWidthPx: 304,
      displayLabel: 'Impact/Thermal 76mm'
    }
  }

  // 5. Preset '104mm' (Wide Label / 4-Inch Mobile Thermal)
  if (raw === '104mm') {
    return {
      rawPaperSize: '104mm',
      isCustom: false,
      isPageSheet: false,
      widthMm: 104,
      printableWidthMm: 96,
      unit: 'mm',
      inputValue: 104,
      escPosColumns: 64,
      maxLogoDots: 576,
      cssPageSize: '104mm auto',
      cssContainerWidth: '96mm',
      cssFontSize: '13px',
      cssKitchenFontSize: '14px',
      cssPadding: '4mm 2mm',
      previewIframeWidthPx: 416,
      displayLabel: 'Thermal 104mm (4")'
    }
  }

  // 5b. Preset '120mm' (Epson LX-310 Continuous Form 4.75" / NCR Belah 2 Vertikal)
  if (raw === '120mm') {
    return {
      rawPaperSize: '120mm',
      isCustom: false,
      isPageSheet: false,
      isDotMatrixContinuous: true,
      widthMm: 120.7,
      printableWidthMm: 100,
      unit: 'in',
      inputValue: 4.75,
      escPosColumns: 42,
      maxLogoDots: 480,
      cssPageSize: '120.7mm auto',
      cssContainerWidth: '100mm',
      cssFontSize: '12.5px',
      cssKitchenFontSize: '13.5px',
      cssPadding: '3mm 2mm',
      previewIframeWidthPx: 430,
      displayLabel: 'LX-310 NCR 4.75" (12cm)'
    }
  }

  // 5c. Preset '241mm' (Epson LX-310 Continuous Form 9.5" Full Width NCR)
  if (raw === '241mm') {
    return {
      rawPaperSize: '241mm',
      isCustom: false,
      isPageSheet: true,
      isDotMatrixContinuous: true,
      widthMm: 241.3,
      printableWidthMm: 203,
      unit: 'in',
      inputValue: 9.5,
      escPosColumns: 80,
      maxLogoDots: 512,
      cssPageSize: '241.3mm auto',
      cssContainerWidth: '203mm',
      cssFontSize: '13px',
      cssKitchenFontSize: '14px',
      cssPadding: '5mm 6mm',
      previewIframeWidthPx: 540,
      displayLabel: 'LX-310 Continuous 9.5"'
    }
  }

  // 6. Parse Custom Token: "custom:<inputValue>:<unit>[:<printableWidthMm>]" or "<num><unit>"
  let unit: PaperWidthUnit = 'mm'
  let inputValue = 58
  let widthMm = 58
  let printableWidthMm = 48

  if (raw.startsWith('custom:')) {
    const parts = raw.split(':')
    const parsedVal = parseFloat(parts[1])
    const parsedUnit = (parts[2] || 'mm') as PaperWidthUnit
    const validUnits: PaperWidthUnit[] = ['mm', 'cm', 'in', 'px', 'chars']
    unit = validUnits.includes(parsedUnit) ? parsedUnit : 'mm'
    inputValue = Number.isFinite(parsedVal) && parsedVal > 0 ? parsedVal : 58
    widthMm = Math.max(30, Math.min(300, convertUnitToMm(inputValue, unit)))

    const parsedEff = parts[3] ? parseFloat(parts[3]) : NaN
    if (Number.isFinite(parsedEff) && parsedEff >= 20 && parsedEff <= widthMm) {
      printableWidthMm = Number(parsedEff.toFixed(1))
    } else if (unit === 'chars') {
      printableWidthMm = Math.min(
        widthMm,
        Number((((Math.max(16, Math.round(inputValue)) * FONT_A_CHAR_DOTS) / DOTS_PER_MM_203DPI)).toFixed(1))
      )
    } else {
      printableWidthMm = computeDefaultPrintableWidthMm(widthMm)
    }
  } else {
    const match = raw.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|in|px|chars)?$/i)
    if (match) {
      inputValue = parseFloat(match[1])
      unit = ((match[2] || 'mm').toLowerCase() as PaperWidthUnit)
      widthMm = Math.max(30, Math.min(300, convertUnitToMm(inputValue, unit)))
      printableWidthMm = computeDefaultPrintableWidthMm(widthMm)
    }
  }

  const isPageSheet = widthMm >= 140
  const isDotMatrixContinuous =
    Math.abs(widthMm - 76) < 1.5 ||
    Math.abs(widthMm - 120.7) < 2 ||
    Math.abs(widthMm - 241.3) < 3

  const escPosColumns = Math.max(
    16,
    Math.min(120, Math.floor((printableWidthMm * DOTS_PER_MM_203DPI) / FONT_A_CHAR_DOTS))
  )

  // 8-dot byte-aligned max logo width (~83.3% of printable width dots)
  const rawLogoDots = printableWidthMm * DOTS_PER_MM_203DPI * 0.8334
  const maxLogoDots = Math.max(64, Math.min(576, Math.floor(rawLogoDots / 8) * 8))

  // Continuous font scaling clamped between 10px and 14px
  const interpFont = 10 + ((printableWidthMm - 36) / (72 - 36)) * 3
  const fontPx = Math.round(Math.max(10, Math.min(14, interpFont)) * 2) / 2
  const kitchenFontPx = Math.min(15, fontPx + 1)

  const cssPageSize = isPageSheet ? `${widthMm}mm auto` : `${widthMm}mm auto`
  const cssContainerWidth = `${printableWidthMm}mm`
  const cssFontSize = `${fontPx}px`
  const cssKitchenFontSize = `${kitchenFontPx}px`
  const cssPadding = isDotMatrixContinuous
    ? '4mm 4mm'
    : isPageSheet
    ? '12mm 8mm'
    : widthMm <= 62
    ? '2mm 1mm'
    : '3.5mm 2mm'

  const previewIframeWidthPx = Math.max(190, Math.min(540, Math.round(widthMm * 4.02)))

  const unitLabelMap: Record<PaperWidthUnit, string> = {
    mm: `${inputValue}mm`,
    cm: `${inputValue}cm (${Math.round(widthMm)}mm)`,
    in: `${inputValue}" (${Math.round(widthMm)}mm)`,
    px: `${inputValue}px (${Math.round(widthMm)}mm)`,
    chars: `${escPosColumns} Kolom (${Math.round(widthMm)}mm)`
  }

  return {
    rawPaperSize: raw,
    isCustom: true,
    isPageSheet,
    isDotMatrixContinuous,
    widthMm,
    printableWidthMm,
    unit,
    inputValue,
    escPosColumns,
    maxLogoDots,
    cssPageSize,
    cssContainerWidth,
    cssFontSize,
    cssKitchenFontSize,
    cssPadding,
    previewIframeWidthPx,
    displayLabel: `Custom ${unitLabelMap[unit]}`
  }
}

export interface PrinterDevice {
  id: string
  name: string
  connectionType: ConnectionType
  address?: string
  paperSize: PaperSize
  isDefault?: boolean
  status: 'connected' | 'disconnected' | 'printing' | 'error'
}

export interface ReceiptItem {
  name: string
  variant?: string
  quantity: number
  price: number
  subtotal: number
  discount?: number
  note?: string
}

export interface ReceiptLoyaltyInfo {
  tierName?: string
  tierBadge?: string
  pointsEarned?: number
  currentBalance?: number
}

export interface ReceiptData {
  businessName: string
  businessAddress?: string
  businessPhone?: string
  orderNumber: string
  orderNumberLabel?: string
  reconciledFromNumber?: string
  date: string
  cashierName: string
  customerName?: string
  showItemNumbering?: boolean
  showLogo?: boolean
  logoUrl?: string
  logoBase64?: string
  logoEscPosBytes?: Uint8Array
  loyaltyInfo?: ReceiptLoyaltyInfo
  items: ReceiptItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  grandTotal: number
  paymentMethod: string
  cashReceived?: number
  changeAmount?: number
  amountPaid?: number
  outstandingAmount?: number
  paymentStatus?: 'paid' | 'partial' | 'unpaid'
  note?: string
  orderNote?: string
  paperSize?: PaperSize
  receiptTitle?: string
  queueNumber?: string | number
  showQueueNumber?: boolean
  returnNumber?: string
  originalOrderNumber?: string
  returnReason?: string
  refundBreakdown?: Array<{ method: string; amount: number }>
}

export interface PrintResult {
  success: boolean
  message?: string
  /**
   * Set when a previously paired Bluetooth printer could not be reached silently.
   * UI should offer an explicit "Sambungkan Ulang" button (fresh user gesture)
   * instead of auto-opening the device chooser.
   */
  needsBluetoothReconnect?: boolean
}

export interface PrinterStatus {
  online: boolean
  paperOut?: boolean
  coverOpen?: boolean
  details?: string
}

export interface PrinterAdapter {
  discover(): Promise<PrinterDevice[]>
  connect(deviceId: string): Promise<void>
  print(receipt: ReceiptData, paperSize?: PaperSize): Promise<PrintResult>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
}

function escapeHtml(str: string = ''): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function generateReceiptHtml(receipt: ReceiptData, paperSize?: PaperSize): string {
  const effectivePaperSize = paperSize || receipt.paperSize || '58mm'
  const dims = resolvePaperDimensions(effectivePaperSize)

  const pageSizeCss = dims.cssPageSize
  const containerWidth = dims.cssContainerWidth
  const fontSize = dims.cssFontSize
  const containerPadding = dims.cssPadding
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  // On 9-pin Impact Dot-Matrix printers (Epson LX-310 / TM-U220), gray colors (#444/#555) and #f7f7f7 shading
  // cause slow multi-pass pin dithering. Force 100% pure black (#000) & transparent background on dot-matrix sizes.
  const isAntiDither = Boolean(dims.isDotMatrixContinuous || dims.rawPaperSize === '76mm')
  const subTextColor = isAntiDither ? '#000000' : '#444444'
  const mutedTextColor = isAntiDither ? '#000000' : '#555555'
  const noteBoxBg = isAntiDither ? '#ffffff' : '#f7f7f7'
  const noteBoxBorder = isAntiDither ? '1px dashed #000000' : '1px dashed #777777'

  const itemsHtml = (receipt.items || []).map((item, idx) => {
    const itemNumberPrefix = receipt.showItemNumbering ? `${idx + 1}. ` : ''
    const detailPadding = receipt.showItemNumbering ? '12px' : '4px'
    const variantHtml = item.variant
      ? `<div style="padding-left: ${detailPadding}; font-size: 0.9em; color: ${subTextColor}; margin-top: 1px;">• ${escapeHtml(item.variant)}</div>`
      : ''
    const noteHtml = item.note
      ? `<div style="padding-left: ${detailPadding}; font-size: 0.85em; font-style: italic; color: ${mutedTextColor}; margin-top: 1px;">• ${escapeHtml(item.note)}</div>`
      : ''
    const discountHtml = item.discount && item.discount > 0
      ? `<div style="display: flex; justify-content: space-between; font-size: 0.9em; color: ${mutedTextColor}; padding-left: ${detailPadding}; margin-top: 1px;"><span>Diskon:</span><span>-${item.discount.toLocaleString('id-ID')}</span></div>`
      : ''

    return `
      <div style="margin-bottom: 6px;">
        <div style="word-break: break-word;">${itemNumberPrefix}${escapeHtml(item.name)}</div>
        ${variantHtml}
        ${noteHtml}
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 1px; padding-left: ${detailPadding};">
          <span>${item.quantity} x ${item.price.toLocaleString('id-ID')}</span>
          <span>${item.subtotal.toLocaleString('id-ID')}</span>
        </div>
        ${discountHtml}
      </div>
    `
  }).join('')

  const discountTotalHtml = receipt.discountTotal > 0
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Diskon:</span>
        <span>-${receipt.discountTotal.toLocaleString('id-ID')}</span>
      </div>
    `
    : ''

  const taxTotalHtml = receipt.taxTotal > 0
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Pajak:</span>
        <span>+${receipt.taxTotal.toLocaleString('id-ID')}</span>
      </div>
    `
    : ''

  const cashDetailsHtml = (receipt.cashReceived !== undefined && receipt.cashReceived > 0)
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Bayar Tunai:</span>
        <span>${receipt.cashReceived.toLocaleString('id-ID')}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Kembalian:</span>
        <span>${(receipt.changeAmount || 0).toLocaleString('id-ID')}</span>
      </div>
    `
    : ''

  const outstandingHtml = (receipt.outstandingAmount !== undefined && receipt.outstandingAmount > 0.01)
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Total Dibayar:</span>
        <span>${(receipt.amountPaid || 0).toLocaleString('id-ID')}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>STATUS:</span>
        <span style="text-transform: uppercase;">BELUM LUNAS</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px; border-top: 1px dashed #000; padding-top: 2px; margin-top: 2px;">
        <span>SISA PIUTANG:</span>
        <span>${receipt.outstandingAmount.toLocaleString('id-ID')}</span>
      </div>
    `
    : (receipt.paymentStatus === 'paid' || (receipt.amountPaid !== undefined && (receipt.outstandingAmount || 0) <= 0.01))
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>STATUS:</span>
        <span style="text-transform: uppercase;">LUNAS</span>
      </div>
    `
    : ''

  const defaultFooterNote = 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar/dikembalikan.'
  const footerNoteContent = escapeHtml(receipt.note || defaultFooterNote).replace(/\n/g, '<br>')

  const orderNoteHtml = receipt.orderNote
    ? `
      <div class="divider"></div>
      <!-- Catatan Global Pesanan -->
      <div style="margin: 4px 0; font-size: 0.9em;">
        <div style="font-size: 0.85em; text-transform: uppercase; margin-bottom: 2px; letter-spacing: 0.3px; color: ${subTextColor};">Catatan Pesanan:</div>
        <div style="padding: 4px 6px; background-color: ${noteBoxBg}; border: ${noteBoxBorder}; word-break: break-word;">
          ${escapeHtml(receipt.orderNote)}
        </div>
      </div>
    `
    : ''

  const loyaltyHtml = (receipt.loyaltyInfo && (receipt.loyaltyInfo.pointsEarned !== undefined || receipt.loyaltyInfo.currentBalance !== undefined || receipt.loyaltyInfo.tierName))
    ? `
      <div class="divider"></div>
      <!-- Informasi Poin Loyalty Pelanggan -->
      <div style="margin: 4px 0; font-size: 0.9em;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span>LOYALTY REWARDS</span>
          <span>${escapeHtml(receipt.loyaltyInfo.tierBadge || '')} ${escapeHtml(receipt.loyaltyInfo.tierName || 'Member')}</span>
        </div>
        ${receipt.loyaltyInfo.pointsEarned !== undefined && receipt.loyaltyInfo.pointsEarned > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 1px;">
          <span>Poin Transaksi Ini:</span>
          <span>+${receipt.loyaltyInfo.pointsEarned.toLocaleString('id-ID')} Poin</span>
        </div>` : ''}
        ${receipt.loyaltyInfo.currentBalance !== undefined ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 1px;">
          <span>Total Saldo Poin:</span>
          <span>${receipt.loyaltyInfo.currentBalance.toLocaleString('id-ID')} Poin</span>
        </div>` : ''}
      </div>
    `
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${escapeHtml(receipt.orderNumber)}</title>
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
      font-family: ${fontFamily};
      font-size: ${fontSize};
      line-height: 1.35;
      letter-spacing: -0.15px;
    }
    .receipt-container {
      width: ${containerWidth};
      max-width: ${containerWidth};
      margin: 0 auto;
      padding: ${containerPadding};
      box-sizing: border-box;
    }
    .divider {
      border-top: 1px dashed #000000;
      margin: 5px 0;
      width: 100%;
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <!-- Header Toko -->
    <div style="text-align: center; margin-bottom: 6px;">
      ${(receipt.showLogo && (receipt.logoBase64 || receipt.logoUrl)) ? `
      <div style="margin-bottom: 6px; text-align: center;">
        <img 
          src="${receipt.logoBase64 || escapeHtml(receipt.logoUrl || '')}" 
          alt="Logo" 
          style="max-width: 65%; max-height: 60px; object-fit: contain; filter: grayscale(100%) contrast(120%); display: inline-block;"
        />
      </div>` : ''}
      <div style="font-size: 1.25em; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(receipt.businessName)}</div>
      ${receipt.businessAddress ? `<div style="font-size: 0.9em; margin-top: 2px; word-break: break-word;">${escapeHtml(receipt.businessAddress)}</div>` : ''}
      ${receipt.businessPhone ? `<div style="font-size: 0.9em; margin-top: 1px;">Telp: ${escapeHtml(receipt.businessPhone)}</div>` : ''}
    </div>

    <div class="divider"></div>

    ${receipt.showQueueNumber && receipt.queueNumber ? `
    <div style="text-align: center; margin: 4px 0 6px 0; padding: 4px 0; border: 1.5px solid #000; border-radius: 4px;">
      <div style="font-size: 0.8em; font-weight: bold; letter-spacing: 1px;">NO. ANTREAN</div>
      <div style="font-size: 1.6em; font-weight: 900; line-height: 1.1;">#${escapeHtml(String(receipt.queueNumber))}</div>
    </div>
    ` : ''}

    ${receipt.receiptTitle ? `
    <div style="text-align: center; font-weight: bold; letter-spacing: 0.5px; margin: 4px 0; border: 1px dashed #000; padding: 3px 0;">
      ${escapeHtml(receipt.receiptTitle)}
    </div>
    ` : ''}

    <!-- Metadata Transaksi -->
    <div style="margin: 4px 0; font-size: 0.95em;">
      ${receipt.returnNumber ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>No. Retur:</span>
        <span>${escapeHtml(receipt.returnNumber)}</span>
      </div>` : ''}
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>${receipt.orderNumberLabel || (receipt.returnNumber ? 'Nota Asal:' : 'No. Invoice:')}</span>
        <span>${escapeHtml(receipt.originalOrderNumber || receipt.orderNumber)}</span>
      </div>
      ${receipt.reconciledFromNumber ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Ref Struk:</span>
        <span>${escapeHtml(receipt.reconciledFromNumber)}</span>
      </div>` : ''}
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Tanggal:</span>
        <span>${escapeHtml(receipt.date)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Kasir:</span>
        <span>${escapeHtml(receipt.cashierName)}</span>
      </div>
      ${receipt.returnReason ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Alasan:</span>
        <span>${escapeHtml(receipt.returnReason)}</span>
      </div>` : ''}
      ${receipt.customerName ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Pelanggan:</span>
        <span>${escapeHtml(receipt.customerName)}</span>
      </div>` : ''}
    </div>

    <div class="divider"></div>

    <!-- Daftar Item -->
    <div style="margin: 5px 0;">
      ${itemsHtml}
    </div>

    <div class="divider"></div>

    <!-- Perhitungan Total -->
    <div style="margin: 4px 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Subtotal:</span>
        <span>${receipt.subtotal.toLocaleString('id-ID')}</span>
      </div>
      ${discountTotalHtml}
      ${taxTotalHtml}
      <div style="display: flex; justify-content: space-between; font-size: 1.15em; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px;">
        <span>TOTAL:</span>
        <span>${receipt.grandTotal.toLocaleString('id-ID')}</span>
      </div>
    </div>

    <div class="divider"></div>

    <!-- Detail Pembayaran & Piutang -->
    <div style="margin: 4px 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>${receipt.paymentStatus === 'unpaid' ? 'Status Transaksi:' : 'Metode Bayar:'}</span>
        <span style="text-transform: uppercase;">${escapeHtml(receipt.paymentMethod)}</span>
      </div>
      ${cashDetailsHtml}
      ${outstandingHtml}
    </div>

    ${orderNoteHtml}

    ${loyaltyHtml}

    <div class="divider"></div>

    <!-- Footer Catatan & Branding -->
    <div style="text-align: center; margin-top: 8px; font-size: 0.9em; color: ${isAntiDither ? '#000000' : '#222222'};">
      <div>${footerNoteContent}</div>
      <div style="font-size: 0.8em; color: ${mutedTextColor}; margin-top: 6px;">Powered by ShapeUp POS</div>
    </div>
  </div>
</body>
</html>`
}

export function printReceiptViaIframe(receipt: ReceiptData, paperSize: PaperSize = '58mm'): Promise<PrintResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ success: false, message: 'Window object not available' })
      return
    }

    try {
      let iframe = document.getElementById('pos-thermal-print-iframe') as HTMLIFrameElement | null
      if (!iframe) {
        iframe = document.createElement('iframe')
        iframe.id = 'pos-thermal-print-iframe'
        iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;')
        document.body.appendChild(iframe)
      }

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (!iframeDoc) {
        resolve({ success: false, message: 'Gagal mengakses dokumen printer' })
        return
      }

      const htmlContent = generateReceiptHtml(receipt, paperSize)

      iframeDoc.open()
      iframeDoc.write(htmlContent)
      iframeDoc.close()

      // Give browser time to parse CSS and font
      setTimeout(() => {
        try {
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.focus()
            iframe.contentWindow.print()
            resolve({ success: true })
          } else {
            window.print()
            resolve({ success: true })
          }
        } catch (err: any) {
          console.warn('Iframe print error, falling back to window.print:', err)
          try {
            window.print()
            resolve({ success: true })
          } catch (e: any) {
            resolve({ success: false, message: e.message || 'Gagal mencetak struk' })
          }
        }
      }, 200)
    } catch (err: any) {
      resolve({ success: false, message: err.message || 'Terjadi kesalahan saat memproses cetak' })
    }
  })
}

// ==========================================
// ESC/POS Command Encoder Helper
// ==========================================
/**
 * Safely resolves the ESC/POS character column count for Bluetooth thermal printers.
 * Supports the full range of thermal roll printers:
 * - 44mm..58mm (24..32 cols)
 * - 76mm (42 cols)
 * - 80mm (48 cols)
 * - 104mm..112mm 4-inch wide portable thermal (64..69 cols)
 * Only desktop sheet/tractor papers (A4, LX-310 120mm/241mm, or >115mm) fall back to 32 cols.
 */
export function resolveBluetoothEscPosColumns(paperSize?: PaperSize): number {
  const raw = typeof paperSize === 'string' && paperSize.trim() ? paperSize.trim() : '58mm'
  if (raw === '58mm') return 32
  if (raw === '76mm') return 42
  if (raw === '80mm') return 48
  if (raw === '104mm') return 64
  if (raw === 'A4' || raw === '241mm' || raw === '120mm') return 32
  const dims = resolvePaperDimensions(raw)
  if (dims.isPageSheet || dims.isDotMatrixContinuous || dims.widthMm > 115) {
    return 32
  }
  return Math.max(20, Math.min(69, dims.escPosColumns))
}

export function encodeReceiptToEscPos(receipt: ReceiptData, paperSize?: PaperSize): Uint8Array {
  const effectivePaperSize = paperSize || receipt.paperSize || '58mm'
  const width = resolveBluetoothEscPosColumns(effectivePaperSize)
  const divider = '-'.repeat(width)

  const padColumns = (left: string, right: string, maxCols: number = width): string => {
    const spaceNeeded = maxCols - left.length - right.length
    if (spaceNeeded >= 1) {
      return left + ' '.repeat(spaceNeeded) + right + '\n'
    }
    return left + '\n' + ' '.repeat(Math.max(0, maxCols - right.length)) + right + '\n'
  }

  const bytes: number[] = []
  const textEncoder = new TextEncoder()

  const writeRaw = (...b: number[]) => bytes.push(...b)
  const writeText = (t: string) => {
    const encoded = textEncoder.encode(t)
    for (let i = 0; i < encoded.length; i++) bytes.push(encoded[i])
  }

  // 1. Initialize printer
  writeRaw(0x1B, 0x40)

  // 2. Header (Centered)
  writeRaw(0x1B, 0x61, 0x01) // Center

  // 2.1 Optional Monochrome Logo (GS v 0 Raster Bit Image)
  if (receipt.showLogo && receipt.logoEscPosBytes && receipt.logoEscPosBytes.length > 0) {
    for (let i = 0; i < receipt.logoEscPosBytes.length; i++) {
      bytes.push(receipt.logoEscPosBytes[i])
    }
    writeRaw(0x0A) // Line feed after logo
  }

  writeRaw(0x1D, 0x21, 0x01) // Double height
  writeText((receipt.businessName || 'SHAPEUP STORE').toUpperCase() + '\n')
  writeRaw(0x1D, 0x21, 0x00) // Normal text

  if (receipt.businessAddress) {
    writeText(receipt.businessAddress + '\n')
  }
  if (receipt.businessPhone) {
    writeText('Telp: ' + receipt.businessPhone + '\n')
  }

  // Divider
  writeText(divider + '\n')

  // Optional Queue Number Banner (ESC/POS)
  if (receipt.showQueueNumber && receipt.queueNumber) {
    writeRaw(0x1B, 0x61, 0x01) // Center
    writeText('NO. ANTREAN\n')
    writeRaw(0x1D, 0x21, 0x11) // Double width & height
    writeText(`#${receipt.queueNumber}\n`)
    writeRaw(0x1D, 0x21, 0x00) // Normal
    writeText(divider + '\n')
    writeRaw(0x1B, 0x61, 0x00) // Left
  }

  if (receipt.receiptTitle) {
    writeRaw(0x1B, 0x61, 0x01) // Center
    writeText(receipt.receiptTitle.toUpperCase() + '\n')
    writeText(divider + '\n')
    writeRaw(0x1B, 0x61, 0x00) // Left
  }

  // 3. Metadata (Left align)
  writeRaw(0x1B, 0x61, 0x00) // Left
  const invoiceLabel = receipt.orderNumberLabel || (receipt.returnNumber ? 'No. Retur:' : 'No. Invoice:')
  writeText(padColumns(invoiceLabel, receipt.originalOrderNumber || receipt.orderNumber))
  if (receipt.reconciledFromNumber) {
    writeText(padColumns('Ref Struk:', receipt.reconciledFromNumber))
  }
  writeText(padColumns('Tanggal:', receipt.date))
  writeText(padColumns('Kasir:', receipt.cashierName))
  if (receipt.customerName) {
    writeText(padColumns('Pelanggan:', receipt.customerName))
  }

  // Divider
  writeText(divider + '\n')

  // 4. Items
  for (let idx = 0; idx < (receipt.items || []).length; idx++) {
    const item = receipt.items[idx]
    const numPrefix = receipt.showItemNumbering ? `${idx + 1}. ` : ''
    writeText(`${numPrefix}${item.name}\n`)
    if (item.variant) {
      writeText(`   • ${item.variant}\n`)
    }
    if (item.note) {
      writeText(`   • ${item.note}\n`)
    }
    const qtyPrice = `   ${item.quantity} x ${item.price.toLocaleString('id-ID')}`
    const subtotal = item.subtotal.toLocaleString('id-ID')
    writeText(padColumns(qtyPrice, subtotal))
    if (item.discount && item.discount > 0) {
      writeText(padColumns('   Diskon:', `-${item.discount.toLocaleString('id-ID')}`))
    }
  }

  // Divider
  writeText(divider + '\n')

  // 5. Totals
  writeText(padColumns('Subtotal:', receipt.subtotal.toLocaleString('id-ID')))
  if (receipt.discountTotal > 0) {
    writeText(padColumns('Diskon:', `-${receipt.discountTotal.toLocaleString('id-ID')}`))
  }
  if (receipt.taxTotal > 0) {
    writeText(padColumns('Pajak:', `+${receipt.taxTotal.toLocaleString('id-ID')}`))
  }

  // Grand Total (Normal text for sharp thermal clarity)
  writeText(padColumns('TOTAL:', receipt.grandTotal.toLocaleString('id-ID')))

  // Divider
  writeText(divider + '\n')

  // 6. Payment details
  const paymentMethodLabel = receipt.paymentStatus === 'unpaid' ? 'Status Transaksi:' : 'Metode Bayar:'
  writeText(padColumns(paymentMethodLabel, (receipt.paymentMethod || 'TUNAI').toUpperCase()))
  if (receipt.cashReceived !== undefined && receipt.cashReceived > 0) {
    writeText(padColumns('Bayar Tunai:', receipt.cashReceived.toLocaleString('id-ID')))
    writeText(padColumns('Kembalian:', (receipt.changeAmount || 0).toLocaleString('id-ID')))
  }
  if (receipt.outstandingAmount !== undefined && receipt.outstandingAmount > 0.01) {
    writeText(padColumns('Total Dibayar:', (receipt.amountPaid || 0).toLocaleString('id-ID')))
    writeText(padColumns('STATUS:', 'BELUM LUNAS'))
    writeText(padColumns('SISA PIUTANG:', receipt.outstandingAmount.toLocaleString('id-ID')))
  } else if (receipt.paymentStatus === 'paid' || (receipt.amountPaid !== undefined && (receipt.outstandingAmount || 0) <= 0.01)) {
    writeText(padColumns('STATUS:', 'LUNAS'))
  }

  // 7. Catatan Global Pesanan (Moved to bottom below payment details)
  if (receipt.orderNote) {
    writeText(divider + '\n')
    writeText('Catatan Pesanan:\n')
    writeText(`${receipt.orderNote}\n`)
  }

  // Loyalty
  if (receipt.loyaltyInfo && (receipt.loyaltyInfo.pointsEarned !== undefined || receipt.loyaltyInfo.currentBalance !== undefined)) {
    writeText(divider + '\n')
    writeText(padColumns('LOYALTY REWARDS', receipt.loyaltyInfo.tierName || 'Member'))
    if (receipt.loyaltyInfo.pointsEarned) {
      writeText(padColumns('Poin Transaksi:', `+${receipt.loyaltyInfo.pointsEarned.toLocaleString('id-ID')}`))
    }
    if (receipt.loyaltyInfo.currentBalance !== undefined) {
      writeText(padColumns('Total Saldo Poin:', `${receipt.loyaltyInfo.currentBalance.toLocaleString('id-ID')}`))
    }
  }

  // Divider
  writeText(divider + '\n')

  // 7. Footer (Centered)
  writeRaw(0x1B, 0x61, 0x01) // Center
  const footerNote = receipt.note || 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar/dikembalikan.'
  const lines = footerNote.split('\n')
  for (const l of lines) {
    if (l.trim()) writeText(l.trim() + '\n')
  }
  writeText('Powered by ShapeUp POS\n')

  // 8. Feed 4 lines & Cut
  writeRaw(0x1B, 0x64, 0x04) // Feed 4 lines
  writeRaw(0x1D, 0x56, 0x41, 0x03) // GS V 65 3 (partial cut)

  return new Uint8Array(bytes)
}

// ==========================================
// Bluetooth Helper & Device Management
// ==========================================
export interface BluetoothDeviceSession {
  deviceId: string
  deviceName: string
  device: any
  writeChar: any
  serviceUuid?: string
  charUuid?: string
  lastActive: number
}

// Multi-Device Connection Pool: Map<deviceIdOrName, BluetoothDeviceSession>
const bluetoothPool = new Map<string, BluetoothDeviceSession>()

let activeBluetoothDevice: any = null
let activeWriteCharacteristic: any = null
let isConnectingGatt = false
let isPrintingBle = false
let reconnectTimer: any = null
let heartbeatTimer: any = null
let cachedServiceUuid: string | null = null
let cachedCharUuid: string | null = null

/** Helper to persist connectionType = 'bluetooth' in localStorage when a BT printer is selected/paired */
function persistBluetoothConnectionType(): void {
  if (typeof window === 'undefined') return
  try {
    const key = 'shapeup_pos_receipt_settings'
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    if (parsed.connectionType !== 'bluetooth') {
      parsed.connectionType = 'bluetooth'
      localStorage.setItem(key, JSON.stringify(parsed))
    }
  } catch {}
}

// Restore cached service & char UUIDs from storage if present
if (typeof window !== 'undefined') {
  try {
    cachedServiceUuid = localStorage.getItem('shapeup_pos_bt_service_uuid') || null
    cachedCharUuid = localStorage.getItem('shapeup_pos_bt_char_uuid') || null
  } catch {}
}

function registerInPool(device: any, writeChar: any, serviceUuid?: string, charUuid?: string): BluetoothDeviceSession {
  const deviceId = device.id || 'bt-default'
  const deviceName = device.name || 'Bluetooth Thermal Printer'
  const session: BluetoothDeviceSession = {
    deviceId,
    deviceName,
    device,
    writeChar,
    serviceUuid,
    charUuid,
    lastActive: Date.now()
  }
  bluetoothPool.set(deviceId, session)
  bluetoothPool.set(deviceName, session)
  return session
}

export function getActiveBluetoothSession(targetIdOrName?: string): BluetoothDeviceSession | null {
  if (targetIdOrName && bluetoothPool.has(targetIdOrName)) {
    return bluetoothPool.get(targetIdOrName)!
  }
  if (activeBluetoothDevice && activeWriteCharacteristic) {
    return {
      deviceId: activeBluetoothDevice.id || 'bt-default',
      deviceName: activeBluetoothDevice.name || 'Bluetooth Printer',
      device: activeBluetoothDevice,
      writeChar: activeWriteCharacteristic,
      serviceUuid: cachedServiceUuid || undefined,
      charUuid: cachedCharUuid || undefined,
      lastActive: Date.now()
    }
  }
  return null
}

export const THERMAL_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000af30-0000-1000-8000-00805f9b34fb',
  '0000e781-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffff-0000-1000-8000-00805f9b34fb',
  '000018f1-0000-1000-8000-00805f9b34fb',
]

export function isWebBluetoothSupported(): boolean {
  return typeof window !== 'undefined' && (Boolean((navigator as any)?.bluetooth) || isAndroidApp())
}

export interface AndroidPairedPrinter {
  name: string
  address: string
}

/** Mengambil daftar perangkat Bluetooth yang sudah dipairing di Pengaturan Sistem Android */
export function getAndroidPairedPrinters(): AndroidPairedPrinter[] {
  if (!isAndroidApp()) return []
  try {
    const raw = (window as any).AndroidPrinter?.getPairedPrinters?.()
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.warn('[PrinterAdapter] Failed parsing getPairedPrinters:', e)
    return []
  }
}

/** Memilih printer dari daftar Bluetooth Sistem Android */
export function selectAndroidPairedPrinter(printer: AndroidPairedPrinter): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('shapeup_pos_bt_name', printer.name)
  localStorage.setItem('shapeup_pos_bt_id', printer.address)
  persistBluetoothConnectionType()
  notifyBluetoothStatusChange(true, printer.name)
}

export function getActiveBluetoothDeviceName(): string | null {
  if (typeof window === 'undefined') return null
  const saved = localStorage.getItem('shapeup_pos_bt_name') || (activeBluetoothDevice?.name ?? null)
  if (saved) return saved
  if (isAndroidApp()) {
    const paired = getAndroidPairedPrinters()
    if (paired.length > 0) {
      const matched = paired.find((d) => {
        const n = (d.name || '').toLowerCase()
        return n.includes('print') || n.includes('pos') || n.includes('rpp') || n.includes('mpt') || n.includes('thermal')
      }) || paired[0]
      localStorage.setItem('shapeup_pos_bt_name', matched.name)
      localStorage.setItem('shapeup_pos_bt_id', matched.address)
      persistBluetoothConnectionType()
      return matched.name
    }
  }
  return null
}

export function getActiveBluetoothDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  const saved = localStorage.getItem('shapeup_pos_bt_id') || (activeBluetoothDevice?.id ?? null)
  if (saved) return saved
  if (isAndroidApp()) {
    const paired = getAndroidPairedPrinters()
    if (paired.length > 0) {
      const matched = paired.find((d) => {
        const n = (d.name || '').toLowerCase()
        return n.includes('print') || n.includes('pos') || n.includes('rpp') || n.includes('mpt') || n.includes('thermal')
      }) || paired[0]
      localStorage.setItem('shapeup_pos_bt_name', matched.name)
      localStorage.setItem('shapeup_pos_bt_id', matched.address)
      persistBluetoothConnectionType()
      return matched.address
    }
  }
  return null
}

/** Check if currently running inside ShapeUp POS Native Android APK */
export function isAndroidApp(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).AndroidPrinter)
}

/** Check if cashier primary Bluetooth printer is currently connected and writable */
export function isBluetoothPrinterConnected(): boolean {
  if (isAndroidApp()) {
    try {
      return Boolean((window as any).AndroidPrinter?.isConnected?.())
    } catch {
      return true
    }
  }
  return Boolean(activeBluetoothDevice?.gatt?.connected && activeWriteCharacteristic)
}

export type BluetoothStatusListener = (connected: boolean, deviceName: string | null) => void
const bluetoothStatusListeners = new Set<BluetoothStatusListener>()

export function subscribeBluetoothStatus(listener: BluetoothStatusListener): () => void {
  bluetoothStatusListeners.add(listener)
  // Call immediately with current state
  try {
    listener(isBluetoothPrinterConnected(), getActiveBluetoothDeviceName())
  } catch {}
  return () => {
    bluetoothStatusListeners.delete(listener)
  }
}

export function notifyBluetoothStatusChange(connected: boolean, deviceName?: string | null): void {
  const name = deviceName ?? getActiveBluetoothDeviceName()
  bluetoothStatusListeners.forEach((l) => {
    try {
      l(connected, name)
    } catch (err) {
      console.warn('[PrinterAdapter] Error in bluetooth status listener:', err)
    }
  })
}

/** Devices that already have our 'gattserverdisconnected' listener attached (prevents listener leaks). */
const devicesWithDisconnectListener = new WeakSet<object>()

const GATT_CONNECT_TIMEOUT_MS = 6000
const ADVERTISEMENT_WAIT_MS = 1500

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    promise.then(
      (val) => {
        clearTimeout(timer)
        resolve(val)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Safely disconnects the existing GATT server handle to prevent Android GATT_ERROR 133
 */
function safeTeardownGatt(device: any) {
  if (!device || !device.gatt) return
  try {
    if (!device.gatt.connected) {
      device.gatt.disconnect()
    }
  } catch {
    // Ignore teardown errors
  }
}

/**
 * Checks if current page is within a POS or cashier-facing printing route.
 */
function isPosContext(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname
  return path.startsWith('/pos') || path.startsWith('/orders')
}

/**
 * Schedules a silent auto-reconnect attempt in the background when disconnected.
 */
function scheduleSilentAutoReconnect(delayMs = 1000) {
  if (typeof window === 'undefined' || !isWebBluetoothSupported() || !hasPairedBluetoothPrinter()) return
  if (!isPosContext()) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    // If screen is off / tab hidden, do not reconnect now.
    // The visibilitychange listener will auto-reconnect as soon as screen turns on!
    return
  }

  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    try {
      if (!activeBluetoothDevice?.gatt?.connected || !activeWriteCharacteristic) {
        console.log('[PrinterAdapter] Attempting background silent auto-reconnect...')
        await ensureBluetoothPrinterConnection(false)
      }
    } catch {
      // Silent
    }
  }, delayMs)
}

/**
 * Starts a staggered round-robin heartbeat ping (ESC/POS DLE EOT 1) across all
 * active printers in the pool (Kasir, Dapur, Bar) to keep them from deep sleep.
 */
export function startBluetoothHeartbeat(): void {
  if (typeof window === 'undefined') return
  stopBluetoothHeartbeat()

  let roundRobinIndex = 0
  heartbeatTimer = setInterval(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (isPrintingBle || isConnectingGatt) return
    if (!isPosContext()) {
      stopBluetoothHeartbeat()
      return
    }

    // Collect all unique connected sessions from pool
    const activeSessions = Array.from(new Set(Array.from(bluetoothPool.values()))).filter(
      (s) => s.device?.gatt?.connected && s.writeChar
    )

    // Fallback: if pool is empty but activeBluetoothDevice exists
    if (activeSessions.length === 0) {
      if (activeBluetoothDevice?.gatt?.connected && activeWriteCharacteristic) {
        activeSessions.push({
          deviceId: activeBluetoothDevice.id || 'default',
          deviceName: activeBluetoothDevice.name || 'Bluetooth Printer',
          device: activeBluetoothDevice,
          writeChar: activeWriteCharacteristic,
          lastActive: Date.now()
        })
      } else {
        return
      }
    }

    // Staggered Round-Robin: Ping one peripheral per tick (every 12s)
    const session = activeSessions[roundRobinIndex % activeSessions.length]
    roundRobinIndex++

    // Skip ping if peripheral was already active within the last 10 seconds
    if (Date.now() - (session.lastActive || 0) < 10000) return

    try {
      // ESC/POS DLE EOT 1 (0x10, 0x04, 0x01) - Real-time status transmission.
      // 3 bytes, non-printing, non-feeding. Resets peripheral BLE idle timer.
      const ping = new Uint8Array([0x10, 0x04, 0x01])
      if (session.writeChar.properties.writeWithoutResponse) {
        await session.writeChar.writeValueWithoutResponse(ping)
      } else if (session.writeChar.properties.write) {
        await session.writeChar.writeValueWithResponse(ping)
      }
      session.lastActive = Date.now()
    } catch (err) {
      // If a print job started while ping was in-flight, ignore collision error without wiping writeChar
      if (isPrintingBle || isConnectingGatt) return
      console.warn(`[PrinterAdapter] Heartbeat failed for ${session.deviceName}:`, err)
      session.writeChar = null
      if (session.device === activeBluetoothDevice) {
        activeWriteCharacteristic = null
      }
      scheduleSilentAutoReconnect(500)
    }
  }, 12000)
}

export function stopBluetoothHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/**
 * Connects to device GATT and locates the first writable characteristic.
 * Protected with clean teardown, service/char cache, and auto-reconnect trigger on disconnect.
 */
async function connectGattAndFindWriteChar(device: any): Promise<any> {
  if (!device || !device.gatt) return null

  // Fast return if already connected
  if (device.gatt.connected && activeWriteCharacteristic && activeBluetoothDevice === device) {
    return activeWriteCharacteristic
  }

  // Teardown stale disconnected handle to prevent Android Error 133
  safeTeardownGatt(device)

  let server = device.gatt
  if (!server.connected) {
    server = await withTimeout(device.gatt.connect(), GATT_CONNECT_TIMEOUT_MS, 'GATT connect')
  }

  let writeChar: any = null

  // 1. Fast path: check cached service & characteristic first (15-30ms)
  if (cachedServiceUuid && cachedCharUuid) {
    try {
      const s = await server.getPrimaryService(cachedServiceUuid)
      const c = await s.getCharacteristic(cachedCharUuid)
      if (c && (c.properties.write || c.properties.writeWithoutResponse)) {
        writeChar = c
      }
    } catch {
      // Fallback to service scanning if cached char invalid
    }
  }

  // 2. Full scan if cached characteristic was not found
  if (!writeChar) {
    const services = await server.getPrimaryServices()
    for (const service of services) {
      try {
        const chars = await service.getCharacteristics()
        for (const char of chars) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            writeChar = char
            cachedServiceUuid = service.uuid
            cachedCharUuid = char.uuid
            try {
              localStorage.setItem('shapeup_pos_bt_service_uuid', service.uuid)
              localStorage.setItem('shapeup_pos_bt_char_uuid', char.uuid)
            } catch {}
            break
          }
        }
      } catch {
        // Continue to next service
      }
      if (writeChar) break
    }
  }

  if (writeChar && !devicesWithDisconnectListener.has(device)) {
    devicesWithDisconnectListener.add(device)
    // Listen for disconnection to reset active write characteristic and schedule immediate auto-reconnect
    device.addEventListener('gattserverdisconnected', () => {
      console.warn('[PrinterAdapter] Bluetooth GATT disconnected.')
      if (activeBluetoothDevice === device) {
        activeWriteCharacteristic = null
        notifyBluetoothStatusChange(false, device.name || null)
      }
      // Schedule silent auto-reconnect if document is visible
      scheduleSilentAutoReconnect()
    })
  }

  return writeChar
}

/**
 * Waits until the (previously permitted) device broadcasts a BLE advertisement.
 */
async function waitForAdvertisement(device: any, timeoutMs = ADVERTISEMENT_WAIT_MS): Promise<boolean> {
  if (!device || typeof device.watchAdvertisements !== 'function') {
    return true
  }

  const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null

  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (received: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      device.removeEventListener('advertisementreceived', onAdvertisement)
      try {
        abortController?.abort()
      } catch {
        // ignore
      }
      resolve(received)
    }
    const onAdvertisement = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)

    device.addEventListener('advertisementreceived', onAdvertisement)
    Promise.resolve(
      abortController
        ? device.watchAdvertisements({ signal: abortController.signal })
        : device.watchAdvertisements()
    ).catch((err: unknown) => {
      console.warn('watchAdvertisements failed:', err)
      // Still allow a direct connect attempt
      finish(true)
    })
  })
}

/**
 * Connects a known (already permitted) device:
 * 1) Direct GATT connect (fast path)
 * 2) Immediate fast retry with clean teardown (resolves Android Error 133)
 * 3) If supported, short advertisement wait (max 1500ms) as fallback.
 */
async function connectKnownDevice(device: any): Promise<any> {
  // Attempt 1: Direct connect
  try {
    const writeChar = await connectGattAndFindWriteChar(device)
    if (writeChar) return writeChar
  } catch (e) {
    console.warn('[PrinterAdapter] Direct connect attempt 1 failed:', e)
  }

  // Attempt 2: Clean teardown + quick retry after 250ms
  await new Promise((r) => setTimeout(r, 250))
  safeTeardownGatt(device)
  try {
    const writeChar = await connectGattAndFindWriteChar(device)
    if (writeChar) return writeChar
  } catch (e) {
    console.warn('[PrinterAdapter] Direct connect attempt 2 failed:', e)
  }

  // Attempt 3: If device supports watchAdvertisements, wait briefly (1500ms)
  if (typeof device.watchAdvertisements === 'function') {
    const seen = await waitForAdvertisement(device, 1500)
    if (seen) {
      safeTeardownGatt(device)
      try {
        return await connectGattAndFindWriteChar(device)
      } catch (e) {
        console.warn('[PrinterAdapter] GATT connect after advertisement failed:', e)
      }
    }
  }

  return null
}

/** True if a Bluetooth printer was paired before on this device/browser. */
export function hasPairedBluetoothPrinter(): boolean {
  return Boolean(getActiveBluetoothDeviceId() || getActiveBluetoothDeviceName())
}

/**
 * Attempts silent reconnection using the in-memory device or getDevices().
 * Falls back to interactive requestDevice() ONLY if interactive is true
 * AND the printer has never been paired before (per AGENTS.md "Zero Prompt" rule).
 * 
 * Multi-Device & Fallback Resilient:
 * - If targetDeviceId/targetDeviceName is specified, targets that specific printer.
 * - If target printer is offline/unreachable, gracefully falls back to primary cashier printer.
 * - Never prompts chooser for previously paired devices.
 */
export async function ensureBluetoothPrinterConnection(
  interactive = true,
  targetDeviceId?: string,
  targetDeviceName?: string
): Promise<{ success: boolean; deviceName?: string; deviceId?: string; isFallback?: boolean; error?: string }> {
  // Fast Path for Native Android APK Bridge
  if (isAndroidApp()) {
    const paired = getAndroidPairedPrinters()
    const savedId = targetDeviceId || getActiveBluetoothDeviceId()
    const savedName = targetDeviceName || getActiveBluetoothDeviceName()
    if (savedId || savedName) {
      return {
        success: true,
        deviceName: savedName || 'Printer Bluetooth Sistem',
        deviceId: savedId || ''
      }
    }
    if (paired.length > 0) {
      const matched = paired[0]
      selectAndroidPairedPrinter(matched)
      return {
        success: true,
        deviceName: matched.name,
        deviceId: matched.address
      }
    }
    return {
      success: false,
      error: 'Belum ada printer yang dipasangkan di Bluetooth Sistem Android. Buka Pengaturan Bluetooth HP/Tablet dan pasangkan printer terlebih dahulu.'
    }
  }

  if (!isWebBluetoothSupported()) {
    return { success: false, error: 'Web Bluetooth tidak didukung pada peramban ini. Gunakan Chrome pada Android atau Komputer.' }
  }

  // Mutex check: prevent re-entrant simultaneous connect attempts
  if (isConnectingGatt) {
    let waitCount = 0
    while (isConnectingGatt && waitCount < 15) {
      await new Promise((r) => setTimeout(r, 200))
      waitCount++
    }
  }

  const lookupKey = targetDeviceId || targetDeviceName

  // 1. Fast check if requested target (or default) is already alive in connection pool
  if (lookupKey && bluetoothPool.has(lookupKey)) {
    const existing = bluetoothPool.get(lookupKey)!
    if (existing.device?.gatt?.connected && existing.writeChar) {
      return { success: true, deviceName: existing.deviceName, deviceId: existing.deviceId }
    }
  } else if (!lookupKey && activeBluetoothDevice?.gatt?.connected && activeWriteCharacteristic) {
    return { success: true, deviceName: activeBluetoothDevice.name || 'Bluetooth Printer', deviceId: activeBluetoothDevice.id }
  }

  isConnectingGatt = true
  try {
    let hasDeviceHandle = false

    // 2. Try reconnecting in-memory candidate device
    let candidateDevice: any = null
    if (lookupKey && bluetoothPool.has(lookupKey)) {
      candidateDevice = bluetoothPool.get(lookupKey)?.device
    } else if (!lookupKey && activeBluetoothDevice?.gatt) {
      candidateDevice = activeBluetoothDevice
    }

    if (candidateDevice?.gatt) {
      hasDeviceHandle = true
      const writeChar = await connectKnownDevice(candidateDevice)
      if (writeChar) {
        const session = registerInPool(candidateDevice, writeChar)
        if (!lookupKey || candidateDevice === activeBluetoothDevice) {
          activeBluetoothDevice = candidateDevice
          activeWriteCharacteristic = writeChar
          persistBluetoothConnectionType()
          notifyBluetoothStatusChange(true, session.deviceName)
        }
        startBluetoothHeartbeat()
        return { success: true, deviceName: session.deviceName, deviceId: session.deviceId }
      }
    }

    // 3. Silent reconnect via navigator.bluetooth.getDevices() (No popup required)
    const navBt = (navigator as any).bluetooth
    if (navBt && typeof navBt.getDevices === 'function') {
      try {
        const permittedDevices: any[] = await navBt.getDevices()
        if (permittedDevices && permittedDevices.length > 0) {
          let matchedDevice: any = null

          if (targetDeviceId) {
            matchedDevice = permittedDevices.find((d: any) => d.id === targetDeviceId)
          }
          if (!matchedDevice && targetDeviceName) {
            matchedDevice = permittedDevices.find((d: any) => d.name === targetDeviceName)
          }

          // If no specific target was requested (legacy / cashier call), use saved ID or Name
          if (!matchedDevice && !lookupKey) {
            const savedId = getActiveBluetoothDeviceId()
            const savedName = getActiveBluetoothDeviceName()
            if (savedId) matchedDevice = permittedDevices.find((d: any) => d.id === savedId)
            if (!matchedDevice && savedName) matchedDevice = permittedDevices.find((d: any) => d.name === savedName)
            if (!matchedDevice && permittedDevices.length === 1) matchedDevice = permittedDevices[0]
          }

          if (matchedDevice) {
            hasDeviceHandle = true
            if (!lookupKey && !activeBluetoothDevice) {
              activeBluetoothDevice = matchedDevice
            }
            const writeChar = await connectKnownDevice(matchedDevice)
            if (writeChar) {
              const session = registerInPool(matchedDevice, writeChar)
              if (!lookupKey || matchedDevice === activeBluetoothDevice || (!activeBluetoothDevice && permittedDevices.length === 1)) {
                activeBluetoothDevice = matchedDevice
                activeWriteCharacteristic = writeChar
                const name = matchedDevice.name || 'Bluetooth Thermal Printer'
                localStorage.setItem('shapeup_pos_bt_name', name)
                if (matchedDevice.id) localStorage.setItem('shapeup_pos_bt_id', matchedDevice.id)
                persistBluetoothConnectionType()
                notifyBluetoothStatusChange(true, name)
              }
              startBluetoothHeartbeat()
              return { success: true, deviceName: session.deviceName, deviceId: session.deviceId }
            }
          }
        }
      } catch (err) {
        console.warn('Silent bluetooth reconnection failed:', err)
      }
    }

    // 4. RESILIENT FALLBACK: If specific station printer (e.g. Dapur) is unreachable,
    // fallback gracefully to primary cashier printer if it is connected!
    if (lookupKey && activeBluetoothDevice?.gatt?.connected && activeWriteCharacteristic) {
      console.warn(`[PrinterAdapter] Specific target printer "${lookupKey}" unavailable. Gracefully falling back to primary cashier printer.`)
      return {
        success: true,
        deviceName: activeBluetoothDevice.name || 'Printer Kasir (Fallback)',
        deviceId: activeBluetoothDevice.id,
        isFallback: true
      }
    }

    // 5. Prompt chooser if interactive is true AND either never paired OR browser lost the BluetoothDevice handle
    if (interactive && (!hasPairedBluetoothPrinter() || !hasDeviceHandle)) {
      return requestAndConnectBluetoothPrinter()
    }

    return {
      success: false,
      error: `Printer Bluetooth ${targetDeviceName ? `"${targetDeviceName}" ` : ''}belum terhubung. Pastikan printer menyala di dekat tablet.`
    }
  } finally {
    isConnectingGatt = false
  }
}

/**
 * Warm-up: silently reconnect all registered printers (cashier + station printers)
 * in the background so all prints are instant. Never prompts.
 */
export async function warmUpBluetoothPrinter(): Promise<void> {
  if (typeof window === 'undefined' || !isWebBluetoothSupported() || !hasPairedBluetoothPrinter()) return
  try {
    // 1. Warm up primary cashier printer
    await ensureBluetoothPrinterConnection(false)

    // 2. Warm up other station bluetooth printers from cached stations
    try {
      const cachedStations = localStorage.getItem('shapeup_pos_stations')
      if (cachedStations) {
        const stations = JSON.parse(cachedStations)
        if (Array.isArray(stations)) {
          for (const st of stations) {
            if (st.printer_connection_type === 'bluetooth' && (st.printer_device_id || st.printer_name)) {
              void ensureBluetoothPrinterConnection(false, st.printer_device_id, st.printer_name).catch(() => {})
            }
          }
        }
      }
    } catch {}
  } catch {
    // Silent by design
  }
}

/**
 * Automatically initializes visibility & focus listeners so that the instant
 * the user turns on the screen ("layar hidup") or focuses the tab, the printer
 * is reconnected silently BEFORE the user clicks "Cetak".
 */
let lifecycleListenersAttached = false
export function initBluetoothLifecycleListeners(): void {
  if (typeof window === 'undefined' || lifecycleListenersAttached) return
  lifecycleListenersAttached = true

  const handleWakeUp = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      if (hasPairedBluetoothPrinter() && isPosContext()) {
        console.log('[PrinterAdapter] Screen on / tab visible in POS: Proactively warming up Bluetooth printer...')
        void warmUpBluetoothPrinter()
        startBluetoothHeartbeat()
      }
    } else {
      stopBluetoothHeartbeat()
    }
  }

  document.addEventListener('visibilitychange', handleWakeUp)
  window.addEventListener('focus', () => {
    if (hasPairedBluetoothPrinter() && isPosContext() && (!activeBluetoothDevice?.gatt?.connected || !activeWriteCharacteristic)) {
      void warmUpBluetoothPrinter()
    }
  })

  // Start heartbeat only if already in POS context
  if (hasPairedBluetoothPrinter() && isPosContext()) {
    startBluetoothHeartbeat()
  }
}

// Auto-run on module load in client environment
if (typeof window !== 'undefined') {
  initBluetoothLifecycleListeners()
}

export async function getSystemPrinters(): Promise<{
  supported: boolean
  printers: Array<{ name: string; isDefault?: boolean }>
  error?: string
}> {
  if (typeof window === 'undefined') {
    return { supported: false, printers: [] }
  }

  // 1. Try window.queryLocalPrinters (Chromium Web Printing API)
  if ('queryLocalPrinters' in window && typeof (window as any).queryLocalPrinters === 'function') {
    try {
      const list = await (window as any).queryLocalPrinters()
      const formatted = (list || []).map((p: any) => ({
        name: p.name || 'Printer Lokal Komputer',
        isDefault: Boolean(p.isDefault)
      }))
      return { supported: true, printers: formatted }
    } catch (err: any) {
      console.warn('[PrinterAdapter] queryLocalPrinters error:', err)
      return { supported: false, printers: [], error: err.message }
    }
  }

  // 2. Try navigator.printers if available
  if ('printers' in navigator && typeof (navigator as any).printers?.getPrinters === 'function') {
    try {
      const list = await (navigator as any).printers.getPrinters()
      const formatted = (list || []).map((p: any) => ({
        name: p.name || 'Printer Lokal Komputer',
        isDefault: Boolean(p.isDefault)
      }))
      return { supported: true, printers: formatted }
    } catch (err: any) {
      console.warn('[PrinterAdapter] navigator.printers error:', err)
      return { supported: false, printers: [], error: err.message }
    }
  }

  return { supported: false, printers: [] }
}

export async function requestAndConnectBluetoothPrinter(): Promise<{ success: boolean; deviceName?: string; deviceId?: string; error?: string }> {
  // Fast Path for Native Android APK Bridge (Read directly from Android System Bluetooth)
  if (isAndroidApp()) {
    const paired = getAndroidPairedPrinters()
    if (paired.length === 0) {
      return {
        success: false,
        error: 'Belum ada perangkat Bluetooth yang dipasangkan di Sistem Android. Silakan buka Pengaturan Bluetooth HP/Tablet Anda dan pasangkan printer terlebih dahulu.'
      }
    }
    const matched = paired.find((d) => {
      const n = (d.name || '').toLowerCase()
      return n.includes('print') || n.includes('pos') || n.includes('rpp') || n.includes('mpt') || n.includes('thermal')
    }) || paired[0]
    selectAndroidPairedPrinter(matched)
    return {
      success: true,
      deviceName: matched.name,
      deviceId: matched.address
    }
  }

  if (!isWebBluetoothSupported()) {
    return { success: false, error: 'Web Bluetooth tidak didukung pada peramban ini. Pastikan menggunakan Chrome pada Android atau Komputer.' }
  }

  try {
    const device = await (navigator as any).bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: THERMAL_PRINTER_SERVICES
    })

    if (!device) {
      return { success: false, error: 'Pencarian printer dibatalkan' }
    }

    const writeChar = await connectGattAndFindWriteChar(device)
    if (!writeChar) {
      return { success: false, error: 'Karakteristik cetak printer tidak ditemukan pada perangkat Bluetooth ini.' }
    }

    activeBluetoothDevice = device
    activeWriteCharacteristic = writeChar
    registerInPool(device, writeChar)
    const name = device.name || 'Bluetooth Thermal Printer'
    localStorage.setItem('shapeup_pos_bt_name', name)
    if (device.id) {
      localStorage.setItem('shapeup_pos_bt_id', device.id)
    }
    persistBluetoothConnectionType()
    notifyBluetoothStatusChange(true, name)
    startBluetoothHeartbeat()

    return { success: true, deviceName: name, deviceId: device.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal menghubungkan printer bluetooth' }
  }
}

/**
 * Detects if an ESC/POS payload begins with `ESC @` + `ESC a 1` + `GS v 0` (Raster Bit Image Logo).
 * Returns the exact byte offset right after the logo (including its trailing LF) so the sender
 * can let the thermal printhead finish burning the dense bitmap and drain the 4KB hardware RX buffer
 * before streaming the rest of the receipt text.
 */
function findEscPosLogoSplitOffset(payload: Uint8Array): number {
  if (
    payload.length > 20 &&
    payload[0] === 0x1B &&
    payload[1] === 0x40 &&
    payload[2] === 0x1B &&
    payload[3] === 0x61 &&
    payload[4] === 0x01 &&
    payload[5] === 0x1D &&
    payload[6] === 0x76 &&
    payload[7] === 0x30 &&
    payload[8] === 0x00
  ) {
    const widthBytes = payload[9] | (payload[10] << 8)
    const height = payload[11] | (payload[12] << 8)
    const rasterLen = widthBytes * height
    if (rasterLen > 0) {
      let endIdx = 13 + rasterLen
      if (endIdx < payload.length && payload[endIdx] === 0x0A) {
        endIdx += 1
      }
      if (endIdx < payload.length) {
        return endIdx
      }
    }
  }
  return 0
}

function uint8SliceToBase64(slice: Uint8Array): string {
  let binaryStr = ''
  const len = slice.byteLength
  for (let i = 0; i < len; i++) {
    binaryStr += String.fromCharCode(slice[i])
  }
  return btoa(binaryStr)
}

async function writeBleChunkWithRetry(charToSend: any, chunk: Uint8Array, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (charToSend.properties.write) {
        await charToSend.writeValueWithResponse(chunk)
      } else {
        await charToSend.writeValueWithoutResponse(chunk)
      }
      return
    } catch (err) {
      if (attempt === maxRetries) throw err
      // Give the thermal printer's 4KB BLE RX buffer time to drain before retrying the exact chunk
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
  }
}

async function sendBleSegmentFlowControlled(
  charToSend: any,
  segment: Uint8Array,
  isAfterDenseLogo = false
): Promise<void> {
  // 64-byte chunks guarantee 100% compatibility with all legacy/budget BLE thermal printer MTUs
  const CHUNK_SIZE = 64
  const DRAIN_INTERVAL_BYTES = 1024
  // If the entire segment is a short/standard receipt (<= 1.2KB) and not immediately after a dense logo,
  // it fits completely inside the printer's 4KB RAM buffer -> use Fast Burst (10ms).
  // Once a receipt exceeds 1KB (long receipt 15-100+ items) or follows a dense logo,
  // switch strictly to Motor-Matched Pacing (40ms + 220ms breather per 1KB) so the 4KB buffer NEVER overflows or clips!
  const isShortBurstSafe = !isAfterDenseLogo && segment.length <= 1280
  let bytesSinceLastDrain = 0

  for (let i = 0; i < segment.length; i += CHUNK_SIZE) {
    const chunk = segment.slice(i, i + CHUNK_SIZE)
    await writeBleChunkWithRetry(charToSend, chunk)
    bytesSinceLastDrain += chunk.length

    if (i + CHUNK_SIZE < segment.length) {
      if (bytesSinceLastDrain >= DRAIN_INTERVAL_BYTES) {
        // Mandatory 220ms breather every 1KB so the physical paper motor drains the 4KB hardware buffer on long receipts
        bytesSinceLastDrain = 0
        await new Promise((resolve) => setTimeout(resolve, 220))
      } else {
        const delayMs = isShortBurstSafe
          ? 10
          : (i < DRAIN_INTERVAL_BYTES && !isAfterDenseLogo ? 18 : 40)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
}

export async function sendBluetoothRawBytes(
  payload: Uint8Array,
  targetDeviceId?: string,
  targetDeviceName?: string
): Promise<PrintResult> {
  const logoSplitOffset = findEscPosLogoSplitOffset(payload)

  // 1. Android APK Native SPP Bridge (Fast Path, Flow-Controlled for 4KB Buffer, Anti Sleep & Anti Clip)
  if (isAndroidApp()) {
    try {
      const isMacFormat = targetDeviceId && targetDeviceId.includes(':')
      const targetMacOrName =
        (isMacFormat ? targetDeviceId : targetDeviceName) ||
        targetDeviceId ||
        getActiveBluetoothDeviceId() ||
        getActiveBluetoothDeviceName() ||
        ''

      const sendAndroidSegment = async (segment: Uint8Array, chunkSize: number, delayMs: number): Promise<PrintResult> => {
        for (let i = 0; i < segment.length; i += chunkSize) {
          const chunk = segment.slice(i, i + chunkSize)
          const base64Data = uint8SliceToBase64(chunk)
          const resultStr = (window as any).AndroidPrinter.print(base64Data, targetMacOrName)
          const ok = resultStr === 'SUCCESS' || (typeof resultStr === 'string' && resultStr.startsWith('SUCCESS'))
          if (!ok) {
            return { success: false, message: resultStr || 'Gagal mengirim cetak ke Android Native Printer.' }
          }
          if (i + chunkSize < segment.length && delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs))
          }
        }
        return { success: true }
      }

      if (logoSplitOffset > 0) {
        const logoPart = payload.slice(0, logoSplitOffset)
        const textPart = payload.slice(logoSplitOffset)
        const logoRes = await sendAndroidSegment(logoPart, logoPart.length, 0)
        if (!logoRes.success) return logoRes
        // Wait 400ms so thermal printhead finishes burning the bitmap logo & drains the 4KB hardware buffer
        await new Promise((r) => setTimeout(r, 400))
        const textRes = await sendAndroidSegment(textPart, 1024, 140)
        if (!textRes.success) return textRes
      } else {
        // Short receipt (<= 1024 bytes) sends in 1 single instant call (0ms delay);
        // Long receipt (> 1024 bytes) paces 140ms between 1KB blocks so 4KB buffer never clips
        const res = await sendAndroidSegment(payload, 1024, 140)
        if (!res.success) return res
      }

      return { success: true, message: '✓ Struk berhasil dicetak via Bluetooth Sistem Android.' }
    } catch (err: any) {
      console.warn('[PrinterAdapter] AndroidPrinter error, falling back to Web Bluetooth:', err)
    }
  }

  if (typeof window === 'undefined' || !isWebBluetoothSupported()) {
    return { success: false, message: 'Web Bluetooth tidak didukung pada peramban ini.' }
  }

  isPrintingBle = true
  try {
    const hasPaired = hasPairedBluetoothPrinter()
    if (!hasPaired) {
      const pairRes = await requestAndConnectBluetoothPrinter()
      if (!pairRes.success) {
        return { success: false, message: pairRes.error || 'Printer Bluetooth belum dipasangkan.' }
      }
    }

    let connRes = await ensureBluetoothPrinterConnection(false, targetDeviceId, targetDeviceName)
    if (!connRes.success) {
      // One quick retry for sleeping peripheral
      await new Promise((r) => setTimeout(r, 300))
      connRes = await ensureBluetoothPrinterConnection(false, targetDeviceId, targetDeviceName)
    }

    if (!connRes.success) {
      return {
        success: false,
        needsBluetoothReconnect: hasPairedBluetoothPrinter(),
        message: connRes.error || 'Printer Bluetooth tidak terhubung.'
      }
    }

    // Resolve target write characteristic from pool session or primary active
    let charToSend = activeWriteCharacteristic
    let activeSession: BluetoothDeviceSession | undefined
    const lookupKey = targetDeviceId || targetDeviceName
    if (lookupKey && bluetoothPool.has(lookupKey)) {
      activeSession = bluetoothPool.get(lookupKey)
      if (activeSession?.writeChar) charToSend = activeSession.writeChar
    }

    if (!charToSend) {
      return {
        success: false,
        needsBluetoothReconnect: hasPairedBluetoothPrinter(),
        message: 'Karakteristik cetak printer tidak tersedia.'
      }
    }

    if (logoSplitOffset > 0) {
      const logoPart = payload.slice(0, logoSplitOffset)
      const textPart = payload.slice(logoSplitOffset)
      await sendBleSegmentFlowControlled(charToSend, logoPart, false)
      // Wait 450ms after dense logo bitmap so the printhead finishes stepping and empties the 4KB buffer
      await new Promise((resolve) => setTimeout(resolve, 450))
      await sendBleSegmentFlowControlled(charToSend, textPart, true)
    } else {
      await sendBleSegmentFlowControlled(charToSend, payload, false)
    }

    if (activeSession) {
      activeSession.lastActive = Date.now()
    }

    return {
      success: true,
      message: connRes.isFallback
        ? `Data cetak dialihkan ke ${connRes.deviceName} (Fallback)`
        : '✓ Struk berhasil dicetak via Bluetooth.'
    }
  } catch (err: any) {
    return {
      success: false,
      needsBluetoothReconnect: hasPairedBluetoothPrinter(),
      message: 'Gagal mengirim data ke printer Bluetooth: ' + (err.message || 'Error')
    }
  } finally {
    isPrintingBle = false
  }
}

export async function testPrintStationTicket(options: {
  stationName: string
  connectionType: 'system' | 'bluetooth' | 'same_as_cashier' | 'lan'
  printerName?: string
  paperSize?: PaperSize
  soundBuzzer?: boolean
  autoCut?: boolean
}): Promise<PrintResult> {
  const effectiveSize = options.paperSize || '58mm'
  const dims = resolvePaperDimensions(effectiveSize)

  let effectiveConn = isAndroidApp() ? 'bluetooth' : options.connectionType
  if (effectiveConn === 'same_as_cashier' && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('shapeup_pos_receipt_settings')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.connectionType === 'bluetooth') effectiveConn = 'bluetooth'
      } else if (hasPairedBluetoothPrinter()) {
        effectiveConn = 'bluetooth'
      }
    } catch {}
  }

  if (effectiveConn === 'bluetooth') {
    const nowStr = new Date().toLocaleTimeString('id-ID')
    const btCols = resolveBluetoothEscPosColumns(effectiveSize)
    const dividerLine = '-'.repeat(btCols) + '\n'
    const sampleChitText = [
      '\x1B\x40', // ESC @ init
      '\x1B\x61\x01', // Center
      '\x1D\x21\x11', // Double height & width
      `[STASIUN: ${options.stationName.toUpperCase()}]\n`,
      '\x1D\x21\x00', // Normal
      `Printer: ${options.printerName || 'Bluetooth Thermal'}\n`,
      `Kertas: ${dims.displayLabel} (${btCols} char)\n`,
      `Waktu Uji: ${nowStr}\n`,
      dividerLine,
      '\x1B\x61\x00', // Left
      '1x TES KONEKSI STASIUN PRODUKSI\n',
      '   * Status: TERHUBUNG (OK)\n',
      '   * Routing Menu: AKTIF\n',
      dividerLine,
      '\x1B\x61\x01',
      'SHAPEUP POS KITCHEN DISPATCHER\n\n\n'
    ]

    if (options.soundBuzzer) {
      sampleChitText.push('\x1B\x42\x02\x02') // Beep 2x
    }
    if (options.autoCut) {
      sampleChitText.push('\x1D\x56\x41\x03') // Cut
    }

    const encoder = new TextEncoder()
    const payload = encoder.encode(sampleChitText.join(''))
    return sendBluetoothRawBytes(payload, undefined, options.printerName)
  }

  // System print iframe
  if (typeof window === 'undefined') {
    return { success: false, message: 'Window tidak tersedia' }
  }

  return new Promise((resolve) => {
    try {
      let iframe = document.getElementById('pos-station-test-print-iframe') as HTMLIFrameElement | null
      if (!iframe) {
        iframe = document.createElement('iframe')
        iframe.id = 'pos-station-test-print-iframe'
        iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;')
        document.body.appendChild(iframe)
      }

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (!iframeDoc) {
        resolve({ success: false, message: 'Gagal mengakses printer sistem' })
        return
      }

      const width = dims.cssContainerWidth
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Uji Cetak Stasiun ${options.stationName}</title>
  <style>
    @page { size: ${dims.cssPageSize}; margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; width: ${width}; margin: 0 auto; padding: ${dims.cssPadding}; font-size: ${dims.cssKitchenFontSize}; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .border { border-top: 1px dashed #000; border-bottom: 1px dashed #000; margin: 6px 0; padding: 4px 0; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size: 15px;">[STASIUN: ${options.stationName.toUpperCase()}]</div>
  <div class="center" style="font-size: 11px;">Printer Sistem: ${options.printerName || 'Default Komputer'}</div>
  <div class="center" style="font-size: 10px;">${new Date().toLocaleString('id-ID')}</div>
  <div class="border">
    <div><b>1x UJI COBA PRINTER SISTEM</b></div>
    <div style="font-size: 11px;">• Status: SIAP MENCETAK TIKET</div>
    <div style="font-size: 11px;">• Kertas: ${dims.displayLabel} (Efektif ${dims.printableWidthMm}mm)</div>
    ${options.soundBuzzer ? '<div style="font-size: 10px;">• Buzzer: Aktif 🔔</div>' : ''}
    ${options.autoCut ? '<div style="font-size: 10px;">• Auto-Cut: Aktif ✂️</div>' : ''}
  </div>
  <div class="center" style="font-size: 10px; margin-top: 8px;">SHAPEUP POS - STASIUN PRODUKSI</div>
</body>
</html>`

      iframeDoc.open()
      iframeDoc.write(html)
      iframeDoc.close()

      setTimeout(() => {
        try {
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.focus()
            iframe.contentWindow.print()
            resolve({ success: true, message: `Uji cetak stasiun ${options.stationName} dikirim ke printer.` })
          } else {
            resolve({ success: false, message: 'Gagal memicu cetak' })
          }
        } catch (e: any) {
          resolve({ success: false, message: e.message || 'Error cetak' })
        }
      }, 300)
    } catch (err: any) {
      resolve({ success: false, message: err.message || 'Gagal membuat dokumen cetak' })
    }
  })
}

export async function disconnectBluetoothPrinter(): Promise<void> {
  stopBluetoothHeartbeat()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (activeBluetoothDevice && activeBluetoothDevice.gatt?.connected) {
    try {
      activeBluetoothDevice.gatt.disconnect()
    } catch {}
  }
  activeBluetoothDevice = null
  activeWriteCharacteristic = null
  cachedServiceUuid = null
  cachedCharUuid = null
  if (typeof window !== 'undefined') {
    localStorage.removeItem('shapeup_pos_bt_name')
    localStorage.removeItem('shapeup_pos_bt_id')
    localStorage.removeItem('shapeup_pos_bt_service_uuid')
    localStorage.removeItem('shapeup_pos_bt_char_uuid')
  }
  notifyBluetoothStatusChange(false, null)
}

export async function sendBluetoothTestPrint(): Promise<PrintResult> {
  const testReceipt: ReceiptData = {
    businessName: 'SHAPEUP POS',
    businessAddress: 'Printer Test Configuration',
    businessPhone: '0812-3456-7890',
    orderNumber: 'TEST-0001',
    date: '20-10-2026 12:00',
    cashierName: 'Admin POS',
    customerName: 'Uji Coba Printer',
    items: [
      {
        name: 'Koneksi Bluetooth Berhasil',
        quantity: 1,
        price: 0,
        subtotal: 0
      }
    ],
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 0,
    paymentMethod: 'TEST PRINT',
    note: 'Printer bluetooth siap digunakan untuk transaksi kasir.'
  }
  const adapter = new WebBluetoothPrinterAdapter()
  return adapter.print(testReceipt, '58mm')
}

// 1. Browser System Print Adapter
export class BrowserSystemPrinterAdapter implements PrinterAdapter {
  async discover(): Promise<PrinterDevice[]> {
    return [{
      id: 'system-default',
      name: 'Printer Sistem (Browser/OS / Kabel USB / RawBT)',
      connectionType: 'system',
      paperSize: '58mm',
      isDefault: true,
      status: 'connected'
    }]
  }

  async connect(deviceId: string): Promise<void> {
    return Promise.resolve()
  }

  async disconnect(): Promise<void> {
    return Promise.resolve()
  }

  async getStatus(): Promise<PrinterStatus> {
    return { online: true }
  }

  async print(receipt: ReceiptData, paperSize?: PaperSize): Promise<PrintResult> {
    const size = paperSize || receipt.paperSize || '58mm'
    // In Native Android APK, WebView does not support window.print(); always route to Native Bluetooth Bridge
    if (isAndroidApp()) {
      const btAdapter = new WebBluetoothPrinterAdapter()
      return btAdapter.print(receipt, size)
    }
    return printReceiptViaIframe(receipt, size)
  }
}

// 2. PDF Export Printer Adapter
export class PDFExportPrinterAdapter implements PrinterAdapter {
  async discover(): Promise<PrinterDevice[]> {
    return [{
      id: 'pdf-export',
      name: 'Export / Download PDF',
      connectionType: 'pdf',
      paperSize: 'A4',
      status: 'connected'
    }]
  }

  async connect(): Promise<void> {
    return Promise.resolve()
  }

  async disconnect(): Promise<void> {
    return Promise.resolve()
  }

  async getStatus(): Promise<PrinterStatus> {
    return { online: true }
  }

  async print(receipt: ReceiptData, paperSize?: PaperSize): Promise<PrintResult> {
    const size = paperSize || receipt.paperSize || 'A4'
    return printReceiptViaIframe(receipt, size)
  }
}

// 3. Web Bluetooth Thermal Printer Adapter (58mm / 80mm Direct ESC/POS)
export class WebBluetoothPrinterAdapter implements PrinterAdapter {
  async discover(): Promise<PrinterDevice[]> {
    const name = getActiveBluetoothDeviceName()
    if (name) {
      return [{
        id: 'bt-paired',
        name: name,
        connectionType: 'bluetooth',
        paperSize: '58mm',
        status: activeWriteCharacteristic ? 'connected' : 'disconnected'
      }]
    }
    return []
  }

  async connect(deviceId: string): Promise<void> {
    const res = await requestAndConnectBluetoothPrinter()
    if (!res.success) {
      throw new Error(res.error || 'Gagal menyambungkan Bluetooth printer')
    }
  }

  async disconnect(): Promise<void> {
    await disconnectBluetoothPrinter()
  }

  async getStatus(): Promise<PrinterStatus> {
    const isConnected = Boolean(activeBluetoothDevice?.gatt?.connected && activeWriteCharacteristic)
    return { online: isConnected }
  }

  async print(receipt: ReceiptData, paperSize?: PaperSize): Promise<PrintResult> {
    const effectiveSize = paperSize || receipt.paperSize || '58mm'
    const payload = encodeReceiptToEscPos(receipt, effectiveSize)
    return sendBluetoothRawBytes(payload)
  }
}

// Helper factory to get active printer adapter
export function getPrinterAdapter(type: ConnectionType = 'system'): PrinterAdapter {
  // In Native Android APK, always route thermal printing to Bluetooth Bridge unless exporting PDF
  if (isAndroidApp() && type !== 'pdf') {
    return new WebBluetoothPrinterAdapter()
  }
  switch (type) {
    case 'bluetooth':
      return new WebBluetoothPrinterAdapter()
    case 'pdf':
      return new PDFExportPrinterAdapter()
    case 'system':
    case 'lan':
    default:
      return new BrowserSystemPrinterAdapter()
  }
}
