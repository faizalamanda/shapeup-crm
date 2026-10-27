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
  // 1. Pengaturan Mode Tagihan (Split Bill)
  const initialMode = defaultMode === 'split' ? 'split_equal' : (defaultMode as any)
  const [billMode, setBillMode] = useState<'full' | 'split_item' | 'split_equal' | 'partial'>(initialMode)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [splitCount, setSplitCount] = useState<number>(2)
  const [partialAmountInput, setPartialAmountInput] = useState<string>('')

  // 2. Dialog Pop-Up Terpisah (Zero-Scroll Utama)
  const [isSplitBillOpen, setIsSplitBillOpen] = useState(false)
  const [isSplitTenderOpen, setIsSplitTenderOpen] = useState(false)
  const [isReceiptDetailsOpen, setIsReceiptDetailsOpen] = useState(false)

  // 3. Status Alur Pecah Metode (Split Tender) & Form Satu-Satu Saja
  const [isSplitMode, setIsSplitMode] = useState(false)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [formTenderId, setFormTenderId] = useState<string>('')
  const [formAccountId, setFormAccountId] = useState<string>('')
  const [formAmount, setFormAmount] = useState<number>(0)
  const [formReferenceNumber, setFormReferenceNumber] = useState<string>('')

  // 4. Akun Kas & Bank dan Metode Tender
  const [fetchedAccounts, setFetchedAccounts] = useState<CashBankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false)
  const [fetchedCustomTenders, setFetchedCustomTenders] = useState<POSTender[] | null>(null)

  // 5. Baris Pembayaran (Tender Lines)
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Ambil Akun Kas & Bank
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
        console.warn('[CashPaymentModal] Gagal memuat akun kas & bank:', err)
      } finally {
        if (isSubscribed) setLoadingAccounts(false)
      }
    }

    fetchBizAccounts()
    return () => { isSubscribed = false }
  }, [isOpen, propAccounts, businessId])

  // Ambil Pengaturan Tender Kustom
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

  // Filter Akun Kas & Bank
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

  // Resolusi Opsi Tender
  const tenderOptions = useMemo(() => {
    return resolveBusinessTenders({
      accounts: cashBankAccounts,
      customTenders: propCustomTenders || fetchedCustomTenders,
      activeRegisterAccountId
    })
  }, [cashBankAccounts, propCustomTenders, fetchedCustomTenders, activeRegisterAccountId])

  // Cek apakah akun mewakili uang fisik laci kasir
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

  // Helper metode standar
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

  // Hitung target tagihan aktif berdasarkan mode split bill
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

  // Inisialisasi awal saat modal dibuka: Uang diterima default Rp 0 untuk tunai!
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
      const isCash = defaultTender ? defaultTender.category === 'cash' : true

      setIsSplitMode(false)
      setIsSplitTenderOpen(false)
      setEditingLineId(null)

      setTenderLines([
        {
          id: 'line-1',
          tenderId: defaultTender?.id,
          accountId: fallbackAccId,
          amount: grandTotal,
          cashReceived: isCash ? 0 : grandTotal,
          referenceNumber: ''
        }
      ])
    }
  }, [isOpen, grandTotal, defaultMode, tenderOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sinkronisasi target tagihan saat split bill berubah (jika belum dipecah manual)
  useEffect(() => {
    setTenderLines((prev) => {
      if (!isSplitMode && prev.length <= 1 && prev[0]) {
        const isCash = isAccountCash(prev[0].accountId, prev[0].tenderId)
        return [
          {
            ...prev[0],
            amount: activeBillTarget,
            cashReceived: isCash ? Math.min(prev[0].cashReceived, activeBillTarget) : activeBillTarget
          }
        ]
      }
      return prev
    })
  }, [activeBillTarget, isAccountCash, isSplitMode])

  // Baris pembayaran utama
  const primaryLine = tenderLines[0] || {
    id: 'line-1',
    accountId: 'default-pos-cash',
    amount: activeBillTarget,
    cashReceived: 0,
    referenceNumber: ''
  }
  const isPrimaryCash = isAccountCash(primaryLine.accountId, primaryLine.tenderId)

  // Total kalkulasi
  const totalTenderAmount = useMemo(() => {
    return tenderLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  }, [tenderLines])

  const totalCashReceived = useMemo(() => {
    return tenderLines.reduce((sum, line) => {
      if (isAccountCash(line.accountId, line.tenderId)) {
        return sum + (Number(line.cashReceived) || 0)
      }
      return sum + (Number(line.amount) || 0)
    }, 0)
  }, [tenderLines, isAccountCash])

  const totalChangeAmount = useMemo(() => {
    let change = 0
    tenderLines.forEach((line) => {
      if (isAccountCash(line.accountId, line.tenderId)) {
        const received = Number(line.cashReceived) || 0
        const amt = Number(line.amount) || 0
        if (received > amt) change += (received - amt)
      }
    })
    return change
  }, [tenderLines, isAccountCash])

  const hasInsufficientCashLine = useMemo(() => {
    return tenderLines.some((line) => {
      if (isAccountCash(line.accountId, line.tenderId)) {
        const received = Number(line.cashReceived) || 0
        const amt = Number(line.amount) || 0
        return received < amt
      }
      return false
    })
  }, [tenderLines, isAccountCash])

  // Pilih Metode Tender di Layar Utama
  const handleSelectTender = (tender: POSTender) => {
    const isCash = tender.category === 'cash'
    setTenderLines((prev) => {
      const updated = [...prev]
      if (updated[0]) {
        const currentAmt = updated[0].amount || activeBillTarget
        updated[0] = {
          ...updated[0],
          tenderId: tender.id,
          accountId: tender.account_id,
          cashReceived: isCash ? (updated[0].cashReceived > 0 ? updated[0].cashReceived : 0) : currentAmt,
          referenceNumber: isCash ? '' : updated[0].referenceNumber
        }
      }
      return updated
    })
    setErrorMsg(null)
  }

  // Update Baris Pembayaran
  const handleUpdateLine = (id: string, updates: Partial<TenderLine>) => {
    setTenderLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...updates } : l))
    )
    setErrorMsg(null)
  }

  // Buka modal untuk menambah pembayaran baru (1 per 1)
  const openAddTenderModal = () => {
    const unallocated = Math.max(0, activeBillTarget - totalTenderAmount)
    const usedAccountIds = new Set(tenderLines.map((l) => l.accountId))
    const candidate =
      tenderOptions.find((t) => !usedAccountIds.has(t.account_id)) || tenderOptions[1] || tenderOptions[0]

    setEditingLineId(null)
    setFormTenderId(candidate?.id || '')
    setFormAccountId(candidate?.account_id || 'default-pos-bank')
    setFormAmount(unallocated)
    setFormReferenceNumber('')
    setIsSplitTenderOpen(true)
  }

  // Buka modal untuk mengedit satu baris pembayaran
  const openEditTenderModal = (line: TenderLine) => {
    setIsSplitMode(true)
    setEditingLineId(line.id)
    setFormTenderId(line.tenderId || '')
    setFormAccountId(line.accountId)
    setFormAmount(line.amount)
    setFormReferenceNumber(line.referenceNumber || '')
    setIsSplitTenderOpen(true)
  }

  // Hapus satu baris pembayaran
  const handleDeleteTenderLine = (id: string) => {
    setTenderLines((prev) => {
      const filtered = prev.filter((l) => l.id !== id)
      if (filtered.length === 0) {
        setIsSplitMode(false)
        const defaultT = tenderOptions[0]
        return [
          {
            id: 'line-1',
            tenderId: defaultT?.id,
            accountId: defaultT?.account_id || 'default-pos-cash',
            amount: activeBillTarget,
            cashReceived: defaultT?.category === 'cash' ? 0 : activeBillTarget,
            referenceNumber: ''
          }
        ]
      }
      return filtered
    })
  }

  // Simpan form pembayaran tunggal (tambah baru atau edit)
  const handleSaveTenderForm = () => {
    if (formAmount <= 0) {
      setErrorMsg('Nominal pembayaran harus lebih besar dari Rp 0.')
      return
    }

    const isCash = isAccountCash(formAccountId, formTenderId)

    if (editingLineId) {
      setTenderLines((prev) =>
        prev.map((l) => {
          if (l.id === editingLineId) {
            return {
              ...l,
              tenderId: formTenderId,
              accountId: formAccountId,
              amount: formAmount,
              cashReceived: formAmount,
              referenceNumber: isCash ? '' : formReferenceNumber.trim()
            }
          }
          return l
        })
      )
    } else {
      const newLine: TenderLine = {
        id: 'line-' + Date.now(),
        tenderId: formTenderId,
        accountId: formAccountId,
        amount: formAmount,
        cashReceived: formAmount,
        referenceNumber: isCash ? '' : formReferenceNumber.trim()
      }
      setTenderLines((prev) => [...prev, newLine])
    }

    setIsSplitMode(true)
    setIsSplitTenderOpen(false)
    setErrorMsg(null)
  }

  // Mulai alur pecah metode dari workstation utama
  const handleStartSplitTender = () => {
    setIsSplitMode(true)
    if (primaryLine.cashReceived > 0 && primaryLine.cashReceived < activeBillTarget) {
      setTenderLines([
        {
          ...primaryLine,
          amount: primaryLine.cashReceived,
          cashReceived: primaryLine.cashReceived
        }
      ])
      const remaining = activeBillTarget - primaryLine.cashReceived
      const usedAcc = new Set([primaryLine.accountId])
      const candidate =
        tenderOptions.find((t) => !usedAcc.has(t.account_id)) || tenderOptions[1] || tenderOptions[0]

      setEditingLineId(null)
      setFormTenderId(candidate?.id || '')
      setFormAccountId(candidate?.account_id || 'default-pos-bank')
      setFormAmount(remaining)
      setFormReferenceNumber('')
      setIsSplitTenderOpen(true)
    } else {
      openEditTenderModal(primaryLine)
    }
  }

  // Kembalikan ke 1 metode tunggal
  const handleResetToSingleTender = () => {
    setIsSplitMode(false)
    const defaultT = tenderOptions[0]
    setTenderLines([
      {
        id: 'line-1',
        tenderId: defaultT?.id,
        accountId: defaultT?.account_id || 'default-pos-cash',
        amount: activeBillTarget,
        cashReceived: defaultT?.category === 'cash' ? 0 : activeBillTarget,
        referenceNumber: ''
      }
    ])
  }

  // Input Numpad (HANYA MENGISI UANG DITERIMA KASIR)
  const handleNumpadInput = useCallback((char: string) => {
    if (!primaryLine) return
    const currentNum = Number(primaryLine.cashReceived) || 0
    let newNum = 0

    if (char === 'CLEAR') {
      newNum = 0
    } else if (char === 'BACKSPACE') {
      const s = String(currentNum)
      newNum = s.length > 1 ? Number(s.slice(0, -1)) : 0
    } else if (char === '000') {
      if (currentNum > 0) newNum = Number(String(currentNum) + '000')
    } else if (char === '00') {
      if (currentNum > 0) newNum = Number(String(currentNum) + '00')
    } else {
      const s = currentNum === 0 ? char : String(currentNum) + char
      newNum = Number(s)
    }

    if (newNum > 2_000_000_000) return
    handleUpdateLine(primaryLine.id, { cashReceived: newNum })
  }, [primaryLine])

  // DUKUNGAN KEYBOARD FISIK & NUMKEY EKSTERNAL
  useEffect(() => {
    if (!isOpen) return

    const handlePhysicalKeyDown = (e: KeyboardEvent) => {
      if (isSplitBillOpen || isSplitTenderOpen || isReceiptDetailsOpen) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const key = e.key

      if (key >= '0' && key <= '9') {
        e.preventDefault()
        handleNumpadInput(key)
      } else if (key === 'Backspace') {
        e.preventDefault()
        handleNumpadInput('BACKSPACE')
      } else if (key === 'Delete' || key === 'c' || key === 'C') {
        e.preventDefault()
        handleNumpadInput('CLEAR')
      } else if (key === 'Enter') {
        e.preventDefault()
        handleConfirm()
      }
    }

    window.addEventListener('keydown', handlePhysicalKeyDown)
    return () => window.removeEventListener('keydown', handlePhysicalKeyDown)
  }, [isOpen, isSplitBillOpen, isSplitTenderOpen, isReceiptDetailsOpen, handleNumpadInput])

  // Pecahan Uang Cepat (Toast Quick Cash Pills)
  const quickCashChips = useMemo(() => {
    const target = activeBillTarget
    const chips: number[] = [target]
    const round10 = Math.ceil(target / 10000) * 10000
    const round50 = Math.ceil(target / 50000) * 50000
    const round100 = Math.ceil(target / 100000) * 100000

    if (round10 > target && !chips.includes(round10)) chips.push(round10)
    if (round50 > target && !chips.includes(round50)) chips.push(round50)
    if (round100 > target && !chips.includes(round100)) chips.push(round100);

    ;[50000, 100000, 200000, 500000].forEach((val) => {
      if (val > target && !chips.includes(val)) chips.push(val)
    })

    return chips.slice(0, 3)
  }, [activeBillTarget])

  // Konfirmasi Transaksi Selesai
  const handleConfirm = async () => {
    setErrorMsg(null)
    if (totalTenderAmount <= 0) {
      setErrorMsg('Total pembayaran harus lebih besar dari Rp 0.')
      return
    }
    if (hasInsufficientCashLine) {
      setErrorMsg('Uang tunai yang diterima masih kurang dari nilai tagihan.')
      return
    }
    if (billMode === 'split_item' && activeBillTarget <= 0) {
      setErrorMsg('Pilih minimal satu menu untuk dibayar pada tagihan ini.')
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
        const cashRec = isCash ? Number(l.cashReceived || 0) : amt
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

  const activeTenderObj = tenderOptions.find((t) => t.id === primaryLine.tenderId) || tenderOptions[0]
  const isShortOfCash = isPrimaryCash && primaryLine.cashReceived < primaryLine.amount
  const unallocatedSplitAmount = Math.max(0, activeBillTarget - totalTenderAmount)
  const isSplitTenderActive =
    isSplitMode || tenderLines.length > 1 || (tenderLines.length === 1 && tenderLines[0].amount < activeBillTarget)

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="fullscreen"
      showCloseButton={false}
      className="sm:!h-[100dvh] sm:!max-h-none sm:!rounded-none !bg-slate-100 !text-slate-900 border-none select-none font-sans"
      contentClassName="!p-0 !overflow-hidden flex flex-col h-full bg-slate-100"
      title={null}
    >
      {/* 
        CONTAINER UTAMA (OPTIMASI TABLET LANSKAP & PORTRAIT — 100dvh ZERO SCROLL)
        Menggunakan Adaptive Landscape Vertical Compression
      */}
      <div className="w-full max-w-[1280px] mx-auto h-[100dvh] max-h-[100dvh] flex flex-col bg-slate-100 text-slate-900 overflow-hidden p-2 sm:p-2.5 lg:p-3">

        {/* 1. TOP NAVBAR HEADER KOMPAK */}
        <header className="h-10 sm:h-11 shrink-0 bg-slate-900 text-white rounded-xl px-3 sm:px-3.5 flex items-center justify-between shadow-xs mb-1.5 sm:mb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center gap-1 text-xs font-bold transition border border-slate-700/80 cursor-pointer"
              title="Kembali ke Layar Kasir"
            >
              <span>←</span>
              <span>Kembali</span>
            </button>

            <div className="h-3.5 w-px bg-slate-700 hidden sm:block"></div>

            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-indigo-500 to-violet-500 text-white font-black flex items-center justify-center text-[10px] shadow-xs">
                POS
              </div>
              <h1 className="font-extrabold text-xs sm:text-sm leading-tight text-white">
                {title || 'Pembayaran Kasir'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Tombol Pecah Tagihan (Muncul di layar kecil/ponsel agar kasir tidak kehilangan fitur split) */}
            <button
              type="button"
              onClick={() => setIsSplitBillOpen(true)}
              className="lg:hidden px-2.5 py-1 rounded-lg bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <span>🔀 Pecah Tagihan</span>
            </button>

            {/* Tombol Lihat Menu (Khusus Mobile) */}
            <button
              type="button"
              onClick={() => setIsReceiptDetailsOpen(true)}
              className="lg:hidden px-2.5 py-1 rounded-lg bg-slate-800 text-xs font-bold text-slate-200 border border-slate-700 flex items-center gap-1"
            >
              <span>🧾 Menu ({cartItems.length})</span>
            </button>

            {activeShift && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Shift: {activeShift.cashier_name}</span>
              </span>
            )}
          </div>
        </header>

        {/* 
          2. WORKSPACE 2-PANEL KHUSUS TABLET (768px - 1024px LANSKAP & PORTRAIT)
          Panel Kiri: Struk Kasir (38%)
          Panel Kanan: Workstation Numpad & Tender (62%)
        */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-2.5 overflow-hidden">
          
          {/* ========================================================= */}
          {/* PANEL KIRI (38%): STRUK NOTA KASIR                        */}
          {/* ========================================================= */}
          <aside className="hidden lg:flex lg:col-span-5 flex-col bg-white border border-slate-200/90 rounded-xl p-3 sm:p-3.5 shadow-2xs overflow-hidden justify-between">
            
            {/* Header Struk Nota */}
            <div className="shrink-0 border-b border-slate-100 pb-2 mb-1.5 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-xs text-slate-500 uppercase tracking-wider">
                    Nota #{Date.now().toString().slice(-6)}
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Kasir Aktif
                  </span>
                </div>
                <div className="text-[11px] font-semibold text-slate-600 mt-0.5">
                  Pelanggan: <span className="text-slate-900 font-bold">Umum (Tamu)</span>
                </div>
              </div>

              {/* Tombol Pecah Tagihan */}
              <button
                type="button"
                onClick={() => setIsSplitBillOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-xs font-bold border border-slate-200 hover:border-indigo-300 transition flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <span>🔀</span>
                <span>Pecah Tagihan</span>
              </button>
            </div>

            {/* Banner Penegasan Jika Mode Split Bill Aktif */}
            {billMode !== 'full' && (
              <div className="shrink-0 mb-1.5 p-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold flex items-center justify-between">
                <div>
                  <span className="font-bold block text-[11px]">
                    📌 {billMode === 'split_equal' ? `Bagi Rata (${splitCount} Orang)` : (billMode === 'split_item' ? 'Pecah per Menu' : 'Cicil / Uang Muka')}
                  </span>
                  <span className="text-[10px] text-blue-700">
                    Sisa belum lunas: {formatIDR(unpaidOutsideBill)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setBillMode('full')}
                  className="text-[10px] text-rose-600 hover:text-rose-800 font-bold underline cursor-pointer"
                >
                  Reset
                </button>
              </div>
            )}

            {/* Daftar Item Pesanan (Scroll Internal Terisolasi) */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 divide-y divide-slate-100">
              {cartItems.length === 0 ? (
                <div className="text-xs text-slate-400 py-6 text-center font-medium">
                  Keranjang pesanan kosong.
                </div>
              ) : (
                cartItems.map((item) => {
                  const isCheckedForSubBill = billMode !== 'split_item' || selectedItemIds.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`pt-1.5 first:pt-0 flex items-start justify-between text-xs ${
                        !isCheckedForSubBill ? 'opacity-40 line-through' : ''
                      }`}
                    >
                      <div className="pr-2 leading-tight">
                        <div className="font-bold text-slate-900">
                          {item.quantity}x {item.name}
                        </div>
                        {item.variantName && (
                          <div className="text-[10px] text-slate-500">{item.variantName}</div>
                        )}
                        <div className="text-[10px] text-slate-400 font-mono">
                          @{formatIDR(item.price)}
                        </div>
                      </div>
                      <div className="font-mono font-bold text-slate-900 shrink-0 text-xs">
                        {formatIDR(item.price * item.quantity)}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Ringkasan Finansial Struk */}
            <div className="shrink-0 border-t border-slate-100 pt-2 mt-1.5 space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Subtotal Pesanan</span>
                <span className="font-mono font-semibold text-slate-700">{formatIDR(grandTotal)}</span>
              </div>

              {/* Total Tagihan Read-Only Kompak & Light */}
              <div className="p-2 sm:p-2.5 rounded-xl bg-slate-50 border border-slate-200/90 flex items-baseline justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    {billMode === 'full' ? 'Total Tagihan:' : 'Tagihan Sub-Bill Ini:'}
                  </span>
                  <span className="text-base sm:text-lg font-black font-mono text-slate-900 tracking-tight">
                    {formatIDR(activeBillTarget)}
                  </span>
                </div>
                {unpaidOutsideBill > 0 && (
                  <div className="text-right">
                    <span className="text-[9px] uppercase font-bold text-amber-600 block">Sisa Piutang:</span>
                    <span className="font-mono text-xs font-bold text-amber-700">{formatIDR(unpaidOutsideBill)}</span>
                  </div>
                )}
              </div>

              {/* Status Kembalian (Jika metode tunggal tunai aktif) */}
              {!isSplitTenderActive && isPrimaryCash && (
                <div className={`p-2 rounded-lg flex items-center justify-between text-xs font-bold border transition ${
                  isShortOfCash
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                }`}>
                  <div className="flex items-center gap-1 truncate">
                    <span>💵</span>
                    <span className="truncate text-[11px]">
                      {isShortOfCash ? 'Uang Kurang:' : 'Kembalian:'}
                    </span>
                  </div>
                  <span className="font-mono text-xs sm:text-sm font-black shrink-0">
                    {isShortOfCash
                      ? `- ${formatIDR(primaryLine.amount - primaryLine.cashReceived)}`
                      : formatIDR(totalChangeAmount)}
                  </span>
                </div>
              )}

              {/* Tombol Eksekusi Selesaikan Transaksi */}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || totalTenderAmount <= 0}
                className={`w-full py-2.5 sm:py-3 rounded-xl font-black text-xs sm:text-sm tracking-wide transition shadow-sm flex items-center justify-center gap-2 cursor-pointer ${
                  isSubmitting || totalTenderAmount <= 0
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'
                }`}
              >
                {isSubmitting ? (
                  <span>Memproses...</span>
                ) : (
                  <>
                    <span>Selesaikan Transaksi</span>
                    <span className="font-mono text-emerald-100 text-xs">({formatIDR(totalTenderAmount)})</span>
                  </>
                )}
              </button>
            </div>
          </aside>

          {/* ========================================================= */}
          {/* PANEL KANAN (62%): WORKSTATION NUMPAD / SPLIT BREAKDOWN   */}
          {/* ========================================================= */}
          <main className="col-span-1 lg:col-span-7 flex flex-col bg-white border border-slate-200/90 rounded-xl p-2.5 sm:p-3 shadow-2xs overflow-hidden justify-between">
            
            {/* JIKA SPLIT TENDER AKTIF: TAMPILKAN KARTU RANGKUMAN MULTI-TENDER */}
            {isSplitTenderActive ? (
              <div className="flex-1 flex flex-col justify-between space-y-2">
                <div className="space-y-2">
                  <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-black text-xs text-indigo-950 flex items-center gap-1.5">
                        <span>💳</span>
                        <span>Pembayaran Multi-Metode Aktif ({tenderLines.length} Metode)</span>
                      </span>
                      <p className="text-[11px] text-indigo-700 mt-0.5">
                        Tagihan dipecah ke beberapa akun kas/bank secara bersamaan
                      </p>
                    </div>
                    {totalTenderAmount < activeBillTarget ? (
                      <button
                        type="button"
                        onClick={openAddTenderModal}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs cursor-pointer flex items-center gap-1 transition"
                      >
                        <span>➕ Tambah</span>
                      </button>
                    ) : (
                      <span className="text-emerald-700 font-extrabold text-[11px] bg-emerald-100 px-2 py-0.5 rounded-full">
                        ✓ Pas
                      </span>
                    )}
                  </div>

                  {/* List Baris Pembayaran yang Tersimpan */}
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {tenderLines.map((line, idx) => {
                      const isCash = isAccountCash(line.accountId, line.tenderId)
                      const currentAcc = cashBankAccounts.find((a) => a.id === line.accountId)
                      const activeTender = tenderOptions.find((t) => t.id === line.tenderId || t.account_id === line.accountId)
                      const categoryIcons: Record<string, string> = {
                        cash: '💵',
                        qris: '📱',
                        bank: '🏦',
                        edc: '💳'
                      }
                      const icon = categoryIcons[activeTender?.category || 'bank'] || (isCash ? '💵' : '🏦')

                      return (
                        <div key={line.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs hover:border-slate-300 transition">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{icon}</span>
                            <div>
                              <div className="font-bold text-slate-900">
                                #{idx + 1} {activeTender?.name || currentAcc?.name}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                Akun: {currentAcc?.code || 'COA'} {line.referenceNumber ? `• Ref: ${line.referenceNumber}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="font-mono font-black text-sm text-slate-900">
                              {formatIDR(line.amount)}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditTenderModal(line)}
                                className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-bold cursor-pointer transition shadow-2xs"
                                title="Ubah Pembayaran Ini"
                              >
                                ✏️
                              </button>
                              {tenderLines.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTenderLine(line.id)}
                                  className="px-2 py-1 rounded-lg bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 text-[11px] font-bold cursor-pointer transition shadow-2xs"
                                  title="Hapus Pembayaran Ini"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* TOMBOL TAMBAH PAYMENT JIKA KURANG (SESUAI REQUEST USER) */}
                  {totalTenderAmount < activeBillTarget && (
                    <button
                      type="button"
                      onClick={openAddTenderModal}
                      className="w-full py-2.5 sm:py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-extrabold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer animate-in fade-in"
                    >
                      <span className="text-base">➕</span>
                      <span>Tambah Pembayaran</span>
                      <span className="font-mono text-xs bg-indigo-500/80 px-2.5 py-0.5 rounded-full text-indigo-100 font-bold">
                        (Kurang {formatIDR(activeBillTarget - totalTenderAmount)})
                      </span>
                    </button>
                  )}

                  {/* Rangkuman Alokasi Pas vs Belum Pas */}
                  <div className="p-2.5 sm:p-3 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-500 font-semibold block text-[10px] sm:text-[11px]">Total Tagihan:</span>
                      <span className="font-mono font-bold text-slate-800 text-xs sm:text-sm">{formatIDR(activeBillTarget)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-slate-500 font-semibold block text-[10px] sm:text-[11px]">Total Terbagi:</span>
                      <span className="font-mono font-black text-slate-900 text-xs sm:text-sm">{formatIDR(totalTenderAmount)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 font-semibold block text-[10px] sm:text-[11px]">Status:</span>
                      {totalTenderAmount === activeBillTarget ? (
                        <span className="text-emerald-700 font-extrabold text-[11px] bg-emerald-100 px-2 py-0.5 rounded-full">
                          ✓ Alokasi Pas
                        </span>
                      ) : totalTenderAmount < activeBillTarget ? (
                        <span className="text-rose-700 font-extrabold text-[11px] bg-rose-100 px-2 py-0.5 rounded-full">
                          Kurang {formatIDR(activeBillTarget - totalTenderAmount)}
                        </span>
                      ) : (
                        <span className="text-amber-700 font-extrabold text-[11px] bg-amber-100 px-2 py-0.5 rounded-full">
                          Lebih {formatIDR(totalTenderAmount - activeBillTarget)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tombol Reset ke 1 Metode Tunggal & Tambah Pembayaran Lain */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={handleResetToSingleTender}
                    className="font-bold text-rose-600 hover:text-rose-800 cursor-pointer transition"
                  >
                    Kembali ke 1 Metode Tunggal
                  </button>
                  {totalTenderAmount >= activeBillTarget && (
                    <button
                      type="button"
                      onClick={openAddTenderModal}
                      className="font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer transition flex items-center gap-1"
                    >
                      <span>+ Tambah Pembayaran Lain</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* JIKA METODE TUNGGAL: TAMPILKAN WORKSTATION NUMPAD ELEGAN */
              <>
                {/* Baris Atas: Tombol Metode Tender */}
                <div className="shrink-0 space-y-1.5 mb-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-extrabold uppercase tracking-wider text-slate-500 text-[10px]">
                      Pilih Metode Pembayaran:
                    </span>
                    <button
                      type="button"
                      onClick={handleStartSplitTender}
                      className="text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
                    >
                      <span>+ Pecah Metode (Split Tender)</span>
                    </button>
                  </div>

                  {/* Grid Tombol Tender (1-Ketuk) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {tenderOptions.slice(0, 4).map((t) => {
                      const isSelected = primaryLine.tenderId === t.id || (!primaryLine.tenderId && primaryLine.accountId === t.account_id)
                      const categoryIcons: Record<string, string> = {
                        cash: '💵',
                        qris: '📱',
                        bank: '🏦',
                        edc: '💳'
                      }

                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectTender(t)}
                          className={`p-2 rounded-xl border-2 text-left transition cursor-pointer flex items-center gap-2 min-h-[44px] sm:min-h-[48px] ${
                            isSelected
                              ? 'bg-indigo-50/90 border-indigo-600 text-indigo-950 shadow-xs ring-2 ring-indigo-500/20'
                              : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                          }`}
                        >
                          <span className="text-lg shrink-0">{categoryIcons[t.category] || '💳'}</span>
                          <div className="truncate">
                            <div className="font-extrabold text-xs truncate leading-tight">{t.name}</div>
                            <div className={`text-[9px] truncate font-medium ${isSelected ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                              {t.category === 'cash' ? 'Laci Kasir' : 'Bank'}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* Dua Kotak Display: Total Tagihan Read-Only + Uang Diterima Aktif */}
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    {/* Kotak 1: TOTAL TAGIHAN (READ-ONLY MUTLAK) */}
                    <div className="py-1.5 px-2.5 sm:px-3 rounded-xl bg-white border border-slate-200 select-none">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                          Total Tagihan
                        </span>
                        <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <span>🔒</span>
                          <span>Terkunci</span>
                        </span>
                      </div>
                      <div className="font-mono text-sm sm:text-base font-extrabold text-slate-700 truncate mt-0.5">
                        {formatIDR(primaryLine.amount)}
                      </div>
                    </div>

                    {/* Kotak 2: UANG DITERIMA (TARGET UTAMA NUMPAD) */}
                    <div className="py-1.5 px-2.5 sm:px-3 rounded-xl bg-emerald-50 border-2 border-emerald-500 ring-2 ring-emerald-500/20 select-none">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-800 block">
                          Uang Diterima
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      </div>
                      <div className="font-mono text-sm sm:text-base lg:text-lg font-black text-emerald-950 truncate mt-0.5">
                        {formatIDR(primaryLine.cashReceived)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* GRID NUMPAD (Skala Dinamis untuk Tablet Lanskap) */}
                <div className="flex-1 min-h-0 grid grid-cols-4 gap-1.5 my-1">
                  {/* Baris 1: 1, 2, 3, Uang Pas */}
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('1')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('2')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    2
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('3')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    3
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateLine(primaryLine.id, { cashReceived: primaryLine.amount })}
                    className="rounded-xl sm:rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-900 flex flex-col items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-300 shadow-2xs p-1"
                  >
                    <span className="text-[9px] uppercase font-bold text-emerald-700">Uang Pas</span>
                    <span className="font-mono text-[10px] sm:text-xs truncate max-w-full">{formatIDR(primaryLine.amount)}</span>
                  </button>

                  {/* Baris 2: 4, 5, 6, Pecahan 1 */}
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('4')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    4
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('5')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    5
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('6')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    6
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const val = quickCashChips[1] || primaryLine.amount * 2
                      handleUpdateLine(primaryLine.id, { cashReceived: val })
                    }}
                    className="rounded-xl sm:rounded-2xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-300/80 font-mono shadow-2xs truncate px-1"
                  >
                    {formatIDR(quickCashChips[1] || primaryLine.amount * 2)}
                  </button>

                  {/* Baris 3: 7, 8, 9, Pecahan 2 */}
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('7')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    7
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('8')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    8
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('9')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    9
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const val = quickCashChips[2] || (primaryLine.amount + 50000)
                      handleUpdateLine(primaryLine.id, { cashReceived: val })
                    }}
                    className="rounded-xl sm:rounded-2xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-300/80 font-mono shadow-2xs truncate px-1"
                  >
                    {formatIDR(quickCashChips[2] || (primaryLine.amount + 50000))}
                  </button>

                  {/* Baris 4: Reset C, 0, 000, Hapus ⌫ */}
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('CLEAR')}
                    className="rounded-xl sm:rounded-2xl bg-rose-50 hover:bg-rose-100 text-xs sm:text-sm font-bold text-rose-700 flex items-center justify-center transition active:scale-95 cursor-pointer border border-rose-200 shadow-2xs"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('0')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 shadow-2xs"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('000')}
                    className="rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-sm sm:text-base font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200/80 font-mono shadow-2xs"
                  >
                    000
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadInput('BACKSPACE')}
                    className="rounded-xl sm:rounded-2xl bg-amber-50 hover:bg-amber-100 text-base sm:text-xl font-bold text-amber-800 flex items-center justify-center transition active:scale-95 cursor-pointer border border-amber-200 shadow-2xs"
                  >
                    ⌫
                  </button>
                </div>
              </>
            )}

            {/* Kembalian & Tombol Bayar (Khusus Layar Mobile / Tablet Portrait) */}
            <div className="lg:hidden shrink-0 pt-1.5 space-y-1.5">
              {!isSplitTenderActive && isPrimaryCash && (
                <div className={`p-2 rounded-lg flex items-center justify-between text-xs font-bold border ${
                  isShortOfCash
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                }`}>
                  <span>{isShortOfCash ? 'Uang Kurang:' : 'Kembalian:'}</span>
                  <span className="font-mono text-xs sm:text-sm font-black">
                    {isShortOfCash
                      ? `- ${formatIDR(primaryLine.amount - primaryLine.cashReceived)}`
                      : formatIDR(totalChangeAmount)}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || totalTenderAmount <= 0}
                className={`w-full py-3 rounded-xl font-black text-xs sm:text-sm tracking-wide transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer ${
                  isSubmitting || totalTenderAmount <= 0
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'
                }`}
              >
                {isSubmitting ? 'Memproses...' : `Selesaikan (${formatIDR(totalTenderAmount)})`}
              </button>
            </div>
          </main>

        </div>

        {/* Notifikasi Error Validasi */}
        {errorMsg && (
          <div className="shrink-0 mt-1.5 p-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-bold flex items-center gap-2 shadow-xs">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* POP-UP 1: PECAH TAGIHAN (SPLIT BILL — TEMA SLATE BERSIH POS)              */}
      {/* ========================================================================= */}
      {isSplitBillOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-lg bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-3.5 text-slate-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                  <span>🔀</span>
                  <span>Pecah Tagihan (Split Bill)</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tentukan nominal porsi yang dibayar pelanggan saat ini
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSplitBillOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 hover:text-slate-900 flex items-center justify-center font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Pilihan Mode Tagihan */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setBillMode('full')}
                className={`py-1.5 rounded-lg transition ${billMode === 'full' ? 'bg-white text-slate-900 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Penuh
              </button>
              <button
                type="button"
                onClick={() => setBillMode('split_equal')}
                className={`py-1.5 rounded-lg transition ${billMode === 'split_equal' ? 'bg-white text-slate-900 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Bagi Rata
              </button>
              <button
                type="button"
                onClick={() => setBillMode('split_item')}
                className={`py-1.5 rounded-lg transition ${billMode === 'split_item' ? 'bg-white text-slate-900 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Pecah Menu
              </button>
              <button
                type="button"
                onClick={() => setBillMode('partial')}
                className={`py-1.5 rounded-lg transition ${billMode === 'partial' ? 'bg-white text-slate-900 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Cicil / DP
              </button>
            </div>

            {/* Konfigurasi Tiap Mode */}
            {billMode === 'split_equal' && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-xs sm:text-sm block">Bagi Rata ke Berapa Orang?</span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    {formatIDR(grandTotal)} dibagi {splitCount} = <b className="text-emerald-700">{formatIDR(activeBillTarget)}</b> / orang
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-300">
                  <button
                    type="button"
                    onClick={() => setSplitCount((p) => Math.max(2, p - 1))}
                    className="w-7 h-7 flex items-center justify-center font-bold text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-sm px-2 text-slate-900">{splitCount}</span>
                  <button
                    type="button"
                    onClick={() => setSplitCount((p) => Math.min(20, p + 1))}
                    className="w-7 h-7 flex items-center justify-center font-bold text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {billMode === 'split_item' && (
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-slate-700 block">
                  Pilih menu yang dibayar pada sub-bill ini ({selectedItemIds.size}/{cartItems.length}):
                </span>
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-slate-50 p-1">
                  {cartItems.map((item) => (
                    <label key={item.id} className="p-2 flex items-center justify-between text-xs cursor-pointer hover:bg-white rounded-lg">
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
                          className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span className="font-bold text-slate-800">{item.name} x{item.quantity}</span>
                      </div>
                      <span className="font-mono font-bold text-slate-900">{formatIDR(item.price * item.quantity)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {billMode === 'partial' && (
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-slate-700 block">
                  Nominal Uang Muka / Cicilan Hari Ini (Rp):
                </span>
                <input
                  type="text"
                  value={partialAmountInput}
                  onChange={(e) => setPartialAmountInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 font-mono text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsSplitBillOpen(false)}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs tracking-wider uppercase transition cursor-pointer shadow-sm"
            >
              Terapkan ke Layar Pembayaran ({formatIDR(activeBillTarget)})
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* POP-UP 2: PEMILIHAN METODE & JUMLAH (HANYA SATU-SATU SAJA — ZERO SCROLL)  */}
      {/* ========================================================================= */}
      {isSplitTenderOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col text-slate-900 max-h-[92vh] sm:max-h-[85vh] space-y-3">
            
            {/* Header Pop-up */}
            <div className="shrink-0 flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                  <span>💳</span>
                  <span>
                    {editingLineId
                      ? (editingLineId === tenderLines[0]?.id && tenderLines.length === 1
                          ? 'Atur Pembayaran #1'
                          : 'Ubah Pembayaran')
                      : 'Tambah Pembayaran'}
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {editingLineId
                    ? 'Sesuaikan metode dan nominal yang dibayar'
                    : 'Pilih metode dan masukkan nominal untuk pembayaran ini'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSplitTenderOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 hover:text-slate-900 flex items-center justify-center font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Target & Sisa Tagihan Info */}
            <div className="shrink-0 p-2.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-500 font-semibold block text-[10px]">Total Tagihan:</span>
                <span className="font-mono text-sm font-black text-slate-900">{formatIDR(activeBillTarget)}</span>
              </div>
              <div className="text-right">
                <span className="text-slate-500 font-semibold block text-[10px]">
                  {editingLineId ? 'Alokasi Saat Ini:' : 'Sisa Belum Dibagi:'}
                </span>
                <span className={`font-mono text-sm font-black ${unallocatedSplitAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {editingLineId ? formatIDR(formAmount) : formatIDR(unallocatedSplitAmount)}
                </span>
              </div>
            </div>

            {/* 1. Pilih Metode Pembayaran (1-Ketuk) */}
            <div className="space-y-1.5">
              <span className="font-extrabold text-[10px] uppercase tracking-wider text-slate-500 block">
                Pilih Metode Pembayaran:
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {tenderOptions.map((t) => {
                  const isSelected = formTenderId === t.id || (!formTenderId && formAccountId === t.account_id)
                  const categoryIcons: Record<string, string> = {
                    cash: '💵',
                    qris: '📱',
                    bank: '🏦',
                    edc: '💳'
                  }
                  const icon = categoryIcons[t.category] || '💳'

                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setFormTenderId(t.id)
                        setFormAccountId(t.account_id)
                      }}
                      className={`p-2 rounded-xl border-2 text-left transition cursor-pointer flex items-center gap-2 ${
                        isSelected
                          ? 'bg-indigo-50/90 border-indigo-600 text-indigo-950 shadow-xs ring-2 ring-indigo-500/20'
                          : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <span className="text-lg shrink-0">{icon}</span>
                      <div className="truncate">
                        <div className="font-extrabold text-xs truncate leading-tight">{t.name}</div>
                        <div className={`text-[9px] truncate font-medium ${isSelected ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                          {t.category === 'cash' ? 'Laci Kasir' : 'Bank/QRIS'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. Satu Kolom Input Nominal yang Dibayar */}
            <div className="space-y-1.5">
              <label className="text-xs font-extrabold text-slate-700 flex items-center justify-between">
                <span>Nominal yang Dibayarkan (Rp):</span>
                {formAmount > 0 && (
                  <span className="font-mono text-indigo-700 font-bold text-[11px]">
                    {formatIDR(formAmount)}
                  </span>
                )}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-400 text-sm">
                  Rp
                </span>
                <input
                  type="text"
                  autoFocus
                  inputMode="numeric"
                  value={formAmount > 0 ? formAmount.toLocaleString('id-ID') : ''}
                  onChange={(e) => {
                    const raw = Number(e.target.value.replace(/\D/g, '')) || 0
                    if (raw <= 2_000_000_000) setFormAmount(raw)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSaveTenderForm()
                    }
                  }}
                  placeholder="0"
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-300 font-mono font-black text-slate-900 text-lg sm:text-xl focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
                />
              </div>

              {/* Quick Pills */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {unallocatedSplitAmount > 0 && formAmount !== unallocatedSplitAmount && (
                  <button
                    type="button"
                    onClick={() => setFormAmount(unallocatedSplitAmount)}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold cursor-pointer transition"
                  >
                    Sisa ({formatIDR(unallocatedSplitAmount)})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFormAmount(Math.round(activeBillTarget / 2))}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[11px] font-bold cursor-pointer transition"
                >
                  Bagi 2 (50%)
                </button>
                <button
                  type="button"
                  onClick={() => setFormAmount(activeBillTarget)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[11px] font-bold cursor-pointer transition"
                >
                  Penuh ({formatIDR(activeBillTarget)})
                </button>
              </div>
            </div>

            {/* 3. Input Referensi Opsional jika Non-Tunai */}
            {!isAccountCash(formAccountId, formTenderId) && (
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600 block">
                  No. Referensi / Trace (Opsional):
                </label>
                <input
                  type="text"
                  value={formReferenceNumber}
                  onChange={(e) => setFormReferenceNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSaveTenderForm()
                    }
                  }}
                  placeholder="Contoh: REF-987654 atau No. Kartu..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 focus:bg-white border border-slate-300 text-slate-900 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
                />
              </div>
            )}

            {/* Footer Pop-up */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsSplitTenderOpen(false)}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveTenderForm}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-black text-white font-black text-xs cursor-pointer transition shadow-xs"
              >
                {editingLineId ? 'Simpan Perubahan' : 'Tambahkan Pembayaran'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* POP-UP 3: RINCIAN STRUK LENGKAP (KHUSUS MOBILE DENGAN OPSI SPLIT)        */}
      {/* ========================================================================= */}
      {isReceiptDetailsOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-3.5 text-slate-900 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                <span>🧾</span>
                <span>Rincian Struk Pesanan</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsReceiptDetailsOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 hover:text-slate-900 flex items-center justify-center font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 space-y-1.5">
              {cartItems.map((item) => (
                <div key={item.id} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-900">{item.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{item.quantity} x {formatIDR(item.price)}</div>
                  </div>
                  <div className="font-mono font-bold text-slate-900">
                    {formatIDR(item.price * item.quantity)}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-2.5 space-y-1 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Total Pesanan:</span>
                <span className="font-mono font-bold text-slate-900">{formatIDR(grandTotal)}</span>
              </div>
              <div className="flex justify-between font-black text-emerald-700 text-sm pt-0.5">
                <span>Tagihan Aktif:</span>
                <span className="font-mono">{formatIDR(activeBillTarget)}</span>
              </div>
            </div>

            {/* Opsi Pecah Tagihan di Dalam Modal Rincian Mobile */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsReceiptDetailsOpen(false)
                  setIsSplitBillOpen(true)
                }}
                className="w-full py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>🔀 Pecah Tagihan</span>
              </button>
              <button
                type="button"
                onClick={() => setIsReceiptDetailsOpen(false)}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

    </FullScreenModal>
  )
}
