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
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [splitCount, setSplitCount] = useState<number>(2)
  const [partialAmountInput, setPartialAmountInput] = useState<string>('')

  // 2. Modals Popups (Agar layar utama ZERO-SCROLL)
  const [isSplitBillModalOpen, setIsSplitBillModalOpen] = useState(false)
  const [isSplitTenderModalOpen, setIsSplitTenderModalOpen] = useState(false)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)

  // 3. Accounts & Tenders State
  const [fetchedAccounts, setFetchedAccounts] = useState<CashBankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false)
  const [fetchedCustomTenders, setFetchedCustomTenders] = useState<POSTender[] | null>(null)

  // 4. Multi-Tender Lines
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([])

  // 5. Active Keypad Target (Amount or Cash Received)
  const [activeKeypadField, setActiveKeypadField] = useState<'amount' | 'cashReceived'>('cashReceived')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Fetch Accounts
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

  // Fetch Custom Tenders
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

  // Filtered Cash & Bank Accounts
  const cashBankAccounts = useMemo(() => {
    const list = fetchedAccounts.filter(
      (a) => a.type === 'ASSET' && (a.code?.startsWith('101') || a.sub_type === 'bank_cash')
    )
    if (list.length > 0) return list
    return [
      { id: 'default-pos-cash', code: '101000', name: 'Kas Laci POS (Tunai)', type: 'ASSET' },
      { id: 'default-pos-bank', code: '101200', name: 'Bank / QRIS POS', type: 'ASSET' },
      { id: 'default-main-bank', code: '101100', name: 'Kas / Bank Utama', type: 'ASSET' }
    ]
  }, [fetchedAccounts])

  // Resolved Tenders
  const tenderOptions = useMemo(() => {
    return resolveBusinessTenders({
      accounts: cashBankAccounts,
      customTenders: propCustomTenders || fetchedCustomTenders,
      activeRegisterAccountId
    })
  }, [cashBankAccounts, propCustomTenders, fetchedCustomTenders, activeRegisterAccountId])

  // Helper cash check
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

  // Method string helper
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

  // Active target based on bill mode
  const activeBillTarget = useMemo(() => {
    if (billMode === 'full') return grandTotal
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

  const unpaidOutsideBill = useMemo(() => {
    return Math.max(0, grandTotal - activeBillTarget)
  }, [grandTotal, activeBillTarget])

  // Initialize
  useEffect(() => {
    if (isOpen) {
      setBillMode(defaultMode === 'split' ? 'split_equal' : (defaultMode as any))
      setErrorMsg(null)
      setIsSubmitting(false)
      setSplitCount(2)
      setPartialAmountInput(String(Math.floor(grandTotal / 2)))

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
      setActiveKeypadField('cashReceived')
    }
  }, [isOpen, grandTotal, defaultMode, tenderOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync line 1 with bill target
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

  // Calculations
  const totalTenderAmount = useMemo(() => {
    return tenderLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  }, [tenderLines])

  const totalCashReceived = useMemo(() => {
    return tenderLines.reduce((sum, line) => {
      if (isAccountCash(line.accountId)) {
        return sum + (Number(line.cashReceived) || Number(line.amount) || 0)
      }
      return sum + (Number(line.amount) || 0)
    }, 0)
  }, [tenderLines, isAccountCash])

  const totalChangeAmount = useMemo(() => {
    let change = 0
    tenderLines.forEach((line) => {
      if (isAccountCash(line.accountId)) {
        const received = Number(line.cashReceived) || 0
        const amt = Number(line.amount) || 0
        if (received > amt) change += (received - amt)
      }
    })
    return change
  }, [tenderLines, isAccountCash])

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

  // Active primary tender line
  const activeLine = tenderLines[0] || {
    id: 'line-1',
    accountId: 'default-pos-cash',
    amount: activeBillTarget,
    cashReceived: activeBillTarget,
    referenceNumber: ''
  }
  const isPrimaryCash = isAccountCash(activeLine.accountId, activeLine.tenderId)

  // Select tender for primary line
  const handleSelectPrimaryTender = (tender: POSTender) => {
    const isCash = tender.category === 'cash'
    setTenderLines((prev) => {
      const updated = [...prev]
      if (updated[0]) {
        const curAmt = updated[0].amount || activeBillTarget
        updated[0] = {
          ...updated[0],
          tenderId: tender.id,
          accountId: tender.account_id,
          cashReceived: isCash ? Math.max(curAmt, updated[0].cashReceived || curAmt) : curAmt,
          referenceNumber: isCash ? '' : updated[0].referenceNumber
        }
      }
      return updated
    })
    setActiveKeypadField(isCash ? 'cashReceived' : 'amount')
  }

  // Update line helper
  const handleUpdateLine = (id: string, updates: Partial<TenderLine>) => {
    setTenderLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...updates } : l))
    )
    setErrorMsg(null)
  }

  // Toast Numpad Press Handler
  const handleNumpadPress = (val: string) => {
    if (!activeLine) return
    const isCash = isPrimaryCash
    const currentNum = activeKeypadField === 'cashReceived' ? activeLine.cashReceived : activeLine.amount
    let newNum = 0

    if (val === 'C') {
      newNum = 0
    } else if (val === 'BACK') {
      const s = String(currentNum || 0)
      newNum = s.length > 1 ? Number(s.slice(0, -1)) : 0
    } else if (val === '00') {
      if (currentNum > 0) newNum = Number(String(currentNum) + '00')
    } else if (val === '000') {
      if (currentNum > 0) newNum = Number(String(currentNum) + '000')
    } else {
      const s = currentNum === 0 ? val : String(currentNum) + val
      newNum = Number(s)
    }

    if (newNum > 2_000_000_000) return

    if (activeKeypadField === 'cashReceived') {
      handleUpdateLine(activeLine.id, { cashReceived: newNum })
    } else {
      handleUpdateLine(activeLine.id, {
        amount: newNum,
        cashReceived: isCash ? Math.max(activeLine.cashReceived, newNum) : newNum
      })
    }
  }

  // Quick denomination suggestions for cash
  const quickCashOptions = useMemo(() => {
    const target = activeBillTarget
    const list: number[] = [target]
    const rounded10 = Math.ceil(target / 10000) * 10000
    const rounded50 = Math.ceil(target / 50000) * 50000
    const rounded100 = Math.ceil(target / 100000) * 100000

    if (rounded10 > target && !list.includes(rounded10)) list.push(rounded10)
    if (rounded50 > target && !list.includes(rounded50)) list.push(rounded50)
    if (rounded100 > target && !list.includes(rounded100)) list.push(rounded100);

    ;[50000, 100000, 200000, 500000].forEach((v) => {
      if (v > target && !list.includes(v)) list.push(v)
    })

    return list.slice(0, 3)
  }, [activeBillTarget])

  // Submit payment
  const handleConfirm = async () => {
    setErrorMsg(null)
    if (totalTenderAmount <= 0) {
      setErrorMsg('Total alokasi pembayaran harus lebih besar dari Rp 0.')
      return
    }
    if (hasInsufficientCashLine) {
      setErrorMsg('Uang tunai diterima masih kurang dari nominal tagihan.')
      return
    }
    if (billMode === 'split_item' && activeBillTarget <= 0) {
      setErrorMsg('Pilih minimal satu menu pada sub-bill ini.')
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

    const primaryMethod = payloadItems.length > 1 ? 'split' : (payloadItems[0]?.method || 'cash')
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

  // Tender Icons mapped
  const getTenderIcon = (category: string) => {
    switch (category) {
      case 'cash': return '💵'
      case 'qris': return '📱'
      case 'bank': return '🏦'
      case 'edc': return '💳'
      default: return '💳'
    }
  }

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="fullscreen"
      showCloseButton={false}
      className="sm:!h-[100dvh] sm:!max-h-none sm:!rounded-none !bg-[#121316] !text-white border-none select-none"
      contentClassName="!p-0 !overflow-hidden flex flex-col h-full"
      title={null}
    >
      {/* WRAPPER ZERO-SCROLL TOAST POS (Max Width disesuaikan untuk layar besar) */}
      <div className="w-full max-w-[1440px] mx-auto h-[100dvh] flex flex-col bg-[#121316] text-white overflow-hidden p-2 sm:p-4 lg:p-5">

        {/* TOP STATUS BAR (Toast Style Header) */}
        <header className="h-10 sm:h-12 shrink-0 flex items-center justify-between border-b border-[#282a30] pb-2 px-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-8 h-8 rounded-lg bg-[#22242a] hover:bg-[#2c2f37] text-gray-300 hover:text-white flex items-center justify-center font-bold text-sm transition cursor-pointer"
              title="Kembali ke Pesanan"
            >
              ✕
            </button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm sm:text-base text-white tracking-wide">
                {title || 'Manage Payments'}
              </span>
              {activeShift && (
                <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Shift Aktif
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tombol Lihat Struk (Khusus Mobile) */}
            <button
              type="button"
              onClick={() => setIsReceiptModalOpen(true)}
              className="lg:hidden px-3 py-1.5 rounded-lg bg-[#22242a] hover:bg-[#2c2f37] text-xs font-semibold text-gray-200 border border-[#343740] flex items-center gap-1.5 cursor-pointer"
            >
              <span>🧾</span>
              <span>Rincian Menu</span>
            </button>

            {unpaidOutsideBill > 0 && (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-wider bg-amber-950/80 text-amber-300 border border-amber-700/60">
                Sisa: {formatIDR(unpaidOutsideBill)}
              </span>
            )}

            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-gray-400 hover:text-white cursor-pointer hidden sm:block"
            >
              Tutup Kasir
            </button>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* MAIN BODY 3-KOLOM (TOAST EXACT LAYOUT — ZERO SCROLL DI TABLET & MOBILE)   */}
        {/* ========================================================================= */}
        <div className="flex-1 min-h-0 pt-3 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 overflow-hidden">
          
          {/* ----------------------------------------------------------------------- */}
          {/* KOLOM 1 (KIRI ~33%): CHECK / RECEIPT SLIP & DONE BUTTON                 */}
          {/* ----------------------------------------------------------------------- */}
          <section className="hidden lg:flex lg:col-span-4 flex-col bg-[#1a1b1f] border border-[#2c2f36] rounded-xl overflow-hidden p-3.5 shadow-xl">
            {/* Ticket Header (Toast: Ch. #456, T #1234, Carla T.) */}
            <div className="shrink-0 border-b border-[#2c2f36] pb-2.5 mb-2.5 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-sm text-white tracking-tight">Ch. #01</span>
                  <span className="text-xs text-gray-400 font-mono">T #POS</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  👤 Tamu Toko • {cartItems.length} menu dipesan
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSplitBillModalOpen(true)}
                className="px-2 py-1 rounded bg-[#26282f] hover:bg-[#32353e] text-[11px] font-bold text-gray-300 border border-[#383b45] cursor-pointer"
              >
                Split Bill
              </button>
            </div>

            {/* Ticket Items List (Auto internal scroll capped inside receipt) */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 divide-y divide-[#26282e]">
              {cartItems.length === 0 ? (
                <div className="text-xs text-gray-500 py-6 text-center">Tidak ada item pesanan.</div>
              ) : (
                cartItems.map((item) => (
                  <div key={item.id} className="pt-2 first:pt-0 flex items-start justify-between text-xs">
                    <div className="pr-2">
                      <div className="font-bold text-gray-200 leading-snug">
                        {item.quantity}x {item.name}
                      </div>
                      {item.variantName && (
                        <div className="text-[10px] text-gray-400">{item.variantName}</div>
                      )}
                    </div>
                    <div className="font-mono font-bold text-gray-300 shrink-0">
                      {formatIDR(item.price * item.quantity)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Ticket Totals & Calculation */}
            <div className="shrink-0 border-t border-[#2c2f36] pt-2.5 mt-2 space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-400">
                <span>Subtotal</span>
                <span className="font-mono">{formatIDR(grandTotal)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Pajak / Biaya</span>
                <span className="font-mono">Rp 0</span>
              </div>
              <div className="flex justify-between font-bold text-gray-200 pt-1 border-t border-[#26282e]">
                <span>Total</span>
                <span className="font-mono">{formatIDR(grandTotal)}</span>
              </div>
              <div className="flex justify-between items-baseline font-black text-white pt-1">
                <span className="text-xs uppercase tracking-wider text-gray-400">Balance due</span>
                <span className="font-mono text-xl text-emerald-400">{formatIDR(activeBillTarget)}</span>
              </div>

              {/* Status Bar (Toast Green Status Bar) */}
              <div className="mt-2 p-2 rounded-lg bg-[#14261d] border border-emerald-900/60 flex items-center justify-between text-xs text-emerald-300 font-bold">
                <div className="flex items-center gap-1.5 truncate">
                  <span>{isPrimaryCash ? '💵' : '💳'}</span>
                  <span className="truncate">
                    {tenderOptions.find((t) => t.id === activeLine.tenderId)?.name || (isPrimaryCash ? 'Tunai Laci' : 'Non-Tunai')}
                  </span>
                </div>
                <span className="font-mono shrink-0">
                  {totalChangeAmount > 0 ? `Kembalian: ${formatIDR(totalChangeAmount)}` : formatIDR(activeLine.amount)}
                </span>
              </div>

              {/* BIG DONE BUTTON (Toast Check Bottom Action) */}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || totalTenderAmount <= 0}
                className={`w-full mt-2.5 py-3 rounded-xl font-black text-sm tracking-wide transition shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                  isSubmitting || totalTenderAmount <= 0
                    ? 'bg-[#2b2e35] text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'
                }`}
              >
                {isSubmitting ? 'Memproses...' : `Done (${formatIDR(totalTenderAmount)})`}
              </button>
            </div>
          </section>

          {/* ----------------------------------------------------------------------- */}
          {/* KOLOM 2 (TENGAH ~42%): NUMPAD & AMOUNTS (BALANCE DUE & AMOUNT TENDERED) */}
          {/* ----------------------------------------------------------------------- */}
          <section className="col-span-1 lg:col-span-5 flex flex-col bg-[#16171b] border border-[#2c2f36] rounded-xl p-3 sm:p-4 shadow-xl overflow-hidden justify-between">
            
            {/* Top Balance Due Title & Display Boxes */}
            <div className="shrink-0 space-y-2 mb-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg sm:text-2xl font-bold tracking-tight text-white">
                  Balance due: {formatIDR(activeBillTarget)}
                </h3>
                {billMode !== 'full' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                    Mode: {billMode === 'split_equal' ? `Bagi ${splitCount}x` : (billMode === 'split_item' ? 'Pecah Menu' : 'DP/Cicil')}
                  </span>
                )}
              </div>

              {/* Toast Display Boxes (Balance due & Amount tendered) */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {/* Box 1: Balance due (Target) */}
                <div
                  onClick={() => setActiveKeypadField('amount')}
                  className={`p-2 sm:p-2.5 rounded-xl border transition cursor-pointer ${
                    activeKeypadField === 'amount'
                      ? 'bg-[#1e2026] border-blue-500 ring-2 ring-blue-500/20'
                      : 'bg-[#1b1c20] border-[#2f323a]'
                  }`}
                >
                  <span className="text-[10px] sm:text-xs font-semibold text-gray-400 block">
                    Balance due
                  </span>
                  <div className="font-mono text-base sm:text-xl font-bold text-white truncate mt-0.5">
                    {formatIDR(activeLine.amount)}
                  </div>
                </div>

                {/* Box 2: Amount tendered (Nominal Diterima Kasir) */}
                <div
                  onClick={() => setActiveKeypadField('cashReceived')}
                  className={`p-2 sm:p-2.5 rounded-xl border transition cursor-pointer ${
                    activeKeypadField === 'cashReceived'
                      ? 'bg-[#1e2026] border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'bg-[#1b1c20] border-[#2f323a]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] sm:text-xs font-semibold text-gray-400 block">
                      Amount tendered
                    </span>
                    {activeKeypadField === 'cashReceived' && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    )}
                  </div>
                  <div className="font-mono text-base sm:text-xl font-black text-emerald-400 truncate mt-0.5">
                    {formatIDR(isPrimaryCash ? activeLine.cashReceived : activeLine.amount)}
                  </div>
                </div>
              </div>
            </div>

            {/* TOAST ON-SCREEN TOUCH NUMPAD (4x4 GRID SESUAI SCREENSHOT) */}
            <div className="flex-1 min-h-0 grid grid-cols-4 gap-2 my-1">
              {/* Row 1: 1, 2, 3, Quick Cash 1 */}
              <button
                type="button"
                onClick={() => handleNumpadPress('1')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                1
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('2')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                2
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('3')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                3
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = quickCashOptions[0] || activeBillTarget
                  handleUpdateLine(activeLine.id, { cashReceived: val })
                  setActiveKeypadField('cashReceived')
                }}
                className="rounded-xl bg-[#1d222b] hover:bg-[#252c38] text-xs sm:text-sm font-bold text-emerald-400 flex flex-col items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-800/40"
              >
                <span className="text-[9px] uppercase font-semibold text-emerald-500">Pas</span>
                <span className="font-mono">{formatIDR(quickCashOptions[0] || activeBillTarget)}</span>
              </button>

              {/* Row 2: 4, 5, 6, Quick Cash 2 */}
              <button
                type="button"
                onClick={() => handleNumpadPress('4')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                4
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('5')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                5
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('6')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                6
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = quickCashOptions[1] || activeBillTarget * 2
                  handleUpdateLine(activeLine.id, { cashReceived: val })
                  setActiveKeypadField('cashReceived')
                }}
                className="rounded-xl bg-[#1d222b] hover:bg-[#252c38] text-xs sm:text-sm font-bold text-emerald-400 flex items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-800/40 font-mono"
              >
                {formatIDR(quickCashOptions[1] || activeBillTarget * 2)}
              </button>

              {/* Row 3: 7, 8, 9, Quick Cash 3 */}
              <button
                type="button"
                onClick={() => handleNumpadPress('7')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                7
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('8')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                8
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('9')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                9
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = quickCashOptions[2] || (activeBillTarget + 50000)
                  handleUpdateLine(activeLine.id, { cashReceived: val })
                  setActiveKeypadField('cashReceived')
                }}
                className="rounded-xl bg-[#1d222b] hover:bg-[#252c38] text-xs sm:text-sm font-bold text-emerald-400 flex items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-800/40 font-mono"
              >
                {formatIDR(quickCashOptions[2] || (activeBillTarget + 50000))}
              </button>

              {/* Row 4: C, 0, 00, Backspace ⌫ */}
              <button
                type="button"
                onClick={() => handleNumpadPress('C')}
                className="rounded-xl bg-[#2c1d21] hover:bg-[#382329] text-base sm:text-xl font-bold text-rose-400 flex items-center justify-center transition active:scale-95 cursor-pointer border border-rose-900/40"
              >
                C
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('0')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-xl sm:text-3xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740]"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('000')}
                className="rounded-xl bg-[#25272e] hover:bg-[#30333c] text-base sm:text-xl font-bold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-[#343740] font-mono"
              >
                000
              </button>
              <button
                type="button"
                onClick={() => handleNumpadPress('BACK')}
                className="rounded-xl bg-[#28221b] hover:bg-[#332a21] text-lg sm:text-2xl font-bold text-amber-400 flex items-center justify-center transition active:scale-95 cursor-pointer border border-amber-900/40"
              >
                ⌫
              </button>
            </div>

            {/* Bottom Row Action Buttons (Toast: Split evenly, Rewards, Service charge) */}
            <div className="shrink-0 pt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setIsSplitBillModalOpen(true)}
                className="py-2.5 px-2 rounded-xl bg-[#202228] hover:bg-[#2a2d36] text-xs font-bold text-gray-200 border border-[#323640] flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <span>🔀</span>
                <span>Split evenly</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSplitTenderModalOpen(true)}
                className="py-2.5 px-2 rounded-xl bg-[#202228] hover:bg-[#2a2d36] text-xs font-bold text-gray-200 border border-[#323640] flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <span>💳</span>
                <span>Split Tender ({tenderLines.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  handleUpdateLine(activeLine.id, { cashReceived: activeLine.amount })
                  setActiveKeypadField('cashReceived')
                }}
                className="py-2.5 px-2 rounded-xl bg-[#1c2721] hover:bg-[#22332a] text-xs font-bold text-emerald-400 border border-emerald-900/50 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <span>💵</span>
                <span>Uang Pas</span>
              </button>
            </div>

            {/* Mobile Bottom Done Button (Visible only on mobile/tablet portrait) */}
            <div className="lg:hidden shrink-0 pt-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || totalTenderAmount <= 0}
                className={`w-full py-3.5 rounded-xl font-black text-sm tracking-wide transition shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                  isSubmitting || totalTenderAmount <= 0
                    ? 'bg-[#2b2e35] text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isSubmitting ? 'Memproses...' : `Selesaikan (${formatIDR(totalTenderAmount)})`}
              </button>
            </div>
          </section>

          {/* ----------------------------------------------------------------------- */}
          {/* KOLOM 3 (KANAN ~25%): TENDER METHODS GRID (TOAST STYLE)                 */}
          {/* ----------------------------------------------------------------------- */}
          <section className="col-span-1 lg:col-span-3 flex flex-col bg-[#16171b] border border-[#2c2f36] rounded-xl p-3 sm:p-4 shadow-xl overflow-hidden justify-between">
            <div className="shrink-0 space-y-2">
              {/* Primary Active Tender Button (Toast 3: Saved card / Active Method) */}
              <div className="p-3 rounded-xl bg-[#202838] border-2 border-blue-500 text-white flex items-center justify-between shadow-md">
                <div className="flex items-center gap-2.5 truncate">
                  <span className="text-xl">{isPrimaryCash ? '💵' : '💳'}</span>
                  <div className="truncate">
                    <div className="text-xs font-extrabold text-blue-300 uppercase tracking-wider">
                      Metode Aktif:
                    </div>
                    <div className="text-sm font-black text-white truncate">
                      {tenderOptions.find((t) => t.id === activeLine.tenderId)?.name || (isPrimaryCash ? 'Tunai (Laci Kasir)' : 'Non-Tunai')}
                    </div>
                  </div>
                </div>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0"></span>
              </div>

              {/* Tender Methods Grid (Toast 2-Column Buttons) */}
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 pt-1">
                Pilih Metode Bayar:
              </div>
            </div>

            {/* 2-Column Grid */}
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-2 my-2 overflow-y-auto pr-0.5">
              {tenderOptions.map((t) => {
                const isSelected = activeLine.tenderId === t.id || (!activeLine.tenderId && activeLine.accountId === t.account_id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectPrimaryTender(t)}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between min-h-[58px] ${
                      isSelected
                        ? 'bg-[#1e2330] border-blue-500 text-white ring-1 ring-blue-500 shadow-sm'
                        : 'bg-[#202228] hover:bg-[#282b33] border-[#30333d] text-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg">{getTenderIcon(t.category)}</span>
                      {isSelected && <span className="text-blue-400 text-xs font-bold">✓</span>}
                    </div>
                    <div className="font-bold text-xs truncate mt-1">{t.name}</div>
                  </button>
                )
              })}

              {/* Other payments / Split Tender Button */}
              <button
                type="button"
                onClick={() => setIsSplitTenderModalOpen(true)}
                className="p-2.5 rounded-xl border border-dashed border-[#444855] hover:border-gray-400 bg-[#1b1c20] hover:bg-[#24262d] text-gray-300 text-left transition cursor-pointer flex flex-col justify-between min-h-[58px]"
              >
                <span className="text-lg">➔</span>
                <span className="font-bold text-xs text-gray-300">Other payments</span>
              </button>
            </div>

            {/* Change Banner (Kembalian Diserahkan) */}
            <div className="shrink-0 pt-2 border-t border-[#26282e]">
              <div className={`p-2.5 rounded-xl flex items-center justify-between text-xs font-bold ${
                isPrimaryCash && activeLine.cashReceived < activeLine.amount
                  ? 'bg-rose-950/70 border border-rose-800 text-rose-300'
                  : 'bg-[#14261d] border border-emerald-800/60 text-emerald-300'
              }`}>
                <span>{isPrimaryCash && activeLine.cashReceived < activeLine.amount ? 'Kurang:' : 'Kembalian:'}</span>
                <span className="font-mono text-base font-black">
                  {isPrimaryCash && activeLine.cashReceived < activeLine.amount
                    ? `- ${formatIDR(activeLine.amount - activeLine.cashReceived)}`
                    : formatIDR(totalChangeAmount)}
                </span>
              </div>
            </div>
          </section>

        </div>

        {/* Validation Error Banner */}
        {errorMsg && (
          <div className="shrink-0 mt-2 p-2.5 bg-rose-950 border border-rose-800 text-rose-200 rounded-xl text-xs font-bold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* MODAL POPUP 1: SPLIT BILL (PECAH MENU / BAGI RATA / CICIL)                 */}
      {/* ========================================================================= */}
      {isSplitBillModalOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-[#1a1b20] border border-[#343742] rounded-2xl p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-[#2d303a] pb-3">
              <h4 className="font-bold text-base text-white flex items-center gap-2">
                <span>🔀</span>
                <span>Pecah Tagihan (Split Bill)</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsSplitBillModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-[#272932] text-gray-400 hover:text-white flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {/* Mode Tabs */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#121316] rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setBillMode('full')}
                className={`py-2 rounded-lg transition ${billMode === 'full' ? 'bg-[#2a2d36] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Penuh
              </button>
              <button
                type="button"
                onClick={() => setBillMode('split_equal')}
                className={`py-2 rounded-lg transition ${billMode === 'split_equal' ? 'bg-[#2a2d36] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Bagi Rata
              </button>
              <button
                type="button"
                onClick={() => setBillMode('split_item')}
                className={`py-2 rounded-lg transition ${billMode === 'split_item' ? 'bg-[#2a2d36] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Pecah Menu
              </button>
              <button
                type="button"
                onClick={() => setBillMode('partial')}
                className={`py-2 rounded-lg transition ${billMode === 'partial' ? 'bg-[#2a2d36] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Cicil / DP
              </button>
            </div>

            {/* Sub-Mode Configurations */}
            {billMode === 'split_equal' && (
              <div className="p-4 bg-[#121316] rounded-xl border border-[#292c35] flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm block">Bagi Rata Berapa Orang?</span>
                  <span className="text-xs text-gray-400 mt-0.5 block">
                    {formatIDR(grandTotal)} dibagi {splitCount} = <b className="text-emerald-400">{formatIDR(activeBillTarget)}</b> / orang
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-[#202228] p-1 rounded-xl border border-[#30333d]">
                  <button
                    type="button"
                    onClick={() => setSplitCount((p) => Math.max(2, p - 1))}
                    className="w-8 h-8 flex items-center justify-center font-bold text-gray-300 hover:bg-[#2b2e38] rounded-lg"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-sm px-2">{splitCount}</span>
                  <button
                    type="button"
                    onClick={() => setSplitCount((p) => Math.min(20, p + 1))}
                    className="w-8 h-8 flex items-center justify-center font-bold text-gray-300 hover:bg-[#2b2e38] rounded-lg"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {billMode === 'split_item' && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-gray-300 block">
                  Pilih menu yang dibayar pada tagihan ini ({selectedItemIds.size}/{cartItems.length}):
                </span>
                <div className="max-h-48 overflow-y-auto divide-y divide-[#252830] border border-[#2b2e37] rounded-xl bg-[#121316] p-1">
                  {cartItems.map((item) => (
                    <label key={item.id} className="p-2.5 flex items-center justify-between text-xs cursor-pointer hover:bg-[#1a1b20]">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedItemIds.has(item.id)}
                          onChange={(e) => {
                            const next = new Set(selectedItemIds)
                            if (e.target.checked) next.add(item.id)
                            else next.delete(item.id)
                            setSelectedItemIds(next)
                          }}
                          className="w-4 h-4 rounded text-blue-600 border-gray-600 bg-gray-800"
                        />
                        <span className="font-medium text-gray-200">{item.name} x{item.quantity}</span>
                      </div>
                      <span className="font-mono font-bold text-gray-300">{formatIDR(item.price * item.quantity)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {billMode === 'partial' && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-gray-300 block">
                  Nominal DP / Uang Muka yang Dibayar (Rp):
                </span>
                <input
                  type="text"
                  value={partialAmountInput}
                  onChange={(e) => setPartialAmountInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#121316] border border-[#30333d] font-mono text-base font-bold text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsSplitBillModalOpen(false)}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs tracking-wider uppercase transition cursor-pointer"
            >
              Terapkan Split Bill ({formatIDR(activeBillTarget)})
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL POPUP 2: SPLIT TENDER (+ MULTI-METODE PEMBAYARAN)                   */}
      {/* ========================================================================= */}
      {isSplitTenderModalOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-[#1a1b20] border border-[#343742] rounded-2xl p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-[#2d303a] pb-3">
              <div>
                <h4 className="font-bold text-base text-white flex items-center gap-2">
                  <span>💳</span>
                  <span>Pecah Metode Bayar (Split Tender)</span>
                </h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Bagi total tagihan ke beberapa metode bayar (Tunai + QRIS / EDC)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSplitTenderModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-[#272932] text-gray-400 hover:text-white flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {tenderLines.map((line, idx) => {
                const isCash = isAccountCash(line.accountId, line.tenderId)
                const currentAcc = cashBankAccounts.find((a) => a.id === line.accountId)
                const tenderObj = tenderOptions.find((t) => t.id === line.tenderId || t.account_id === line.accountId)

                return (
                  <div key={line.id} className="p-3 bg-[#121316] border border-[#2b2e37] rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-300">
                        Pembayaran #{idx + 1}: {tenderObj?.name || currentAcc?.name}
                      </span>
                      {tenderLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setTenderLines((p) => p.filter((l) => l.id !== line.id))}
                          className="text-xs text-rose-400 hover:text-rose-300 font-bold"
                        >
                          ✕ Hapus
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-[10px] text-gray-400 font-semibold block mb-1">Nominal (Rp):</label>
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
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[#1a1b20] border border-[#333640] font-mono font-bold text-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 font-semibold block mb-1">
                          {isCash ? 'Uang Diterima (Rp):' : 'No. Ref:'}
                        </label>
                        <input
                          type="text"
                          value={isCash ? (line.cashReceived > 0 ? String(line.cashReceived) : '') : line.referenceNumber}
                          onChange={(e) => {
                            if (isCash) {
                              handleUpdateLine(line.id, { cashReceived: Number(e.target.value.replace(/\D/g, '')) || 0 })
                            } else {
                              handleUpdateLine(line.id, { referenceNumber: e.target.value })
                            }
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[#1a1b20] border border-[#333640] font-mono text-white text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                const unallocated = Math.max(0, activeBillTarget - totalTenderAmount)
                const used = new Set(tenderLines.map((l) => l.accountId))
                const candidate = tenderOptions.find((t) => !used.has(t.account_id)) || tenderOptions[1] || tenderOptions[0]
                setTenderLines((p) => [
                  ...p,
                  {
                    id: 'line-' + Date.now(),
                    tenderId: candidate?.id,
                    accountId: candidate?.account_id || 'default-pos-bank',
                    amount: unallocated,
                    cashReceived: unallocated,
                    referenceNumber: ''
                  }
                ])
              }}
              className="w-full py-2.5 rounded-xl border border-dashed border-[#444855] text-xs font-bold text-blue-400 hover:bg-[#20222a] transition cursor-pointer"
            >
              + Tambah Baris Pembayaran Lain
            </button>

            <button
              type="button"
              onClick={() => setIsSplitTenderModalOpen(false)}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wider uppercase transition cursor-pointer"
            >
              Simpan & Tutup
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL POPUP 3: RINCIAN STRUK LENGKAP (KHUSUS MOBILE)                      */}
      {/* ========================================================================= */}
      {isReceiptModalOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#1a1b20] border border-[#343742] rounded-2xl p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-[#2d303a] pb-3">
              <h4 className="font-bold text-base text-white flex items-center gap-2">
                <span>🧾</span>
                <span>Rincian Struk Pesanan</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-[#272932] text-gray-400 hover:text-white flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-[#262830] space-y-2">
              {cartItems.map((item) => (
                <div key={item.id} className="pt-2 first:pt-0 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-gray-200">{item.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{item.quantity} x {formatIDR(item.price)}</div>
                  </div>
                  <div className="font-mono font-bold text-gray-300">
                    {formatIDR(item.price * item.quantity)}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-[#2d303a] pt-3 space-y-1 text-xs">
              <div className="flex justify-between text-gray-400">
                <span>Total Pesanan:</span>
                <span className="font-mono font-bold text-white">{formatIDR(grandTotal)}</span>
              </div>
              <div className="flex justify-between font-black text-emerald-400 text-sm pt-1">
                <span>Tagihan Saat Ini:</span>
                <span className="font-mono">{formatIDR(activeBillTarget)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsReceiptModalOpen(false)}
              className="w-full py-2.5 rounded-xl bg-[#2a2d36] hover:bg-[#343742] text-white font-bold text-xs"
            >
              Tutup Rincian
            </button>
          </div>
        </div>
      )}

    </FullScreenModal>
  )
}
