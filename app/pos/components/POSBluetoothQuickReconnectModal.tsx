"use client"

import { useState, useEffect } from 'react'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'
import {
  isWebBluetoothSupported,
  isBluetoothPrinterConnected,
  getActiveBluetoothDeviceName,
  getActiveBluetoothDeviceId,
  ensureBluetoothPrinterConnection,
  requestAndConnectBluetoothPrinter,
  sendBluetoothTestPrint,
  subscribeBluetoothStatus
} from '@/lib/pos/printerAdapter'
import { saveStoredReceiptSettings } from '@/lib/pos/receiptSettings'

interface Props {
  isOpen: boolean
  onClose: () => void
  defaultBusinessName?: string
  onSwitchToSystemPrint?: () => void
}

export default function POSBluetoothQuickReconnectModal({
  isOpen,
  onClose,
  defaultBusinessName = 'ShapeUp Store',
  onSwitchToSystemPrint
}: Props) {
  useModalBackHandler(isOpen, onClose)

  const [connected, setConnected] = useState<boolean>(false)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState<boolean>(false)
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const [isTesting, setIsTesting] = useState<boolean>(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // Sync connection state with Bluetooth subscriber
  useEffect(() => {
    if (!isOpen) return

    setConnected(isBluetoothPrinterConnected())
    setDeviceName(getActiveBluetoothDeviceName())
    setStatusMsg(null)

    const unsubscribe = subscribeBluetoothStatus((isConnected, name) => {
      setConnected(isConnected)
      if (name) setDeviceName(name)
    })

    return () => unsubscribe()
  }, [isOpen])

  if (!isOpen) return null

  const isBtSupported = isWebBluetoothSupported()

  // 1. Quick Reconnect to Known/Paired Device
  const handleQuickReconnect = async () => {
    setIsConnecting(true)
    setStatusMsg(null)
    try {
      const res = await ensureBluetoothPrinterConnection(true)
      if (res.success) {
        setConnected(true)
        if (res.deviceName) setDeviceName(res.deviceName)
        // Ensure connection type is set to bluetooth
        saveStoredReceiptSettings({ connectionType: 'bluetooth' }, defaultBusinessName)
        setStatusMsg({
          type: 'success',
          text: `Berhasil terhubung ke ${res.deviceName || 'Printer Bluetooth'}!`
        })
      } else {
        setStatusMsg({
          type: 'error',
          text: res.error || 'Gagal menyambungkan. Pastikan printer menyala di dekat tablet dan coba lagi.'
        })
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Terjadi kesalahan saat menyambungkan ke printer.'
      })
    } finally {
      setIsConnecting(false)
    }
  }

  // 2. Scan & Pair New / Different Device
  const handleScanNewDevice = async () => {
    setIsScanning(true)
    setStatusMsg(null)
    try {
      const res = await requestAndConnectBluetoothPrinter()
      if (res.success && res.deviceName) {
        setConnected(true)
        setDeviceName(res.deviceName)
        saveStoredReceiptSettings({ connectionType: 'bluetooth' }, defaultBusinessName)
        setStatusMsg({
          type: 'success',
          text: `Berhasil memasangkan printer baru: ${res.deviceName}!`
        })
      } else if (res.error) {
        setStatusMsg({
          type: 'error',
          text: res.error.includes('User cancelled') || res.error.includes('dibatalkan')
            ? 'Pemindaian dibatalkan.'
            : res.error
        })
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Gagal memindai printer Bluetooth.'
      })
    } finally {
      setIsScanning(false)
    }
  }

  // 3. Test Print
  const handleTestPrint = async () => {
    setIsTesting(true)
    setStatusMsg(null)
    try {
      const res = await sendBluetoothTestPrint()
      if (res.success) {
        setStatusMsg({
          type: 'success',
          text: '✅ Kertas tes cetak berhasil dikirim! Periksa printer Anda.'
        })
      } else {
        setStatusMsg({
          type: 'error',
          text: res.message || 'Gagal mencetak struk percobaan. Pastikan printer memiliki kertas.'
        })
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Error saat uji cetak.'
      })
    } finally {
      setIsTesting(false)
    }
  }

  // 4. Emergency Switch to System Print
  const handleSwitchToSystem = () => {
    saveStoredReceiptSettings({ connectionType: 'system' }, defaultBusinessName)
    if (onSwitchToSystemPrint) {
      onSwitchToSystemPrint()
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92dvh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bt-modal-title"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-400/30 flex items-center justify-center text-sm font-bold">
              📶
            </div>
            <div>
              <h2 id="bt-modal-title" className="font-bold text-sm leading-tight text-white">
                Printer Bluetooth Kasir
              </h2>
              <p className="text-[11px] text-slate-400 leading-none mt-0.5">
                Sambungkan ulang atau ganti perangkat printer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-xs transition"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {!isBtSupported && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
              <p className="font-bold">⚠️ Peramban Tidak Mendukung Web Bluetooth</p>
              <p className="text-[11px] text-rose-700 leading-relaxed">
                Fitur cetak langsung Bluetooth membutuhkan Google Chrome pada Android atau komputer.
              </p>
            </div>
          )}

          {/* Device Status Card */}
          <div className={`p-4 rounded-xl border transition-all ${
            connected
              ? 'bg-emerald-50/70 border-emerald-200'
              : 'bg-amber-50/70 border-amber-200'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Perangkat Terdaftar
                </span>
                <p className="font-bold text-sm text-slate-900 truncate mt-0.5">
                  {deviceName || 'Belum Ada Printer Terdaftar'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ID: {getActiveBluetoothDeviceId() ? `${getActiveBluetoothDeviceId()?.slice(0, 14)}...` : 'Belum Tersimpan'}
                </p>
              </div>

              <div className="shrink-0 text-right">
                {connected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Siap Cetak
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Terputus
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Feedback Message */}
          {statusMsg && (
            <div className={`p-3 rounded-xl text-xs font-medium border flex items-start gap-2 animate-in fade-in ${
              statusMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : statusMsg.type === 'error'
                ? 'bg-rose-50 text-rose-900 border-rose-200'
                : 'bg-indigo-50 text-indigo-900 border-indigo-200'
            }`}>
              <span className="shrink-0 text-sm">
                {statusMsg.type === 'success' ? '✅' : statusMsg.type === 'error' ? '❌' : 'ℹ️'}
              </span>
              <p className="leading-snug">{statusMsg.text}</p>
            </div>
          )}

          {/* Connection Checklist (Shown when disconnected) */}
          {!connected && (
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-[11px] text-slate-600 space-y-1.5">
              <p className="font-bold text-slate-800 text-xs">Sebelum menghubungkan, pastikan:</p>
              <div className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Printer dalam kondisi <strong>MENYALA (Power ON)</strong>.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Jarak printer dekat dengan tablet/komputer kasir (&lt; 3 meter).</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Bluetooth di tablet/komputer dalam keadaan <strong>AKTIF</strong>.</span>
              </div>
            </div>
          )}

          {/* Primary Action Button */}
          <div>
            {!connected ? (
              <button
                type="button"
                onClick={handleQuickReconnect}
                disabled={isConnecting || isScanning || !isBtSupported}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md shadow-indigo-600/20 active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {isConnecting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Menghubungkan ke Printer...</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>HUBUNGKAN ULANG SEKARANG</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTestPrint}
                disabled={isTesting}
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-600/20 active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {isTesting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Mencetak Struk Tes...</span>
                  </>
                ) : (
                  <>
                    <span>🧾</span>
                    <span>UJI CETAK (TEST PRINT)</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Secondary Actions Divider */}
          <div className="relative py-1 flex items-center justify-center">
            <div className="w-full border-t border-slate-200" />
            <span className="absolute bg-white px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Pilihan Lain
            </span>
          </div>

          {/* Secondary Buttons */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleScanNewDevice}
              disabled={isScanning || isConnecting || !isBtSupported}
              className="w-full py-2.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isScanning ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
                  <span>Memindai Perangkat...</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>Cari / Ganti Printer Baru</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSwitchToSystem}
              className="w-full py-2.5 px-3 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl text-xs font-semibold active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer"
              title="Alihkan ke dialog cetak peramban jika printer Bluetooth rusak/habis baterai"
            >
              <span>🖥️</span>
              <span>Alihkan ke Cetak Sistem (Browser/USB)</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <p className="text-[10px] text-slate-400">
            Tip: Pastikan printer tidak terhubung ke HP lain
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}

