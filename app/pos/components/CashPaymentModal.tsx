"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { resolveBusinessTenders, type POSTender } from '@/lib/pos/tenderResolver'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'
import {
  type KeypadTenderLine,
  calculatePaymentBalance,
  processNumpadAction
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
  customerName?: string
  customerPhone?: string
  defaultMode?: 'full' | 'split_item' | 'split_equal' | 'partial' | 'split'
  onConfirmPayment: (result: PaymentResult) => Promise<void> | void
}

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(val || 0))

const formatCompactIDR = (val: number) => {
  if (val >= 1_000_000) {
    const jt = val / 1_000_000
    return `${Number.isInteger(jt) ? jt : jt.toFixed(1)}jt`
  }
  if (val >= 1_000) {
    const k = val / 1_000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  return String(val)
}

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
  customerName = 'Walk-in Customer',
  customerPhone = '',
  defaultMode = 'full',
  onConfirmPayment
}: Props) {
  // 1. Pengaturan Mode Tagihan (Split Bill)
  const initialMode = defaultMode === 'split' ? 'split_equal' : (defaultMode as any)
  const [billMode, setBillMode] = useState<'full' | 'split_item' | 'split_equal' | 'partial'>(initialMode)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [splitCount, setSplitCount] = useState<number>(2)
  const [partialAmountInput, setPartialAmountInput] = useState<string>('')

  // 2. Dialog Pop-Up Terpisah untuk Split Bill, Rincian Pesanan & Keypad Modal Odoo (New Amount)
  const [isSplitBillOpen, setIsSplitBillOpen] = useState(false)
  const [isReceiptDetailsOpen, setIsReceiptDetailsOpen] = useState(false)
  const [isAmountModalOpen, setIsAmountModalOpen] = useState(false)
  const [modalTargetLine, setModalTargetLine] = useState<KeypadTenderLine | null>(null)
  const [modalInputValue, setModalInputValue] = useState<number>(0)
  const [isModalFirstTouch, setIsModalFirstTouch] = useState<boolean>(true)

  // Sub-modal LIFO Back handlers so Back button closes the active dialog first without closing payment modal
  useModalBackHandler(isAmountModalOpen, () => {
    setIsAmountModalOpen(false)
    setModalTargetLine(null)
  })
  useModalBackHandler(isSplitBillOpen, () => setIsSplitBillOpen(false))
  useModalBackHandler(isReceiptDetailsOpen, () => setIsReceiptDetailsOpen(false))

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

  // Saran pecahan uang tunai cerdas (Smart Quick-Cash Suggestions)
  const smartCashSuggestions = useMemo(() => {
    if (activeBillTarget <= 0) return [10000, 20000, 50000, 100000]
    const list: number[] = []

    // 1. Uang Pas (Exact)
    list.push(activeBillTarget)

    // 2. Pembulatan 10k ke atas berikutnya
    const next10k = Math.ceil(activeBillTarget / 10000) * 10000
    if (next10k > activeBillTarget) list.push(next10k)

    // 3. Pembulatan 50k ke atas berikutnya
    const next50k = Math.ceil(activeBillTarget / 50000) * 50000
    if (next50k > activeBillTarget && !list.includes(next50k)) list.push(next50k)

    // 4. Pembulatan 100k ke atas berikutnya
    const next100k = Math.ceil(activeBillTarget / 100000) * 100000
    if (next100k > activeBillTarget && !list.includes(next100k)) list.push(next100k)

    // Jika belum 4 item, tambahkan pecahan umum Indonesia yang lebih besar
    const candidates = [20000, 50000, 100000, 200000, 500000]
    for (const c of candidates) {
      if (c > activeBillTarget && !list.includes(c)) {
        list.push(c)
        if (list.length >= 4) break
      }
    }

    return list.slice(0, 4)
  }, [activeBillTarget])

  // Inisialisasi awal saat modal dibuka
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
      } else if (prev.length > 1) {
        // Skala ulang atau alokasikan kembali baris pertama
        const firstLine = prev[0]
        const otherAllocated = prev.slice(1).reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
        const adjustedFirst = Math.max(0, activeBillTarget - otherAllocated)
        return [
          {
            ...firstLine,
            amount: adjustedFirst,
            cashReceived: firstLine.category === 'cash' ? Math.max(firstLine.cashReceived, adjustedFirst) : adjustedFirst
          },
          ...prev.slice(1)
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

  // TOGGLE METODE PEMBAYARAN: NYALAKAN / MATIKAN DARI PANEL KIRI
  const handleToggleTender = (tender: POSTender) => {
    setErrorMsg(null)

    // 1. Cek apakah metode ini sudah nyala (ada di daftar baris pembayaran)
    const existingIndex = tenderLines.findIndex(
      (l) => l.tenderId === tender.id || l.accountId === tender.account_id
    )

    if (existingIndex >= 0) {
      // METODE SEDANG NYALA: Klik tombol ini akan MEMATIKAN / MENGHAPUS baris pembayaran!
      handleDeleteLine(tenderLines[existingIndex].id)
      return
    }

    // 2. METODE SEDANG MATI: Klik tombol ini akan MENYALAKAN (menambahkan ke baris pembayaran)
    const acc = cashBankAccounts.find((a) => a.id === tender.account_id)
    const currentTotalAllocated = tenderLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
    const unallocated = Math.max(0, activeBillTarget - currentTotalAllocated)

    let newLineAmount = 0
    let updatedLines = [...tenderLines]

    if (unallocated > 0) {
      // Ada sisa yang belum teralokasi: berikan sisa tersebut ke metode baru
      newLineAmount = unallocated
    } else {
      // Tagihan sudah teralokasi 100%:
      if (tenderLines.length === 1) {
        // Jika baru 1 metode (misal Tunai full), bagi 2 agar metode baru langsung aktif teralokasi!
        const half = Math.floor(activeBillTarget / 2)
        updatedLines[0] = {
          ...updatedLines[0],
          amount: half,
          cashReceived: updatedLines[0].category === 'cash' ? Math.max(updatedLines[0].cashReceived, half) : half
        }
        newLineAmount = activeBillTarget - half
      } else {
        // Jika sudah multi-baris, baris baru masuk dengan amount 0 dan menjadi fokus kasir untuk mengetik
        newLineAmount = 0
      }
    }

    const newLineId = 'line-' + Date.now()
    const newLine: KeypadTenderLine = {
      id: newLineId,
      tenderId: tender.id,
      accountId: tender.account_id,
      accountCode: acc?.code,
      accountName: acc?.name,
      tenderName: tender.name,
      category: tender.category,
      amount: newLineAmount,
      cashReceived: newLineAmount,
      referenceNumber: ''
    }

    setTenderLines([...updatedLines, newLine])
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

      // Sisa nominal otomatis didistribusikan kembali ke metode yang tersisa
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

  // Fungsi terpusat mengaplikasikan nilai nominal ke baris pembayaran tertentu
  const applyLineAmount = useCallback((targetLineId: string, nextValue: number) => {
    setTenderLines((prev) => {
      const targetLine = prev.find((l) => l.id === targetLineId)
      if (!targetLine) return prev

      const isCash = targetLine.category === 'cash'

      // Jika mode 2 baris (split 2 metode)
      if (prev.length === 2) {
        const otherIndex = prev.findIndex((l) => l.id !== targetLineId)
        const otherLine = prev[otherIndex]

        if (isCash) {
          const otherAmount = Number(otherLine.amount) || 0
          const neededCash = Math.max(0, activeBillTarget - otherAmount)

          if (nextValue >= neededCash) {
            return prev.map((l) => {
              if (l.id === targetLineId) {
                return { ...l, amount: neededCash, cashReceived: nextValue }
              }
              return l
            })
          } else {
            const newCashAllocated = nextValue
            const newOtherAmount = Math.max(0, activeBillTarget - newCashAllocated)
            return prev.map((l, idx) => {
              if (l.id === targetLineId) {
                return { ...l, amount: newCashAllocated, cashReceived: nextValue }
              }
              if (idx === otherIndex) {
                return {
                  ...otherLine,
                  amount: newOtherAmount,
                  cashReceived: otherLine.category === 'cash' ? Math.max(otherLine.cashReceived, newOtherAmount) : newOtherAmount
                }
              }
              return l
            })
          }
        } else {
          const cappedVal = Math.min(nextValue, activeBillTarget)
          const otherAmount = Math.max(0, activeBillTarget - cappedVal)

          return prev.map((l, idx) => {
            if (l.id === targetLineId) {
              return { ...l, amount: cappedVal, cashReceived: cappedVal }
            }
            if (idx === otherIndex) {
              return {
                ...otherLine,
                amount: otherAmount,
                cashReceived: otherLine.category === 'cash' ? Math.max(otherLine.cashReceived, otherAmount) : otherAmount
              }
            }
            return l
          })
        }
      }

      // Jika baris tunggal atau lebih dari 2 baris
      return prev.map((line) => {
        if (line.id !== targetLineId) return line

        if (line.category === 'cash') {
          const otherTotal = prev
            .filter((l) => l.id !== line.id)
            .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
          const maxAllocatable = Math.max(0, activeBillTarget - otherTotal)
          return {
            ...line,
            amount: Math.min(nextValue, maxAllocatable),
            cashReceived: nextValue
          }
        } else {
          const otherTotal = prev
            .filter((l) => l.id !== line.id)
            .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
          const maxAllocatable = Math.max(0, activeBillTarget - otherTotal)
          const cappedVal = Math.min(nextValue, maxAllocatable)
          return {
            ...line,
            amount: cappedVal,
            cashReceived: cappedVal
          }
        }
      })
    })
  }, [activeBillTarget])

  // Buka Modal Pop-up Odoo "New amount"
  const handleOpenAmountModal = useCallback((line?: KeypadTenderLine, initialDigit?: string) => {
    const target = line || activeLine || tenderLines[0]
    if (!target) return
    setActiveLineId(target.id)
    setModalTargetLine(target)

    if (initialDigit !== undefined) {
      const parsed = parseInt(initialDigit, 10)
      setModalInputValue(isNaN(parsed) ? 0 : parsed)
      setIsModalFirstTouch(false)
    } else {
      const isCash = target.category === 'cash'
      const curVal = isCash ? (target.cashReceived || target.amount) : target.amount
      setModalInputValue(curVal || 0)
      setIsModalFirstTouch(true)
    }

    setIsAmountModalOpen(true)
  }, [activeLine, tenderLines])

  // Aksi Tombol Keypad di Dalam Modal Pop-up Odoo "New amount"
  const handleModalNumpadInput = useCallback((action: string) => {
    const isCash = modalTargetLine?.category === 'cash'
    const { nextValue, nextFirstTouch } = processNumpadAction({
      currentValue: modalInputValue,
      action,
      isFirstTouch: isModalFirstTouch,
      maxLimit: isCash ? 2_000_000_000 : activeBillTarget
    })
    setModalInputValue(nextValue)
    setIsModalFirstTouch(nextFirstTouch)
  }, [modalTargetLine, modalInputValue, isModalFirstTouch, activeBillTarget])

  // Konfirmasi Nilai dari Modal Pop-up Odoo "New amount"
  const handleConfirmAmountModal = useCallback(() => {
    if (modalTargetLine) {
      applyLineAmount(modalTargetLine.id, modalInputValue)
    }
    setIsAmountModalOpen(false)
    setModalTargetLine(null)
  }, [modalTargetLine, modalInputValue, applyLineAmount])

  // Pemilihan Saran Uang Tunai Cepat (1-Tap Quick Cash)
  const handleSelectQuickCash = useCallback((amount: number) => {
    setErrorMsg(null)
    setIsFirstTouch(false)

    setTenderLines((prev) => {
      // Temukan baris tunai jika ada, atau gunakan baris aktif
      let cashIndex = prev.findIndex((l) => l.category === 'cash')

      // Jika belum ada baris tunai sama sekali, buat atau alihkan baris aktif menjadi tunai
      if (cashIndex < 0) {
        const cashTender = tenderOptions.find((t) => t.category === 'cash')
        const acc = cashTender ? cashBankAccounts.find((a) => a.id === cashTender.account_id) : cashBankAccounts[0]
        const newLineId = 'line-' + Date.now()
        const newLine: KeypadTenderLine = {
          id: newLineId,
          tenderId: cashTender?.id,
          accountId: cashTender?.account_id || acc?.id || 'default-pos-cash',
          accountCode: acc?.code,
          accountName: acc?.name,
          tenderName: cashTender?.name || 'Tunai (Laci Kasir)',
          category: 'cash',
          amount: Math.min(activeBillTarget, amount),
          cashReceived: amount,
          referenceNumber: ''
        }
        setActiveLineId(newLineId)
        return [newLine]
      }

      const targetLine = prev[cashIndex]
      const updated = [...prev]

      if (prev.length === 1) {
        updated[0] = {
          ...targetLine,
          amount: activeBillTarget,
          cashReceived: amount
        }
      } else {
        const otherAllocated = prev
          .filter((_, idx) => idx !== cashIndex)
          .reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
        const needed = Math.max(0, activeBillTarget - otherAllocated)

        updated[cashIndex] = {
          ...targetLine,
          amount: needed,
          cashReceived: amount
        }
      }

      setActiveLineId(targetLine.id)
      return updated
    })
  }, [tenderOptions, cashBankAccounts, activeBillTarget])

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
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return

      const key = e.key

      // Jika modal Odoo "New amount" sedang terbuka
      if (isAmountModalOpen) {
        if (key >= '0' && key <= '9') {
          e.preventDefault()
          handleModalNumpadInput(key)
        } else if (key === 'Backspace') {
          e.preventDefault()
          handleModalNumpadInput('BACKSPACE')
        } else if (key === 'Delete' || key === 'c' || key === 'C') {
          e.preventDefault()
          handleModalNumpadInput('CLEAR')
        } else if (key === 'Escape') {
          e.preventDefault()
          setIsAmountModalOpen(false)
          setModalTargetLine(null)
        } else if (key === 'Enter') {
          e.preventDefault()
          handleConfirmAmountModal()
        }
        return
      }

      // Hotkey saat modal utama aktif (New amount belum terbuka)
      if (e.altKey && key >= '1' && key <= '9') {
        const tenderIndex = parseInt(key, 10) - 1
        if (tenderOptions[tenderIndex]) {
          e.preventDefault()
          handleToggleTender(tenderOptions[tenderIndex])
          return
        }
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (key >= '0' && key <= '9') {
        e.preventDefault()
        handleOpenAmountModal(activeLine, key)
      } else if (key === 'Backspace' || key === 'Delete' || key === 'c' || key === 'C') {
        e.preventDefault()
        handleOpenAmountModal(activeLine)
      } else if (key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (key === 'Enter') {
        e.preventDefault()
        handleConfirm()
      } else if (key === ' ' && (e.target === document.body || (e.target as HTMLElement)?.tagName === 'DIV')) {
        e.preventDefault()
        handleConfirm()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isOpen,
    isSplitBillOpen,
    isReceiptDetailsOpen,
    isAmountModalOpen,
    modalInputValue,
    modalTargetLine,
    isModalFirstTouch,
    handleModalNumpadInput,
    handleConfirmAmountModal,
    handleOpenAmountModal,
    tenderOptions,
    activeLine,
    onClose
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  // Konfirmasi Transaksi Selesai
  const handleConfirm = async () => {
    setErrorMsg(null)

    if (calculation.totalAllocated <= 0) {
      setErrorMsg('Total pembayaran harus lebih besar dari Rp 0.')
      return
    }

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
      {/* CONTAINER UTAMA (ODOO POS ARCHITECTURE — 100dvh ZERO SCROLL) */}
      <div className="w-full max-w-[1440px] mx-auto h-[100dvh] max-h-[100dvh] flex flex-col bg-slate-100 text-slate-900 overflow-hidden p-2 sm:p-2.5 lg:p-3">

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
              <span>Batal</span>
            </button>

            <div className="h-3.5 w-px bg-slate-700 hidden sm:block"></div>

            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-xs text-slate-300">
                Nota #{Date.now().toString().slice(-6)}
              </span>
              <span className="text-slate-500 hidden sm:inline">•</span>
              <span className="text-xs text-slate-300 flex items-center gap-1">
                <span>Pelanggan:</span>
                <b className="text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-700/80">
                  {customerName}
                </b>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tombol Lihat Rincian Pesanan (Mudah Diakses di Header) */}
            <button
              type="button"
              onClick={() => setIsReceiptDetailsOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 hover:text-white border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              title="Buka rincian pesanan"
            >
              <span>🧾</span>
              <span>Rincian Pesanan ({cartItems.length})</span>
            </button>

            {/* Tombol Split Tagihan di Header */}
            <button
              type="button"
              onClick={() => setIsSplitBillOpen(true)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                billMode !== 'full'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-700'
              }`}
            >
              <span>✂</span>
              <span>Split Tagihan</span>
              {billMode !== 'full' && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>}
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
          WORKSPACE UTAMA (ODOO-STYLE LAYOUT)
          KOLOM KIRI: ACTION & KEYPAD (38% - md:col-span-5)
          KOLOM KANAN: DISPLAY CANVAS (62% - md:col-span-7)
        */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 sm:landscape:grid-cols-12 gap-2 sm:gap-2.5 overflow-y-auto md:overflow-hidden sm:landscape:overflow-hidden">
          
          {/* ========================================================= */}
          {/* KOLOM KIRI (38%): METODE BAYAR, PECAHAN CEPAT & TRIGGER KEYPAD ODOO */}
          {/* ========================================================= */}
          <aside className="col-span-1 md:col-span-5 sm:landscape:col-span-5 lg:col-span-5 xl:col-span-5 flex flex-col justify-between bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 shadow-2xs overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            
            <div className="space-y-3 shrink-0">
              
              {/* 1. METODE PEMBAYARAN: TOMBOL LEGA & TERBACA UTUH TANPA TERPOTONG */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                  <span>METODE PEMBAYARAN ({tenderLines.length} Nyala):</span>
                  <span className="text-emerald-700 font-bold lowercase">pilih / kombinasi</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {tenderOptions.map((t) => {
                    const lineEntry = tenderLines.find((l) => l.tenderId === t.id || l.accountId === t.account_id)
                    const isTurnedOn = Boolean(lineEntry)
                    const glyph = CATEGORY_GLYPHS[t.category] || '💳'

                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleToggleTender(t)}
                        title={isTurnedOn ? 'Klik untuk mematikan metode ini' : 'Klik untuk mengaktifkan metode ini'}
                        className={`p-2.5 rounded-xl sm:rounded-2xl border text-left transition cursor-pointer flex items-center justify-between min-h-[52px] ${
                          isTurnedOn
                            ? 'bg-emerald-600 border-emerald-700 text-white shadow-2xs ring-2 ring-emerald-500/20'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 truncate">
                          <span className="text-xl shrink-0">{glyph}</span>
                          <div className="min-w-0 flex-1 truncate">
                            <span className={`font-black text-xs sm:text-sm block truncate leading-tight ${isTurnedOn ? 'text-white' : 'text-slate-800'}`}>
                              {t.name}
                            </span>
                            <span className={`text-[10px] sm:text-[11px] block truncate leading-none mt-1 ${isTurnedOn ? 'text-emerald-100 font-mono font-bold' : 'text-slate-400 font-mono'}`}>
                              {lineEntry
                                ? formatIDR(lineEntry.category === 'cash' ? (lineEntry.cashReceived || lineEntry.amount) : lineEntry.amount)
                                : (t.category === 'cash' ? 'Laci Kasir' : (t.category === 'qris' ? 'QRIS POS' : 'Bank'))}
                            </span>
                          </div>
                        </div>

                        {isTurnedOn && (
                          <span className="w-5 h-5 rounded-full bg-white text-emerald-700 flex items-center justify-center text-xs font-black shrink-0 ml-1.5 shadow-2xs">
                            ✓
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 2. SMART QUICK-CASH PILLS (SARAN PECAHAN TUNAI INSTAN - 1 TAP) */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                  <span>PECAHAN CEPAT:</span>
                  <span className="text-emerald-700 font-bold lowercase">1-tap uang pas / pecahan</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {smartCashSuggestions.map((sug, idx) => {
                    const isExact = sug === activeBillTarget
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectQuickCash(sug)}
                        className={`py-2 px-1 rounded-xl sm:rounded-2xl border text-center transition cursor-pointer font-mono font-black active:scale-95 ${
                          isExact
                            ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-950 border-emerald-300 shadow-2xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                        }`}
                        title={isExact ? `Bayar Uang Pas ${formatIDR(sug)}` : `Bayar Pecahan ${formatIDR(sug)}`}
                      >
                        <span className="block text-xs sm:text-sm font-black leading-tight">
                          {formatCompactIDR(sug)}
                        </span>
                        <span className="block text-[9px] text-slate-500 font-sans font-semibold leading-none mt-0.5">
                          {isExact ? 'Uang Pas' : 'Pecahan'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

            </div>

            {/* 3. FOOTER AKSI: BATAL & VALIDATE (TERKUNCI DI DASAR KARTU) */}
            <div className="shrink-0 pt-3 mt-2 border-t border-slate-100">
              <div className="grid grid-cols-5 gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="col-span-2 py-3 rounded-xl sm:rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs sm:text-sm tracking-wide transition cursor-pointer border border-slate-200"
                >
                  Batal
                </button>

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isSubmitting || calculation.totalAllocated <= 0}
                  className={`col-span-3 py-3 rounded-xl sm:rounded-2xl font-black text-xs sm:text-sm tracking-wider uppercase transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer ${
                    isSubmitting || calculation.totalAllocated <= 0
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-[#714B67] hover:bg-[#5e3e56] active:bg-[#4d3246] text-white shadow-purple-900/20'
                  }`}
                >
                  {isSubmitting ? 'Memproses...' : 'Validate'}
                </button>
              </div>

              <div className="mt-2 text-center text-[10px] text-slate-400 font-medium">
                <span>Shortcut: </span>
                <span className="font-mono font-bold text-slate-600">Enter</span>
                <span> = Validate • </span>
                <span className="font-mono font-bold text-slate-600">0-9</span>
                <span> = Keypad</span>
              </div>
            </div>

          </aside>

          {/* ========================================================= */}
          {/* KOLOM KANAN (62%): DISPLAY & PAYMENT LINES (ODOO CANVAS)  */}
          {/* ========================================================= */}
          <main className="col-span-1 md:col-span-7 sm:landscape:col-span-7 lg:col-span-7 xl:col-span-7 flex flex-col bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:p-3.5 lg:p-4 shadow-2xs overflow-hidden justify-between">
            
            {/* TOTAL TAGIHAN RAKSASA DI BAGIAN ATAS (HIJAU TEBAL SEPERTI ODOO) */}
            <div className="text-center py-1.5 sm:py-2.5 border-b border-slate-100 shrink-0">
              <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400 block">
                {billMode === 'full' ? 'TOTAL TAGIHAN' : 'TAGIHAN SUB-BILL'}
              </span>
              <div className="text-3xl sm:text-4xl lg:text-5xl font-black font-mono text-emerald-600 tracking-tight mt-0.5 sm:mt-1">
                {formatIDR(activeBillTarget)}
              </div>
            </div>

            {/* BANNER SPLIT BILL (JIKA SEDANG AKTIF) */}
            {billMode !== 'full' && (
              <div className="shrink-0 my-1.5 p-2 sm:p-2.5 px-3 rounded-xl sm:rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950 flex items-center justify-between text-xs shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="text-base sm:text-lg">📌</span>
                  <div>
                    <span className="font-extrabold text-xs block">
                      {billMode === 'split_equal'
                        ? `Split Tagihan: Bagi Rata (${splitCount} Orang)`
                        : billMode === 'split_item'
                        ? `Split Tagihan: Pecah Menu (${selectedItemIds.size} Item Dipilih)`
                        : 'Split Tagihan: Cicilan / DP'}
                    </span>
                    <span className="text-[11px] text-indigo-700">
                      Sisa piutang pesanan: <b>{formatIDR(unpaidOutsideBill)}</b>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsSplitBillOpen(true)}
                    className="px-2.5 py-1 rounded-xl bg-white hover:bg-indigo-100 text-indigo-800 border border-indigo-300 font-bold text-xs cursor-pointer"
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillMode('full')}
                    className="px-2.5 py-1 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            {/* AREA STATUS DUA ARAH & BARIS MULTI-TENDER (SEAMLESS CLEAN LIST MENYATU DENGAN BOX UTAMA) */}
            <div className="flex-1 min-h-0 flex flex-col justify-start py-1.5 sm:py-2 space-y-2 sm:space-y-3 max-w-xl mx-auto w-full">
              
              {/* KOTAK STATUS DUA ARAH (REMAINING ATAU KEMBALIAN) */}
              <div className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border flex items-center justify-between text-xs sm:text-base font-black transition shadow-2xs ${
                calculation.totalChange > 0
                  ? 'bg-emerald-500 border-emerald-600 text-white'
                  : calculation.remainingBill > 0
                  ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                  : 'bg-emerald-100 border-emerald-400 text-emerald-900'
              }`}>
                <span className="uppercase tracking-wider text-[11px] sm:text-sm font-extrabold">
                  {calculation.totalChange > 0 ? 'Kembalian (Change):' : 'Sisa Tagihan (Remaining):'}
                </span>
                <span className="font-mono text-base sm:text-xl font-black">
                  {calculation.totalChange > 0
                    ? formatIDR(calculation.totalChange)
                    : formatIDR(calculation.remainingBill)}
                </span>
              </div>

              {/* DAFTAR BARIS PEMBAYARAN AKTIF MULTI-TENDER (FLAT SEAMLESS TANPA SCROLLBAR KAKU) */}
              <div className="flex-1 min-h-0 divide-y divide-slate-100 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden my-0.5 sm:my-1 pr-0.5">
                {tenderLines.map((line) => {
                  const isFocused = line.id === activeLineId
                  const glyph = CATEGORY_GLYPHS[line.category] || '💳'
                  const isCash = line.category === 'cash'
                  const displayAmount = isCash ? (line.cashReceived || line.amount) : line.amount

                  return (
                    <div key={line.id} className="py-1">
                      <div
                        onClick={() => {
                          setActiveLineId(line.id)
                          setIsFirstTouch(true)
                        }}
                        className={`p-2.5 sm:p-3 sm:px-3.5 rounded-xl transition flex items-center justify-between cursor-pointer ${
                          isFocused
                            ? 'bg-emerald-50/90 text-emerald-950 font-medium ring-2 ring-emerald-500/20 shadow-2xs'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                          <span className="text-xl sm:text-2xl">{glyph}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-xs sm:text-sm text-slate-900 block leading-tight">
                                {line.tenderName}
                              </span>
                              {isFocused && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-600 text-white shadow-2xs">
                                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                  <span>Diedit</span>
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] sm:text-[11px] text-slate-500 font-mono block mt-0.5">
                              {line.accountCode || 'COA'}
                              {isCash && line.cashReceived > line.amount ? (
                                <span className="text-emerald-700 font-semibold ml-1.5">
                                  (Alokasi Tagihan: {formatIDR(line.amount)})
                                </span>
                              ) : null}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 sm:gap-2.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleOpenAmountModal(line)
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 active:bg-purple-200 border border-purple-200 text-purple-950 font-mono font-black text-sm sm:text-base flex items-center gap-1.5 transition shadow-2xs group cursor-pointer"
                            title="Klik untuk mengubah nominal dengan keypad pop-up Odoo"
                          >
                            <span>{formatIDR(displayAmount)}</span>
                            <span className="text-[11px] text-purple-600 group-hover:scale-110 transition">✏️</span>
                          </button>

                          {tenderLines.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteLine(line.id, e)}
                              className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl hover:bg-rose-100 text-slate-400 hover:text-rose-600 flex items-center justify-center font-bold text-xs sm:text-sm transition cursor-pointer"
                              title="Hapus metode ini"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Input Referensi jika Baris Non-Tunai Sedang Terfokus */}
                      {isFocused && line.category !== 'cash' && (
                        <div className="flex items-center gap-2 px-3 py-1.5 mt-1 bg-slate-50 rounded-lg animate-in fade-in">
                          <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">
                            No. Ref / Approval:
                          </span>
                          <input
                            type="text"
                            value={line.referenceNumber}
                            onChange={(e) => handleUpdateReference(e.target.value)}
                            placeholder="Contoh: REF-123456..."
                            className="flex-1 bg-white border border-slate-300 rounded px-2 py-0.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

            </div>

            {/* FOOTER CANVAS KANAN */}
            <div className="shrink-0 border-t border-slate-100 pt-1.5 sm:pt-2 flex items-center justify-between text-[11px] sm:text-xs text-slate-500 font-medium">
              <span>Total Terbayar: <b className="font-mono text-slate-900">{formatIDR(calculation.totalAllocated)}</b></span>
              <span>Status: <b className={calculation.isFullyCovered ? 'text-emerald-700' : 'text-amber-700'}>{calculation.statusLabel}</b></span>
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

      {/* POP-UP SPLIT BILL (ITEM-LEVEL / EQUAL / PARTIAL) */}
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

      {/* POP-UP RINCIAN STRUK LENGKAP */}
      {isReceiptDetailsOpen && (
        <div className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-3.5 text-slate-900 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                <span>🧾</span>
                <span>Rincian Pesanan</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsReceiptDetailsOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 hover:text-slate-900 flex items-center justify-center font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">Pelanggan:</span>
              <span className="font-black text-slate-900 text-sm">{customerName}</span>
              {customerPhone && <span className="font-mono text-slate-500 block text-[10px]">{customerPhone}</span>}
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

      {/* 4. POP-UP MODAL NUMPAD ODOO (NEW AMOUNT POPUP DIALOG) */}
      {isAmountModalOpen && (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-sm sm:max-w-md bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3.5 text-slate-900 animate-in zoom-in-95">
            {/* Header: Judul New amount & Tombol Silang */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-1.5">
                  <span>New amount</span>
                </h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  {modalTargetLine?.tenderName || 'Metode Pembayaran'}
                  {modalTargetLine?.category === 'cash' ? ' (Uang Diterima)' : ' (Alokasi Tagihan)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAmountModalOpen(false)
                  setModalTargetLine(null)
                }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 flex items-center justify-center font-bold text-sm transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Display Input Nominal Besar (Odoo POS Style Bersih & Terbaca Utuh) */}
            <div className="w-full bg-slate-50 border-2 border-purple-200 focus-within:border-[#714B67] rounded-2xl p-2.5 sm:p-3 px-3 sm:px-4 flex items-center justify-between transition shadow-inner">
              <span className="text-xs sm:text-sm font-bold text-slate-400 font-mono">Rp</span>
              <span className="text-2xl sm:text-3xl font-black font-mono text-slate-900 tracking-tight">
                {modalInputValue.toLocaleString('id-ID')}
              </span>
            </div>

            {/* Keypad Numpad 4x4 Grid Odoo */}
            <div className="grid grid-cols-4 grid-rows-4 gap-1.5 sm:gap-2">
              {/* Row 1: 1, 2, 3, +10k */}
              <button
                type="button"
                onClick={() => handleModalNumpadInput('1')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                1
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('2')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                2
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('3')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                3
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('+10000')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-emerald-100 hover:bg-emerald-200 active:bg-emerald-300 text-xs sm:text-sm font-extrabold text-emerald-950 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-300 shadow-2xs"
              >
                +10k
              </button>

              {/* Row 2: 4, 5, 6, +20k */}
              <button
                type="button"
                onClick={() => handleModalNumpadInput('4')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                4
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('5')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                5
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('6')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                6
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('+20000')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-emerald-100 hover:bg-emerald-200 active:bg-emerald-300 text-xs sm:text-sm font-extrabold text-emerald-950 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-300 shadow-2xs"
              >
                +20k
              </button>

              {/* Row 3: 7, 8, 9, +50k */}
              <button
                type="button"
                onClick={() => handleModalNumpadInput('7')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                7
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('8')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                8
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('9')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                9
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('+50000')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-emerald-100 hover:bg-emerald-200 active:bg-emerald-300 text-xs sm:text-sm font-extrabold text-emerald-950 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-300 shadow-2xs"
              >
                +50k
              </button>

              {/* Row 4: C, 0, 000, ⌫ */}
              <button
                type="button"
                onClick={() => handleModalNumpadInput('CLEAR')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-xs sm:text-sm font-black text-rose-700 flex items-center justify-center transition active:scale-95 cursor-pointer border border-rose-200 shadow-2xs"
              >
                C
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('0')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-xl sm:text-2xl font-black text-slate-900 flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('000')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-sm sm:text-base font-black text-slate-900 font-mono flex items-center justify-center transition active:scale-95 cursor-pointer border border-slate-200 shadow-2xs"
              >
                000
              </button>
              <button
                type="button"
                onClick={() => handleModalNumpadInput('BACKSPACE')}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-rose-100 hover:bg-rose-200 active:bg-rose-300 text-lg sm:text-xl font-black text-rose-800 flex items-center justify-center transition active:scale-95 cursor-pointer border border-rose-300 shadow-2xs"
              >
                ⌫
              </button>
            </div>

            {/* Footer Aksi Odoo: Confirm & Discard */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleConfirmAmountModal}
                className="w-full py-3 rounded-2xl bg-[#714B67] hover:bg-[#5e3e56] active:bg-[#4d3246] text-white font-extrabold text-sm tracking-wide shadow-md shadow-purple-950/20 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAmountModalOpen(false)
                  setModalTargetLine(null)
                }}
                className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-sm tracking-wide transition cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

    </FullScreenModal>
  )
}
