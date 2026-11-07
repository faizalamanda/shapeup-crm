"use client"
import React, { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { ProductionStation } from '@/lib/pos/productionRoutingService'
import { PosMode } from '@/lib/pos/posMode'
import { PaperSize } from '@/lib/pos/printerAdapter'

interface Props {
  isOpen: boolean
  onClose: () => void
  onStationsUpdated?: () => void
}

const STATION_ICONS = ['🍳', '☕', '🍹', '🥩', '🍕', '🍰', '🍜', '🥖', '🎁', '🥗', '🍗', '🧊']

export default function ProductionStationsModal({ isOpen, onClose, onStationsUpdated }: Props) {
  const [loading, setLoading] = useState(false)
  const [posMode, setPosMode] = useState<PosMode>('retail')
  const [stations, setStations] = useState<ProductionStation[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string; production_station_id?: string | null }>>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  // Sub-dialog state: Adding or Editing a Station
  const [isEditingStation, setIsEditingStation] = useState(false)
  const [editingStationId, setEditingStationId] = useState<string | null>(null)
  const [stationName, setStationName] = useState('')
  const [stationCode, setStationCode] = useState('')
  const [stationIcon, setStationIcon] = useState('🍳')
  const [stationPaperSize, setStationPaperSize] = useState<PaperSize>('58mm')
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [isSavingStation, setIsSavingStation] = useState(false)

  // 1. Fetch data on open
  useEffect(() => {
    if (isOpen) {
      loadStationsAndCategories()
    }
  }, [isOpen])

  const loadStationsAndCategories = async () => {
    setLoading(true)
    setStatusMessage(null)
    try {
      const res = await fetch('/api/pos/stations')
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        setStations(data.stations || [])
        setCategories(data.categories || [])
        setPosMode(data.posMode || (data.industry === 'fnb' ? 'fnb' : 'retail'))
      }
    } catch (err: any) {
      setStatusMessage('Gagal memuat data stasiun: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // 2. Handle POS Mode change
  const handleChangePosMode = async (newMode: PosMode) => {
    setPosMode(newMode)
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

  // 3. Open Station Form
  const handleOpenAddStation = () => {
    setEditingStationId(null)
    setStationName('')
    setStationCode('')
    setStationIcon('🍳')
    setStationPaperSize('58mm')
    setSelectedCategoryIds([])
    setIsEditingStation(true)
  }

  const handleOpenEditStation = (st: ProductionStation) => {
    setEditingStationId(st.id)
    setStationName(st.name)
    setStationCode(st.code || '')
    setStationIcon(st.icon || '🍳')
    setStationPaperSize(st.paper_size || '58mm')

    // Find categories mapped to this station
    const mappedIds = categories
      .filter(c => c.production_station_id === st.id)
      .map(c => c.id)
    setSelectedCategoryIds(mappedIds)
    setIsEditingStation(true)
  }

  // 4. Save Station
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
          category_ids: selectedCategoryIds
        })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal menyimpan stasiun')
      }

      setIsEditingStation(false)
      await loadStationsAndCategories()
      if (onStationsUpdated) onStationsUpdated()
      setStatusMessage('✓ Stasiun produksi berhasil disimpan ke database.')
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan stasiun.')
    } finally {
      setIsSavingStation(false)
    }
  }

  // 5. Delete Station
  const handleDeleteStation = async (stationId: string, name: string) => {
    if (!window.confirm(`Hapus stasiun "${name}"?\nKategori yang terhubung otomatis dilepas tanpa menghapus produk.`)) {
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

      await loadStationsAndCategories()
      if (onStationsUpdated) onStationsUpdated()
      setStatusMessage(`✓ Stasiun "${name}" telah dihapus.`)
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus stasiun.')
    }
  }

  const toggleCategorySelection = (catId: string) => {
    setSelectedCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    )
  }

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      title="🔀 Konfigurasi Mode POS &amp; Stasiun Produksi"
      description="Pemisahan mode ritel vs resto, stasiun masak kustom di database Supabase, dan routing kategori"
      desktopSize="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {statusMessage && (
              <span className={`text-xs font-bold ${statusMessage.startsWith('✓') ? 'text-emerald-700' : 'text-amber-700'}`}>
                {statusMessage}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Selesai
          </button>
        </div>
      }
    >
      <div className="space-y-6 text-xs">
        
        {/* 1. Mode POS Switcher Card */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
          <div>
            <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] block">
              Pilihan Mode Operasional POS
            </span>
            <p className="text-slate-500 text-[11px] mt-0.5">
              Pilih mode sesuai industri bisnis Anda agar tampilan kasir tidak tercemar oleh istilah yang tidak relevan.
            </p>
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
                    <span className="text-[10px] bg-indigo-600 text-white font-bold px-1.5 py-0.2 rounded-full">
                      Aktif
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  100% bersih untuk toko baju &amp; ritel. Seluruh tombol dapur, tiket masak, dan nomor meja disembunyikan. Fokus pada barcode, variasi ukuran, dan struk belanja.
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
                    <span className="text-[10px] bg-emerald-600 text-white font-bold px-1.5 py-0.2 rounded-full">
                      Aktif
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Lengkap untuk hospitality. Mengaktifkan tombol dapur, pesanan meja ditahan (*Hold Orders*), dan stasiun produksi kustom dengan routing kategori dinamis.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Custom Production Stations Section (Visible when F&B or Custom) */}
        {posMode !== 'retail' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Stasiun Produksi Kustom (Database Supabase)</h4>
                <p className="text-slate-500 text-[11px]">
                  Tersimpan di database dan tersinkronisasi otomatis ke seluruh tablet kasir di cabang ini.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenAddStation}
                className="py-2 px-3 bg-slate-950 hover:bg-black text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <span>+</span>
                <span>Tambah Stasiun</span>
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-slate-400">Memuat stasiun dari database...</div>
            ) : stations.length === 0 ? (
              <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-2">
                <div className="text-3xl">☕ 🍳</div>
                <div className="font-bold text-slate-700 text-sm">Belum ada stasiun produksi yang dibuat</div>
                <p className="text-slate-500 text-[11px] max-w-md mx-auto leading-relaxed">
                  Klik tombol <b>"+ Tambah Stasiun"</b> untuk mendefinisikan stasiun kerja di cabang Anda (misal: <i>Barista Minuman, Dapur Utama, Dapur Grill, atau Pastry</i>), lalu petakan kategori menu ke stasiun tersebut.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {stations.map(st => {
                  const mappedCategories = categories.filter(c => c.production_station_id === st.id)
                  return (
                    <div
                      key={st.id}
                      className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs hover:border-slate-300 transition flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl p-1 bg-slate-100 rounded-lg">{st.icon}</span>
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
                              onClick={() => handleOpenEditStation(st)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition"
                              title="Edit Stasiun"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteStation(st.id, st.name)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              title="Hapus Stasiun"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>

                        {/* Mapped Categories Badges */}
                        <div className="pt-2 border-t border-slate-100">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                            Kategori Terpetakan ({mappedCategories.length}):
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
        ) : (
          <div className="p-5 bg-indigo-50/50 border border-indigo-100 rounded-2xl text-center space-y-1">
            <span className="font-bold text-indigo-950 text-xs block">
              ✓ Mode Ritel &amp; Fashion Aktif Sepenuhnya
            </span>
            <p className="text-[11px] text-indigo-800 leading-relaxed max-w-lg mx-auto">
              Layar kasir Anda telah dikunci ke mode ritel murni. Seluruh terminologi dapur disembunyikan agar kasir fokus melayani penjualan pakaian, variasi warna/ukuran, dan struk belanja konsumen.
            </p>
          </div>
        )}

      </div>

      {/* Sub-Dialog: Add/Edit Station Modal */}
      {isEditingStation && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
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

            <div className="space-y-3 text-xs">
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

              {/* Category Checklist */}
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
                            className="w-4 h-4 text-slate-900 rounded border-slate-300 focus:ring-slate-900"
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

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
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
    </FullScreenModal>
  )
}

