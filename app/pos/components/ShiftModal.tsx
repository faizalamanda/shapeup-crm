"use client"
import { useState } from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
  activeShift: any | null
  cashierName: string
  onOpenShift: (initialCash: number, note: string, sourceAccountCode: string) => Promise<void>
  onCloseShift: (shiftId: string, actualCash: number, note: string) => Promise<void>
}

export default function ShiftModal({ isOpen, onClose, activeShift, cashierName, onOpenShift, onCloseShift }: Props) {
  const [initialCash, setInitialCash] = useState<string>('100000')
  const [sourceAccountCode, setSourceAccountCode] = useState<string>('101100')
  const [actualCash, setActualCash] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!isOpen) return null

  const handleOpen = async () => {
    setIsSubmitting(true)
    setErrorMsg(null)
    try {
      await onOpenShift(Number(initialCash) || 0, note, sourceAccountCode)
      onClose()
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal membuka shift')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = async () => {
    if (!activeShift?.id) return
    setIsSubmitting(true)
    setErrorMsg(null)
    try {
      await onCloseShift(activeShift.id, Number(actualCash) || 0, note)
      onClose()
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menutup shift')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">Manajemen Shift Kasir</h3>
            <p className="text-xs text-gray-500">Kasir: <span className="font-semibold text-gray-800">{cashierName}</span></p>
          </div>
          <button 
            onClick={onClose} 
            disabled={isSubmitting}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-gray-700 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-sm">
          {activeShift ? (
            // Close Shift Mode
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Status Shift:</span>
                  <span className="font-bold text-emerald-600 uppercase">AKTIF (OPEN)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Waktu Buka:</span>
                  <span className="font-medium text-gray-800">{new Date(activeShift.opened_at).toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Modal Awal Kas:</span>
                  <span className="font-semibold text-gray-900">Rp {Number(activeShift.initial_cash || 0).toLocaleString('id-ID')}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Hitung Uang Kas Faktual di Laci (Actual Cash) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Masukkan jumlah uang tunai di laci kasir..."
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 text-lg font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Catatan Rekonsiliasi (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Catatan jika ada selisih kas..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
          ) : (
            // Open Shift Mode
            <div className="space-y-4">
              <div className="p-3.5 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-800">
                ℹ️ Belum ada shift kasir yang aktif. Buka shift terlebih dahulu untuk mencatat transaksi dan laci kasir.
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Input Modal Awal Kasir (Initial Cash) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Nominal modal uang kembalian di laci..."
                  value={initialCash}
                  onChange={(e) => setInitialCash(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 text-lg font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Sumber Uang Kas / Rekening (Akun Kredit Jurnal)
                </label>
                <select
                  value={sourceAccountCode}
                  onChange={(e) => setSourceAccountCode(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                >
                  <option value="101100">101100 - Kas Utama / Rekening Bank Utama (Default)</option>
                  <option value="101300">101300 - Kas Kecil / Petty Cash</option>
                  <option value="301000">301000 - Modal Pemilik / Setoran Tunai</option>
                </select>
                <p className="text-[10px] text-gray-500 mt-1">
                  Jurnal Otomatis: <b>DEBIT Kas POS (101000)</b> | <b>KREDIT {sourceAccountCode}</b>
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Catatan Shift Buka
                </label>
                <input
                  type="text"
                  placeholder="Catatan shift..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-200">
              ⚠️ {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="py-2.5 px-4 border border-gray-300 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs transition"
          >
            Batal
          </button>
          {activeShift ? (
            <button
              onClick={handleClose}
              disabled={isSubmitting || !actualCash}
              className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-xs transition shadow-sm text-center disabled:opacity-50"
            >
              {isSubmitting ? 'Tutup Shift...' : 'Tutup Shift & Rekonsiliasi'}
            </button>
          ) : (
            <button
              onClick={handleOpen}
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition shadow-sm text-center"
            >
              {isSubmitting ? 'Membuka...' : 'Buka Shift Baru'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
