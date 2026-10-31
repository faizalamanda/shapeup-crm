"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { resolveBusinessTenders, type POSTender } from '@/lib/pos/tenderResolver'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import {
  type KeypadTenderLine,
  calculatePaymentBalance,
  processNumpadAction,
  generateQuickCashChips
} from '@/lib/pos/paymentKeypadCalculator'

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

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(val || 0))

const CATEGORY_GLYPHS: Record<string, string> = {
  cash: '💵',
  qris: '📱',
  bank: '🏦',
  edc: '💳'
}

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

  // 2. Dialog Pop-Up Terpisah untuk Split Bill & Rincian Struk Mobile
  const [isSplitBillOpen, setIsSplitBillOpen] = useState(false)
  const [isReceiptDetailsOpen, setIsReceiptDetailsOpen] = useState(false)

  // 3. Akun Kas & Bank dan Metode Tender dari Pengaturan
  const [fetchedAccounts, setFetchedAccounts] = useState<CashBankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false)
  const [fetchedCustomTenders, setFetchedCustomTenders] = useState<POSTender[] | null>(null)

  // 4. Odoo-Style Multi-Tender Lines & Numpad State
  const [tenderLines, setTenderLines] = useState<KeypadTenderLine[]>([])
  const [activeLineId, setActiveLineId] = useState<string>('')
  const [isFirstTouch, setIsFirstTouch] = useState<boolean>(true)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Fetch Akun Kas & Bank
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

  // Fetch Pengaturan Tender Kustom dari /api/settings/pos/tenders
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

  // Resolusi Opsi Tender Sesuai Pengaturan Bisnis
  const tenderOptions = useMemo(() => {
    return resolveBusinessTenders({
      accounts: cashBankAccounts,
      customTenders: propCustomTenders || fetchedCustomTenders,
      activeRegisterAccountId
    })
  }, [cashBankAccounts, propCustomTenders, fetchedCustomTenders, activeRegisterAccountId])

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

  // Inisialisasi awal saat modal dibuka: default baris pertama terisi penuh & siap ditimpa (Auto-Replace)
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
      const lineId = 'line-' + Date.now()

      setTenderLines([
        {
          id: lineId,
          tenderId: defaultTender?.id,
          accountId: fallbackAccId,
          accountCode: defaultAcc?.code,
          accountName: defaultAcc?.name,
          tenderName: defaultTender?.name || defaultAcc?.name || 'Tunai (Laci Kasir)',
          category: defaultTender?.category || 'cash',
          amount: grandTotal,
          cashReceived: grandTotal,
          referenceNumber: ''
        }
      ])
      setActiveLineId(lineId)
      setIsFirstTouch(true)
    }
  }, [isOpen, grandTotal, defaultMode, tenderOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sinkronisasi jika target bill berubah (karena split bill diubah)
  useEffect(() => {
    setTenderLines((prev) => {
      if (prev.length <= 1 && prev[0]) {
        return [
          {
            ...prev[0],
            amount: activeBillTarget,
            cashReceived: activeBillTarget
          }
        ]
      }
      return prev
    })
  }, [activeBillTarget])

  // Kalkulasi Saldo Dua Arah
  const calculation = useMemo(() => {
    return calculatePaymentBalance(tenderLines, activeBillTarget)
  }, [tenderLines, activeBillTarget])

  // Baris yang sedang aktif / terfokus
  const activeLine = useMemo(() => {
    return tenderLines.find((l) => l.id === activeLineId) || tenderLines[0]
  }, [tenderLines, activeLineId])

  // Dynamic Quick Cash Chips (Adaptif terhadap sisa tagihan atau baris tunai aktif)
  const quickCashChips = useMemo(() => {
    const unallocated = calculation.remainingBill > 0 ? calculation.remainingBill : activeBillTarget
    return generateQuickCashChips(unallocated)
  }, [calculation.remainingBill, activeBillTarget])

  // Pilih Metode Tender (Odoo-Style Seamless Multi-Tender)
  const handleSelectTender = (tender: POSTender) => {
    setErrorMsg(null)
    const existingIndex = tenderLines.findIndex(
      (l) => l.tenderId === tender.id || l.accountId === tender.account_id
    )

    // Jika metode sudah ada di baris, langsung fokuskan baris tersebut
    if (existingIndex >= 0) {
      setActiveLineId(tenderLines[existingIndex].id)
      setIsFirstTouch(true)
      return
    }

    // Jika hanya ada 1 baris dan nominalnya masih sama persis dengan total tagihan penuh, switch tender
    if (tenderLines.length === 1 && tenderLines[0].amount === activeBillTarget) {
      const acc = cashBankAccounts.find((a) => a.id === tender.account_id)
      setTenderLines([
        {
          ...tenderLines[0],
          tenderId: tender.id,
          accountId: tender.account_id,
          accountCode: acc?.code,
          accountName: acc?.name,
          tenderName: tender.name,
          category: tender.category,
          amount: activeBillTarget,
          cashReceived: activeBillTarget,
          referenceNumber: ''
        }
      ])
      setIsFirstTouch(true)
      return
    }

    // Jika membuat baris baru (Split Tender Odoo-Style)
    // Hitung sisa tagihan yang belum teralokasi
    const otherAllocated = tenderLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
    const unallocated = Math.max(0, activeBillTarget - otherAllocated)

    if (unallocated <= 0) {
      setErrorMsg(`Tagihan sudah teralokasi penuh (${formatIDR(activeBillTarget)}). Kurangi nominal baris aktif jika ingin membagi ke metode ${tender.name}.`)
      return
    }

    const acc = cashBankAccounts.find((a) => a.id === tender.account_id)
    const newLineId = 'line-' + Date.now()
    const newLine: KeypadTenderLine = {
      id: newLineId,
      tenderId: tender.id,
      accountId: tender.account_id,
      accountCode: acc?.code,
      accountName: acc?.name,
      tenderName: tender.name,
      category: tender.category,
      amount: unallocated,
      cashReceived: unallocated,
      referenceNumber: ''
    }

    setTenderLines((prev) => [...prev, newLine])
    setActiveLineId(newLineId)
    setIsFirstTouch(true)
  }

  // Hapus satu baris tender
  const handleDeleteLine = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setErrorMsg(null)
    setTenderLines((prev) => {
      const filtered = prev.filter((l) => l.id !== id)
      if (filtered.length === 0) {
        const defaultT = tenderOptions[0]
        const acc = defaultT ? cashBankAccounts.find((a) => a.id === defaultT.account_id) : cashBankAccounts[0]
        const fallbackId = 'line-' + Date.now()
        setActiveLineId(fallbackId)
        setIsFirstTouch(true)
        return [
          {
            id: fallbackId,
            tenderId: defaultT?.id,
            accountId: defaultT?.account_id || 'default-pos-cash',
            accountCode: acc?.code,
            accountName: acc?.name,
            tenderName: defaultT?.name || 'Tunai (Laci Kasir)',
            category: defaultT?.category || 'cash',
            amount: activeBillTarget,
            cashReceived: activeBillTarget,
            referenceNumber: ''
          }
        ]
      }

      // Sisa nominal otomatis didistribusikan kembali ke metode yang tersisa (PRD section 7)
      if (filtered.length === 1) {
        const remainingLine = filtered[0]
        const isCash = remainingLine.category === 'cash'
        const updated: KeypadTenderLine = {
          ...remainingLine,
          amount: activeBillTarget,
          cashReceived: isCash ? Math.max(remainingLine.cashReceived, activeBillTarget) : activeBillTarget
        }
        setActiveLineId(updated.id)
        setIsFirstTouch(true)
        return [updated]
      }

      const nextActiveId = activeLineId === id ? filtered[0].id : activeLineId
      setActiveLineId(nextActiveId)
      setIsFirstTouch(true)

      const otherAllocated = filtered
        .filter((l) => l.id !== nextActiveId)
        .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
      const freedAmount = Math.max(0, activeBillTarget - otherAllocated)

      return filtered.map((l) => {
        if (l.id === nextActiveId) {
          const isCash = l.category === 'cash'
          return {
            ...l,
            amount: freedAmount,
            cashReceived: isCash ? Math.max(l.cashReceived, freedAmount) : freedAmount
          }
        }
        return l
      })
    })
  }

  // Eksekusi Numpad Action pada Baris Terfokus
  const handleNumpadInput = useCallback((action: string) => {
    if (!activeLine) return
    setErrorMsg(null)

    // Hitung limit maksimal untuk baris non-tunai (Strict Non-Cash Ceiling)
    const isCash = activeLine.category === 'cash'
    const otherAllocated = tenderLines
      .filter((l) => l.id !== activeLine.id)
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
    const maxAllowedNonCash = Math.max(0, activeBillTarget - otherAllocated)

    // Target nilai yang dimutasi
    const currentVal = isCash ? activeLine.cashReceived : activeLine.amount

    const { nextValue, nextFirstTouch } = processNumpadAction({
      currentValue: currentVal,
      action,
      isFirstTouch,
      maxLimit: isCash ? 2_000_000_000 : maxAllowedNonCash
    })

    setIsFirstTouch(nextFirstTouch)

    setTenderLines((prev) =>
      prev.map((line) => {
        if (line.id !== activeLine.id) return line

        if (line.category === 'cash') {
          // Pada baris tunai tunggal: amount tetap target bill atau min(cashReceived, target bill)
          const newAllocated = Math.min(nextValue, Math.max(0, activeBillTarget - otherAllocated))
          return {
            ...line,
            amount: newAllocated,
            cashReceived: nextValue
          }
        } else {
          // Baris non-tunai: amount dan cashReceived selalu sinkron
          const cappedVal = Math.min(nextValue, maxAllowedNonCash)
          return {
            ...line,
            amount: cappedVal,
            cashReceived: cappedVal
          }
        }
      })
    )
  }, [activeLine, isFirstTouch, tenderLines, activeBillTarget])

  // Tombol Cepat Quick Cash Chip
  const handleApplyQuickCash = (value: number) => {
    if (!activeLine) return
    setErrorMsg(null)
    setIsFirstTouch(false)

    const otherAllocated = tenderLines
      .filter((l) => l.id !== activeLine.id)
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
    const unallocated = Math.max(0, activeBillTarget - otherAllocated)

    setTenderLines((prev) =>
      prev.map((line) => {
        if (line.id !== activeLine.id) return line
        if (line.category === 'cash') {
          return {
            ...line,
            amount: Math.min(value, unallocated),
            cashReceived: value
          }
        } else {
          const cappedVal = Math.min(value, unallocated)
          return {
            ...line,
            amount: cappedVal,
            cashReceived: cappedVal
          }
        }
      })
    )
  }

  // Update Nomor Referensi untuk Baris Non-Tunai
  const handleUpdateReference = (refNo: string) => {
    if (!activeLine) return
    setTenderLines((prev) =>
      prev.map((l) => (l.id === activeLine.id ? { ...l, referenceNumber: refNo } : l))
    )
  }

  // DUKUNGAN KEYBOARD FISIK & NUMPAD PC EKSTERNAL
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSplitBillOpen || isReceiptDetailsOpen) return
      // Jika kasir sedang mengetik nomor referensi di input text, biarkan keyboard biasa bekerja
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return

      const key = e.key

      // Pintasan Alt+1, Alt+2, Alt+3 untuk memilih metode tender secara instan
      if (e.altKey && key >= '1' && key <= '9') {
        const tenderIndex = parseInt(key, 10) - 1
        if (tenderOptions[tenderIndex]) {
          e.preventDefault()
          handleSelectTender(tenderOptions[tenderIndex])
          return
        }
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (key >= '0' && key <= '9') {
        e.preventDefault()
        handleNumpadInput(key)
      } else if (key === 'Backspace') {
        e.preventDefault()
        handleNumpadInput('BACKSPACE')
      } else if (key === 'Delete' || key === 'c' || key === 'C' || key === 'Escape') {
        e.preventDefault()
        handleNumpadInput('CLEAR')
      } else if (key === 'Enter' || key === ' ') {
        e.preventDefault()
        handleConfirm()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSplitBillOpen, isReceiptDetailsOpen, handleNumpadInput, tenderOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Konfirmasi Transaksi Selesai
  const handleConfirm = async () => {
    setErrorMsg(null)

    if (calculation.totalAllocated <= 0) {
      setErrorMsg('Total pembayaran harus lebih besar dari Rp 0.')
      return
    }

    // Periksa apakah ada baris tunai yang uang diterimanya kurang dari nominal alokasi
    const hasInsufficientCash = tenderLines.some(
      (l) => l.category === 'cash' && l.cashReceived < l.amount
    )
    if (hasInsufficientCash) {
      setErrorMsg('Uang tunai yang diterima masih kurang dari nominal pembayaran baris terkait.')
      return
    }

    if (billMode === 'split_item' && activeBillTarget <= 0) {
      setErrorMsg('Pilih minimal satu menu untuk dibayar pada tagihan ini.')
      return
    }

    const effectivePaid = calculation.totalAllocated
    const isPartialOrder = effectivePaid < grandTotal

    const payloadItems: PaymentPayloadItem[] = tenderLines
      .filter((l) => Number(l.amount) > 0)
      .map((l) => {
        const acc = cashBankAccounts.find((a) => a.id === l.accountId)
        const isCash = l.category === 'cash'
        const method: PaymentMethod = isCash ? 'cash' : (l.category === 'qris' ? 'qris' : 'bank')
        const cashRec = isCash ? Number(l.cashReceived || 0) : Number(l.amount)
        const change = isCash ? Math.max(0, cashRec - l.amount) : 0

        return {
          account_id: l.accountId,
          payment_method_account_id: l.accountId,
          account_code: acc?.code || l.accountCode,
          account_name: acc?.name || l.accountName || l.tenderName,
          method,
          is_cash: isCash,
          amount: l.amount,
          cash_received: cashRec,
          change_amount: change,
          reference_number: l.referenceNumber.trim() || undefined,
          notes: `Pembayaran via ${l.tenderName} (${acc?.code || 'COA'})`
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
        cashReceived: calculation.totalCashReceived,
        changeAmount: calculation.totalChange,
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
      console.error('[CashPaymentModal] Payment confirm error:', err)
      setErrorMsg(err.message || 'Gagal memproses pembayaran')
      setIsSubmitting(false)
    }
  }

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
        CONTAINER UTAMA (TABLET LANDSCAPE 10"-12" & DESKTOP — 100dvh ZERO SCROLL)
      */}
      <div className="w-full max-w-[1400px] mx-auto h-[100dvh] max-h-[100dvh] flex flex-col bg-slate-100 text-slate-900 overflow-hidden p-2 sm:p-2.5 lg:p-3">

        {/* 1. TOP NAVBAR HEADER */}
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
              <span className="font-mono font-bold text-xs text-slate-300">
                Nota #{Date.now().toString().slice(-6)}
              </span>
              <span className="text-slate-500 hidden sm:inline">•</span>
              <span className="text-xs text-slate-300 hidden sm:inline">
                Pelanggan: <b className="text-white">Umum (Tamu)</b>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Tombol Pecah Tagihan (Muncul di layar mobile agar kasir tetap bisa akses) */}
            <button
              type="button"
              onClick={() => setIsSplitBillOpen(true)}
              className="lg:hidden px-2.5 py-1 rounded-lg bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <span>✂ Split Tagihan</span>
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
                <span>Kasir: {activeShift.cashier_name || 'Faiz'}</span>
              </span>
            )}
          </div>
        </header>

        {/* 
          2. WORKSPACE 2-PANEL (Rasio 35% Kolom Kiri : 65% Kolom Kanan)
        */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-2.5 overflow-hidden">
          
          {/* ========================================================= */}
          {/* KOLOM KIRI (35%): CONTEXT & BILL                          */}
          {/* ========================================================= */}
          <aside className="hidden lg:flex lg:col-span-4 xl:col-span-4 flex-col bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 shadow-2xs overflow-hidden justify-between">
            
            {/* Header Kolom Nota */}
            <div className="shrink-0 border-b border-slate-100 pb-2 mb-2 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Konteks Pesanan
                </span>
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mt-0.5">
                  <span>Daftar Menu ({cartItems.length} Item)</span>
                </div>
              </div>

              {/* Tombol Split Tagihan (Pecah Item) */}
              <button
                type="button"
                onClick={() => setIsSplitBillOpen(true)}
                className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-xs font-bold border border-slate-200 hover:border-indigo-300 transition flex items-center gap-1 cursor-pointer shadow-2xs"
                title="Pecah tagihan per item atau bagi rata"
              >
                <span>✂</span>
                <span>Split Tagihan</span>
              </button>
            </div>

            {/* Banner Indikator jika Split Bill Aktif */}
            {billMode !== 'full' && (
              <div className="shrink-0 mb-2 p-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold flex items-center justify-between">
                <div>
                  <span className="font-bold block text-[11px]">
                    📌 {billMode === 'split_equal' ? `Bagi Rata (${splitCount} Orang)` : (billMode === 'split_item' ? 'Pecah Menu' : 'Cicilan')}
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

            {/* Daftar Item Nota (Scroll Terisolasi) */}
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
                        !isCheckedForSubBill ? 'opacity-35 line-through' : ''
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

            {/* Ringkasan Finansial Nota */}
            <div className="shrink-0 border-t border-slate-100 pt-2.5 mt-2 space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Subtotal Item</span>
                <span className="font-mono font-semibold text-slate-700">{formatIDR(grandTotal)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Diskon</span>
                <span className="font-mono font-semibold text-slate-700">Rp 0</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Pajak (PB1)</span>
                <span className="font-mono font-semibold text-slate-700">Termasuk</span>
              </div>

              {/* Total Tagihan Box */}
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-baseline justify-between mt-1">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                    {billMode === 'full' ? 'TOTAL TAGIHAN' : 'TAGIHAN SUB-BILL INI'}
                  </span>
                  <span className="text-xl font-black font-mono text-slate-900 tracking-tight">
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
            </div>
          </aside>

          {/* ========================================================= */}
          {/* KOLOM KANAN (65%): ACTION & KEYPAD (ODOO-ENGINE TERMINAL) */}
          {/* ========================================================= */}
          <main className="col-span-1 lg:col-span-8 xl:col-span-8 flex flex-col bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 shadow-2xs overflow-hidden justify-between">
            
            {/* Bagian Atas Kolom Kanan: Pilihan Metode & Baris Aktif */}
            <div className="shrink-0 space-y-2">
              
              {/* 1. CHIPS METODE PEMBAYARAN (Dinamis dari Pengaturan Bisnis) */}
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                  PILIH METODE PEMBAYARAN:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {tenderOptions.map((t) => {
                    const isLineActive = activeLine?.tenderId === t.id || (!activeLine?.tenderId && activeLine?.accountId === t.account_id)
                    const hasLine = tenderLines.some((l) => l.tenderId === t.id || l.accountId === t.account_id)
                    const glyph = CATEGORY_GLYPHS[t.category] || '💳'

                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectTender(t)}
                        className={`p-2 rounded-xl border-2 text-left transition cursor-pointer flex items-center gap-2 min-h-[48px] ${
                          isLineActive
                            ? 'bg-blue-50/90 border-blue-600 text-blue-950 shadow-xs ring-2 ring-blue-500/20'
                            : hasLine
                            ? 'bg-slate-50 border-slate-400 text-slate-900'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <span className="text-xl shrink-0">{glyph}</span>
                        <div className="truncate min-w-0">
                          <div className="font-extrabold text-xs truncate leading-tight">{t.name}</div>
                          <div className={`text-[9px] truncate font-medium ${isLineActive ? 'text-blue-600 font-bold' : 'text-slate-400'}`}>
                            {t.category === 'cash' ? 'Laci Kasir' : (t.category === 'qris' ? 'QRIS' : 'Bank/EDC')}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 2. BARIS PEMBAYARAN AKTIF (MULTI-TENDER ODOO-STYLE) */}
              <div>
                <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                  <span>BARIS PEMBAYARAN AKTIF ({tenderLines.length}):</span>
                  {tenderLines.length > 1 && (
                    <span className="text-indigo-600 lowercase font-semibold">klik baris untuk edit</span>
                  )}
                </div>
                
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {tenderLines.map((line, idx) => {
                    const isFocused = line.id === activeLineId
                    const glyph = CATEGORY_GLYPHS[line.category] || '💳'
                    const isCash = line.category === 'cash'

                    return (
                      <div
                        key={line.id}
                        onClick={() => {
                          setActiveLineId(line.id)
                          setIsFirstTouch(true)
                        }}
                        className={`p-2 rounded-xl border transition flex items-center justify-between cursor-pointer ${
                          isFocused
                            ? 'bg-blue-50/80 border-blue-500 ring-1 ring-blue-500/30 shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 truncate">
                          <span className="text-base shrink-0">{glyph}</span>
                          <div className="truncate">
                            <div className="font-bold text-xs text-slate-900 truncate">
                              #{idx + 1} {line.tenderName}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono truncate">
                              {line.accountCode || 'COA'} {isCash ? `• Diterima: ${formatIDR(line.cashReceived)}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <span className="font-mono font-black text-sm text-slate-900 block">
                              {formatIDR(line.amount)}
                            </span>
                            {isFocused && (
                              <span className="text-[9px] font-bold text-blue-600 block leading-none">
                                [ Terpilih/Edit ]
                              </span>
                            )}
                          </div>

                          {tenderLines.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteLine(line.id, e)}
                              className="w-6 h-6 rounded-lg bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-300 flex items-center justify-center font-black text-xs transition cursor-pointer"
                              title="Hapus baris ini"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Input Nomor Referensi untuk Baris Non-Tunai Aktif */}
              {activeLine && activeLine.category !== 'cash' && (
                <div className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0 pl-1">
                    No. Ref/Kartu:
                  </span>
                  <input
                    type="text"
                    value={activeLine.referenceNumber}
                    onChange={(e) => handleUpdateReference(e.target.value)}
                    placeholder="Contoh: REF-123456 atau Approval Code..."
                    className="flex-1 bg-white border border-slate-300 rounded-lg px-2 py-0.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              )}

              {/* 3. STATUS KALKULASI DUA ARAH: SISA TAGIHAN vs KEMBALIAN */}
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                {/* Kotak Sisa Tagihan */}
                <div className={`p-2 sm:p-2.5 rounded-xl border flex flex-col justify-between ${
                  calculation.remainingBill > 0
                    ? 'bg-amber-50/80 border-amber-300 text-amber-950'
                    : 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                }`}>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider block">
                    SISA TAGIHAN:
                  </span>
                  <div className="font-mono text-sm sm:text-base font-black truncate mt-0.5">
                    {calculation.remainingBill > 0
                      ? formatIDR(calculation.remainingBill)
                      : 'Rp 0 (LUNAS)'}
                  </div>
                </div>

                {/* Kotak Kembalian */}
                <div className={`p-2 sm:p-2.5 rounded-xl border flex flex-col justify-between ${
                  calculation.totalChange > 0
                    ? 'bg-emerald-500 text-white border-emerald-600 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}>
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider block ${
                    calculation.totalChange > 0 ? 'text-emerald-100' : 'text-slate-500'
                  }`}>
                    KEMBALIAN:
                  </span>
                  <div className="font-mono text-sm sm:text-base font-black truncate mt-0.5">
                    {formatIDR(calculation.totalChange)}
                  </div>
                </div>
              </div>

              {/* 4. DYNAMIC QUICK CASH CHIPS (Adaptif) */}
              <div>
                <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                  <span>QUICK CASH (Adaptif):</span>
                  <span className="text-slate-400 font-normal">1-klik isi uang pas/pecahan</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {quickCashChips.map((val, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyQuickCash(val)}
                      className={`py-1.5 px-1 rounded-xl text-xs font-bold font-mono transition cursor-pointer border truncate ${
                        idx === 0
                          ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-900 shadow-2xs'
                          : 'bg-slate-100 hover:bg-slate-200 border-slate-300/80 text-slate-800'
                      }`}
                    >
                      {idx === 0 ? `UANG PAS: ${formatIDR(val)}` : formatIDR(val)}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* 5. KEYPAD NUMERIK (Touch Target Besar >= 54px) */}
            <div className="flex-1 min-h-0 grid grid-cols-4 gap-1.5 my-1.5">
              {/* Baris 1: 1, 2, 3, +10.000 */}
              <button
                type="button"
                onClick={() => handleNumpadInput('1')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                1
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('2')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                2
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('3')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                3
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('+10000')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-xs sm:text-sm font-extrabold text-indigo-900 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-indigo-200 shadow-2xs"
              >
                +10.000
              </button>

              {/* Baris 2: 4, 5, 6, +20.000 */}
              <button
                type="button"
                onClick={() => handleNumpadInput('4')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                4
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('5')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                5
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('6')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                6
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('+20000')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-xs sm:text-sm font-extrabold text-indigo-900 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-indigo-200 shadow-2xs"
              >
                +20.000
              </button>

              {/* Baris 3: 7, 8, 9, +50.000 */}
              <button
                type="button"
                onClick={() => handleNumpadInput('7')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                7
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('8')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                8
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('9')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                9
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('+50000')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-xs sm:text-sm font-extrabold text-indigo-900 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-indigo-200 shadow-2xs"
              >
                +50.000
              </button>

              {/* Baris 4: C (Clear), 0, 000, ⌫ (Backspace) */}
              <button
                type="button"
                onClick={() => handleNumpadInput('CLEAR')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-sm font-black text-rose-700 flex items-center justify-center transition active:scale-95 cursor-pointer border border-rose-200 shadow-2xs"
              >
                C
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('0')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('000')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-white active:bg-slate-200 text-base font-black text-slate-900 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                000
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('BACKSPACE')}
                className="min-h-[54px] rounded-xl sm:rounded-2xl bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-xl font-bold text-amber-800 flex items-center justify-center transition active:scale-95 cursor-pointer border border-amber-200 shadow-2xs"
              >
                ⌫
              </button>
            </div>

            {/* 6. TOMBOL VALIDASI & SELESAIKAN (ENTER / SPASI) */}
            <div className="shrink-0 pt-1">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || calculation.totalAllocated <= 0}
                className={`w-full py-3 sm:py-3.5 rounded-2xl font-black text-sm tracking-wide transition shadow-sm flex items-center justify-center gap-2 cursor-pointer ${
                  isSubmitting || calculation.totalAllocated <= 0
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'
                }`}
              >
                {isSubmitting ? (
                  <span>Memproses Transaksi...</span>
                ) : (
                  <>
                    <span>VALIDASI & SELESAIKAN (Enter / Spasi)</span>
                    <span className="font-mono text-xs bg-emerald-700/80 px-2.5 py-0.5 rounded-full text-emerald-100 font-bold">
                      {formatIDR(calculation.totalAllocated)}
                    </span>
                  </>
                )}
              </button>
            </div>

          </main>

        </div>

        {/* Notifikasi Error Validasi */}
        {errorMsg && (
          <div className="shrink-0 mt-1.5 p-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* POP-UP 1: PECAH TAGIHAN (SPLIT BILL — ITEM / EQUAL / PARTIAL)             */}
      {/* ========================================================================= */}
      {isSplitBillOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-lg bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-3.5 text-slate-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                  <span>✂</span>
                  <span>Pecah Tagihan (Split Bill)</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Pilih menu yang dibayar saat ini atau bagi rata ke beberapa orang
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
      {/* POP-UP 2: RINCIAN STRUK LENGKAP (KHUSUS MOBILE)                          */}
      {/* ========================================================================= */}
      {isReceiptDetailsOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-3.5 text-slate-900 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                <span>🧾</span>
                <span>Rincian Menu Pesanan</span>
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

            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsReceiptDetailsOpen(false)
                  setIsSplitBillOpen(true)
                }}
                className="w-full py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>✂ Split Tagihan</span>
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
