"use client"
import { useState, useEffect } from 'react'

export type PaymentMethod = 'cash' | 'bank' | 'qris'

export type PaymentPayloadItem = {
  method: PaymentMethod
  amount: number
  cash_received?: number
  change_amount?: number
  reference_number?: string
}

export type PaymentResult = {
  method: string
  cashReceived: number
  changeAmount: number
  amountPaid: number
  isPartial: boolean
  payments: PaymentPayloadItem[]
}

type Props = {
  isOpen: boolean
  onClose: () => void
  grandTotal: number
  title?: string
  subtitle?: string
  defaultMode?: 'full' | 'partial' | 'split'
  onConfirmPayment: (result: PaymentResult) => Promise<void> | void
}

export default function CashPaymentModal({
  isOpen,
  onClose,
  grandTotal,
  title,
  subtitle,
  defaultMode = 'full',
  onConfirmPayment
}: Props) {
  // Mode: 'full' | 'partial' | 'split'
  const [payMode, setPayMode] = useState<'full' | 'partial' | 'split'>(defaultMode)
  
  // Single tender states
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState<number>(grandTotal)
  const [customInput, setCustomInput] = useState<string>(String(grandTotal))

  // Partial tender state
  const [partialAmountInput, setPartialAmountInput] = useState<string>('')
  
  // Split tender states (Split 1: Cash, Split 2: Bank/QRIS)
  const [splitCashAmount, setSplitCashAmount] = useState<string>(String(Math.floor(grandTotal / 2)))
  const [splitNonCashMethod, setSplitNonCashMethod] = useState<'bank' | 'qris'>('qris')
  const [splitNonCashAmount, setSplitNonCashAmount] = useState<string>(String(grandTotal - Math.floor(grandTotal / 2)))
  const [splitCashReceived, setSplitCashReceived] = useState<string>(String(Math.floor(grandTotal / 2)))

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setPayMode(defaultMode)
      setMethod('cash')
      setCashReceived(grandTotal)
      setCustomInput(String(grandTotal))
      setPartialAmountInput(String(Math.floor(grandTotal / 2)))
      
      const half = Math.floor(grandTotal / 2)
      setSplitCashAmount(String(half))
      setSplitNonCashAmount(String(grandTotal - half))
      setSplitCashReceived(String(half))
      
      setErrorMsg(null)
      setIsSubmitting(false)
    }
  }, [isOpen, grandTotal])

  if (!isOpen) return null

  // Calculations for Full mode
  const singleChangeAmount = Math.max(0, cashReceived - grandTotal)
  const isSingleCashInsufficient = method === 'cash' && payMode === 'full' && cashReceived < grandTotal

  // Calculations for Partial mode
  const numPartialAmount = Number(partialAmountInput.replace(/\D/g, '')) || 0
  const partialCashChange = Math.max(0, cashReceived - numPartialAmount)
  const isPartialCashInsufficient = method === 'cash' && payMode === 'partial' && cashReceived < numPartialAmount

  // Calculations for Split mode
  const numSplitCash = Number(splitCashAmount.replace(/\D/g, '')) || 0
  const numSplitNonCash = Number(splitNonCashAmount.replace(/\D/g, '')) || 0
  const totalSplitTender = numSplitCash + numSplitNonCash
  const numSplitReceived = Number(splitCashReceived.replace(/\D/g, '')) || 0
  const splitChangeAmount = Math.max(0, numSplitReceived - numSplitCash)
  const isSplitCashInsufficient = numSplitReceived < numSplitCash

  // Quick denomination suggestions
  const getQuickAmounts = (target: number) => {
    const amounts = [target]
    const rounded5 = Math.ceil(target / 5000) * 5000
    const rounded10 = Math.ceil(target / 10000) * 10000
    const rounded50 = Math.ceil(target / 50000) * 50000
    const rounded100 = Math.ceil(target / 100000) * 100000

    if (rounded5 > target && !amounts.includes(rounded5)) amounts.push(rounded5)
    if (rounded10 > target && !amounts.includes(rounded10)) amounts.push(rounded10)
    if (rounded50 > target && !amounts.includes(rounded50)) amounts.push(rounded50)
    if (rounded100 > target && !amounts.includes(rounded100)) amounts.push(rounded100);

    ;[20000, 50000, 100000].forEach((val: number) => {
      if (val >= target && !amounts.includes(val)) amounts.push(val)
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
    setErrorMsg(null)

    // ── 1. FULL PAYMENT MODE ──
    if (payMode === 'full') {
      if (isSingleCashInsufficient) {
        setErrorMsg('Nominal uang tunai yang diterima kurang dari total belanja.')
        return
      }

      setIsSubmitting(true)
      try {
        await onConfirmPayment({
          method,
          cashReceived: method === 'cash' ? cashReceived : grandTotal,
          changeAmount: method === 'cash' ? singleChangeAmount : 0,
          amountPaid: grandTotal,
          isPartial: false,
          payments: [
            {
              method,
              amount: grandTotal,
              cash_received: method === 'cash' ? cashReceived : grandTotal,
              change_amount: method === 'cash' ? singleChangeAmount : 0
            }
          ]
        })
      } catch (err: any) {
        setErrorMsg(err.message || 'Gagal memproses pembayaran')
        setIsSubmitting(false)
      }

    // ── 2. PARTIAL PAYMENT MODE (CICILAN / DP) ──
    } else if (payMode === 'partial') {
      if (numPartialAmount <= 0) {
        setErrorMsg('Nominal cicilan / DP harus lebih dari Rp 0.')
        return
      }
      if (numPartialAmount >= grandTotal) {
        setErrorMsg('Nominal cicilan tidak boleh melebihi atau sama dengan total tagihan. Gunakan mode Bayar Penuh.')
        return
      }
      if (isPartialCashInsufficient) {
        setErrorMsg('Nominal uang tunai yang diterima kurang dari nominal cicilan yang disepakati.')
        return
      }

      setIsSubmitting(true)
      try {
        await onConfirmPayment({
          method,
          cashReceived: method === 'cash' ? cashReceived : numPartialAmount,
          changeAmount: method === 'cash' ? partialCashChange : 0,
          amountPaid: numPartialAmount,
          isPartial: true,
          payments: [
            {
              method,
              amount: numPartialAmount,
              cash_received: method === 'cash' ? cashReceived : numPartialAmount,
              change_amount: method === 'cash' ? partialCashChange : 0
            }
          ]
        })
      } catch (err: any) {
        setErrorMsg(err.message || 'Gagal memproses pembayaran cicilan')
        setIsSubmitting(false)
      }

    // ── 3. SPLIT PAYMENT MODE ──
    } else if (payMode === 'split') {
      if (totalSplitTender <= 0) {
        setErrorMsg('Total pembayaran kombinasi harus lebih dari Rp 0.')
        return
      }
      if (isSplitCashInsufficient) {
        setErrorMsg('Uang tunai yang diterima kurang dari nominal porsi tunai.')
        return
      }

      const isSplitPartial = totalSplitTender < grandTotal

      const splitItems: PaymentPayloadItem[] = []
      if (numSplitCash > 0) {
        splitItems.push({
          method: 'cash',
          amount: numSplitCash,
          cash_received: numSplitReceived,
          change_amount: splitChangeAmount
        })
      }
      if (numSplitNonCash > 0) {
        splitItems.push({
          method: splitNonCashMethod,
          amount: numSplitNonCash,
          cash_received: numSplitNonCash,
          change_amount: 0
        })
      }

      setIsSubmitting(true)
      try {
        await onConfirmPayment({
          method: 'split',
          cashReceived: numSplitReceived,
          changeAmount: splitChangeAmount,
          amountPaid: totalSplitTender,
          isPartial: isSplitPartial,
          payments: splitItems
        })
      } catch (err: any) {
        setErrorMsg(err.message || 'Gagal memproses split payment')
        setIsSubmitting(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
          <div>
            <h3 className="font-bold text-gray-900 text-base sm:text-lg">{title || 'Pembayaran Kasir POS'}</h3>
            <p className="text-[11px] text-gray-500">{subtitle || 'Pilih skema pelunasan & selesaikan transaksi'}</p>
          </div>
          <button 
            onClick={onClose} 
            disabled={isSubmitting}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-gray-700 flex items-center justify-center text-xs font-bold"
          >
            ✕
          </button>
        </div>

        {/* Body Container */}
        <div className="p-5 space-y-4 text-sm overflow-y-auto">
          {/* Mode Tabs: Full vs Partial vs Split */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 rounded-xl text-xs font-semibold">
            <button
              onClick={() => { setPayMode('full'); setErrorMsg(null); }}
              className={`py-2 px-2.5 rounded-lg transition text-center ${
                payMode === 'full' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              ✓ Bayar Penuh
            </button>
            <button
              onClick={() => { setPayMode('partial'); setErrorMsg(null); }}
              className={`py-2 px-2.5 rounded-lg transition text-center ${
                payMode === 'partial' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              ⏳ Cicil / DP
            </button>
            <button
              onClick={() => { setPayMode('split'); setErrorMsg(null); }}
              className={`py-2 px-2.5 rounded-lg transition text-center ${
                payMode === 'split' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              🔀 Split Payment
            </button>
          </div>

          {/* Grand Total Display Banner */}
          <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100/80 rounded-2xl p-3.5 text-center shadow-2xs">
            <div className="text-[11px] text-indigo-600 font-bold uppercase tracking-wider">Total Tagihan (Grand Total)</div>
            <div className="text-2xl sm:text-3xl font-black text-indigo-950 mt-0.5">
              Rp {grandTotal.toLocaleString('id-ID')}
            </div>
            {payMode === 'partial' && (
              <div className="mt-2 pt-2 border-t border-indigo-200/50 flex justify-between text-xs font-medium px-2 text-indigo-900">
                <span>Dibayar: <strong>Rp {numPartialAmount.toLocaleString('id-ID')}</strong></span>
                <span className="text-amber-700 font-bold">Sisa Tagihan: Rp {Math.max(0, grandTotal - numPartialAmount).toLocaleString('id-ID')}</span>
              </div>
            )}
            {payMode === 'split' && (
              <div className="mt-2 pt-2 border-t border-indigo-200/50 flex justify-between text-xs font-medium px-2 text-indigo-900">
                <span>Total Tender: <strong>Rp {totalSplitTender.toLocaleString('id-ID')}</strong></span>
                <span className={totalSplitTender >= grandTotal ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                  {totalSplitTender >= grandTotal ? 'Lunas ✓' : `Sisa: Rp ${(grandTotal - totalSplitTender).toLocaleString('id-ID')}`}
                </span>
              </div>
            )}
          </div>

          {/* ── 1. MODE: FULL ATAU PARTIAL SINGLE METHOD ── */}
          {(payMode === 'full' || payMode === 'partial') && (
            <div className="space-y-3.5">
              {/* Method Tabs */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setMethod('cash')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    method === 'cash' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-xs' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>💵</span>
                  <span>Tunai (Cash)</span>
                </button>
                <button
                  onClick={() => setMethod('qris')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    method === 'qris' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-xs' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>📱</span>
                  <span>QRIS</span>
                </button>
                <button
                  onClick={() => setMethod('bank')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    method === 'bank' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-xs' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>💳</span>
                  <span>EDC / Bank</span>
                </button>
              </div>

              {/* Partial Amount Input if in Partial Mode */}
              {payMode === 'partial' && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Nominal Cicilan / DP Yang Dibayar Hari Ini (Rp) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={partialAmountInput}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '')
                      setPartialAmountInput(raw)
                      setCashReceived(Number(raw) || 0)
                      setCustomInput(raw)
                    }}
                    placeholder="Masukkan nominal DP..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-lg font-black text-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none bg-amber-50/50"
                  />
                </div>
              )}

              {/* Cash Controls */}
              {method === 'cash' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                      Uang Fisik Tunai Diterima (Rp)
                    </label>
                    <input
                      type="text"
                      value={customInput}
                      onChange={handleCustomInputChange}
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-lg font-black text-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>

                  {/* Quick Amounts */}
                  <div>
                    <div className="text-[11px] text-gray-500 font-semibold mb-1">Nominal Cepat:</div>
                    <div className="flex flex-wrap gap-2">
                      {getQuickAmounts(payMode === 'partial' ? numPartialAmount : grandTotal).map((amt, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSelectQuickAmount(amt)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            cashReceived === amt
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {amt === (payMode === 'partial' ? numPartialAmount : grandTotal) ? 'Uang Pas' : `Rp ${amt.toLocaleString('id-ID')}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Change / Short Box */}
                  <div className={`p-3 rounded-xl border flex items-center justify-between ${
                    (payMode === 'partial' ? isPartialCashInsufficient : isSingleCashInsufficient)
                      ? 'bg-red-50 border-red-200 text-red-700' 
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}>
                    <span className="text-xs font-semibold">
                      {(payMode === 'partial' ? isPartialCashInsufficient : isSingleCashInsufficient) 
                        ? 'Uang Tunai Kurang:' 
                        : 'Kembalian Diserahkan (Change):'}
                    </span>
                    <span className="text-sm sm:text-base font-extrabold">
                      {(payMode === 'partial' ? isPartialCashInsufficient : isSingleCashInsufficient)
                        ? `- Rp ${Math.abs(cashReceived - (payMode === 'partial' ? numPartialAmount : grandTotal)).toLocaleString('id-ID')}`
                        : `Rp ${(payMode === 'partial' ? partialCashChange : singleChangeAmount).toLocaleString('id-ID')}`
                      }
                    </span>
                  </div>
                </div>
              ) : method === 'qris' ? (
                <div className="p-4 border border-dashed border-gray-300 rounded-xl text-center space-y-1.5 bg-gray-50">
                  <div className="text-3xl">📱</div>
                  <p className="text-xs font-bold text-gray-800">Scan QRIS Dinamis / Statis</p>
                  <p className="text-[11px] text-gray-500">Minta pelanggan melakukan transfer ke QRIS toko dan verifikasi notifikasi sukses.</p>
                </div>
              ) : (
                <div className="p-4 border border-gray-200 rounded-xl text-center space-y-1.5 bg-gray-50">
                  <div className="text-3xl">💳</div>
                  <p className="text-xs font-bold text-gray-800">Mesin EDC / Transfer Bank</p>
                  <p className="text-[11px] text-gray-500">Gesek kartu pada EDC atau minta bukti mutasi transfer rekening bank.</p>
                </div>
              )}
            </div>
          )}

          {/* ── 2. MODE: SPLIT PAYMENT (MULTI-TENDER) ── */}
          {payMode === 'split' && (
            <div className="space-y-3.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              {/* Tender 1: Tunai */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs font-bold text-slate-800">
                  <span>1. Porsi Pembayaran Tunai (Cash):</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-gray-500 block mb-0.5">Tagihan Tunai (Rp)</span>
                    <input
                      type="text"
                      value={splitCashAmount}
                      onChange={(e) => setSplitCashAmount(e.target.value.replace(/\D/g, ''))}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm font-bold text-gray-900 bg-white"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 block mb-0.5">Fisik Uang Diterima (Rp)</span>
                    <input
                      type="text"
                      value={splitCashReceived}
                      onChange={(e) => setSplitCashReceived(e.target.value.replace(/\D/g, ''))}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm font-bold text-gray-900 bg-white"
                    />
                  </div>
                </div>
                {splitChangeAmount > 0 && (
                  <p className="text-[11px] text-emerald-700 font-semibold text-right">
                    Kembalian Tunai: Rp {splitChangeAmount.toLocaleString('id-ID')}
                  </p>
                )}
              </div>

              {/* Tender 2: Non-Tunai */}
              <div className="space-y-1.5 pt-2 border-t border-slate-200">
                <div className="flex justify-between items-center text-xs font-bold text-slate-800">
                  <span>2. Porsi Non-Tunai (QRIS / Bank):</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSplitNonCashMethod('qris')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${splitNonCashMethod === 'qris' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >
                      QRIS
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitNonCashMethod('bank')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${splitNonCashMethod === 'bank' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >
                      EDC/Bank
                    </button>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 block mb-0.5">Nominal Non-Tunai (Rp)</span>
                  <input
                    type="text"
                    value={splitNonCashAmount}
                    onChange={(e) => setSplitNonCashAmount(e.target.value.replace(/\D/g, ''))}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm font-bold text-gray-900 bg-white"
                  />
                </div>
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
            className="py-3 px-4 border border-gray-300 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs transition"
          >
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              isSubmitting || 
              (payMode === 'full' && method === 'cash' && isSingleCashInsufficient) ||
              (payMode === 'partial' && method === 'cash' && isPartialCashInsufficient) ||
              (payMode === 'split' && isSplitCashInsufficient)
            }
            className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 active:scale-[0.99] disabled:opacity-50 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-sm text-center"
          >
            {isSubmitting 
              ? 'Memproses Bayar...' 
              : payMode === 'partial'
                ? `Proses Cicilan (Rp ${numPartialAmount.toLocaleString('id-ID')}) ✓`
                : payMode === 'split'
                  ? `Selesaikan Split (Rp ${totalSplitTender.toLocaleString('id-ID')}) ✓`
                  : 'Selesaikan Pembayaran Lunas ✓'
            }
          </button>
        </div>
      </div>
    </div>
  )
}
