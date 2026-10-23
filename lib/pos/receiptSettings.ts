// ShapeUp POS Receipt Settings Helper & Storage
import { PaperSize, ConnectionType } from './printerAdapter'

export interface ReceiptSettings {
  storeName: string
  address: string
  phone: string
  footerNote: string
  paperSize: PaperSize
  connectionType: ConnectionType
  autoPrintAfterPayment: boolean
  showItemNumbering: boolean
  showLoyaltyPoints: boolean
}

export const RECEIPT_SETTINGS_STORAGE_KEY = 'shapeup_pos_receipt_settings'

export const DEFAULT_RECEIPT_FOOTER = 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar/dikembalikan.'

export function getStoredReceiptSettings(defaultBusinessName: string = 'ShapeUp Store'): ReceiptSettings {
  if (typeof window === 'undefined') {
    return {
      storeName: defaultBusinessName,
      address: '',
      phone: '',
      footerNote: DEFAULT_RECEIPT_FOOTER,
      paperSize: '58mm',
      connectionType: 'system',
      autoPrintAfterPayment: false,
      showItemNumbering: true,
      showLoyaltyPoints: true
    }
  }

  try {
    const raw = localStorage.getItem(RECEIPT_SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        storeName: parsed.storeName || defaultBusinessName,
        address: parsed.address || '',
        phone: parsed.phone || '',
        footerNote: parsed.footerNote || DEFAULT_RECEIPT_FOOTER,
        paperSize: parsed.paperSize || '58mm',
        connectionType: parsed.connectionType || 'system',
        autoPrintAfterPayment: Boolean(parsed.autoPrintAfterPayment),
        showItemNumbering: parsed.showItemNumbering !== undefined ? Boolean(parsed.showItemNumbering) : true,
        showLoyaltyPoints: parsed.showLoyaltyPoints !== undefined ? Boolean(parsed.showLoyaltyPoints) : true
      }
    }
  } catch (e) {
    console.warn('Failed reading receipt settings:', e)
  }

  return {
    storeName: defaultBusinessName,
    address: '',
    phone: '',
    footerNote: DEFAULT_RECEIPT_FOOTER,
    paperSize: '58mm',
    connectionType: 'system',
    autoPrintAfterPayment: false,
    showItemNumbering: true,
    showLoyaltyPoints: true
  }
}
