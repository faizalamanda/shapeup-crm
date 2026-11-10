// ShapeUp POS Hardware-Agnostic Printer Abstraction Layer

export type PaperSize = '58mm' | '80mm' | 'A4'
export type ConnectionType = 'bluetooth' | 'lan' | 'system' | 'pdf'

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
  const is58mm = effectivePaperSize === '58mm'
  const is80mm = effectivePaperSize === '80mm'

  // Thermal sizing: 58mm roll printable width is 48mm; 80mm roll printable width is 72mm
  const pageSizeCss = is58mm ? '58mm auto' : is80mm ? '80mm auto' : 'A4 portrait'
  const containerWidth = is58mm ? '48mm' : is80mm ? '72mm' : '180mm'
  const fontSize = is58mm ? '11px' : is80mm ? '13px' : '13px'
  const containerPadding = is58mm ? '2mm 1mm' : is80mm ? '4mm 2mm' : '15mm 10mm'
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

  const itemsHtml = (receipt.items || []).map((item, idx) => {
    const itemNumberPrefix = receipt.showItemNumbering ? `${idx + 1}. ` : ''
    const detailPadding = receipt.showItemNumbering ? '12px' : '4px'
    const variantHtml = item.variant
      ? `<div style="padding-left: ${detailPadding}; font-size: 0.9em; color: #444; margin-top: 1px;">• ${escapeHtml(item.variant)}</div>`
      : ''
    const noteHtml = item.note
      ? `<div style="padding-left: ${detailPadding}; font-size: 0.85em; font-style: italic; color: #555; margin-top: 1px;">• ${escapeHtml(item.note)}</div>`
      : ''
    const discountHtml = item.discount && item.discount > 0
      ? `<div style="display: flex; justify-content: space-between; font-size: 0.9em; color: #555; padding-left: ${detailPadding}; margin-top: 1px;"><span>Diskon:</span><span>-${item.discount.toLocaleString('id-ID')}</span></div>`
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
        <div style="font-size: 0.85em; text-transform: uppercase; margin-bottom: 2px; letter-spacing: 0.3px; color: #444;">Catatan Pesanan:</div>
        <div style="padding: 4px 6px; background-color: #f7f7f7; border: 1px dashed #777; word-break: break-word;">
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
    <div style="text-align: center; margin-top: 8px; font-size: 0.9em; color: #222;">
      <div>${footerNoteContent}</div>
      <div style="font-size: 0.8em; color: #555; margin-top: 6px;">Powered by ShapeUp POS</div>
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
export function encodeReceiptToEscPos(receipt: ReceiptData, paperSize?: PaperSize): Uint8Array {
  const effectivePaperSize = paperSize || receipt.paperSize || '58mm'
  const is80mm = effectivePaperSize === '80mm'
  const width = is80mm ? 48 : 32
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
let reconnectTimer: any = null
let heartbeatTimer: any = null
let cachedServiceUuid: string | null = null
let cachedCharUuid: string | null = null

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
    // 2. Try reconnecting in-memory candidate device
    let candidateDevice: any = null
    if (lookupKey && bluetoothPool.has(lookupKey)) {
      candidateDevice = bluetoothPool.get(lookupKey)?.device
    } else if (!lookupKey && activeBluetoothDevice?.gatt) {
      candidateDevice = activeBluetoothDevice
    }

    if (candidateDevice?.gatt) {
      const writeChar = await connectKnownDevice(candidateDevice)
      if (writeChar) {
        const session = registerInPool(candidateDevice, writeChar)
        if (!lookupKey || candidateDevice === activeBluetoothDevice) {
          activeBluetoothDevice = candidateDevice
          activeWriteCharacteristic = writeChar
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
            const writeChar = await connectKnownDevice(matchedDevice)
            if (writeChar) {
              const session = registerInPool(matchedDevice, writeChar)
              if (!lookupKey || matchedDevice === activeBluetoothDevice || (!activeBluetoothDevice && permittedDevices.length === 1)) {
                activeBluetoothDevice = matchedDevice
                activeWriteCharacteristic = writeChar
                const name = matchedDevice.name || 'Bluetooth Thermal Printer'
                localStorage.setItem('shapeup_pos_bt_name', name)
                if (matchedDevice.id) localStorage.setItem('shapeup_pos_bt_id', matchedDevice.id)
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

    // 5. Prompt ONLY if allowed AND the printer has never been paired before
    if (interactive && !hasPairedBluetoothPrinter()) {
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
    const name = device.name || 'Bluetooth Thermal Printer'
    localStorage.setItem('shapeup_pos_bt_name', name)
    if (device.id) {
      localStorage.setItem('shapeup_pos_bt_id', device.id)
    }
    notifyBluetoothStatusChange(true, name)
    startBluetoothHeartbeat()

    return { success: true, deviceName: name, deviceId: device.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal menghubungkan printer bluetooth' }
  }
}

export async function sendBluetoothRawBytes(
  payload: Uint8Array,
  targetDeviceId?: string,
  targetDeviceName?: string
): Promise<PrintResult> {
  // 1. Android APK Native SPP Bridge (Fast Path, Zero Drops, Anti Sleep)
  if (isAndroidApp()) {
    try {
      let binaryStr = ''
      const len = payload.byteLength
      for (let i = 0; i < len; i++) {
        binaryStr += String.fromCharCode(payload[i])
      }
      const base64Data = btoa(binaryStr)
      const isMacFormat = targetDeviceId && targetDeviceId.includes(':')
      const targetMacOrName = (isMacFormat ? targetDeviceId : targetDeviceName) || targetDeviceId || getActiveBluetoothDeviceId() || getActiveBluetoothDeviceName() || ''
      const resultStr = (window as any).AndroidPrinter.print(base64Data, targetMacOrName)
      if (resultStr === 'SUCCESS' || (typeof resultStr === 'string' && resultStr.startsWith('SUCCESS'))) {
        return { success: true, message: 'Data cetak berhasil dikirim via Android Native Driver.' }
      } else {
        return { success: false, message: resultStr || 'Gagal mengirim cetak ke Android Native Printer.' }
      }
    } catch (err: any) {
      console.warn('[PrinterAdapter] AndroidPrinter error, falling back to Web Bluetooth:', err)
    }
  }

  if (typeof window === 'undefined' || !isWebBluetoothSupported()) {
    return { success: false, message: 'Web Bluetooth tidak didukung pada peramban ini.' }
  }

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
      await new Promise((r) => setTimeout(r, 350))
      connRes = await ensureBluetoothPrinterConnection(false, targetDeviceId, targetDeviceName)
    }

    if (!connRes.success) {
      return { success: false, message: connRes.error || 'Printer Bluetooth tidak terhubung.' }
    }

    // Resolve target write characteristic from pool session or primary active
    let charToSend = activeWriteCharacteristic
    const lookupKey = targetDeviceId || targetDeviceName
    if (lookupKey && bluetoothPool.has(lookupKey)) {
      const session = bluetoothPool.get(lookupKey)
      if (session?.writeChar) charToSend = session.writeChar
    }

    if (!charToSend) {
      return { success: false, message: 'Karakteristik cetak printer tidak tersedia.' }
    }

    const CHUNK_SIZE = 64
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const chunk = payload.slice(i, i + CHUNK_SIZE)
      if (charToSend.properties.write) {
        await charToSend.writeValueWithResponse(chunk)
      } else {
        await charToSend.writeValueWithoutResponse(chunk)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    return {
      success: true,
      message: connRes.isFallback
        ? `Data cetak dialihkan ke ${connRes.deviceName} (Fallback)`
        : 'Data cetak berhasil dikirim via Bluetooth.'
    }
  } catch (err: any) {
    return { success: false, message: 'Gagal mengirim data ke printer Bluetooth: ' + (err.message || 'Error') }
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
  const is58mm = effectiveSize === '58mm'

  let effectiveConn = options.connectionType
  if (effectiveConn === 'same_as_cashier' && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('shapeup_pos_receipt_settings')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.connectionType === 'bluetooth') effectiveConn = 'bluetooth'
      }
    } catch {}
  }

  if (effectiveConn === 'bluetooth') {
    const nowStr = new Date().toLocaleTimeString('id-ID')
    const sampleChitText = [
      '\x1B\x40', // ESC @ init
      '\x1B\x61\x01', // Center
      '\x1D\x21\x11', // Double height & width
      `[STASIUN: ${options.stationName.toUpperCase()}]\n`,
      '\x1D\x21\x00', // Normal
      `Printer: ${options.printerName || 'Bluetooth Thermal'}\n`,
      `Waktu Uji: ${nowStr}\n`,
      '--------------------------------\n',
      '\x1B\x61\x00', // Left
      '1x TES KONEKSI STASIUN PRODUKSI\n',
      '   * Status: TERHUBUNG (OK)\n',
      '   * Routing Menu: AKTIF\n',
      '--------------------------------\n',
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

      const width = is58mm ? '48mm' : '72mm'
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Uji Cetak Stasiun ${options.stationName}</title>
  <style>
    @page { size: ${is58mm ? '58mm auto' : '80mm auto'}; margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; width: ${width}; margin: 0 auto; padding: 4mm 2mm; font-size: 12px; }
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
    <div style="font-size: 11px;">• Kertas: Thermal ${effectiveSize}</div>
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

    // Fast Path for Native Android APK Bridge (SPP RFCOMM Socket)
    if (isAndroidApp()) {
      const payload = encodeReceiptToEscPos(receipt, effectiveSize)
      return sendBluetoothRawBytes(payload)
    }

    // Zero Silent Fallback: never divert to the OS print dialog when Bluetooth is selected
    if (!isWebBluetoothSupported()) {
      return {
        success: false,
        message: 'Web Bluetooth tidak didukung pada peramban ini. Gunakan Chrome pada Android/Komputer atau ganti koneksi ke Printer Sistem.'
      }
    }

    try {
      const hasPairedBefore = hasPairedBluetoothPrinter()

      if (!hasPairedBefore) {
        // Never paired: open the chooser immediately while the click gesture is still fresh
        const pairRes = await requestAndConnectBluetoothPrinter()
        if (!pairRes.success || !activeWriteCharacteristic) {
          return {
            success: false,
            message: pairRes.error || 'Printer Bluetooth belum dipasangkan.'
          }
        }
      } else {
        // Paired before: silent reconnect only (in-memory GATT → getDevices + watchAdvertisements). Zero prompt.
        let connRes = await ensureBluetoothPrinterConnection(false)
        if (!connRes.success || !activeWriteCharacteristic) {
          // One more wake-up attempt for thermal printers in BLE idle sleep
          await new Promise((r) => setTimeout(r, 400))
          connRes = await ensureBluetoothPrinterConnection(false)
        }

        if (!connRes.success || !activeWriteCharacteristic) {
          return {
            success: false,
            needsBluetoothReconnect: true,
            message: connRes.error || 'Printer Bluetooth tidak terhubung. Pastikan printer menyala dan berada dalam jangkauan.'
          }
        }
      }

      // Encode ESC/POS byte sequence
      const payload = encodeReceiptToEscPos(receipt, effectiveSize)

      // Send payload in chunks of 64 bytes
      const CHUNK_SIZE = 64
      for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        const chunk = payload.slice(i, i + CHUNK_SIZE)
        if (activeWriteCharacteristic.properties.write) {
          await activeWriteCharacteristic.writeValueWithResponse(chunk)
        } else {
          await activeWriteCharacteristic.writeValueWithoutResponse(chunk)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      return { success: true, message: 'Struk berhasil dicetak via Bluetooth.' }
    } catch (err: any) {
      console.warn('Web Bluetooth print error:', err)
      return {
        success: false,
        needsBluetoothReconnect: hasPairedBluetoothPrinter(),
        message: 'Gagal mencetak via Bluetooth: ' + (err.message || 'Koneksi terputus')
      }
    }
  }
}

// Helper factory to get active printer adapter
export function getPrinterAdapter(type: ConnectionType = 'system'): PrinterAdapter {
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
