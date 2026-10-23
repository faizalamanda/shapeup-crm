"use client"

import { useState, useEffect, useMemo } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { 
  PaperSize, 
  ConnectionType, 
  generateReceiptHtml,
  isWebBluetoothSupported, 
  getActiveBluetoothDeviceName, 
  requestAndConnectBluetoothPrinter, 
  disconnectBluetoothPrinter, 
  sendBluetoothTestPrint 
} from '@/lib/pos/printerAdapter'
import { useUserContext } from '@/components/UserContext'
import { supabase } from '@/lib/supabase'
import { fetchLoyaltySettings } from '@/plugins/loyalty/helpers/loyaltyApi'
import { 
  type ReceiptSettings, 
  getStoredReceiptSettings, 
  RECEIPT_SETTINGS_STORAGE_KEY 
} from '@/lib/pos/receiptSettings'
import { buildSampleReceiptData } from '@/lib/pos/receiptDataBuilder'

export { type ReceiptSettings, getStoredReceiptSettings }



type Props = {
  isOpen: boolean
  onClose: () => void
  defaultBusinessName?: string
  businessId?: string
  onSave?: (settings: ReceiptSettings) => void
}

export default function ReceiptSettingsModal({ isOpen, onClose, defaultBusinessName = 'ShapeUp Store', businessId, onSave }: Props) {
  const { activeBusiness } = useUserContext()
  const targetBizId = businessId || activeBusiness?.id

  const [storeName, setStoreName] = useState(defaultBusinessName)
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [footerNote, setFooterNote] = useState('Terima kasih atas kunjungan Anda!')
  const [paperSize, setPaperSize] = useState<PaperSize>('58mm')
  const [connectionType, setConnectionType] = useState<ConnectionType>('system')
  const [btDeviceName, setBtDeviceName] = useState<string | null>(null)
  const [isConnectingBt, setIsConnectingBt] = useState(false)
  const [btStatusMsg, setBtStatusMsg] = useState<string | null>(null)
  const [autoPrintAfterPayment, setAutoPrintAfterPayment] = useState(false)
  const [showItemNumbering, setShowItemNumbering] = useState(true)
  const [showLoyaltyPoints, setShowLoyaltyPoints] = useState(true)
  const [isLoyaltyProgramEnabled, setIsLoyaltyProgramEnabled] = useState(false)
  const [loadingLoyalty, setLoadingLoyalty] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const s = getStoredReceiptSettings(defaultBusinessName)
      setStoreName(s.storeName)
      setAddress(s.address)
      setPhone(s.phone)
      setFooterNote(s.footerNote)
      setPaperSize(s.paperSize)
      setConnectionType(s.connectionType || 'system')
      setBtDeviceName(getActiveBluetoothDeviceName())
      setAutoPrintAfterPayment(s.autoPrintAfterPayment)
      setShowItemNumbering(s.showItemNumbering)
      setShowLoyaltyPoints(s.showLoyaltyPoints)
      setSaveSuccess(false)
      setBtStatusMsg(null)

      if (targetBizId) {
        setLoadingLoyalty(true)
        fetchLoyaltySettings(supabase, targetBizId)
          .then((ls) => {
            setIsLoyaltyProgramEnabled(Boolean(ls?.is_enabled))
          })
          .catch((err) => {
            console.warn('[ReceiptSettings] Failed checking loyalty settings:', err)
            setIsLoyaltyProgramEnabled(false)
          })
          .finally(() => {
            setLoadingLoyalty(false)
          })
      } else {
        setIsLoyaltyProgramEnabled(false)
      }
    }
  }, [isOpen, defaultBusinessName, targetBizId])

  const handleConnectBluetooth = async () => {
    setIsConnectingBt(true)
    setBtStatusMsg(null)
    try {
      const res = await requestAndConnectBluetoothPrinter()
      if (res.success && res.deviceName) {
        setBtDeviceName(res.deviceName)
        setConnectionType('bluetooth')
        setBtStatusMsg(`Terhubung ke ${res.deviceName}`)
      } else {
        setBtStatusMsg(res.error || 'Gagal menyambungkan Bluetooth')
      }
    } catch (err: any) {
      setBtStatusMsg(err.message || 'Terjadi kesalahan Bluetooth')
    } finally {
      setIsConnectingBt(false)
    }
  }

  const handleDisconnectBluetooth = async () => {
    await disconnectBluetoothPrinter()
    setBtDeviceName(null)
    setBtStatusMsg('Bluetooth printer diputuskan')
  }

  const handleTestPrintBluetooth = async () => {
    setIsConnectingBt(true)
    setBtStatusMsg('Mengirim data uji cetak...')
    try {
      const res = await sendBluetoothTestPrint()
      if (res.success) {
        setBtStatusMsg('Uji cetak berhasil!')
      } else {
        setBtStatusMsg(res.message || 'Gagal uji cetak')
      }
    } catch (err: any) {
      setBtStatusMsg('Kesalahan: ' + err.message)
    } finally {
      setIsConnectingBt(false)
    }
  }

  const handleSave = () => {
    const settings: ReceiptSettings = {
      storeName: storeName.trim() || defaultBusinessName,
      address: address.trim(),
      phone: phone.trim(),
      footerNote: footerNote.trim(),
      paperSize,
      connectionType,
      autoPrintAfterPayment,
      showItemNumbering,
      showLoyaltyPoints
    }

    try {
      localStorage.setItem(RECEIPT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
      if (onSave) onSave(settings)
      setSaveSuccess(true)
      setTimeout(() => {
        onClose()
      }, 600)
    } catch (e) {
      console.error('Failed saving receipt settings:', e)
    }
  }

  const sampleReceipt = useMemo(() => {
    return buildSampleReceiptData({
      storeName: storeName.trim() || defaultBusinessName,
      address: address.trim(),
      phone: phone.trim(),
      footerNote: footerNote.trim(),
      paperSize,
      connectionType,
      autoPrintAfterPayment,
      showItemNumbering,
      showLoyaltyPoints: isLoyaltyProgramEnabled && showLoyaltyPoints
    })
  }, [
    storeName,
    defaultBusinessName,
    address,
    phone,
    footerNote,
    paperSize,
    connectionType,
    autoPrintAfterPayment,
    showItemNumbering,
    isLoyaltyProgramEnabled,
    showLoyaltyPoints
  ])

  const sampleReceiptHtml = useMemo(() => {
    return generateReceiptHtml(sampleReceipt, paperSize)
  }, [sampleReceipt, paperSize])

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      title="⚙️ Pengaturan Struk & Printer Kasir"
      description="Konfigurasi header struk, informasi toko, nomor urut produk, dan poin loyalty"
      desktopSize="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {saveSuccess ? (
            <span className="text-xs font-bold text-emerald-600">✓ Pengaturan berhasil disimpan!</span>
          ) : <span />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs transition"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-sm"
            >
              Simpan Pengaturan
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
        {/* Kolom Kiri: Form Pengaturan */}
        <div className="space-y-4">
          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Nama Toko / Bisnis di Struk
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Contoh: Toko Berkah Jaya"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Alamat Toko (Opsional)
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Contoh: Jl. Sudirman No. 45, Jakarta"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Nomor Telepon / WhatsApp
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Contoh: 0812-3456-7890"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Metode Cetak Printer
            </label>
            <select
              value={connectionType}
              onChange={(e) => setConnectionType(e.target.value as ConnectionType)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="system">Printer Sistem (Browser/OS / Komputer / Kabel USB / RawBT)</option>
              <option value="bluetooth">Direct Bluetooth (BLE Instan tanpa keluar PWA)</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              {connectionType === 'bluetooth' 
                ? '⚡ Mencetak langsung via Web Bluetooth (0.2 detik, tanpa keluar PWA, tanpa RawBT).'
                : '🖥️ Menggunakan dialog cetak bawaan sistem OS atau printer kabel USB komputer.'}
            </p>
          </div>

          {/* Bluetooth Device Management Card */}
          {connectionType === 'bluetooth' && (
            <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
                  Status Printer Bluetooth
                </span>
                {btDeviceName ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                    🟢 {btDeviceName}
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full">
                    ⚪ Belum Terhubung
                  </span>
                )}
              </div>

              {btStatusMsg && (
                <div className="text-[11px] p-2 rounded-lg bg-white border border-indigo-100 text-indigo-700 font-medium">
                  {btStatusMsg}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleConnectBluetooth}
                  disabled={isConnectingBt}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                >
                  {isConnectingBt ? 'Menghubungkan...' : btDeviceName ? 'Ganti Printer Bluetooth' : 'Hubungkan Printer Bluetooth'}
                </button>
                {btDeviceName && (
                  <>
                    <button
                      type="button"
                      onClick={handleTestPrintBluetooth}
                      disabled={isConnectingBt}
                      className="px-3 py-1.5 bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-300 rounded-lg text-xs font-semibold transition-all"
                    >
                      Uji Cetak (Test Print)
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectBluetooth}
                      className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-xs font-semibold transition-all"
                    >
                      Putuskan
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Ukuran Kertas Printer Kasir
            </label>
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSize)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="58mm">Thermal 58mm (Ukuran Standar Kasir Mini)</option>
              <option value="80mm">Thermal 80mm (Ukuran Standar Resto / Supermarket)</option>
              <option value="A4">Kertas Halaman A4 / Invoice</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Catatan Kaki Struk (Footer Notes)
            </label>
            <textarea
              rows={3}
              value={footerNote}
              onChange={(e) => setFooterNote(e.target.value)}
              placeholder="Pesan ucapan terima kasih atau kebijakan retur..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
            />
          </div>

          {/* Opsi Tampilan & Cetak */}
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <span className="block font-bold text-slate-800 uppercase tracking-wider text-[11px]">
              Opsi Format Struk & Fitur
            </span>

            {/* Toggle 1: Nomor Urut Pencatatan Produk */}
            <div className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <input
                type="checkbox"
                id="itemNumberingCheckbox"
                checked={showItemNumbering}
                onChange={(e) => setShowItemNumbering(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              <div className="flex-1">
                <label htmlFor="itemNumberingCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                  Nomor Urut Pencatatan Produk
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Tampilkan nomor urut (1, 2, 3...) di sebelah kiri nama setiap item produk untuk memudahkan verifikasi daftar belanjaan.
                </p>
              </div>
            </div>

            {/* Toggle 2: Poin Loyalty Pelanggan */}
            <div className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <input
                type="checkbox"
                id="loyaltyPointsCheckbox"
                checked={isLoyaltyProgramEnabled && showLoyaltyPoints}
                disabled={!isLoyaltyProgramEnabled || loadingLoyalty}
                onChange={(e) => setShowLoyaltyPoints(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer disabled:opacity-40"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <label htmlFor="loyaltyPointsCheckbox" className={`font-semibold text-xs ${isLoyaltyProgramEnabled ? 'text-slate-800 cursor-pointer' : 'text-slate-400'}`}>
                    Tampilkan Poin Loyalty Member
                  </label>
                  {loadingLoyalty ? (
                    <span className="text-[9px] font-medium text-slate-400">Memeriksa...</span>
                  ) : isLoyaltyProgramEnabled ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-200">
                      🟢 Fitur Aktif di Bisnis
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-md border border-amber-200">
                      ⚠️ Fitur Belum Aktif
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {isLoyaltyProgramEnabled 
                    ? 'Mencetak tier member, perolehan poin transaksi ini, dan total saldo poin akhir pada struk pelanggan member.'
                    : 'Program loyalty member belum diaktifkan oleh bisnis. Anda dapat mengaktifkannya di menu Pelanggan → Program Loyalty.'}
                </p>
              </div>
            </div>

            {/* Toggle 3: Auto-Print */}
            <div className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <input
                type="checkbox"
                id="autoPrintCheckbox"
                checked={autoPrintAfterPayment}
                onChange={(e) => setAutoPrintAfterPayment(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              <div className="flex-1">
                <label htmlFor="autoPrintCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                  Cetak Otomatis Setelah Pembayaran
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Otomatis membuka dialog cetak struk sesaat setelah transaksi kasir berhasil diselesaikan.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Kolom Kanan: Pratinjau Struk Live */}
        <div className="bg-slate-100 p-4 rounded-2xl border border-slate-200 flex flex-col items-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
            👁️ Pratinjau Tampilan Struk
          </span>
          <iframe 
            title="Pratinjau Struk Kasir"
            srcDoc={sampleReceiptHtml}
            className={`bg-white rounded-xl shadow-md border border-slate-300 transition-all ${
              paperSize === '58mm' ? 'w-[236px]' : paperSize === '80mm' ? 'w-[320px]' : 'w-full max-w-sm'
            } h-[580px]`}
          />
        </div>
      </div>
    </FullScreenModal>
  )
}
