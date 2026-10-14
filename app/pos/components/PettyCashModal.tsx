"use client"

import { useState, useEffect } from 'react'

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

  if (!isOpen) return null

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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

      // Reset form
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-black shadow-sm ${
              movementType === 'cash_out' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {movementType === 'cash_out' ? '💸' : '💰'}
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base sm:text-lg leading-snug">
                {movementType === 'cash_out' ? 'Kas Keluar (Petty Cash)' : 'Kas Masuk Laci'}
              </h3>
              <p className="text-xs text-slate-500 leading-tight">
                {movementType === 'cash_out' 
                  ? 'Catat pengeluaran tunai kecil operasional tanpa menutup shift' 
                  : 'Catat tambahan uang modal / kembalian ke dalam laci'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-200/60 hover:bg-slate-200 text-slate-600 hover:text-slate-900 flex items-center justify-center font-bold text-sm transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
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
              <span>🔺 Kas Masuk (Modal Tambahan)</span>
            </button>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Nominal Uang Fisik (IDR) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">
                Rp
              </span>
              <input
                type="text"
                autoFocus
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(formatIDRInput(e.target.value))}
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xl font-black text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              />
            </div>

            {/* Quick Amount Chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {quickAmounts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmount(q.toLocaleString('id-ID'))}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition border border-slate-200/80"
                >
                  +{q.toLocaleString('id-ID')}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Category Presets (For Cash Out) */}
          {movementType === 'cash_out' && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Kategori Keperluan Cepat ({industryMode === 'fashion' ? 'Mode Fashion' : 'Mode F&B'})
              </label>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.val}
                    type="button"
                    onClick={() => setCategory(p.val)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
                      category === p.val
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Note Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Keterangan / Catatan Bukti Kasir
            </label>
            <input
              type="text"
              placeholder={
                category
                  ? `Misal: Toko Sebelah, Parkir kurir, dll.`
                  : movementType === 'cash_out'
                  ? 'Ketik keperluan pengeluaran...'
                  : 'Ketik asal modal kas masuk...'
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
            />
          </div>

          {/* Info Badge */}
          <div className="p-3 bg-amber-50/80 border border-amber-200/70 rounded-2xl text-[11px] text-amber-800 space-y-0.5">
            <p className="font-bold flex items-center gap-1.5">
              <span>💡</span>
              <span>Otomatis Merevisi Perhitungan Laci Saat Tutup Shift</span>
            </p>
            <p className="text-amber-700/90 leading-relaxed">
              Nominal ini akan otomatis menambah atau mengurangi saldo fisik yang diharapkan (*Expected Cash*) pada penutupan sesi shift kasir hari ini.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
            >
              Batal
            </button>
            <button
              type="submit"
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
        </form>
      </div>
    </div>
  )
}
