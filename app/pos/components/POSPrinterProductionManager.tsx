"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { ProductionStation } from '@/lib/pos/productionRoutingService'
import { PosMode } from '@/lib/pos/posMode'
import { 
  PaperSize, 
  ConnectionType, 
  getSystemPrinters, 
  isWebBluetoothSupported, 
  requestAndConnectBluetoothPrinter,
  getActiveBluetoothDeviceName,
  sendBluetoothTestPrint,
  testPrintStationTicket
} from '@/lib/pos/printerAdapter'

interface Props {
  isModal?: boolean
  onClose?: () => void
  onStationsUpdated?: () => void
}

interface PrinterDeviceItem {
  id: string
  name: string
  connection_type: ConnectionType
  paper_size: PaperSize
  address?: string | null
  is_default?: boolean
  mapped_stations?: Array<{ id: string; name: string; icon: string }>
}

const STATION_ICONS = ['🍳', '☕', '🍹', '🥩', '🍕', '🍰', '🍜', '🥖', '🎁', '🥗', '🍗', '🧊', '📦', '🛒']

const COMMON_PRINTER_MODELS = [
  { name: 'EPSON TM-T82 / TM-T88 (Thermal 80mm)', paper_size: '80mm' as PaperSize },
  { name: 'EPSON TM-U220 (Dot Matrix Dapur)', paper_size: '80mm' as PaperSize },
  { name: 'POS-58 Series (Thermal 58mm)', paper_size: '58mm' as PaperSize },
  { name: 'POS-80 Series (Thermal 80mm)', paper_size: '80mm' as PaperSize },
  { name: 'Xprinter XP-58 / XP-N160I', paper_size: '58mm' as PaperSize },
  { name: 'Xprinter XP-80 / XP-Q200', paper_size: '80mm' as PaperSize },
  { name: 'Rongta RP326 / RPP02N', paper_size: '80mm' as PaperSize },
  { name: 'Sunmi POS Internal Printer', paper_size: '58mm' as PaperSize },
  { name: 'Microsoft Print to PDF / Generic', paper_size: '80mm' as PaperSize }
]

export default function POSPrinterProductionManager({ isModal = false, onClose, onStationsUpdated }: Props) {
  const [loading, setLoading] = useState(false)
  const [posMode, setPosMode] = useState<PosMode>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('shapeup_pos_mode') as PosMode
        if (saved && ['retail', 'fnb', 'custom'].includes(saved)) return saved
        const bizCache = localStorage.getItem('su_cached_active_biz')
        if (bizCache) {
          const parsed = JSON.parse(bizCache)
          if (parsed.pos_mode && ['retail', 'fnb', 'custom'].includes(parsed.pos_mode)) return parsed.pos_mode
          if (parsed.industry && ['fnb', 'resto', 'cafe', 'restaurant', 'bakery', 'coffee'].some((ind: string) => parsed.industry?.toLowerCase()?.includes(ind))) return 'fnb'
        }
      } catch {}
    }
    return 'retail'
  })
  const [stations, setStations] = useState<ProductionStation[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string; production_station_id?: string | null }>>([])
  const [registeredPrinters, setRegisteredPrinters] = useState<PrinterDeviceItem[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [activeSubTab, setActiveSubTab] = useState<'stations' | 'printers'>('stations')

  // Station Form State
  const [isEditingStation, setIsEditingStation] = useState(false)
  const [editingStationId, setEditingStationId] = useState<string | null>(null)
  const [stationName, setStationName] = useState('')
  const [stationCode, setStationCode] = useState('')
  const [stationIcon, setStationIcon] = useState('🍳')
  const [stationPaperSize, setStationPaperSize] = useState<PaperSize>('58mm')
  const [stationPrinterConn, setStationPrinterConn] = useState<'same_as_cashier' | 'system' | 'bluetooth' | 'lan'>('same_as_cashier')
  const [stationPrinterDeviceId, setStationPrinterDeviceId] = useState<string | null>(null)
  const [stationPrinterName, setStationPrinterName] = useState('')
  const [stationSoundBuzzer, setStationSoundBuzzer] = useState(true)
  const [stationAutoCut, setStationAutoCut] = useState(true)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [isSavingStation, setIsSavingStation] = useState(false)
  const [testingStationId, setTestingStationId] = useState<string | null>(null)

  // Computer Printer Detection Modal State
  const [showComputerDetectModal, setShowComputerDetectModal] = useState(false)
  const [isScanningPrinters, setIsScanningPrinters] = useState(false)
  const [detectedPrinters, setDetectedPrinters] = useState<Array<{ name: string; isDefault?: boolean }>>([])
  const [computerScanError, setComputerScanError] = useState<string | null>(null)
  const [newSystemPrinterName, setNewSystemPrinterName] = useState('')
  const [newSystemPaperSize, setNewSystemPaperSize] = useState<PaperSize>('58mm')
  const [targetStationForNewPrinter, setTargetStationForNewPrinter] = useState<string>('')
  const [isAddingPrinter, setIsAddingPrinter] = useState(false)

  // Bluetooth Pairing Wizard State
  const [showBtPairingModal, setShowBtPairingModal] = useState(false)
  const [isPairingBt, setIsPairingBt] = useState(false)
  const [btPairSuccess, setBtPairSuccess] = useState<{ name: string; id?: string } | null>(null)
  const [btPairError, setBtPairError] = useState<string | null>(null)
  const [btPaperSize, setBtPaperSize] = useState<PaperSize>('58mm')
  const [btTargetStation, setBtTargetStation] = useState<string>('')

  // 1. Fetch data
  const loadData = useCallback(async () => {
    setLoading(true)
    setStatusMessage(null)
    try {
      const res = await fetch('/api/pos/stations')
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        setStations(data.stations || [])
        setCategories(data.categories || [])
        const resolvedMode: PosMode = data.posMode || (data.industry === 'fnb' ? 'fnb' : 'retail')
        setPosMode(resolvedMode)
        if (typeof window !== 'undefined') {
          localStorage.setItem('shapeup_pos_mode', resolvedMode)
          localStorage.setItem('shapeup_pos_stations', JSON.stringify(data.stations || []))
        }
      }

      // Also fetch enriched printers
      const pRes = await fetch('/api/pos/printers')
      const pData = await pRes.json().catch(() => null)
      if (pRes.ok && pData?.printers) {
        setRegisteredPrinters(pData.printers)
      } else if (data?.printers) {
        setRegisteredPrinters(data.printers)
      }
    } catch (err: any) {
      setStatusMessage('Gagal memuat konfigurasi POS: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 2. Change POS Mode
  const handleChangePosMode = async (newMode: PosMode) => {
    setPosMode(newMode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('shapeup_pos_mode', newMode)
      try {
        const raw = localStorage.getItem('su_cached_active_biz')
        if (raw) {
          const parsed = JSON.parse(raw)
          parsed.pos_mode = newMode
          localStorage.setItem('su_cached_active_biz', JSON.stringify(parsed))
        }
      } catch {}
    }
    try {
      await fetch('/api/pos/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_pos_mode', pos_mode: newMode })
      })
      setStatusMessage(`✓ Mode POS berhasil diubah ke ${newMode === 'retail' ? 'Ritel & Fashion' : 'Resto & F&B'}`)
      if (onStationsUpdated) onStationsUpdated()
    } catch (err: any) {
      console.warn('Failed to update pos mode:', err)
    }
  }

  // 3. Station Form Handlers
  const handleOpenAddStation = () => {
    setEditingStationId(null)
    setStationName('')
    setStationCode('')
    setStationIcon('🍳')
    setStationPaperSize('58mm')
    setStationPrinterConn('same_as_cashier')
    setStationPrinterDeviceId(null)
    setStationPrinterName('')
    setStationSoundBuzzer(true)
    setStationAutoCut(true)
    setSelectedCategoryIds([])
    setIsEditingStation(true)
  }

  const handleOpenEditStation = (st: ProductionStation) => {
    setEditingStationId(st.id)
    setStationName(st.name)
    setStationCode(st.code || '')
    setStationIcon(st.icon || '🍳')
    setStationPaperSize(st.paper_size || '58mm')
    setStationPrinterConn(st.printer_connection_type || 'same_as_cashier')
    setStationPrinterDeviceId(st.printer_device_id || null)
    setStationPrinterName(st.printer_name || '')
    setStationSoundBuzzer(st.sound_buzzer ?? true)
    setStationAutoCut(st.auto_cut ?? true)

    const mappedIds = categories
      .filter(c => c.production_station_id === st.id)
      .map(c => c.id)
    setSelectedCategoryIds(mappedIds)
    setIsEditingStation(true)
  }

  const handleSaveStation = async () => {
    if (!stationName.trim()) {
      alert('Nama stasiun wajib diisi.')
      return
    }

    setIsSavingStation(true)
    try {
      const res = await fetch('/api/pos/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          id: editingStationId || undefined,
          name: stationName.trim(),
          code: stationCode.trim().toUpperCase() || undefined,
          icon: stationIcon,
          paper_size: stationPaperSize,
          printer_connection_type: stationPrinterConn,
          printer_device_id: stationPrinterDeviceId || undefined,
          printer_name: stationPrinterName.trim() || undefined,
          sound_buzzer: stationSoundBuzzer,
          auto_cut: stationAutoCut,
          category_ids: selectedCategoryIds
        })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal menyimpan stasiun')
      }

      setIsEditingStation(false)
      await loadData()
      if (onStationsUpdated) onStationsUpdated()
      setStatusMessage('✓ Stasiun produksi berhasil disimpan.')
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan stasiun.')
    } finally {
      setIsSavingStation(false)
    }
  }

  const handleDeleteStation = async (stationId: string, name: string) => {
    if (!window.confirm(`Hapus stasiun "${name}"?\nKategori menu terkait akan dilepas otomatis tanpa menghapus produk.`)) {
      return
    }

    try {
      const res = await fetch('/api/pos/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: stationId })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Gagal menghapus stasiun')
      }

      await loadData()
      if (onStationsUpdated) onStationsUpdated()
      setStatusMessage(`✓ Stasiun "${name}" telah dihapus.`)
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus stasiun.')
    }
  }

  // 4. Test Print Station Handler
  const handleTestPrintStation = async (st: {
    name: string
    printer_connection_type?: string
    printer_name?: string | null
    paper_size?: PaperSize
    sound_buzzer?: boolean
    auto_cut?: boolean
    id?: string
  }) => {
    const idKey = st.id || 'current-form'
    setTestingStationId(idKey)
    try {
      const res = await testPrintStationTicket({
        stationName: st.name,
        connectionType: (st.printer_connection_type || 'same_as_cashier') as any,
        printerName: st.printer_name || undefined,
        paperSize: st.paper_size || '58mm',
        soundBuzzer: st.sound_buzzer ?? true,
        autoCut: st.auto_cut ?? true
      })

      if (res.success) {
        setStatusMessage(`✓ Uji cetak untuk "${st.name}" berhasil dikirim!`)
      } else {
        alert(res.message || 'Gagal melakukan uji cetak.')
      }
    } catch (e: any) {
      alert('Kesalahan cetak: ' + (e.message || 'Error'))
    } finally {
      setTestingStationId(null)
    }
  }

  // 5. Computer Printers Scan & Register
  const handleScanComputerPrinters = async () => {
    setIsScanningPrinters(true)
    setComputerScanError(null)
    try {
      const result = await getSystemPrinters()
      if (result.supported && result.printers.length > 0) {
        setDetectedPrinters(result.printers)
      } else {
        // Fallback or permission restricted
        setDetectedPrinters([])
        if (result.error) {
          setComputerScanError(result.error)
        } else {
          setComputerScanError('Peramban membatasi deteksi langsung printer OS (Web Printing API). Silakan pilih rekomendasi model printer atau ketik nama printer driver terpasang di komputer Anda di bawah ini.')
        }
      }
    } catch (e: any) {
      setComputerScanError(e.message || 'Gagal memindai printer komputer.')
    } finally {
      setIsScanningPrinters(false)
    }
  }

  const handleAddComputerPrinterSubmit = async (printerName: string, paperSize: PaperSize, mapStationId?: string) => {
    const clean = printerName.trim()
    if (!clean) {
      alert('Nama printer tidak boleh kosong.')
      return
    }

    setIsAddingPrinter(true)
    try {
      const res = await fetch('/api/pos/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          name: clean,
          connection_type: 'system',
          paper_size: paperSize,
          map_to_station_id: mapStationId || undefined
        })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal mendaftarkan printer')
      }

      setShowComputerDetectModal(false)
      setNewSystemPrinterName('')
      await loadData()
      if (onStationsUpdated) onStationsUpdated()
      setStatusMessage(`✓ Printer komputer "${clean}" berhasil didaftarkan ke sistem mapping.`)

      // If in editing station form, auto-select this printer
      if (isEditingStation) {
        setStationPrinterConn('system')
        setStationPrinterName(clean)
        setStationPaperSize(paperSize)
        if (data.printer?.id) {
          setStationPrinterDeviceId(data.printer.id)
        }
      }
    } catch (e: any) {
      alert(e.message || 'Gagal menambahkan printer komputer.')
    } finally {
      setIsAddingPrinter(false)
    }
  }

  // 6. Bluetooth Pairing System
  const handleStartBluetoothPairing = async (targetStationId?: string) => {
    if (!isWebBluetoothSupported()) {
      alert('Web Bluetooth tidak didukung pada peramban ini. Pastikan menggunakan Google Chrome / Chromium di Komputer atau Android.')
      return
    }

    setIsPairingBt(true)
    setBtPairError(null)
    setBtPairSuccess(null)
    try {
      const pairRes = await requestAndConnectBluetoothPrinter()
      if (pairRes.success && pairRes.deviceName) {
        setBtPairSuccess({ name: pairRes.deviceName, id: pairRes.deviceId })

        // Save directly to database pos_printer_devices
        const saveRes = await fetch('/api/pos/printers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            name: pairRes.deviceName,
            connection_type: 'bluetooth',
            address: pairRes.deviceId || undefined,
            paper_size: btPaperSize,
            map_to_station_id: targetStationId || (btTargetStation || undefined)
          })
        })

        const saveData = await saveRes.json().catch(() => null)

        await loadData()
        if (onStationsUpdated) onStationsUpdated()
        setStatusMessage(`✓ Printer Bluetooth "${pairRes.deviceName}" berhasil dipasangkan dan didaftarkan!`)

        // If in editing station form, auto-select this bluetooth printer
        if (isEditingStation) {
          setStationPrinterConn('bluetooth')
          setStationPrinterName(pairRes.deviceName)
          setStationPaperSize(btPaperSize)
          if (saveData?.printer?.id) {
            setStationPrinterDeviceId(saveData.printer.id)
          }
        }
      } else {
        setBtPairError(pairRes.error || 'Pemasangan Bluetooth dibatalkan.')
      }
    } catch (e: any) {
      setBtPairError(e.message || 'Terjadi kesalahan saat mencari perangkat Bluetooth.')
    } finally {
      setIsPairingBt(false)
    }
  }

  const handleDeletePrinterDevice = async (printerId: string, name: string) => {
    if (!window.confirm(`Hapus printer "${name}" dari sistem mapping?\nStasiun yang terhubung ke printer ini akan dialihkan kembali ke Printer Kasir.`)) {
      return
    }

    try {
      const res = await fetch('/api/pos/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: printerId })
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        throw new Error(d?.error || 'Gagal menghapus printer')
      }

      await loadData()
      if (onStationsUpdated) onStationsUpdated()
      setStatusMessage(`✓ Printer "${name}" telah dihapus.`)
    } catch (e: any) {
      alert(e.message || 'Gagal menghapus printer.')
    }
  }

  const toggleCategorySelection = (catId: string) => {
    setSelectedCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    )
  }

  return (
    <div className="space-y-6 text-xs text-slate-800">
      
      {/* 1. Mode POS Switcher Card */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px] block">
              Pilihan Mode Operasional POS
            </span>
            <p className="text-slate-500 text-[11px] mt-0.5">
              Pemisahan tampilan kasir ritel versus restoran &amp; kafe, stasiun masak mandiri, dan printer mapping.
            </p>
          </div>
          {statusMessage && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
              statusMessage.startsWith('✓') ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {statusMessage}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Mode A: Retail / Fashion */}
          <div
            onClick={() => handleChangePosMode('retail')}
            className={`p-3.5 rounded-xl border-2 transition cursor-pointer flex items-start gap-3 ${
              posMode === 'retail'
                ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="text-2xl mt-0.5">👗</div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm">Mode Ritel &amp; Fashion</span>
                {posMode === 'retail' && (
                  <span className="text-[10px] bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-full">
                    Aktif
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Toko pakaian &amp; barang. Fokus pada barcode scanner, varian ukuran/warna, dan cetak struk kasir utama. Fitur dapur otomatis disembunyikan.
              </p>
            </div>
          </div>

          {/* Mode B: Resto, Kafe & F&B */}
          <div
            onClick={() => handleChangePosMode('fnb')}
            className={`p-3.5 rounded-xl border-2 transition cursor-pointer flex items-start gap-3 ${
              posMode === 'fnb'
                ? 'border-emerald-600 bg-emerald-50/50 shadow-xs'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="text-2xl mt-0.5">🍽️</div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm">Mode Resto, Kafe &amp; F&amp;B</span>
                {posMode === 'fnb' && (
                  <span className="text-[10px] bg-emerald-600 text-white font-bold px-2 py-0.5 rounded-full">
                    Aktif
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Hospitality &amp; kuliner. Mengaktifkan stasiun produksi terpisah (Dapur, Bar, Pastry), routing tiket menu, dan mapping multi-printer.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Main Content Area */}
      {posMode !== 'retail' ? (
        <div className="space-y-4">
          
          {/* Sub Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveSubTab('stations')}
                className={`pb-2 px-3 font-bold text-xs flex items-center gap-1.5 border-b-2 transition cursor-pointer ${
                  activeSubTab === 'stations'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>🍳</span>
                <span>Stasiun Produksi &amp; Routing Menu</span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-mono">
                  {stations.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('printers')}
                className={`pb-2 px-3 font-bold text-xs flex items-center gap-1.5 border-b-2 transition cursor-pointer ${
                  activeSubTab === 'printers'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>🖨️</span>
                <span>Pemetaan Printer (Printer Mapping Hub)</span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-mono">
                  {registeredPrinters.length}
                </span>
              </button>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowComputerDetectModal(true)
                  handleScanComputerPrinters()
                }}
                className="py-1.5 px-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="Deteksi atau daftarkan printer yang terpasang di komputer kasir"
              >
                <span>🖥️</span>
                <span>Ambil Printer Komputer</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowBtPairingModal(true)
                  setBtPairSuccess(null)
                  setBtPairError(null)
                }}
                className="py-1.5 px-2.5 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="Pairing printer thermal Bluetooth langsung via browser"
              >
                <span>📶</span>
                <span>Pairing Bluetooth</span>
              </button>

              {activeSubTab === 'stations' && (
                <button
                  type="button"
                  onClick={handleOpenAddStation}
                  className="py-1.5 px-3 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>+</span>
                  <span>Tambah Stasiun</span>
                </button>
              )}
            </div>
          </div>

          {/* TAB CONTENT A: STATIONS LIST */}
          {activeSubTab === 'stations' && (
            <div>
              {loading ? (
                <div className="py-12 text-center text-slate-400">Memuat stasiun dari database...</div>
              ) : stations.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-3">
                  <div className="text-3xl">☕ 🍳 🍹</div>
                  <div className="font-bold text-slate-700 text-sm">Belum ada stasiun produksi yang dibuat</div>
                  <p className="text-slate-500 text-[11px] max-w-md mx-auto leading-relaxed">
                    Klik tombol <b>"+ Tambah Stasiun"</b> untuk mendefinisikan stasiun kerja di cabang Anda (misal: <i>Dapur Utama, Barista Minuman, Grill, atau Pastry</i>), lalu petakan kategori menu dan printernya.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenAddStation}
                    className="px-4 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition inline-flex items-center gap-1.5 shadow-xs"
                  >
                    <span>+</span>
                    <span>Tambah Stasiun Pertama</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {stations.map(st => {
                    const mappedCategories = categories.filter(c => c.production_station_id === st.id)
                    const isTesting = testingStationId === st.id

                    return (
                      <div
                        key={st.id}
                        className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs hover:border-slate-300 transition flex flex-col justify-between space-y-3"
                      >
                        <div className="space-y-2">
                          {/* Header Stasiun */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span className="text-2xl p-1.5 bg-slate-100 rounded-xl">{st.icon}</span>
                              <div>
                                <span className="font-bold text-slate-900 text-sm block leading-tight">{st.name}</span>
                                <span className="text-[10px] font-mono text-slate-400">
                                  {st.code ? `[${st.code}]` : 'STASIUN'} &bull; Thermal {st.paper_size || '58mm'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleTestPrintStation(st)}
                                disabled={isTesting}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition"
                                title="Uji Cetak Tiket Stasiun Ini"
                              >
                                {isTesting ? '⏳' : '🖨️'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditStation(st)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition"
                                title="Edit Stasiun &amp; Mapping Printer"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteStation(st.id, st.name)}
                                className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                title="Hapus Stasiun"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          {/* Info Printer Target Stasiun */}
                          <div className="flex items-center gap-2 text-[11px] bg-slate-50/90 px-3 py-2 rounded-xl border border-slate-100">
                            <span className="text-sm">
                              {st.printer_connection_type === 'bluetooth' ? '📶' : st.printer_connection_type === 'system' ? '🖥️' : '🖨️'}
                            </span>
                            <div className="flex-1 truncate">
                              <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">
                                Printer Terpetakan:
                              </span>
                              <span className="font-semibold text-slate-800">
                                {st.printer_connection_type === 'bluetooth'
                                  ? `Bluetooth Direct: ${st.printer_name || 'BLE Dapur'}`
                                  : st.printer_connection_type === 'system'
                                  ? `Printer Komputer: ${st.printer_name || 'Driver OS / USB'}`
                                  : 'Printer Kasir Utama (Default)'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono bg-white px-2 py-1 rounded-lg border border-slate-200">
                              {st.sound_buzzer && <span title="Buzzer Aktif">🔔 Beep</span>}
                              {st.auto_cut && <span title="Auto-Cut Aktif">✂️ Cut</span>}
                            </div>
                          </div>

                          {/* Kategori Menu yang Dipetakan */}
                          <div className="pt-2 border-t border-slate-100">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                              Routing Menu ({mappedCategories.length} Kategori):
                            </span>
                            {mappedCategories.length === 0 ? (
                              <span className="text-[11px] text-amber-600 italic">Belum ada kategori terhubung</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {mappedCategories.map(c => (
                                  <span
                                    key={c.id}
                                    className="text-[10px] font-medium px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200"
                                  >
                                    {c.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT B: PRINTER MAPPING HUB */}
          {activeSubTab === 'printers' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50/50 border border-indigo-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <span>🖨️</span>
                    <span>Pusat Pemetaan Printer (Printer Mapping Hub)</span>
                  </h4>
                  <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                    Kelola seluruh perangkat printer fisik (Printer Komputer/Sistem &amp; Printer Bluetooth BLE) yang dialokasikan untuk kasir dan stasiun produksi.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowComputerDetectModal(true)
                      handleScanComputerPrinters()
                    }}
                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition flex items-center gap-1 shadow-2xs cursor-pointer"
                  >
                    <span>🔍</span>
                    <span>Ambil Printer Komputer</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBtPairingModal(true)
                      setBtPairSuccess(null)
                      setBtPairError(null)
                    }}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1 shadow-xs cursor-pointer"
                  >
                    <span>📶</span>
                    <span>Pairing Bluetooth</span>
                  </button>
                </div>
              </div>

              {/* Table / List of Registered Printers */}
              {registeredPrinters.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-2">
                  <div className="text-3xl">🖨️ 📶</div>
                  <div className="font-bold text-slate-700 text-sm">Belum ada printer terdaftar di sistem mapping</div>
                  <p className="text-slate-500 text-[11px] max-w-md mx-auto leading-relaxed">
                    Gunakan tombol <b>"Ambil Printer Komputer"</b> untuk menarik printer kabel/driver OS Anda, atau tombol <b>"Pairing Bluetooth"</b> untuk menyambungkan printer kasir mini nirkabel.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="px-4 py-3">Nama Printer</th>
                          <th className="px-3 py-3">Tipe Koneksi</th>
                          <th className="px-3 py-3">Ukuran Kertas</th>
                          <th className="px-4 py-3">Stasiun yang Memetakan</th>
                          <th className="px-4 py-3 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {registeredPrinters.map(p => {
                          const mappedSts = p.mapped_stations || []
                          const isTesting = testingStationId === p.id

                          return (
                            <tr key={p.id} className="hover:bg-slate-50/80 transition">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-base">
                                    {p.connection_type === 'bluetooth' ? '📶' : p.connection_type === 'system' ? '🖥️' : '🖨️'}
                                  </span>
                                  <div>
                                    <span className="font-bold text-slate-900 block">{p.name}</span>
                                    {p.address && (
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        ID/MAC: {p.address}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                {p.connection_type === 'bluetooth' ? (
                                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold text-[10px] border border-indigo-200">
                                    Bluetooth Direct (BLE)
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px] border border-slate-200">
                                    Printer Komputer (OS)
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 font-mono font-semibold">
                                {p.paper_size || '58mm'}
                              </td>
                              <td className="px-4 py-3">
                                {mappedSts.length === 0 ? (
                                  <span className="text-slate-400 italic text-[11px]">Belum dipetakan ke stasiun</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {mappedSts.map(st => (
                                      <span
                                        key={st.id}
                                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded-md border border-emerald-200"
                                      >
                                        <span>{st.icon}</span>
                                        <span>{st.name}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleTestPrintStation({
                                      name: p.name,
                                      printer_connection_type: p.connection_type,
                                      printer_name: p.name,
                                      paper_size: p.paper_size,
                                      sound_buzzer: true,
                                      auto_cut: true,
                                      id: p.id
                                    })}
                                    disabled={isTesting}
                                    className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-lg text-xs transition cursor-pointer"
                                    title="Uji Cetak Perangkat Ini"
                                  >
                                    {isTesting ? '⏳ Mencetak...' : '🖨️ Uji Cetak'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePrinterDevice(p.id, p.name)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                    title="Hapus dari mapping"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      ) : (
        <div className="p-6 bg-indigo-50/50 border border-indigo-100 rounded-2xl text-center space-y-2">
          <span className="font-bold text-indigo-950 text-sm block">
            ✓ Mode Ritel &amp; Fashion Aktif Sepenuhnya
          </span>
          <p className="text-[11px] text-indigo-800 leading-relaxed max-w-lg mx-auto">
            Layar kasir Anda telah dikunci ke mode ritel murni. Struk belanja dicetak langsung ke printer kasir utama, dan seluruh pengelolaan stasiun dapur dinonaktifkan agar antarmuka kasir tetap bersih.
          </p>
        </div>
      )}

      {/* SUB-MODAL 1: ADD / EDIT STASIUN */}
      {isEditingStation && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-slate-900 text-sm">
                {editingStationId ? 'Edit Stasiun Produksi' : 'Tambah Stasiun Produksi Baru'}
              </h4>
              <button
                type="button"
                onClick={() => setIsEditingStation(false)}
                className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
                  Nama Stasiun Produksi
                </label>
                <input
                  type="text"
                  value={stationName}
                  onChange={e => setStationName(e.target.value)}
                  placeholder="Contoh: Barista Minuman, Dapur Utama, Dapur Grill..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
                    Kode Singkat (Badge)
                  </label>
                  <input
                    type="text"
                    value={stationCode}
                    onChange={e => setStationCode(e.target.value.toUpperCase())}
                    placeholder="BAR / KIT / GRL"
                    maxLength={6}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono uppercase focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
                    Ukuran Kertas Thermal
                  </label>
                  <select
                    value={stationPaperSize}
                    onChange={e => setStationPaperSize(e.target.value as PaperSize)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                  >
                    <option value="58mm">58mm (Kecil)</option>
                    <option value="80mm">80mm (Standar Resto)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
                  Pilih Ikon Visual Stasiun
                </label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                  {STATION_ICONS.map(ic => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setStationIcon(ic)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition cursor-pointer ${
                        stationIcon === ic
                          ? 'bg-slate-900 text-white shadow-xs scale-105'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>

              {/* PEMETAAN PRINTER TARGET STASIUN */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-slate-900 uppercase tracking-wide text-[11px]">
                    🖨️ Pemetaan Printer Target Stasiun
                  </label>
                  <span className="text-[10px] text-slate-500 font-medium">Multi-Printer Routing</span>
                </div>

                {/* 3 Connection Type Choices */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStationPrinterConn('same_as_cashier')
                      setStationPrinterDeviceId(null)
                    }}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      stationPrinterConn === 'same_as_cashier'
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-950 font-bold ring-1 ring-indigo-500'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-base mb-1">🖨️</span>
                    <span className="text-[11px] block leading-tight">Printer Kasir</span>
                    <span className="text-[9px] text-slate-500 font-normal">Sama dg struk kasir</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStationPrinterConn('system')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      stationPrinterConn === 'system'
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-950 font-bold ring-1 ring-indigo-500'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-base mb-1">🖥️</span>
                    <span className="text-[11px] block leading-tight">Printer Komputer</span>
                    <span className="text-[9px] text-slate-500 font-normal">USB / Driver OS</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStationPrinterConn('bluetooth')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      stationPrinterConn === 'bluetooth'
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-950 font-bold ring-1 ring-indigo-500'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-base mb-1">📶</span>
                    <span className="text-[11px] block leading-tight">Bluetooth BLE</span>
                    <span className="text-[9px] text-slate-500 font-normal">Direct Wireless</span>
                  </button>
                </div>

                {/* Case 1: Printer Komputer / Sistem */}
                {stationPrinterConn === 'system' && (
                  <div className="pt-2 border-t border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Pilih Printer Komputer Terdaftar:
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowComputerDetectModal(true)
                          handleScanComputerPrinters()
                        }}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span>🔍</span>
                        <span>Ambil dari Komputer</span>
                      </button>
                    </div>

                    <select
                      value={stationPrinterDeviceId || ''}
                      onChange={(e) => {
                        const id = e.target.value
                        setStationPrinterDeviceId(id || null)
                        const found = registeredPrinters.find(p => p.id === id)
                        if (found) {
                          setStationPrinterName(found.name)
                          if (found.paper_size) setStationPaperSize(found.paper_size)
                        }
                      }}
                      className="w-full px-2.5 py-2 border border-slate-200 rounded-xl bg-white text-xs font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                    >
                      <option value="">-- Ketik Nama Printer Baru di Bawah --</option>
                      {registeredPrinters
                        .filter(p => p.connection_type === 'system')
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            🖥️ {p.name} ({p.paper_size})
                          </option>
                        ))}
                    </select>

                    <div>
                      <input
                        type="text"
                        value={stationPrinterName}
                        onChange={e => setStationPrinterName(e.target.value)}
                        placeholder="Contoh: Epson TM-T82 Dapur, POS-80 Dapur..."
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-medium text-xs focus:ring-2 focus:ring-slate-900 outline-none"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Nama printer di dialog cetak sistem komputer kasir atau driver OS.
                      </p>
                    </div>
                  </div>
                )}

                {/* Case 2: Printer Bluetooth */}
                {stationPrinterConn === 'bluetooth' && (
                  <div className="pt-2 border-t border-slate-200/80 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Printer Bluetooth Terpasang:
                      </label>
                      <button
                        type="button"
                        onClick={() => handleStartBluetoothPairing(editingStationId || undefined)}
                        disabled={isPairingBt}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span>📶</span>
                        <span>{isPairingBt ? 'Mencari...' : 'Pairing Bluetooth Baru'}</span>
                      </button>
                    </div>

                    <select
                      value={stationPrinterDeviceId || ''}
                      onChange={(e) => {
                        const id = e.target.value
                        setStationPrinterDeviceId(id || null)
                        const found = registeredPrinters.find(p => p.id === id)
                        if (found) {
                          setStationPrinterName(found.name)
                          if (found.paper_size) setStationPaperSize(found.paper_size)
                        }
                      }}
                      className="w-full px-2.5 py-2 border border-slate-200 rounded-xl bg-white text-xs font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                    >
                      <option value="">-- Ketik Nama Printer Bluetooth di Bawah --</option>
                      {registeredPrinters
                        .filter(p => p.connection_type === 'bluetooth')
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            📶 {p.name} ({p.paper_size})
                          </option>
                        ))}
                    </select>

                    <input
                      type="text"
                      value={stationPrinterName}
                      onChange={e => setStationPrinterName(e.target.value)}
                      placeholder="Contoh: RPP02N Dapur, POS-58 Barista..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-medium text-xs focus:ring-2 focus:ring-slate-900 outline-none"
                    />

                    {/* Quick Bluetooth Status Feedback */}
                    <div className="flex items-center justify-between bg-indigo-50/70 p-2 rounded-xl border border-indigo-100">
                      <div className="flex items-center gap-1.5 text-[11px] text-indigo-900">
                        <span>{stationPrinterName ? '🟢' : '⚪'}</span>
                        <span className="font-semibold">
                          {stationPrinterName ? `Printer: ${stationPrinterName}` : 'Belum dipasangkan'}
                        </span>
                      </div>
                      {stationPrinterName && (
                        <button
                          type="button"
                          onClick={() => handleTestPrintStation({
                            name: stationName || 'Stasiun Uji',
                            printer_connection_type: 'bluetooth',
                            printer_name: stationPrinterName,
                            paper_size: stationPaperSize,
                            sound_buzzer: stationSoundBuzzer,
                            auto_cut: stationAutoCut
                          })}
                          className="px-2 py-0.5 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-md text-[10px] font-bold"
                        >
                          Uji Cetak BLE
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Hardware Signals: Buzzer & Auto-Cut */}
                <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-3 text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={stationSoundBuzzer}
                      onChange={e => setStationSoundBuzzer(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>🔔 Alarm Buzzer (Beep 2x)</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={stationAutoCut}
                      onChange={e => setStationAutoCut(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>✂️ Potong Kertas Otomatis</span>
                  </label>
                </div>
              </div>

              {/* Category Routing Checklist */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
                  Kategori Menu yang Dialirkan ke Stasiun Ini:
                </label>
                {categories.length === 0 ? (
                  <p className="text-slate-400 italic text-[11px]">Belum ada kategori produk di unit bisnis ini.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                    {categories.map(c => {
                      const isChecked = selectedCategoryIds.includes(c.id)
                      const isAssignedOther = c.production_station_id && c.production_station_id !== editingStationId
                      return (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white cursor-pointer transition select-none"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCategorySelection(c.id)}
                            className="w-4 h-4 text-slate-900 rounded border-slate-300 focus:ring-slate-900 cursor-pointer"
                          />
                          <span className="font-medium text-slate-800 flex-1">{c.name}</span>
                          {isAssignedOther && (
                            <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              Pindah Stasiun
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditingStation(false)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-50 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveStation}
                disabled={isSavingStation}
                className="px-5 py-2 bg-slate-950 hover:bg-black text-white font-bold rounded-xl text-xs shadow-md transition cursor-pointer disabled:opacity-50"
              >
                {isSavingStation ? 'Menyimpan...' : 'Simpan Stasiun'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-MODAL 2: AMBIL & DAFTARKAN PRINTER KOMPUTER */}
      {showComputerDetectModal && (
        <div className="fixed inset-0 z-[1310] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🖥️</span>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">Ambil Data Printer Komputer</h4>
                  <p className="text-[10px] text-slate-400">Deteksi otomatis atau pilih driver printer terpasang di OS</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowComputerDetectModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Scan Status Banner */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-[11px]">Hasil Deteksi Web Printing API:</span>
                  <button
                    type="button"
                    onClick={handleScanComputerPrinters}
                    disabled={isScanningPrinters}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                  >
                    <span>🔄</span>
                    <span>{isScanningPrinters ? 'Memindai...' : 'Pindai Ulang'}</span>
                  </button>
                </div>

                {detectedPrinters.length > 0 ? (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] text-emerald-700 font-bold block">
                      ✓ Ditemukan {detectedPrinters.length} printer di komputer ini:
                    </span>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {detectedPrinters.map((dp, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-200"
                        >
                          <span className="font-bold text-slate-800 truncate">{dp.name}</span>
                          <button
                            type="button"
                            onClick={() => handleAddComputerPrinterSubmit(dp.name, '58mm', targetStationForNewPrinter)}
                            className="px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[10px] font-bold hover:bg-indigo-700"
                          >
                            + Petakan
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    {computerScanError || 'Browser Anda membatasi pembacaan otomatis nama printer lokal untuk alasan privasi. Silakan pilih rekomendasi model di bawah ini atau ketik nama printer driver yang terpasang.'}
                  </div>
                )}
              </div>

              {/* Quick Preset Selector */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wide text-[10px] mb-1">
                  Pilih Cepat Model Printer POS Populer:
                </label>
                <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto p-1 bg-slate-50 border border-slate-200 rounded-xl">
                  {COMMON_PRINTER_MODELS.map((m, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setNewSystemPrinterName(m.name)
                        setNewSystemPaperSize(m.paper_size)
                      }}
                      className="text-left px-2.5 py-1.5 bg-white hover:bg-indigo-50 hover:text-indigo-900 rounded-lg border border-slate-200/80 transition flex items-center justify-between"
                    >
                      <span className="font-medium text-slate-800">{m.name}</span>
                      <span className="text-[10px] font-mono text-slate-400">{m.paper_size}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Form Input Manual / Custom */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wide text-[10px] mb-1">
                    Nama / Alias Printer Driver Komputer
                  </label>
                  <input
                    type="text"
                    value={newSystemPrinterName}
                    onChange={e => setNewSystemPrinterName(e.target.value)}
                    placeholder="Contoh: EPSON TM-T82 Receipt, POS-58 USB..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 uppercase tracking-wide text-[10px] mb-1">
                      Ukuran Kertas
                    </label>
                    <select
                      value={newSystemPaperSize}
                      onChange={e => setNewSystemPaperSize(e.target.value as PaperSize)}
                      className="w-full px-2.5 py-2 border border-slate-200 rounded-xl bg-white font-medium outline-none"
                    >
                      <option value="58mm">58mm (Kecil)</option>
                      <option value="80mm">80mm (Standar)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 uppercase tracking-wide text-[10px] mb-1">
                      Petakan ke Stasiun (Opsional)
                    </label>
                    <select
                      value={targetStationForNewPrinter}
                      onChange={e => setTargetStationForNewPrinter(e.target.value)}
                      className="w-full px-2.5 py-2 border border-slate-200 rounded-xl bg-white font-medium outline-none"
                    >
                      <option value="">-- Hanya Simpan di Hub --</option>
                      {stations.map(st => (
                        <option key={st.id} value={st.id}>
                          {st.icon} {st.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowComputerDetectModal(false)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-50 transition cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => handleAddComputerPrinterSubmit(newSystemPrinterName, newSystemPaperSize, targetStationForNewPrinter)}
                disabled={isAddingPrinter || !newSystemPrinterName.trim()}
                className="px-5 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
              >
                {isAddingPrinter ? 'Menyimpan...' : 'Daftarkan Printer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-MODAL 3: PAIRING SISTEM BLUETOOTH */}
      {showBtPairingModal && (
        <div className="fixed inset-0 z-[1310] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📶</span>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">Pairing Sistem Printer Bluetooth</h4>
                  <p className="text-[10px] text-slate-400">Sambungkan printer thermal wireless langsung via Web Bluetooth</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBtPairingModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2">
                <span className="font-bold text-indigo-950 block text-[11px]">Petunjuk Pairing Cepat:</span>
                <ol className="list-decimal list-inside text-indigo-900 space-y-1 text-[11px] leading-relaxed">
                  <li>Nyalakan printer Bluetooth thermal Anda dan pastikan lampu indikator menyala.</li>
                  <li>Dekatkan printer ke komputer/tablet (dalam radius 3 meter).</li>
                  <li>Klik tombol <b>"Mulai Pindai &amp; Pasangkan"</b> di bawah, lalu pilih nama printer (misal: <i>RPP02N, POS-58, MTP-II</i>) pada jendela pemilih peramban.</li>
                </ol>
              </div>

              {btPairSuccess ? (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold">
                    <span>🟢</span>
                    <span>Berhasil Terhubung ke {btPairSuccess.name}!</span>
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    Printer Bluetooth ini telah didaftarkan ke sistem pemetaan dan siap mencetak tiket kasir atau dapur.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await sendBluetoothTestPrint()
                      alert(res.message || (res.success ? 'Uji cetak berhasil!' : 'Gagal uji cetak'))
                    }}
                    className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    🖨️ Uji Cetak Sekarang (Test Print BLE)
                  </button>
                </div>
              ) : btPairError ? (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-[11px]">
                  ⚠️ {btPairError}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wide text-[10px] mb-1">
                    Ukuran Kertas Thermal
                  </label>
                  <select
                    value={btPaperSize}
                    onChange={e => setBtPaperSize(e.target.value as PaperSize)}
                    className="w-full px-2.5 py-2 border border-slate-200 rounded-xl bg-white font-medium outline-none"
                  >
                    <option value="58mm">58mm (Kasir Mini)</option>
                    <option value="80mm">80mm (Resto Besar)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wide text-[10px] mb-1">
                    Petakan ke Stasiun (Opsional)
                  </label>
                  <select
                    value={btTargetStation}
                    onChange={e => setBtTargetStation(e.target.value)}
                    className="w-full px-2.5 py-2 border border-slate-200 rounded-xl bg-white font-medium outline-none"
                  >
                    <option value="">-- Pilih Stasiun --</option>
                    {stations.map(st => (
                      <option key={st.id} value={st.id}>
                        {st.icon} {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowBtPairingModal(false)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-50 transition cursor-pointer"
              >
                {btPairSuccess ? 'Selesai' : 'Batal'}
              </button>
              <button
                type="button"
                onClick={() => handleStartBluetoothPairing(btTargetStation || undefined)}
                disabled={isPairingBt}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-md transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>📶</span>
                <span>{isPairingBt ? 'Mencari Perangkat...' : 'Mulai Pindai &amp; Pasangkan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
