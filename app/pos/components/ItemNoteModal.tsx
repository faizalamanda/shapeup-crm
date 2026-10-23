"use client"

import { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

interface Props {
  isOpen: boolean
  onClose: () => void
  item: {
    name: string
    variantName?: string
    note?: string
  } | null
  onSave: (note: string) => void
}

const ITEM_PRESETS = [
  'Tanpa Es',
  'Less Ice',
  'Tanpa Gula',
  'Less Sugar',
  'Pedas',
  'Sedang',
  'Tidak Pedas',
  'Pisah Sambal',
  'Bungkus Terpisah',
  'Jangan Pakai Sendok',
  'Hangat',
  'Ekstra Saus'
]

export default function ItemNoteModal({ isOpen, onClose, item, onSave }: Props) {
  const [note, setNote] = useState('')

  useEffect(() => {
    if (isOpen) {
      setNote(item?.note || '')
    }
  }, [isOpen, item?.note])

  if (!isOpen || !item) return null

  const handleTogglePreset = (preset: string) => {
    const current = note.trim()
    if (!current) {
      setNote(preset)
      return
    }

    // Check if preset already included
    const parts = current.split(',').map(p => p.trim()).filter(Boolean)
    const existsIndex = parts.findIndex(p => p.toLowerCase() === preset.toLowerCase())

    if (existsIndex > -1) {
      parts.splice(existsIndex, 1)
      setNote(parts.join(', '))
    } else {
      parts.push(preset)
      setNote(parts.join(', '))
    }
  }

  const isPresetActive = (preset: string) => {
    if (!note) return false
    return note.toLowerCase().includes(preset.toLowerCase())
  }

  const handleSave = () => {
    onSave(note.trim())
    onClose()
  }

  const handleClear = () => {
    onSave('')
    onClose()
  }

  const subtitle = item.variantName 
    ? `${item.name} (${item.variantName})`
    : item.name

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="sm"
      title={
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <span className="text-slate-900 font-extrabold text-sm sm:text-base">Catatan Item Produk</span>
        </div>
      }
      description={
        <span className="text-xs text-indigo-600 font-semibold truncate block mt-0.5">
          {subtitle}
        </span>
      }
      footer={
        <div className="flex items-center gap-2.5">
          {item.note && (
            <button
              type="button"
              onClick={handleClear}
              className="py-3 px-3.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl text-xs transition active:scale-95"
            >
              Hapus
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-3 border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition active:scale-95"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shadow-indigo-500/20 active:scale-95 text-center"
          >
            Simpan Catatan
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Preset Chips */}
        <div>
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
            Pilihan Cepat (1-Ketukan)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ITEM_PRESETS.map((preset) => {
              const active = isPresetActive(preset)
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleTogglePreset(preset)}
                  className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all active:scale-95 ${
                    active
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50'
                  }`}
                >
                  {active ? `✓ ${preset}` : `+ ${preset}`}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom Note Textarea */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Teks Catatan Bebas
            </label>
            {note && (
              <button
                type="button"
                onClick={() => setNote('')}
                className="text-[11px] text-rose-500 hover:text-rose-700 font-semibold"
              >
                ✕ Kosongkan
              </button>
            )}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ketik instruksi khusus (misal: Jangan pakai kacang, pisah bungkus, saus di pinggir)..."
            className="w-full p-3 text-base sm:text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-2xs leading-relaxed"
          />
          <p className="text-[10px] text-slate-400">
            Catatan ini akan tercetak pada struk belanja di bawah baris produk.
          </p>
        </div>
      </div>
    </FullScreenModal>
  )
}
