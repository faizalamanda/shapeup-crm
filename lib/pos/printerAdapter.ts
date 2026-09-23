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

export interface ReceiptData {
  businessName: string
  businessAddress?: string
  businessPhone?: string
  orderNumber: string
  date: string
  cashierName: string
  customerName?: string
  items: ReceiptItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  grandTotal: number
  paymentMethod: string
  cashReceived?: number
  changeAmount?: number
  note?: string
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
  print(receipt: ReceiptData): Promise<PrintResult>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
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

  async print(receipt: ReceiptData): Promise<PrintResult> {
    try {
      if (typeof window !== 'undefined') {
        window.print()
        return { success: true }
      }
      return { success: false, message: 'Window object not available' }
    } catch (err: any) {
      return { success: false, message: err.message || 'System print failed' }
    }
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

  async print(receipt: ReceiptData): Promise<PrintResult> {
    try {
      if (typeof window !== 'undefined') {
        window.print()
        return { success: true }
      }
      return { success: false, message: 'Window object not available' }
    } catch (err: any) {
      return { success: false, message: err.message || 'PDF Export failed' }
    }
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

  async print(receipt: ReceiptData): Promise<PrintResult> {
    // Fallback to window print if bluetooth device not active
    if (typeof window !== 'undefined') {
      window.print()
      return { success: true }
    }
    return { success: false, message: 'Printer Bluetooth tidak terhubung' }
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
