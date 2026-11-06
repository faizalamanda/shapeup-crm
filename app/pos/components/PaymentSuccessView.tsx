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
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

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

export default function PaymentSuccessView({
  isOpen,
  onClose,
  receipt,
  orderId,
  onVoidSuccess
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [paperSize, setPaperSize] = useState<PaperSize>(() => {
    if (typeof window !== 'undefined') {
      return getStoredReceiptSettings().paperSize || '58mm'
    }
    return '58mm'
  })
  const [connectionType, setConnectionType] = useState<ConnectionType>(() => {
    if (typeof window !== 'undefined') {
      return getStoredReceiptSettings().connectionType || 'system'
    }
    return 'system'
  })

  const [isPrinting, setIsPrinting] = useState(false)
  const [hasPrinted, setHasPrinted] = useState(false)
  const [isVoiding, setIsVoiding] = useState(false)
  const [printMessage, setPrintMessage] = useState<string | null>(null)
  const [showThermalPreview, setShowThermalPreview] = useState(false)

  // 1. Kiosk Armor: Handle Mobile/Browser Back Button without kicking user to /onboarding
  useModalBackHandler(isOpen, onClose)

  useEffect(() => {
    setMounted(true)
  }, [])

  // 2. Persist Last Completed Order Snapshot for State Resilience
  useEffect(() => {
    if (isOpen && receipt) {
      try {
        sessionStorage.setItem(
          'su_last_pos_completed_order',
          JSON.stringify({
            orderNumber: receipt.orderNumber,
            grandTotal: receipt.grandTotal,
            changeAmount: receipt.changeAmount,
            customerName: receipt.customerName,
            paymentMethod: receipt.paymentMethod,
            timestamp: Date.now()
          })
        )
      } catch {
        // QuotaExceededError safe fallback
      }
    }
  }, [isOpen, receipt])

  // Single Source of Truth HTML for WYSIWYG parity if preview is expanded
  const receiptHtml = useMemo(() => {
    if (!receipt) return ''
    return generateReceiptHtml(receipt, paperSize)
  }, [receipt, paperSize])

  // Handle Print Action
  const handlePrint = useCallback(
    async (overrideConn?: ConnectionType, overrideSize?: PaperSize) => {
      if (!receipt || isPrinting) return
      setIsPrinting(true)
      setPrintMessage(null)
      const effectiveConn = overrideConn || connectionType
      const effectiveSize = overrideSize || paperSize

      try {
        const adapter = getPrinterAdapter(effectiveConn)
        const res = await adapter.print(receipt, effectiveSize)
        if (res.success) {
          setHasPrinted(true)
          setPrintMessage(res.message || '✓ Struk berhasil dicetak.')
        } else {
          setPrintMessage(res.message || '⚠️ Gagal mencetak struk.')
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        setPrintMessage('Terjadi kesalahan pencetakan: ' + errorMsg)
      } finally {
        setIsPrinting(false)
      }
    },
    [receipt, isPrinting, connectionType, paperSize]
  )

  // Initial Load: Printer Settings & Optional Auto-print
  useEffect(() => {
    if (isOpen && receipt) {
      const settings = getStoredReceiptSettings(receipt.businessName)
      if (settings.paperSize) setPaperSize(settings.paperSize)
      if (settings.connectionType) setConnectionType(settings.connectionType)
      setPrintMessage(null)
      setShowThermalPreview(false)
      setHasPrinted(false)

      if (settings.autoPrintAfterPayment) {
        handlePrint(settings.connectionType, settings.paperSize)
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
    } catch (err: unknown) {
      console.error('Void error:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      alert(`Gagal membatalkan pesanan: ${errorMsg}`)
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
        e.preventDefault()
        if (hasPrinted) {
          // If already printed, Enter proceeds to new sale
          onClose()
        } else {
          // Otherwise Enter prints receipt
          handlePrint()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, hasPrinted, handlePrint])

  if (!isOpen || !receipt || !mounted) return null

  const changeAmount = Number(receipt.changeAmount || 0)
  const balanceDue = Number(receipt.grandTotal || 0)
  const tenderedAmount = Number(receipt.cashReceived ?? (receipt.amountPaid || balanceDue))

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex flex-col bg-slate-100 text-slate-900 select-none overflow-y-auto no-print font-sans"
      style={{
        overscrollBehavior: 'none',
        touchAction: 'pan-y'
      }}
    >
      {/* ─── 1. Kiosk Top Header (Solid Slate-900) ──────────────────── */}
      <header className="h-14 px-4 sm:px-6 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900 text-white">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-black flex items-center justify-center text-sm">
            ✓
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm sm:text-base text-white">
                Pembayaran Sukses
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-700 text-white uppercase tracking-wider">
                Lunas
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Nota: <strong className="text-slate-200">#{receipt.orderNumber}</strong>
            </p>
          </div>
        </div>

        {/* Quick Done / Exit Button in Header */}
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 border border-slate-700 cursor-pointer active:scale-95"
          title="Buka Transaksi Baru (Esc)"
        >
          <span>Transaksi Baru</span>
          <span className="text-xs text-slate-400 hidden sm:inline">↵</span>
        </button>
      </header>

      {/* ─── 2. Center Hero Content (Solid White Cards) ─────────────── */}
      <main className="flex-1 max-w-xl w-full mx-auto px-4 py-6 sm:py-8 flex flex-col justify-center">
        {/* Card Hero: Uang Kembalian */}
        <div className="text-center py-6 px-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs sm:text-sm font-bold tracking-wider text-slate-500 uppercase">
            Uang Kembalian
          </span>

          <div className="mt-2 text-5xl sm:text-7xl font-black font-mono tracking-tight text-slate-950 select-all">
            {formatIDR(changeAmount)}
          </div>

          <div className="mt-3 flex items-center justify-center gap-2">
            {changeAmount === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3.5 py-1 rounded-full">
                <span>✓</span> Uang Pas / Tidak Ada Kembalian
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-100 border border-amber-300 px-3.5 py-1 rounded-full">
                <span>💵</span> Serahkan Kembalian ke Pelanggan
              </span>
            )}
          </div>
        </div>

        {/* Card Rincian Tagihan & Transaksi */}
        <div className="mt-4 p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3 text-sm text-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Total Tagihan:</span>
            <span className="font-mono font-bold text-slate-950 text-base sm:text-lg">
              {formatIDR(balanceDue)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-600">Uang Diterima:</span>
            <span className="font-mono font-bold text-slate-950 text-base sm:text-lg">
              {formatIDR(tenderedAmount)}
            </span>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs sm:text-sm">
            <span className="text-slate-600">Metode Pembayaran:</span>
            <span className="font-semibold text-slate-900">
              {receipt.paymentMethod || 'Tunai'}
            </span>
          </div>

          {receipt.customerName && receipt.customerName !== 'Pelanggan Umum' && (
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="text-slate-600">Pelanggan:</span>
              <span className="font-semibold text-slate-900">{receipt.customerName}</span>
            </div>
          )}

          {receipt.cashierName && (
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
              <span>Kasir:</span>
              <span className="text-slate-700 font-medium">{receipt.cashierName}</span>
            </div>
          )}
        </div>

        {/* Alert Notifikasi Status Cetak */}
        {printMessage && (
          <div
            className={`mt-3 p-3 rounded-xl text-xs sm:text-sm font-semibold text-center transition flex items-center justify-center gap-2 border ${
              printMessage.startsWith('✓')
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-rose-50 border-rose-300 text-rose-800'
            }`}
          >
            <span>{printMessage}</span>
          </div>
        )}

        {/* Toggle & Drawer Pratinjau Kertas Thermal */}
        <div className="mt-3 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setShowThermalPreview((prev) => !prev)}
            className="text-xs text-slate-600 hover:text-slate-900 transition font-semibold cursor-pointer underline underline-offset-4 py-1"
          >
            {showThermalPreview ? '▲ Sembunyikan Pratinjau Kertas' : '▼ Lihat Pratinjau Kertas Struk'}
          </button>

          {showThermalPreview && (
            <div className="mt-2 w-full p-3 sm:p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-800">Pratinjau Kertas Struk</span>
                <div className="flex items-center gap-2">
                  <select
                    value={connectionType}
                    onChange={(e) => setConnectionType(e.target.value as ConnectionType)}
                    className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-slate-800 text-xs outline-none cursor-pointer"
                  >
                    <option value="system">Sistem (OS/USB)</option>
                    <option value="bluetooth">Bluetooth</option>
                  </select>
                  <select
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                    className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-slate-800 text-xs outline-none cursor-pointer"
                  >
                    <option value="58mm">Thermal 58mm</option>
                    <option value="80mm">Thermal 80mm</option>
                    <option value="A4">A4</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-center bg-slate-100 p-3 rounded-xl max-h-[320px] overflow-y-auto border border-slate-200">
                <iframe
                  title="Pratinjau Struk Kasir"
                  srcDoc={receiptHtml}
                  className={`bg-white rounded-lg shadow-xs border border-slate-300 ${
                    paperSize === '58mm' ? 'w-[236px]' : paperSize === '80mm' ? 'w-[320px]' : 'w-full'
                  } h-[420px]`}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ─── 3. Kiosk Action Bar (Solid White Footer) ───────────────── */}
      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] shadow-xs">
        <div className="max-w-xl mx-auto flex items-center gap-2 sm:gap-3">
          {/* Tombol 1: VOID (Kiri) */}
          <button
            type="button"
            onClick={handleVoid}
            disabled={isVoiding}
            className="px-3 sm:px-4 py-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-rose-50 hover:border-rose-300 text-rose-700 font-bold text-xs sm:text-sm transition flex items-center justify-center shrink-0 cursor-pointer active:scale-95 disabled:opacity-50"
            title="Batalkan pesanan ini (Void)"
          >
            {isVoiding ? 'Membatalkan...' : 'Void'}
          </button>

          {/* Dynamic Buttons Based on Print State */}
          {!hasPrinted ? (
            <>
              {/* Tombol 2: Lewati Struk */}
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs sm:text-sm transition flex items-center justify-center cursor-pointer active:scale-95"
                title="Selesai dan kembali ke kasir tanpa cetak struk"
              >
                Lewati Struk
              </button>

              {/* Tombol 3: Cetak Struk (Primary Blue) */}
              <button
                type="button"
                onClick={() => handlePrint()}
                disabled={isPrinting}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold text-xs sm:text-sm shadow-sm transition flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
                title="Cetak struk ke printer kasir (Tekan Enter)"
              >
                {isPrinting ? (
                  <span>Mencetak...</span>
                ) : (
                  <>
                    <span>🖨️ Cetak Struk</span>
                    <span className="text-[10px] bg-blue-800 px-1.5 py-0.5 rounded text-white hidden sm:inline">
                      Enter
                    </span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              {/* Tombol 2: Cetak Ulang Struk */}
              <button
                type="button"
                onClick={() => handlePrint()}
                disabled={isPrinting}
                className="flex-1 py-3 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs sm:text-sm transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                title="Cetak ulang struk"
              >
                <span>🖨️ Cetak Ulang</span>
              </button>

              {/* Tombol 3: Transaksi Baru (Dominant Green) */}
              <button
                type="button"
                onClick={onClose}
                className="flex-[1.5] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs sm:text-base shadow-sm transition flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                title="Mulai pesanan pelanggan baru (Tekan Enter atau Spasi)"
              >
                <span>+ Transaksi Baru</span>
                <span className="text-[11px] bg-emerald-800 px-1.5 py-0.5 rounded text-white hidden sm:inline">
                  Enter ↵
                </span>
              </button>
            </>
          )}
        </div>
      </footer>
    </div>,
    document.body
  )
}
