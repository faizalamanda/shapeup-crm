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
  showQueueNumber?: boolean
  showLogo?: boolean
  logoUrl?: string
  logoBase64?: string
  logoEscPosData?: string
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
      showLoyaltyPoints: true,
      showQueueNumber: false,
      showLogo: false,
      logoUrl: '',
      logoBase64: '',
      logoEscPosData: ''
    }
  }

  const isNativeAndroid = typeof window !== 'undefined' && Boolean((window as any).AndroidPrinter)
  const hasPairedBt =
    typeof window !== 'undefined' &&
    Boolean(localStorage.getItem('shapeup_pos_bt_id') || localStorage.getItem('shapeup_pos_bt_name'))
  const defaultConnectionType: ConnectionType = isNativeAndroid || hasPairedBt ? 'bluetooth' : 'system'

  try {
    const raw = localStorage.getItem(RECEIPT_SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // In Native Android APK, WebView does not support window.print() (system print is a no-op),
      // so always route to 'bluetooth' unless PDF export is explicitly chosen.
      const resolvedConn: ConnectionType = isNativeAndroid
        ? (parsed.connectionType === 'pdf' ? 'pdf' : 'bluetooth')
        : (parsed.connectionType || defaultConnectionType)

      return {
        storeName: parsed.storeName || defaultBusinessName,
        address: parsed.address || '',
        phone: parsed.phone || '',
        footerNote: parsed.footerNote || DEFAULT_RECEIPT_FOOTER,
        paperSize: parsed.paperSize || '58mm',
        connectionType: resolvedConn,
        autoPrintAfterPayment: Boolean(parsed.autoPrintAfterPayment),
        showItemNumbering: parsed.showItemNumbering !== undefined ? Boolean(parsed.showItemNumbering) : true,
        showLoyaltyPoints: parsed.showLoyaltyPoints !== undefined ? Boolean(parsed.showLoyaltyPoints) : true,
        showQueueNumber: Boolean(parsed.showQueueNumber),
        showLogo: Boolean(parsed.showLogo),
        logoUrl: parsed.logoUrl || '',
        logoBase64: parsed.logoBase64 || '',
        logoEscPosData: parsed.logoEscPosData || ''
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
    connectionType: defaultConnectionType,
    autoPrintAfterPayment: false,
    showItemNumbering: true,
    showLoyaltyPoints: true,
    showQueueNumber: false,
    showLogo: false,
    logoUrl: '',
    logoBase64: '',
    logoEscPosData: ''
  }
}

export function saveStoredReceiptSettings(updates: Partial<ReceiptSettings>, defaultBusinessName: string = 'ShapeUp Store'): ReceiptSettings {
  const current = getStoredReceiptSettings(defaultBusinessName)
  const updated: ReceiptSettings = {
    ...current,
    ...updates
  }
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(RECEIPT_SETTINGS_STORAGE_KEY, JSON.stringify(updated))
    } catch (e) {
      console.warn('Failed saving receipt settings:', e)
    }
  }
  return updated
}
