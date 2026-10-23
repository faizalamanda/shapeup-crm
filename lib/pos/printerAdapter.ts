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
  date: string
  cashierName: string
  customerName?: string
  showItemNumbering?: boolean
  loyaltyInfo?: ReceiptLoyaltyInfo
  items: ReceiptItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  grandTotal: number
  paymentMethod: string
  cashReceived?: number
  changeAmount?: number
  note?: string
  orderNote?: string
  paperSize?: PaperSize
}

export interface PrintResult {
  success: boolean
  message?: string
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

export function generateReceiptHtml(receipt: ReceiptData, paperSize: PaperSize = '58mm'): string {
  const effectivePaperSize = receipt.paperSize || paperSize
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

  const defaultFooterNote = 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar/dikembalikan.'
  const footerNoteContent = escapeHtml(receipt.note || defaultFooterNote).replace(/\n/g, '<br>')

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
      <div style="font-size: 1.25em; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(receipt.businessName)}</div>
      ${receipt.businessAddress ? `<div style="font-size: 0.9em; margin-top: 2px; word-break: break-word;">${escapeHtml(receipt.businessAddress)}</div>` : ''}
      ${receipt.businessPhone ? `<div style="font-size: 0.9em; margin-top: 1px;">Telp: ${escapeHtml(receipt.businessPhone)}</div>` : ''}
    </div>

    <div class="divider"></div>

    <!-- Metadata Transaksi -->
    <div style="margin: 4px 0; font-size: 0.95em;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>No. Invoice:</span>
        <span>${escapeHtml(receipt.orderNumber)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Tanggal:</span>
        <span>${escapeHtml(receipt.date)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Kasir:</span>
        <span>${escapeHtml(receipt.cashierName)}</span>
      </div>
      ${receipt.customerName ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Pelanggan:</span>
        <span>${escapeHtml(receipt.customerName)}</span>
      </div>` : ''}
      ${receipt.orderNote ? `
      <div style="margin-top: 4px; padding: 4px 6px; background-color: #f7f7f7; border: 1px dashed #777; font-size: 0.9em; word-break: break-word;">
        Catatan: ${escapeHtml(receipt.orderNote)}
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

    <!-- Detail Pembayaran -->
    <div style="margin: 4px 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Metode Bayar:</span>
        <span style="text-transform: uppercase;">${escapeHtml(receipt.paymentMethod)}</span>
      </div>
      ${cashDetailsHtml}
    </div>

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
export function encodeReceiptToEscPos(receipt: ReceiptData, paperSize: PaperSize = '58mm'): Uint8Array {
  const is80mm = paperSize === '80mm'
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

  // 3. Metadata (Left align)
  writeRaw(0x1B, 0x61, 0x00) // Left
  writeText(padColumns('No. Invoice:', receipt.orderNumber))
  writeText(padColumns('Tanggal:', receipt.date))
  writeText(padColumns('Kasir:', receipt.cashierName))
  if (receipt.customerName) {
    writeText(padColumns('Pelanggan:', receipt.customerName))
  }
  if (receipt.orderNote) {
    writeText(`Catatan: ${receipt.orderNote}\n`)
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
  writeText(padColumns('Metode Bayar:', (receipt.paymentMethod || 'TUNAI').toUpperCase()))
  if (receipt.cashReceived !== undefined && receipt.cashReceived > 0) {
    writeText(padColumns('Bayar Tunai:', receipt.cashReceived.toLocaleString('id-ID')))
    writeText(padColumns('Kembalian:', (receipt.changeAmount || 0).toLocaleString('id-ID')))
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
let activeBluetoothDevice: any = null
let activeWriteCharacteristic: any = null

export function isWebBluetoothSupported(): boolean {
  return typeof window !== 'undefined' && Boolean((navigator as any)?.bluetooth)
}

export function getActiveBluetoothDeviceName(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('shapeup_pos_bt_name') || (activeBluetoothDevice?.name ?? null)
}

export async function requestAndConnectBluetoothPrinter(): Promise<{ success: boolean; deviceName?: string; error?: string }> {
  if (!isWebBluetoothSupported()) {
    return { success: false, error: 'Web Bluetooth tidak didukung pada peramban ini. Pastikan menggunakan Chrome pada Android atau Komputer.' }
  }

  try {
    const device = await (navigator as any).bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '0000af30-0000-1000-8000-00805f9b34fb',
        '0000e781-0000-1000-8000-00805f9b34fb',
        '0000ff00-0000-1000-8000-00805f9b34fb',
        '0000ffff-0000-1000-8000-00805f9b34fb',
        '000018f1-0000-1000-8000-00805f9b34fb',
      ]
    })

    if (!device) {
      return { success: false, error: 'Pencarian printer dibatalkan' }
    }

    const server = await device.gatt.connect()
    const services = await server.getPrimaryServices()

    let writeChar: any = null
    for (const service of services) {
      const chars = await service.getCharacteristics()
      for (const char of chars) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          writeChar = char
          break
        }
      }
      if (writeChar) break
    }

    if (!writeChar) {
      return { success: false, error: 'Karakteristik cetak printer tidak ditemukan pada perangkat Bluetooth ini.' }
    }

    activeBluetoothDevice = device
    activeWriteCharacteristic = writeChar
    const name = device.name || 'Bluetooth Thermal Printer'
    localStorage.setItem('shapeup_pos_bt_name', name)

    device.addEventListener('gattserverdisconnected', () => {
      activeWriteCharacteristic = null
    })

    return { success: true, deviceName: name }
  } catch (err: any) {
    return { success: false, error: err.message || 'Gagal menghubungkan printer bluetooth' }
  }
}

export async function disconnectBluetoothPrinter(): Promise<void> {
  if (activeBluetoothDevice && activeBluetoothDevice.gatt?.connected) {
    activeBluetoothDevice.gatt.disconnect()
  }
  activeBluetoothDevice = null
  activeWriteCharacteristic = null
  if (typeof window !== 'undefined') {
    localStorage.removeItem('shapeup_pos_bt_name')
  }
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

    // If Web Bluetooth is not supported in the browser, fallback safely to iframe print
    if (!isWebBluetoothSupported()) {
      return printReceiptViaIframe(receipt, effectiveSize)
    }

    try {
      // Connect if not already connected
      if (!activeWriteCharacteristic || !activeBluetoothDevice?.gatt?.connected) {
        if (activeBluetoothDevice && activeBluetoothDevice.gatt) {
          const server = await activeBluetoothDevice.gatt.connect()
          const services = await server.getPrimaryServices()
          for (const service of services) {
            const chars = await service.getCharacteristics()
            for (const char of chars) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                activeWriteCharacteristic = char
                break
              }
            }
            if (activeWriteCharacteristic) break
          }
        }
      }

      // If still not connected, prompt pair dialog
      if (!activeWriteCharacteristic) {
        const pairRes = await requestAndConnectBluetoothPrinter()
        if (!pairRes.success || !activeWriteCharacteristic) {
          console.warn('Bluetooth connection not active, falling back to system print:', pairRes.error)
          return printReceiptViaIframe(receipt, effectiveSize)
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

      return { success: true, message: 'Receipt berhasil dicetak via Bluetooth' }
    } catch (err: any) {
      console.warn('Web Bluetooth print error, gracefully falling back to system print:', err)
      return printReceiptViaIframe(receipt, effectiveSize)
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
