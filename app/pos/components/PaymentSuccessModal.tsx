"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { 
  ReceiptData, 
  getPrinterAdapter, 
  PaperSize, 
  ConnectionType, 
  generateReceiptHtml 
} from '@/lib/pos/printerAdapter'
import { getStoredReceiptSettings } from '@/lib/pos/receiptSettings'
import { supabase } from '@/lib/supabase'

type Props = {
  isOpen: boolean
  onClose: () => void
  receipt: ReceiptData | null
  orderId?: string | null
  onVoidSuccess?: () => void
}

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Math.round(val || 0))

export default function PaymentSuccessModal({
  isOpen,
  onClose,
  receipt,
  orderId,
  onVoidSuccess
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [paperSize, setPaperSize] = useState<PaperSize>('58mm')
  const [connectionType, setConnectionType] = useState<ConnectionType>('system')
  const [isPrinting, setIsPrinting] = useState(false)
  const [isVoiding, setIsVoiding] = useState(false)
  const [printMessage, setPrintMessage] = useState<string | null>(null)
  const [showThermalPreview, setShowThermalPreview] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Single Source of Truth HTML for WYSIWYG parity if preview is expanded
  const receiptHtml = useMemo(() => {
    if (!receipt) return ''
    return generateReceiptHtml(receipt, paperSize)
  }, [receipt, paperSize])

  // Handle Print Action
  const handlePrint = useCallback(async () => {
    if (!receipt || isPrinting) return
    setIsPrinting(true)
    setPrintMessage(null)
    try {
      const adapter = getPrinterAdapter(connectionType)
      const res = await adapter.print(receipt, paperSize)
      if (res.success) {
        setPrintMessage(res.message || '✓ Struk berhasil dicetak.')
      } else {
        setPrintMessage(res.message || '⚠️ Gagal mencetak struk.')
      }
    } catch (err: any) {
      setPrintMessage('Terjadi kesalahan pencetakan: ' + err.message)
    } finally {
      setIsPrinting(false)
    }
  }, [receipt, isPrinting, connectionType, paperSize])

  // Initial Load: Printer Settings & Optional Auto-print
  useEffect(() => {
    if (isOpen && receipt) {
      const settings = getStoredReceiptSettings(receipt.businessName)
      if (settings.paperSize) setPaperSize(settings.paperSize)
      if (settings.connectionType) setConnectionType(settings.connectionType)
      setPrintMessage(null)
      setShowThermalPreview(false)

      if (settings.autoPrintAfterPayment) {
        handlePrint()
      }
    }
  }, [isOpen, receipt, handlePrint])

  // Void Handler (Immediate reversal with confirmation)
  const handleVoid = async () => {
    if (!receipt || isVoiding) return

    const confirmed = window.confirm(
      `Apakah Anda yakin ingin membatalkan (VOID) pesanan #${receipt.orderNumber} ini?\n\n` +
      `• Stok barang akan dikembalikan ke gudang.\n` +
      `• Pembayaran tunai/bank akan dibalikkan di laci kasir.\n` +
      `• Jurnal akuntansi pembatalan akan dicatat otomatis.`
    )
    if (!confirmed) return

    setIsVoiding(true)
    setPrintMessage(null)

    try {
      let targetOrderId = orderId

      // Fallback: If orderId is still synchronizing in background, resolve via order_number
      if (!targetOrderId && receipt.orderNumber) {
        const { data } = await supabase
          .from('orders')
          .select('id')
          .eq('order_number', receipt.orderNumber)
          .maybeSingle()
        if (data?.id) {
          targetOrderId = data.id
        }
      }

      if (!targetOrderId) {
        throw new Error('Pesanan sedang disinkronkan ke server. Tunggu 1-2 detik lalu coba lagi.')
      }

      const res = await fetch('/api/pos/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: targetOrderId, refund_reason: 'Void Kasir Segera' })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal memproses pembatalan (Void)')
      }

      alert(`Pesanan #${receipt.orderNumber} berhasil dibatalkan (Void).`)
      if (onVoidSuccess) onVoidSuccess()
      onClose()
    } catch (err: any) {
      console.error('Void error:', err)
      alert(`Gagal membatalkan pesanan: ${err.message}`)
    } finally {
      setIsVoiding(false)
    }
  }

  // Keyboard Shortcuts for Cashier Ergonomics
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Enter triggers print receipt
        e.preventDefault()
        handlePrint()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, handlePrint])

  if (!isOpen || !receipt || !mounted) return null

  const changeAmount = Number(receipt.changeAmount || 0)
  const balanceDue = Number(receipt.grandTotal || 0)
  const tenderedAmount = Number(receipt.cashReceived ?? (receipt.amountPaid || balanceDue))

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto no-print animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-[#2e3136] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100 transition-all">
        
        {/* Main Content Area */}
        <div className="p-6 sm:p-8 flex flex-col">
          
          {/* Bagian Atas: Uang Kembalian (Change Due) */}
          <div className="text-center pt-2 pb-4">
            <span className="text-xs sm:text-sm font-semibold tracking-wider text-slate-400 uppercase">
              Uang Kembalian
            </span>
            <div className="mt-2 text-5xl sm:text-6xl font-black font-mono tracking-tight text-white select-all">
              {formatIDR(changeAmount)}
            </div>
            {changeAmount === 0 && (
              <span className="inline-block mt-2 text-[11px] font-bold text-slate-400 bg-slate-800/80 border border-slate-700/60 px-2.5 py-0.5 rounded-full">
                Uang Pas / Lunas
              </span>
            )}
          </div>

          {/* Bagian Tengah: Rincian Tagihan & Nominal Diterima */}
          <div className="mt-6 pt-6 border-t border-slate-700/60 space-y-3.5">
            <div className="flex items-center justify-between text-sm sm:text-base">
              <span className="text-slate-300 font-medium">Total Tagihan:</span>
              <span className="font-mono font-bold text-white text-base sm:text-lg">
                {formatIDR(balanceDue)}
              </span>
            </div>

            <div className="flex items-center justify-between text-sm sm:text-base">
              <span className="text-slate-300 font-medium">Uang Diterima:</span>
              <span className="font-mono font-bold text-white text-base sm:text-lg">
                {formatIDR(tenderedAmount)}
              </span>
            </div>

            {/* Detail Pelengkap (Metode & Nomor Pesanan) */}
            <div className="pt-2 border-t border-slate-700/30 flex items-center justify-between text-xs text-slate-400">
              <span className="truncate">
                Metode: <strong className="text-slate-200 font-semibold">{receipt.paymentMethod || 'Tunai'}</strong>
              </span>
              <span className="font-mono text-slate-300 font-medium">
                #{receipt.orderNumber}
              </span>
            </div>

            {receipt.customerName && receipt.customerName !== 'Pelanggan Umum' && (
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Pelanggan:</span>
                <span className="text-slate-200 font-semibold">{receipt.customerName}</span>
              </div>
            )}
          </div>

          {/* Notifikasi Status Cetak / Error */}
          {printMessage && (
            <div className={`mt-5 p-2.5 rounded-xl text-xs font-semibold text-center transition flex items-center justify-center gap-1.5 ${
              printMessage.startsWith('✓')
                ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/60 border border-rose-500/40 text-rose-300'
            }`}>
              <span>{printMessage}</span>
            </div>
          )}

          {/* Drawer Pratinjau Kertas Thermal (Opsional / Collapsible) */}
          {showThermalPreview && (
            <div className="mt-5 p-3 rounded-2xl bg-slate-900/90 border border-slate-700/70 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                <span className="font-bold text-slate-300">Pratinjau Kertas Struk</span>
                <div className="flex items-center gap-2">
                  <select
                    value={connectionType}
                    onChange={(e) => setConnectionType(e.target.value as ConnectionType)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-xs outline-none cursor-pointer"
                  >
                    <option value="system">Sistem (OS/USB)</option>
                    <option value="bluetooth">Bluetooth</option>
                  </select>
                  <select
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-xs outline-none cursor-pointer"
                  >
                    <option value="58mm">Thermal 58mm</option>
                    <option value="80mm">Thermal 80mm</option>
                    <option value="A4">A4</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-center bg-slate-950/50 p-2 rounded-xl max-h-[320px] overflow-y-auto">
                <iframe
                  title="Pratinjau Struk Kasir"
                  srcDoc={receiptHtml}
                  className={`bg-white rounded-lg shadow-md border border-gray-400 ${
                    paperSize === '58mm' ? 'w-[236px]' : paperSize === '80mm' ? 'w-[320px]' : 'w-full'
                  } h-[420px]`}
                />
              </div>
            </div>
          )}

          {/* Toggle Pratinjau Kertas */}
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setShowThermalPreview((prev) => !prev)}
              className="text-[11px] text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer underline underline-offset-4"
            >
              {showThermalPreview ? '▲ Sembunyikan Pratinjau Kertas' : '▼ Lihat Pratinjau Kertas Struk'}
            </button>
          </div>

          {/* Bagian Bawah: 3 Tombol Aksi Sesuai Referensi POS */}
          <div className="mt-6 pt-5 border-t border-slate-700/60 grid grid-cols-3 gap-2.5 sm:gap-3">
            {/* 1. Tombol VOID (Kiri) */}
            <button
              type="button"
              onClick={handleVoid}
              disabled={isVoiding}
              className="w-full py-3 sm:py-3.5 rounded-xl border border-slate-700 bg-slate-800/40 hover:bg-rose-950/40 hover:border-rose-500/60 text-slate-300 hover:text-rose-200 font-bold text-xs sm:text-sm transition flex items-center justify-center cursor-pointer active:scale-[0.98] disabled:opacity-50"
              title="Batalkan pesanan ini (Void)"
            >
              {isVoiding ? 'Membatalkan...' : 'Void'}
            </button>

            {/* 2. Tombol TANPA STRUK (Tengah) */}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 sm:py-3.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm transition flex items-center justify-center cursor-pointer active:scale-[0.98]"
              title="Selesai dan kembali ke kasir tanpa cetak struk"
            >
              Tanpa Struk
            </button>

            {/* 3. Tombol CETAK STRUK (Kanan — Highlight Utama) */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="w-full py-3 sm:py-3.5 rounded-xl bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white font-bold text-xs sm:text-sm shadow-lg shadow-blue-500/20 transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] disabled:opacity-50"
              title="Cetak struk ke printer kasir (Tekan Enter)"
            >
              {isPrinting ? (
                <span>Mencetak...</span>
              ) : (
                <span>Cetak Struk</span>
              )}
            </button>
          </div>

        </div>

      </div>
    </div>,
    document.body
  )
}
