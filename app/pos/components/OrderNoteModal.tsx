"use client"

import { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

interface Props {
  isOpen: boolean
  onClose: () => void
  currentNote: string
  onSave: (note: string) => void
}

const ORDER_PRESETS = [
  'Makan di Tempat (Dine-in)',
  'Bawa Pulang (Takeaway)',
  'Meja 1',
  'Meja 2',
  'Meja 3',
  'Meja 4',
  'Meja 5',
  'Prioritas / Urgent',
  'Titip Kasir',
  'Tanpa Sedotan',
  'Pisah Kantong'
]

export default function OrderNoteModal({ isOpen, onClose, currentNote, onSave }: Props) {
  const [note, setNote] = useState('')

  useEffect(() => {
    if (isOpen) {
      setNote(currentNote || '')
    }
  }, [isOpen, currentNote])

  if (!isOpen) return null

  const handleTogglePreset = (preset: string) => {
    const current = note.trim()
    if (!current) {
      setNote(preset)
      return
    }

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

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="sm"
      title={
        <div className="flex items-center gap-2">
          <span className="text-lg">📝</span>
          <span className="text-slate-900 font-extrabold text-sm sm:text-base">Catatan Global Pesanan</span>
        </div>
      }
      description="Instruksi operasional untuk dapur, nomor meja, atau staf packing"
      footer={
        <div className="flex items-center gap-2.5">
          {currentNote && (
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
            {ORDER_PRESETS.map((preset) => {
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
              Teks Catatan Pesanan
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
            placeholder="Contoh: Meja 08 - Lantai 2, bawa pulang, titip kasir sampai jam 17:00..."
            className="w-full p-3 text-base sm:text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-2xs leading-relaxed"
          />
          <p className="text-[10px] text-slate-400">
            Catatan ini akan dicantumkan pada bagian atas struk kasir dan riwayat pesanan.
          </p>
        </div>
      </div>
    </FullScreenModal>
  )
}
