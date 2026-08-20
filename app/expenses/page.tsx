"use client"
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { ExpenseDetailModal } from './components/ExpenseDetailModal'
import { Pagination } from '../components/Pagination'
import { useUserContext } from '@/components/UserContext'

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
  const { activeBusiness } = useUserContext()
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

  // Date Filter State
  const [datePreset, setDatePreset] = useState<string>('all')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  // Grouping & Pagination State (default collapsed)
  const [groupBy, setGroupBy] = useState<'none' | 'date' | 'vendor' | 'category'>('none')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [groupItemLimits, setGroupItemLimits] = useState<Record<string, number>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

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

  // Date preset calculator
  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset)
    const now = new Date()
    const formatDateStr = (d: Date) => {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    if (preset === 'today') {
      const todayStr = formatDateStr(now)
      setStartDate(todayStr)
      setEndDate(todayStr)
    } else if (preset === 'yesterday') {
      const yest = new Date(now)
      yest.setDate(now.getDate() - 1)
      const yestStr = formatDateStr(yest)
      setStartDate(yestStr)
      setEndDate(yestStr)
    } else if (preset === 'this_week') {
      const dayOfWeek = now.getDay()
      const distToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1
      const mon = new Date(now)
      mon.setDate(now.getDate() - distToMon)
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      setStartDate(formatDateStr(mon))
      setEndDate(formatDateStr(sun))
    } else if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      setStartDate(formatDateStr(firstDay))
      setEndDate(formatDateStr(lastDay))
    } else if (preset === 'last_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0)
      setStartDate(formatDateStr(firstDay))
      setEndDate(formatDateStr(lastDay))
    } else if (preset === 'this_year') {
      const firstDay = new Date(now.getFullYear(), 0, 1)
      const lastDay = new Date(now.getFullYear(), 11, 31)
      setStartDate(formatDateStr(firstDay))
      setEndDate(formatDateStr(lastDay))
    } else if (preset === 'all') {
      setStartDate('')
      setEndDate('')
    }
  }

  // Reset pagination & group expanded/limit states on filter or grouping changes
  useEffect(() => {
    setCurrentPage(1)
    setExpandedGroups({})
    setGroupItemLimits({})
  }, [searchQuery, selectedCategoryAcc, selectedPaymentStatus, groupBy, startDate, endDate])

  // Fetch Expenses & Accounts data
  const fetchExpensesData = useCallback(async (businessId: string) => {
    setBgUpdating(true)
    try {
      // 1. Fetch Expense Records
      const { data: expData, error: expErr } = await supabase
        .from('expenses')
        .select(`
          id, business_id, transaction_id, category_account_id, payment_account_id,
          amount, date, description, vendor_name, attachment_url, created_at,
          payment_status, due_date, amount_paid, outstanding_amount,
          category_account:accounts!category_account_id(id, code, name),
          payment_account:accounts!payment_account_id(id, code, name),
          expense_payments(id)
        `)
        .eq('business_id', businessId)
        .order('date', { ascending: false })

      if (expErr) throw expErr

      // 2. Fetch Accounts list for filters
      const { data: accData, error: accErr } = await supabase
        .from('accounts')
        .select('id, code, name, type')
        .eq('business_id', businessId)
        .order('code', { ascending: true })

      if (accErr) throw accErr

      const freshExpenses = expData || []
      const freshAccounts = accData || []

      setExpenses(freshExpenses as any)
      setAccounts(freshAccounts)

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
    if (!activeBusiness?.id) return
    const businessId = activeBusiness.id
    setActiveBizId(businessId)
    setActiveBizName(activeBusiness.name || 'Bisnis Saya')

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

    if (hasCache) {
      setLoading(false)
      setBgUpdating(true)
    } else {
      setLoading(true)
    }

    fetchExpensesData(businessId)
  }, [activeBusiness, fetchExpensesData])

  const paymentAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  }, [accounts])

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '-'
    try {
      const parts = dateStr.split('-')
      if (parts.length !== 3) return dateStr
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
      return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    } catch {
      return dateStr
    }
  }

  // Filtered Expenses (Search, Category, Payment Status, & Date Range)
  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      const matchesSearch = 
        (e.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.vendor_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.category_account?.name || '').toLowerCase().includes(searchQuery.toLowerCase())

      const matchesCat = selectedCategoryAcc ? e.category_account_id === selectedCategoryAcc : true
      const matchesStatus = selectedPaymentStatus ? e.payment_status === selectedPaymentStatus : true

      let matchesDate = true
      if (startDate && e.date < startDate) matchesDate = false
      if (endDate && e.date > endDate) matchesDate = false

      return matchesSearch && matchesCat && matchesStatus && matchesDate
    })
  }, [expenses, searchQuery, selectedCategoryAcc, selectedPaymentStatus, startDate, endDate])

  // Summary Metrics dynamically calculated from filteredExpenses
  const summaryMetrics = useMemo(() => {
    const totalAmount = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
    const totalOutstanding = filteredExpenses.reduce((sum, e) => sum + (e.outstanding_amount || 0), 0)
    return {
      count: filteredExpenses.length,
      totalAmount,
      totalOutstanding
    }
  }, [filteredExpenses])

  // Paginated Expenses (for flat list mode)
  const paginatedExpenses = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize
    return filteredExpenses.slice(startIdx, startIdx + pageSize)
  }, [filteredExpenses, currentPage, pageSize])

  // Grouped Expenses Structure (all groups across filtered dataset)
  type ExpenseGroup = {
    key: string
    title: string
    subTitle?: string
    icon: string
    items: Expense[]
    totalAmount: number
    totalOutstanding: number
  }

  const groupedExpenses = useMemo(() => {
    if (groupBy === 'none') return []

    const groupMap = new Map<string, { key: string; title: string; subTitle?: string; icon: string; items: Expense[] }>()

    filteredExpenses.forEach(e => {
      let groupKey = 'Lainnya'
      let title = 'Lainnya'
      let subTitle = ''
      let icon = '📁'

      if (groupBy === 'date') {
        groupKey = e.date || 'Tanpa Tanggal'
        title = formatDateDisplay(e.date)
        subTitle = e.date
        icon = '📅'
      } else if (groupBy === 'vendor') {
        const vName = (e.vendor_name || '').trim()
        groupKey = vName ? vName.toLowerCase() : '__no_vendor__'
        title = vName || 'Tanpa Vendor'
        icon = '🏢'
      } else if (groupBy === 'category') {
        const cat = getCategoryDisplay(e.category_account)
        groupKey = e.category_account_id || 'uncategorized'
        title = cat.name
        icon = cat.icon
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          key: groupKey,
          title,
          subTitle,
          icon,
          items: []
        })
      }
      groupMap.get(groupKey)!.items.push(e)
    })

    const groups: ExpenseGroup[] = Array.from(groupMap.values()).map(g => {
      const totalAmount = g.items.reduce((acc, item) => acc + (item.amount || 0), 0)
      const totalOutstanding = g.items.reduce((acc, item) => acc + (item.outstanding_amount || 0), 0)
      return {
        ...g,
        totalAmount,
        totalOutstanding
      }
    })

    if (groupBy === 'date') {
      groups.sort((a, b) => b.key.localeCompare(a.key))
    } else if (groupBy === 'vendor' || groupBy === 'category') {
      groups.sort((a, b) => b.totalAmount - a.totalAmount)
    }

    return groups
  }, [filteredExpenses, groupBy])

  // Paginated Groups (Group-level pagination!)
  const paginatedGroupedExpenses = useMemo(() => {
    if (groupBy === 'none') return []
    const startIdx = (currentPage - 1) * pageSize
    return groupedExpenses.slice(startIdx, startIdx + pageSize)
  }, [groupedExpenses, groupBy, currentPage, pageSize])

  // Total count for Pagination component
  const totalPaginationCount = groupBy === 'none' ? filteredExpenses.length : groupedExpenses.length

  const toggleGroupExpand = (key: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const handleLoadMoreGroupItems = (groupKey: string, step = 5) => {
    setGroupItemLimits(prev => ({
      ...prev,
      [groupKey]: (prev[groupKey] || 5) + step
    }))
  }

  const selectableExpenses = useMemo(() => {
    if (groupBy === 'none') return paginatedExpenses
    return paginatedGroupedExpenses.flatMap(g => g.items)
  }, [groupBy, paginatedExpenses, paginatedGroupedExpenses])

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

  const handleSelectGroup = (groupItems: Expense[], ev: React.ChangeEvent<HTMLInputElement> | React.MouseEvent) => {
    ev.stopPropagation()
    const groupItemIds = groupItems.map(item => item.id)
    const isAllGroupSelected = groupItemIds.length > 0 && groupItemIds.every(id => selectedIds.includes(id))

    if (isAllGroupSelected) {
      setSelectedIds(prev => prev.filter(id => !groupItemIds.includes(id)))
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...groupItemIds])))
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
        await fetchExpensesData(activeBizId)
      }
    } catch (err: any) {
      console.error('Error bulk paying expenses:', err)
      alert(err.message)
    } finally {
      setBulkPaySubmitLoading(false)
    }
  }

  const openPayModal = (expense: Expense) => {
    setPayExpense(expense)
    setPayAmount(expense.outstanding_amount?.toString() || '')
    setPayDate(new Date().toISOString().split('T')[0])
    setPayPaymentAccountId('')
    setPayNotes('')
    setIsPayModalOpen(true)
  }

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
        await fetchExpensesData(activeBizId)
      }
    } catch (err: any) {
      console.error('Error paying expense:', err)
      alert(err.message)
    } finally {
      setPaySubmitLoading(false)
    }
  }

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
        await fetchExpensesData(activeBizId)
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

  // Row Renderer
  const renderExpenseRow = (e: Expense) => (
    <tr 
      key={e.id} 
      className={`hover:bg-gray-50/50 transition-colors cursor-pointer ${selectedIds.includes(e.id) ? 'bg-blue-50/30' : ''}`}
      onClick={() => setSelectedExpenseForDetail(e)}
    >
      <td className="p-4 w-10" onClick={ev => ev.stopPropagation()}>
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
            onClick={ev => ev.stopPropagation()}
          >
            📄 Lihat Nota
          </a>
        ) : (
          <span className="text-gray-400 italic font-normal text-[10px]">Tidak ada</span>
        )}
      </td>
      <td className="p-4 text-right" onClick={ev => ev.stopPropagation()}>
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
  )

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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[10px] font-extrabold uppercase text-gray-400 tracking-wider flex items-center gap-1">
              <span>Total Transaksi</span>
              {(startDate || endDate) && <span className="text-blue-600 font-bold">(Tersaring)</span>}
            </div>
            <div className="text-lg font-black text-gray-800">{summaryMetrics.count.toLocaleString('id-ID')} item</div>
          </div>
          <span className="text-2xl">📋</span>
        </div>

        <div className="bg-white border border-blue-100 rounded-xl p-3.5 shadow-xs flex items-center justify-between bg-gradient-to-br from-white to-blue-50/40">
          <div>
            <div className="text-[10px] font-extrabold uppercase text-blue-600 tracking-wider flex items-center gap-1">
              <span>Total Pengeluaran</span>
              {(startDate || endDate) && <span className="text-blue-700 font-bold">(Tersaring)</span>}
            </div>
            <div className="text-lg font-black text-blue-900">{formatPrice(summaryMetrics.totalAmount)}</div>
          </div>
          <span className="text-2xl">💸</span>
        </div>

        <div className="bg-white border border-rose-100 rounded-xl p-3.5 shadow-xs flex items-center justify-between bg-gradient-to-br from-white to-rose-50/40">
          <div>
            <div className="text-[10px] font-extrabold uppercase text-rose-600 tracking-wider flex items-center gap-1">
              <span>Total Sisa Hutang</span>
              {(startDate || endDate) && <span className="text-rose-700 font-bold">(Tersaring)</span>}
            </div>
            <div className="text-lg font-black text-rose-900">{formatPrice(summaryMetrics.totalOutstanding)}</div>
          </div>
          <span className="text-2xl">⏳</span>
        </div>
      </div>

      {/* Filters & Grouping Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row flex-wrap gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Cari deskripsi, vendor, atau kategori pengeluaran..."
            className="w-full p-2.5 pl-8 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-gray-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3 top-3.5 text-gray-400 text-xs">🔍</span>
        </div>

        {/* Date Preset Selector */}
        <div className="w-full md:w-44">
          <select
            className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
            value={datePreset}
            onChange={e => handleDatePresetChange(e.target.value)}
          >
            <option value="all">📅 Semua Tanggal</option>
            <option value="today">Hari Ini</option>
            <option value="yesterday">Kemarin</option>
            <option value="this_week">Minggu Ini</option>
            <option value="this_month">Bulan Ini</option>
            <option value="last_month">Bulan Lalu</option>
            <option value="this_year">Tahun Ini</option>
            <option value="custom">🛠️ Rentang Kustom</option>
          </select>
        </div>

        {/* Custom Date Pickers */}
        {datePreset === 'custom' && (
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <input
              type="date"
              className="p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              title="Tanggal Mulai"
            />
            <span className="text-gray-400 text-xs hidden sm:inline">-</span>
            <input
              type="date"
              className="p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              title="Tanggal Sampai"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setDatePreset('all')
                  setStartDate('')
                  setEndDate('')
                }}
                className="px-2.5 py-2 text-[10px] font-bold uppercase text-gray-500 hover:text-red-600 bg-gray-100 rounded-lg cursor-pointer"
                title="Reset Tanggal"
              >
                ✕ Reset
              </button>
            )}
          </div>
        )}

        {/* Grouping Selector */}
        <div className="w-full md:w-52">
          <select
            className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
            value={groupBy}
            onChange={e => setGroupBy(e.target.value as any)}
          >
            <option value="none">📋 Tanpa Grouping (List)</option>
            <option value="date">📅 Grouping Tanggal</option>
            <option value="vendor">🏢 Grouping Vendor</option>
            <option value="category">🏷️ Grouping Kategori</option>
          </select>
        </div>

        {/* Status Selector */}
        <div className="w-full md:w-44">
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

        {/* Category Selector */}
        <div className="w-full md:w-56">
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

      {/* Top Pagination */}
      {!loading && totalPaginationCount > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={totalPaginationCount}
          pageSize={pageSize}
          onPageChange={page => setCurrentPage(page)}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            setCurrentPage(1)
          }}
          position="top"
        />
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
      ) : filteredExpenses.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-xs">
          <span className="text-3xl">🔍</span>
          <h3 className="text-sm font-extrabold text-gray-800 mt-2 uppercase tracking-wide">Pengeluaran Tidak Ditemukan</h3>
          <p className="text-xs text-gray-400 mt-1">Tidak ada transaksi yang cocok dengan kata kunci, rentang tanggal, atau filter yang dipilih.</p>
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
                {groupBy === 'none' ? (
                  paginatedExpenses.map(e => renderExpenseRow(e))
                ) : (
                  paginatedGroupedExpenses.map(group => {
                    const isExpanded = !!expandedGroups[group.key]
                    const groupItemIds = group.items.map(item => item.id)
                    const isGroupSelected = groupItemIds.length > 0 && groupItemIds.every(id => selectedIds.includes(id))
                    const isGroupSomeSelected = groupItemIds.some(id => selectedIds.includes(id)) && !isGroupSelected

                    const currentLimit = groupItemLimits[group.key] || 5
                    const visibleItems = group.items.slice(0, currentLimit)
                    const remainingCount = group.items.length - visibleItems.length

                    return (
                      <React.Fragment key={group.key}>
                        <tr 
                          className="bg-slate-100/90 hover:bg-slate-200/90 cursor-pointer border-t border-b border-slate-200 transition-colors select-none"
                          onClick={() => toggleGroupExpand(group.key)}
                        >
                          <td className="p-3 w-10" onClick={ev => ev.stopPropagation()}>
                            <input 
                              type="checkbox"
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              checked={isGroupSelected}
                              ref={el => {
                                if (el) el.indeterminate = isGroupSomeSelected
                              }}
                              onChange={ev => handleSelectGroup(group.items, ev)}
                            />
                          </td>
                          <td colSpan={8} className="p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 font-bold text-xs w-4 text-center">
                                  {isExpanded ? '▼' : '▶'}
                                </span>
                                <span className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                                  <span>{group.icon}</span>
                                  <span>{group.title}</span>
                                  {group.subTitle && group.title !== group.subTitle && (
                                    <span className="text-xs font-normal text-slate-500">({group.subTitle})</span>
                                  )}
                                </span>
                                <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-2 py-0.5 rounded-full">
                                  {group.items.length} item
                                </span>
                              </div>

                              <div className="flex items-center gap-3 text-xs">
                                <div className="font-bold text-slate-700">
                                  Subtotal: <span className="font-black text-slate-900">{formatPrice(group.totalAmount)}</span>
                                </div>
                                {group.totalOutstanding > 0 && (
                                  <div className="font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                                    Sisa Hutang: <span className="font-black">{formatPrice(group.totalOutstanding)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <>
                            {visibleItems.map(e => renderExpenseRow(e))}
                            {remainingCount > 0 && (
                              <tr className="bg-slate-50/70 border-b border-slate-200">
                                <td colSpan={9} className="p-2.5 text-center">
                                  <button
                                    type="button"
                                    onClick={ev => {
                                      ev.stopPropagation()
                                      handleLoadMoreGroupItems(group.key, 5)
                                    }}
                                    className="px-3.5 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-2xs active:scale-98"
                                  >
                                    <span>➕ Tampilkan 5 Item Lagi</span>
                                    <span className="text-[10px] text-blue-500 font-semibold">
                                      (Tampil {visibleItems.length} dari {group.items.length} item • Sisa {remainingCount})
                                    </span>
                                  </button>
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </React.Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom Pagination */}
      {!loading && totalPaginationCount > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={totalPaginationCount}
          pageSize={pageSize}
          onPageChange={page => setCurrentPage(page)}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            setCurrentPage(1)
          }}
          position="bottom"
        />
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
