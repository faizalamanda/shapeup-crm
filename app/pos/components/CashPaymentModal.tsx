"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { resolveBusinessTenders, type POSTender, type TenderCategory } from '@/lib/pos/tenderResolver'

export type PaymentMethod = 'cash' | 'bank' | 'qris'

export type PaymentPayloadItem = {
  account_id?: string
  payment_method_account_id?: string
  account_code?: string
  account_name?: string
  method: PaymentMethod
  is_cash?: boolean
  amount: number
  cash_received?: number
  change_amount?: number
  reference_number?: string
  notes?: string
}

export type PaymentResult = {
  method: string
  cashReceived: number
  changeAmount: number
  amountPaid: number
  isPartial: boolean
  payments: PaymentPayloadItem[]
  splitBillInfo?: {
    type: 'full' | 'split_item' | 'split_equal' | 'partial' | 'item' | 'equal'
    billNumber?: number
    totalBills?: number
    coveredItems?: string[]
    unpaidItems?: string[]
    remainingAmount: number
  }
}

export type CartItemForSplit = {
  id: string
  name: string
  price: number
  quantity: number
  variantName?: string
}

export type CashBankAccount = {
  id: string
  code: string
  name: string
  type?: string
  sub_type?: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  grandTotal: number
  cartItems?: CartItemForSplit[]
  accounts?: CashBankAccount[]
  customTenders?: POSTender[]
  activeRegisterAccountId?: string | null
  activeShift?: any
  businessId?: string
  title?: string
  subtitle?: string
  defaultMode?: 'full' | 'split_item' | 'split_equal' | 'partial' | 'split'
  onConfirmPayment: (result: PaymentResult) => Promise<void> | void
}

type TenderLine = {
  id: string
  tenderId?: string
  accountId: string
  amount: number
  cashReceived: number
  referenceNumber: string
}

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(val || 0))

export default function CashPaymentModal({
  isOpen,
  onClose,
  grandTotal,
  cartItems = [],
  accounts: propAccounts,
  customTenders: propCustomTenders,
  activeRegisterAccountId,
  activeShift,
  businessId,
  title,
  subtitle,
  defaultMode = 'full',
  onConfirmPayment
}: Props) {
  const [mounted, setMounted] = useState(false)

  // 1. Bill Management State
  // Modes: 'full' | 'split_item' | 'split_equal' | 'partial'
  const initialMode = defaultMode === 'split' ? 'split_equal' : (defaultMode as any)
  const [billMode, setBillMode] = useState<'full' | 'split_item' | 'split_equal' | 'partial'>(initialMode)

  // Split by Item selection: IDs of items covered in Sub-Bill 1
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())

  // Split Equal: Count of people to divide bill
  const [splitCount, setSplitCount] = useState<number>(2)

  // Partial: Custom down payment amount input
  const [partialAmountInput, setPartialAmountInput] = useState<string>('')

  // 2. Cash & Bank Accounts (Chart of Accounts)
  const [fetchedAccounts, setFetchedAccounts] = useState<CashBankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false)

  // 3. Multi-Tender Lines (Split Tender)
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Resolve business accounts
  useEffect(() => {
    if (!isOpen) return

    if (propAccounts && propAccounts.length > 0) {
      setFetchedAccounts(propAccounts)
      return
    }

    let isSubscribed = true
    const fetchBizAccounts = async () => {
      setLoadingAccounts(true)
      try {
        let query = supabase
          .from('accounts')
          .select('id, code, name, type, sub_type')
          .eq('type', 'ASSET')
          .order('code', { ascending: true })

        if (businessId) {
          query = query.eq('business_id', businessId)
        }

        const { data, error } = await query
        if (!error && data && isSubscribed) {
          setFetchedAccounts(data as CashBankAccount[])
        }
      } catch (err) {
        console.warn('[CashPaymentModal] Failed to load accounts:', err)
      } finally {
        if (isSubscribed) setLoadingAccounts(false)
      }
    }

    fetchBizAccounts()
    return () => { isSubscribed = false }
  }, [isOpen, propAccounts, businessId])

  // Fetch custom tenders from settings API if not passed via props
  const [fetchedCustomTenders, setFetchedCustomTenders] = useState<POSTender[] | null>(null)

  useEffect(() => {
    if (!isOpen || !businessId || propCustomTenders) return
    let isSubscribed = true
    fetch('/api/settings/pos/tenders')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.customTenders && isSubscribed) {
          setFetchedCustomTenders(data.customTenders)
        }
      })
      .catch(() => null)
    return () => { isSubscribed = false }
  }, [isOpen, businessId, propCustomTenders])

  // Filtered list of Cash & Bank accounts (Code 101xxx or bank_cash)
  const cashBankAccounts = useMemo(() => {
    const list = fetchedAccounts.filter(
      (a) => a.type === 'ASSET' && (a.code?.startsWith('101') || a.sub_type === 'bank_cash')
    )

    if (list.length > 0) return list

    // Resilient fallback accounts if no specific accounts are loaded
    return [
      { id: 'default-pos-cash', code: '101000', name: 'Kas Laci POS (Tunai)', type: 'ASSET' },
      { id: 'default-pos-bank', code: '101200', name: 'Bank / QRIS POS', type: 'ASSET' },
      { id: 'default-main-bank', code: '101100', name: 'Kas / Bank Utama', type: 'ASSET' }
    ]
  }, [fetchedAccounts])

  // Resolved list of POS Tenders (Hybrid: Settings or Smart COA auto-classification)
  const tenderOptions = useMemo(() => {
    return resolveBusinessTenders({
      accounts: cashBankAccounts,
      customTenders: propCustomTenders || fetchedCustomTenders,
      activeRegisterAccountId
    })
  }, [cashBankAccounts, propCustomTenders, fetchedCustomTenders, activeRegisterAccountId])

  // Helper to check if an account or tender represents physical cash
  const isAccountCash = useCallback((accId: string, tenderId?: string): boolean => {
    if (tenderId) {
      const t = tenderOptions.find((o) => o.id === tenderId)
      if (t) return t.category === 'cash'
    }
    const tByAcc = tenderOptions.find((o) => o.account_id === accId)
    if (tByAcc) return tByAcc.category === 'cash'

    const acc = cashBankAccounts.find((a) => a.id === accId)
    if (!acc) return false
    const code = acc.code || ''
    const name = (acc.name || '').toLowerCase()
    return code === '101000' || name.includes('kas laci') || (name.includes('kas') && !name.includes('bank')) || name.includes('tunai')
  }, [cashBankAccounts, tenderOptions])

  // Map account to standard method string
  const getAccountMethod = useCallback((accId: string, tenderId?: string): PaymentMethod => {
    if (tenderId) {
      const t = tenderOptions.find((o) => o.id === tenderId)
      if (t) {
        if (t.category === 'cash') return 'cash'
        if (t.category === 'qris') return 'qris'
        return 'bank'
      }
    }
    const tByAcc = tenderOptions.find((o) => o.account_id === accId)
    if (tByAcc) {
      if (tByAcc.category === 'cash') return 'cash'
      if (tByAcc.category === 'qris') return 'qris'
      return 'bank'
    }

    const acc = cashBankAccounts.find((a) => a.id === accId)
    if (!acc) return 'cash'
    const name = (acc.name || '').toLowerCase()
    if (isAccountCash(accId)) return 'cash'
    if (name.includes('qris')) return 'qris'
    return 'bank'
  }, [cashBankAccounts, isAccountCash, tenderOptions])

  // Compute active bill target amount based on bill mode
  const activeBillTarget = useMemo(() => {
    if (billMode === 'full') {
      return grandTotal
    }
    if (billMode === 'split_item') {
      if (cartItems.length === 0) return grandTotal
      const selectedSum = cartItems
        .filter((item) => selectedItemIds.has(item.id))
        .reduce((sum, item) => sum + (item.price * item.quantity), 0)
      return Math.min(grandTotal, selectedSum)
    }
    if (billMode === 'split_equal') {
      const validCount = Math.max(1, splitCount)
      return Math.round(grandTotal / validCount)
    }
    if (billMode === 'partial') {
      const parsed = Number(partialAmountInput.replace(/\D/g, '')) || 0
      return Math.min(grandTotal, parsed)
    }
    return grandTotal
  }, [billMode, grandTotal, cartItems, selectedItemIds, splitCount, partialAmountInput])

  // Sisa tagihan di luar sub-bill saat ini
  const unpaidOutsideBill = useMemo(() => {
    return Math.max(0, grandTotal - activeBillTarget)
  }, [grandTotal, activeBillTarget])

  // Select tender for a specific tender line
  const handleSelectTenderForLine = (lineId: string, tender: POSTender) => {
    const isCash = tender.category === 'cash'
    setTenderLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l
        const currentAmount = Number(l.amount) || grandTotal
        return {
          ...l,
          tenderId: tender.id,
          accountId: tender.account_id,
          cashReceived: isCash ? Math.max(currentAmount, l.cashReceived || currentAmount) : currentAmount,
          referenceNumber: isCash ? '' : l.referenceNumber
        }
      })
    )
  }

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setBillMode(defaultMode === 'split' ? 'split_equal' : (defaultMode as any))
      setErrorMsg(null)
      setIsSubmitting(false)
      setSplitCount(2)
      setPartialAmountInput(String(Math.floor(grandTotal / 2)))

      // Default select first item or half items in split by item
      if (cartItems.length > 0) {
        setSelectedItemIds(new Set([cartItems[0].id]))
      } else {
        setSelectedItemIds(new Set())
      }

      // Default primary tender line: prioritize Cash Tender
      const defaultTender = tenderOptions.find((t) => t.category === 'cash') || tenderOptions[0]
      const defaultAcc = defaultTender
        ? cashBankAccounts.find((a) => a.id === defaultTender.account_id)
        : cashBankAccounts[0]

      const fallbackAccId = defaultTender?.account_id || defaultAcc?.id || 'default-pos-cash'

      setTenderLines([
        {
          id: 'line-1',
          tenderId: defaultTender?.id,
          accountId: fallbackAccId,
          amount: grandTotal,
          cashReceived: grandTotal,
          referenceNumber: ''
        }
      ])
    }
  }, [isOpen, grandTotal, defaultMode, tenderOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  // When activeBillTarget changes, if only 1 line exists, keep it synced
  useEffect(() => {
    setTenderLines((prev) => {
      if (prev.length <= 1 && prev[0]) {
        return [
          {
            ...prev[0],
            amount: activeBillTarget,
            cashReceived: Math.max(prev[0].cashReceived, activeBillTarget)
          }
        ]
      }
      return prev
    })
  }, [activeBillTarget])

  // Sum of payments across all tender lines
  const totalTenderAmount = useMemo(() => {
    return tenderLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  }, [tenderLines])

  // Total cash received across all cash lines
  const totalCashReceived = useMemo(() => {
    return tenderLines.reduce((sum, line) => {
      if (isAccountCash(line.accountId)) {
        return sum + (Number(line.cashReceived) || Number(line.amount) || 0)
      }
      return sum + (Number(line.amount) || 0)
    }, 0)
  }, [tenderLines, isAccountCash])

  // Change amount calculation
  const totalChangeAmount = useMemo(() => {
    let change = 0
    tenderLines.forEach((line) => {
      if (isAccountCash(line.accountId)) {
        const received = Number(line.cashReceived) || 0
        const amt = Number(line.amount) || 0
        if (received > amt) {
          change += (received - amt)
        }
      }
    })
    return change
  }, [tenderLines, isAccountCash])

  // Check if any cash line has insufficient cash received
  const hasInsufficientCashLine = useMemo(() => {
    return tenderLines.some((line) => {
      if (isAccountCash(line.accountId)) {
        const received = Number(line.cashReceived) || 0
        const amt = Number(line.amount) || 0
        return received < amt
      }
      return false
    })
  }, [tenderLines, isAccountCash])

  // Add tender line (Split Tender)
  const handleAddTenderLine = () => {
    const unallocated = Math.max(0, activeBillTarget - totalTenderAmount)
    // Pick a tender not yet used, or default to second tender
    const usedAccIds = new Set(tenderLines.map((l) => l.accountId))
    const candidateTender = tenderOptions.find((t) => !usedAccIds.has(t.account_id)) || tenderOptions[1] || tenderOptions[0]
    const candidateAcc = candidateTender
      ? cashBankAccounts.find((a) => a.id === candidateTender.account_id)
      : cashBankAccounts[1] || cashBankAccounts[0]

    setTenderLines((prev) => [
      ...prev,
      {
        id: 'line-' + Date.now(),
        tenderId: candidateTender?.id,
        accountId: candidateTender?.account_id || candidateAcc?.id || 'default-pos-bank',
        amount: unallocated,
        cashReceived: unallocated,
        referenceNumber: ''
      }
    ])
  }

  // Remove tender line
  const handleRemoveTenderLine = (id: string) => {
    if (tenderLines.length <= 1) return
    setTenderLines((prev) => prev.filter((l) => l.id !== id))
  }

  // Update specific tender line
  const handleUpdateLine = (id: string, updates: Partial<TenderLine>) => {
    setTenderLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const updated = { ...l, ...updates }
        return updated
      })
    )
    setErrorMsg(null)
  }

  // Quick denomination suggestions for cash inputs
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

    ;[20000, 50000, 100000, 200000].forEach((val: number) => {
      if (val >= target && !amounts.includes(val)) amounts.push(val)
    })

    return amounts.slice(0, 4)
  }

  // Execution: Submit payment
  const handleConfirm = async () => {
    setErrorMsg(null)

    if (totalTenderAmount <= 0) {
      setErrorMsg('Total pembayaran harus lebih besar dari Rp 0.')
      return
    }

    if (hasInsufficientCashLine) {
      setErrorMsg('Terdapat baris pembayaran tunai dengan uang diterima yang kurang dari nominal.')
      return
    }

    if (billMode === 'split_item' && activeBillTarget <= 0) {
      setErrorMsg('Pilih minimal satu item untuk dibayar pada sub-bill ini.')
      return
    }

    const effectivePaid = totalTenderAmount
    const isPartialOrder = effectivePaid < grandTotal

    // Build payload items mapped to chosen accounts
    const payloadItems: PaymentPayloadItem[] = tenderLines
      .filter((l) => Number(l.amount) > 0)
      .map((l) => {
        const acc = cashBankAccounts.find((a) => a.id === l.accountId)
        const isCash = isAccountCash(l.accountId, l.tenderId)
        const method = getAccountMethod(l.accountId, l.tenderId)
        const tenderObj = tenderOptions.find((t) => t.id === l.tenderId || t.account_id === l.accountId)
        const amt = Number(l.amount)
        const cashRec = isCash ? Number(l.cashReceived || amt) : amt
        const change = isCash ? Math.max(0, cashRec - amt) : 0
        const tenderDisplayName = tenderObj?.name || acc?.name || (isCash ? 'Tunai (Laci Kasir)' : 'Transfer Bank')

        return {
          account_id: l.accountId,
          payment_method_account_id: l.accountId,
          account_code: acc?.code,
          account_name: acc?.name,
          method,
          is_cash: isCash,
          amount: amt,
          cash_received: cashRec,
          change_amount: change,
          reference_number: l.referenceNumber.trim() || undefined,
          notes: `Pembayaran via ${tenderDisplayName} (${acc?.code || 'COA'})`
        }
      })

    const primaryMethod = payloadItems.length > 1
      ? 'split'
      : (payloadItems[0]?.method || 'cash')

    // Split bill metadata
    const coveredItemIds = billMode === 'split_item' ? Array.from(selectedItemIds) : undefined
    const unpaidItemIds = billMode === 'split_item'
      ? cartItems.filter((i) => !selectedItemIds.has(i.id)).map((i) => i.id)
      : undefined

    setIsSubmitting(true)
    try {
      await onConfirmPayment({
        method: primaryMethod,
        cashReceived: totalCashReceived,
        changeAmount: totalChangeAmount,
        amountPaid: effectivePaid,
        isPartial: isPartialOrder,
        payments: payloadItems,
        splitBillInfo: {
          type: billMode,
          billNumber: 1,
          totalBills: billMode === 'split_equal' ? splitCount : (billMode === 'split_item' ? 2 : 1),
          coveredItems: coveredItemIds,
          unpaidItems: unpaidItemIds,
          remainingAmount: Math.max(0, grandTotal - effectivePaid)
        }
      })
    } catch (err: any) {
      console.error('Payment confirm error:', err)
      setErrorMsg(err.message || 'Gagal memproses pembayaran')
      setIsSubmitting(false)
    }
  }

  if (!isOpen || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-100">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border border-slate-200">
        
        {/* Clean Header (Zero Clutter) */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/90">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-base sm:text-lg tracking-tight">
                {title || 'Pembayaran Kasir'}
              </h3>
              {unpaidOutsideBill > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                  Belum Lunas
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {subtitle || 'Pilih tagihan, akun Kas & Bank, dan selesaikan transaksi'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-lg bg-slate-200/70 text-slate-600 hover:text-slate-900 hover:bg-slate-300/80 flex items-center justify-center text-xs font-bold transition cursor-pointer"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-slate-900">
          
          {/* Bill Mode Tabs (Ultra-Minimalist Text Tabs) */}
          <div className="p-1 bg-slate-100 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => { setBillMode('full'); setErrorMsg(null); }}
              className={`py-2 px-2 rounded-lg transition text-center cursor-pointer ${
                billMode === 'full'
                  ? 'bg-white text-slate-950 shadow-xs font-bold border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bayar Penuh
            </button>
            <button
              type="button"
              onClick={() => { setBillMode('split_item'); setErrorMsg(null); }}
              className={`py-2 px-2 rounded-lg transition text-center cursor-pointer ${
                billMode === 'split_item'
                  ? 'bg-white text-slate-950 shadow-xs font-bold border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pecah per Menu
            </button>
            <button
              type="button"
              onClick={() => { setBillMode('split_equal'); setErrorMsg(null); }}
              className={`py-2 px-2 rounded-lg transition text-center cursor-pointer ${
                billMode === 'split_equal'
                  ? 'bg-white text-slate-950 shadow-xs font-bold border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bagi Rata ({splitCount}x)
            </button>
            <button
              type="button"
              onClick={() => { setBillMode('partial'); setErrorMsg(null); }}
              className={`py-2 px-2 rounded-lg transition text-center cursor-pointer ${
                billMode === 'partial'
                  ? 'bg-white text-slate-950 shadow-xs font-bold border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cicil / DP
            </button>
          </div>

          {/* Sub-Mode Configurations */}
          {billMode === 'split_item' && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Pilih Menu yang Dibayar pada Sub-Bill Ini:</span>
                <span className="text-slate-500 font-normal">
                  {selectedItemIds.size} dari {cartItems.length} item dipilih
                </span>
              </div>
              
              {cartItems.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">Daftar item pesanan tidak tersedia.</div>
              ) : (
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                  {cartItems.map((item) => {
                    const isChecked = selectedItemIds.has(item.id)
                    const itemTotal = item.price * item.quantity
                    return (
                      <label
                        key={item.id}
                        className={`px-3 py-2 flex items-center justify-between text-xs cursor-pointer transition ${
                          isChecked ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const next = new Set(selectedItemIds)
                              if (e.target.checked) next.add(item.id)
                              else next.delete(item.id)
                              setSelectedItemIds(next)
                              setErrorMsg(null)
                            }}
                            className="w-4 h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer"
                          />
                          <div>
                            <span className="text-slate-900">{item.name}</span>
                            {item.variantName && (
                              <span className="text-[10px] text-slate-500 ml-1.5">({item.variantName})</span>
                            )}
                            <span className="text-[10px] text-slate-400 ml-1.5">x{item.quantity}</span>
                          </div>
                        </div>
                        <span className="font-mono text-slate-700">{formatIDR(itemTotal)}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {billMode === 'split_equal' && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-slate-800 block">Bagi Rata Tagihan ke Berapa Orang?</span>
                <span className="text-slate-500 text-[11px]">
                  Total {formatIDR(grandTotal)} dibagi rata @ {formatIDR(activeBillTarget)} per orang
                </span>
              </div>
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setSplitCount((prev) => Math.max(2, prev - 1))}
                  className="w-7 h-7 flex items-center justify-center font-bold text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                >
                  -
                </button>
                <span className="font-mono font-bold text-sm px-2 text-slate-900">{splitCount}</span>
                <button
                  type="button"
                  onClick={() => setSplitCount((prev) => Math.min(20, prev + 1))}
                  className="w-7 h-7 flex items-center justify-center font-bold text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {billMode === 'partial' && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
              <label className="font-bold text-slate-800 block">
                Nominal Uang Muka / Cicilan yang Dibayar Hari Ini (Rp):
              </label>
              <input
                type="text"
                value={partialAmountInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, '')
                  setPartialAmountInput(raw)
                  setErrorMsg(null)
                }}
                placeholder="Masukkan nominal DP..."
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-base font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          )}

          {/* Grand Total & Active Bill Status Banner */}
          <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="uppercase tracking-wider font-semibold">Total Seluruh Pesanan:</span>
              <span className="font-mono text-sm font-bold text-slate-100">{formatIDR(grandTotal)}</span>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-baseline justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
                  {billMode === 'full' ? 'Nominal Tagihan Saat Ini:' : 'Porsi yang Dibayar Sekarang:'}
                </span>
                <span className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight">
                  {formatIDR(activeBillTarget)}
                </span>
              </div>

              {unpaidOutsideBill > 0 && (
                <div className="text-right">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    Sisa Piutang (Belum Lunas)
                  </span>
                  <div className="text-sm font-mono font-bold text-rose-400 mt-1">
                    {formatIDR(unpaidOutsideBill)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section: Tender Lines (Metode & Akun Kas & Bank) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Metode Pembayaran (Split Tender)
              </span>
              <button
                type="button"
                onClick={handleAddTenderLine}
                className="text-xs font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition cursor-pointer"
              >
                + Tambah Pembayaran (Split)
              </button>
            </div>

            <div className="space-y-3">
              {tenderLines.map((line, idx) => {
                const isCash = isAccountCash(line.accountId, line.tenderId)
                const currentAcc = cashBankAccounts.find((a) => a.id === line.accountId)
                const activeTender = tenderOptions.find((t) => t.id === line.tenderId || t.account_id === line.accountId)
                const cashChange = isCash ? Math.max(0, line.cashReceived - line.amount) : 0
                const isCashShort = isCash && line.cashReceived < line.amount

                const categoryIcons: Record<string, string> = {
                  cash: '💵',
                  qris: '📱',
                  bank: '🏦',
                  edc: '💳'
                }

                return (
                  <div
                    key={line.id}
                    className="p-3.5 border border-slate-200 rounded-xl bg-white space-y-3 shadow-2xs"
                  >
                    {/* Tender Header: Quick Method Buttons & Delete */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                          Pembayaran #{idx + 1} — Pilih Metode:
                        </label>
                        {tenderLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveTenderLine(line.id)}
                            className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-0.5 rounded hover:bg-rose-50 transition cursor-pointer"
                            title="Hapus baris pembayaran ini"
                          >
                            ✕ Hapus
                          </button>
                        )}
                      </div>

                      {/* Quick Tender Buttons (1-Click Cashier Ergonomics) */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {tenderOptions.map((t) => {
                          const isSelected = line.accountId === t.account_id && (!line.tenderId || line.tenderId === t.id)

                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => handleSelectTenderForLine(line.id, t)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                                isSelected
                                  ? 'bg-blue-600 text-white shadow-xs'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                              }`}
                            >
                              <span>{categoryIcons[t.category] || '💳'}</span>
                              <span>{t.name}</span>
                            </button>
                          )
                        })}
                      </div>

                      {/* Explicit Drawer & Account Badge */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] px-1 text-slate-500 gap-1 pt-0.5">
                        {isCash ? (
                          <span className="text-emerald-700 font-bold flex items-center gap-1">
                            <span>💵</span>
                            <span>Uang Fisik Masuk Laci Kasir (Shift Aktif)</span>
                          </span>
                        ) : (
                          <span className="text-blue-700 font-semibold flex items-center gap-1">
                            <span>📱</span>
                            <span>Non-Tunai • Rekening Bank Toko (Tanpa Kas di Laci)</span>
                          </span>
                        )}

                        <span className="text-[10px] text-slate-400">
                          Akun Buku Besar: [{currentAcc?.code || activeTender?.account_code || '101xxx'}] {currentAcc?.name || activeTender?.name}
                        </span>
                      </div>
                    </div>

                    {/* Nominal Input & Cash Handling */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                          Nominal yang Dibayar (Rp):
                        </label>
                        <input
                          type="text"
                          value={line.amount > 0 ? String(line.amount) : ''}
                          onChange={(e) => {
                            const raw = Number(e.target.value.replace(/\D/g, '')) || 0
                            handleUpdateLine(line.id, {
                              amount: raw,
                              cashReceived: isCash ? Math.max(line.cashReceived, raw) : raw
                            })
                          }}
                          placeholder="0"
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                      </div>

                      {isCash ? (
                        <div>
                          <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                            Uang Tunai Diterima (Rp):
                          </label>
                          <input
                            type="text"
                            value={line.cashReceived > 0 ? String(line.cashReceived) : ''}
                            onChange={(e) => {
                              const raw = Number(e.target.value.replace(/\D/g, '')) || 0
                              handleUpdateLine(line.id, { cashReceived: raw })
                            }}
                            placeholder="0"
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                            No. Referensi / Trace (Opsional):
                          </label>
                          <input
                            type="text"
                            value={line.referenceNumber}
                            onChange={(e) => handleUpdateLine(line.id, { referenceNumber: e.target.value })}
                            placeholder="Contoh: REF-109284..."
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                      )}
                    </div>

                    {/* Quick Cash Amounts & Kembalian */}
                    {isCash && (
                      <div className="space-y-2 pt-1 border-t border-slate-100">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-slate-500 font-semibold mr-1">Nominal Cepat:</span>
                          {getQuickAmounts(line.amount).map((amt, qIdx) => (
                            <button
                              key={qIdx}
                              type="button"
                              onClick={() => handleUpdateLine(line.id, { cashReceived: amt })}
                              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border transition cursor-pointer ${
                                line.cashReceived === amt
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {amt === line.amount ? 'Uang Pas' : formatIDR(amt)}
                            </button>
                          ))}
                        </div>

                        <div className={`p-2 rounded-lg flex items-center justify-between text-xs font-semibold ${
                          isCashShort
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}>
                          <span>{isCashShort ? 'Uang Tunai Masih Kurang:' : 'Kembalian Diserahkan:'}</span>
                          <span className="font-mono font-bold text-sm">
                            {isCashShort ? `- ${formatIDR(line.amount - line.cashReceived)}` : formatIDR(cashChange)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Validation Error Banner */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Modal Footer (Settlement Actions) */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-600 w-full sm:w-auto flex items-center justify-between sm:block">
            <span>Total yang Dialokasikan: </span>
            <span className="font-mono font-bold text-slate-900 ml-1">
              {formatIDR(totalTenderAmount)}
            </span>
            {totalTenderAmount < activeBillTarget && (
              <span className="text-rose-600 font-semibold text-[11px] ml-2 block sm:inline">
                (Kurang {formatIDR(activeBillTarget - totalTenderAmount)})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || totalTenderAmount <= 0}
              className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-xs font-bold text-white transition shadow-sm cursor-pointer ${
                isSubmitting || totalTenderAmount <= 0
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-slate-950 hover:bg-slate-800'
              }`}
            >
              {isSubmitting ? 'Memproses...' : `Selesaikan Pembayaran (${formatIDR(totalTenderAmount)})`}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  )
}
