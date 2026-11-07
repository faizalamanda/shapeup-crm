// ShapeUp POS Kitchen Multi-Station Printer Dispatcher
import { ConnectionType, PrintResult, PaperSize } from './printerAdapter'
import {
  KitchenTicketData,
  generateKitchenTicketHtml,
  encodeKitchenTicketToEscPos
} from './kitchenTicketBuilder'
import {
  getStoredKitchenSettings,
  KitchenSettings
} from './kitchenSettings'
import {
  hasPairedBluetoothPrinter,
  requestAndConnectBluetoothPrinter,
  ensureBluetoothPrinterConnection,
  sendBluetoothRawBytes
} from './printerAdapter'

// Dynamic reference to active BLE write characteristic from printerAdapter
declare const window: any

export function printKitchenTicketViaIframe(ticket: KitchenTicketData): Promise<PrintResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ success: false, message: 'Window tidak tersedia' })
      return
    }

    try {
      let iframe = document.getElementById('pos-kitchen-print-iframe') as HTMLIFrameElement | null
      if (!iframe) {
        iframe = document.createElement('iframe')
        iframe.id = 'pos-kitchen-print-iframe'
        iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;')
        document.body.appendChild(iframe)
      }

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (!iframeDoc) {
        resolve({ success: false, message: 'Gagal mengakses dokumen printer dapur' })
        return
      }

      const htmlContent = generateKitchenTicketHtml(ticket)

      iframeDoc.open()
      iframeDoc.write(htmlContent)
      iframeDoc.close()

      setTimeout(() => {
        try {
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.focus()
            iframe.contentWindow.print()
            resolve({ success: true, message: `Nota ${ticket.stationName} berhasil dikirim ke printer sistem.` })
          } else {
            resolve({ success: false, message: 'Window printer tidak merespon' })
          }
        } catch (e: any) {
          resolve({ success: false, message: e.message || 'Gagal memicu pencetakan sistem' })
        }
      }, 350)
    } catch (e: any) {
      resolve({ success: false, message: e.message || 'Gagal menyiapkan dokumen' })
    }
  })
}

/**
 * Prints a single KitchenTicketData using the designated connection type (bluetooth or system iframe).
 */
export async function printSingleKitchenTicket(
  ticket: KitchenTicketData,
  connectionType?: ConnectionType,
  settings?: KitchenSettings
): Promise<PrintResult> {
  const kSettings = settings || getStoredKitchenSettings(ticket.paperSize)
  
  // Resolve station printer connection: specific station preference overrides global cashier connection
  let effectiveConn: ConnectionType = 'system'
  if (ticket.printerConnectionType === 'bluetooth') {
    effectiveConn = 'bluetooth'
  } else if (ticket.printerConnectionType === 'system') {
    effectiveConn = 'system'
  } else {
    // 'same_as_cashier' fallback to cashier settings
    effectiveConn = connectionType || (typeof window !== 'undefined' && localStorage.getItem('shapeup_pos_receipt_settings')
      ? (JSON.parse(localStorage.getItem('shapeup_pos_receipt_settings') || '{}').connectionType || 'system')
      : 'system')
  }

  if (effectiveConn === 'bluetooth') {
    try {
      const hasPaired = hasPairedBluetoothPrinter()
      if (!hasPaired) {
        const pairRes = await requestAndConnectBluetoothPrinter()
        if (!pairRes.success) {
          // Fallback to system print if bluetooth fails
          console.warn('[KitchenPrinter] Bluetooth pairing cancelled, falling back to system print.')
          return printKitchenTicketViaIframe(ticket)
        }
      }

      const connRes = await ensureBluetoothPrinterConnection(false)
      if (!connRes.success) {
        console.warn('[KitchenPrinter] Silent reconnect failed, falling back to system print.')
        return printKitchenTicketViaIframe(ticket)
      }

      // Encode ESC/POS payload with buzzer & cut options
      const payload = encodeKitchenTicketToEscPos(ticket, {
        soundBuzzer: ticket.soundBuzzer ?? kSettings.soundBuzzer,
        autoCut: ticket.autoCut ?? kSettings.autoCutPaper
      })

      // Send ESC/POS bytes directly over Web Bluetooth
      const sendRes = await sendBluetoothRawBytes(payload)
      if (sendRes.success) {
        return sendRes
      }
      console.warn('[KitchenPrinter] Direct bluetooth transmission failed, falling back to iframe print:', sendRes.message)
      return printKitchenTicketViaIframe(ticket)
    } catch (err: any) {
      console.warn('[KitchenPrinter] Bluetooth exception, falling back to iframe:', err)
      return printKitchenTicketViaIframe(ticket)
    }
  }

  return printKitchenTicketViaIframe(ticket)
}

export interface DispatchKitchenResult {
  success: boolean
  message: string
  stationResults: Array<{ station: string; stationLabel: string; success: boolean; message?: string }>
}

/**
 * Dispatches all station tickets (Dapur, Bar, etc.) sequentially.
 */
export async function dispatchAllKitchenTickets(
  tickets: KitchenTicketData[],
  connectionType?: ConnectionType,
  settings?: KitchenSettings
): Promise<DispatchKitchenResult> {
  if (!tickets || tickets.length === 0) {
    return {
      success: false,
      message: 'Tidak ada item menu untuk dicetak ke dapur.',
      stationResults: []
    }
  }

  const stationResults: Array<{ station: string; stationLabel: string; success: boolean; message?: string }> = []
  let allSuccess = true

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i]
    try {
      const res = await printSingleKitchenTicket(t, connectionType, settings)
      stationResults.push({
        station: t.stationId,
        stationLabel: t.stationLabel,
        success: res.success,
        message: res.message
      })
      if (!res.success) allSuccess = false

      // Slight delay between multi-station print jobs to avoid OS print queue collisions
      if (i < tickets.length - 1) {
        await new Promise((r) => setTimeout(r, 450))
      }
    } catch (err: any) {
      allSuccess = false
      stationResults.push({
        station: t.stationId,
        stationLabel: t.stationLabel,
        success: false,
        message: err.message || 'Gagal mencetak'
      })
    }
  }

  const stationNames = tickets.map(t => t.stationName).join(' & ')
  return {
    success: allSuccess,
    message: allSuccess
      ? `✓ Nota ${stationNames} berhasil dikirim ke antrean cetak.`
      : `⚠️ Beberapa nota dapur gagal dicetak. Periksa status printer.`,
    stationResults
  }
}

