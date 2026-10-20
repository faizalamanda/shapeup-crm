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
  const containerPadding = is58mm ? '3mm 1mm' : is80mm ? '5mm 2mm' : '15mm 10mm'
  const fontFamily = effectivePaperSize === 'A4'
    ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'
    : 'Courier New, Courier, monospace'

  const itemsHtml = (receipt.items || []).map((item, idx) => {
    const itemNumberPrefix = receipt.showItemNumbering ? `${idx + 1}. ` : ''
    const variantHtml = item.variant
      ? `<div style="padding-left: 6px; font-size: 0.9em; color: #444;">• ${escapeHtml(item.variant)}</div>`
      : ''
    const noteHtml = item.note
      ? `<div style="padding-left: 6px; font-size: 0.85em; font-style: italic; color: #555;">• ${escapeHtml(item.note)}</div>`
      : ''
    const discountHtml = item.discount && item.discount > 0
      ? `<div style="display: flex; justify-content: space-between; font-size: 0.9em; color: #555; padding-left: 6px;"><span>Diskon item:</span><span>-Rp ${item.discount.toLocaleString('id-ID')}</span></div>`
      : ''

    return `
      <div style="margin-bottom: 5px;">
        <div style="font-weight: bold; word-break: break-word;">${itemNumberPrefix}${escapeHtml(item.name)}</div>
        ${variantHtml}
        ${noteHtml}
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 1px;">
          <span>${item.quantity} x Rp ${item.price.toLocaleString('id-ID')}</span>
          <span style="font-weight: bold;">Rp ${item.subtotal.toLocaleString('id-ID')}</span>
        </div>
        ${discountHtml}
      </div>
    `
  }).join('')

  const discountTotalHtml = receipt.discountTotal > 0
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Diskon:</span>
        <span>-Rp ${receipt.discountTotal.toLocaleString('id-ID')}</span>
      </div>
    `
    : ''

  const taxTotalHtml = receipt.taxTotal > 0
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Pajak:</span>
        <span>+Rp ${receipt.taxTotal.toLocaleString('id-ID')}</span>
      </div>
    `
    : ''

  const cashDetailsHtml = (receipt.cashReceived !== undefined && receipt.cashReceived > 0)
    ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Bayar Tunai:</span>
        <span>Rp ${receipt.cashReceived.toLocaleString('id-ID')}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 2px;">
        <span>Kembalian:</span>
        <span>Rp ${(receipt.changeAmount || 0).toLocaleString('id-ID')}</span>
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
        <div style="display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 2px;">
          <span>LOYALTY REWARDS</span>
          <span>${escapeHtml(receipt.loyaltyInfo.tierBadge || '')} ${escapeHtml(receipt.loyaltyInfo.tierName || 'Member')}</span>
        </div>
        ${receipt.loyaltyInfo.pointsEarned !== undefined && receipt.loyaltyInfo.pointsEarned > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 1px;">
          <span>Poin Transaksi Ini:</span>
          <span style="font-weight: bold;">+${receipt.loyaltyInfo.pointsEarned.toLocaleString('id-ID')} Poin</span>
        </div>` : ''}
        ${receipt.loyaltyInfo.currentBalance !== undefined ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 1px;">
          <span>Total Saldo Poin:</span>
          <span style="font-weight: bold;">${receipt.loyaltyInfo.currentBalance.toLocaleString('id-ID')} Poin</span>
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
      <div style="font-size: 1.25em; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(receipt.businessName)}</div>
      ${receipt.businessAddress ? `<div style="font-size: 0.9em; margin-top: 2px; word-break: break-word;">${escapeHtml(receipt.businessAddress)}</div>` : ''}
      ${receipt.businessPhone ? `<div style="font-size: 0.9em; margin-top: 1px;">Telp: ${escapeHtml(receipt.businessPhone)}</div>` : ''}
    </div>

    <div class="divider"></div>

    <!-- Metadata Transaksi -->
    <div style="margin: 4px 0; font-size: 0.95em;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>No. Invoice:</span>
        <span style="font-weight: bold;">${escapeHtml(receipt.orderNumber)}</span>
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
        <span>Rp ${receipt.subtotal.toLocaleString('id-ID')}</span>
      </div>
      ${discountTotalHtml}
      ${taxTotalHtml}
      <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 1.15em; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px;">
        <span>GRAND TOTAL:</span>
        <span>Rp ${receipt.grandTotal.toLocaleString('id-ID')}</span>
      </div>
    </div>

    <div class="divider"></div>

    <!-- Detail Pembayaran -->
    <div style="margin: 4px 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span>Metode Bayar:</span>
        <span style="font-weight: bold; text-transform: uppercase;">${escapeHtml(receipt.paymentMethod)}</span>
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

// 1. Browser System Print Adapter
export class BrowserSystemPrinterAdapter implements PrinterAdapter {
  async discover(): Promise<PrinterDevice[]> {
    return [{
      id: 'system-default',
      name: 'Printer Sistem (Browser/OS)',
      connectionType: 'system',
      paperSize: '80mm',
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

// 3. Web Bluetooth Thermal Printer Adapter (58mm / 80mm ESC/POS)
export class WebBluetoothPrinterAdapter implements PrinterAdapter {
  private device: any = null
  private gattServer: any = null

  async discover(): Promise<PrinterDevice[]> {
    if (typeof window === 'undefined' || !(navigator as any).bluetooth) {
      return []
    }
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '00001101-0000-1000-8000-00805f9b34fb']
      })
      if (device) {
        return [{
          id: device.id,
          name: device.name || 'Bluetooth Thermal Printer',
          connectionType: 'bluetooth',
          address: device.id,
          paperSize: '58mm',
          status: 'disconnected'
        }]
      }
      return []
    } catch (err) {
      console.warn('Web Bluetooth discover cancelled or unsupported:', err)
      return []
    }
  }

  async connect(deviceId: string): Promise<void> {
    if (typeof window === 'undefined' || !(navigator as any).bluetooth) {
      throw new Error('Web Bluetooth tidak didukung pada peramban ini.')
    }
    // Web Bluetooth requires user interaction for connecting
  }

  async disconnect(): Promise<void> {
    if (this.gattServer && this.gattServer.connected) {
      this.gattServer.disconnect()
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    const isConnected = this.gattServer ? this.gattServer.connected : false
    return { online: isConnected }
  }

  async print(receipt: ReceiptData, paperSize?: PaperSize): Promise<PrintResult> {
    // Fallback to iframe thermal print if bluetooth direct connection is not active
    const size = paperSize || receipt.paperSize || '58mm'
    return printReceiptViaIframe(receipt, size)
  }
}

// Helper factory to get active printer adapter
export function getPrinterAdapter(type: ConnectionType): PrinterAdapter {
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
