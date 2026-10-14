"use client"

import { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  shiftId: string
  initialType?: 'cash_out' | 'cash_in'
  industryMode?: 'fnb' | 'fashion'
  onSuccess: () => Promise<void> | void
}

export default function PettyCashModal({
  isOpen,
  onClose,
  shiftId,
  initialType = 'cash_out',
  industryMode = 'fnb',
  onSuccess
}: Props) {
  const [movementType, setMovementType] = useState<'cash_out' | 'cash_in'>(initialType)
  const [amount, setAmount] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Sync movementType when initialType changes upon opening
  useEffect(() => {
    if (isOpen) {
      setMovementType(initialType)
      setAmount('')
      setCategory('')
      setNote('')
      setErrorMsg(null)
    }
  }, [isOpen, initialType])

  // Fast preset denominations
  const quickAmounts = [10000, 20000, 50000, 100000]

  // Fast category presets based on industry
  const fnbPresets = [
    { label: '🧊 Beli Es Batu', val: 'Beli Es Batu Darurat' },
    { label: '💧 Galon Air / Minum', val: 'Beli Galon Air Mineral' },
    { label: '🔥 Gas LPG / Arang', val: 'Isi Ulang Gas LPG' },
    { label: '🧂 Bumbu / Susu Segar', val: 'Beli Susu / Bahan Darurat' },
    { label: '🛵 Parkir / Kurir', val: 'Parkir / Tip Driver Kurir' }
  ]

  const fashionPresets = [
    { label: '📦 Lakban & Plastik Packing', val: 'Beli Lakban & Plastik Polymailer' },
    { label: '🏷️ Label / Tag Barcode', val: 'Kertas Thermal & Price Tag' },
    { label: '🛵 Parkir & Kurir Ekspedisi', val: 'Ongkir / Parkir Drop Off Ekspedisi' },
    { label: '✨ Kebersihan Display', val: 'Pembersih Kaca / Hanger Display' },
    { label: '☕ Konsumsi Staf Lembur', val: 'Snack / Konsumsi Staf Toko' }
  ]

  const presets = industryMode === 'fashion' ? fashionPresets : fnbPresets

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErrorMsg(null)

    const numAmount = Number(amount.replace(/[^0-9]/g, ''))
    if (!numAmount || numAmount <= 0) {
      setErrorMsg('Masukkan nominal mutasi kas yang valid (lebih dari 0).')
      return
    }

    const finalNote = [category, note.trim()].filter(Boolean).join(' - ') || 
      (movementType === 'cash_in' ? 'Kas Masuk Laci' : 'Kas Keluar Operasional')

    setSubmitting(true)
    try {
      const res = await fetch('/api/pos/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cash_movement',
          shift_id: shiftId,
          type: movementType,
          amount: numAmount,
          note: finalNote
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyimpan mutasi kas')
      }

      setAmount('')
      setCategory('')
      setNote('')
      await onSuccess()
      onClose()
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan sistem.')
    } finally {
      setSubmitting(false)
    }
  }

  const formatIDRInput = (val: string) => {
    const raw = val.replace(/[^0-9]/g, '')
    if (!raw) return ''
    return Number(raw).toLocaleString('id-ID')
  }

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black shadow-xs ${
            movementType === 'cash_out' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
          }`}>
            {movementType === 'cash_out' ? '💸' : '💰'}
          </div>
          <span>{movementType === 'cash_out' ? 'Kas Keluar (Petty Cash)' : 'Kas Masuk Laci'}</span>
        </div>
      }
      description={
        movementType === 'cash_out' 
          ? 'Catat pengeluaran tunai kecil operasional tanpa menutup shift' 
          : 'Catat tambahan uang modal / kembalian ke dalam laci'
      }
      desktopSize="md"
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={submitting}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white transition shadow-md flex items-center gap-2 ${
              movementType === 'cash_out'
                ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
            } disabled:opacity-50`}
          >
            {submitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <span>{movementType === 'cash_out' ? 'Simpan Kas Keluar' : 'Simpan Kas Masuk'}</span>
                <span>→</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-xs">
        {errorMsg && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Type Selector (Kas Keluar vs Kas Masuk) */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl border border-slate-200/70">
          <button
            type="button"
            onClick={() => {
              setMovementType('cash_out')
              setCategory('')
            }}
            className={`py-2.5 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-1.5 ${
              movementType === 'cash_out'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>🔻 Kas Keluar (Petty Cash)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMovementType('cash_in')
              setCategory('')
            }}
            className={`py-2.5 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-1.5 ${
              movementType === 'cash_in'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>🔺 Kas Masuk (Tambah Modal)</span>
          </button>
        </div>

        {/* Nominal Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex justify-between">
            <span>Nominal Mutasi Tunai (IDR)</span>
            <span className="text-[11px] text-slate-400 font-normal">Hanya angka rupiah</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-extrabold text-slate-400">
              Rp
            </span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={formatIDRInput(amount)}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              required
              className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-lg font-black text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition tabular-nums"
            />
          </div>

          {/* Quick Denomination Chips */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {quickAmounts.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(q))}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              >
                +Rp {q.toLocaleString('id-ID')}
              </button>
            ))}
          </div>
        </div>

        {/* Fast Preset Category Chips */}
        {movementType === 'cash_out' && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              Pilihan Cepat Keperluan Toko
            </label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => {
                const isSelected = category === p.val
                return (
                  <button
                    key={p.val}
                    type="button"
                    onClick={() => setCategory(isSelected ? '' : p.val)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
                      isSelected
                        ? 'bg-rose-50 border-rose-400 text-rose-700 font-bold shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Note / Deskripsi */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex justify-between">
            <span>Catatan / Keterangan Mutasi</span>
            <span className="text-[11px] text-slate-400 font-normal">Opsional</span>
          </label>
          <textarea
            rows={2}
            placeholder={
              movementType === 'cash_out' 
                ? 'Contoh: Beli solasi bening 2 pcs di warung sebelah'
                : 'Contoh: Tambahan uang receh Rp 2.000 & Rp 5.000 dari brankas'
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
          />
        </div>

        {/* Info Tip */}
        <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl text-[11px] space-y-1">
          <p className="font-bold text-amber-900 flex items-center gap-1.5">
            <span>💡</span>
            <span>Pengaruh ke Laci Kas:</span>
          </p>
          <p className="text-amber-700/90 leading-relaxed">
            Nominal ini akan otomatis menambah atau mengurangi saldo fisik yang diharapkan (*Expected Cash*) pada penutupan sesi shift kasir hari ini.
          </p>
        </div>
      </form>
    </FullScreenModal>
  )
}
