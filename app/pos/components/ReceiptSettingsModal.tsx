"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { 
  PaperSize, 
  PaperWidthUnit,
  ConnectionType, 
  generateReceiptHtml,
  resolvePaperDimensions,
  convertUnitToMm,
  convertMmToUnit,
  computeDefaultPrintableWidthMm,
  buildCustomPaperSizeToken,
  isWebBluetoothSupported, 
  isAndroidApp,
  getAndroidPairedPrinters,
  selectAndroidPairedPrinter,
  type AndroidPairedPrinter,
  getActiveBluetoothDeviceName, 
  getActiveBluetoothDeviceId,
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
import { loadImage, processLogoForThermal } from '@/lib/pos/imageDither'
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
import { resolvePosMode, PosModeResolution } from '@/lib/pos/posMode'
import { ProductionStation } from '@/lib/pos/productionRoutingService'
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
  const [currentPosMode, setCurrentPosMode] = useState<PosModeResolution>(() => resolvePosMode(activeBusiness))
  const posMode = currentPosMode
  const [showStationsModal, setShowStationsModal] = useState(false)
  const [modularStations, setModularStations] = useState<ProductionStation[]>([])

  const [mainTab, setMainTab] = useState<'receipt' | 'kitchen'>('receipt')

  // Receipt Settings States
  const [storeName, setStoreName] = useState(defaultBusinessName)
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [footerNote, setFooterNote] = useState('Terima kasih atas kunjungan Anda!')
  const [paperSize, setPaperSize] = useState<PaperSize>('58mm')
  const [isCustomPaperMode, setIsCustomPaperMode] = useState(false)
  const [customWidthInput, setCustomWidthInput] = useState<string>('58')
  const [customUnit, setCustomUnit] = useState<PaperWidthUnit>('mm')
  const [useCustomPrintableMargin, setUseCustomPrintableMargin] = useState(false)
  const [customPrintableInputMm, setCustomPrintableInputMm] = useState<string>('48')
  const prevIsOpenRef = useRef(false)
  const [connectionType, setConnectionType] = useState<ConnectionType>('system')
  const [btDeviceName, setBtDeviceName] = useState<string | null>(null)
  const [btDeviceId, setBtDeviceId] = useState<string | null>(null)
  const [isNativeAndroid, setIsNativeAndroid] = useState(false)
  const [androidPairedList, setAndroidPairedList] = useState<AndroidPairedPrinter[]>([])
  const [isConnectingBt, setIsConnectingBt] = useState(false)
  const [btStatusMsg, setBtStatusMsg] = useState<string | null>(null)
  const [autoPrintAfterPayment, setAutoPrintAfterPayment] = useState(false)
  const [showItemNumbering, setShowItemNumbering] = useState(true)
  const [showQueueNumber, setShowQueueNumber] = useState(false)
  const [showLoyaltyPoints, setShowLoyaltyPoints] = useState(true)
  const [isLoyaltyProgramEnabled, setIsLoyaltyProgramEnabled] = useState(false)
  const [loadingLoyalty, setLoadingLoyalty] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Logo States
  const [showLogo, setShowLogo] = useState(false)
  const [logoUrl, setLogoUrl] = useState('')
  const [logoBase64, setLogoBase64] = useState('')
  const [logoEscPosData, setLogoEscPosData] = useState('')
  const [isProcessingLogo, setIsProcessingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

  // Kitchen Settings States
  const [kitchenEnabled, setKitchenEnabled] = useState(true)
  const [kitchenAutoPrintPay, setKitchenAutoPrintPay] = useState(false)
  const [kitchenAutoPrintHold, setKitchenAutoPrintHold] = useState(false)
  const [kitchenSeparateStations, setKitchenSeparateStations] = useState(true)
  const [kitchenSoundBuzzer, setKitchenSoundBuzzer] = useState(true)
  const [kitchenAutoCut, setKitchenAutoCut] = useState(true)
  const [categoryStationMap, setCategoryStationMap] = useState<Record<string, KitchenStationId>>({})
  const [loadedCategories, setLoadedCategories] = useState<any[]>(categories || [])

  const loadModularStationsAndCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/stations')
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        setModularStations(data.stations || [])
        if (Array.isArray(data.categories) && data.categories.length > 0) {
          setLoadedCategories(data.categories)
        }
        if (data.posMode) {
          const resolved = resolvePosMode(activeBusiness, data.posMode)
          setCurrentPosMode(resolved)
        }
      }
    } catch (e) {
      console.warn('Failed to load stations in ReceiptSettingsModal:', e)
    }
  }, [activeBusiness])

  const handleSwitchToFnb = async () => {
    const newMode = resolvePosMode(activeBusiness, 'fnb')
    setCurrentPosMode(newMode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('shapeup_pos_mode', 'fnb')
      try {
        const raw = localStorage.getItem('su_cached_active_biz')
        if (raw) {
          const parsed = JSON.parse(raw)
          parsed.pos_mode = 'fnb'
          localStorage.setItem('su_cached_active_biz', JSON.stringify(parsed))
        }
      } catch {}
    }
    try {
      await fetch('/api/pos/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_pos_mode', pos_mode: 'fnb' })
      })
    } catch (e) {
      console.warn('Failed updating mode to F&B:', e)
    }
  }

  const handleCategoryStationChange = async (categoryId: string, stationId: string) => {
    const targetStationId = stationId || null
    setLoadedCategories(prev =>
      prev.map(c => c.id === categoryId ? { ...c, production_station_id: targetStationId } : c)
    )

    if (typeof window !== 'undefined') {
      try {
        const rawMap = localStorage.getItem('shapeup_pos_cat_map')
        const current = rawMap ? JSON.parse(rawMap) : {}
        if (targetStationId) {
          current[categoryId] = targetStationId
        } else {
          delete current[categoryId]
        }
        localStorage.setItem('shapeup_pos_cat_map', JSON.stringify(current))
      } catch {}
    }

    try {
      await fetch('/api/pos/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_category_station',
          category_id: categoryId,
          station_id: targetStationId
        })
      })
    } catch (err: any) {
      console.error('Failed to update category station:', err)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadModularStationsAndCategories()
    }
  }, [isOpen, loadModularStationsAndCategories])

  useEffect(() => {
    const isTransitionToOpen = isOpen && !prevIsOpenRef.current
    prevIsOpenRef.current = isOpen

    if (isTransitionToOpen) {
      const s = getStoredReceiptSettings(defaultBusinessName)
      setStoreName(s.storeName)
      setAddress(s.address)
      setPhone(s.phone)
      setFooterNote(s.footerNote)
      setPaperSize(s.paperSize)
      const dims = resolvePaperDimensions(s.paperSize)
      if (dims.isCustom) {
        setIsCustomPaperMode(true)
        setCustomUnit(dims.unit)
        setCustomWidthInput(String(dims.inputValue))
        setCustomPrintableInputMm(String(dims.printableWidthMm))
        const defaultEff = computeDefaultPrintableWidthMm(dims.widthMm)
        setUseCustomPrintableMargin(Math.abs(dims.printableWidthMm - defaultEff) >= 0.5)
      } else {
        setIsCustomPaperMode(false)
        setCustomUnit(s.customPaperUnit || 'mm')
        setCustomWidthInput(String(s.customPaperWidth || dims.widthMm))
        setCustomPrintableInputMm(String(s.customPrintableWidthMm || dims.printableWidthMm))
        setUseCustomPrintableMargin(false)
      }
      const nativeApp = isAndroidApp()
      setIsNativeAndroid(nativeApp)
      if (nativeApp) {
        const paired = getAndroidPairedPrinters()
        setAndroidPairedList(paired)
      }
      setConnectionType(s.connectionType || 'system')
      setBtDeviceName(getActiveBluetoothDeviceName())
      setBtDeviceId(getActiveBluetoothDeviceId())
      setAutoPrintAfterPayment(s.autoPrintAfterPayment)
      setShowItemNumbering(s.showItemNumbering)
      setShowQueueNumber(Boolean(s.showQueueNumber))
      setShowLoyaltyPoints(s.showLoyaltyPoints)
      setShowLogo(Boolean(s.showLogo))
      const resolvedLogoUrl = s.logoUrl || (activeBusiness as any)?.logo_url || ''
      setLogoUrl(resolvedLogoUrl)
      setLogoBase64(s.logoBase64 || '')
      setLogoEscPosData(s.logoEscPosData || '')
      setLogoError(null)

      // Auto-dither logo if logoUrl is present but logoBase64 is not yet generated
      if (s.showLogo && !s.logoBase64 && resolvedLogoUrl) {
        loadImage(resolvedLogoUrl)
          .then((img) => {
            const processed = processLogoForThermal(img, s.paperSize)
            setLogoBase64(processed.dataUrl)
            setLogoEscPosData(processed.escPosBase64)
          })
          .catch((e) => console.warn('Could not auto-dither remote logo:', e))
      }

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
        if (res.deviceId) setBtDeviceId(res.deviceId)
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

  const handleRefreshAndroidPrinters = () => {
    const paired = getAndroidPairedPrinters()
    setAndroidPairedList(paired)
    if (paired.length === 0) {
      setBtStatusMsg('Belum ada perangkat Bluetooth yang terpasang di HP/Tablet. Silakan buka Pengaturan Bluetooth Sistem Android dan pasangkan printer terlebih dahulu.')
    } else {
      setBtStatusMsg(`Ditemukan ${paired.length} perangkat Bluetooth dari Sistem Android.`)
    }
  }

  const handleSelectAndroidPrinter = (printer: AndroidPairedPrinter) => {
    selectAndroidPairedPrinter(printer)
    setBtDeviceName(printer.name)
    setBtDeviceId(printer.address)
    setConnectionType('bluetooth')
    setBtStatusMsg(`✅ Printer Sistem dipilih: ${printer.name} (${printer.address})`)
    try {
      const cur = getStoredReceiptSettings(defaultBusinessName)
      localStorage.setItem(RECEIPT_SETTINGS_STORAGE_KEY, JSON.stringify({
        ...cur,
        connectionType: 'bluetooth'
      }))
    } catch {}
  }

  const handleOpenAndroidBtSettings = () => {
    try {
      ;(window as any).AndroidPrinter?.openBluetoothSettings?.()
    } catch {}
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

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsProcessingLogo(true)
    setLogoError(null)

    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('File harus berupa gambar (PNG, JPG, WebP, dsb)')
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Ukuran file maksimal 5 MB')
      }

      // 1. Baca sebagai Data URL
      const reader = new FileReader()
      const dataUri = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Gagal membaca file gambar'))
        reader.readAsDataURL(file)
      })

      // 2. Dither & rasterize untuk ukuran kertas aktif
      const img = await loadImage(dataUri)
      const processed = processLogoForThermal(img, effectivePaperSize)

      setLogoBase64(processed.dataUrl)
      setLogoEscPosData(processed.escPosBase64)
      setShowLogo(true)

      // 3. Upload file ke Supabase Storage (jika online & targetBizId tersedia)
      if (targetBizId) {
        try {
          const fileExt = file.name.split('.').pop() || 'png'
          const fileName = `${targetBizId}/receipt_logo_${Date.now()}.${fileExt}`
          const { error: uploadErr } = await supabase.storage
            .from('attachments')
            .upload(fileName, file, { upsert: true, contentType: file.type })

          if (!uploadErr) {
            const { data: pubData } = supabase.storage
              .from('attachments')
              .getPublicUrl(fileName)
            if (pubData?.publicUrl) {
              setLogoUrl(pubData.publicUrl)
              await supabase
                .from('businesses')
                .update({ logo_url: pubData.publicUrl })
                .eq('id', targetBizId)
            }
          }
        } catch (uploadNetErr) {
          console.warn('Storage upload fallback (offline active):', uploadNetErr)
        }
      }
    } catch (err: any) {
      setLogoError(err.message || 'Gagal memproses gambar logo')
    } finally {
      setIsProcessingLogo(false)
      if (e.target) e.target.value = ''
    }
  }

  const handleRemoveLogo = () => {
    setShowLogo(false)
    setLogoBase64('')
    setLogoUrl('')
    setLogoEscPosData('')
    setLogoError(null)
    if (targetBizId) {
      supabase.from('businesses').update({ logo_url: null }).eq('id', targetBizId).then(() => {}, () => {})
    }
  }

  // Compute effective PaperSize dynamically (Preset vs Custom Multi-Unit)
  const effectivePaperSize = useMemo<PaperSize>(() => {
    if (!isCustomPaperMode) return paperSize
    const numVal = parseFloat(customWidthInput)
    const validVal = Number.isFinite(numVal) && numVal > 0 ? numVal : 58
    const customEff = useCustomPrintableMargin ? parseFloat(customPrintableInputMm) : undefined
    return buildCustomPaperSizeToken(
      validVal,
      customUnit,
      customEff && Number.isFinite(customEff) && customEff > 0 ? customEff : undefined
    )
  }, [isCustomPaperMode, paperSize, customWidthInput, customUnit, useCustomPrintableMargin, customPrintableInputMm])

  const resolvedPaperDims = useMemo(() => {
    return resolvePaperDimensions(effectivePaperSize)
  }, [effectivePaperSize])

  // Switch unit seamlessly by converting current canonical widthMm to the newly selected unit
  const handleSwitchCustomUnit = (nextUnit: PaperWidthUnit) => {
    const currentNum = parseFloat(customWidthInput)
    const currentMm =
      Number.isFinite(currentNum) && currentNum > 0
        ? convertUnitToMm(currentNum, customUnit)
        : resolvedPaperDims.widthMm
    const convertedVal = convertMmToUnit(currentMm, nextUnit, resolvedPaperDims.printableWidthMm)
    setCustomUnit(nextUnit)
    setCustomWidthInput(String(convertedVal))
  }

  // Re-dither existing logo automatically when effective maxLogoDots changes
  const prevLogoDotsRef = useRef<number>(resolvedPaperDims.maxLogoDots)
  useEffect(() => {
    if (!isOpen || !showLogo) return
    if (prevLogoDotsRef.current === resolvedPaperDims.maxLogoDots) return
    prevLogoDotsRef.current = resolvedPaperDims.maxLogoDots

    const sourceImg = logoUrl || logoBase64
    if (!sourceImg) return
    loadImage(sourceImg)
      .then((img) => {
        const processed = processLogoForThermal(img, effectivePaperSize)
        setLogoBase64(processed.dataUrl)
        setLogoEscPosData(processed.escPosBase64)
      })
      .catch(() => {})
  }, [isOpen, showLogo, resolvedPaperDims.maxLogoDots, effectivePaperSize, logoUrl, logoBase64])

  const handleSave = () => {
    const numVal = parseFloat(customWidthInput)
    const settings: ReceiptSettings = {
      storeName: storeName.trim() || defaultBusinessName,
      address: address.trim(),
      phone: phone.trim(),
      footerNote: footerNote.trim(),
      paperSize: effectivePaperSize,
      customPaperWidth: isCustomPaperMode && Number.isFinite(numVal) ? numVal : undefined,
      customPaperUnit: isCustomPaperMode ? customUnit : undefined,
      customPrintableWidthMm: isCustomPaperMode ? resolvedPaperDims.printableWidthMm : undefined,
      connectionType,
      autoPrintAfterPayment,
      showItemNumbering,
      showLoyaltyPoints,
      showQueueNumber,
      showLogo,
      logoUrl,
      logoBase64,
      logoEscPosData
    }

    const kSettings: KitchenSettings = {
      enabled: kitchenEnabled,
      autoPrintOnPayment: kitchenAutoPrintPay,
      autoPrintOnHold: kitchenAutoPrintHold,
      separateStations: kitchenSeparateStations,
      paperSize: effectivePaperSize,
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
      paperSize: effectivePaperSize,
      connectionType,
      autoPrintAfterPayment,
      showItemNumbering,
      showQueueNumber,
      showLoyaltyPoints: isLoyaltyProgramEnabled && showLoyaltyPoints,
      showLogo,
      logoUrl,
      logoBase64,
      logoEscPosData
    })
  }, [
    storeName,
    defaultBusinessName,
    address,
    phone,
    footerNote,
    effectivePaperSize,
    connectionType,
    autoPrintAfterPayment,
    showItemNumbering,
    showQueueNumber,
    isLoyaltyProgramEnabled,
    showLoyaltyPoints,
    showLogo,
    logoUrl,
    logoBase64,
    logoEscPosData
  ])

  const sampleReceiptHtml = useMemo(() => {
    return generateReceiptHtml(sampleReceipt, effectivePaperSize)
  }, [sampleReceipt, effectivePaperSize])

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
      paperSize: effectivePaperSize || '58mm',
      ticketKind: 'NEW'
    }
  }, [storeName, defaultBusinessName, effectivePaperSize])

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
            {/* Logo Struk Kasir */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <span>🖼️</span>
                    <span>Logo Struk Kasir</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Cetak logo bisnis di bagian atas struk kasir
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showLogo}
                    onChange={(e) => setShowLogo(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {showLogo && (
                <div className="pt-2 border-t border-slate-200/80 space-y-2.5">
                  {(logoBase64 || logoUrl) ? (
                    <div className="flex items-center gap-3 p-2.5 bg-white border border-slate-200 rounded-xl">
                      <div className="w-16 h-12 bg-slate-100 rounded-lg flex items-center justify-center p-1 border border-dashed border-slate-300 overflow-hidden shrink-0">
                        <img
                          src={logoBase64 || logoUrl}
                          alt="Logo Preview"
                          className="max-h-full max-w-full object-contain filter grayscale"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-800 truncate">
                          Logo Struk Aktif
                        </div>
                        <div className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                          <span>✓</span>
                          <span>Teroptimasi Monokrom Termal</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <label className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer">
                            Ganti
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleLogoFileChange}
                              disabled={isProcessingLogo}
                              className="hidden"
                            />
                          </label>
                          <span className="text-slate-300">•</span>
                          <button
                            type="button"
                            onClick={handleRemoveLogo}
                            disabled={isProcessingLogo}
                            className="text-[11px] font-bold text-rose-600 hover:text-rose-800"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-white rounded-xl cursor-pointer transition-colors text-center group">
                        <span className="text-xl mb-1 group-hover:scale-110 transition-transform">📤</span>
                        <span className="text-xs font-bold text-slate-700">
                          {isProcessingLogo ? 'Memproses binarisasi logo...' : 'Unggah Logo Struk'}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          Format PNG, JPG, WebP (Maks. 5 MB)
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoFileChange}
                          disabled={isProcessingLogo}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {logoError && (
                    <div className="text-[11px] text-rose-600 font-medium bg-rose-50 p-2 rounded-lg border border-rose-200">
                      ⚠️ {logoError}
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    💡 Gambar otomatis disesuaikan dengan algoritma dithering Floyd-Steinberg agar tajam di kertas termal 58mm &amp; 80mm.
                  </p>
                </div>
              )}
            </div>

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
                <option value="bluetooth">
                  {isNativeAndroid
                    ? 'Bluetooth Sistem Android (Native APK - Anti Putus)'
                    : 'Direct Bluetooth (BLE Instan tanpa keluar PWA)'}
                </option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                {connectionType === 'bluetooth' 
                  ? (isNativeAndroid
                      ? '⚡ Mencetak langsung via Bluetooth Sistem Android (Stabil, Anti-Putus, tanpa perlu pairing ulang di browser).'
                      : '⚡ Mencetak langsung via Web Bluetooth (0.2 detik, tanpa keluar PWA, tanpa RawBT).')
                  : '🖥️ Menggunakan dialog cetak bawaan sistem OS atau printer kabel USB komputer.'}
              </p>
            </div>

            {/* Bluetooth Device Management Card */}
            {connectionType === 'bluetooth' && (
              <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
                    {isNativeAndroid ? 'Printer Bluetooth Sistem Android' : 'Status Printer Bluetooth'}
                  </span>
                  {btDeviceName ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                      🟢 {btDeviceName}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full">
                      ⚪ Belum Dipilih
                    </span>
                  )}
                </div>

                {btStatusMsg && (
                  <div className="text-[11px] p-2 rounded-lg bg-white border border-indigo-100 text-indigo-700 font-medium">
                    {btStatusMsg}
                  </div>
                )}

                {isNativeAndroid ? (
                  <div className="space-y-2.5 pt-1">
                    {androidPairedList.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-indigo-900">
                          Pilih Printer dari Daftar Bluetooth Sistem HP/Tablet:
                        </p>
                        <div className="grid grid-cols-1 gap-1.5">
                          {androidPairedList.map((p) => {
                            const isSelected = btDeviceId === p.address || btDeviceName === p.name
                            return (
                              <button
                                key={p.address}
                                type="button"
                                onClick={() => handleSelectAndroidPrinter(p)}
                                className={`w-full px-3 py-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                    : 'bg-white hover:bg-indigo-50 text-slate-800 border-indigo-200'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-bold truncate flex items-center gap-1.5">
                                    <span>🖨️</span>
                                    <span>{p.name}</span>
                                  </div>
                                  <div className={`text-[10px] mt-0.5 ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>
                                    MAC: {p.address}
                                  </div>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isSelected
                                    ? 'bg-white text-indigo-700'
                                    : 'bg-indigo-100 text-indigo-700'
                                }`}>
                                  {isSelected ? '✓ Aktif' : 'Pilih'}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 space-y-1">
                        <p className="font-bold">⚠️ Belum Ada Printer Terdeteksi di Sistem Android</p>
                        <p>Pastikan Bluetooth HP/Tablet aktif dan printer sudah dipasangkan (Paired) di menu Pengaturan Bluetooth HP Anda.</p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleRefreshAndroidPrinters}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                      >
                        🔄 Ambil / Muat Ulang dari Sistem
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenAndroidBtSettings}
                        className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition-all"
                      >
                        ⚙️ Buka Bluetooth HP
                      </button>
                      {btDeviceName && (
                        <button
                          type="button"
                          onClick={handleTestPrintBluetooth}
                          disabled={isConnectingBt}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                        >
                          🧾 Uji Cetak (Test Print)
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
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
                )}
              </div>
            )}

            <div className="space-y-2.5">
              <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
                Ukuran Kertas Printer Kasir
              </label>
              <select
                value={isCustomPaperMode ? 'custom' : paperSize}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === 'custom') {
                    setIsCustomPaperMode(true)
                    const curDims = resolvePaperDimensions(paperSize)
                    const converted = convertMmToUnit(curDims.widthMm, customUnit, curDims.printableWidthMm)
                    setCustomWidthInput(String(converted))
                    setCustomPrintableInputMm(String(curDims.printableWidthMm))
                  } else {
                    setIsCustomPaperMode(false)
                    setPaperSize(val as PaperSize)
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="58mm">Thermal 58mm (Ukuran Standar Kasir Mini — 32 Kolom)</option>
                <option value="76mm">Impact / Thermal 76mm (Printer Dot-Matrix — 42 Kolom)</option>
                <option value="80mm">Thermal 80mm (Ukuran Standar Resto / Supermarket — 48 Kolom)</option>
                <option value="104mm">Thermal Lebar 104mm / 4 Inci (64 Kolom)</option>
                <option value="120mm">Epson LX-310 NCR 4.75" / 12cm (Continuous Bagi 2 — Efektif 100mm)</option>
                <option value="241mm">Epson LX-310 Continuous 9.5" / 241mm (Faktur NCR Utuh — Efektif 203mm)</option>
                <option value="A4">Kertas Halaman A4 / Invoice (210mm)</option>
                <option value="custom">⚙️ Custom Lebar Kertas (Pilih Satuan: mm, cm, in, px, karakter)</option>
              </select>

              {/* Panel Custom Lebar Kertas Multi-Satuan */}
              {isCustomPaperMode && (
                <div className="p-3.5 bg-indigo-50/60 border border-indigo-200 rounded-2xl space-y-3 animate-in fade-in duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-indigo-950 text-xs flex items-center gap-1.5">
                        <span>📐</span>
                        <span>Konfigurasi Lebar Kertas Custom</span>
                      </span>
                      <span className="text-[10px] text-indigo-700 block">
                        Pilih jenis satuan ukuran sesuai penggaris atau spesifikasi printer Anda
                      </span>
                    </div>

                    {/* Pemilih Jenis Satuan (Unit Selector) */}
                    <div className="flex items-center bg-white p-0.5 rounded-xl border border-indigo-200 shadow-2xs self-start">
                      {([
                        { id: 'mm', label: 'mm' },
                        { id: 'cm', label: 'cm' },
                        { id: 'in', label: 'inch' },
                        { id: 'px', label: 'px/dots' },
                        { id: 'chars', label: 'karakter' }
                      ] as Array<{ id: PaperWidthUnit; label: string }>).map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => handleSwitchCustomUnit(u.id)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                            customUnit === u.id
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-slate-600 hover:text-indigo-700 hover:bg-indigo-50'
                          }`}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Input Nilai Lebar & Pintasan Cepat */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        {customUnit === 'chars'
                          ? 'Jumlah Karakter per Baris (Font A)'
                          : customUnit === 'px'
                          ? 'Lebar Total Dots / Piksel (203 DPI)'
                          : `Lebar Kertas Roll (${customUnit.toUpperCase()})`}
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          step={customUnit === 'cm' || customUnit === 'in' ? '0.1' : '1'}
                          min={customUnit === 'in' ? '1.2' : customUnit === 'cm' ? '3' : customUnit === 'chars' ? '16' : '30'}
                          max={customUnit === 'in' ? '12' : customUnit === 'cm' ? '30' : customUnit === 'px' ? '2400' : '300'}
                          value={customWidthInput}
                          onChange={(e) => {
                            setCustomWidthInput(e.target.value)
                            if (!useCustomPrintableMargin) {
                              const num = parseFloat(e.target.value)
                              if (Number.isFinite(num) && num > 0) {
                                const mm = convertUnitToMm(num, customUnit)
                                setCustomPrintableInputMm(String(computeDefaultPrintableWidthMm(mm)))
                              }
                            }
                          }}
                          className="w-full px-3 py-2 pr-14 rounded-xl border border-indigo-300 bg-white font-black text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <span className="absolute right-3 text-xs font-bold text-indigo-600 select-none">
                          {customUnit}
                        </span>
                      </div>
                    </div>

                    {/* Pintasan Ukuran Kertas Non-Standar */}
                    <div>
                      <span className="block text-[11px] font-bold text-slate-700 mb-1">
                        Pintasan Lebar Kertas:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: '44mm', mm: 44, eff: 36 },
                          { label: '58mm', mm: 58, eff: 48 },
                          { label: '76mm', mm: 76, eff: 63 },
                          { label: '80mm', mm: 80, eff: 72 },
                          { label: '104mm (4")', mm: 104, eff: 96 },
                          { label: 'LX-310 4.75" (12cm)', mm: 120.7, eff: 100 },
                          { label: 'LX-310 9.5" (24.1cm)', mm: 241.3, eff: 203 }
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              const converted = convertMmToUnit(preset.mm, customUnit, preset.eff)
                              setCustomWidthInput(String(converted))
                              setCustomPrintableInputMm(String(preset.eff))
                            }}
                            className="px-2 py-1 bg-white hover:bg-indigo-100 border border-indigo-200 text-indigo-800 rounded-lg text-[10px] font-bold transition cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Opsi Lanjutan: Kompensasi Area Cetak Efektif (Anti-Clipping Margin) */}
                  <div className="pt-2 border-t border-indigo-200/70 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={useCustomPrintableMargin}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setUseCustomPrintableMargin(checked)
                          if (checked) {
                            setCustomPrintableInputMm(String(resolvedPaperDims.printableWidthMm))
                          }
                        }}
                        className="w-3.5 h-3.5 text-indigo-600 rounded border-indigo-300 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="text-[11px] font-bold text-indigo-950">
                        Atur Area Cetak Efektif / Margin Tepi Manual (Atasi Teks Terpotong di Kanan)
                      </span>
                    </label>

                    {useCustomPrintableMargin && (
                      <div className="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-indigo-200">
                        <div className="flex-1">
                          <span className="text-[11px] font-bold text-slate-800 block">
                            Lebar Area Cetak Efektif (mm)
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Jika digit kanan harga terpotong, kurangi 2–4 mm dari lebar kertas fisik ({resolvedPaperDims.widthMm} mm).
                          </span>
                        </div>
                        <div className="relative w-28 shrink-0">
                          <input
                            type="number"
                            step="0.5"
                            min="20"
                            max={resolvedPaperDims.widthMm}
                            value={customPrintableInputMm}
                            onChange={(e) => setCustomPrintableInputMm(e.target.value)}
                            className="w-full px-2.5 py-1.5 pr-9 border border-indigo-300 rounded-lg font-black text-slate-900 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <span className="absolute right-2.5 top-1.5 text-[11px] font-bold text-slate-400">
                            mm
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Ringkasan Telemetri Geometri Hardware */}
                  <div className="p-2.5 bg-white/90 border border-indigo-200/80 rounded-xl flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600 font-mono">
                    <div>
                      <span>Kertas: </span>
                      <strong className="text-slate-900">{resolvedPaperDims.widthMm} mm</strong>
                      <span> ({(resolvedPaperDims.widthMm / 10).toFixed(2)} cm / {(resolvedPaperDims.widthMm / 25.4).toFixed(2)}")</span>
                    </div>
                    <div>
                      <span>Area Cetak: </span>
                      <strong className="text-indigo-700">{resolvedPaperDims.printableWidthMm} mm</strong>
                      <span> ({Math.round(resolvedPaperDims.printableWidthMm * 8)} dots)</span>
                    </div>
                    <div>
                      <span>ESC/POS: </span>
                      <strong className="text-emerald-700">{resolvedPaperDims.escPosColumns} karakter/baris</strong>
                    </div>
                    <div>
                      <span>Logo: </span>
                      <strong className="text-slate-900">{resolvedPaperDims.maxLogoDots} px</strong>
                    </div>
                  </div>
                </div>
              )}
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
                  onClick={handleSwitchToFnb}
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

            {/* Modular Production Station Routing */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="block font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    🔀 Pemetaan Kategori Menu ke Stasiun Produksi (Modular &amp; Terelasi)
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    Setiap kategori produk langsung terhubung ke stasiun kerja kustom Anda di database.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStationsModal(true)}
                  className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-[10px] transition cursor-pointer"
                >
                  ⚙️ Kelola Stasiun (+ Baru)
                </button>
              </div>

              {modularStations.length === 0 ? (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl text-center space-y-2">
                  <div className="text-xl">☕ 🍳</div>
                  <div className="font-bold text-amber-900 text-xs">Belum ada stasiun produksi modular yang dibuat</div>
                  <p className="text-[11px] text-amber-800 leading-relaxed max-w-sm mx-auto">
                    Seluruh stasiun dibuat secara modular. Klik tombol di bawah untuk membuat stasiun kerja cabang Anda (misal: <i>Dapur Utama, Barista Minuman, Grill, dll.</i>).
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowStationsModal(true)}
                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition cursor-pointer"
                  >
                    + Buat Stasiun Produksi Sekarang
                  </button>
                </div>
              ) : loadedCategories.length === 0 ? (
                <p className="text-slate-400 italic text-[11px]">Belum ada kategori produk di unit bisnis ini.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {loadedCategories.map((c: any) => {
                    const currentStationId = c.production_station_id || ''
                    return (
                      <div key={c.id} className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                        <span className="font-medium text-slate-800 truncate max-w-[150px]">{c.name}</span>
                        <select
                          value={currentStationId}
                          onChange={(e) => handleCategoryStationChange(c.id, e.target.value)}
                          className="text-[11px] font-bold py-1 px-2 border border-slate-200 rounded-md bg-slate-50 text-slate-700 focus:outline-none"
                        >
                          <option value="">-- Tidak Dialirkan (Hanya Kasir) --</option>
                          {modularStations.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.icon} {st.name} {st.code ? `[${st.code}]` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
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
        <div className="bg-slate-100 p-4 rounded-2xl border border-slate-200 flex flex-col items-center overflow-x-auto">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {mainTab === 'receipt' ? '👁️ Pratinjau Struk Kasir (Pelanggan)' : '👁️ Pratinjau Nota Dapur (Zero Price & Modifiers)'}
            </span>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-white border border-slate-200 rounded-full text-indigo-700">
              {resolvedPaperDims.displayLabel} &bull; {resolvedPaperDims.escPosColumns} char
            </span>
          </div>
          <iframe 
            title={mainTab === 'receipt' ? 'Pratinjau Struk Kasir' : 'Pratinjau Nota Dapur'}
            srcDoc={mainTab === 'receipt' ? sampleReceiptHtml : sampleKitchenTicketHtml}
            style={{ width: `${resolvedPaperDims.previewIframeWidthPx}px`, maxWidth: '100%' }}
            className="bg-white rounded-xl shadow-md border border-slate-300 transition-all h-[580px]"
          />
        </div>
      </div>

      {/* Production Stations & POS Mode Modal */}
      <ProductionStationsModal
        isOpen={showStationsModal}
        onClose={() => setShowStationsModal(false)}
        onStationsUpdated={() => {
          loadModularStationsAndCategories()
          setCurrentPosMode(resolvePosMode(activeBusiness))
        }}
      />
    </FullScreenModal>
  )
}
