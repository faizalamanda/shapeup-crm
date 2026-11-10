"use client"

import { useState, useEffect, useRef } from 'react'
import {
  isWebBluetoothSupported,
  isBluetoothPrinterConnected,
  getActiveBluetoothDeviceName,
  hasPairedBluetoothPrinter,
  ensureBluetoothPrinterConnection,
  subscribeBluetoothStatus
} from '@/lib/pos/printerAdapter'
import { getStoredReceiptSettings } from '@/lib/pos/receiptSettings'

interface Props {
  onOpenQuickModal: () => void
  defaultBusinessName?: string
}

export default function POSBluetoothStatusBar({
  onOpenQuickModal,
  defaultBusinessName = 'ShapeUp Store'
}: Props) {
  const [isBluetoothConfigured, setIsBluetoothConfigured] = useState<boolean>(false)
  const [connected, setConnected] = useState<boolean>(false)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [isDismissed, setIsDismissed] = useState<boolean>(false)
  const [showConnectedToast, setShowConnectedToast] = useState<boolean>(false)
  const prevConnectedRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // 1. Check if user configured Bluetooth printer
    const settings = getStoredReceiptSettings(defaultBusinessName)
    const hasConfigured = settings.connectionType === 'bluetooth' || hasPairedBluetoothPrinter()
    setIsBluetoothConfigured(hasConfigured)

    if (!hasConfigured || !isWebBluetoothSupported()) return

    const initialConnected = isBluetoothPrinterConnected()
    const initialName = getActiveBluetoothDeviceName()
    setConnected(initialConnected)
    setDeviceName(initialName)
    prevConnectedRef.current = initialConnected

    // Proactive silent probing on POS entry if not already connected
    if (!initialConnected) {
      void ensureBluetoothPrinterConnection(false).then((res) => {
        if (res.success) {
          setConnected(true)
          if (res.deviceName) setDeviceName(res.deviceName)
        }
      }).catch(() => {})
    }

    // 2. Subscribe to reactive Bluetooth status updates
    const unsubscribe = subscribeBluetoothStatus((isConnected, name) => {
      setConnected(isConnected)
      if (name) setDeviceName(name)

      // Show temporary green toast if it transitioned from disconnected to connected
      if (prevConnectedRef.current === false && isConnected) {
        setShowConnectedToast(true)
        setIsDismissed(false)
        const timer = setTimeout(() => {
          setShowConnectedToast(false)
        }, 3500)
        return () => clearTimeout(timer)
      }
      prevConnectedRef.current = isConnected
    })

    return () => unsubscribe()
  }, [defaultBusinessName])

  // If Bluetooth is not configured or user is on system print, do not render anything
  if (!isBluetoothConfigured || !isWebBluetoothSupported()) {
    return null
  }

  // If already connected and not showing temporary success toast, keep view completely clean
  if (connected && !showConnectedToast) {
    return null
  }

  // If user explicitly dismissed the disconnected warning for this session
  if (!connected && isDismissed) {
    return null
  }

  return (
    <aside
      aria-label="Status Printer Bluetooth"
      className="fixed top-15 right-3 sm:right-4 z-30 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200"
    >
      {/* CASE A: Disconnected Warning Pill */}
      {!connected && (
        <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md text-white border border-amber-500/50 rounded-2xl shadow-xl shadow-black/20 p-2.5 sm:px-3.5 sm:py-2.5 flex items-center gap-2.5 max-w-[340px]">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-400/40 flex items-center justify-center text-xs shrink-0 font-bold">
            📶⚠️
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-amber-300 leading-none">
                Printer Kasir Terputus
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
            </div>
            <p className="text-[10px] text-slate-300 truncate mt-0.5 leading-tight">
              {deviceName || 'Printer Bluetooth'}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onOpenQuickModal}
              className="px-2.5 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-[11px] font-bold shadow-sm shadow-indigo-600/30 active:scale-95 transition flex items-center gap-1"
            >
              <span>⚡</span>
              <span>Sambungkan</span>
            </button>

            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="w-6 h-6 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center text-xs transition"
              title="Abaikan notifikasi"
              aria-label="Abaikan"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* CASE B: Brief Connected Success Pill */}
      {connected && showConnectedToast && (
        <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md text-white border border-emerald-500/50 rounded-2xl shadow-xl p-2.5 sm:px-3.5 sm:py-2 flex items-center gap-2.5 max-w-[320px] animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-400/40 flex items-center justify-center text-xs shrink-0 font-bold">
            🟢
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-emerald-300 leading-none">
              Printer Bluetooth Terhubung
            </p>
            <p className="text-[10px] text-slate-300 truncate mt-0.5 leading-tight">
              {deviceName || 'Siap Mencetak'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowConnectedToast(false)}
            className="w-5 h-5 rounded-md text-slate-400 hover:text-white text-xs"
            aria-label="Tutup notifikasi"
          >
            ✕
          </button>
        </div>
      )}
    </aside>
  )
}

