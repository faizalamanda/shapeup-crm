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

type SalaryRecord = {
  id: string
  employee_id: string
  amount: number
  period: string
  payment_status: 'paid' | 'pending'
  payment_account_id: string | null
  paid_at: string | null
  transaction_id: string | null
  employees: Employee
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
  const [salEmployeeId, setSalEmployeeId] = useState('')
  const [salAmount, setSalAmount] = useState('')
  const [salPeriod, setSalPeriod] = useState(() => {
    const today = new Date()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    return `${today.getFullYear()}-${month}`
  })
  const [salStatus, setSalStatus] = useState<'paid' | 'pending'>('paid')
  const [salAccountId, setSalAccountId] = useState('')
  const [salSubmitting, setSalSubmitting] = useState(false)

  // Quick Pay States
  const [isQuickPayModalOpen, setIsQuickPayModalOpen] = useState(false)
  const [quickPayRecord, setQuickPayRecord] = useState<SalaryRecord | null>(null)
  const [quickPayAccountId, setQuickPayAccountId] = useState('')
  const [quickPaySubmitting, setQuickPaySubmitting] = useState(false)

  // Delete Employee States
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

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
    
    // Salaries in the current month
    const currentSalaries = salaries.filter(s => s.period === currentPeriod)
    
    const totalPayroll = currentSalaries.reduce((sum, s) => sum + Number(s.amount), 0)
    const paidPayroll = currentSalaries.filter(s => s.payment_status === 'paid').reduce((sum, s) => sum + Number(s.amount), 0)
    const unpaidPayroll = currentSalaries.filter(s => s.payment_status === 'pending').reduce((sum, s) => sum + Number(s.amount), 0)

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
    setSalEmployeeId(employees.find(e => e.status === 'active')?.id || '')
    setSalAmount('')
    setSalStatus('paid')
    setSalAccountId(paymentAccounts[0]?.id || '')
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

    if (salStatus === 'paid' && !salAccountId) {
      alert('Silakan pilih akun pembayaran (Kas/Bank) untuk status Lunas!')
      return
    }

    setSalSubmitting(true)
    try {
      const res = await fetch('/api/employees/salary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: salEmployeeId,
          amount: numAmount,
          period: salPeriod,
          payment_status: salStatus,
          payment_account_id: salStatus === 'paid' ? salAccountId : null
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
    setQuickPayAccountId(paymentAccounts[0]?.id || '')
    setIsQuickPayModalOpen(true)
  }

  const handleSaveQuickPay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickPayRecord || !quickPayAccountId) return

    setQuickPaySubmitting(true)
    try {
      const res = await fetch(`/api/employees/salary?id=${quickPayRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_status: 'paid',
          payment_account_id: quickPayAccountId
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal melunasi gaji')
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
          <div className="text-[9px] font-bold mt-1.5 uppercase text-rose-500">
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
                  <tr key={sal.id} className="hover:bg-gray-55/20 transition-colors">
                    <td className="px-6 py-4 font-bold text-gray-900">
                      <div>{sal.employees?.name}</div>
                      <div className="text-[10px] text-gray-400 font-normal">{sal.employees?.position}</div>
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-600">{sal.period}</td>
                    <td className="px-6 py-4 font-mono font-bold text-gray-900">
                      {formatCurrencyIDR(sal.amount)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-block text-[9px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                        sal.payment_status === 'paid' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                          : 'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                        {sal.payment_status === 'paid' ? 'Lunas' : 'Belum Dibayar'}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-gray-400">
                      {sal.paid_at ? new Date(sal.paid_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {sal.payment_status !== 'paid' ? (
                        <button
                          onClick={() => handleOpenQuickPay(sal)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] uppercase transition-all shadow-xs cursor-pointer active:scale-97"
                        >
                          Bayar
                        </button>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-600 italic">✅ Selesai</span>
                      )}
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
                Catat Payroll Gaji
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
                  {employees.filter(e => e.status === 'active').map(e => (
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

              {salStatus === 'paid' && (
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
                    * Transaksi jurnal penyeimbang (debit beban gaji, kredit kas/bank) akan dibuat otomatis.
                  </p>
                </div>
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
                  <span className="text-gray-500">Nominal:</span>
                  <span className="text-gray-900 font-mono font-bold">{quickPayRecord ? formatCurrencyIDR(quickPayRecord.amount) : ''}</span>
                </div>
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
                  * Transaksi jurnal penyeimbang (debit beban gaji, kredit kas/bank) akan dibuat otomatis.
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

    </div>
  )
}
