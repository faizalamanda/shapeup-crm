"use client"
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { 
  ReceiptData, 
  getPrinterAdapter, 
  PaperSize, 
  ConnectionType, 
  generateReceiptHtml 
} from '@/lib/pos/printerAdapter'
import { getStoredReceiptSettings } from '@/lib/pos/receiptSettings'

type Props = {
  isOpen: boolean
  onClose: () => void
  receipt: ReceiptData | null
}

export default function ReceiptPreviewModal({ isOpen, onClose, receipt }: Props) {
  const [mounted, setMounted] = useState(false)
  const [paperSize, setPaperSize] = useState<PaperSize>('58mm')
  const [connectionType, setConnectionType] = useState<ConnectionType>('system')
  const [isPrinting, setIsPrinting] = useState(false)
  const [printMessage, setPrintMessage] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      const settings = getStoredReceiptSettings(receipt?.businessName)
      if (settings.paperSize) {
        setPaperSize(settings.paperSize)
      }
      if (settings.connectionType) {
        setConnectionType(settings.connectionType)
      }
    }
  }, [isOpen, receipt?.businessName])

  // Single Source of Truth HTML for WYSIWYG parity
  const receiptHtml = useMemo(() => {
    if (!receipt) return ''
    return generateReceiptHtml(receipt, paperSize)
  }, [receipt, paperSize])

  if (!isOpen || !receipt || !mounted) return null

  const handlePrint = async () => {
    setIsPrinting(true)
    setPrintMessage(null)
    try {
      const adapter = getPrinterAdapter(connectionType)
      const res = await adapter.print(receipt, paperSize)
      if (res.success) {
        setPrintMessage(res.message || 'Receipt berhasil dicetak.')
      } else {
        setPrintMessage(res.message || 'Gagal mencetak receipt')
      }
    } catch (err: any) {
      setPrintMessage('Terjadi kesalahan pencetakan: ' + err.message)
    } finally {
      setIsPrinting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto no-print">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 no-print">
          <h3 className="font-bold text-gray-900 text-base">Pratinjau Receipt</h3>
          <div className="flex items-center gap-2">
            {/* Connection Type selector */}
            <select
              value={connectionType}
              onChange={(e) => setConnectionType(e.target.value as ConnectionType)}
              className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 font-medium text-gray-700 outline-none"
              title="Metode Cetak"
            >
              <option value="system">Sistem (OS/USB)</option>
              <option value="bluetooth">Bluetooth</option>
            </select>
            {/* Paper Size selector */}
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSize)}
              className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 font-medium text-gray-700 outline-none"
            >
              <option value="58mm">Thermal 58mm</option>
              <option value="80mm">Thermal 80mm</option>
              <option value="A4">Halaman A4</option>
            </select>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 hover:text-gray-900 flex items-center justify-center text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Printable Receipt Frame (Unified Sandboxed Frame) */}
        <div className="p-4 bg-gray-100 overflow-y-auto flex-1 flex justify-center items-start">
          <iframe
            title="Pratinjau Struk Kasir"
            srcDoc={receiptHtml}
            className={`bg-white rounded-xl shadow-md border border-gray-300 transition-all ${
              paperSize === '58mm' ? 'w-[280px]' : paperSize === '80mm' ? 'w-[360px]' : 'w-full max-w-xl'
            } h-[580px]`}
          />
        </div>

        {/* Action Controls */}
        <div className="p-4 border-t border-gray-100 bg-white space-y-2 no-print">
          {printMessage && (
            <div className="text-xs p-2 rounded-lg bg-blue-50 text-blue-700 text-center font-medium">
              {printMessage}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              disabled={isPrinting}
              className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-semibold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>🖨️</span>
              <span>{isPrinting ? 'Mencetak...' : 'Cetak Receipt'}</span>
            </button>
            <button
              onClick={onClose}
              className="py-2.5 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl text-xs transition cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
