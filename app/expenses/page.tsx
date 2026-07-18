"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { ExpenseDetailModal } from './components/ExpenseDetailModal'

const STANDARD_CATEGORIES = [
  { key: 'marketing', name: 'Pemasaran & Promosi', code: '503100', icon: '📢', desc: 'Biaya iklan, sosmed, brosur, promo' },
  { key: 'utilities', name: 'Utilitas (Listrik/Air/Internet)', code: '503200', icon: '⚡', desc: 'Listrik, air, wifi, pulsa, telepon' },
  { key: 'salaries', name: 'Gaji & Upah Karyawan', code: '503300', icon: '👥', desc: 'Gaji, bonus, lemburan staf' },
  { key: 'supplies', name: 'Perlengkapan Kantor & ATK', code: '503400', icon: '✏️', desc: 'Kertas, pulpen, printer, ATK' },
  { key: 'travel', name: 'Transportasi & Perjalanan', code: '503500', icon: '🚗', desc: 'Bensin, tol, parkir, dinas luar' },
  { key: 'rent', name: 'Sewa Tempat & Fasilitas', code: '503600', icon: '🏢', desc: 'Sewa ruko, gedung, alat' },
  { key: 'repairs', name: 'Pemeliharaan & Perbaikan', code: '503700', icon: '🔧', desc: 'Servis AC, renovasi, perbaikan' },
  { key: 'taxes', name: 'Pajak & Perizinan', code: '503800', icon: '⚖️', desc: 'Pajak usaha, legalitas, izin' },
  { key: 'entertainment', name: 'Konsumsi & Hiburan', code: '503900', icon: '☕', desc: 'Makan rapat, konsumsi, jamuan' },
  { key: 'bank_fees', name: 'Admin Bank & Bunga', code: '504000', icon: '🏦', desc: 'Biaya admin, transfer fee, bunga' },
  { key: 'equipment', name: 'Inventaris & Peralatan (CAPEX)', code: '120000', icon: '💻', desc: 'Laptop, HP, printer, meja, kursi' },
  { key: 'operational', name: 'Beban Operasional Lainnya', code: '503000', icon: '💼', desc: 'Biaya umum operasional lainnya' }
]

const getCategoryDisplay = (account: { code: string; name: string } | null | undefined) => {
  if (!account) return { name: '-', icon: '💸', color: 'text-gray-500 bg-gray-50 border-gray-100' }
  const std = STANDARD_CATEGORIES.find(c => c.code === account.code)
  if (std) {
    return {
      name: std.name,
      icon: std.icon,
      color: 'text-blue-700 bg-blue-50 border-blue-100'
    }
  }
  return {
    name: account.name,
    icon: '⚙️',
    color: 'text-amber-700 bg-amber-50 border-amber-100'
  }
}

type Account = {
  id: string
  code: string
  name: string
  type: string
}

type Expense = {
  id: string
  business_id: string
  transaction_id: string | null
  category_account_id: string
  payment_account_id: string
  amount: number
  date: string
  description: string | null
  vendor_name: string | null
  attachment_url: string | null
  created_at: string
  payment_status: 'paid' | 'unpaid' | 'partial'
  due_date: string | null
  amount_paid: number
  outstanding_amount: number
  category_account?: { id: string; code: string; name: string } | null
  payment_account?: { id: string; code: string; name: string } | null
  expense_payments?: { id: string }[] | null
}

export default function ExpensesPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [bgUpdating, setBgUpdating] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [selectedExpenseForDetail, setSelectedExpenseForDetail] = useState<Expense | null>(null)

  // Filters State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryAcc, setSelectedCategoryAcc] = useState('')
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('')

  // Outstanding Payment Modal State
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)
  const [payExpense, setPayExpense] = useState<Expense | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])
  const [payPaymentAccountId, setPayPaymentAccountId] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [paySubmitLoading, setPaySubmitLoading] = useState(false)

  // Bulk Action & Payment States
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBulkPayModalOpen, setIsBulkPayModalOpen] = useState(false)
  const [bulkPayDate, setBulkPayDate] = useState(new Date().toISOString().split('T')[0])
  const [bulkPayPaymentAccountId, setBulkPayPaymentAccountId] = useState('')
  const [bulkPayNotes, setBulkPayNotes] = useState('')
  const [bulkPaySubmitLoading, setBulkPaySubmitLoading] = useState(false)



  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch Page Data
  const fetchData = useCallback(async (businessId: string, isSilent = false) => {
    if (!isSilent) setLoading(true)
    setBgUpdating(true)
    try {
      // Parallelize fetches of expenses list and accounts for speed
      const [expRes, accRes] = await Promise.all([
        fetch('/api/expenses'),
        supabase
          .from('accounts')
          .select('id, code, name, type')
          .eq('business_id', businessId)
          .order('code', { ascending: true })
      ])

      let freshExpenses: Expense[] = []
      let freshAccounts: Account[] = []

      if (expRes.ok) {
        freshExpenses = await expRes.json()
        setExpenses(freshExpenses)
      } else {
        throw new Error('Gagal memuat data pengeluaran')
      }

      if (!accRes.error && accRes.data) {
        freshAccounts = accRes.data
        setAccounts(freshAccounts)
      } else if (accRes.error) {
        throw accRes.error
      }

      // Save to cache for instant load next time
      localStorage.setItem(`cache_expenses_${businessId}`, JSON.stringify(freshExpenses))
      localStorage.setItem(`cache_accounts_${businessId}`, JSON.stringify(freshAccounts))
    } catch (err) {
      console.error('Error fetching expenses page data:', err)
    } finally {
      setLoading(false)
      setBgUpdating(false)
    }
  }, [supabase])

  // Load Active Business Profile and initiate SWR cache loading
  useEffect(() => {
    async function initProfileAndCache() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('active_business_id, businesses!active_business_id(name)')
          .eq('id', user.id)
          .single()

        if (error) throw error

        const businessId = profile?.active_business_id
        if (businessId) {
          setActiveBizId(businessId)
          const biz = Array.isArray(profile.businesses) ? profile.businesses[0] : profile.businesses
          setActiveBizName(biz?.name || 'Bisnis Saya')

          // ── STALE-WHILE-REVALIDATE PATTERN ──
          // 1. Immediately read from localStorage cache to present data instantly
          const cachedExpenses = localStorage.getItem(`cache_expenses_${businessId}`)
          const cachedAccounts = localStorage.getItem(`cache_accounts_${businessId}`)

          let hasCache = false
          if (cachedExpenses) {
            try {
              setExpenses(JSON.parse(cachedExpenses))
              hasCache = true
            } catch (e) {
              console.error('Error parsing cached expenses:', e)
            }
          }
          if (cachedAccounts) {
            try {
              setAccounts(JSON.parse(cachedAccounts))
              hasCache = true
            } catch (e) {
              console.error('Error parsing cached accounts:', e)
            }
          }

          // If we had cached data, stop showing the full page loading spinner
          if (hasCache) {
            setLoading(false)
          }

          // 2. Fetch fresh data in the background and update the state/cache silently
          await fetchData(businessId, hasCache)
        }
      } catch (err) {
        console.error('Error loading profile:', err)
        setLoading(false)
      }
    }
    initProfileAndCache()
  }, [supabase, fetchData])

  const paymentAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  }, [accounts])

  // Filtered Expenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      const matchesSearch = 
        (e.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.vendor_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.category_account?.name || '').toLowerCase().includes(searchQuery.toLowerCase())

      const matchesCat = selectedCategoryAcc ? e.category_account_id === selectedCategoryAcc : true
      const matchesStatus = selectedPaymentStatus ? e.payment_status === selectedPaymentStatus : true

      return matchesSearch && matchesCat && matchesStatus
    })
  }, [expenses, searchQuery, selectedCategoryAcc, selectedPaymentStatus])

  const selectableExpenses = filteredExpenses

  const isAllSelected = useMemo(() => {
    if (selectableExpenses.length === 0) return false
    return selectableExpenses.every(e => selectedIds.includes(e.id))
  }, [selectableExpenses, selectedIds])

  const handleSelectAll = () => {
    if (isAllSelected) {
      const selectableIds = selectableExpenses.map(e => e.id)
      setSelectedIds(prev => prev.filter(id => !selectableIds.includes(id)))
    } else {
      const selectableIds = selectableExpenses.map(e => e.id)
      setSelectedIds(prev => Array.from(new Set([...prev, ...selectableIds])))
    }
  }

  const handleSelectRow = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const selectedOutstandingExpenses = useMemo(() => {
    return expenses.filter(e => selectedIds.includes(e.id) && (e.outstanding_amount || 0) > 0.01)
  }, [expenses, selectedIds])

  const totalBulkPayAmount = useMemo(() => {
    return selectedOutstandingExpenses.reduce((acc, e) => acc + (e.outstanding_amount || 0), 0)
  }, [selectedOutstandingExpenses])

  const openBulkPayModal = () => {
    setBulkPayDate(new Date().toISOString().split('T')[0])
    setBulkPayPaymentAccountId('')
    setBulkPayNotes('')
    setIsBulkPayModalOpen(true)
  }

  const handleBulkPaySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedOutstandingExpenses.length === 0) {
      alert('Tidak ada pengeluaran bertempo/belum lunas yang perlu dibayar!')
      return
    }

    if (!bulkPayPaymentAccountId || !bulkPayDate) {
      alert('Mohon lengkapi semua kolom wajib!')
      return
    }

    setBulkPaySubmitLoading(true)
    try {
      const res = await fetch('/api/expenses/bulk-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseIds: selectedOutstandingExpenses.map(item => item.id),
          paymentMethodAccountId: bulkPayPaymentAccountId,
          date: bulkPayDate,
          notes: bulkPayNotes
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal memproses pembayaran sekaligus')
      }

      const result = await res.json()
      alert(result.message || 'Pembayaran sekaligus berhasil diproses!')

      setIsBulkPayModalOpen(false)
      setSelectedIds([])
      if (activeBizId) {
        await fetchData(activeBizId, true)
      }
    } catch (err: any) {
      console.error('Error bulk paying expenses:', err)
      alert(err.message)
    } finally {
      setBulkPaySubmitLoading(false)
    }
  }

  // Open outstanding payment modal
  const openPayModal = (expense: Expense) => {
    setPayExpense(expense)
    setPayAmount(expense.outstanding_amount?.toString() || '')
    setPayDate(new Date().toISOString().split('T')[0])
    setPayPaymentAccountId('')
    setPayNotes('')
    setIsPayModalOpen(true)
  }

  // Handle Outstanding Payment Submission
  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payExpense || !payPaymentAccountId || !payAmount || !payDate) {
      alert('Mohon lengkapi semua kolom wajib!')
      return
    }

    const numAmount = parseFloat(payAmount)
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('Masukkan nominal pembayaran yang valid!')
      return
    }

    if (numAmount > payExpense.outstanding_amount + 0.01) {
      alert(`Nominal pembayaran tidak boleh melebihi sisa hutang (${formatPrice(payExpense.outstanding_amount)})!`)
      return
    }

    setPaySubmitLoading(true)
    try {
      const res = await fetch(`/api/expenses/${payExpense.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numAmount,
          payment_method_account_id: payPaymentAccountId,
          date: payDate,
          notes: payNotes
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal merekam pembayaran')
      }

      setIsPayModalOpen(false)
      if (activeBizId) {
        await fetchData(activeBizId, true)
      }
    } catch (err: any) {
      console.error('Error paying expense:', err)
      alert(err.message)
    } finally {
      setPaySubmitLoading(false)
    }
  }

  // Handle Delete
  const handleDelete = async (id: string) => {
    const exp = expenses.find(e => e.id === id)
    if (exp && exp.expense_payments && exp.expense_payments.length > 0) {
      alert('Pengeluaran tidak dapat dihapus/dibatalkan karena sudah memiliki riwayat pembayaran cicilan. Silakan hapus pembayaran cicilan terlebih dahulu.')
      return
    }

    const isLunas = exp?.payment_status === 'paid'
    const confirmMsg = isLunas
      ? 'Apakah Anda yakin ingin membatalkan pengeluaran yang sudah lunas ini? Tindakan ini akan menghapus catatan pengeluaran beserta jurnal terkait.'
      : 'Apakah Anda yakin ingin menghapus catatan pengeluaran ini? Penghapusan akan membatalkan jurnal terkait.'

    if (!confirm(confirmMsg)) return

    try {
      const res = await fetch(`/api/expenses?id=${id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menghapus pengeluaran')
      }

      if (activeBizId) {
        await fetchData(activeBizId, true)
      }
    } catch (err: any) {
      console.error('Error deleting expense:', err)
      alert(err.message)
    }
  }

  const formatPrice = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val)
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Page Header */}
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Pembelian & Pengeluaran
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 uppercase">
                📍 {activeBizName}
              </span>
            )}
            {bgUpdating && (
              <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full animate-pulse">
                🔄 Menyinkronkan...
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight leading-none uppercase">
            Pengeluaran Umum
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Catat pengeluaran biaya operasional (OPEX) maupun pembelian aset (CAPEX) dengan double-entry ledger otomatis.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <Link
            href="/expenses/import"
            className="w-full md:w-auto px-5 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
          >
            📥 Import Pengeluaran
          </Link>
          <Link
            href="/expenses/new"
            className="w-full md:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
          >
            ➕ Catat Pengeluaran
          </Link>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Cari deskripsi, vendor, atau kategori pengeluaran..."
            className="w-full p-2.5 pl-8 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-gray-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3 top-3.5 text-gray-400 text-xs">🔍</span>
        </div>

        <div className="w-full md:w-48">
          <select
            className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
            value={selectedPaymentStatus}
            onChange={e => setSelectedPaymentStatus(e.target.value)}
          >
            <option value="">Semua Status Bayar</option>
            <option value="paid">🟢 Lunas</option>
            <option value="unpaid">🔴 Tempo</option>
            <option value="partial">🟡 Bayar Sebagian (DP)</option>
          </select>
        </div>

        <div className="w-full md:w-64">
          <select
            className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
            value={selectedCategoryAcc}
            onChange={e => setSelectedCategoryAcc(e.target.value)}
          >
            <option value="">Semua Kategori Pengeluaran</option>
            <optgroup label="Kategori Standar">
              {STANDARD_CATEGORIES.map(cat => {
                const acc = accounts.find(a => a.code === cat.code)
                if (!acc) return null
                return (
                  <option key={acc.id} value={acc.id}>
                    {cat.icon} {cat.name}
                  </option>
                )
              })}
            </optgroup>
            {/* Custom categories */}
            {accounts.filter(a => 
              (a.type === 'EXPENSE' || (a.type === 'ASSET' && !a.code.startsWith('101') && !a.code.startsWith('102'))) &&
              !STANDARD_CATEGORIES.map(c => c.code).includes(a.code)
            ).length > 0 && (
              <optgroup label="Akun Kustom / COA">
                {accounts.filter(a => 
                  (a.type === 'EXPENSE' || (a.type === 'ASSET' && !a.code.startsWith('101') && !a.code.startsWith('102'))) &&
                  !STANDARD_CATEGORIES.map(c => c.code).includes(a.code)
                ).map(a => (
                  <option key={a.id} value={a.id}>
                    ⚙️ ({a.code}) {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3 animate-in slide-in-from-top duration-250">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-blue-900">
              {selectedIds.length} pengeluaran terpilih
            </span>
            <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full font-bold">
              Total Sisa Hutang: {formatPrice(totalBulkPayAmount)}
            </span>
          </div>
          <div className="flex gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => setSelectedIds([])}
              className="px-4 py-2 border border-blue-300 text-blue-700 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-blue-100/50 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              onClick={() => openBulkPayModal()}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 cursor-pointer flex items-center gap-1.5"
            >
              💵 Bayar Sekaligus
            </button>
          </div>
        </div>
      )}

      {/* Expenses Table */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Memuat data pengeluaran...
        </div>
      ) : expenses.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-xs">
          <span className="text-3xl">💸</span>
          <h3 className="text-sm font-extrabold text-gray-800 mt-2 uppercase tracking-wide">Belum ada pengeluaran</h3>
          <p className="text-xs text-gray-400 mt-1">Catat biaya operasional atau utilitas bisnis pertama Anda di sini.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                  <th className="p-4 w-10">
                    <input 
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      checked={isAllSelected}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th className="p-4">Tanggal / Vendor</th>
                  <th className="p-4">Deskripsi</th>
                  <th className="p-4">Kategori Akun</th>
                  <th className="p-4">Cara Bayar</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Nominal</th>
                  <th className="p-4">Kuitansi</th>
                  <th className="p-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                {filteredExpenses.map(e => (
                  <tr 
                    key={e.id} 
                    className={`hover:bg-gray-50/50 transition-colors cursor-pointer ${selectedIds.includes(e.id) ? 'bg-blue-50/30' : ''}`}
                    onClick={() => setSelectedExpenseForDetail(e)}
                  >
                    <td className="p-4 w-10" onClick={e => e.stopPropagation()}>
                      <input 
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        checked={selectedIds.includes(e.id)}
                        onChange={() => handleSelectRow(e.id)}
                      />
                    </td>
                    <td className="p-4 space-y-0.5">
                      <div className="text-gray-900 font-bold">{e.date}</div>
                      <div className="text-gray-500 text-[10px] uppercase font-black">{e.vendor_name || 'Tanpa Vendor'}</div>
                    </td>
                    <td className="p-4 text-gray-600 max-w-xs break-words">{e.description || '-'}</td>
                    <td className="p-4">
                      {e.category_account ? (
                        (() => {
                          const display = getCategoryDisplay(e.category_account)
                          return (
                            <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold ${display.color} px-2 py-0.5 rounded border uppercase`}>
                              <span>{display.icon}</span>
                              <span>{display.name}</span>
                            </span>
                          )
                        })()
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      {e.payment_status === 'unpaid' ? (
                        <span className="text-red-600 font-bold uppercase text-[10px]">Hutang Usaha</span>
                      ) : e.payment_account ? (
                        <span className="text-gray-600 font-medium">{e.payment_account.name}</span>
                      ) : (
                        <span className="text-gray-450">-</span>
                      )}
                    </td>
                    <td className="p-4 space-y-1">
                      {e.payment_status === 'paid' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase">
                          🟢 Lunas
                        </span>
                      )}
                      {e.payment_status === 'unpaid' && (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 uppercase">
                            🔴 Tempo
                          </span>
                          {e.due_date && (
                            <div className="text-[9px] text-rose-600 font-bold">J.T: {e.due_date}</div>
                          )}
                        </div>
                      )}
                      {e.payment_status === 'partial' && (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 uppercase">
                            🟡 DP
                          </span>
                          {e.due_date && (
                            <div className="text-[9px] text-amber-600 font-bold">J.T: {e.due_date}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-4 space-y-0.5">
                      <div className="text-gray-900 font-black text-sm">{formatPrice(e.amount)}</div>
                      {e.payment_status !== 'paid' && (
                        <div className="text-[9px] text-gray-500 space-y-0.5">
                          <div>Bayar: {formatPrice(e.amount_paid || 0)}</div>
                          <div className="text-rose-600 font-bold">Sisa: {formatPrice(e.outstanding_amount || 0)}</div>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      {e.attachment_url ? (
                        <a
                          href={e.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded border border-amber-200 uppercase transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          📄 Lihat Nota
                        </a>
                      ) : (
                        <span className="text-gray-400 italic font-normal text-[10px]">Tidak ada</span>
                      )}
                    </td>
                    <td className="p-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {e.payment_status !== 'paid' && (
                          <button
                            onClick={() => openPayModal(e)}
                            className="px-2.5 py-1.5 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
                          >
                            💵 Bayar
                          </button>
                        )}
                        {e.payment_status === 'paid' ? (
                          <span className="px-2.5 py-1.5 text-gray-400 bg-gray-50 rounded border border-gray-150 uppercase font-bold text-[10px] tracking-wider cursor-not-allowed select-none">
                            🔒 Terkunci
                          </span>
                        ) : (
                          <Link
                            href={`/expenses/edit/${e.id}`}
                            className="px-2.5 py-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
                          >
                            ✏️ Edit
                          </Link>
                        )}
                        <button
                          onClick={() => handleDelete(e.id)}
                          className={`px-2.5 py-1.5 rounded border transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer ${
                            e.payment_status === 'paid'
                              ? 'text-rose-600 bg-rose-50 border-rose-100 hover:bg-rose-100'
                              : 'text-red-600 bg-red-50 border-red-100 hover:bg-red-100'
                          }`}
                        >
                          {e.payment_status === 'paid' ? '🚫 Batalkan' : '🗑️ Hapus'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pay Outstanding Expense Modal */}
      {isPayModalOpen && mounted && payExpense && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3.5 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                💵 Pembayaran Pengeluaran
              </h2>
              <button
                onClick={() => setIsPayModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePaySubmit} className="p-5 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs font-semibold text-blue-800 space-y-1">
                <div>Pengeluaran: <span className="font-bold text-gray-900">{payExpense.description || 'Operasional'}</span></div>
                <div>Total: <span className="font-bold text-gray-900">{formatPrice(payExpense.amount)}</span></div>
                <div>Sisa Hutang: <span className="font-extrabold text-rose-600">{formatPrice(payExpense.outstanding_amount)}</span></div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Tanggal Pembayaran *
                </label>
                <input
                  type="date"
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Cara Bayar (Kas/Bank) *
                </label>
                <select
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={payPaymentAccountId}
                  onChange={e => setPayPaymentAccountId(e.target.value)}
                >
                  <option value="">-- Pilih Kas/Bank --</option>
                  {paymentAccounts.map(a => (
                    <option key={a.id} value={a.id}>🏦 {a.name} ({a.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Jumlah Pembayaran *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Catatan
                </label>
                <textarea
                  placeholder="Catatan pembayaran..."
                  rows={2}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white resize-none"
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                />
              </div>

              <div className="pt-3 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPayModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={paySubmitLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {paySubmitLoading ? 'Memproses...' : 'Bayar'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Bulk Pay Outstanding Expense Modal */}
      {isBulkPayModalOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3.5 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                💵 Bayar Pengeluaran Sekaligus
              </h2>
              <button
                onClick={() => setIsBulkPayModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleBulkPaySubmit} className="p-5 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs font-semibold text-blue-800 space-y-1.5 max-h-48 overflow-y-auto">
                <div className="font-bold border-b border-blue-200 pb-1 flex justify-between">
                  <span>Daftar Pengeluaran Akan Dibayar</span>
                  <span>{selectedOutstandingExpenses.length} dari {selectedIds.length} Terpilih</span>
                </div>
                {selectedOutstandingExpenses.length === 0 ? (
                  <div className="text-amber-700 py-1 font-bold text-center">
                    ⚠️ Tidak ada pengeluaran bertempo/belum lunas dari item terpilih.
                  </div>
                ) : (
                  <div className="space-y-1 divide-y divide-blue-100/50">
                    {selectedOutstandingExpenses.map(e => (
                      <div key={e.id} className="pt-1 flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-gray-900 truncate">{e.description || 'Operasional'}</div>
                          <div className="text-[10px] text-gray-500">{e.date} | {e.vendor_name || 'Tanpa Vendor'}</div>
                        </div>
                        <div className="text-right text-rose-600 font-extrabold shrink-0">
                          {formatPrice(e.outstanding_amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="border-t border-blue-200 pt-1.5 flex justify-between text-sm font-black text-gray-900">
                  <span>TOTAL PEMBAYARAN:</span>
                  <span className="text-emerald-700">{formatPrice(totalBulkPayAmount)}</span>
                </div>
              </div>

              {selectedOutstandingExpenses.length > 0 && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                      Tanggal Pembayaran *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                      value={bulkPayDate}
                      onChange={e => setBulkPayDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                      Cara Bayar (Kas/Bank) *
                    </label>
                    <select
                      required
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                      value={bulkPayPaymentAccountId}
                      onChange={e => setBulkPayPaymentAccountId(e.target.value)}
                    >
                      <option value="">-- Pilih Kas/Bank --</option>
                      {paymentAccounts.map(a => (
                        <option key={a.id} value={a.id}>🏦 {a.name} ({a.code})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                      Catatan
                    </label>
                    <textarea
                      placeholder="Catatan pembayaran untuk semua item..."
                      rows={2}
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white resize-none"
                      value={bulkPayNotes}
                      onChange={e => setBulkPayNotes(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="pt-3 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkPayModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={bulkPaySubmitLoading || selectedOutstandingExpenses.length === 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {bulkPaySubmitLoading ? 'Memproses...' : 'Bayar Sekaligus'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Detail Expense Modal */}
      {selectedExpenseForDetail && (
        <ExpenseDetailModal
          expense={selectedExpenseForDetail}
          accounts={accounts}
          onClose={() => setSelectedExpenseForDetail(null)}
        />
      )}



    </div>
  )
}
