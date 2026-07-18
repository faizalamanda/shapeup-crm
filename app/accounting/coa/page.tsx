"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import { formatCurrencyIDR } from '../utils'

// Dynamic classification rules based on account type and code prefixes (WaveApps classification style)
type ClassificationDef = {
  key: string
  name: string
  icon: string
  prefixes: string[]
}

const CLASSIFICATION_MAP: Record<string, ClassificationDef[]> = {
  ASSET: [
    { key: 'cash_bank', name: 'Kas & Bank', icon: '🏦', prefixes: ['101'] },
    { key: 'receivables', name: 'Piutang Usaha', icon: '👤', prefixes: ['103', '11'] },
    { key: 'inventory', name: 'Persediaan Barang', icon: '📦', prefixes: ['102'] },
    { key: 'fixed_assets', name: 'Aset Tetap', icon: '💻', prefixes: ['12', '13'] },
    { key: 'other_assets', name: 'Aset Lancar Lainnya', icon: '💸', prefixes: [] } // Fallback
  ],
  LIABILITY: [
    { key: 'payables', name: 'Hutang Usaha', icon: '🤝', prefixes: ['2010'] },
    { key: 'salary_payables', name: 'Hutang Gaji & Upah', icon: '👥', prefixes: ['2011'] },
    { key: 'other_liabilities', name: 'Kewajiban Lainnya', icon: '⏳', prefixes: [] } // Fallback
  ],
  EQUITY: [
    { key: 'equity', name: 'Ekuitas Pemilik', icon: '⚖️', prefixes: [] } // All equity
  ],
  REVENUE: [
    { key: 'sales', name: 'Pendapatan Penjualan', icon: '📈', prefixes: ['4010', '402', '403'] },
    { key: 'discounts', name: 'Potongan & Retur Penjualan', icon: '🏷️', prefixes: ['4011'] },
    { key: 'other_revenue', name: 'Pendapatan Lain-lain', icon: '💰', prefixes: [] } // Fallback
  ],
  EXPENSE: [
    { key: 'cogs', name: 'Harga Pokok Penjualan (HPP)', icon: '🛒', prefixes: ['501'] },
    { key: 'inventory_adj', name: 'Penyesuaian Persediaan', icon: '🔄', prefixes: ['502'] },
    { key: 'opex', name: 'Beban Operasional', icon: '💼', prefixes: ['503'] },
    { key: 'other_expenses', name: 'Beban Administrasi & Lain-lain', icon: '📉', prefixes: [] } // Fallback
  ]
}

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'

export const SUB_TYPES_MAP: Record<AccountType, { value: string; label: string }[]> = {
  ASSET: [
    { value: 'bank_cash', label: '🏦 Kas & Bank (Bank and Cash)' },
    { value: 'receivable', label: '👤 Piutang Usaha (Receivable)' },
    { value: 'current_assets', label: '📈 Aset Lancar Lainnya (Current Assets)' },
    { value: 'prepayments', label: '💸 Beban Dibayar di Muka (Prepayments)' },
    { value: 'fixed_assets', label: '💻 Aset Tetap (Fixed Assets)' },
    { value: 'non_current_assets', label: '🏢 Aset Tidak Lancar Lainnya (Non-current Assets)' }
  ],
  LIABILITY: [
    { value: 'payable', label: '🤝 Hutang Usaha (Payable)' },
    { value: 'credit_card', label: '💳 Kartu Kredit (Credit Card)' },
    { value: 'current_liabilities', label: '⏳ Kewajiban Lancar Lainnya (Current Liabilities)' },
    { value: 'non_current_liabilities', label: '🛡️ Kewajiban Jangka Panjang (Non-current Liabilities)' }
  ],
  EQUITY: [
    { value: 'equity', label: '⚖️ Ekuitas (Equity)' },
    { value: 'current_year_earnings', label: '📊 Laba Tahun Berjalan (Current Year Earnings)' }
  ],
  REVENUE: [
    { value: 'income', label: '💰 Pendapatan Usaha (Income)' },
    { value: 'other_income', label: '💵 Pendapatan Lain-lain (Other Income)' }
  ],
  EXPENSE: [
    { value: 'cogs', label: '🛒 Harga Pokok Penjualan (Cost of Goods Sold/HPP)' },
    { value: 'expense', label: '💼 Beban Operasional (Expenses)' },
    { value: 'depreciation', label: '📉 Penyusutan & Amortisasi (Depreciation)' }
  ]
}

type Account = {
  id: string
  code: string
  name: string
  type: AccountType
  sub_type?: string | null
  business_id: string
  created_at?: string
}

type Balance = {
  debit: number
  credit: number
}

// Toast notification type
type ToastType = 'success' | 'error' | 'info' | 'warning'
type Toast = {
  id: string
  message: string
  type: ToastType
}

export default function ChartOfAccountsPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Profile and Business context
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [activeBizTimezone, setActiveBizTimezone] = useState<string>('Asia/Jakarta')

  // Accounts & Balances State
  const [accounts, setAccounts] = useState<Account[]>([])
  const [balances, setBalances] = useState<Record<string, Balance>>({})
  const [loading, setLoading] = useState(true)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Navigation & Search Filters
  const [activeTab, setActiveTab] = useState<AccountType>('ASSET')
  const [searchQuery, setSearchQuery] = useState('')

  // Toast notifications state
  const [toasts, setToasts] = useState<Toast[]>([])

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)

  // Form Fields State
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<AccountType>('ASSET')
  const [formSubType, setFormSubType] = useState<string>('')
  const [submitLoading, setSubmitLoading] = useState(false)
  
  // Mounted Check
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Show Toast Helper
  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4500)
  }, [])

  // Load Active Business Profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setErrorMsg('Sesi pengguna tidak ditemukan. Silakan login kembali.')
          setLoading(false)
          return
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('active_business_id, businesses!active_business_id(name, timezone)')
          .eq('id', user.id)
          .single()

        if (error) throw error

        const businessId = profile?.active_business_id
        if (businessId) {
          setActiveBizId(businessId)
          const biz = Array.isArray(profile.businesses) ? profile.businesses[0] : profile.businesses
          setActiveBizName(biz?.name || 'Bisnis Saya')
          setActiveBizTimezone(biz?.timezone || 'Asia/Jakarta')
        } else {
          setErrorMsg('Belum ada unit bisnis aktif yang dipilih.')
          setLoading(false)
        }
      } catch (err: any) {
        console.error('Error loading profile:', err)
        setErrorMsg(err.message || 'Gagal memuat profil bisnis')
        setLoading(false)
      }
    }
    loadProfile()
  }, [supabase])

  // Fetch Accounts (Fast Load)
  const fetchAccounts = useCallback(async (businessId: string) => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('business_id', businessId)
        .order('code', { ascending: true })

      if (error) throw error
      setAccounts(data || [])
      setErrorMsg(null)
    } catch (err: any) {
      console.error('Error fetching accounts:', err)
      setErrorMsg(err.message || 'Gagal memuat daftar akun')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Fetch Cumulative Balances in background (Deferred Asynchronous Load)
  const fetchBalances = useCallback(async (businessId: string, tz: string) => {
    setBalancesLoading(true)
    try {
      // Calculate today's date string (YYYY-MM-DD)
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const todayStr = `${year}-${month}-${day}`

      // Resolve end-of-day ISO timestamp based on local timezone
      const getUtcTimestamp = (dateStr: string, timeStr: string, timeZone: string) => {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false
        })
        const [y, m, d] = dateStr.split('-').map(Number)
        const [hours, minutes, seconds] = timeStr.split('.')[0].split(':').map(Number)
        const utcDate = new Date(Date.UTC(y, m - 1, d, hours, minutes, seconds))
        const parts = formatter.formatToParts(utcDate)
        const partValues: Record<string, number> = {}
        parts.forEach(p => {
          if (p.type !== 'literal') partValues[p.type] = Number(p.value)
        })
        const fMonth = partValues.month
        const fDay = partValues.day
        const fYear = partValues.year
        const fHour = partValues.hour === 24 ? 0 : partValues.hour
        const fMin = partValues.minute
        const fSec = partValues.second
        const formattedUtc = new Date(Date.UTC(fYear, fMonth - 1, fDay, fHour, fMin, fSec))
        const diffMs = utcDate.getTime() - formattedUtc.getTime()
        return new Date(utcDate.getTime() + diffMs).toISOString()
      }

      const endOfDayISO = getUtcTimestamp(todayStr, '23:59:59.999', tz)

      const { data, error } = await supabase
        .rpc('get_ledger_balances', {
          p_business_id: businessId,
          p_start_date: null, // lifetime cumulative balance
          p_end_date: endOfDayISO,
          p_basis: 'accrual'
        })

      if (error) throw error

      const balancesMap: Record<string, Balance> = {}
      if (data) {
        data.forEach((row: any) => {
          balancesMap[row.account_id] = {
            debit: parseFloat(row.debit_sum || 0),
            credit: parseFloat(row.credit_sum || 0)
          }
        })
      }
      setBalances(balancesMap)
    } catch (err: any) {
      console.error('Error fetching ledger balances:', err)
      // Non-critical, do not block the page but show a soft toast error
      showToast('Gagal memuat saldo akun terbaru.', 'warning')
    } finally {
      setBalancesLoading(false)
    }
  }, [supabase, showToast])

  // Trigger loads
  useEffect(() => {
    if (activeBizId) {
      fetchAccounts(activeBizId)
      fetchBalances(activeBizId, activeBizTimezone)
    }
  }, [activeBizId, activeBizTimezone, fetchAccounts, fetchBalances])

  // Helper to determine the classification grouping of an account
  const getAccountClassification = useCallback((acc: Account): string => {
    const list = CLASSIFICATION_MAP[acc.type] || []
    const match = list.find(cls => 
      cls.prefixes.length === 0 || cls.prefixes.some(p => acc.code.startsWith(p))
    )
    return match ? match.key : 'other'
  }, [])

  // Helper to clean trailing zeros from code
  const getCleanPrefix = useCallback((code: string): string => {
    const match = code.match(/^(.*?)(0*)$/)
    if (match) {
      const prefix = match[1]
      // Ensure prefix has at least 3 characters to prevent over-truncation
      if (prefix.length >= 3) return prefix
    }
    return code
  }, [])

  // Helper to check for visual parent account in same list
  const findParentAccount = useCallback((acc: Account, list: Account[]): Account | null => {
    let bestParent: Account | null = null
    for (const item of list) {
      if (item.id === acc.id) continue
      const parentPrefix = getCleanPrefix(item.code)
      // Parent must end with '0' (header format) and prefix-match the target account
      if (item.code.endsWith('0') && acc.code.startsWith(parentPrefix) && acc.code !== item.code) {
        if (!bestParent || item.code.length > bestParent.code.length) {
          bestParent = item
        }
      }
    }
    return bestParent
  }, [getCleanPrefix])

  // Recursive depth generator for indentation
  const getAccountDepth = useCallback((acc: Account, list: Account[]): number => {
    let depth = 0
    let current: Account | null = acc
    while (current) {
      const parent = findParentAccount(current, list)
      if (parent) {
        depth++
        current = parent
      } else {
        current = null
      }
    }
    return depth
  }, [findParentAccount])

  // Calculate cumulative balances dynamically based on account type normal balances
  const getFormattedBalance = useCallback((acc: Account): string => {
    const bal = balances[acc.id]
    if (!bal) return balancesLoading ? '...' : formatCurrencyIDR(0)

    let total = 0
    if (acc.type === 'ASSET' || acc.type === 'EXPENSE') {
      total = bal.debit - bal.credit
    } else {
      total = bal.credit - bal.debit
    }
    return formatCurrencyIDR(total)
  }, [balances, balancesLoading])

  // Helper to count accounts per tab, considering global search queries
  const getTabCount = useCallback((tabType: AccountType) => {
    return accounts.filter(a => {
      if (a.type !== tabType) return false
      if (!searchQuery.trim()) return true
      const query = searchQuery.toLowerCase()
      return a.name.toLowerCase().includes(query) || a.code.includes(query)
    }).length
  }, [accounts, searchQuery])

  // Filtered & Grouped Accounts dataset
  const groupedAccounts = useMemo(() => {
    const isSearching = searchQuery.trim() !== ''

    const filtered = accounts.filter(acc => {
      // If not searching, restrict to current active tab
      if (!isSearching && acc.type !== activeTab) return false
      if (!isSearching) return true
      
      const query = searchQuery.toLowerCase()
      return acc.name.toLowerCase().includes(query) || acc.code.includes(query)
    })

    const groups: Record<string, { classification: ClassificationDef; accounts: Account[]; type: AccountType }> = {}

    // Initialize all classifications for active types
    const typesToGroup: AccountType[] = isSearching 
      ? ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] 
      : [activeTab]

    typesToGroup.forEach(t => {
      const classifications = CLASSIFICATION_MAP[t] || []
      classifications.forEach(cls => {
        groups[cls.key] = {
          classification: cls,
          accounts: [],
          type: t
        }
      })
    })

    // Group accounts
    filtered.forEach(acc => {
      const clsKey = getAccountClassification(acc)
      if (groups[clsKey]) {
        groups[clsKey].accounts.push(acc)
      } else {
        const classifications = CLASSIFICATION_MAP[acc.type] || []
        const fallback = classifications[classifications.length - 1]
        if (fallback && groups[fallback.key]) {
          groups[fallback.key].accounts.push(acc)
        }
      }
    })

    return groups
  }, [accounts, activeTab, searchQuery, getAccountClassification])

  // Open modals
  const openAddModal = (defaultType: AccountType) => {
    setSelectedAccount(null)
    setFormCode('')
    setFormName('')
    setFormType(defaultType)
    setFormSubType(SUB_TYPES_MAP[defaultType]?.[0]?.value || '')
    setIsModalOpen(true)
  }

  const openEditModal = (acc: Account) => {
    setSelectedAccount(acc)
    setFormCode(acc.code)
    setFormName(acc.name)
    setFormType(acc.type)
    setFormSubType(acc.sub_type || SUB_TYPES_MAP[acc.type]?.[0]?.value || '')
    setIsModalOpen(true)
  }

  // Handle Form Submission (Create & Update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeBizId) return

    const trimmedCode = formCode.trim()
    const trimmedName = formName.trim()

    if (!trimmedCode || !trimmedName) {
      showToast('Kode dan Nama akun wajib diisi!', 'warning')
      return
    }

    // Client-side unique code check
    const isDuplicate = accounts.some(
      a => a.code === trimmedCode && a.business_id === activeBizId && a.id !== selectedAccount?.id
    )
    if (isDuplicate) {
      showToast(`Kode akun "${trimmedCode}" sudah digunakan oleh akun lain!`, 'error')
      return
    }

    setSubmitLoading(true)
    try {
      if (selectedAccount) {
        // Update Account
        const { error } = await supabase
          .from('accounts')
          .update({
            code: trimmedCode,
            name: trimmedName,
            type: formType,
            sub_type: formSubType
          })
          .eq('id', selectedAccount.id)
          .eq('business_id', activeBizId)

        if (error) throw error
        showToast(`Akun "${trimmedName}" berhasil diperbarui!`, 'success')
      } else {
        // Insert Account
        const { error } = await supabase
          .from('accounts')
          .insert({
            business_id: activeBizId,
            code: trimmedCode,
            name: trimmedName,
            type: formType,
            sub_type: formSubType
          })

        if (error) throw error
        showToast(`Akun "${trimmedName}" berhasil ditambahkan!`, 'success')
      }

      setIsModalOpen(false)
      await fetchAccounts(activeBizId)
      // Fetch balances in background just in case
      fetchBalances(activeBizId, activeBizTimezone)
    } catch (err: any) {
      console.error('Error saving account:', err)
      showToast(err.message || 'Gagal menyimpan perubahan akun.', 'error')
    } finally {
      setSubmitLoading(false)
    }
  }

  // Handle Delete operation
  const handleDelete = async (acc: Account) => {
    if (!activeBizId) return
    const confirmMsg = `Apakah Anda yakin ingin menghapus akun (${acc.code}) ${acc.name}?\nTindakan ini tidak dapat dibatalkan.`
    if (!confirm(confirmMsg)) return

    try {
      const { error } = await supabase
        .from('accounts')
        .delete()
        .eq('id', acc.id)
        .eq('business_id', activeBizId)

      if (error) {
        // Intercept constraint violation errors
        if (error.message.includes('foreign key') || error.code === '23503') {
          showToast('Akun ini tidak bisa dihapus karena sudah memiliki catatan transaksi keuangan!', 'error')
        } else {
          throw error
        }
        return
      }

      showToast(`Akun "${acc.name}" berhasil dihapus!`, 'success')
      await fetchAccounts(activeBizId)
      fetchBalances(activeBizId, activeBizTimezone)
    } catch (err: any) {
      console.error('Error deleting account:', err)
      showToast(err.message || 'Gagal menghapus akun.', 'error')
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Toast Notifications Portal Container */}
      {mounted && createPortal(
        <div className="fixed top-5 right-5 z-50 space-y-2 pointer-events-none max-w-sm w-full">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`p-4 rounded-xl border shadow-lg flex items-start gap-3 pointer-events-auto transition-all transform translate-x-0 animate-in slide-in-from-right duration-300 ${
                t.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                t.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                t.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              <span className="text-base select-none">
                {t.type === 'success' ? '✨' : t.type === 'error' ? '🚫' : '⚠️'}
              </span>
              <div className="flex-1 text-xs font-semibold leading-relaxed">
                {t.message}
              </div>
              <button 
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                className="text-gray-400 hover:text-gray-600 font-bold text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}

      {/* Page Header */}
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Buku Besar & Pengaturan
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 uppercase">
                📍 {activeBizName}
              </span>
            )}
            {balancesLoading && (
              <span className="text-[8px] font-bold text-gray-400 animate-pulse bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1">
                🔄 Memperbarui Saldo...
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight leading-none uppercase">
            Bagan Akun (Chart of Accounts)
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Kelola kode akun akuntansi double-entry untuk mengklasifikasikan transaksi keuangan bisnis Anda.
          </p>
        </div>
        <button
          onClick={() => openAddModal(activeTab)}
          className="w-full md:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          ➕ Tambah Akun Baru
        </button>
      </div>

      {/* Search Filter Bar (Global - above category tabs) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row gap-3 justify-between items-center">
        <div className="relative w-full md:max-w-md">
          <input
            type="text"
            placeholder="Cari kode atau nama akun di semua kategori..."
            className="w-full p-2.5 pl-8 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-gray-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3 top-3.5 text-gray-400 text-xs">🔍</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600 text-xs cursor-pointer select-none"
            >
              ✕
            </button>
          )}
        </div>
        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2 font-mono">
          <span>Total</span>
          <span className="text-gray-700 font-black bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
            {accounts.length} Akun Terdaftar
          </span>
        </div>
      </div>

      {/* Top Tabs Navigation (WaveApps main classification style) */}
      <div className="flex border-b border-gray-200 gap-1 bg-white p-1 rounded-xl border shadow-xs overflow-x-auto">
        {(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as AccountType[]).map((tab) => {
          const tabLabel = 
            tab === 'ASSET' ? 'Aset' :
            tab === 'LIABILITY' ? 'Kewajiban' :
            tab === 'EQUITY' ? 'Ekuitas' :
            tab === 'REVENUE' ? 'Pendapatan' : 'Beban'
          
          const count = getTabCount(tab)
          const isActive = activeTab === tab && !searchQuery.trim()

          return (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab)
                setSearchQuery('') // Clear search query when a tab is selected to focus on it
              }}
              className={`flex-1 py-3 px-4 text-center text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap min-w-28 ${
                isActive 
                  ? 'bg-blue-55 text-blue-75 border-b-2 border-blue-500 font-extrabold font-black' 
                  : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50/50'
              }`}
              style={{
                background: isActive ? 'rgba(37,99,235,0.06)' : undefined,
                color: isActive ? '#1D4ED8' : undefined
              }}
            >
              <span>{tabLabel}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black ${
                isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Global Search Notice */}
      {searchQuery.trim() !== '' && (
        <div className="bg-blue-50/70 border border-blue-100 text-blue-800 rounded-xl p-3.5 flex justify-between items-center text-xs font-semibold animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2">
            <span>🔍</span>
            <span>
              Menampilkan hasil pencarian untuk "<span className="font-extrabold text-blue-900">{searchQuery}</span>" di semua kategori akun.
            </span>
          </div>
          <button
            onClick={() => setSearchQuery('')}
            className="text-[10px] font-black uppercase text-blue-700 hover:underline cursor-pointer bg-white px-2.5 py-1 rounded-md border border-blue-200 shadow-sm"
          >
            Clear / Kembali ke Kategori
          </button>
        </div>
      )}

      {/* Error & Loading state */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Memuat daftar akun akuntansi...
        </div>
      ) : errorMsg ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-xs font-semibold">
          ⚠️ {errorMsg}
        </div>
      ) : (
        <div className="space-y-6">
          {(() => {
            const entries = Object.entries(groupedAccounts)
            const isSearching = searchQuery.trim() !== ''
            const hasMatches = entries.some(([_, group]) => group.accounts.length > 0)
            
            if (isSearching && !hasMatches) {
              return (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-xs">
                  <span className="text-3xl">🔍</span>
                  <h3 className="text-sm font-extrabold text-gray-800 mt-2 uppercase tracking-wide">
                    Tidak ada akun ditemukan
                  </h3>
                  <p className="text-xs text-gray-400 mt-1 font-medium">
                    Coba masukkan kata kunci pencarian atau kode akun yang lain.
                  </p>
                </div>
              )
            }

            return entries.map(([clsKey, group]) => {
              const hasAccounts = group.accounts.length > 0
              if (!hasAccounts && isSearching) return null // Hide empty classifications on search filtering
              
              return (
                <div key={clsKey} className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
                  
                  {/* Dynamic Classification Header (WaveApps classification look) */}
                  <div className="bg-gray-50/50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{group.classification.icon}</span>
                      <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                        {group.classification.name}
                      </h2>
                      {isSearching && (
                        <span className={`inline-flex text-[8px] font-black px-1.5 py-0.2 rounded border uppercase scale-90 ${
                          group.type === 'ASSET' ? 'text-blue-700 bg-blue-50 border-blue-100' :
                          group.type === 'LIABILITY' ? 'text-amber-700 bg-amber-50 border-amber-100' :
                          group.type === 'EQUITY' ? 'text-indigo-700 bg-indigo-50 border-indigo-100' :
                          group.type === 'REVENUE' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' :
                          'text-rose-700 bg-rose-50 border-rose-100'
                        }`}>
                          {group.type === 'ASSET' ? 'Aset' :
                           group.type === 'LIABILITY' ? 'Kewajiban' :
                           group.type === 'EQUITY' ? 'Ekuitas' :
                           group.type === 'REVENUE' ? 'Pendapatan' : 'Beban'}
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] font-bold text-gray-400 uppercase">
                      {group.accounts.length} Akun
                    </span>
                  </div>

                  {/* Account List Table (Odoo style) */}
                  {!hasAccounts ? (
                    <div className="p-6 text-center text-xs text-gray-400 italic">
                      Belum ada akun di klasifikasi ini.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-white border-b border-gray-150 uppercase text-[9px] text-gray-400 font-bold tracking-widest">
                            <th className="p-3 pl-5 w-24">Kode</th>
                            <th className="p-3">Nama Akun</th>
                            <th className="p-3 w-36">Tipe Akun</th>
                            <th className="p-3 text-right w-44">Saldo Terakhir</th>
                            <th className="p-3 text-right w-36">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                          {group.accounts.map(acc => {
                            const depth = getAccountDepth(acc, group.accounts)
                            const isHeader = acc.code.endsWith('0') || acc.code.endsWith('00')
                            
                            return (
                              <tr 
                                key={acc.id} 
                                className={`hover:bg-gray-50/40 transition-colors ${
                                  isHeader ? 'bg-gray-50/15 font-black text-gray-900 border-l-2 border-gray-300' : 'text-gray-650'
                                }`}
                              >
                                {/* Account Code */}
                                <td className="p-3 pl-5 font-bold tracking-wider">
                                  {acc.code}
                                </td>

                                {/* Account Name & visual parent-child indentation */}
                                <td className="p-3">
                                  <div 
                                    style={{ paddingLeft: `${depth * 22}px` }} 
                                    className="flex items-center gap-1.5"
                                  >
                                    {depth > 0 && (
                                      <span className="text-gray-300 font-normal select-none">
                                        └─
                                      </span>
                                    )}
                                    <span className={isHeader ? 'underline decoration-dotted decoration-gray-300' : 'font-medium'}>
                                      {acc.name}
                                    </span>
                                    {isHeader && (
                                      <span className="text-[8px] font-black text-blue-600 bg-blue-50 border border-blue-100 px-1 py-0.2 rounded-md uppercase tracking-wider scale-90">
                                        Header
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Account Type */}
                                <td className="p-3">
                                  <span className={`inline-flex text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${
                                    acc.type === 'ASSET' ? 'text-blue-700 bg-blue-50/70 border-blue-100' :
                                    acc.type === 'LIABILITY' ? 'text-amber-700 bg-amber-50/70 border-amber-100' :
                                    acc.type === 'EQUITY' ? 'text-indigo-700 bg-indigo-50/70 border-indigo-100' :
                                    acc.type === 'REVENUE' ? 'text-emerald-700 bg-emerald-50/70 border-emerald-100' :
                                    'text-rose-700 bg-rose-50/70 border-rose-100'
                                  }`}>
                                    {(() => {
                                      if (!acc.sub_type) {
                                        if (acc.type === 'EXPENSE') {
                                          if (acc.code.startsWith('501') || acc.name.toLowerCase().includes('harga pokok') || acc.name.toLowerCase().includes('hpp')) {
                                            return 'Harga Pokok Penjualan (HPP)'
                                          }
                                          return 'Beban Operasional'
                                        }
                                        return acc.type
                                      }
                                      const stList = SUB_TYPES_MAP[acc.type] || []
                                      const found = stList.find(st => st.value === acc.sub_type)
                                      return found ? found.label.replace(/^.*? /, '').split(' (')[0] : acc.sub_type
                                    })()}
                                  </span>
                                </td>

                                {/* Calculated Cumulative Balance */}
                                <td className={`p-3 text-right font-bold text-sm tracking-wide ${
                                  isHeader ? 'text-gray-900' : 'text-gray-700'
                                }`}>
                                  {getFormattedBalance(acc)}
                                </td>

                                {/* Action Buttons */}
                                <td className="p-3 text-right">
                                  <div className="flex justify-end gap-1.5">
                                    <button
                                      onClick={() => openEditModal(acc)}
                                      className="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-100 transition-colors uppercase font-bold text-[9px] tracking-wider cursor-pointer"
                                    >
                                      ✏️ Edit
                                    </button>
                                    <button
                                      onClick={() => handleDelete(acc)}
                                      className="px-2 py-1 text-red-600 bg-red-50 hover:bg-red-100 rounded border border-red-100 transition-colors uppercase font-bold text-[9px] tracking-wider cursor-pointer"
                                    >
                                      🗑️ Hapus
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Add / Edit Account Modal Dialog */}
      {isModalOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                {selectedAccount ? '✏️ Edit Akun Akuntansi' : '➕ Tambah Akun Baru'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Tipe Akun (Kategori Utama) *
                </label>
                <select
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formType}
                  onChange={e => {
                    const newType = e.target.value as AccountType
                    setFormType(newType)
                    setFormSubType(SUB_TYPES_MAP[newType]?.[0]?.value || '')
                  }}
                >
                  <option value="ASSET">📈 Aset (Asset)</option>
                  <option value="LIABILITY">💵 Kewajiban (Liability)</option>
                  <option value="EQUITY">⚖️ Ekuitas (Equity)</option>
                  <option value="REVENUE">💰 Pendapatan (Revenue)</option>
                  <option value="EXPENSE">🛒 Beban (Expense)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Sub-Tipe Akun *
                </label>
                <select
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formSubType}
                  onChange={e => setFormSubType(e.target.value)}
                >
                  {(SUB_TYPES_MAP[formType] || []).map(st => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5 flex justify-between">
                  <span>Kode Akun *</span>
                  <span className="text-[8px] text-gray-400 lowercase italic">
                    {formType === 'ASSET' ? 'Saran: 1xxxxx' :
                     formType === 'LIABILITY' ? 'Saran: 2xxxxx' :
                     formType === 'EQUITY' ? 'Saran: 3xxxxx' :
                     formType === 'REVENUE' ? 'Saran: 4xxxxx' : 'Saran: 5xxxxx'}
                  </span>
                </label>
                <input
                  type="text"
                  required
                  pattern="[A-Za-z0-9]+"
                  title="Hanya huruf dan angka tanpa spasi!"
                  placeholder="Contoh: 101010 atau 503100"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formCode}
                  onChange={e => setFormCode(e.target.value.replace(/\s+/g, ''))}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Nama Akun *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Kas Kecil Operational atau Beban Listrik"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                />
              </div>

              <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-[10px] font-semibold text-blue-800 leading-normal">
                💡 <span className="font-bold">Tips Penomoran</span>: Gunakan kode berakhiran nol (seperti <span className="font-bold">503000</span>) untuk membuat Akun Header/Kategori, lalu buat sub-akun (seperti <span className="font-bold">503100</span>) untuk penomoran di bawahnya agar terkelompok dengan visual rapi.
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {submitLoading ? 'Menyimpan...' : 'Simpan'}
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
