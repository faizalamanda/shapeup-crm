"use client"
import { useState, useEffect } from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
  grandTotal: number
  onConfirmPayment: (paymentData: { method: 'cash' | 'bank' | 'qris'; cashReceived: number; changeAmount: number }) => Promise<void>
}

export default function CashPaymentModal({ isOpen, onClose, grandTotal, onConfirmPayment }: Props) {
  const [method, setMethod] = useState<'cash' | 'bank' | 'qris'>('cash')
  const [cashReceived, setCashReceived] = useState<number>(grandTotal)
  const [customInput, setCustomInput] = useState<string>(String(grandTotal))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setCashReceived(grandTotal)
      setCustomInput(String(grandTotal))
      setErrorMsg(null)
      setIsSubmitting(false)
    }
  }, [isOpen, grandTotal])

  if (!isOpen) return null

  const changeAmount = Math.max(0, cashReceived - grandTotal)
  const isInsufficient = method === 'cash' && cashReceived < grandTotal

  // Quick denomination suggestions based on grand total
  const getQuickAmounts = (total: number) => {
    const amounts = [total] // Pas
    const rounded5 = Math.ceil(total / 5000) * 5000
    const rounded10 = Math.ceil(total / 10000) * 10000
    const rounded50 = Math.ceil(total / 50000) * 50000
    const rounded100 = Math.ceil(total / 100000) * 100000

    if (rounded5 > total && !amounts.includes(rounded5)) amounts.push(rounded5)
    if (rounded10 > total && !amounts.includes(rounded10)) amounts.push(rounded10)
    if (rounded50 > total && !amounts.includes(rounded50)) amounts.push(rounded50)
    if (rounded100 > total && !amounts.includes(rounded100)) amounts.push(rounded100);

    // Standard high bills
    ;[20000, 50000, 100000].forEach((val: number) => {
      if (val >= total && !amounts.includes(val)) amounts.push(val)
    })

    return amounts.slice(0, 5)
  }

  const handleSelectQuickAmount = (amt: number) => {
    setCashReceived(amt)
    setCustomInput(String(amt))
    setErrorMsg(null)
  }

  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    const num = Number(raw) || 0
    setCustomInput(raw)
    setCashReceived(num)
    setErrorMsg(null)
  }

  const handleConfirm = async () => {
    if (isInsufficient) {
      setErrorMsg('Nominal uang tunai yang diterima kurang dari total belanja.')
      return
    }

    setIsSubmitting(true)
    setErrorMsg(null)
    try {
      await onConfirmPayment({
        method,
        cashReceived: method === 'cash' ? cashReceived : grandTotal,
        changeAmount: method === 'cash' ? changeAmount : 0
      })
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses pembayaran')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">Pembayaran POS</h3>
            <p className="text-xs text-gray-500">Pilih metode bayar & selesaikan transaksi</p>
          </div>
          <button 
            onClick={onClose} 
            disabled={isSubmitting}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-gray-700 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 text-sm">
          {/* Method Selection Tabs */}
          <div className="grid grid-cols-3 gap-2 p-1 bg-gray-100 rounded-xl">
            <button
              onClick={() => setMethod('cash')}
              className={`py-2 px-3 rounded-lg text-xs font-semibold transition ${
                method === 'cash' ? 'bg-white text-indigo-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              💵 Cash (Tunai)
            </button>
            <button
              onClick={() => setMethod('bank')}
              className={`py-2 px-3 rounded-lg text-xs font-semibold transition ${
                method === 'bank' ? 'bg-white text-indigo-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              💳 Kartu / Transfer
            </button>
            <button
              onClick={() => setMethod('qris')}
              className={`py-2 px-3 rounded-lg text-xs font-semibold transition ${
                method === 'qris' ? 'bg-white text-indigo-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              📱 QRIS / Digital
            </button>
          </div>

          {/* Total display banner */}
          <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-4 text-center">
            <div className="text-xs text-indigo-600 font-medium uppercase tracking-wide">Total Tagihan (Grand Total)</div>
            <div className="text-2xl font-extrabold text-indigo-950 mt-0.5">
              Rp {grandTotal.toLocaleString('id-ID')}
            </div>
          </div>

          {/* Cash input controls */}
          {method === 'cash' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Uang Tunai Diterima (Rp)
                </label>
                <input
                  type="text"
                  value={customInput}
                  onChange={handleCustomInputChange}
                  placeholder="0"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 text-lg font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* Quick Amounts */}
              <div>
                <div className="text-[11px] text-gray-500 font-medium mb-1">Nominal Cepat:</div>
                <div className="flex flex-wrap gap-2">
                  {getQuickAmounts(grandTotal).map((amt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSelectQuickAmount(amt)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                        cashReceived === amt
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {amt === grandTotal ? 'Uang Pas' : `Rp ${amt.toLocaleString('id-ID')}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Kembalian Box */}
              <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
                isInsufficient ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}>
                <span className="text-xs font-semibold">
                  {isInsufficient ? 'Uang Kurang:' : 'Kembalian (Change):'}
                </span>
                <span className="text-base font-extrabold">
                  {isInsufficient 
                    ? `- Rp ${(grandTotal - cashReceived).toLocaleString('id-ID')}`
                    : `Rp ${changeAmount.toLocaleString('id-ID')}`
                  }
                </span>
              </div>
            </div>
          ) : method === 'qris' ? (
            <div className="p-4 border border-dashed border-gray-300 rounded-xl text-center space-y-2 bg-gray-50">
              <div className="w-32 h-32 bg-white border rounded-xl mx-auto flex items-center justify-center text-4xl shadow-xs">
                📲
              </div>
              <p className="text-xs font-semibold text-gray-700">Tampilkan QRIS ke Pelanggan</p>
              <p className="text-[11px] text-gray-500">Scan QRIS menggunakan BCA / GoPay / OVO / ShopeePay dll.</p>
            </div>
          ) : (
            <div className="p-4 border border-gray-200 rounded-xl text-center space-y-2 bg-gray-50">
              <div className="text-3xl">💳</div>
              <p className="text-xs font-semibold text-gray-700">Mesin EDC / Transfer Bank</p>
              <p className="text-[11px] text-gray-500">Pastikan pembayaran kartu/transfer telah berhasil pada terminal EDC.</p>
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
            className="py-3 px-4 border border-gray-300 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs transition"
          >
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || (method === 'cash' && isInsufficient)}
            className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-sm text-center"
          >
            {isSubmitting ? 'Memproses Bayar...' : 'Selesaikan Pembayaran ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}
