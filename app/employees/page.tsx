"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { formatCurrencyIDR } from '../accounting/utils'

type Employee = {
  id: string
  name: string
  position: string | null
  email: string | null
  phone: string | null
  status: 'active' | 'inactive'
}

type Account = {
  id: string
  code: string
  name: string
  type: string
}

type SalaryPayment = {
  id: string
  salary_id: string
  transaction_id: string
  reversal_transaction_id?: string | null
  date: string
  amount: number
  payment_method_account_id: string
  notes: string | null
  status?: 'active' | 'voided'
  voided_at?: string | null
  void_reason?: string | null
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

type AppNotification = {
  id: string
  type: 'success' | 'warning' | 'error' | 'info'
  title: string
  message: string
  auditBadges?: string[]
  timestamp: string
}

const VOID_PAYMENT_REASONS = [
  'Salah pilih rekening Kas/Bank',
  'Ingin mengubah nominal gaji',
  'Salah input nominal pembayaran',
  'Salah tanggal pembayaran'
]

const CANCEL_SALARY_REASONS = [
  'Koreksi / Buat ulang slip gaji',
  'Salah input karyawan atau periode',
  'Duplikasi pencatatan gaji',
  'Karyawan sudah nonaktif / resign'
]

export default function EmployeesPage() {
  const [activeTab, setActiveTab] = useState<'directory' | 'payroll'>('directory')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [salaries, setSalaries] = useState<SalaryRecord[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [bgUpdating, setBgUpdating] = useState(false)
  const [mounted, setMounted] = useState(false)

  // World-Class Notification Queue State
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  const pushNotification = useCallback(
    (notif: Omit<AppNotification, 'id' | 'timestamp'>) => {
      const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const timestamp = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
      setNotifications(prev => [{ ...notif, id, timestamp }, ...prev.slice(0, 3)])
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id))
      }, 7000)
    },
    []
  )

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  // Employee Modal States
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [empName, setEmpName] = useState('')
  const [empPosition, setEmpPosition] = useState('')
  const [empEmail, setEmpEmail] = useState('')
  const [empPhone, setEmpPhone] = useState('')
  const [empStatus, setEmpStatus] = useState<'active' | 'inactive'>('active')
  const [empSubmitting, setEmpSubmitting] = useState(false)
  const [empModalError, setEmpModalError] = useState<string | null>(null)

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
  const [salPaymentDate, setSalPaymentDate] = useState(() => new Date().toISOString().split('T')[0])
  const [salEditReason, setSalEditReason] = useState('')
  const [salForceResetPayments, setSalForceResetPayments] = useState(false)
  const [salSubmitting, setSalSubmitting] = useState(false)
  const [salModalError, setSalModalError] = useState<string | null>(null)

  // Quick Pay States
  const [isQuickPayModalOpen, setIsQuickPayModalOpen] = useState(false)
  const [quickPayRecord, setQuickPayRecord] = useState<SalaryRecord | null>(null)
  const [quickPayAmount, setQuickPayAmount] = useState('')
  const [quickPayAccountId, setQuickPayAccountId] = useState('')
  const [quickPayDate, setQuickPayDate] = useState(() => new Date().toISOString().split('T')[0])
  const [quickPayNotes, setQuickPayNotes] = useState('Cicilan/Pelunasan Gaji')
  const [quickPaySubmitting, setQuickPaySubmitting] = useState(false)
  const [quickPayError, setQuickPayError] = useState<string | null>(null)

  // Void Payment Modal States (Unreconcile Payment)
  const [isVoidPaymentModalOpen, setIsVoidPaymentModalOpen] = useState(false)
  const [voidingPaymentSalary, setVoidingPaymentSalary] = useState<SalaryRecord | null>(null)
  const [voidingPaymentTarget, setVoidingPaymentTarget] = useState<SalaryPayment | null>(null) // null = void all active payments on that salary
  const [voidPaymentReason, setVoidPaymentReason] = useState('Salah pilih rekening Kas/Bank')
  const [voidPaymentSubmitting, setVoidPaymentSubmitting] = useState(false)
  const [voidPaymentError, setVoidPaymentError] = useState<string | null>(null)

  // Delete Employee States
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteEmpError, setDeleteEmpError] = useState<string | null>(null)

  // Salary Cancel/Delete States
  const [isCancelSalaryModalOpen, setIsCancelSalaryModalOpen] = useState(false)
  const [cancellingSalary, setCancellingSalary] = useState<SalaryRecord | null>(null)
  const [cancelSalaryReason, setCancelSalaryReason] = useState('Koreksi / Buat ulang slip gaji')
  const [cancelSalarySubmitting, setCancelSalarySubmitting] = useState(false)
  const [cancelSalaryError, setCancelSalaryError] = useState<string | null>(null)

  const [isDeleteSalaryModalOpen, setIsDeleteSalaryModalOpen] = useState(false)
  const [deletingSalary, setDeletingSalary] = useState<SalaryRecord | null>(null)
  const [deleteSalarySubmitting, setDeleteSalarySubmitting] = useState(false)
  const [deleteSalaryError, setDeleteSalaryError] = useState<string | null>(null)

  // Salary Detail Modal States
  const [isSalaryDetailOpen, setIsSalaryDetailOpen] = useState(false)
  const [selectedSalaryForDetail, setSelectedSalaryForDetail] = useState<SalaryRecord | null>(null)
  const [salaryTransactions, setSalaryTransactions] = useState<any[]>([])
  const [loadingSalaryDetail, setLoadingSalaryDetail] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Load Business Profile, Employees, Salaries, and Accounts
  const loadAllData = useCallback(
    async (businessId: string) => {
      setBgUpdating(true)
      try {
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
          localStorage.setItem(`cache_employees_${businessId}`, JSON.stringify(freshEmployees))
        }

        if (salRes.ok) {
          freshSalaries = await salRes.json()
          setSalaries(freshSalaries)
          localStorage.setItem(`cache_salaries_${businessId}`, JSON.stringify(freshSalaries))
        }

        if (!accRes.error && accRes.data) {
          freshAccounts = accRes.data
          setAccounts(freshAccounts)
          localStorage.setItem(`cache_accounts_${businessId}`, JSON.stringify(freshAccounts))
        }

        return { freshEmployees, freshSalaries, freshAccounts }
      } catch (err) {
        console.error('Error loading employees/payroll data in background:', err)
        return null
      } finally {
        setLoading(false)
        setBgUpdating(false)
      }
    },
    []
  )

  const { activeBusiness } = useUserContext()

  useEffect(() => {
    if (!activeBusiness?.id) return

    const businessId = activeBusiness.id
    const bizName = activeBusiness.name || 'Bisnis Saya'

    setActiveBizId(businessId)
    setActiveBizName(bizName)

    const cachedEmp = localStorage.getItem(`cache_employees_${businessId}`)
    const cachedSal = localStorage.getItem(`cache_salaries_${businessId}`)
    const cachedAcc = localStorage.getItem(`cache_accounts_${businessId}`)

    let hasCache = false
    if (cachedEmp) {
      try {
        setEmployees(JSON.parse(cachedEmp))
        hasCache = true
      } catch {}
    }
    if (cachedSal) {
      try {
        setSalaries(JSON.parse(cachedSal))
        hasCache = true
      } catch {}
    }
    if (cachedAcc) {
      try {
        setAccounts(JSON.parse(cachedAcc))
        hasCache = true
      } catch {}
    }

    if (hasCache) {
      setLoading(false)
    }

    loadAllData(businessId)
  }, [activeBusiness, loadAllData])

  // Filter payment methods: Assets starting with 101 (Kas/Bank)
  const paymentAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  }, [accounts])

  const getAccountName = useCallback(
    (accId: string | null | undefined) => {
      if (!accId) return 'Kas / Bank'
      const found = accounts.find(a => a.id === accId)
      return found ? `${found.name} (${found.code})` : 'Kas / Bank'
    },
    [accounts]
  )

  // Calculate current period for metrics
  const currentPeriod = useMemo(() => {
    const today = new Date()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    return `${today.getFullYear()}-${month}`
  }, [])

  // KPI calculations
  const kpiData = useMemo(() => {
    const activeEmpCount = employees.filter(e => e.status === 'active').length
    const currentSalaries = salaries.filter(
      s => s.period === currentPeriod && s.payment_status !== 'cancelled'
    )
    const activeSalaries = salaries.filter(s => s.payment_status !== 'cancelled')

    const totalPayroll = currentSalaries.reduce((sum, s) => sum + Number(s.amount), 0)
    const paidPayroll = activeSalaries.reduce((sum, s) => sum + Number(s.amount_paid || 0), 0)
    const unpaidPayroll = activeSalaries.reduce(
      (sum, s) =>
        sum + Number(s.outstanding_amount ?? (s.payment_status === 'pending' ? s.amount : 0)),
      0
    )

    return {
      activeEmpCount,
      totalPayroll,
      paidPayroll,
      unpaidPayroll
    }
  }, [employees, salaries, currentPeriod])

  // Helper to get active payments of a salary record
  const getActivePayments = useCallback((sal: SalaryRecord | null): SalaryPayment[] => {
    if (!sal?.salary_payments) return []
    return sal.salary_payments.filter(p => (p.status || 'active') === 'active')
  }, [])

  // Fetch and deduplicate journal entries for Salary Detail Modal
  const fetchSalaryJournalEntries = useCallback(
    async (sal: SalaryRecord) => {
      setLoadingSalaryDetail(true)
      try {
        const txIdSet = new Set<string>()
        if (sal.transaction_id) txIdSet.add(sal.transaction_id)

        if (sal.salary_payments && sal.salary_payments.length > 0) {
          for (const p of sal.salary_payments) {
            if (p.transaction_id) txIdSet.add(p.transaction_id)
            if (p.reversal_transaction_id) txIdSet.add(p.reversal_transaction_id)
          }
        }

        const queries: PromiseLike<any>[] = []

        if (txIdSet.size > 0) {
          queries.push(
            supabase
              .from('transactions')
              .select(`
                id,
                date,
                description,
                created_at,
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
              .in('id', Array.from(txIdSet))
          )
        }

        // Also fetch any reversal transactions by description prefix (for cancelled salaries or pre-migration void fallbacks)
        if (activeBizId && sal.employees?.name) {
          const cleanPeriod = String(sal.period).split(' (Batal')[0]
          const cancelDescPrefix = `Pembatalan Gaji Karyawan: ${sal.employees.name} (${cleanPeriod})`
          const voidPayDescPrefix = `Pembatalan Pembayaran Gaji: ${sal.employees.name} (${cleanPeriod})`

          queries.push(
            supabase
              .from('transactions')
              .select(`
                id,
                date,
                description,
                created_at,
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
              .or(`description.ilike.${cancelDescPrefix}%,description.ilike.${voidPayDescPrefix}%`)
          )
        }

        const results = await Promise.all(queries)
        const mergedMap = new Map<string, any>()

        for (const res of results) {
          if (res?.data && Array.isArray(res.data)) {
            for (const tx of res.data) {
              mergedMap.set(tx.id, tx)
            }
          }
        }

        const dedupedList = Array.from(mergedMap.values()).sort((a, b) => {
          const timeA = a.created_at ? new Date(a.created_at).getTime() : new Date(a.date).getTime()
          const timeB = b.created_at ? new Date(b.created_at).getTime() : new Date(b.date).getTime()
          return timeA - timeB
        })

        setSalaryTransactions(dedupedList)
      } catch (err) {
        console.error('Error fetching salary details:', err)
      } finally {
        setLoadingSalaryDetail(false)
      }
    },
    [activeBizId]
  )

  // ── EMPLOYEE CRUD HANDLERS ──
  const handleOpenAddEmployee = () => {
    setEditingEmployee(null)
    setEmpName('')
    setEmpPosition('')
    setEmpEmail('')
    setEmpPhone('')
    setEmpStatus('active')
    setEmpModalError(null)
    setIsEmployeeModalOpen(true)
  }

  const handleOpenEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp)
    setEmpName(emp.name)
    setEmpPosition(emp.position || '')
    setEmpEmail(emp.email || '')
    setEmpPhone(emp.phone || '')
    setEmpStatus(emp.status)
    setEmpModalError(null)
    setIsEmployeeModalOpen(true)
  }

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmpModalError(null)

    if (!empName.trim()) {
      setEmpModalError('Nama lengkap karyawan wajib diisi.')
      return
    }

    setEmpSubmitting(true)
    try {
      const url = editingEmployee ? `/api/employees?id=${editingEmployee.id}` : '/api/employees'
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

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal menyimpan data karyawan.')
      }

      setIsEmployeeModalOpen(false)
      pushNotification({
        type: 'success',
        title: editingEmployee ? 'Data Karyawan Diperbarui' : 'Karyawan Baru Ditambahkan',
        message: `${empName.trim()} (${empPosition.trim() || 'Staf'}) berhasil disimpan ke direktori aktif.`,
        auditBadges: [empStatus === 'active' ? 'Status: Aktif' : 'Status: Nonaktif']
      })

      if (activeBizId) {
        await loadAllData(activeBizId)
      }
    } catch (err: any) {
      setEmpModalError(err.message)
      pushNotification({
        type: 'error',
        title: 'Gagal Menyimpan Karyawan',
        message: err.message
      })
    } finally {
      setEmpSubmitting(false)
    }
  }

  const handleOpenDeleteEmployee = (emp: Employee) => {
    setDeletingEmployee(emp)
    setDeleteEmpError(null)
    setIsDeleteModalOpen(true)
  }

  const handleDeleteEmployee = async () => {
    if (!deletingEmployee) return
    setDeleteSubmitting(true)
    setDeleteEmpError(null)
    try {
      const res = await fetch(`/api/employees?id=${deletingEmployee.id}`, {
        method: 'DELETE'
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal menghapus data karyawan.')
      }

      const deletedName = deletingEmployee.name
      setIsDeleteModalOpen(false)
      pushNotification({
        type: 'info',
        title: 'Karyawan Dihapus',
        message: `Data karyawan ${deletedName} telah dihapus dari direktori.`
      })

      if (activeBizId) {
        await loadAllData(activeBizId)
      }
    } catch (err: any) {
      setDeleteEmpError(err.message)
      pushNotification({
        type: 'error',
        title: 'Gagal Menghapus Karyawan',
        message: err.message
      })
    } finally {
      setDeleteSubmitting(false)
    }
  }

  // ── SALARY CRUD & ACCOUNTING HANDLERS ──
  const handleOpenAddSalary = () => {
    setEditingSalary(null)
    setSalEmployeeId(employees.find(e => e.status === 'active')?.id || '')
    setSalAmount('')
    setSalAmountPaid('')
    setSalStatus('paid')
    setSalAccountId(paymentAccounts[0]?.id || '')
    setSalPaymentDate(new Date().toISOString().split('T')[0])
    setSalEditReason('')
    setSalForceResetPayments(false)
    setSalModalError(null)
    setIsSalaryModalOpen(true)
  }

  const handleOpenEditSalary = (sal: SalaryRecord) => {
    const activePays = getActivePayments(sal)
    const lastActivePay = activePays.length > 0 ? activePays[activePays.length - 1] : null

    setEditingSalary(sal)
    setSalEmployeeId(sal.employee_id)
    setSalAmount(String(sal.amount))
    setSalPeriod(sal.period)
    setSalStatus(sal.payment_status)
    setSalAmountPaid(String(sal.amount_paid || ''))
    setSalAccountId(
      lastActivePay?.payment_method_account_id ||
        sal.payment_account_id ||
        paymentAccounts[0]?.id ||
        ''
    )
    setSalPaymentDate(
      lastActivePay?.date ||
        (sal.paid_at ? sal.paid_at.split('T')[0] : new Date().toISOString().split('T')[0])
    )
    setSalEditReason('Koreksi data gaji / pembayaran')
    setSalForceResetPayments(false)
    setSalModalError(null)
    setIsSalaryModalOpen(true)
  }

  // Live analysis of what happens when editing an existing salary
  const editImpactAnalysis = useMemo(() => {
    if (!editingSalary) return null
    const activePays = getActivePayments(editingSalary)
    const currentPaid = activePays.reduce((s, p) => s + Number(p.amount || 0), 0)
    if (currentPaid <= 0) {
      return {
        hasActivePayments: false,
        requiresPaymentReset: false,
        currentPaid: 0,
        newAmount: parseFloat(salAmount) || 0,
        newRequestedPaid: 0,
        newOutstanding: parseFloat(salAmount) || 0
      }
    }

    const parsedNewAmount = parseFloat(salAmount) || 0
    const parsedRequestedPaid =
      salStatus === 'paid'
        ? parsedNewAmount
        : salStatus === 'pending'
        ? 0
        : parseFloat(salAmountPaid) || 0

    const singlePay = activePays.length === 1 ? activePays[0] : null
    const accountChanged =
      singlePay && salAccountId && singlePay.payment_method_account_id !== salAccountId
    const dateChanged = singlePay && salPaymentDate && singlePay.date !== salPaymentDate

    const requiresPaymentReset =
      salForceResetPayments ||
      salStatus === 'pending' ||
      parsedNewAmount < currentPaid - 0.01 ||
      salEmployeeId !== editingSalary.employee_id ||
      Math.abs(parsedRequestedPaid - currentPaid) > 0.01 ||
      Boolean(accountChanged) ||
      Boolean(dateChanged)

    return {
      hasActivePayments: true,
      activePaymentsCount: activePays.length,
      currentPaid,
      requiresPaymentReset,
      newAmount: parsedNewAmount,
      newRequestedPaid: parsedRequestedPaid,
      newOutstanding: Math.max(0, parsedNewAmount - (requiresPaymentReset ? parsedRequestedPaid : currentPaid))
    }
  }, [
    editingSalary,
    getActivePayments,
    salAmount,
    salStatus,
    salAmountPaid,
    salAccountId,
    salPaymentDate,
    salEmployeeId,
    salForceResetPayments
  ])

  const handleSaveSalary = async (e: React.FormEvent) => {
    e.preventDefault()
    setSalModalError(null)

    if (!salEmployeeId) {
      setSalModalError('Silakan pilih karyawan penerima terlebih dahulu.')
      return
    }

    const numAmount = parseFloat(salAmount)
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setSalModalError('Nominal gaji harus valid dan lebih dari Rp 0.')
      return
    }

    const numAmountPaid =
      salStatus === 'paid'
        ? numAmount
        : salStatus === 'pending'
        ? 0
        : parseFloat(salAmountPaid)

    if (salStatus === 'partial') {
      if (!Number.isFinite(numAmountPaid) || numAmountPaid <= 0 || numAmountPaid >= numAmount) {
        setSalModalError(
          'Untuk status Dibayar Sebagian, nominal terbayar harus lebih dari Rp 0 dan kurang dari total gaji.'
        )
        return
      }
    }

    if ((salStatus === 'paid' || salStatus === 'partial') && !salAccountId) {
      setSalModalError('Silakan pilih akun Sumber Dana (Kas/Bank) untuk pembayaran.')
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
          payment_account_id:
            salStatus === 'paid' || salStatus === 'partial' ? salAccountId : null,
          amount_paid: numAmountPaid,
          payment_date:
            salStatus === 'paid' || salStatus === 'partial' ? salPaymentDate : null,
          edit_reason: salEditReason || 'Koreksi Data Gaji',
          reset_payments: editImpactAnalysis?.requiresPaymentReset || false
        })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal menyimpan catatan penggajian.')
      }

      const empName =
        employees.find(emp => emp.id === salEmployeeId)?.name ||
        editingSalary?.employees?.name ||
        'Karyawan'

      setIsSalaryModalOpen(false)

      const badges: string[] = [
        `Beban Gaji: ${formatCurrencyIDR(numAmount)}`,
        data?.payment_status === 'paid'
          ? `Lunas (${formatCurrencyIDR(data.amount_paid || numAmountPaid)})`
          : data?.payment_status === 'partial'
          ? `Terbayar: ${formatCurrencyIDR(data.amount_paid)} • Sisa: ${formatCurrencyIDR(data.outstanding_amount)}`
          : `Hutang Gaji: ${formatCurrencyIDR(numAmount)}`
      ]

      if (data?.auditSummary?.voidedOldPaymentsCount > 0) {
        badges.unshift(
          `Jurnal Pembalik Kas Lama: ${formatCurrencyIDR(data.auditSummary.voidedOldCashTotal)}`
        )
      }

      pushNotification({
        type: 'success',
        title: editingSalary
          ? 'Catatan Gaji & Jurnal Berhasil Diperbarui'
          : 'Penggajian Baru Berhasil Dibukukan',
        message: editingSalary
          ? `Perubahan gaji ${empName} (${salPeriod}) telah disinkronkan ke Buku Besar Akuntansi.`
          : `Slip gaji ${empName} (${salPeriod}) telah dicatat dengan pemisahan jurnal Akrual & Kas.`,
        auditBadges: badges
      })

      if (activeBizId) {
        const refreshed = await loadAllData(activeBizId)
        if (isSalaryDetailOpen && selectedSalaryForDetail && refreshed?.freshSalaries) {
          const updatedDetail = refreshed.freshSalaries.find(
            s => s.id === selectedSalaryForDetail.id
          )
          if (updatedDetail) {
            setSelectedSalaryForDetail(updatedDetail)
            fetchSalaryJournalEntries(updatedDetail)
          }
        }
      }
    } catch (err: any) {
      setSalModalError(err.message)
      pushNotification({
        type: 'error',
        title: 'Gagal Menyimpan Penggajian',
        message: err.message
      })
    } finally {
      setSalSubmitting(false)
    }
  }

  // ── QUICK PAY (INSTALLMENT / SETTLEMENT) HANDLERS ──
  const handleOpenQuickPay = (record: SalaryRecord) => {
    setQuickPayRecord(record)
    setQuickPayAmount(String(record.outstanding_amount ?? record.amount))
    setQuickPayAccountId(paymentAccounts[0]?.id || '')
    setQuickPayDate(new Date().toISOString().split('T')[0])
    setQuickPayNotes('Cicilan/Pelunasan Gaji')
    setQuickPayError(null)
    setIsQuickPayModalOpen(true)
  }

  const handleSaveQuickPay = async (e: React.FormEvent) => {
    e.preventDefault()
    setQuickPayError(null)
    if (!quickPayRecord) return

    if (!quickPayAccountId || !quickPayDate) {
      setQuickPayError('Rekening Kas/Bank dan Tanggal Pembayaran wajib diisi.')
      return
    }

    const numPayAmount = parseFloat(quickPayAmount)
    const maxPayable = quickPayRecord.outstanding_amount ?? quickPayRecord.amount

    if (!Number.isFinite(numPayAmount) || numPayAmount <= 0 || numPayAmount > maxPayable + 0.01) {
      setQuickPayError(
        `Nominal pembayaran harus lebih dari Rp 0 dan maksimal sebesar sisa hutang gaji (${formatCurrencyIDR(maxPayable)}).`
      )
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
          date: quickPayDate,
          notes: quickPayNotes || 'Cicilan/Pelunasan Gaji'
        })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal merekam pembayaran gaji.')
      }

      setIsQuickPayModalOpen(false)
      const isNowPaid = data?.auditSummary?.paymentStatus === 'paid'

      pushNotification({
        type: 'success',
        title: isNowPaid ? 'Gaji Karyawan Lunas!' : 'Pembayaran Cicilan Gaji Tercatat',
        message: `Pembayaran sebesar ${formatCurrencyIDR(numPayAmount)} untuk ${quickPayRecord.employees?.name} (${quickPayRecord.period}) berhasil dijurnal dari ${getAccountName(quickPayAccountId)}.`,
        auditBadges: [
          `Dr. Hutang Gaji ${formatCurrencyIDR(numPayAmount)}`,
          `Cr. ${getAccountName(quickPayAccountId)}`,
          isNowPaid
            ? 'Status: LUNAS'
            : `Sisa Hutang: ${formatCurrencyIDR(data?.auditSummary?.outstanding || 0)}`
        ]
      })

      if (activeBizId) {
        const refreshed = await loadAllData(activeBizId)
        if (isSalaryDetailOpen && selectedSalaryForDetail && refreshed?.freshSalaries) {
          const updatedDetail = refreshed.freshSalaries.find(
            s => s.id === selectedSalaryForDetail.id
          )
          if (updatedDetail) {
            setSelectedSalaryForDetail(updatedDetail)
            fetchSalaryJournalEntries(updatedDetail)
          }
        }
      }
    } catch (err: any) {
      setQuickPayError(err.message)
      pushNotification({
        type: 'error',
        title: 'Gagal Memproses Pembayaran Gaji',
        message: err.message
      })
    } finally {
      setQuickPaySubmitting(false)
    }
  }

  // ── VOID PAYMENT (BATALKAN PEMBAYARAN / UNRECONCILE) HANDLERS ──
  const handleOpenVoidPayment = (salary: SalaryRecord, payment?: SalaryPayment | null) => {
    setVoidingPaymentSalary(salary)
    setVoidingPaymentTarget(payment || null)
    setVoidPaymentReason('Salah pilih rekening Kas/Bank')
    setVoidPaymentError(null)
    setIsVoidPaymentModalOpen(true)
  }

  const handleConfirmVoidPayment = async () => {
    if (!voidingPaymentSalary) return
    setVoidPaymentSubmitting(true)
    setVoidPaymentError(null)

    try {
      const query = voidingPaymentTarget
        ? `paymentId=${encodeURIComponent(voidingPaymentTarget.id)}&reason=${encodeURIComponent(voidPaymentReason)}`
        : `all=true&reason=${encodeURIComponent(voidPaymentReason)}`

      const res = await fetch(`/api/employees/salary/${voidingPaymentSalary.id}/pay?${query}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidPaymentReason })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal membatalkan pembayaran gaji.')
      }

      const voidedAmt = data?.auditSummary?.voidedAmount || 0
      const newStatus = data?.auditSummary?.paymentStatus || 'pending'

      setIsVoidPaymentModalOpen(false)

      // If the user triggered this from inside the Edit Salary modal, update the Edit modal state immediately!
      if (isSalaryModalOpen && editingSalary && editingSalary.id === voidingPaymentSalary.id && data?.salary) {
        setEditingSalary(data.salary)
        setSalStatus(data.salary.payment_status)
        setSalAmountPaid(String(data.salary.amount_paid || 0))
        setSalForceResetPayments(false)
      }

      pushNotification({
        type: 'warning',
        title: 'Pembayaran Gaji Dibatalkan (Unreconciled)',
        message: `Pembayaran sebesar ${formatCurrencyIDR(voidedAmt)} untuk ${voidingPaymentSalary.employees?.name} (${voidingPaymentSalary.period}) telah dibalik. Anda kini dapat mengubah data gaji atau membayar ulang.`,
        auditBadges: [
          `Dr. Kas/Bank +${formatCurrencyIDR(voidedAmt)}`,
          `Cr. Hutang Gaji +${formatCurrencyIDR(voidedAmt)}`,
          newStatus === 'pending' ? 'Status: Belum Dibayar (Terbuka)' : 'Status: Dibayar Sebagian'
        ]
      })

      if (activeBizId) {
        const refreshed = await loadAllData(activeBizId)
        if (isSalaryDetailOpen && selectedSalaryForDetail && refreshed?.freshSalaries) {
          const updatedDetail = refreshed.freshSalaries.find(
            s => s.id === selectedSalaryForDetail.id
          )
          if (updatedDetail) {
            setSelectedSalaryForDetail(updatedDetail)
            fetchSalaryJournalEntries(updatedDetail)
          }
        }
      }
    } catch (err: any) {
      setVoidPaymentError(err.message)
      pushNotification({
        type: 'error',
        title: 'Gagal Membatalkan Pembayaran',
        message: err.message
      })
    } finally {
      setVoidPaymentSubmitting(false)
    }
  }

  // ── CANCEL PAYSLIP (ONE-CLICK CASCADE REVERSAL) HANDLERS ──
  const handleOpenCancelSalary = (sal: SalaryRecord) => {
    setCancellingSalary(sal)
    setCancelSalaryReason('Koreksi / Buat ulang slip gaji')
    setCancelSalaryError(null)
    setIsCancelSalaryModalOpen(true)
  }

  const handleCancelSalary = async () => {
    if (!cancellingSalary) return
    setCancelSalarySubmitting(true)
    setCancelSalaryError(null)

    try {
      const res = await fetch(`/api/employees/salary?id=${cancellingSalary.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_status: 'cancelled',
          cancel_reason: cancelSalaryReason
        })
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal membatalkan slip gaji.')
      }

      const revCash = data?.auditSummary?.reversedCashTotal || 0
      const revAccrual = data?.auditSummary?.reversedAccrualAmount || cancellingSalary.amount

      setIsCancelSalaryModalOpen(false)

      const badges = [
        `Cr. Beban Gaji -${formatCurrencyIDR(revAccrual)}`,
        `Periode ${cancellingSalary.period} Terbuka Kembali`
      ]
      if (revCash > 0) {
        badges.unshift(`Dr. Kas/Bank +${formatCurrencyIDR(revCash)}`)
      }

      pushNotification({
        type: 'warning',
        title: 'Slip Gaji Berhasil Dibatalkan',
        message: `Slip gaji ${cancellingSalary.employees?.name} (${cancellingSalary.period}) telah dibatalkan beserta seluruh jurnal pembaliknya. Anda dapat mencatat ulang gaji baru untuk periode ini.`,
        auditBadges: badges
      })

      if (activeBizId) {
        const refreshed = await loadAllData(activeBizId)
        if (isSalaryDetailOpen && selectedSalaryForDetail && refreshed?.freshSalaries) {
          const updatedDetail = refreshed.freshSalaries.find(
            s => s.id === selectedSalaryForDetail.id
          )
          if (updatedDetail) {
            setSelectedSalaryForDetail(updatedDetail)
            fetchSalaryJournalEntries(updatedDetail)
          }
        }
      }
    } catch (err: any) {
      setCancelSalaryError(err.message)
      pushNotification({
        type: 'error',
        title: 'Gagal Membatalkan Slip Gaji',
        message: err.message
      })
    } finally {
      setCancelSalarySubmitting(false)
    }
  }

  // ── DELETE PAYSLIP HANDLERS ──
  const handleOpenDeleteSalary = (sal: SalaryRecord) => {
    setDeletingSalary(sal)
    setDeleteSalaryError(null)
    setIsDeleteSalaryModalOpen(true)
  }

  const handleDeleteSalary = async () => {
    if (!deletingSalary) return
    setDeleteSalarySubmitting(true)
    setDeleteSalaryError(null)

    try {
      const res = await fetch(`/api/employees/salary?id=${deletingSalary.id}`, {
        method: 'DELETE'
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal menghapus catatan gaji.')
      }

      const empName = deletingSalary.employees?.name
      const empPeriod = deletingSalary.period
      setIsDeleteSalaryModalOpen(false)
      if (isSalaryDetailOpen && selectedSalaryForDetail?.id === deletingSalary.id) {
        setIsSalaryDetailOpen(false)
      }

      pushNotification({
        type: 'info',
        title: 'Catatan Gaji Dihapus Permanen',
        message: `Arsip catatan gaji ${empName} (${empPeriod}) beserta jurnal terkait telah dibersihkan.`
      })

      if (activeBizId) {
        await loadAllData(activeBizId)
      }
    } catch (err: any) {
      setDeleteSalaryError(err.message)
      pushNotification({
        type: 'error',
        title: 'Tidak Dapat Menghapus Catatan Gaji',
        message: err.message
      })
    } finally {
      setDeleteSalarySubmitting(false)
    }
  }

  // ── OPEN SALARY DETAIL & JOURNAL MODAL ──
  const handleOpenSalaryDetail = async (sal: SalaryRecord) => {
    setSelectedSalaryForDetail(sal)
    setIsSalaryDetailOpen(true)
    setSalaryTransactions([])
    await fetchSalaryJournalEntries(sal)
  }

  // Helper to classify transaction card badge in Detail Modal
  const classifyTransactionBadge = (desc: string) => {
    const lower = (desc || '').toLowerCase()
    if (lower.includes('pembatalan pembayaran')) {
      return {
        label: 'Jurnal Pembalik Pembayaran (Void Kas)',
        className: 'bg-amber-50 text-amber-700 border-amber-200'
      }
    }
    if (lower.includes('pembatalan gaji')) {
      return {
        label: 'Jurnal Pembatalan Slip Gaji (Reversal Beban)',
        className: 'bg-rose-50 text-rose-700 border-rose-200'
      }
    }
    if (lower.includes('pembayaran gaji')) {
      return {
        label: 'Jurnal Pelunasan Kas/Bank (Settlement)',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }
    }
    return {
      label: 'Jurnal Pengakuan Beban Gaji (Accrual)',
      className: 'bg-blue-50 text-blue-700 border-blue-200'
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

  const cancellingActivePayments = getActivePayments(cancellingSalary)
  const cancellingPaidTotal = cancellingActivePayments.reduce(
    (s, p) => s + Number(p.amount || 0),
    0
  )

  const voidTargetPayments = voidingPaymentTarget
    ? [voidingPaymentTarget]
    : getActivePayments(voidingPaymentSalary)
  const voidTargetTotal = voidTargetPayments.reduce((s, p) => s + Number(p.amount || 0), 0)

  return (
    <div className="space-y-6 text-slate-800">
      {/* ── WORLD-CLASS FLOATING NOTIFICATION & AUDIT FEEDBACK SYSTEM ── */}
      {mounted &&
        notifications.length > 0 &&
        createPortal(
          <div className="fixed top-4 right-4 left-4 sm:left-auto sm:w-[420px] z-[200] space-y-2.5 pointer-events-none">
            {notifications.map(n => {
              const styleMap = {
                success: {
                  border: 'border-emerald-200',
                  bg: 'bg-white/95',
                  accent: 'bg-emerald-500',
                  iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
                  icon: '✓',
                  titleColor: 'text-slate-900',
                  badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200'
                },
                warning: {
                  border: 'border-amber-200',
                  bg: 'bg-white/95',
                  accent: 'bg-amber-500',
                  iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
                  icon: '↺',
                  titleColor: 'text-slate-900',
                  badgeClass: 'bg-amber-50 text-amber-800 border-amber-200'
                },
                error: {
                  border: 'border-rose-200',
                  bg: 'bg-white/95',
                  accent: 'bg-rose-500',
                  iconBg: 'bg-rose-50 text-rose-600 border-rose-100',
                  icon: '!',
                  titleColor: 'text-rose-900',
                  badgeClass: 'bg-rose-50 text-rose-700 border-rose-200'
                },
                info: {
                  border: 'border-blue-200',
                  bg: 'bg-white/95',
                  accent: 'bg-blue-500',
                  iconBg: 'bg-blue-50 text-blue-600 border-blue-100',
                  icon: 'i',
                  titleColor: 'text-slate-900',
                  badgeClass: 'bg-blue-50 text-blue-700 border-blue-200'
                }
              }[n.type]

              return (
                <div
                  key={n.id}
                  className={`pointer-events-auto relative overflow-hidden rounded-2xl border ${styleMap.border} ${styleMap.bg} backdrop-blur-md shadow-xl p-4 transition-all animate-in fade-in slide-in-from-top-3 duration-200`}
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${styleMap.accent}`} />
                  <div className="flex items-start gap-3 pl-1.5">
                    <div
                      className={`w-8 h-8 rounded-xl border flex items-center justify-center font-black text-sm shrink-0 ${styleMap.iconBg}`}
                    >
                      {styleMap.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className={`text-xs font-extrabold uppercase tracking-tight ${styleMap.titleColor}`}>
                          {n.title}
                        </h4>
                        <span className="text-[9px] font-mono text-slate-400 shrink-0">
                          {n.timestamp}
                        </span>
                      </div>
                      <p className="text-[11px] font-medium text-slate-600 mt-1 leading-relaxed">
                        {n.message}
                      </p>
                      {n.auditBadges && n.auditBadges.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {n.auditBadges.map((b, i) => (
                            <span
                              key={i}
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-md border font-mono ${styleMap.badgeClass}`}
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => dismissNotification(n.id)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1 cursor-pointer"
                      aria-label="Tutup notifikasi"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>,
          document.body
        )}

      {/* Page Header */}
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Laporan Karyawan & Payroll
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
            Kelola data staf, pembukuan akrual gaji, pelunasan bertahap, dan rekonsiliasi jurnal pembalik otomatis.
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

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">
            Karyawan Aktif
          </div>
          <div className="text-xl font-black text-gray-900 mt-1">{kpiData.activeEmpCount} Orang</div>
          <div className="text-[9px] text-blue-600 font-bold mt-1.5 uppercase">
            Staf terdaftar aktif
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">
            Gaji Bulan Ini ({currentPeriod})
          </div>
          <div className="text-xl font-black text-gray-900 mt-1">
            {formatCurrencyIDR(kpiData.totalPayroll)}
          </div>
          <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">
            Total beban payroll aktif
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">
            Gaji Terbayar (Kas Keluar)
          </div>
          <div className="text-xl font-black text-emerald-600 mt-1">
            {formatCurrencyIDR(kpiData.paidPayroll)}
          </div>
          <div className="text-[9px] text-emerald-600 font-bold mt-1.5 uppercase">
            Sudah dibukukan dari Kas/Bank
          </div>
        </div>

        <div
          className={`border rounded-xl p-5 shadow-xs transition-all ${
            kpiData.unpaidPayroll > 0
              ? 'bg-rose-50/50 border-rose-200'
              : 'bg-white border-gray-200'
          }`}
        >
          <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">
            Sisa Hutang Gaji (201100)
          </div>
          <div
            className={`text-xl font-black mt-1 ${
              kpiData.unpaidPayroll > 0 ? 'text-rose-600' : 'text-gray-900'
            }`}
          >
            {formatCurrencyIDR(kpiData.unpaidPayroll)}
          </div>
          <div
            className={`text-[9px] font-bold mt-1.5 uppercase ${
              kpiData.unpaidPayroll > 0 ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {kpiData.unpaidPayroll > 0 ? '🔴 Menunggu Pelunasan' : '🟢 Bebas Tunggakan'}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
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
                    <td className="px-6 py-4 font-mono text-gray-500 break-all">
                      {emp.email || '-'}
                    </td>
                    <td className="px-6 py-4 font-mono text-gray-500">{emp.phone || '-'}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block text-[9px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                          emp.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-100'
                        }`}
                      >
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
                  <th className="px-6 py-4 w-1/5">Karyawan</th>
                  <th className="px-6 py-4 w-1/8">Periode</th>
                  <th className="px-6 py-4 w-1/5">Nominal & Saldo</th>
                  <th className="px-6 py-4 w-1/7">Status Pembayaran</th>
                  <th className="px-6 py-4 w-1/7">Tanggal Bayar</th>
                  <th className="px-6 py-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs font-medium text-gray-700">
                {salaries.map(sal => {
                  const activePays = getActivePayments(sal)
                  const hasActivePayment = activePays.length > 0 && sal.payment_status !== 'cancelled'

                  return (
                    <tr
                      key={sal.id}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      onClick={() => handleOpenSalaryDetail(sal)}
                    >
                      <td className="px-6 py-4 font-bold text-gray-900">
                        <div>{sal.employees?.name}</div>
                        <div className="text-[10px] text-gray-400 font-normal">
                          {sal.employees?.position || 'Staf'}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-600 font-mono">
                        {sal.period}
                      </td>
                      <td className="px-6 py-4 font-mono">
                        <div className="font-bold text-gray-900">
                          {formatCurrencyIDR(sal.amount)}
                        </div>
                        {sal.payment_status === 'partial' && (
                          <div className="text-[9px] font-semibold text-indigo-600 mt-0.5">
                            Terbayar: {formatCurrencyIDR(sal.amount_paid)} • Sisa:{' '}
                            {formatCurrencyIDR(sal.outstanding_amount)}
                          </div>
                        )}
                        {sal.payment_status === 'pending' && (
                          <div className="text-[9px] font-semibold text-amber-600 mt-0.5">
                            Hutang Gaji: {formatCurrencyIDR(sal.outstanding_amount ?? sal.amount)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-block text-[9px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                            sal.payment_status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : sal.payment_status === 'partial'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                              : sal.payment_status === 'cancelled'
                              ? 'bg-rose-50 text-rose-700 border-rose-100'
                              : 'bg-amber-50 text-amber-700 border-amber-100'
                          }`}
                        >
                          {sal.payment_status === 'paid'
                            ? 'Lunas'
                            : sal.payment_status === 'partial'
                            ? 'Sebagian'
                            : sal.payment_status === 'cancelled'
                            ? 'Dibatalkan'
                            : 'Belum Dibayar'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-500">
                        {sal.paid_at
                          ? new Date(sal.paid_at).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })
                          : '-'}
                      </td>
                      <td
                        className="px-6 py-4 text-center"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex flex-row items-center justify-center gap-1.5 whitespace-nowrap">
                          {(sal.payment_status === 'pending' ||
                            sal.payment_status === 'partial') && (
                            <button
                              onClick={() => handleOpenQuickPay(sal)}
                              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] uppercase transition-all shadow-xs cursor-pointer active:scale-97"
                              title="Bayar / Lunasi Hutang Gaji"
                            >
                              💸 Bayar
                            </button>
                          )}
                          {hasActivePayment && (
                            <button
                              onClick={() => handleOpenVoidPayment(sal, null)}
                              className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-indigo-700 font-bold text-[10px] uppercase transition-all cursor-pointer"
                              title="Batalkan pembayaran kas/bank untuk membuka kunci edit atau mengganti rekening"
                            >
                              ↩️ Batal Bayar
                            </button>
                          )}
                          {sal.payment_status !== 'cancelled' && (
                            <button
                              onClick={() => handleOpenEditSalary(sal)}
                              className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg text-blue-600 font-bold text-[10px] uppercase transition-all cursor-pointer"
                              title="Ubah nominal gaji, periode, atau koreksi pembayaran"
                            >
                              Edit
                            </button>
                          )}
                          {sal.payment_status !== 'cancelled' && (
                            <button
                              onClick={() => handleOpenCancelSalary(sal)}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg text-amber-700 font-bold text-[10px] uppercase transition-all cursor-pointer"
                              title="Batalkan seluruh slip gaji beserta jurnal pembalik otomatis"
                            >
                              Batal Slip
                            </button>
                          )}
                          {(sal.payment_status === 'pending' ||
                            sal.payment_status === 'cancelled') && (
                            <button
                              onClick={() => handleOpenDeleteSalary(sal)}
                              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-lg text-rose-600 font-bold text-[10px] uppercase transition-all cursor-pointer"
                              title="Hapus permanen catatan gaji"
                            >
                              Hapus
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
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

      {/* ═══════════════════════════════════════════════════════════════════════════
          MODALS
         ═══════════════════════════════════════════════════════════════════════════ */}

      {/* 1. Employee Add/Edit Modal */}
      {isEmployeeModalOpen &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-gray-50 border-b border-gray-150 px-6 py-4 flex justify-between items-center">
                <h3 className="font-extrabold text-sm uppercase text-gray-900 tracking-tight">
                  {editingEmployee ? 'Edit Data Karyawan' : 'Tambah Karyawan Baru'}
                </h3>
                <button
                  onClick={() => setIsEmployeeModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleSaveEmployee} className="p-6 space-y-4">
                {empModalError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2">
                    <span className="font-black">⚠️</span>
                    <span>{empModalError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Nama Lengkap *
                  </label>
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
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Jabatan / Posisi
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Staf Kasir"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={empPosition}
                    onChange={e => setEmpPosition(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Alamat Email
                  </label>
                  <input
                    type="email"
                    placeholder="Contoh: budi@mail.com"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={empEmail}
                    onChange={e => setEmpEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Nomor Telepon
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: 08123456789"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={empPhone}
                    onChange={e => setEmpPhone(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Status Keaktifan
                  </label>
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

      {/* 2. Delete Employee Confirmation Modal */}
      {isDeleteModalOpen &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-155">
              <div className="text-center space-y-2">
                <div className="text-2xl">⚠️</div>
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Hapus Karyawan?
                </h3>
                <p className="text-xs font-semibold text-gray-500 leading-normal">
                  Apakah Anda yakin ingin menghapus data karyawan{' '}
                  <span className="text-gray-900 font-bold underline">
                    {deletingEmployee?.name}
                  </span>
                  ? Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              {deleteEmpError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {deleteEmpError}
                </div>
              )}
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

      {/* 3. Record / Smart Edit Salary Modal */}
      {isSalaryModalOpen &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-gray-50 border-b border-gray-150 px-6 py-4 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-extrabold text-sm uppercase text-gray-900 tracking-tight">
                    {editingSalary ? 'Edit & Koreksi Catatan Payroll' : 'Catat Payroll Gaji'}
                  </h3>
                  <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                    {editingSalary
                      ? 'Sistem otomatis menyinkronkan Jurnal Akrual & Jurnal Pembalik Kas'
                      : 'Otomatis membukukan Jurnal Beban Gaji (503300) & Hutang/Kas'}
                  </p>
                </div>
                <button
                  onClick={() => setIsSalaryModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveSalary} className="p-6 space-y-4 overflow-y-auto">
                {salModalError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2.5">
                    <span className="text-base leading-none">⚠️</span>
                    <div className="space-y-1">
                      <div className="font-extrabold uppercase text-[10px] tracking-wider text-rose-800">
                        Validasi Gagal
                      </div>
                      <div>{salModalError}</div>
                    </div>
                  </div>
                )}

                {/* SMART ACCOUNTING STATUS BANNER WHEN EDITING PAID/PARTIAL SALARY */}
                {editingSalary && editImpactAnalysis?.hasActivePayments && (
                  <div
                    className={`p-4 rounded-xl border space-y-2.5 transition-all ${
                      editImpactAnalysis.requiresPaymentReset
                        ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                        : 'bg-indigo-50/70 border-indigo-200 text-indigo-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {editImpactAnalysis.requiresPaymentReset ? '🔄' : '🛡️'}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-wider">
                          {editImpactAnalysis.requiresPaymentReset
                            ? 'Mode Koreksi Pembayaran Otomatis (Reversal & Re-entry)'
                            : `Memiliki Pembayaran Aktif: ${formatCurrencyIDR(editImpactAnalysis.currentPaid)}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenVoidPayment(editingSalary, null)}
                        className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-[10px] font-extrabold text-slate-700 uppercase shadow-2xs shrink-0 cursor-pointer"
                      >
                        ↩️ Batal Bayar Saja
                      </button>
                    </div>

                    {editImpactAnalysis.requiresPaymentReset ? (
                      <div className="text-[11px] font-medium leading-relaxed space-y-1.5">
                        <p>
                          Perubahan yang Anda pilih akan <strong>membatalkan otomatis</strong>{' '}
                          pembayaran lama sebesar{' '}
                          <span className="font-mono font-bold underline">
                            {formatCurrencyIDR(editImpactAnalysis.currentPaid)}
                          </span>{' '}
                          dengan menerbitkan <strong>Jurnal Pembalik Kas/Bank</strong>, lalu
                          menerapkan konfigurasi gaji & pembayaran yang baru.
                        </p>
                        <div className="pt-1">
                          <label className="block text-[9px] font-extrabold uppercase tracking-wider text-amber-800 mb-1">
                            Catatan Audit Koreksi
                          </label>
                          <input
                            type="text"
                            placeholder="Contoh: Koreksi rekening bank & nominal gaji"
                            className="w-full p-2 border border-amber-300 rounded-lg text-xs font-semibold text-slate-800 bg-white outline-none"
                            value={salEditReason}
                            onChange={e => setSalEditReason(e.target.value)}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] font-medium leading-relaxed">
                        Pembayaran yang sudah masuk sebesar{' '}
                        <span className="font-mono font-bold">
                          {formatCurrencyIDR(editImpactAnalysis.currentPaid)}
                        </span>{' '}
                        tetap dipertahankan. Jurnal Beban Gaji akan diperbarui menjadi{' '}
                        <span className="font-mono font-bold">
                          {formatCurrencyIDR(editImpactAnalysis.newAmount)}
                        </span>{' '}
                        (Sisa Hutang Gaji:{' '}
                        <span className="font-mono font-bold">
                          {formatCurrencyIDR(editImpactAnalysis.newOutstanding)}
                        </span>
                        ).
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Karyawan Penerima *
                  </label>
                  <select
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={salEmployeeId}
                    onChange={e => setSalEmployeeId(e.target.value)}
                  >
                    <option value="">-- Pilih Karyawan --</option>
                    {employees
                      .filter(e => e.status === 'active' || e.id === salEmployeeId)
                      .map(e => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({e.position || 'Staf'})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                      Periode Gaji (Bulan/Tahun) *
                    </label>
                    <input
                      type="month"
                      required
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                      value={salPeriod.split(' (Batal')[0]}
                      onChange={e => setSalPeriod(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                      Total Nominal Gaji *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="Contoh: 3500000"
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none font-mono"
                      value={salAmount}
                      onChange={e => {
                        const nextVal = e.target.value
                        setSalAmount(nextVal)
                        if (
                          editingSalary &&
                          editImpactAnalysis?.hasActivePayments &&
                          !salForceResetPayments
                        ) {
                          const parsed = parseFloat(nextVal) || 0
                          if (parsed > editImpactAnalysis.currentPaid) {
                            setSalStatus('partial')
                            setSalAmountPaid(String(editImpactAnalysis.currentPaid))
                          } else if (Math.abs(parsed - editImpactAnalysis.currentPaid) <= 0.01) {
                            setSalStatus('paid')
                            setSalAmountPaid(String(parsed))
                          }
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Status Pembayaran
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSalStatus('paid')
                        if (salAmount) setSalAmountPaid(salAmount)
                      }}
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
                      onClick={() => {
                        setSalStatus('pending')
                        setSalAmountPaid('0')
                      }}
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
                    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                      Nominal yang Sudah Dibayar *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="Contoh: 1500000"
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none font-mono"
                      value={salAmountPaid}
                      onChange={e => setSalAmountPaid(e.target.value)}
                    />
                    {salAmount && salAmountPaid && (
                      <div className="text-[10px] text-indigo-600 font-bold">
                        Sisa Hutang Gaji (201100):{' '}
                        {formatCurrencyIDR(
                          Math.max(0, parseFloat(salAmount) - parseFloat(salAmountPaid))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {(salStatus === 'paid' || salStatus === 'partial') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 animate-in slide-in-from-top-2 duration-150">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                        Tanggal Pembayaran Kas *
                      </label>
                      <input
                        type="date"
                        required
                        className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                        value={salPaymentDate}
                        onChange={e => setSalPaymentDate(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                        Sumber Dana (Kas/Bank) *
                      </label>
                      <select
                        required
                        className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                        value={salAccountId}
                        onChange={e => setSalAccountId(e.target.value)}
                      >
                        <option value="">-- Pilih Rekening --</option>
                        {paymentAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            🏦 {acc.name} ({acc.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* LIVE DOUBLE-ENTRY JOURNAL PREVIEW */}
                {parseFloat(salAmount) > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                      <span>Pratinjau Dampak Buku Besar (Double-Entry)</span>
                      <span className="text-emerald-600 font-mono">Balanced ✓</span>
                    </div>
                    <div className="text-[11px] font-mono space-y-1 text-slate-700">
                      <div className="flex justify-between">
                        <span>Dr. (503300) Beban Gaji & Upah</span>
                        <span className="font-bold text-slate-900">
                          {formatCurrencyIDR(parseFloat(salAmount) || 0)}
                        </span>
                      </div>
                      {salStatus === 'paid' && (
                        <div className="flex justify-between pl-4 text-slate-500">
                          <span>Cr. {getAccountName(salAccountId)}</span>
                          <span className="font-bold text-emerald-700">
                            {formatCurrencyIDR(parseFloat(salAmount) || 0)}
                          </span>
                        </div>
                      )}
                      {salStatus === 'partial' && (
                        <>
                          <div className="flex justify-between pl-4 text-slate-500">
                            <span>Cr. {getAccountName(salAccountId)}</span>
                            <span className="font-bold text-emerald-700">
                              {formatCurrencyIDR(parseFloat(salAmountPaid) || 0)}
                            </span>
                          </div>
                          <div className="flex justify-between pl-4 text-slate-500">
                            <span>Cr. (201100) Hutang Gaji & Upah</span>
                            <span className="font-bold text-amber-700">
                              {formatCurrencyIDR(
                                Math.max(
                                  0,
                                  (parseFloat(salAmount) || 0) - (parseFloat(salAmountPaid) || 0)
                                )
                              )}
                            </span>
                          </div>
                        </>
                      )}
                      {salStatus === 'pending' && (
                        <div className="flex justify-between pl-4 text-slate-500">
                          <span>Cr. (201100) Hutang Gaji & Upah</span>
                          <span className="font-bold text-amber-700">
                            {formatCurrencyIDR(parseFloat(salAmount) || 0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-4 border-t border-gray-150 mt-4 justify-end">
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
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-750 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {salSubmitting
                      ? 'Memproses Jurnal...'
                      : editImpactAnalysis?.requiresPaymentReset
                      ? 'Simpan & Koreksi Jurnal'
                      : 'Simpan'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* 4. Quick Pay / Pay Pending Salary Modal */}
      {isQuickPayModalOpen &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-gray-50 border-b border-gray-150 px-6 py-4 flex justify-between items-center">
                <h3 className="font-extrabold text-sm uppercase text-gray-900 tracking-tight">
                  Bayar Kewajiban Gaji
                </h3>
                <button
                  onClick={() => setIsQuickPayModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleSaveQuickPay} className="p-6 space-y-4">
                {quickPayError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2">
                    <span>⚠️</span>
                    <span>{quickPayError}</span>
                  </div>
                )}

                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                  <div className="text-[10px] font-extrabold uppercase text-gray-400">
                    Rincian Kewajiban Gaji:
                  </div>
                  <div className="flex justify-between font-bold text-xs">
                    <span className="text-gray-500">Penerima:</span>
                    <span className="text-gray-900 font-bold">
                      {quickPayRecord?.employees?.name}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-xs">
                    <span className="text-gray-500">Periode:</span>
                    <span className="text-gray-900 font-mono">{quickPayRecord?.period}</span>
                  </div>
                  <div className="flex justify-between font-bold text-xs">
                    <span className="text-gray-500">Total Nominal Gaji:</span>
                    <span className="text-gray-900 font-mono font-bold">
                      {quickPayRecord ? formatCurrencyIDR(quickPayRecord.amount) : ''}
                    </span>
                  </div>
                  {quickPayRecord && (quickPayRecord.amount_paid ?? 0) > 0 && (
                    <div className="flex justify-between font-bold text-xs">
                      <span className="text-gray-500">Sudah Terbayar:</span>
                      <span className="text-emerald-600 font-mono font-bold">
                        {formatCurrencyIDR(quickPayRecord.amount_paid)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-xs border-t border-gray-200 pt-2">
                    <span className="text-gray-900 font-black">Sisa Hutang Gaji (201100):</span>
                    <span className="text-indigo-600 font-mono font-black">
                      {formatCurrencyIDR(
                        quickPayRecord
                          ? quickPayRecord.outstanding_amount ?? quickPayRecord.amount
                          : 0
                      )}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Tanggal Pembayaran *
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={quickPayDate}
                    onChange={e => setQuickPayDate(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Nominal yang Dibayar *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none font-mono"
                    value={quickPayAmount}
                    onChange={e => setQuickPayAmount(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Sumber Dana (Kas/Bank) *
                  </label>
                  <select
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={quickPayAccountId}
                    onChange={e => setQuickPayAccountId(e.target.value)}
                  >
                    <option value="">-- Pilih Rekening Pembayaran --</option>
                    {paymentAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        🏦 {acc.name} ({acc.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Catatan / Keterangan Pembayaran
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Pelunasan gaji via transfer"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white outline-none"
                    value={quickPayNotes}
                    onChange={e => setQuickPayNotes(e.target.value)}
                  />
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
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {quickPaySubmitting ? 'Memproses...' : 'Proses Pembayaran'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* 5. WORLD-CLASS VOID PAYMENT MODAL (Batalkan Pembayaran / Unreconcile) */}
      {isVoidPaymentModalOpen &&
        voidingPaymentSalary &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-indigo-50/80 border-b border-indigo-100 px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-sm">
                    ↩️
                  </span>
                  <div>
                    <h3 className="font-extrabold text-sm uppercase text-slate-900 tracking-tight">
                      Batalkan Pembayaran Gaji
                    </h3>
                    <p className="text-[10px] font-semibold text-indigo-700">
                      Unreconcile Kas/Bank • Buka Kunci Edit Slip Gaji
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsVoidPaymentModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4">
                {voidPaymentError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                    ⚠️ {voidPaymentError}
                  </div>
                )}

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Karyawan & Periode:</span>
                    <span className="font-bold text-slate-900">
                      {voidingPaymentSalary.employees?.name} ({voidingPaymentSalary.period})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Nominal Pembayaran Dibatalkan:</span>
                    <span className="font-mono font-black text-rose-600">
                      {formatCurrencyIDR(voidTargetTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="text-slate-500 font-medium">Status Gaji Setelah Batal Bayar:</span>
                    <span className="font-extrabold text-amber-700 uppercase text-[10px] bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {voidingPaymentTarget &&
                      getActivePayments(voidingPaymentSalary).length > 1
                        ? 'Dibayar Sebagian (Partial)'
                        : 'Belum Dibayar (Pending — Siap Edit)'}
                    </span>
                  </div>
                </div>

                {/* Live Accounting Impact Preview */}
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3.5 space-y-2">
                  <div className="text-[9px] font-black uppercase tracking-wider text-amber-800">
                    Jurnal Pembalik Otomatis yang Akan Diterbitkan:
                  </div>
                  <div className="text-[11px] font-mono space-y-1 text-slate-800">
                    {voidTargetPayments.map(p => (
                      <div key={p.id} className="flex justify-between">
                        <span>Dr. {p.accounts?.name || getAccountName(p.payment_method_account_id)}</span>
                        <span className="font-bold text-emerald-700">
                          +{formatCurrencyIDR(p.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between pl-4 text-slate-600">
                      <span>Cr. (201100) Hutang Gaji & Upah</span>
                      <span className="font-bold text-indigo-700">
                        +{formatCurrencyIDR(voidTargetTotal)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-amber-800 font-medium leading-relaxed pt-1">
                    * Saldo Kas/Bank akan dikembalikan dan kewajiban Hutang Gaji terbuka kembali tanpa menghapus beban gaji induk.
                  </p>
                </div>

                {/* Reason Selector Chips */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Alasan Pembatalan Pembayaran
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {VOID_PAYMENT_REASONS.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setVoidPaymentReason(r)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                          voidPaymentReason === r
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Ketik alasan pembatalan..."
                    value={voidPaymentReason}
                    onChange={e => setVoidPaymentReason(e.target.value)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 bg-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsVoidPaymentModalOpen(false)}
                    className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                  >
                    Kembali
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmVoidPayment}
                    disabled={voidPaymentSubmitting}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {voidPaymentSubmitting ? 'Membalik Jurnal...' : 'Ya, Batalkan Pembayaran'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 6. WORLD-CLASS CANCEL SALARY MODAL (One-Click Cascade Reversal) */}
      {isCancelSalaryModalOpen &&
        cancellingSalary &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-155">
              <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black text-sm">
                    ⚠️
                  </span>
                  <div>
                    <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                      Batalkan Seluruh Slip Gaji?
                    </h3>
                    <p className="text-[10px] font-semibold text-amber-800">
                      Jurnal Pembalik Beban & Kas Otomatis
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsCancelSalaryModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4">
                {cancelSalaryError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                    ⚠️ {cancelSalaryError}
                  </div>
                )}

                <p className="text-xs font-semibold text-gray-600 leading-relaxed">
                  Anda akan membatalkan slip gaji untuk{' '}
                  <span className="text-gray-900 font-bold underline">
                    {cancellingSalary.employees?.name}
                  </span>{' '}
                  periode <span className="font-mono font-bold">{cancellingSalary.period}</span>{' '}
                  sebesar{' '}
                  <span className="font-mono font-bold text-gray-900">
                    {formatCurrencyIDR(cancellingSalary.amount)}
                  </span>
                  .
                </p>

                {cancellingPaidTotal > 0 && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-medium leading-relaxed">
                    💡 Slip gaji ini memiliki pembayaran aktif sebesar{' '}
                    <strong className="font-mono">{formatCurrencyIDR(cancellingPaidTotal)}</strong>.
                    Sistem akan otomatis membatalkan pembayaran tersebut dan mengembalikan saldo ke
                    rekening Kas/Bank terkait.
                  </div>
                )}

                {/* Double-Entry Reversal Preview */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                  <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                    Dampak Jurnal Pembalik di Buku Besar:
                  </div>
                  <div className="text-[11px] font-mono space-y-1 text-slate-700">
                    {cancellingActivePayments.map(p => (
                      <div key={p.id} className="flex justify-between">
                        <span>Dr. {p.accounts?.name || getAccountName(p.payment_method_account_id)}</span>
                        <span className="font-bold text-emerald-700">
                          +{formatCurrencyIDR(p.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between">
                      <span>Dr. (201100) Hutang Gaji & Upah</span>
                      <span className="font-bold text-slate-900">
                        {formatCurrencyIDR(cancellingSalary.outstanding_amount || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between pl-4 text-slate-500">
                      <span>Cr. (503300) Beban Gaji & Upah</span>
                      <span className="font-bold text-rose-600">
                        -{formatCurrencyIDR(cancellingSalary.amount)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Reason Selector */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Alasan Pembatalan Slip Gaji
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {CANCEL_SALARY_REASONS.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setCancelSalaryReason(r)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                          cancelSalaryReason === r
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={cancelSalaryReason}
                    onChange={e => setCancelSalaryReason(e.target.value)}
                    placeholder="Ketik alasan pembatalan..."
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 bg-white outline-none"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-2">
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
                    {cancelSalarySubmitting ? 'Membatalkan...' : 'Ya, Batalkan Slip Gaji'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 7. Delete Salary Confirmation Modal */}
      {isDeleteSalaryModalOpen &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-155">
              <div className="text-center space-y-2">
                <div className="text-2xl">🚨</div>
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Hapus Permanen Catatan Gaji?
                </h3>
                <p className="text-xs font-semibold text-gray-500 leading-normal">
                  Apakah Anda yakin ingin menghapus permanen catatan gaji untuk{' '}
                  <span className="text-gray-900 font-bold underline">
                    {deletingSalary?.employees?.name}
                  </span>{' '}
                  ({deletingSalary?.period})?
                </p>
                <p className="text-[10px] text-rose-600 font-bold uppercase leading-normal">
                  Catatan beserta jurnal transaksi terkait akan dihapus dari database.
                </p>
              </div>
              {deleteSalaryError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  ⚠️ {deleteSalaryError}
                </div>
              )}
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

      {/* 8. Salary Detail and Journal Entries Modal */}
      {isSalaryDetailOpen &&
        selectedSalaryForDetail &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-5xl bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] font-sans animate-in fade-in zoom-in-95 duration-150">
              {/* Header */}
              <div className="bg-gray-50 border-b border-gray-150 px-6 md:px-8 py-5 flex flex-wrap justify-between items-center gap-3">
                <div>
                  <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-0.5 rounded border border-blue-100 uppercase tracking-widest mb-1.5 inline-block">
                    Detail Payroll & Audit Buku Besar
                  </span>
                  <h3 className="font-extrabold text-lg text-gray-900 tracking-tight leading-none uppercase">
                    {selectedSalaryForDetail.employees?.name}
                  </h3>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block mt-1">
                    {selectedSalaryForDetail.employees?.position || 'Karyawan'} • Periode{' '}
                    {selectedSalaryForDetail.period}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {(selectedSalaryForDetail.payment_status === 'pending' ||
                    selectedSalaryForDetail.payment_status === 'partial') && (
                    <button
                      onClick={() => handleOpenQuickPay(selectedSalaryForDetail)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer transition-all"
                    >
                      💸 Bayar Gaji
                    </button>
                  )}
                  {getActivePayments(selectedSalaryForDetail).length > 0 &&
                    selectedSalaryForDetail.payment_status !== 'cancelled' && (
                      <button
                        onClick={() => handleOpenVoidPayment(selectedSalaryForDetail, null)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-xs rounded-lg cursor-pointer transition-all"
                      >
                        ↩️ Batalkan Pembayaran
                      </button>
                    )}
                  {selectedSalaryForDetail.payment_status !== 'cancelled' && (
                    <button
                      onClick={() => handleOpenEditSalary(selectedSalaryForDetail)}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 font-bold text-xs rounded-lg cursor-pointer transition-all"
                    >
                      ✏️ Edit Gaji
                    </button>
                  )}
                  <button
                    onClick={() => setIsSalaryDetailOpen(false)}
                    className="text-gray-500 hover:text-gray-700 font-bold text-xs border border-gray-200 px-3 py-1.5 rounded-lg bg-white shadow-xs cursor-pointer hover:bg-gray-50 transition-all"
                  >
                    ✕ Tutup
                  </button>
                </div>
              </div>

              {/* Split Content */}
              <div className="flex flex-col md:flex-row h-full overflow-hidden min-h-[420px]">
                {/* Left Panel: Record Details & Payment History */}
                <div className="w-full md:w-[38%] p-6 border-r border-gray-150 bg-gray-50/50 space-y-4 overflow-y-auto">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                    Ringkasan Kewajiban Payroll
                  </h4>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                      <p className="text-[9px] text-gray-400 font-bold uppercase">Total Gaji</p>
                      <p className="text-sm font-black text-gray-900 font-mono mt-0.5">
                        {formatCurrencyIDR(selectedSalaryForDetail.amount)}
                      </p>
                    </div>

                    <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                      <p className="text-[9px] text-gray-400 font-bold uppercase">Status</p>
                      <span
                        className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider mt-1 ${
                          selectedSalaryForDetail.payment_status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : selectedSalaryForDetail.payment_status === 'partial'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                            : selectedSalaryForDetail.payment_status === 'cancelled'
                            ? 'bg-rose-50 text-rose-700 border-rose-100'
                            : 'bg-amber-50 text-amber-700 border-amber-100'
                        }`}
                      >
                        {selectedSalaryForDetail.payment_status === 'paid'
                          ? 'Lunas'
                          : selectedSalaryForDetail.payment_status === 'partial'
                          ? 'Sebagian'
                          : selectedSalaryForDetail.payment_status === 'cancelled'
                          ? 'Dibatalkan'
                          : 'Belum Dibayar'}
                      </span>
                    </div>

                    <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                      <p className="text-[9px] text-gray-400 font-bold uppercase">
                        Terbayar Aktif
                      </p>
                      <p className="text-xs font-bold text-emerald-600 font-mono mt-0.5">
                        {formatCurrencyIDR(selectedSalaryForDetail.amount_paid || 0)}
                      </p>
                    </div>

                    <div className="bg-white p-3.5 border border-gray-200 rounded-xl shadow-xs">
                      <p className="text-[9px] text-gray-400 font-bold uppercase">
                        Sisa Hutang Gaji
                      </p>
                      <p className="text-xs font-bold text-indigo-600 font-mono mt-0.5">
                        {formatCurrencyIDR(
                          selectedSalaryForDetail.outstanding_amount ??
                            (selectedSalaryForDetail.payment_status === 'pending'
                              ? selectedSalaryForDetail.amount
                              : 0)
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Riwayat Pembayaran with Individual Void Controls */}
                  <div className="bg-white p-4 border border-gray-200 rounded-xl shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-gray-500 font-black uppercase tracking-wider">
                        Riwayat Transaksi Pembayaran
                      </p>
                      <span className="text-[9px] font-bold text-slate-400">
                        {(selectedSalaryForDetail.salary_payments || []).length} Catatan
                      </span>
                    </div>

                    {!selectedSalaryForDetail.salary_payments ||
                    selectedSalaryForDetail.salary_payments.length === 0 ? (
                      <div className="text-center py-4 border border-dashed border-gray-200 rounded-lg text-[11px] text-gray-400 italic">
                        Belum ada pembayaran kas/bank tercatat.
                      </div>
                    ) : (
                      <div className="space-y-2.5 divide-y divide-gray-100">
                        {selectedSalaryForDetail.salary_payments.map(p => {
                          const isVoided = p.status === 'voided'
                          return (
                            <div
                              key={p.id}
                              className={`pt-2.5 first:pt-0 flex flex-col gap-1 ${
                                isVoided ? 'opacity-65' : ''
                              }`}
                            >
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`text-xs font-black font-mono ${
                                      isVoided
                                        ? 'line-through text-slate-400'
                                        : 'text-emerald-700'
                                    }`}
                                  >
                                    {formatCurrencyIDR(p.amount)}
                                  </span>
                                  <span
                                    className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase border ${
                                      isVoided
                                        ? 'bg-rose-50 text-rose-600 border-rose-200'
                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    }`}
                                  >
                                    {isVoided ? 'Batal / Void' : 'Aktif'}
                                  </span>
                                </div>
                                <span className="text-[10px] text-gray-400 font-mono">
                                  {p.date}
                                </span>
                              </div>

                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] text-gray-600 font-semibold">
                                  🏦 {p.accounts?.name || getAccountName(p.payment_method_account_id)}
                                </div>
                                {!isVoided &&
                                  selectedSalaryForDetail.payment_status !== 'cancelled' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleOpenVoidPayment(selectedSalaryForDetail, p)
                                      }
                                      className="text-[9px] font-extrabold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-md transition cursor-pointer"
                                    >
                                      ↩️ Batalkan Bayar
                                    </button>
                                  )}
                              </div>

                              {p.notes && (
                                <span className="text-[10px] text-gray-400 italic">
                                  "{p.notes}"
                                </span>
                              )}
                              {isVoided && p.void_reason && (
                                <span className="text-[9px] text-rose-600 font-semibold">
                                  Alasan Batal: {p.void_reason}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {selectedSalaryForDetail.payment_status === 'cancelled' && (
                    <div className="bg-rose-50/70 p-4 border border-rose-200 rounded-xl shadow-xs space-y-1">
                      <p className="text-[10px] text-rose-800 font-black uppercase">
                        Status Audit: Slip Gaji Dibatalkan
                      </p>
                      <p className="text-xs font-medium text-rose-700 leading-relaxed">
                        Seluruh dampak akuntansi (Beban Gaji, Hutang Gaji, dan Kas/Bank) telah
                        dinihilkan melalui Jurnal Pembalik. Periode gaji ini terbuka kembali jika
                        Anda ingin membuat slip gaji pengganti.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right Panel: Deduplicated & Classified Journal Entries */}
                <div className="flex-1 p-6 overflow-y-auto space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                      Jejak Audit Ayat Jurnal Buku Besar (Double-Entry)
                    </h4>
                    <span className="text-[10px] font-bold text-slate-500">
                      {salaryTransactions.length} Transaksi Jurnal
                    </span>
                  </div>

                  {loadingSalaryDetail ? (
                    <div className="space-y-4 animate-pulse">
                      <div className="h-24 bg-gray-50 border border-gray-100 rounded-xl"></div>
                      <div className="h-24 bg-gray-50 border border-gray-100 rounded-xl"></div>
                    </div>
                  ) : salaryTransactions.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-gray-200 rounded-xl">
                      <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                        Tidak ada catatan jurnal transaksi.
                      </p>
                    </div>
                  ) : (
                    salaryTransactions.map((tx: any) => {
                      const totalDebit =
                        tx.journal_lines?.reduce(
                          (acc: number, line: any) => acc + (Number(line.debit) || 0),
                          0
                        ) || 0
                      const totalCredit =
                        tx.journal_lines?.reduce(
                          (acc: number, line: any) => acc + (Number(line.credit) || 0),
                          0
                        ) || 0
                      const badge = classifyTransactionBadge(tx.description)

                      return (
                        <div
                          key={tx.id}
                          className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-xs"
                        >
                          {/* Tx Header */}
                          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-start gap-2">
                            <div>
                              <span
                                className={`text-[8px] font-black px-2 py-0.5 rounded border uppercase tracking-wider inline-block ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                              <h5 className="text-xs font-black text-gray-800 mt-1">
                                {tx.description}
                              </h5>
                            </div>
                            <span className="text-[10px] font-bold text-gray-500 font-mono shrink-0">
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
                                  <th className="py-1.5 pr-4">Akun COA</th>
                                  <th className="py-1.5 px-4 text-right">Debit</th>
                                  <th className="py-1.5 pl-4 text-right">Kredit</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {tx.journal_lines?.map((line: any) => {
                                  const isCredit =
                                    (Number(line.credit) || 0) > 0 &&
                                    (Number(line.debit) || 0) === 0
                                  return (
                                    <tr
                                      key={line.id}
                                      className="hover:bg-gray-55/50 transition-colors"
                                    >
                                      <td className="py-2.5 pr-4">
                                        <div
                                          className={`flex items-center gap-2 ${
                                            isCredit ? 'pl-5' : ''
                                          }`}
                                        >
                                          <span className="text-[9px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                                            {line.accounts?.code || '-'}
                                          </span>
                                          <span
                                            className={`font-bold text-gray-700 uppercase ${
                                              isCredit
                                                ? 'italic text-gray-500 font-medium'
                                                : ''
                                            }`}
                                          >
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
                                  )
                                })}

                                {/* Total Row */}
                                <tr className="border-t border-gray-300 font-bold bg-gray-50/40">
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
                      )
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
