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

  // 2. State Dialog Pop-Up (Semua fitur tambahan dipisah ke pop-up agar layar utama 100% Nol Scroll)
  const [isSplitBillOpen, setIsSplitBillOpen] = useState(false)
  const [isSplitTenderOpen, setIsSplitTenderOpen] = useState(false)
  const [isReceiptDetailsOpen, setIsReceiptDetailsOpen] = useState(false)

  // 3. Akun Kas & Bank dan Metode Tender
  const [fetchedAccounts, setFetchedAccounts] = useState<CashBankAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false)
  const [fetchedCustomTenders, setFetchedCustomTenders] = useState<POSTender[] | null>(null)

  // 4. Baris Pembayaran (Tender Lines)
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([])

  // 5. Target Input Numpad Aktif: 'cashReceived' (Uang Diterima) atau 'amount' (Nominal Tagihan)
  const [activeKeypadTarget, setActiveKeypadTarget] = useState<'cashReceived' | 'amount'>('cashReceived')

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

  // Hitung target tagihan aktif
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

  // Inisialisasi saat modal dibuka
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
      setActiveKeypadTarget('cashReceived')
    }
  }, [isOpen, grandTotal, defaultMode, tenderOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sinkronisasi baris 1 saat target tagihan berubah
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

  // Kalkulasi total alokasi
  const totalTenderAmount = useMemo(() => {
    return tenderLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  }, [tenderLines])

  const totalCashReceived = useMemo(() => {
    return tenderLines.reduce((sum, line) => {
      if (isAccountCash(line.accountId, line.tenderId)) {
        return sum + (Number(line.cashReceived) || Number(line.amount) || 0)
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

  // Baris pembayaran utama
  const primaryLine = tenderLines[0] || {
    id: 'line-1',
    accountId: 'default-pos-cash',
    amount: activeBillTarget,
    cashReceived: activeBillTarget,
    referenceNumber: ''
  }
  const isPrimaryCash = isAccountCash(primaryLine.accountId, primaryLine.tenderId)

  // Pilih Metode Tender
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
          cashReceived: isCash ? Math.max(currentAmt, updated[0].cashReceived || currentAmt) : currentAmt,
          referenceNumber: isCash ? '' : updated[0].referenceNumber
        }
      }
      return updated
    })
    setActiveKeypadTarget(isCash ? 'cashReceived' : 'amount')
  }

  // Update Baris Pembayaran
  const handleUpdateLine = (id: string, updates: Partial<TenderLine>) => {
    setTenderLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...updates } : l))
    )
    setErrorMsg(null)
  }

  // Input Numpad Layar Sentuh
  const handleNumpadInput = (char: string) => {
    if (!primaryLine) return
    const isCash = isPrimaryCash
    const currentNum = activeKeypadTarget === 'cashReceived' ? primaryLine.cashReceived : primaryLine.amount
    let newNum = 0

    if (char === 'CLEAR') {
      newNum = 0
    } else if (char === 'BACKSPACE') {
      const s = String(currentNum || 0)
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

    if (activeKeypadTarget === 'cashReceived') {
      handleUpdateLine(primaryLine.id, { cashReceived: newNum })
    } else {
      handleUpdateLine(primaryLine.id, {
        amount: newNum,
        cashReceived: isCash ? Math.max(primaryLine.cashReceived, newNum) : newNum
      })
    }
  }

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

  const activeTenderObj = tenderOptions.find((t) => t.id === primaryLine.tenderId) || tenderOptions[0]
  const isShortOfCash = isPrimaryCash && primaryLine.cashReceived < primaryLine.amount

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="fullscreen"
      showCloseButton={false}
      className="sm:!h-[100dvh] sm:!max-h-none sm:!rounded-none !bg-[#0b0d11] !text-white border-none select-none font-sans"
      contentClassName="!p-0 !overflow-hidden flex flex-col h-full"
      title={null}
    >
      {/* 
        CONTAINER UTAMA (OPTIMASI TABLET 768px - 1024px & MOBILE)
        Tinggi Terkunci 100dvh — 100% Bebas Scroll
      */}
      <div className="w-full max-w-[1280px] mx-auto h-[100dvh] flex flex-col bg-[#0b0d11] text-white overflow-hidden p-2.5 sm:p-3.5 lg:p-4">

        {/* 1. HEADER BAR TERPADU (Toast Style Top Bar) */}
        <header className="h-11 sm:h-12 shrink-0 flex items-center justify-between border-b border-white/[0.08] px-1 pb-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-xl bg-[#171920] hover:bg-[#22252e] text-gray-300 hover:text-white flex items-center gap-1.5 text-xs font-bold transition border border-white/[0.06] cursor-pointer"
            >
              <span>‹</span>
              <span>Kembali</span>
            </button>

            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-sm sm:text-base tracking-tight text-white">
                {title || 'Pembayaran Kasir'}
              </h2>
              {activeShift && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Shift Aktif</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tombol Lihat Menu (Muncul di layar kecil/ponsel) */}
            <button
              type="button"
              onClick={() => setIsReceiptDetailsOpen(true)}
              className="lg:hidden px-2.5 py-1.5 rounded-xl bg-[#171920] text-xs font-bold text-gray-200 border border-white/[0.08] flex items-center gap-1.5"
            >
              <span>🧾</span>
              <span>Rincian Menu</span>
            </button>

            {unpaidOutsideBill > 0 && (
              <span className="px-2.5 py-1 rounded-lg text-[11px] font-black uppercase bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Sisa Tagihan: {formatIDR(unpaidOutsideBill)}
              </span>
            )}
          </div>
        </header>

        {/* 
          2. WORKSPACE 2-PANEL KHUSUS TABLET (768px - 1024px)
          Panel Kiri: Struk Kasir & Total (38%)
          Panel Kanan: Workstation Numpad & Tender (62%)
        */}
        <div className="flex-1 min-h-0 pt-2.5 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 overflow-hidden">
          
          {/* ========================================================= */}
          {/* PANEL KIRI (38%): STRUK NOTA KASIR & RINGKASAN TAGIHAN    */}
          {/* ========================================================= */}
          <aside className="hidden lg:flex lg:col-span-5 flex-col bg-[#13151b] border border-white/[0.08] rounded-2xl p-4 shadow-2xl overflow-hidden justify-between">
            
            {/* Header Struk Nota */}
            <div className="shrink-0 border-b border-white/[0.06] pb-3 mb-2 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-xs text-gray-400 uppercase tracking-wider">
                    Nota #01
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-300">
                    Kasir POS
                  </span>
                </div>
                <div className="text-xs font-semibold text-gray-400 mt-1">
                  Pelanggan: <span className="text-white font-bold">Umum (Tamu)</span>
                </div>
              </div>

              {/* Tombol Pecah Tagihan (Buka Pop-up) */}
              <button
                type="button"
                onClick={() => setIsSplitBillOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-[#1c1f28] hover:bg-[#252936] text-xs font-bold text-gray-200 border border-white/[0.08] transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>🔀</span>
                <span>Pecah Tagihan</span>
              </button>
            </div>

            {/* Daftar Item Pesanan (Scroll Internal Terisolasi dalam Struk) */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2 divide-y divide-white/[0.04]">
              {cartItems.length === 0 ? (
                <div className="text-xs text-gray-500 py-8 text-center font-medium">
                  Keranjang pesanan kosong.
                </div>
              ) : (
                cartItems.map((item) => (
                  <div key={item.id} className="pt-2 first:pt-0 flex items-start justify-between text-xs">
                    <div className="pr-2">
                      <div className="font-bold text-gray-200 leading-snug">
                        {item.name}
                      </div>
                      {item.variantName && (
                        <div className="text-[11px] text-gray-400 mt-0.5">{item.variantName}</div>
                      )}
                      <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                        {item.quantity} x {formatIDR(item.price)}
                      </div>
                    </div>
                    <div className="font-mono font-bold text-gray-200 shrink-0">
                      {formatIDR(item.price * item.quantity)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Ringkasan Finansial Struk */}
            <div className="shrink-0 border-t border-white/[0.06] pt-3 mt-2 space-y-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Subtotal Pesanan</span>
                <span className="font-mono font-semibold">{formatIDR(grandTotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Pajak & Biaya Layanan</span>
                <span className="font-mono font-semibold">Rp 0</span>
              </div>

              {/* Total Tagihan (Toast Style Grand Display) */}
              <div className="p-3.5 rounded-xl bg-[#0e1015] border border-white/[0.06] flex items-baseline justify-between mt-1">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400 block">
                    Total Tagihan:
                  </span>
                  <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-400 tracking-tight">
                    {formatIDR(activeBillTarget)}
                  </span>
                </div>
                {billMode !== 'full' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    {billMode === 'split_equal' ? `Bagi ${splitCount}x` : (billMode === 'split_item' ? 'Pecah Menu' : 'Uang Muka/DP')}
                  </span>
                )}
              </div>

              {/* Status Metode Terpilih & Kembalian */}
              <div className={`p-2.5 rounded-xl flex items-center justify-between text-xs font-bold border transition ${
                isShortOfCash
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              }`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span>{isPrimaryCash ? '💵' : '💳'}</span>
                  <span className="truncate">{activeTenderObj?.name || 'Metode Pembayaran'}</span>
                </div>
                <span className="font-mono text-sm font-black shrink-0">
                  {isShortOfCash
                    ? `Kurang: ${formatIDR(primaryLine.amount - primaryLine.cashReceived)}`
                    : `Kembalian: ${formatIDR(totalChangeAmount)}`}
                </span>
              </div>

              {/* Tombol Eksekusi Selesaikan Transaksi */}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || totalTenderAmount <= 0}
                className={`w-full py-3.5 rounded-xl font-black text-sm tracking-wide transition shadow-xl flex items-center justify-center gap-2 cursor-pointer ${
                  isSubmitting || totalTenderAmount <= 0
                    ? 'bg-[#1e2129] text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-emerald-950/40'
                }`}
              >
                {isSubmitting ? (
                  <span>Memproses Pembayaran...</span>
                ) : (
                  <>
                    <span>Selesaikan Transaksi</span>
                    <span className="font-mono text-emerald-200">({formatIDR(totalTenderAmount)})</span>
                  </>
                )}
              </button>
            </div>
          </aside>

          {/* ========================================================= */}
          {/* PANEL KANAN (62%): WORKSTATION NUMPAD & TENDER METODE      */}
          {/* ========================================================= */}
          <main className="col-span-1 lg:col-span-7 flex flex-col bg-[#13151b] border border-white/[0.08] rounded-2xl p-3 sm:p-4 shadow-2xl overflow-hidden justify-between">
            
            {/* Baris Atas: Tombol Cepat Pilihan Metode Tender */}
            <div className="shrink-0 space-y-2 mb-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-extrabold uppercase tracking-wider text-gray-400">
                  Pilih Metode Pembayaran:
                </span>
                <button
                  type="button"
                  onClick={() => setIsSplitTenderOpen(true)}
                  className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                >
                  <span>+ Pecah Metode (Split)</span>
                </button>
              </div>

              {/* Grid Metode Bayar Cepat (1-Click Touch Friendly) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                      className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2.5 ${
                        isSelected
                          ? 'bg-[#1b2233] border-blue-500 text-white shadow-md ring-1 ring-blue-500/30'
                          : 'bg-[#171920] hover:bg-[#20232c] border-white/[0.06] text-gray-300'
                      }`}
                    >
                      <span className="text-xl shrink-0">{categoryIcons[t.category] || '💳'}</span>
                      <div className="truncate">
                        <div className="font-extrabold text-xs truncate">{t.name}</div>
                        <div className="text-[10px] text-gray-400 truncate">
                          {t.category === 'cash' ? 'Laci Kasir' : 'Bank'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Dua Kotak Display (Toast Style: Sisa Tagihan & Uang Diterima) */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3 pt-1">
                {/* Kotak 1: Total / Sisa Tagihan */}
                <div
                  onClick={() => setActiveKeypadTarget('amount')}
                  className={`p-2.5 rounded-xl border transition cursor-pointer ${
                    activeKeypadTarget === 'amount'
                      ? 'bg-[#171c28] border-blue-500 ring-2 ring-blue-500/20'
                      : 'bg-[#0f1116] border-white/[0.06]'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                    Total Tagihan
                  </span>
                  <div className="font-mono text-base sm:text-xl font-black text-white truncate mt-0.5">
                    {formatIDR(primaryLine.amount)}
                  </div>
                </div>

                {/* Kotak 2: Uang Diterima Kasir */}
                <div
                  onClick={() => setActiveKeypadTarget('cashReceived')}
                  className={`p-2.5 rounded-xl border transition cursor-pointer ${
                    activeKeypadTarget === 'cashReceived'
                      ? 'bg-[#14231b] border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'bg-[#0f1116] border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                      Uang Diterima
                    </span>
                    {activeKeypadTarget === 'cashReceived' && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    )}
                  </div>
                  <div className="font-mono text-base sm:text-xl font-black text-emerald-400 truncate mt-0.5">
                    {formatIDR(isPrimaryCash ? primaryLine.cashReceived : primaryLine.amount)}
                  </div>
                </div>
              </div>
            </div>

            {/* 
              GRID NUMPAD LAYAR SENTUH (4 BARIS X 4 KOLOM)
              Proporsional, Taktil, Font Tebal Bersih
            */}
            <div className="flex-1 min-h-0 grid grid-cols-4 gap-2 my-1">
              {/* Baris 1: 1, 2, 3, Uang Pas */}
              <button
                type="button"
                onClick={() => handleNumpadInput('1')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                1
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('2')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                2
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('3')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                3
              </button>
              <button
                type="button"
                onClick={() => {
                  handleUpdateLine(primaryLine.id, { cashReceived: activeBillTarget })
                  setActiveKeypadTarget('cashReceived')
                }}
                className="rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-xs sm:text-sm font-bold text-emerald-300 flex flex-col items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-500/20"
              >
                <span className="text-[10px] uppercase font-bold text-emerald-400">Uang Pas</span>
                <span className="font-mono text-xs">{formatIDR(activeBillTarget)}</span>
              </button>

              {/* Baris 2: 4, 5, 6, Pecahan 1 */}
              <button
                type="button"
                onClick={() => handleNumpadInput('4')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                4
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('5')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                5
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('6')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                6
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = quickCashChips[1] || activeBillTarget * 2
                  handleUpdateLine(primaryLine.id, { cashReceived: val })
                  setActiveKeypadTarget('cashReceived')
                }}
                className="rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-xs sm:text-sm font-bold text-emerald-300 flex items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-500/20 font-mono"
              >
                {formatIDR(quickCashChips[1] || activeBillTarget * 2)}
              </button>

              {/* Baris 3: 7, 8, 9, Pecahan 2 */}
              <button
                type="button"
                onClick={() => handleNumpadInput('7')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                7
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('8')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                8
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('9')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                9
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = quickCashChips[2] || (activeBillTarget + 50000)
                  handleUpdateLine(primaryLine.id, { cashReceived: val })
                  setActiveKeypadTarget('cashReceived')
                }}
                className="rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-xs sm:text-sm font-bold text-emerald-300 flex items-center justify-center transition active:scale-95 cursor-pointer border border-emerald-500/20 font-mono"
              >
                {formatIDR(quickCashChips[2] || (activeBillTarget + 50000))}
              </button>

              {/* Baris 4: Reset C, 0, 000, Hapus ⌫ */}
              <button
                type="button"
                onClick={() => handleNumpadInput('CLEAR')}
                className="rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-sm sm:text-base font-bold text-rose-300 flex items-center justify-center transition active:scale-95 cursor-pointer border border-rose-500/20"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('0')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-2xl sm:text-3xl font-extrabold text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06]"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('000')}
                className="rounded-2xl bg-[#1c1f28] hover:bg-[#262a36] text-base sm:text-xl font-black text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/[0.06] font-mono"
              >
                000
              </button>
              <button
                type="button"
                onClick={() => handleNumpadInput('BACKSPACE')}
                className="rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 text-lg sm:text-2xl font-bold text-amber-300 flex items-center justify-center transition active:scale-95 cursor-pointer border border-amber-500/20"
              >
                ⌫
              </button>
            </div>

            {/* Kembalian & Tombol Bayar (Khusus Layar Mobile/Tablet Portrait) */}
            <div className="lg:hidden shrink-0 pt-2 space-y-2">
              <div className={`p-2.5 rounded-xl flex items-center justify-between text-xs font-bold border ${
                isShortOfCash
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              }`}>
                <span>{isShortOfCash ? 'Kurang:' : 'Kembalian:'}</span>
                <span className="font-mono text-base font-black">
                  {isShortOfCash
                    ? `- ${formatIDR(primaryLine.amount - primaryLine.cashReceived)}`
                    : formatIDR(totalChangeAmount)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || totalTenderAmount <= 0}
                className={`w-full py-3.5 rounded-xl font-black text-sm tracking-wide transition shadow-xl flex items-center justify-center gap-2 cursor-pointer ${
                  isSubmitting || totalTenderAmount <= 0
                    ? 'bg-[#1e2129] text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isSubmitting ? 'Memproses...' : `Selesaikan (${formatIDR(totalTenderAmount)})`}
              </button>
            </div>
          </main>

        </div>

        {/* Notifikasi Error Validasi */}
        {errorMsg && (
          <div className="shrink-0 mt-2 p-2.5 bg-rose-500/15 border border-rose-500/30 text-rose-200 rounded-xl text-xs font-bold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* POP-UP 1: PECAH TAGIHAN (SPLIT BILL — 100% BAHASA INDONESIA)              */}
      {/* ========================================================================= */}
      {isSplitBillOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-[#14161d] border border-white/[0.1] rounded-2xl p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                <span>🔀</span>
                <span>Pecah Tagihan (Split Bill)</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsSplitBillOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/[0.06] text-gray-300 hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Pilihan Mode Tagihan */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#0b0d11] rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setBillMode('full')}
                className={`py-2 rounded-lg transition ${billMode === 'full' ? 'bg-[#222632] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Penuh
              </button>
              <button
                type="button"
                onClick={() => setBillMode('split_equal')}
                className={`py-2 rounded-lg transition ${billMode === 'split_equal' ? 'bg-[#222632] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Bagi Rata
              </button>
              <button
                type="button"
                onClick={() => setBillMode('split_item')}
                className={`py-2 rounded-lg transition ${billMode === 'split_item' ? 'bg-[#222632] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Pecah Menu
              </button>
              <button
                type="button"
                onClick={() => setBillMode('partial')}
                className={`py-2 rounded-lg transition ${billMode === 'partial' ? 'bg-[#222632] text-white shadow-xs' : 'text-gray-400 hover:text-white'}`}
              >
                Cicil / DP
              </button>
            </div>

            {/* Konfigurasi Tiap Mode */}
            {billMode === 'split_equal' && (
              <div className="p-4 bg-[#0b0d11] rounded-xl border border-white/[0.06] flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm block">Bagi Rata ke Berapa Orang?</span>
                  <span className="text-xs text-gray-400 mt-0.5 block">
                    {formatIDR(grandTotal)} dibagi {splitCount} = <b className="text-emerald-400">{formatIDR(activeBillTarget)}</b> / orang
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-[#171a22] p-1 rounded-xl border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setSplitCount((p) => Math.max(2, p - 1))}
                    className="w-8 h-8 flex items-center justify-center font-bold text-gray-300 hover:bg-[#252936] rounded-lg cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-sm px-2">{splitCount}</span>
                  <button
                    type="button"
                    onClick={() => setSplitCount((p) => Math.min(20, p + 1))}
                    className="w-8 h-8 flex items-center justify-center font-bold text-gray-300 hover:bg-[#252936] rounded-lg cursor-pointer"
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
                <div className="max-h-52 overflow-y-auto divide-y divide-white/[0.04] border border-white/[0.06] rounded-xl bg-[#0b0d11] p-1">
                  {cartItems.map((item) => (
                    <label key={item.id} className="p-2.5 flex items-center justify-between text-xs cursor-pointer hover:bg-white/[0.02]">
                      <div className="flex items-center gap-2.5">
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
                        <span className="font-bold text-gray-200">{item.name} x{item.quantity}</span>
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
                  Nominal Uang Muka / Cicilan yang Dibayar Hari Ini (Rp):
                </span>
                <input
                  type="text"
                  value={partialAmountInput}
                  onChange={(e) => setPartialAmountInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0b0d11] border border-white/[0.08] font-mono text-base font-bold text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsSplitBillOpen(false)}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs tracking-wider uppercase transition cursor-pointer"
            >
              Terapkan Pemisahan ({formatIDR(activeBillTarget)})
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* POP-UP 2: PECAH METODE BAYAR (SPLIT TENDER)                                */}
      {/* ========================================================================= */}
      {isSplitTenderOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-[#14161d] border border-white/[0.1] rounded-2xl p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                  <span>💳</span>
                  <span>Pecah Metode Pembayaran</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Gunakan lebih dari satu metode bayar untuk 1 transaksi (Tunai + QRIS / EDC)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSplitTenderOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/[0.06] text-gray-300 hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer"
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
                  <div key={line.id} className="p-3.5 bg-[#0b0d11] border border-white/[0.06] rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-300">
                        Pembayaran #{idx + 1}: <span className="text-white">{tenderObj?.name || currentAcc?.name}</span>
                      </span>
                      {tenderLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setTenderLines((p) => p.filter((l) => l.id !== line.id))}
                          className="text-xs text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                        >
                          ✕ Hapus
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-[10px] text-gray-400 font-bold block mb-1">Nominal (Rp):</label>
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
                          className="w-full px-3 py-1.5 rounded-lg bg-[#14161e] border border-white/[0.08] font-mono font-bold text-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 font-bold block mb-1">
                          {isCash ? 'Uang Diterima (Rp):' : 'No. Referensi:'}
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
                          className="w-full px-3 py-1.5 rounded-lg bg-[#14161e] border border-white/[0.08] font-mono text-white text-xs"
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
              className="w-full py-2.5 rounded-xl border border-dashed border-white/[0.15] text-xs font-bold text-blue-400 hover:bg-white/[0.02] transition cursor-pointer"
            >
              + Tambah Metode Pembayaran Lain
            </button>

            <button
              type="button"
              onClick={() => setIsSplitTenderOpen(false)}
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs tracking-wider uppercase transition cursor-pointer"
            >
              Simpan & Tutup
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* POP-UP 3: RINCIAN STRUK LENGKAP (KHUSUS MOBILE)                           */}
      {/* ========================================================================= */}
      {isReceiptDetailsOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#14161d] border border-white/[0.1] rounded-2xl p-5 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                <span>🧾</span>
                <span>Rincian Struk Pesanan</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsReceiptDetailsOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/[0.06] text-gray-300 hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.04] space-y-2">
              {cartItems.map((item) => (
                <div key={item.id} className="pt-2 first:pt-0 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-gray-200">{item.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{item.quantity} x {formatIDR(item.price)}</div>
                  </div>
                  <div className="font-mono font-bold text-gray-200">
                    {formatIDR(item.price * item.quantity)}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/[0.08] pt-3 space-y-1.5 text-xs">
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
              onClick={() => setIsReceiptDetailsOpen(false)}
              className="w-full py-3 rounded-xl bg-[#222632] hover:bg-[#2b3040] text-white font-bold text-xs cursor-pointer"
            >
              Tutup Rincian
            </button>
          </div>
        </div>
      )}

    </FullScreenModal>
  )
}
