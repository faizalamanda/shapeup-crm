"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { resolveBusinessTenders, type POSTender } from '@/lib/pos/tenderResolver'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

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
  // 1. Bill Management State
  const initialMode = defaultMode === 'split' ? 'split_equal' : (defaultMode as any)
  const [billMode, setBillMode] = useState<'full' | 'split_item' | 'split_equal' | 'partial'>(initialMode)

  // Split by Item selection: IDs of items covered in Sub-Bill 1
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())

  // Split Equal: Count of people to divide bill
  const [splitCount, setSplitCount] = useState<number>(2)

  // Partial: Custom down payment amount input
  const [partialAmountInput, setPartialAmountInput] = useState<string>('')

  // Mobile accordion state for order details ticket
  const [showMobileReceipt, setShowMobileReceipt] = useState<boolean>(false)

  // 2. Cash & Bank Accounts (Chart of Accounts)
  const [fetchedAccounts, setFetchedAccounts] = useState<CashBankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false)

  // 3. Multi-Tender Lines (Split Tender)
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([])

  // 4. On-Screen Touch Numpad Active Focus
  const [activeKeypadTarget, setActiveKeypadTarget] = useState<{
    lineId: string
    field: 'amount' | 'cashReceived'
  }>({ lineId: 'line-1', field: 'cashReceived' })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setBillMode(defaultMode === 'split' ? 'split_equal' : (defaultMode as any))
      setErrorMsg(null)
      setIsSubmitting(false)
      setSplitCount(2)
      setPartialAmountInput(String(Math.floor(grandTotal / 2)))
      setShowMobileReceipt(false)

      if (cartItems.length > 0) {
        setSelectedItemIds(new Set([cartItems[0].id]))
      } else {
        setSelectedItemIds(new Set())
      }

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
      setActiveKeypadTarget({ lineId: 'line-1', field: 'cashReceived' })
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
    setActiveKeypadTarget({
      lineId,
      field: isCash ? 'cashReceived' : 'amount'
    })
  }

  // Add tender line (Split Tender)
  const handleAddTenderLine = () => {
    const unallocated = Math.max(0, activeBillTarget - totalTenderAmount)
    const usedAccIds = new Set(tenderLines.map((l) => l.accountId))
    const candidateTender = tenderOptions.find((t) => !usedAccIds.has(t.account_id)) || tenderOptions[1] || tenderOptions[0]
    const candidateAcc = candidateTender
      ? cashBankAccounts.find((a) => a.id === candidateTender.account_id)
      : cashBankAccounts[1] || cashBankAccounts[0]

    const newLineId = 'line-' + Date.now()
    const isCash = candidateTender ? candidateTender.category === 'cash' : false

    setTenderLines((prev) => [
      ...prev,
      {
        id: newLineId,
        tenderId: candidateTender?.id,
        accountId: candidateTender?.account_id || candidateAcc?.id || 'default-pos-bank',
        amount: unallocated,
        cashReceived: unallocated,
        referenceNumber: ''
      }
    ])
    setActiveKeypadTarget({
      lineId: newLineId,
      field: isCash ? 'cashReceived' : 'amount'
    })
  }

  // Remove tender line
  const handleRemoveTenderLine = (id: string) => {
    if (tenderLines.length <= 1) return
    setTenderLines((prev) => {
      const remaining = prev.filter((l) => l.id !== id)
      if (activeKeypadTarget.lineId === id && remaining.length > 0) {
        const firstRemaining = remaining[0]
        const isCash = isAccountCash(firstRemaining.accountId, firstRemaining.tenderId)
        setActiveKeypadTarget({
          lineId: firstRemaining.id,
          field: isCash ? 'cashReceived' : 'amount'
        })
      }
      return remaining
    })
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

  // Toast On-Screen Numpad Click Handler
  const handleNumpadPress = (val: string) => {
    const line = tenderLines.find((l) => l.id === activeKeypadTarget.lineId) || tenderLines[0]
    if (!line) return

    const isCash = isAccountCash(line.accountId, line.tenderId)
    const currentNum = activeKeypadTarget.field === 'cashReceived' ? line.cashReceived : line.amount
    let newNum = 0

    if (val === 'C') {
      newNum = 0
    } else if (val === 'BACK') {
      const s = String(currentNum || 0)
      newNum = s.length > 1 ? Number(s.slice(0, -1)) : 0
    } else if (val === '000') {
      if (currentNum > 0) {
        const s = String(currentNum) + '000'
        newNum = Number(s)
      }
    } else {
      const s = currentNum === 0 ? val : String(currentNum) + val
      newNum = Number(s)
    }

    // Safety guard against numeric overflow
    if (newNum > 1_000_000_000) return

    if (activeKeypadTarget.field === 'cashReceived') {
      handleUpdateLine(line.id, { cashReceived: newNum })
    } else {
      handleUpdateLine(line.id, {
        amount: newNum,
        cashReceived: isCash ? Math.max(line.cashReceived, newNum) : newNum
      })
    }
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

    ;[20000, 50000, 100000, 200000, 500000].forEach((val: number) => {
      if (val >= target && !amounts.includes(val)) amounts.push(val)
    })

    return amounts.slice(0, 5)
  }

  // Execution: Submit payment
  const handleConfirm = async () => {
    setErrorMsg(null)

    if (totalTenderAmount <= 0) {
      setErrorMsg('Total alokasi pembayaran harus lebih besar dari Rp 0.')
      return
    }

    if (hasInsufficientCashLine) {
      setErrorMsg('Terdapat baris pembayaran tunai dengan uang diterima yang kurang dari nominal tagihan.')
      return
    }

    if (billMode === 'split_item' && activeBillTarget <= 0) {
      setErrorMsg('Pilih minimal satu menu untuk dibayar pada sub-bill ini.')
      return
    }

    const effectivePaid = totalTenderAmount
    const isPartialOrder = effectivePaid < grandTotal

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

  // Active line for keypad focus
  const activeLine = useMemo(() => {
    return tenderLines.find((l) => l.id === activeKeypadTarget.lineId) || tenderLines[0]
  }, [tenderLines, activeKeypadTarget.lineId])

  const isActiveLineCash = activeLine ? isAccountCash(activeLine.accountId, activeLine.tenderId) : false

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="fullscreen"
      className="sm:!h-[100dvh] sm:!max-h-none sm:!rounded-none bg-slate-100"
      contentClassName="p-3 sm:p-5 lg:p-6"
      title={
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-black text-slate-950 text-base sm:text-lg tracking-tight">
            {title || 'Pembayaran Kasir'}
          </span>
          {activeShift && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-300">
              Shift Kasir Aktif
            </span>
          )}
          {unpaidOutsideBill > 0 && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
              Sisa Piutang: {formatIDR(unpaidOutsideBill)}
            </span>
          )}
        </div>
      }
      description={
        subtitle || (
          <span className="text-xs text-slate-500 font-medium">
            Terminal Pembayaran Terpadu (Toast POS Workstation) • {cartItems.length} menu dipesan
          </span>
        )
      }
      footer={
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
          {/* Summary Indicator */}
          <div className="w-full sm:w-auto flex items-center justify-between sm:gap-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block">
                Total Dialokasikan:
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xl sm:text-2xl font-black text-slate-950 tracking-tight">
                  {formatIDR(totalTenderAmount)}
                </span>
                <span className="text-xs text-slate-500 font-semibold">
                  / {formatIDR(activeBillTarget)}
                </span>
              </div>
            </div>

            {totalTenderAmount < activeBillTarget && (
              <span className="px-2 py-1 rounded-md text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                Kurang {formatIDR(activeBillTarget - totalTenderAmount)}
              </span>
            )}
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 sm:flex-none px-5 py-3 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || totalTenderAmount <= 0}
              className={`flex-2 sm:flex-none px-7 py-3 rounded-xl text-sm font-black text-white transition shadow-md cursor-pointer flex items-center justify-center gap-2 ${
                isSubmitting || totalTenderAmount <= 0
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
              }`}
            >
              {isSubmitting ? (
                <span>Memproses Transaksi...</span>
              ) : (
                <>
                  <span>Selesaikan Pembayaran</span>
                  <span className="font-mono text-emerald-100 text-xs sm:text-sm">
                    ({formatIDR(totalTenderAmount)})
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      {/* TOAST POS 2-COLUMN IMMERSIVE WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
        
        {/* ========================================================= */}
        {/* KOLOM KIRI (Toast Ticket & Split Bill): lg:col-span-5     */}
        {/* ========================================================= */}
        <div className="lg:col-span-5 space-y-4 order-2 lg:order-1">
          
          {/* Bill Mode Selector (Bayar Penuh, Split Item, Bagi Rata, DP) */}
          <div className="bg-white p-1.5 rounded-2xl border border-slate-200/90 shadow-xs">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
              Mode Tagihan (Split Bill)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => { setBillMode('full'); setErrorMsg(null); }}
                className={`py-2 px-2 rounded-xl transition text-center cursor-pointer ${
                  billMode === 'full'
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                Bayar Penuh
              </button>
              <button
                type="button"
                onClick={() => { setBillMode('split_item'); setErrorMsg(null); }}
                className={`py-2 px-2 rounded-xl transition text-center cursor-pointer ${
                  billMode === 'split_item'
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                Pecah Menu
              </button>
              <button
                type="button"
                onClick={() => { setBillMode('split_equal'); setErrorMsg(null); }}
                className={`py-2 px-2 rounded-xl transition text-center cursor-pointer ${
                  billMode === 'split_equal'
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                Bagi Rata ({splitCount}x)
              </button>
              <button
                type="button"
                onClick={() => { setBillMode('partial'); setErrorMsg(null); }}
                className={`py-2 px-2 rounded-xl transition text-center cursor-pointer ${
                  billMode === 'partial'
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                Cicil / DP
              </button>
            </div>
          </div>

          {/* Sub-Mode Configurations (Split details) */}
          {billMode === 'split_item' && (
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>Pilih Menu untuk Sub-Bill Ini:</span>
                <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                  {selectedItemIds.size} dari {cartItems.length} menu dipilih
                </span>
              </div>
              
              {cartItems.length === 0 ? (
                <div className="text-xs text-slate-400 py-3 text-center">Daftar item pesanan kosong.</div>
              ) : (
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-slate-50/50">
                  {cartItems.map((item) => {
                    const isChecked = selectedItemIds.has(item.id)
                    const itemTotal = item.price * item.quantity
                    return (
                      <label
                        key={item.id}
                        className={`px-3 py-2.5 flex items-center justify-between text-xs cursor-pointer transition ${
                          isChecked ? 'bg-white font-bold text-slate-950 shadow-2xs' : 'hover:bg-slate-100/70 text-slate-600'
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
                            className="w-4 h-4 rounded text-slate-950 border-slate-300 focus:ring-slate-950 cursor-pointer"
                          />
                          <div>
                            <span className="block leading-tight">{item.name}</span>
                            {item.variantName && (
                              <span className="text-[10px] text-slate-400 font-normal">({item.variantName})</span>
                            )}
                            <span className="text-[10px] text-slate-400 font-mono ml-1 font-normal">x{item.quantity}</span>
                          </div>
                        </div>
                        <span className="font-mono font-bold text-slate-900">{formatIDR(itemTotal)}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {billMode === 'split_equal' && (
            <div className="p-4 bg-white border border-slate-200 rounded-2xl flex items-center justify-between shadow-xs">
              <div>
                <span className="font-bold text-slate-900 text-xs sm:text-sm block">Bagi Rata Tagihan</span>
                <span className="text-slate-500 text-[11px] block mt-0.5">
                  {formatIDR(grandTotal)} dibagi {splitCount} orang = <b className="text-slate-900">{formatIDR(activeBillTarget)}</b> / orang
                </span>
              </div>
              <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setSplitCount((prev) => Math.max(2, prev - 1))}
                  className="w-8 h-8 flex items-center justify-center font-black text-slate-700 hover:bg-white rounded-lg cursor-pointer transition shadow-2xs"
                >
                  -
                </button>
                <span className="font-mono font-black text-sm px-2 text-slate-950">{splitCount}</span>
                <button
                  type="button"
                  onClick={() => setSplitCount((prev) => Math.min(20, prev + 1))}
                  className="w-8 h-8 flex items-center justify-center font-black text-slate-700 hover:bg-white rounded-lg cursor-pointer transition shadow-2xs"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {billMode === 'partial' && (
            <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-2 shadow-xs">
              <label className="font-bold text-slate-900 text-xs block">
                Nominal Uang Muka / Cicilan Hari Ini (Rp):
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
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-base font-mono font-bold text-slate-950 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-950"
              />
            </div>
          )}

          {/* Toast Digital Receipt Ticket Preview */}
          <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  🧾 Rincian Pesanan
                </span>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-full">
                  {cartItems.length} Item
                </span>
              </div>

              {/* Mobile Toggle */}
              <button
                type="button"
                onClick={() => setShowMobileReceipt((prev) => !prev)}
                className="lg:hidden text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                {showMobileReceipt ? 'Sembunyikan ▲' : 'Buka Rincian ▼'}
              </button>
            </div>

            {/* List of ordered items (Always visible on Desktop/Tablet, Collapsible on Mobile) */}
            <div className={`${showMobileReceipt ? 'block' : 'hidden lg:block'} p-4 space-y-2 max-h-60 lg:max-h-72 overflow-y-auto divide-y divide-slate-100`}>
              {cartItems.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">Tidak ada item di keranjang.</div>
              ) : (
                cartItems.map((item) => (
                  <div key={item.id} className="pt-2 first:pt-0 flex items-center justify-between text-xs">
                    <div className="pr-3">
                      <div className="font-bold text-slate-900 leading-tight">{item.name}</div>
                      {item.variantName && (
                        <div className="text-[10px] text-slate-500">{item.variantName}</div>
                      )}
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {item.quantity} x {formatIDR(item.price)}
                      </div>
                    </div>
                    <div className="font-mono font-bold text-slate-900 shrink-0">
                      {formatIDR(item.price * item.quantity)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Ticket Calculation Footer */}
            <div className="p-4 bg-slate-900 text-white space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="font-medium">Total Pesanan:</span>
                <span className="font-mono font-bold">{formatIDR(grandTotal)}</span>
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-baseline justify-between">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                    {billMode === 'full' ? 'Nominal Tagihan Saat Ini:' : 'Porsi yang Dibayar Sekarang:'}
                  </span>
                  <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-400 tracking-tight">
                    {formatIDR(activeBillTarget)}
                  </span>
                </div>

                {unpaidOutsideBill > 0 && (
                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                      Sisa Belum Bayar
                    </span>
                    <span className="font-mono font-bold text-amber-300 text-sm">
                      {formatIDR(unpaidOutsideBill)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* ========================================================= */}
        {/* KOLOM KANAN (Toast Tender & Numpad Engine): lg:col-span-7  */}
        {/* ========================================================= */}
        <div className="lg:col-span-7 space-y-4 order-1 lg:order-2">

          {/* Quick Tender Method Grid (Toast 1-Click Cashier Ergonomics) */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  Pilih Metode Pembayaran
                </span>
                <span className="text-[11px] text-slate-500">
                  {tenderLines.length > 1 ? `Split Tender aktif (${tenderLines.length} baris pembayaran)` : 'Pilih metode untuk kasir'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleAddTenderLine}
                className="text-xs font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5"
              >
                <span>+ Tambah Pembayaran (Split)</span>
              </button>
            </div>

            {/* Tender Buttons Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {tenderOptions.map((t) => {
                const categoryIcons: Record<string, string> = {
                  cash: '💵',
                  qris: '📱',
                  bank: '🏦',
                  edc: '💳'
                }

                const isSelected = activeLine?.accountId === t.account_id && (!activeLine?.tenderId || activeLine?.tenderId === t.id)

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectTenderForLine(activeLine?.id || 'line-1', t)}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between min-h-[64px] ${
                      isSelected
                        ? 'bg-slate-950 text-white border-slate-950 shadow-md ring-2 ring-slate-950/20'
                        : 'bg-slate-50 text-slate-800 border-slate-200/80 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg">{categoryIcons[t.category] || '💳'}</span>
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      )}
                    </div>
                    <div>
                      <div className="font-extrabold text-xs leading-tight mt-1">{t.name}</div>
                      <div className={`text-[10px] mt-0.5 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {t.category === 'cash' ? 'Uang Masuk Laci' : 'Rekening Bank'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Active Tender Lines Breakdown */}
          <div className="space-y-3">
            {tenderLines.map((line, idx) => {
              const isCash = isAccountCash(line.accountId, line.tenderId)
              const currentAcc = cashBankAccounts.find((a) => a.id === line.accountId)
              const activeTender = tenderOptions.find((t) => t.id === line.tenderId || t.account_id === line.accountId)
              const cashChange = isCash ? Math.max(0, line.cashReceived - line.amount) : 0
              const isCashShort = isCash && line.cashReceived < line.amount
              const isLineActive = activeKeypadTarget.lineId === line.id

              return (
                <div
                  key={line.id}
                  className={`p-4 rounded-2xl border transition bg-white shadow-xs space-y-3.5 ${
                    isLineActive ? 'border-slate-950 ring-1 ring-slate-950/10' : 'border-slate-200'
                  }`}
                  onClick={() => {
                    if (activeKeypadTarget.lineId !== line.id) {
                      setActiveKeypadTarget({
                        lineId: line.id,
                        field: isCash ? 'cashReceived' : 'amount'
                      })
                    }
                  }}
                >
                  {/* Line Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-800">
                        Pembayaran #{idx + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        {activeTender?.name || currentAcc?.name || (isCash ? 'Tunai (Laci Kasir)' : 'Non-Tunai')}
                      </span>
                      {isCash ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          💵 Laci Kasir
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                          📱 Rekening Bank
                        </span>
                      )}
                    </div>

                    {tenderLines.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTenderLine(line.id)
                        }}
                        className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-0.5 rounded hover:bg-rose-50 transition cursor-pointer"
                      >
                        ✕ Hapus
                      </button>
                    )}
                  </div>

                  {/* Nominal Inputs (Active field has glowing border for Numpad) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Nominal yang Dibayar (Rp):
                      </label>
                      <div
                        onClick={() => setActiveKeypadTarget({ lineId: line.id, field: 'amount' })}
                        className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                          activeKeypadTarget.lineId === line.id && activeKeypadTarget.field === 'amount'
                            ? 'border-blue-600 ring-2 ring-blue-500/20 bg-blue-50/20'
                            : 'border-slate-300 bg-slate-50'
                        }`}
                      >
                        <span className="font-mono text-base font-black text-slate-950">
                          {formatIDR(line.amount)}
                        </span>
                        {activeKeypadTarget.lineId === line.id && activeKeypadTarget.field === 'amount' && (
                          <span className="text-[10px] font-bold text-blue-700 uppercase bg-blue-100 px-1.5 py-0.5 rounded">
                            Numpad Aktif
                          </span>
                        )}
                      </div>
                    </div>

                    {isCash ? (
                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1">
                          Uang Tunai Diterima (Rp):
                        </label>
                        <div
                          onClick={() => setActiveKeypadTarget({ lineId: line.id, field: 'cashReceived' })}
                          className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                            activeKeypadTarget.lineId === line.id && activeKeypadTarget.field === 'cashReceived'
                              ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/20'
                              : 'border-slate-300 bg-slate-50'
                          }`}
                        >
                          <span className="font-mono text-base font-black text-slate-950">
                            {formatIDR(line.cashReceived)}
                          </span>
                          {activeKeypadTarget.lineId === line.id && activeKeypadTarget.field === 'cashReceived' && (
                            <span className="text-[10px] font-bold text-emerald-800 uppercase bg-emerald-100 px-1.5 py-0.5 rounded">
                              Numpad Aktif
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1">
                          No. Referensi / Trace (Opsional):
                        </label>
                        <input
                          type="text"
                          value={line.referenceNumber}
                          onChange={(e) => handleUpdateLine(line.id, { referenceNumber: e.target.value })}
                          placeholder="Contoh: REF-109284..."
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-950"
                        />
                      </div>
                    )}
                  </div>

                  {/* Quick Cash Chips (Instant Denomination Buttons) */}
                  {isCash && (
                    <div className="space-y-2 pt-1 border-t border-slate-100">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-bold uppercase mr-1">
                          Pecahan Cepat:
                        </span>
                        {getQuickAmounts(line.amount).map((amt, qIdx) => (
                          <button
                            key={qIdx}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleUpdateLine(line.id, { cashReceived: amt })
                              setActiveKeypadTarget({ lineId: line.id, field: 'cashReceived' })
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                              line.cashReceived === amt
                                ? 'bg-slate-950 text-white border-slate-950 shadow-xs'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-200/70'
                            }`}
                          >
                            {amt === line.amount ? 'Uang Pas' : formatIDR(amt)}
                          </button>
                        ))}
                      </div>

                      {/* Toast Kembalian Banner */}
                      <div
                        className={`p-3 rounded-xl flex items-center justify-between text-xs font-bold transition ${
                          isCashShort
                            ? 'bg-rose-50 text-rose-800 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-900 border border-emerald-300 shadow-2xs'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{isCashShort ? '⚠️' : '💰'}</span>
                          <span>{isCashShort ? 'Uang Tunai Masih Kurang:' : 'Kembalian Diserahkan Kasir:'}</span>
                        </div>
                        <span className="font-mono font-black text-base sm:text-lg">
                          {isCashShort ? `- ${formatIDR(line.amount - line.cashReceived)}` : formatIDR(cashChange)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ========================================================= */}
          {/* TOAST ON-SCREEN TOUCH NUMPAD (Keypad Kasir Tablet/Mobile)  */}
          {/* ========================================================= */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <span>🔢</span>
                <span>Toast Numeric Keypad</span>
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                Target: {activeKeypadTarget.field === 'cashReceived' ? 'Uang Tunai Diterima' : 'Nominal Bayar'}
              </span>
            </div>

            {/* 4x3 Touch Grid Buttons */}
            <div className="grid grid-cols-4 gap-2 font-mono">
              {[
                { label: '1', val: '1' },
                { label: '2', val: '2' },
                { label: '3', val: '3' },
                { label: '⌫ Hapus', val: 'BACK', className: 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100 font-sans' },
                { label: '4', val: '4' },
                { label: '5', val: '5' },
                { label: '6', val: '6' },
                { label: 'C Reset', val: 'C', className: 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100 font-sans' },
                { label: '7', val: '7' },
                { label: '8', val: '8' },
                { label: '9', val: '9' },
                { label: 'Uang Pas', val: 'EXACT', className: 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100 font-sans' },
                { label: '0', val: '0' },
                { label: '00', val: '00' },
                { label: '000', val: '000', className: 'font-bold' },
                { label: '✓ Ok', val: 'DONE', className: 'bg-slate-950 text-white border-slate-950 hover:bg-slate-800 font-sans' }
              ].map((btn, bIdx) => (
                <button
                  key={bIdx}
                  type="button"
                  onClick={() => {
                    if (btn.val === 'EXACT') {
                      if (activeLine) {
                        handleUpdateLine(activeLine.id, { cashReceived: activeLine.amount })
                      }
                    } else if (btn.val === '00') {
                      handleNumpadPress('0')
                      handleNumpadPress('0')
                    } else if (btn.val === 'DONE') {
                      // Ok confirmation
                    } else {
                      handleNumpadPress(btn.val)
                    }
                  }}
                  className={`h-12 sm:h-14 rounded-xl text-base sm:text-lg font-black transition cursor-pointer flex items-center justify-center active:scale-97 select-none border ${
                    btn.className || 'bg-slate-50 hover:bg-slate-100 text-slate-950 border-slate-200'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Validation Error Banner */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center gap-2">
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

        </div>

      </div>
    </FullScreenModal>
  )
}
