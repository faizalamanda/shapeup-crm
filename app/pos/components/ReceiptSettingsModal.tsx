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
import {
  type KitchenSettings,
  getStoredKitchenSettings,
  saveStoredKitchenSettings,
  KitchenStationId,
  KITCHEN_STATIONS
} from '@/lib/pos/kitchenSettings'
import {
  generateKitchenTicketHtml,
  KitchenTicketData
} from '@/lib/pos/kitchenTicketBuilder'
import { resolvePosMode } from '@/lib/pos/posMode'
import ProductionStationsModal from './ProductionStationsModal'

export { type ReceiptSettings, getStoredReceiptSettings }

type Props = {
  isOpen: boolean
  onClose: () => void
  defaultBusinessName?: string
  businessId?: string
  categories?: any[]
  onSave?: (settings: ReceiptSettings, kitchenSettings?: KitchenSettings) => void
}

export default function ReceiptSettingsModal({ 
  isOpen, 
  onClose, 
  defaultBusinessName = 'ShapeUp Store', 
  businessId, 
  categories = [], 
  onSave 
}: Props) {
  const { activeBusiness } = useUserContext()
  const targetBizId = businessId || activeBusiness?.id
  const posMode = useMemo(() => resolvePosMode(activeBusiness), [activeBusiness])
  const [showStationsModal, setShowStationsModal] = useState(false)

  const [mainTab, setMainTab] = useState<'receipt' | 'kitchen'>('receipt')

  // Receipt Settings States
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
  const [showQueueNumber, setShowQueueNumber] = useState(false)
  const [showLoyaltyPoints, setShowLoyaltyPoints] = useState(true)
  const [isLoyaltyProgramEnabled, setIsLoyaltyProgramEnabled] = useState(false)
  const [loadingLoyalty, setLoadingLoyalty] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Kitchen Settings States
  const [kitchenEnabled, setKitchenEnabled] = useState(true)
  const [kitchenAutoPrintPay, setKitchenAutoPrintPay] = useState(false)
  const [kitchenAutoPrintHold, setKitchenAutoPrintHold] = useState(false)
  const [kitchenSeparateStations, setKitchenSeparateStations] = useState(true)
  const [kitchenSoundBuzzer, setKitchenSoundBuzzer] = useState(true)
  const [kitchenAutoCut, setKitchenAutoCut] = useState(true)
  const [categoryStationMap, setCategoryStationMap] = useState<Record<string, KitchenStationId>>({})
  const [loadedCategories, setLoadedCategories] = useState<any[]>(categories || [])

  useEffect(() => {
    if (isOpen && targetBizId && (!categories || categories.length === 0)) {
      supabase
        .from('categories')
        .select('id, name')
        .eq('business_id', targetBizId)
        .order('name')
        .then(({ data }) => {
          if (data && data.length > 0) setLoadedCategories(data)
        })
    } else if (categories && categories.length > 0) {
      setLoadedCategories(categories)
    }
  }, [isOpen, targetBizId, categories])

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
      setShowQueueNumber(Boolean(s.showQueueNumber))
      setShowLoyaltyPoints(s.showLoyaltyPoints)
      setSaveSuccess(false)
      setBtStatusMsg(null)

      const ks = getStoredKitchenSettings(s.paperSize)
      setKitchenEnabled(ks.enabled)
      setKitchenAutoPrintPay(ks.autoPrintOnPayment)
      setKitchenAutoPrintHold(ks.autoPrintOnHold)
      setKitchenSeparateStations(ks.separateStations)
      setKitchenSoundBuzzer(ks.soundBuzzer)
      setKitchenAutoCut(ks.autoCutPaper)
      setCategoryStationMap(ks.categoryStationMap || {})

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
        // Auto-persist connectionType so cashier doesn't lose setting if they don't press bottom save
        try {
          const cur = getStoredReceiptSettings(defaultBusinessName)
          localStorage.setItem(RECEIPT_SETTINGS_STORAGE_KEY, JSON.stringify({
            ...cur,
            connectionType: 'bluetooth'
          }))
        } catch {}
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
    setConnectionType('system')
    setBtStatusMsg('Bluetooth printer diputuskan')
    try {
      const cur = getStoredReceiptSettings(defaultBusinessName)
      localStorage.setItem(RECEIPT_SETTINGS_STORAGE_KEY, JSON.stringify({
        ...cur,
        connectionType: 'system'
      }))
    } catch {}
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
      showLoyaltyPoints,
      showQueueNumber
    }

    const kSettings: KitchenSettings = {
      enabled: kitchenEnabled,
      autoPrintOnPayment: kitchenAutoPrintPay,
      autoPrintOnHold: kitchenAutoPrintHold,
      separateStations: kitchenSeparateStations,
      paperSize,
      categoryStationMap,
      soundBuzzer: kitchenSoundBuzzer,
      autoCutPaper: kitchenAutoCut,
      showTableNumber: true,
      showItemNumbering: true
    }

    try {
      localStorage.setItem(RECEIPT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
      saveStoredKitchenSettings(kSettings)
      if (onSave) onSave(settings, kSettings)
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
      showQueueNumber,
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
    showQueueNumber,
    isLoyaltyProgramEnabled,
    showLoyaltyPoints
  ])

  const sampleReceiptHtml = useMemo(() => {
    return generateReceiptHtml(sampleReceipt, paperSize)
  }, [sampleReceipt, paperSize])

  const sampleKitchenTicket = useMemo<KitchenTicketData>(() => {
    return {
      stationId: 'kitchen',
      stationName: 'Dapur Makanan',
      stationLabel: 'DAPUR UTAMA',
      stationIcon: '🍳',
      businessName: storeName.trim() || defaultBusinessName,
      orderNumber: 'POS-20261107-0042',
      tableNumber: 'MEJA 08',
      queueNumber: 42,
      orderType: 'DINE-IN',
      timestamp: '13:45:10',
      cashierOrServer: 'Kasir / Waiter',
      customerName: 'Budi Santoso',
      globalOrderNote: 'Tamu VIP - jangan terlalu asin & minta sendok 2',
      items: [
        {
          name: 'AYAM BAKAR TALIWANG',
          quantity: 2,
          modifiers: [{ group: 'Level', option: 'PEDAS LEVEL 5 (EXTRA)' }],
          note: 'Bumbu dipisah di mangkok kecil',
          station: 'kitchen'
        },
        {
          name: 'NASI PUTIH HANGAT',
          quantity: 2,
          station: 'kitchen'
        }
      ],
      paperSize: paperSize || '58mm',
      ticketKind: 'NEW'
    }
  }, [storeName, defaultBusinessName, paperSize])

  const sampleKitchenTicketHtml = useMemo(() => {
    return generateKitchenTicketHtml(sampleKitchenTicket)
  }, [sampleKitchenTicket])

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      title="⚙️ Pengaturan Struk &amp; Printer POS"
      description="Konfigurasi struk pelanggan, nota produksi dapur &amp; bar, auto-print, dan stasiun printer"
      desktopSize="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {saveSuccess ? (
            <span className="text-xs font-bold text-emerald-600">✓ Seluruh pengaturan berhasil disimpan!</span>
          ) : <span />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
            >
              Simpan Pengaturan
            </button>
          </div>
        </div>
      }
    >
      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200 mb-5 gap-2">
        <button
          type="button"
          onClick={() => setMainTab('receipt')}
          className={`pb-2.5 px-3 font-bold text-xs flex items-center gap-1.5 border-b-2 transition cursor-pointer ${
            mainTab === 'receipt'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🧾</span>
          <span>Struk Kasir (Pelanggan)</span>
        </button>
        <button
          type="button"
          onClick={() => setMainTab('kitchen')}
          className={`pb-2.5 px-3 font-bold text-xs flex items-center gap-1.5 border-b-2 transition cursor-pointer ${
            mainTab === 'kitchen'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🍳</span>
          <span>Nota Dapur &amp; Bar (Kitchen Chit)</span>
          {(kitchenAutoPrintPay || kitchenAutoPrintHold) && (
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-mono font-bold">
              Auto ON
            </span>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
        {/* Kolom Kiri: Form Pengaturan Berdasarkan Tab */}
        {mainTab === 'receipt' ? (
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
                Opsi Format Struk &amp; Fitur
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

              {/* Toggle: Nomor Antrean Ringkas */}
              <div className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                <input
                  type="checkbox"
                  id="queueNumberCheckbox"
                  checked={showQueueNumber}
                  onChange={(e) => setShowQueueNumber(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <div className="flex-1">
                  <label htmlFor="queueNumberCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                    Cetak Nomor Antrean Ringkas (#001)
                  </label>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Mencetak nomor antrean harian dengan ukuran besar di atas struk. Berguna untuk memanggil nomor pesanan di meja kasir, dapur, atau barista (Default: Nonaktif).
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
                    Cetak Otomatis Struk Pelanggan Setelah Pembayaran
                  </label>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Otomatis membuka dialog cetak struk sesaat setelah transaksi kasir berhasil diselesaikan.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Tab Kitchen: Form Pengaturan Nota Dapur & Bar */
          <div className="space-y-4">
            {/* Banner Mode POS: Retail Fashion vs F&B */}
            {posMode.isRetail ? (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-amber-900">
                    <span>👗</span>
                    <span>Mode POS Saat Ini: Retail &amp; Fashion</span>
                  </div>
                  <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                    Tombol nota dapur disembunyikan otomatis di kasir agar antarmuka kasir toko pakaian tetap bersih &amp; fokus.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStationsModal(true)}
                  className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold rounded-lg text-xs whitespace-nowrap shadow-sm cursor-pointer transition"
                >
                  Ganti ke Mode F&amp;B
                </button>
              </div>
            ) : (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-900">
                    <span>🍽️</span>
                    <span>Mode POS Saat Ini: F&amp;B / Restoran &amp; Cafe</span>
                  </div>
                  <p className="text-[11px] text-emerald-800 mt-0.5 leading-relaxed">
                    Fitur cetak nota dapur &amp; bar aktif dan siap disalurkan ke stasiun produksi kustom.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStationsModal(true)}
                  className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold rounded-lg text-xs whitespace-nowrap shadow-sm cursor-pointer transition flex items-center gap-1"
                >
                  <span>🏭</span>
                  <span>Kelola Stasiun Kustom</span>
                </button>
              </div>
            )}

            {/* Tombol Manajemen Stasiun Database */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2">
              <div>
                <span className="font-bold text-slate-800 text-xs block">🏭 Stasiun Produksi Fleksibel (Database)</span>
                <span className="text-[11px] text-slate-500 block">Buat stasiun custom (Dapur, Bar, Pastry, Grill) &amp; petakan kategori menu</span>
              </div>
              <button
                type="button"
                onClick={() => setShowStationsModal(true)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-lg text-xs transition cursor-pointer shrink-0"
              >
                Atur Stasiun
              </button>
            </div>

            {/* Toggle Master: Kitchen Feature */}
            <div className="flex items-start gap-2.5 bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-200">
              <input
                type="checkbox"
                id="kitchenEnabledCheckbox"
                checked={kitchenEnabled}
                onChange={(e) => setKitchenEnabled(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              <div className="flex-1">
                <label htmlFor="kitchenEnabledCheckbox" className="font-bold text-indigo-950 cursor-pointer text-xs block">
                  Aktifkan Fitur Cetak Nota Dapur &amp; Bar (Production Ticket)
                </label>
                <p className="text-[11px] text-indigo-800 mt-0.5 leading-relaxed">
                  Menampilkan tombol cetak perintah masak tanpa nominal harga untuk koki dan barista, lengkap dengan nomor meja, antrean raksasa, dan instruksi modifikasi.
                </p>
              </div>
            </div>

            {/* Auto-Print Section */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <span className="block font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                ⚡ Otomatisasi Cetak Dapur (Tanpa Perlu Tekan Tombol)
              </span>

              {/* Auto-print on Payment */}
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="kitchenAutoPayCheckbox"
                  checked={kitchenAutoPrintPay}
                  onChange={(e) => setKitchenAutoPrintPay(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <div className="flex-1">
                  <label htmlFor="kitchenAutoPayCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                    Cetak Otomatis Saat Selesai Pembayaran (Fast Food / Kasir Upfront)
                  </label>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Nota dapur seketika dicetak otomatis begitu transaksi pembayaran selesai tanpa perlu menekan tombol cetak lagi.
                  </p>
                </div>
              </div>

              {/* Auto-print on Hold */}
              <div className="flex items-start gap-2.5 pt-2 border-t border-slate-200/80">
                <input
                  type="checkbox"
                  id="kitchenAutoHoldCheckbox"
                  checked={kitchenAutoPrintHold}
                  onChange={(e) => setKitchenAutoPrintHold(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <div className="flex-1">
                  <label htmlFor="kitchenAutoHoldCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                    Cetak Otomatis Saat Transaksi Ditahan (Resto Meja / Makan Dulu)
                  </label>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Nota dapur langsung dicetak otomatis saat kasir menahan pesanan meja (*Hold Order*), sehingga juru masak langsung menerima pesanan sebelum meja membayar.
                  </p>
                </div>
              </div>
            </div>

            {/* Station Routing */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <span className="block font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                🔀 Pemisahan Stasiun Masak (Multi-Station Routing)
              </span>

              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="kitchenSeparateCheckbox"
                  checked={kitchenSeparateStations}
                  onChange={(e) => setKitchenSeparateStations(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <div className="flex-1">
                  <label htmlFor="kitchenSeparateCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                    Pisahkan Tiket Dapur Makanan &amp; Bar Minuman
                  </label>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Jika dicentang, pesanan makanan akan dicetak pada nota <b>[DAPUR UTAMA]</b> dan pesanan minuman pada nota <b>[BAR &amp; MINUMAN]</b>. Jika tidak, keduanya digabung dalam 1 nota dapur.
                  </p>
                </div>
              </div>

              {/* Category Mapping Table (if categories exist) */}
              {kitchenSeparateStations && loadedCategories && loadedCategories.length > 0 && (
                <div className="pt-2 border-t border-slate-200/80 space-y-2">
                  <span className="font-bold text-[11px] text-slate-700 block">
                    Pemetaan Kategori Menu ke Stasiun:
                  </span>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {loadedCategories.map((c: any) => {
                      const currentStation = categoryStationMap[c.id] || (
                        c.name?.toLowerCase().includes('minum') || c.name?.toLowerCase().includes('drink') || c.name?.toLowerCase().includes('kopi')
                          ? 'bar'
                          : 'kitchen'
                      )
                      return (
                        <div key={c.id} className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                          <span className="font-medium text-slate-800 truncate max-w-[150px]">{c.name}</span>
                          <select
                            value={currentStation}
                            onChange={(e) => {
                              const val = e.target.value as KitchenStationId
                              setCategoryStationMap(prev => ({ ...prev, [c.id]: val }))
                            }}
                            className="text-[11px] font-bold py-1 px-2 border border-slate-200 rounded-md bg-slate-50 text-slate-700 focus:outline-none"
                          >
                            <option value="kitchen">🍳 Dapur Makanan</option>
                            <option value="bar">🍹 Bar Minuman</option>
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Hardware Signals */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
              <span className="block font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                🔔 Sinyal Perangkat Keras Printer Dapur
              </span>

              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 block text-xs">Alarm Buzzer / Beeper Printer</span>
                  <span className="text-[11px] text-slate-500">Bunyikan nada 'beep' 2x agar koki waspada saat pesanan keluar.</span>
                </div>
                <input
                  type="checkbox"
                  checked={kitchenSoundBuzzer}
                  onChange={(e) => setKitchenSoundBuzzer(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
                <div>
                  <span className="font-semibold text-slate-800 block text-xs">Potong Kertas Otomatis (Auto-Cut)</span>
                  <span className="text-[11px] text-slate-500">Memicu pemotong kertas thermal setelah nota selesai dicetak.</span>
                </div>
                <input
                  type="checkbox"
                  checked={kitchenAutoCut}
                  onChange={(e) => setKitchenAutoCut(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* Kolom Kanan: Pratinjau Struk / Tiket Dapur Live */}
        <div className="bg-slate-100 p-4 rounded-2xl border border-slate-200 flex flex-col items-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
            {mainTab === 'receipt' ? '👁️ Pratinjau Struk Kasir (Pelanggan)' : '👁️ Pratinjau Nota Dapur (Zero Price & Modifiers)'}
          </span>
          <iframe 
            title={mainTab === 'receipt' ? 'Pratinjau Struk Kasir' : 'Pratinjau Nota Dapur'}
            srcDoc={mainTab === 'receipt' ? sampleReceiptHtml : sampleKitchenTicketHtml}
            className={`bg-white rounded-xl shadow-md border border-slate-300 transition-all ${
              paperSize === '58mm' ? 'w-[236px]' : paperSize === '80mm' ? 'w-[320px]' : 'w-full max-w-sm'
            } h-[580px]`}
          />
        </div>
      </div>

      {/* Production Stations & POS Mode Modal */}
      <ProductionStationsModal
        isOpen={showStationsModal}
        onClose={() => setShowStationsModal(false)}
        onStationsUpdated={() => {
          // Callback setelah stasiun atau mode POS diperbarui
        }}
      />
    </FullScreenModal>
  )
}
