"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import { formatCurrencyIDR } from '../accounting/utils'

type Employee = {
  id: string
  name: string
  position: string | null
  email: string | null
  phone: string | null
  status: 'active' | 'inactive'
}

type SalaryPayment = {
  id: string
  salary_id: string
  transaction_id: string
  date: string
  amount: number
  payment_method_account_id: string
  notes: string | null
  accounts: Account | null
}

type SalaryRecord = {
  id: string
  employee_id: string
  amount: number
  period: string
  payment_status: 'paid' | 'pending' | 'partial' | 'cancelled'
  payment_account_id: string | null
  paid_at: string | null
  transaction_id: string | null
  amount_paid: number
  outstanding_amount: number
  employees: Employee
  salary_payments?: SalaryPayment[]
}

type Account = {
  id: string
  code: string
  name: string
  type: string
}

export default function EmployeesPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<'directory' | 'payroll'>('directory')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [salaries, setSalaries] = useState<SalaryRecord[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [bgUpdating, setBgUpdating] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Employee Modal States
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [empName, setEmpName] = useState('')
  const [empPosition, setEmpPosition] = useState('')
  const [empEmail, setEmpEmail] = useState('')
  const [empPhone, setEmpPhone] = useState('')
  const [empStatus, setEmpStatus] = useState<'active' | 'inactive'>('active')
  const [empSubmitting, setEmpSubmitting] = useState(false)

  // Salary Modal States
  const [isSalaryModalOpen, setIsSalaryModalOpen] = useState(false)
  const [editingSalary, setEditingSalary] = useState<SalaryRecord | null>(null)
  const [salEmployeeId, setSalEmployeeId] = useState('')
  const [salAmount, setSalAmount] = useState('')
  const [salPeriod, setSalPeriod] = useState(() => {
    const today = new Date()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    return `${today.getFullYear()}-${month}`
  })
  const [salStatus, setSalStatus] = useState<'paid' | 'pending' | 'partial' | 'cancelled'>('paid')
  const [salAmountPaid, setSalAmountPaid] = useState('')
  const [salAccountId, setSalAccountId] = useState('')
  const [salSubmitting, setSalSubmitting] = useState(false)

  // Quick Pay States
  const [isQuickPayModalOpen, setIsQuickPayModalOpen] = useState(false)
  const [quickPayRecord, setQuickPayRecord] = useState<SalaryRecord | null>(null)
  const [quickPayAmount, setQuickPayAmount] = useState('')
  const [quickPayAccountId, setQuickPayAccountId] = useState('')
  const [quickPaySubmitting, setQuickPaySubmitting] = useState(false)

  // Delete Employee States
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  // Salary Cancel/Delete States
  const [isCancelSalaryModalOpen, setIsCancelSalaryModalOpen] = useState(false)
  const [cancellingSalary, setCancellingSalary] = useState<SalaryRecord | null>(null)
  const [cancelSalarySubmitting, setCancelSalarySubmitting] = useState(false)

  const [isDeleteSalaryModalOpen, setIsDeleteSalaryModalOpen] = useState(false)
  const [deletingSalary, setDeletingSalary] = useState<SalaryRecord | null>(null)
  const [deleteSalarySubmitting, setDeleteSalarySubmitting] = useState(false)

  // Salary Detail Modal States
  const [isSalaryDetailOpen, setIsSalaryDetailOpen] = useState(false)
  const [selectedSalaryForDetail, setSelectedSalaryForDetail] = useState<SalaryRecord | null>(null)
  const [salaryTransactions, setSalaryTransactions] = useState<any[]>([])
  const [loadingSalaryDetail, setLoadingSalaryDetail] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Load Business Profile, Employees, Salaries, and Accounts
  const loadAllData = useCallback(async (businessId: string, bizName: string) => {
    setBgUpdating(true)
    try {
      // Fetch Employees, Salaries, and Accounts in parallel for maximum speed
      const [empRes, salRes, accRes] = await Promise.all([
        fetch('/api/employees'),
        fetch('/api/employees/salary'),
        supabase
          .from('accounts')
          .select('id, code, name, type')
          .eq('business_id', businessId)
          .order('code', { ascending: true })
      ])

      let freshEmployees: Employee[] = []
      let freshSalaries: SalaryRecord[] = []
      let freshAccounts: Account[] = []

      if (empRes.ok) {
        freshEmployees = await empRes.json()
        setEmployees(freshEmployees)
      }

      if (salRes.ok) {
        freshSalaries = await salRes.json()
        setSalaries(freshSalaries)
      }

      if (!accRes.error && accRes.data) {
        freshAccounts = accRes.data
        setAccounts(freshAccounts)
      }

      // Write to localStorage cache for instant loading next time
      localStorage.setItem(`cache_employees_${businessId}`, JSON.stringify(freshEmployees))
      localStorage.setItem(`cache_salaries_${businessId}`, JSON.stringify(freshSalaries))
      localStorage.setItem(`cache_accounts_${businessId}`, JSON.stringify(freshAccounts))
    } catch (err) {
      console.error('Error loading employees/payroll data in background:', err)
    } finally {
      setLoading(false)
      setBgUpdating(false)
    }
  }, [supabase])

  // Get active business profile and initiate SWR cache loading
  useEffect(() => {
    async function initProfileAndCache() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

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
          const bizName = biz?.name || 'Bisnis Saya'
          setActiveBizName(bizName)

          // ── STALE-WHILE-REVALIDATE PATTERN ──
          // 1. Immediately read from localStorage cache to present data instantly
          const cachedEmp = localStorage.getItem(`cache_employees_${businessId}`)
          const cachedSal = localStorage.getItem(`cache_salaries_${businessId}`)
          const cachedAcc = localStorage.getItem(`cache_accounts_${businessId}`)

          let hasCache = false
          if (cachedEmp) {
            setEmployees(JSON.parse(cachedEmp))
            hasCache = true
          }
          if (cachedSal) {
            setSalaries(JSON.parse(cachedSal))
            hasCache = true
          }
          if (cachedAcc) {
            setAccounts(JSON.parse(cachedAcc))
            hasCache = true
          }

          // If we had cached data, stop showing the full page loading spinner
          if (hasCache) {
            setLoading(false)
          }

          // 2. Fetch fresh data in the background and update the state/cache silently
          loadAllData(businessId, bizName)
        }
      } catch (err) {
        console.error('Error in profile/cache initialization:', err)
        setLoading(false)
      }
    }
    initProfileAndCache()
  }, [supabase, router, loadAllData])

  // Filter payment methods: Assets starting with 101 (Kas/Bank)
  const paymentAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  }, [accounts])

  // Calculate current period for metrics
  const currentPeriod = useMemo(() => {
    const today = new Date()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    return `${today.getFullYear()}-${month}`
  }, [])

  // KPI calculations
  const kpiData = useMemo(() => {
    const activeEmpCount = employees.filter(e => e.status === 'active').length
    
    // Salaries in the current month, excluding cancelled ones
    const currentSalaries = salaries.filter(s => s.period === currentPeriod && s.payment_status !== 'cancelled')
    const activeSalaries = salaries.filter(s => s.payment_status !== 'cancelled')
    
    const totalPayroll = currentSalaries.reduce((sum, s) => sum + Number(s.amount), 0)
    const paidPayroll = activeSalaries.reduce((sum, s) => sum + Number(s.amount_paid || 0), 0)
    const unpaidPayroll = activeSalaries.reduce((sum, s) => sum + Number(s.outstanding_amount ?? (s.payment_status === 'pending' ? s.amount : 0)), 0)

    return {
      activeEmpCount,
      totalPayroll,
      paidPayroll,
      unpaidPayroll
    }
  }, [employees, salaries, currentPeriod])

  // Handle Employee CRUD
  const handleOpenAddEmployee = () => {
    setEditingEmployee(null)
    setEmpName('')
    setEmpPosition('')
    setEmpEmail('')
    setEmpPhone('')
    setEmpStatus('active')
    setIsEmployeeModalOpen(true)
  }

  const handleOpenEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp)
    setEmpName(emp.name)
    setEmpPosition(emp.position || '')
    setEmpEmail(emp.email || '')
    setEmpPhone(emp.phone || '')
    setEmpStatus(emp.status)
    setIsEmployeeModalOpen(true)
  }

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!empName.trim()) {
      alert('Nama karyawan wajib diisi!')
      return
    }

    setEmpSubmitting(true)
    try {
      const url = editingEmployee 
        ? `/api/employees?id=${editingEmployee.id}`
        : '/api/employees'
      const method = editingEmployee ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: empName.trim(),
          position: empPosition.trim() || null,
          email: empEmail.trim() || null,
          phone: empPhone.trim() || null,
          status: empStatus
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menyimpan data karyawan')
      }

      setIsEmployeeModalOpen(false)
      if (activeBizId && activeBizName) {
        loadAllData(activeBizId, activeBizName)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setEmpSubmitting(false)
    }
  }

  const handleOpenDeleteEmployee = (emp: Employee) => {
    setDeletingEmployee(emp)
    setIsDeleteModalOpen(true)
  }

  const handleDeleteEmployee = async () => {
    if (!deletingEmployee) return
    setDeleteSubmitting(true)
    try {
      const res = await fetch(`/api/employees?id=${deletingEmployee.id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menghapus karyawan')
      }

      setIsDeleteModalOpen(false)
      if (activeBizId && activeBizName) {
        loadAllData(activeBizId, activeBizName)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  // Handle Salary Payments
  const handleOpenAddSalary = () => {
    setEditingSalary(null)
    setSalEmployeeId(employees.find(e => e.status === 'active')?.id || '')
    setSalAmount('')
    setSalAmountPaid('')
    setSalStatus('paid')
    setSalAccountId(paymentAccounts[0]?.id || '')
    setIsSalaryModalOpen(true)
  }

  const handleOpenEditSalary = (sal: SalaryRecord) => {
    setEditingSalary(sal)
    setSalEmployeeId(sal.employee_id)
    setSalAmount(String(sal.amount))
    setSalPeriod(sal.period)
    setSalStatus(sal.payment_status)
    setSalAmountPaid(String(sal.amount_paid || ''))
    setSalAccountId(sal.payment_account_id || paymentAccounts[0]?.id || '')
    setIsSalaryModalOpen(true)
  }

  const handleSaveSalary = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!salEmployeeId) {
      alert('Silakan pilih karyawan terlebih dahulu!')
      return
    }

    const numAmount = parseFloat(salAmount)
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('Nominal gaji harus valid dan lebih dari 0!')
      return
    }

    const numAmountPaid = salStatus === 'paid'
      ? numAmount
      : (salStatus === 'pending' ? 0 : parseFloat(salAmountPaid))

    if (salStatus === 'partial') {
      if (isNaN(numAmountPaid) || numAmountPaid <= 0 || numAmountPaid >= numAmount) {
        alert('Nominal terbayar harus valid dan bernilai di antara 0 dan total gaji!')
        return
      }
    }

    if ((salStatus === 'paid' || salStatus === 'partial') && !salAccountId) {
      alert('Silakan pilih akun pembayaran (Kas/Bank) untuk status Lunas atau Sebagian!')
      return
    }

    setSalSubmitting(true)
    try {
      const url = editingSalary 
        ? `/api/employees/salary?id=${editingSalary.id}`
        : '/api/employees/salary'
      const method = editingSalary ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: salEmployeeId,
          amount: numAmount,
          period: salPeriod,
          payment_status: salStatus,
          payment_account_id: (salStatus === 'paid' || salStatus === 'partial') ? salAccountId : null,
          amount_paid: numAmountPaid
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal merekam penggajian')
      }

      setIsSalaryModalOpen(false)
      if (activeBizId && activeBizName) {
        loadAllData(activeBizId, activeBizName)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSalSubmitting(false)
    }
  }

  const handleOpenQuickPay = (record: SalaryRecord) => {
    setQuickPayRecord(record)
    setQuickPayAmount(String(record.outstanding_amount ?? record.amount))
    setQuickPayAccountId(paymentAccounts[0]?.id || '')
    setIsQuickPayModalOpen(true)
  }

  const handleSaveQuickPay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickPayRecord || !quickPayAccountId) return

    const numPayAmount = parseFloat(quickPayAmount)
    const maxPayable = quickPayRecord.outstanding_amount ?? quickPayRecord.amount

    if (isNaN(numPayAmount) || numPayAmount <= 0 || numPayAmount > maxPayable + 0.01) {
      alert(`Nominal pembayaran harus valid, lebih dari 0, dan maksimal sebesar sisa hutang (${formatCurrencyIDR(maxPayable)})`)
      return
    }

    setQuickPaySubmitting(true)
    try {
      const res = await fetch(`/api/employees/salary/${quickPayRecord.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numPayAmount,
          payment_method_account_id: quickPayAccountId,
          date: new Date().toISOString().split('T')[0],
          notes: 'Cicilan/Pelunasan Gaji'
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal merekam pembayaran gaji')
      }

      setIsQuickPayModalOpen(false)
      if (activeBizId && activeBizName) {
        loadAllData(activeBizId, activeBizName)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setQuickPaySubmitting(false)
    }
  }

  const handleOpenCancelSalary = (sal: SalaryRecord) => {
    setCancellingSalary(sal)
    setIsCancelSalaryModalOpen(true)
  }

  const handleCancelSalary = async () => {
    if (!cancellingSalary) return
    setCancelSalarySubmitting(true)
    try {
      const res = await fetch(`/api/employees/salary?id=${cancellingSalary.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_status: 'cancelled'
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal membatalkan catatan gaji')
      }

      setIsCancelSalaryModalOpen(false)
      if (activeBizId && activeBizName) {
        loadAllData(activeBizId, activeBizName)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setCancelSalarySubmitting(false)
    }
  }

  const handleOpenDeleteSalary = (sal: SalaryRecord) => {
    setDeletingSalary(sal)
    setIsDeleteSalaryModalOpen(true)
  }

  const handleDeleteSalary = async () => {
    if (!deletingSalary) return
    setDeleteSalarySubmitting(true)
    try {
      const res = await fetch(`/api/employees/salary?id=${deletingSalary.id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menghapus catatan gaji')
      }

      setIsDeleteSalaryModalOpen(false)
      if (activeBizId && activeBizName) {
        loadAllData(activeBizId, activeBizName)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setDeleteSalarySubmitting(false)
    }
  }

  const handleOpenSalaryDetail = async (sal: SalaryRecord) => {
    setSelectedSalaryForDetail(sal)
    setIsSalaryDetailOpen(true)
    setLoadingSalaryDetail(true)
    setSalaryTransactions([])

    try {
      let txList: any[] = []
      if (sal.transaction_id) {
        const { data: mainTx, error: mainErr } = await supabase
          .from('transactions')
          .select(`
            id,
            date,
            description,
            journal_lines (
              id,
              debit,
              credit,
              accounts (
                id,
                code,
                name,
                type
              )
            )
          `)
          .eq('id', sal.transaction_id)

        if (mainErr) throw mainErr
        if (mainTx) txList.push(...mainTx)
      }

      if (sal.payment_status === 'cancelled' && activeBizId) {
        const reversalDesc = `Pembatalan Gaji Karyawan: ${sal.employees?.name} (${sal.period})`
        const { data: revTx, error: revErr } = await supabase
          .from('transactions')
          .select(`
            id,
            date,
            description,
            journal_lines (
              id,
              debit,
              credit,
              accounts (
                id,
                code,
                name,
                type
              )
            )
          `)
          .eq('business_id', activeBizId)
          .eq('description', reversalDesc)

        if (revErr) throw revErr
        if (revTx) txList.push(...revTx)
      }

      // Fetch transactions for any partial payments
      if (sal.salary_payments && sal.salary_payments.length > 0) {
        const payTxIds = sal.salary_payments.map(p => p.transaction_id).filter(Boolean)
        if (payTxIds.length > 0) {
          const { data: payTxs, error: payErr } = await supabase
            .from('transactions')
            .select(`
              id,
              date,
              description,
              journal_lines (
                id,
                debit,
                credit,
                accounts (
                  id,
                  code,
                  name,
                  type
                )
              )
            `)
            .in('id', payTxIds)

          if (payErr) throw payErr
          if (payTxs) txList.push(...payTxs)
        }
      }

      setSalaryTransactions(txList)
    } catch (err) {
      console.error('Error fetching salary details:', err)
    } finally {
      setLoadingSalaryDetail(false)
    }
  }

  if (loading && employees.length === 0) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-32 bg-gray-100 rounded-full animate-pulse"></div>
        <div className="h-10 w-64 bg-gray-100 rounded-md animate-pulse"></div>
        <div className="bg-white border border-gray-200 rounded-xl p-8 h-64 animate-pulse"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 text-slate-800">
      
      {/* Page Header (Matches Accounting style) */}
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Laporan Karyawan
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
            Karyawan & Gaji
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Kelola data staf dan pembukuan payroll otomatis bisnis Anda.
          </p>
        </div>
        
        <div className="flex gap-2">
          {activeTab === 'directory' ? (
            <button 
              onClick={handleOpenAddEmployee}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-750 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
            >
              ➕ Tambah Karyawan
            </button>
          ) : (
            <button 
              onClick={handleOpenAddSalary}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
            >
              💸 Catat Penggajian
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Row (Matches Profit Loss metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Active Employees */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Karyawan Aktif</div>
          <div className="text-xl font-black text-gray-900 mt-1">{kpiData.activeEmpCount} Orang</div>
          <div className="text-[9px] text-blue-600 font-bold mt-1.5 uppercase">Staf terdaftar aktif</div>
        </div>

        {/* Total Monthly Payroll */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Gaji Bulan Ini ({currentPeriod})</div>
          <div className="text-xl font-black text-gray-900 mt-1">{formatCurrencyIDR(kpiData.totalPayroll)}</div>
          <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Total kewajiban payroll</div>
        </div>

        {/* Paid Gaji */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Gaji Lunas (Terbayar)</div>
          <div className="text-xl font-black text-emerald-600 mt-1">{formatCurrencyIDR(kpiData.paidPayroll)}</div>
          <div className="text-[9px] text-emerald-600 font-bold mt-1.5 uppercase">Sudah dibukukan lunas</div>
        </div>

        {/* Unpaid Gaji */}
        <div className={`border rounded-xl p-5 shadow-xs transition-all ${
          kpiData.unpaidPayroll > 0 
            ? 'bg-rose-50/50 border-rose-200' 
            : 'bg-white border-gray-200'
        }`}>
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Gaji Tertunda (Pending)</div>
          <div className={`text-xl font-black mt-1 ${
            kpiData.unpaidPayroll > 0 ? 'text-rose-600' : 'text-gray-900'
          }`}>
            {formatCurrencyIDR(kpiData.unpaidPayroll)}
          </div>
          <div className={`text-[9px] font-bold mt-1.5 uppercase ${kpiData.unpaidPayroll > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {kpiData.unpaidPayroll > 0 ? '🔴 Perlu Pelunasan' : '🟢 Bebas Tunggakan'}
          </div>
        </div>

      </div>

      {/* Navigation Tabs (Accounting Style) */}
      <div className="bg-gray-100/80 p-1 rounded-xl flex gap-1 w-full max-w-md">
        <button
          onClick={() => setActiveTab('directory')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'directory' 
              ? 'bg-white text-gray-900 shadow-xs' 
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          📂 Direktori Karyawan ({employees.length})
        </button>
        <button
          onClick={() => setActiveTab('payroll')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'payroll' 
              ? 'bg-white text-gray-900 shadow-xs' 
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          💳 Penggajian & Payroll ({salaries.length})
        </button>
      </div>

      {/* Directory Tab View */}
      {activeTab === 'directory' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                  <th className="px-6 py-4 w-1/4">Nama</th>
                  <th className="px-6 py-4 w-1/5">Jabatan / Posisi</th>
                  <th className="px-6 py-4 w-1/5">Email</th>
                  <th className="px-6 py-4 w-1/6">Telepon</th>
                  <th className="px-6 py-4 w-1/12">Status</th>
                  <th className="px-6 py-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs font-medium text-gray-700">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-55/20 transition-colors">
                    <td className="px-6 py-4 font-bold text-gray-900">{emp.name}</td>
                    <td className="px-6 py-4 text-gray-500">{emp.position || '-'}</td>
                    <td className="px-6 py-4 font-mono text-gray-500 break-all">{emp.email || '-'}</td>
                    <td className="px-6 py-4 font-mono text-gray-500">{emp.phone || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block text-[9px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                        emp.status === 'active' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                          : 'bg-rose-50 text-rose-700 border-rose-100'
                      }`}>
                        {emp.status === 'active' ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenEditEmployee(emp)}
                          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg text-blue-600 font-bold text-[10px] uppercase transition-all cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleOpenDeleteEmployee(emp)}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-lg text-rose-600 font-bold text-[10px] uppercase transition-all cursor-pointer"
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 italic">
                      Belum ada data karyawan terdaftar. Klik "+ Tambah Karyawan" untuk memulai.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payroll Tab View */}
      {activeTab === 'payroll' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                  <th className="px-6 py-4 w-1/4">Karyawan</th>
                  <th className="px-6 py-4 w-1/6">Periode</th>
                  <th className="px-6 py-4 w-1/5">Nominal Gaji</th>
                  <th className="px-6 py-4 w-1/6">Status Pembayaran</th>
                  <th className="px-6 py-4 w-1/5">Waktu Pembayaran</th>
                  <th className="px-6 py-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs font-medium text-gray-700">
                {salaries.map(sal => (
                  <tr 
                    key={sal.id} 
                    className="hover:bg-gray-55/20 transition-colors cursor-pointer"
                    onClick={() => handleOpenSalaryDetail(sal)}
                  >
                    <td className="px-6 py-4 font-bold text-gray-900">
                      <div>{sal.employees?.name}</div>
                      <div className="text-[10px] text-gray-400 font-normal">{sal.employees?.position}</div>
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-600">{sal.period}</td>
                    <td className="px-6 py-4 font-mono">
                      <div className="font-bold text-gray-900">{formatCurrencyIDR(sal.amount)}</div>
                      {sal.payment_status === 'partial' && (
                        <div className="text-[9px] font-semibold text-indigo-600 mt-0.5">
                          Terbayar: {formatCurrencyIDR(sal.amount_paid)} | Sisa: {formatCurrencyIDR(sal.outstanding_amount)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-block text-[9px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                        sal.payment_status === 'paid' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                          : sal.payment_status === 'partial'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                          : sal.payment_status === 'cancelled'
                          ? 'bg-rose-50 text-rose-700 border-rose-100'
                          : 'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                        {sal.payment_status === 'paid' ? 'Lunas' : sal.payment_status === 'partial' ? 'Sebagian' : sal.payment_status === 'cancelled' ? 'Batal' : 'Belum Dibayar'}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-gray-400">
                      {sal.paid_at ? new Date(sal.paid_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
                    </td>
                    <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-row items-center justify-center gap-1.5 whitespace-nowrap">
                        {(sal.payment_status === 'pending' || sal.payment_status === 'partial') && (
                          <button
                            onClick={() => handleOpenQuickPay(sal)}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-750 text-white rounded-lg font-bold text-[10px] uppercase transition-all shadow-xs cursor-pointer active:scale-97"
                          >
                            Bayar
                          </button>
                        )}
                        {sal.payment_status !== 'cancelled' && (
                          <button
                            onClick={() => handleOpenEditSalary(sal)}
                            className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg text-blue-600 font-bold text-[10px] uppercase transition-all cursor-pointer"
                          >
                            Edit
                          </button>
                        )}
                        {sal.payment_status !== 'cancelled' && (
                          <button
                            onClick={() => handleOpenCancelSalary(sal)}
                            className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-100 rounded-lg text-amber-600 font-bold text-[10px] uppercase transition-all cursor-pointer"
                          >
                            Batal
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenDeleteSalary(sal)}
                          className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-lg text-rose-600 font-bold text-[10px] uppercase transition-all cursor-pointer"
                        >
                          Hapus
                        </button>
                        {sal.payment_status === 'cancelled' && (
                          <span className="text-[10px] font-bold text-rose-600 italic">❌ Dibatalkan</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {salaries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 italic">
                      Belum ada catatan payroll gaji. Klik "Catat Penggajian" untuk merekam gaji.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODALS ── */}

      {/* Employee Add/Edit Modal */}
      {isEmployeeModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-gray-50 border-b border-gray-150 px-6 py-4 flex justify-between items-center">
              <h3 className="font-extrabold text-sm uppercase text-gray-900 tracking-tight">
                {editingEmployee ? 'Edit Data Karyawan' : 'Tambah Karyawan Baru'}
              </h3>
              <button 
                onClick={() => setIsEmployeeModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-xs"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveEmployee} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Nama Lengkap *</label>
                <input 
                  type="text"
                  required
                  placeholder="Contoh: Budi Santoso"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={empName}
                  onChange={e => setEmpName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Jabatan / Posisi</label>
                <input 
                  type="text"
                  placeholder="Contoh: Staf Kasir"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={empPosition}
                  onChange={e => setEmpPosition(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Alamat Email</label>
                <input 
                  type="email"
                  placeholder="Contoh: budi@mail.com"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={empEmail}
                  onChange={e => setEmpEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Nomor Telepon</label>
                <input 
                  type="text"
                  placeholder="Contoh: 08123456789"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={empPhone}
                  onChange={e => setEmpPhone(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Status Keaktifan</label>
                <select
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={empStatus}
                  onChange={e => setEmpStatus(e.target.value as 'active' | 'inactive')}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4 border-t border-gray-150 mt-6 justify-end">
                <button 
                  type="button" 
                  onClick={() => setIsEmployeeModalOpen(false)}
                  className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  disabled={empSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-750 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {empSubmitting ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Employee Confirmation Modal */}
      {isDeleteModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-155">
            <div className="text-center space-y-2">
              <div className="text-2xl">⚠️</div>
              <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">Hapus Karyawan?</h3>
              <p className="text-xs font-semibold text-gray-500 leading-normal">
                Apakah Anda yakin ingin menghapus data karyawan <span className="text-gray-900 font-bold underline">{deletingEmployee?.name}</span>? Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteEmployee}
                disabled={deleteSubmitting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-750 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer"
              >
                {deleteSubmitting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Record Salary Payment Modal */}
      {isSalaryModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-gray-50 border-b border-gray-150 px-6 py-4 flex justify-between items-center">
              <h3 className="font-extrabold text-sm uppercase text-gray-900 tracking-tight">
                {editingSalary ? 'Edit Catatan Payroll' : 'Catat Payroll Gaji'}
              </h3>
              <button 
                onClick={() => setIsSalaryModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-xs"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveSalary} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Karyawan Penerima *</label>
                <select
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={salEmployeeId}
                  onChange={e => setSalEmployeeId(e.target.value)}
                >
                  <option value="">-- Pilih Karyawan --</option>
                  {employees.filter(e => e.status === 'active' || e.id === salEmployeeId).map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.position})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Periode Gaji (Bulan/Tahun) *</label>
                <input 
                  type="month"
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={salPeriod}
                  onChange={e => setSalPeriod(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Nominal Gaji *</label>
                <input 
                  type="number"
                  required
                  min="1"
                  placeholder="Contoh: 3500000"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={salAmount}
                  onChange={e => setSalAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Status Bayar</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSalStatus('paid')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                      salStatus === 'paid' 
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs' 
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    🟢 Lunas
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalStatus('partial')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                      salStatus === 'partial' 
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs' 
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    🔵 Sebagian
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalStatus('pending')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                      salStatus === 'pending' 
                        ? 'bg-amber-600 border-amber-600 text-white shadow-xs' 
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    🟡 Belum Dibayar
                  </button>
                </div>
              </div>

              {salStatus === 'partial' && (
                <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-150">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Nominal yang Dibayar *</label>
                  <input 
                    type="number"
                    required
                    min="1"
                    placeholder="Contoh: 1500000"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={salAmountPaid}
                    onChange={e => setSalAmountPaid(e.target.value)}
                  />
                  {salAmount && salAmountPaid && (
                    <div className="text-[10px] text-gray-500 font-bold">
                      Sisa Hutang Gaji: {formatCurrencyIDR(Math.max(0, parseFloat(salAmount) - parseFloat(salAmountPaid)))}
                    </div>
                  )}
                </div>
              )}

              {(salStatus === 'paid' || salStatus === 'partial') && (
                <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-150">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Sumber Dana (Kas/Bank) *</label>
                  <select
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={salAccountId}
                    onChange={e => setSalAccountId(e.target.value)}
                  >
                    <option value="">-- Pilih Rekening Pembayaran --</option>
                    {paymentAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>🏦 {acc.name} ({acc.code})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 font-medium italic mt-1.5">
                    * Transaksi jurnal penyeimbang (debit beban gaji, kredit kas/bank) akan dibuat/diperbarui otomatis.
                  </p>
                </div>
              )}

              {salStatus === 'pending' && (
                <p className="text-[10px] text-gray-400 font-medium italic mt-1.5">
                  * Gaji akan dibukukan sebagai Hutang Gaji & Upah (201100) hingga dilunasi.
                </p>
              )}

              <div className="flex gap-2 pt-4 border-t border-gray-150 mt-6 justify-end">
                <button 
                  type="button" 
                  onClick={() => setIsSalaryModalOpen(false)}
                  className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  disabled={salSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-750 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {salSubmitting ? 'Memproses...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Quick Pay / Pay Pending Salary Modal */}
      {isQuickPayModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-gray-50 border-b border-gray-150 px-6 py-4 flex justify-between items-center">
              <h3 className="font-extrabold text-sm uppercase text-gray-900 tracking-tight">
                Bayar Catatan Payroll
              </h3>
              <button 
                onClick={() => setIsQuickPayModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-xs"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveQuickPay} className="p-6 space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                <div className="text-[10px] font-extrabold uppercase text-gray-400">Rincian Pembayaran Gaji:</div>
                <div className="flex justify-between font-bold text-xs">
                  <span className="text-gray-500">Penerima:</span>
                  <span className="text-gray-900 font-bold">{quickPayRecord?.employees?.name}</span>
                </div>
                <div className="flex justify-between font-bold text-xs">
                  <span className="text-gray-500">Periode:</span>
                  <span className="text-gray-900 font-mono">{quickPayRecord?.period}</span>
                </div>
                <div className="flex justify-between font-bold text-xs">
                  <span className="text-gray-500">Total Nominal Gaji:</span>
                  <span className="text-gray-900 font-mono font-bold">{quickPayRecord ? formatCurrencyIDR(quickPayRecord.amount) : ''}</span>
                </div>
                {quickPayRecord && (quickPayRecord.amount_paid ?? 0) > 0 && (
                  <div className="flex justify-between font-bold text-xs">
                    <span className="text-gray-500">Jumlah Terbayar:</span>
                    <span className="text-emerald-600 font-mono font-bold">{formatCurrencyIDR(quickPayRecord.amount_paid)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs border-t border-gray-200 pt-2">
                  <span className="text-gray-900 font-black">Sisa Hutang Gaji:</span>
                  <span className="text-indigo-600 font-mono font-black">{formatCurrencyIDR(quickPayRecord ? (quickPayRecord.outstanding_amount ?? quickPayRecord.amount) : 0)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Nominal yang Dibayar *</label>
                <input 
                  type="number"
                  required
                  min="1"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={quickPayAmount}
                  onChange={e => setQuickPayAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Sumber Dana (Kas/Bank) *</label>
                <select
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                  value={quickPayAccountId}
                  onChange={e => setQuickPayAccountId(e.target.value)}
                >
                  <option value="">-- Pilih Rekening Pembayaran --</option>
                  {paymentAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>🏦 {acc.name} ({acc.code})</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 font-medium italic mt-1.5">
                  * Transaksi jurnal penyeimbang (debit hutang gaji, kredit kas/bank) akan dibuat otomatis.
                </p>
              </div>

              <div className="flex gap-2 pt-4 border-t border-gray-150 mt-6 justify-end">
                <button 
                  type="button" 
                  onClick={() => setIsQuickPayModalOpen(false)}
                  className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  disabled={quickPaySubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-750 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {quickPaySubmitting ? 'Memproses Pembayaran...' : 'Proses Pembayaran'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Cancel Salary Confirmation Modal */}
      {isCancelSalaryModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-155">
            <div className="text-center space-y-2">
              <div className="text-2xl">⚠️</div>
              <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">Batalkan Gaji?</h3>
              <p className="text-xs font-semibold text-gray-500 leading-normal">
                Apakah Anda yakin ingin membatalkan payroll untuk <span className="text-gray-900 font-bold underline">{cancellingSalary?.employees?.name}</span> ({cancellingSalary?.period})?
              </p>
              <p className="text-[10px] text-amber-600 font-bold uppercase leading-normal">
                Jurnal pembalik akan otomatis dibuat untuk membatalkan dampak akuntansi.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIsCancelSalaryModalOpen(false)}
                className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleCancelSalary}
                disabled={cancelSalarySubmitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer"
              >
                {cancelSalarySubmitting ? 'Membatalkan...' : 'Ya, Batalkan'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Salary Confirmation Modal */}
      {isDeleteSalaryModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-155">
            <div className="text-center space-y-2">
              <div className="text-2xl">🚨</div>
              <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">Hapus Catatan Gaji?</h3>
              <p className="text-xs font-semibold text-gray-500 leading-normal">
                Apakah Anda yakin ingin menghapus catatan gaji untuk <span className="text-gray-900 font-bold underline">{deletingSalary?.employees?.name}</span> ({deletingSalary?.period})? 
              </p>
              <p className="text-[10px] text-rose-600 font-bold uppercase leading-normal">
                Catatan beserta jurnal transaksi aslinya akan dihapus permanen!
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIsDeleteSalaryModalOpen(false)}
                className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteSalary}
                disabled={deleteSalarySubmitting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-750 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer"
              >
                {deleteSalarySubmitting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Salary Detail and Journal Entries Modal */}
      {isSalaryDetailOpen && selectedSalaryForDetail && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-4xl bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] font-sans animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="bg-gray-50 border-b border-gray-150 px-8 py-5 flex justify-between items-center">
              <div>
                <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-0.5 rounded border border-blue-100 uppercase tracking-widest mb-1.5 inline-block">
                  Detail Payroll & Jurnal
                </span>
                <h3 className="font-extrabold text-lg text-gray-900 tracking-tight leading-none uppercase">
                  {selectedSalaryForDetail.employees?.name}
                </h3>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block mt-1">
                  {selectedSalaryForDetail.employees?.position || 'Karyawan'}
                </span>
              </div>
              <button 
                onClick={() => setIsSalaryDetailOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-xs border border-gray-200 px-3 py-1.5 rounded-lg bg-white shadow-xs cursor-pointer hover:bg-gray-50 transition-all"
              >
                ✕ Close
              </button>
            </div>

            {/* Split Content */}
            <div className="flex flex-col md:flex-row h-full overflow-hidden min-h-[400px]">
              {/* Left Panel: Record Details */}
              <div className="w-full md:w-1/3 p-6 border-r border-gray-150 bg-gray-50/50 space-y-4 overflow-y-auto">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Informasi Payroll</h4>
                
                <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Periode Gaji</p>
                  <p className="text-xs font-bold text-gray-800">{selectedSalaryForDetail.period}</p>
                </div>

                <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Nominal Gaji</p>
                  <p className="text-sm font-black text-gray-900 font-mono">{formatCurrencyIDR(selectedSalaryForDetail.amount)}</p>
                </div>

                <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Status Pembayaran</p>
                  <span className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider mt-1 ${
                    selectedSalaryForDetail.payment_status === 'paid' 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                      : selectedSalaryForDetail.payment_status === 'partial'
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                      : selectedSalaryForDetail.payment_status === 'cancelled'
                      ? 'bg-rose-50 text-rose-700 border-rose-100'
                      : 'bg-amber-50 text-amber-700 border-amber-100'
                  }`}>
                    {selectedSalaryForDetail.payment_status === 'paid' ? 'Lunas' : selectedSalaryForDetail.payment_status === 'partial' ? 'Sebagian' : selectedSalaryForDetail.payment_status === 'cancelled' ? 'Batal' : 'Belum Dibayar'}
                  </span>
                </div>

                <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Jumlah Terbayar</p>
                  <p className="text-xs font-bold text-emerald-600 font-mono">{formatCurrencyIDR(selectedSalaryForDetail.amount_paid || 0)}</p>
                </div>

                <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Sisa Hutang Gaji</p>
                  <p className="text-xs font-bold text-indigo-600 font-mono">{formatCurrencyIDR(selectedSalaryForDetail.outstanding_amount ?? (selectedSalaryForDetail.payment_status === 'pending' ? selectedSalaryForDetail.amount : 0))}</p>
                </div>

                {selectedSalaryForDetail.payment_account_id && (
                  <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                    <p className="text-[9px] text-gray-400 font-bold uppercase">Akun Pembayaran Awal</p>
                    <p className="text-xs font-bold text-gray-800 uppercase">
                      {accounts.find(a => a.id === selectedSalaryForDetail.payment_account_id)?.name || 'Kas POS (Tunai)'}
                    </p>
                  </div>
                )}

                {selectedSalaryForDetail.salary_payments && selectedSalaryForDetail.salary_payments.length > 0 && (
                  <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs space-y-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Riwayat Pembayaran Cicilan</p>
                    <div className="space-y-2 divide-y divide-gray-100">
                      {selectedSalaryForDetail.salary_payments.map((p) => (
                        <div key={p.id} className="pt-2 first:pt-0 flex flex-col">
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span className="text-emerald-700">{formatCurrencyIDR(p.amount)}</span>
                            <span className="text-[9px] text-gray-400 font-mono">{p.date}</span>
                          </div>
                          <span className="text-[9px] text-gray-500 uppercase tracking-wider">
                            {p.accounts?.name || 'Kas/Bank'}
                          </span>
                          {p.notes && <span className="text-[9px] text-gray-400 italic">"{p.notes}"</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedSalaryForDetail.payment_status === 'cancelled' && (
                  <div className="bg-rose-50/50 p-3.5 border border-rose-100 rounded-xl shadow-xs">
                    <p className="text-[9px] text-rose-700 font-black uppercase">Catatan Pembatalan</p>
                    <p className="text-xs font-semibold text-rose-600 mt-1">
                      Payroll ini telah dibatalkan. Jurnal pembalik otomatis telah diterbitkan di buku besar.
                    </p>
                  </div>
                )}
              </div>

              {/* Right Panel: Journal entries */}
              <div className="flex-1 p-6 overflow-y-auto space-y-4">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Ayat Jurnal Buku Besar (Double-Entry)</h4>
                
                {loadingSalaryDetail ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-20 bg-gray-50 border border-gray-100 rounded-xl"></div>
                    <div className="h-20 bg-gray-50 border border-gray-100 rounded-xl"></div>
                  </div>
                ) : salaryTransactions.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-gray-200 rounded-xl">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Tidak ada catatan jurnal transaksi.</p>
                  </div>
                ) : (
                  salaryTransactions.map((tx: any) => {
                    const totalDebit = tx.journal_lines?.reduce((acc: number, line: any) => acc + (Number(line.debit) || 0), 0) || 0;
                    const totalCredit = tx.journal_lines?.reduce((acc: number, line: any) => acc + (Number(line.credit) || 0), 0) || 0;

                    return (
                      <div key={tx.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-xs">
                        {/* Tx Header */}
                        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                          <div>
                            <span className="text-[8px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 uppercase tracking-wider">
                              Jurnal Umum
                            </span>
                            <h5 className="text-xs font-black text-gray-800 uppercase mt-1">
                              {tx.description}
                            </h5>
                          </div>
                          <span className="text-[9px] font-bold text-gray-450 font-mono">
                            {new Date(tx.date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </span>
                        </div>

                        {/* Journal Lines Table */}
                        <div className="p-4 overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs font-sans">
                            <thead>
                              <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase tracking-wider text-[9px] pb-2">
                                <th className="py-1.5 pr-4">Akun</th>
                                <th className="py-1.5 px-4 text-right">Debit</th>
                                <th className="py-1.5 pl-4 text-right">Kredit</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {tx.journal_lines?.map((line: any) => {
                                const isCredit = (Number(line.credit) || 0) > 0 && (Number(line.debit) || 0) === 0;
                                return (
                                  <tr key={line.id} className="hover:bg-gray-55/50 transition-colors">
                                    <td className="py-2.5 pr-4">
                                      <div className={`flex items-center gap-2 ${isCredit ? 'pl-5' : ''}`}>
                                        <span className="text-[9px] font-mono bg-gray-100 text-gray-600 px-1 py-0.2 rounded border border-gray-200">
                                          {line.accounts?.code || '-'}
                                        </span>
                                        <span className={`font-bold text-gray-700 uppercase ${isCredit ? 'italic text-gray-500 font-medium' : ''}`}>
                                          {line.accounts?.name || 'Akun Tidak Dikenal'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-4 text-right font-bold text-gray-900 font-mono">
                                      {line.debit > 0 ? formatCurrencyIDR(line.debit) : '-'}
                                    </td>
                                    <td className="py-2.5 pl-4 text-right font-bold text-gray-900 font-mono">
                                      {line.credit > 0 ? formatCurrencyIDR(line.credit) : '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                              
                              {/* Total Row */}
                              <tr className="border-t border-gray-300 font-bold bg-gray-50/20">
                                <td className="py-2 text-right pr-4 text-gray-400 uppercase text-[9px] font-black">
                                  Total Balance
                                </td>
                                <td className="py-2 px-4 text-right text-gray-900 border-b-4 border-double border-gray-900 font-black font-mono">
                                  {formatCurrencyIDR(totalDebit)}
                                </td>
                                <td className="py-2 pl-4 text-right text-gray-900 border-b-4 border-double border-gray-900 font-black font-mono">
                                  {formatCurrencyIDR(totalCredit)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
