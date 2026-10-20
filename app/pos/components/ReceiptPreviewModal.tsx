"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ReceiptData, getPrinterAdapter, PaperSize } from '@/lib/pos/printerAdapter'
import { getStoredReceiptSettings } from './ReceiptSettingsModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  receipt: ReceiptData | null
}

export default function ReceiptPreviewModal({ isOpen, onClose, receipt }: Props) {
  const [mounted, setMounted] = useState(false)
  const [paperSize, setPaperSize] = useState<PaperSize>('58mm')
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
    }
  }, [isOpen, receipt?.businessName])

  if (!isOpen || !receipt || !mounted) return null

  const handlePrint = async () => {
    setIsPrinting(true)
    setPrintMessage(null)
    try {
      const adapter = getPrinterAdapter('system')
      const res = await adapter.print(receipt, paperSize)
      if (res.success) {
        setPrintMessage('Receipt berhasil dikirim ke printer.')
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
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
      {/* Print Safety Net CSS: In case of native window.print, hide modal chrome */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden !important;
          }
          #thermal-receipt-container, #thermal-receipt-container * {
            visibility: visible !important;
          }
          #thermal-receipt-container {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: ${paperSize === '58mm' ? '48mm' : paperSize === '80mm' ? '72mm' : '100%'} !important;
            margin: 0 !important;
            padding: 2mm !important;
            border: none !important;
            box-shadow: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      ` }} />

      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 no-print">
          <h3 className="font-bold text-gray-900 text-base">Pratinjau Receipt</h3>
          <div className="flex items-center gap-2">
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

        {/* Printable Receipt Frame */}
        <div className="p-4 bg-gray-100 overflow-y-auto flex-1 flex justify-center">
          <div 
            id="thermal-receipt-container"
            className={`bg-white text-black font-mono p-4 text-xs shadow-md border border-gray-200 ${
              paperSize === '58mm' ? 'w-[260px]' : paperSize === '80mm' ? 'w-[340px]' : 'w-full max-w-xl font-sans'
            }`}
          >
            {/* Header */}
            <div className="text-center pb-3 border-b border-dashed border-gray-400">
              <h2 className="font-bold text-base uppercase tracking-wider">{receipt.businessName}</h2>
              {receipt.businessAddress && <p className="text-[11px] text-gray-600 mt-0.5">{receipt.businessAddress}</p>}
              {receipt.businessPhone && <p className="text-[11px] text-gray-600">Telp: {receipt.businessPhone}</p>}
            </div>

            {/* Meta */}
            <div className="py-2.5 border-b border-dashed border-gray-400 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>No. Invoice:</span>
                <span className="font-bold">{receipt.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Tanggal:</span>
                <span>{receipt.date}</span>
              </div>
              <div className="flex justify-between">
                <span>Kasir:</span>
                <span>{receipt.cashierName}</span>
              </div>
              {receipt.customerName && (
                <div className="flex justify-between">
                  <span>Pelanggan:</span>
                  <span>{receipt.customerName}</span>
                </div>
              )}
            </div>

            {/* Items */}
            <div className="py-2.5 border-b border-dashed border-gray-400 space-y-2">
              {receipt.items.map((item, idx) => (
                <div key={idx} className="text-[11px]">
                  <div className="font-semibold">
                    {receipt.showItemNumbering ? `${idx + 1}. ` : ''}{item.name}
                  </div>
                  {item.variant && <div className="text-[10px] text-gray-500 pl-2">• {item.variant}</div>}
                  {item.note && <div className="text-[10px] text-gray-500 italic pl-2">• {item.note}</div>}
                  <div className="flex justify-between mt-0.5">
                    <span>{item.quantity} x Rp {item.price.toLocaleString('id-ID')}</span>
                    <span className="font-medium">Rp {item.subtotal.toLocaleString('id-ID')}</span>
                  </div>
                  {item.discount && item.discount > 0 ? (
                    <div className="flex justify-between text-[10px] text-gray-500 pl-2">
                      <span>Diskon item:</span>
                      <span>-Rp {item.discount.toLocaleString('id-ID')}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Total Calculations */}
            <div className="py-2.5 border-b border-dashed border-gray-400 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>Rp {receipt.subtotal.toLocaleString('id-ID')}</span>
              </div>
              {receipt.discountTotal > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Diskon:</span>
                  <span>-Rp {receipt.discountTotal.toLocaleString('id-ID')}</span>
                </div>
              )}
              {receipt.taxTotal > 0 && (
                <div className="flex justify-between">
                  <span>Pajak:</span>
                  <span>+Rp {receipt.taxTotal.toLocaleString('id-ID')}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm pt-1 border-t border-gray-200">
                <span>GRAND TOTAL:</span>
                <span>Rp {receipt.grandTotal.toLocaleString('id-ID')}</span>
              </div>
            </div>

            {/* Payment Details */}
            <div className="pt-2.5 text-[11px] space-y-1">
              <div className="flex justify-between">
                <span>Metode Bayar:</span>
                <span className="font-semibold uppercase">{receipt.paymentMethod}</span>
              </div>
              {receipt.cashReceived !== undefined && receipt.cashReceived > 0 && (
                <>
                  <div className="flex justify-between">
                    <span>Bayar Tunai:</span>
                    <span>Rp {receipt.cashReceived.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Kembalian:</span>
                    <span>Rp {(receipt.changeAmount || 0).toLocaleString('id-ID')}</span>
                  </div>
                </>
              )}
            </div>

            {/* Loyalty Rewards Info */}
            {receipt.loyaltyInfo && (receipt.loyaltyInfo.pointsEarned !== undefined || receipt.loyaltyInfo.currentBalance !== undefined || receipt.loyaltyInfo.tierName) && (
              <div className="pt-2.5 mt-2.5 border-t border-dashed border-gray-400 text-[11px] space-y-1">
                <div className="flex justify-between font-bold">
                  <span>LOYALTY REWARDS</span>
                  <span>{receipt.loyaltyInfo.tierBadge || ''} {receipt.loyaltyInfo.tierName || 'Member'}</span>
                </div>
                {receipt.loyaltyInfo.pointsEarned !== undefined && receipt.loyaltyInfo.pointsEarned > 0 && (
                  <div className="flex justify-between text-gray-700">
                    <span>Poin Transaksi Ini:</span>
                    <span className="font-semibold">+{receipt.loyaltyInfo.pointsEarned.toLocaleString('id-ID')} Poin</span>
                  </div>
                )}
                {receipt.loyaltyInfo.currentBalance !== undefined && (
                  <div className="flex justify-between text-gray-700">
                    <span>Total Saldo Poin:</span>
                    <span className="font-semibold">{receipt.loyaltyInfo.currentBalance.toLocaleString('id-ID')} Poin</span>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="text-center pt-4 mt-2 border-t border-dashed border-gray-400 text-[10px] text-gray-600 space-y-1">
              {receipt.note ? (
                <div className="whitespace-pre-line">{receipt.note}</div>
              ) : (
                <>
                  <p className="font-medium">Terima kasih atas kunjungan Anda!</p>
                  <p>Barang yang sudah dibeli tidak dapat ditukar/dikembalikan.</p>
                </>
              )}
              <p className="text-[9px] text-gray-400 pt-1">Powered by ShapeUp POS</p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="p-4 border-t border-gray-100 bg-white space-y-2 no-print">
          {printMessage && (
            <div className="text-xs p-2 rounded-lg bg-blue-50 text-blue-700 text-center">
              {printMessage}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              disabled={isPrinting}
              className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2"
            >
              <span>🖨️</span>
              <span>{isPrinting ? 'Mencetak...' : 'Cetak Receipt'}</span>
            </button>
            <button
              onClick={onClose}
              className="py-2.5 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl text-xs transition"
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
