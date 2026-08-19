"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import { formatCurrencyIDR, getDateRangeLimits, DateRangeKey } from '../utils'
import * as XLSX from 'xlsx'

type Account = {
  id: string
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
  sub_type?: string | null
  business_id: string
}

type JournalLine = {
  id?: string
  account_id: string
  debit: number
  credit: number
  line_desc?: string
  accounts?: Account
}

type Transaction = {
  id: string
  date: string
  description: string
  order_id?: string | null
  business_id: string
  journal_lines: JournalLine[]
}


type SearchableAccountSelectProps = {
  accounts: Account[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  filterTypes?: ('ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE')[]
  className?: string
  required?: boolean
  disabled?: boolean
}

const COA_CATEGORIES_CONFIG: { type: Account['type']; label: string; icon: string }[] = [
  { type: 'ASSET', label: 'ASET (ASSETS)', icon: '🏦' },
  { type: 'LIABILITY', label: 'KEWAJIBAN (LIABILITIES)', icon: '🤝' },
  { type: 'EQUITY', label: 'EKUITAS (EQUITY)', icon: '⚖️' },
  { type: 'REVENUE', label: 'PENDAPATAN (REVENUE)', icon: '💰' },
  { type: 'EXPENSE', label: 'BEBAN (EXPENSE)', icon: '🛒' },
]

function SearchableAccountSelect({
  accounts,
  value,
  onChange,
  placeholder = '-- Pilih Akun --',
  filterTypes,
  className = '',
  required = false,
  disabled = false
}: SearchableAccountSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const allowedAccounts = useMemo(() => {
    if (!filterTypes || filterTypes.length === 0) return accounts
    return accounts.filter(a => filterTypes.includes(a.type))
  }, [accounts, filterTypes])

  const filteredAccounts = useMemo(() => {
    if (!searchTerm.trim()) return allowedAccounts
    const q = searchTerm.toLowerCase().trim()
    return allowedAccounts.filter(a =>
      a.code.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      (a.sub_type && a.sub_type.toLowerCase().includes(q))
    )
  }, [allowedAccounts, searchTerm])

  const selectedAccount = useMemo(() => {
    return accounts.find(a => a.id === value)
  }, [accounts, value])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  const handleSelect = (accId: string) => {
    onChange(accId)
    setIsOpen(false)
    setSearchTerm('')
  }

  const totalMatches = filteredAccounts.length

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {required && (
        <input
          type="text"
          value={value}
          onChange={() => {}}
          required
          tabIndex={-1}
          className="sr-only opacity-0 w-0 h-0 pointer-events-none absolute"
        />
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full text-left px-3 py-2 text-sm border rounded-lg bg-white flex items-center justify-between gap-2 transition-all cursor-pointer ${isOpen ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-300 hover:border-gray-400'} ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''}`}
      >
        <span className="truncate">
          {selectedAccount ? (
            <span className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-gray-900">[{selectedAccount.code}]</span>
              <span className="text-gray-800 font-medium">{selectedAccount.name}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                {selectedAccount.type}
              </span>
            </span>
          ) : (
            <span className="text-gray-400 font-normal">{placeholder}</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-blue-600' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden min-w-[280px]">
          <div className="p-2 border-b border-gray-100 bg-gray-50/90">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Cari kode atau nama akun..."
                className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
              />
              <svg className="absolute left-2.5 top-2 text-gray-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 text-xs">
            {(!required || !value) && (
              <div
                onClick={() => handleSelect('')}
                className={`p-2.5 hover:bg-gray-100 cursor-pointer font-medium text-gray-500 italic ${!value ? 'bg-blue-50/60 font-semibold' : ''}`}
              >
                {placeholder}
              </div>
            )}

            {totalMatches === 0 ? (
              <div className="p-4 text-center text-gray-400 font-medium">
                🔍 Tidak ada akun ditemukan &quot;{searchTerm}&quot;
              </div>
            ) : (
              COA_CATEGORIES_CONFIG.map(cat => {
                const catAccounts = filteredAccounts.filter(a => a.type === cat.type)
                if (catAccounts.length === 0) return null

                return (
                  <div key={cat.type} className="py-1">
                    <div className="px-3 py-1 bg-gray-100/90 text-[11px] font-bold text-gray-700 flex items-center justify-between sticky top-0 backdrop-blur-xs">
                      <span className="flex items-center gap-1.5">
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-gray-200 text-gray-700 font-semibold">
                        {catAccounts.length}
                      </span>
                    </div>

                    <div className="divide-y divide-gray-50">
                      {catAccounts.map(acc => {
                        const isSelected = acc.id === value
                        return (
                          <div
                            key={acc.id}
                            onClick={() => handleSelect(acc.id)}
                            className={`px-3 py-2 flex items-center justify-between hover:bg-blue-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 font-bold text-blue-900' : 'text-gray-800'}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-gray-900 font-bold min-w-[55px]">[{acc.code}]</span>
                              <span>{acc.name}</span>
                            </div>
                            {isSelected && (
                              <span className="text-blue-600 font-bold">✓</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function cleanDescriptionString(description?: string | null): string {
  if (!description) return ''
  let cleaned = description

  const historiIdx = cleaned.indexOf('[HISTORI_EDIT:')
  if (historiIdx !== -1) {
    const historiEndIdx = cleaned.lastIndexOf(']')
    if (historiEndIdx > historiIdx) {
      cleaned = cleaned.substring(0, historiIdx) + cleaned.substring(historiEndIdx + 1)
    } else {
      cleaned = cleaned.substring(0, historiIdx)
    }
  }

  cleaned = cleaned.replace(/\[Diedit:[^\]]+\]/g, '')
  return cleaned.trim()
}

function parseHistoryList(description?: string | null): any[] {
  if (!description) return []
  const historiIdx = description.indexOf('[HISTORI_EDIT:')
  if (historiIdx === -1) return []

  const historiEndIdx = description.lastIndexOf(']')
  if (historiEndIdx <= historiIdx) return []

  const historyStr = description.substring(historiIdx + '[HISTORI_EDIT:'.length, historiEndIdx).trim()
  if (!historyStr) return []

  try {
    return JSON.parse(historyStr)
  } catch {
    try {
      const decoded = typeof window !== 'undefined' ? atob(historyStr) : Buffer.from(historyStr, 'base64').toString('utf-8')
      return JSON.parse(decoded)
    } catch {
      return []
    }
  }
}

export default function TransactionsPage() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [mounted, setMounted] = useState<boolean>(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Business state
  const [activeBusiness, setActiveBusiness] = useState<any>(null)

  // Filter states
  const [datePreset, setDatePreset] = useState<DateRangeKey>('this-month')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'all' | 'categorized' | 'journal'>('all')

  // Data states
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [summary, setSummary] = useState({
    totalTransactions: 0,
    totalDebit: 0,
    totalCredit: 0,
    totalIncome: 0,
    totalExpense: 0
  })

  // Modal / Drawer states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false)
  const [modalTab, setModalTab] = useState<'categorized' | 'journal'>('categorized')
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [successMsg, setSuccessMsg] = useState<string>('')

  // Form State: Categorized Entry
  const [catType, setCatType] = useState<'income' | 'expense' | 'transfer'>('expense')
  const [catDate, setCatDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [catPayAccount, setCatPayAccount] = useState<string>('')
  const [catCategoryAccount, setCatCategoryAccount] = useState<string>('')
  const [catAmount, setCatAmount] = useState<string>('')
  const [catTaxType, setCatTaxType] = useState<'none' | 'ppn11' | 'pph23' | 'pph42'>('none')
  const [catTaxMode, setCatTaxMode] = useState<'inclusive' | 'exclusive'>('inclusive')
  const [catContact, setCatContact] = useState<string>('')
  const [catRef, setCatRef] = useState<string>('')
  const [catMemo, setCatMemo] = useState<string>('')

  // Form State: Manual Journal Entry
  const [jnlDate, setJnlDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [jnlRef, setJnlRef] = useState<string>('')
  const [jnlCurrency, setJnlCurrency] = useState<string>('IDR')
  const [jnlExchangeRate, setJnlExchangeRate] = useState<number>(1)
  const [jnlMemo, setJnlMemo] = useState<string>('')
  const [jnlLines, setJnlLines] = useState<JournalLine[]>([
    { account_id: '', debit: 0, credit: 0, line_desc: '' },
    { account_id: '', debit: 0, credit: 0, line_desc: '' }
  ])

  // Edit Modal State
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [editDate, setEditDate] = useState<string>('')
  const [editDescription, setEditDescription] = useState<string>('')
  const [editJnlLines, setEditJnlLines] = useState<JournalLine[]>([])
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false)

  // Collect set of clean descriptions for transactions that have reversal entries
  const reversedDescriptionsSet = useMemo(() => {
    const set = new Set<string>()
    transactions.forEach(t => {
      if (t.description?.includes('[VOID') || t.description?.includes('REVERSAL')) {
        const clean = cleanDescriptionString(t.description.replace('[VOID / REVERSAL]', ''))
        if (clean) set.add(clean)
      }
    })
    return set
  }, [transactions])


  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [itemsPerPage, setItemsPerPage] = useState<number>(15)

  // Reset to page 1 on filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [datePreset, customStartDate, customEndDate, selectedAccountId, searchTerm, transactionTypeFilter])

  // Prevent background body scroll when any modal is open
  useEffect(() => {
    if (isCreateModalOpen || editingTransaction || detailTransaction) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isCreateModalOpen, editingTransaction, detailTransaction])

  // Calculate paginated transactions
  const totalItems = transactions.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = Math.min(totalItems, startIndex + itemsPerPage)
  const paginatedTransactions = useMemo(() => {
    return transactions.slice(startIndex, endIndex)
  }, [transactions, startIndex, endIndex])

  const renderPaginationControls = () => {
    if (totalItems === 0) return null

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-gray-50/80 border-t border-[var(--su-border)] text-xs font-medium text-gray-700">
        <div className="flex items-center gap-3">
          <span>
            Menampilkan <strong className="text-gray-900 font-mono">{startIndex + 1}</strong> - <strong className="text-gray-900 font-mono">{endIndex}</strong> dari <strong className="text-gray-900 font-mono">{totalItems}</strong> transaksi
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-gray-500">Tampilkan:</span>
            <select
              value={itemsPerPage}
              onChange={e => {
                setItemsPerPage(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="px-2 py-1 bg-white border border-gray-300 rounded-md text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs flex items-center gap-1 cursor-pointer"
          >
            ‹ Sebelumnya
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
              .reduce<(number | string)[]>((acc, page, idx, src) => {
                if (idx > 0 && (page as number) - (src[idx - 1] as number) > 1) {
                  acc.push('...')
                }
                acc.push(page)
                return acc
              }, [])
              .map((item, idx) => (
                typeof item === 'number' ? (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentPage(item)}
                    className={`min-w-[30px] h-7 px-2 flex items-center justify-center rounded-lg text-xs font-bold transition-all cursor-pointer ${currentPage === item ? 'bg-blue-600 text-white shadow-xs' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={idx} className="px-1 text-gray-400 font-bold">...</span>
                )
              ))}
          </div>

          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs flex items-center gap-1 cursor-pointer"
          >
            Selanjutnya ›
          </button>
        </div>
      </div>
    )
  }


  // Resolve Business & Accounts
  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setLoading(false)
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id, business_id')
          .eq('id', user.id)
          .single()

        let bizId = profile?.active_business_id || profile?.business_id

        if (!bizId) {
          const { data: biz } = await supabase.from('businesses').select('id').limit(1).single()
          bizId = biz?.id
        }

        if (bizId) {
          setActiveBusiness({ id: bizId })
          fetchAccounts(bizId)
        } else {
          setLoading(false)
        }
      } catch (e) {
        console.error('Failed to init profile/business', e)
        setLoading(false)
      }
    }
    init()
  }, [supabase])

  // Fetch Accounts
  const fetchAccounts = async (bizId: string) => {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('business_id', bizId)
        .order('code', { ascending: true })

      if (!error && data) {
        setAccounts(data as Account[])
      }
    } catch (e) {
      console.error('Failed to fetch accounts', e)
    }
  }

  // Calculate Start & End Date
  const dateLimits = useMemo(() => {
    if (datePreset === 'custom') {
      return {
        start: customStartDate || new Date().toISOString().split('T')[0],
        end: customEndDate || new Date().toISOString().split('T')[0]
      }
    }
    return getDateRangeLimits(datePreset)
  }, [datePreset, customStartDate, customEndDate])

  // Fetch Transactions Data
  const loadTransactions = useCallback(async () => {
    if (!activeBusiness?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({
        business_id: activeBusiness.id,
        start_date: dateLimits.start,
        end_date: dateLimits.end,
        limit: '200'
      })

      if (selectedAccountId) params.append('account_id', selectedAccountId)
      if (searchTerm) params.append('search', searchTerm)

      const res = await fetch(`/api/accounting/transactions?${params.toString()}`)
      const json = await res.json()

      if (res.ok && json.data) {
        let filtered = json.data as Transaction[]

        // Apply type filter if selected
        if (transactionTypeFilter === 'categorized') {
          filtered = filtered.filter(t => t.description?.startsWith('[Kategori:') || t.description?.includes('[Pemasukan') || t.description?.includes('[Pengeluaran'))
        } else if (transactionTypeFilter === 'journal') {
          filtered = filtered.filter(t => t.description?.startsWith('[Jurnal Umum') || t.description?.startsWith('[JU') || (!t.description?.includes('[Kategori') && !t.order_id))
        }

        setTransactions(filtered)
        if (json.summary) setSummary(json.summary)
      }
    } catch (e) {
      console.error('Failed to load transactions:', e)
    } finally {
      setLoading(false)
    }
  }, [activeBusiness?.id, dateLimits, selectedAccountId, searchTerm, transactionTypeFilter])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  // Filter Account Options by Type
  const assetBankAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET')
  }, [accounts])

  const revenueAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'REVENUE')
  }, [accounts])

  const expenseAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'EXPENSE')
  }, [accounts])

  // Automatic Defaults for Categorized Entry
  useEffect(() => {
    if (accounts.length > 0) {
      if (!catPayAccount) {
        const defaultBank = accounts.find(a => a.code === '101000' || a.sub_type === 'bank_cash' || a.name.toLowerCase().includes('kas') || a.name.toLowerCase().includes('bank'))
        if (defaultBank) setCatPayAccount(defaultBank.id)
      }
      if (!catCategoryAccount) {
        if (catType === 'income') {
          const defaultRev = accounts.find(a => a.type === 'REVENUE')
          if (defaultRev) setCatCategoryAccount(defaultRev.id)
        } else if (catType === 'expense') {
          const defaultExp = accounts.find(a => a.type === 'EXPENSE')
          if (defaultExp) setCatCategoryAccount(defaultExp.id)
        } else if (catType === 'transfer') {
          const secondBank = accounts.find(a => a.type === 'ASSET' && a.id !== catPayAccount)
          if (secondBank) setCatCategoryAccount(secondBank.id)
        }
      }
    }
  }, [accounts, catType, catPayAccount, catCategoryAccount])

  // Categorized Entry Preview Lines & Tax Calculation
  const catPreview = useMemo(() => {
    const rawVal = parseFloat(catAmount) || 0
    if (rawVal <= 0 || !catPayAccount || !catCategoryAccount) {
      return { lines: [], totalDebit: 0, totalCredit: 0, netVal: 0, taxVal: 0 }
    }

    let netVal = rawVal
    let taxVal = 0

    // Indonesian Tax calculations (PSAK)
    if (catTaxType === 'ppn11') {
      if (catTaxMode === 'inclusive') {
        netVal = rawVal / 1.11
        taxVal = rawVal - netVal
      } else {
        taxVal = rawVal * 0.11
      }
    } else if (catTaxType === 'pph23') {
      taxVal = rawVal * 0.02
    } else if (catTaxType === 'pph42') {
      taxVal = rawVal * 0.10
    }

    const ppnMasukanAcc = accounts.find(a => a.name.toLowerCase().includes('ppn masukan') || a.code === '104000') || accounts.find(a => a.type === 'ASSET' && a.name.toLowerCase().includes('pajak'))
    const ppnKeluaranAcc = accounts.find(a => a.name.toLowerCase().includes('ppn keluaran') || a.code === '202000') || accounts.find(a => a.type === 'LIABILITY' && a.name.toLowerCase().includes('pajak'))

    const lines: JournalLine[] = []

    if (catType === 'expense') {
      lines.push({
        account_id: catCategoryAccount,
        debit: Math.round(netVal),
        credit: 0,
        line_desc: `Beban ${catMemo ? '- ' + catMemo : ''}`
      })

      if (taxVal > 0 && ppnMasukanAcc) {
        lines.push({
          account_id: ppnMasukanAcc.id,
          debit: Math.round(taxVal),
          credit: 0,
          line_desc: 'PPN Masukan (11%)'
        })
      }

      const totalCashOut = catTaxMode === 'exclusive' ? rawVal + taxVal : rawVal
      lines.push({
        account_id: catPayAccount,
        debit: 0,
        credit: Math.round(totalCashOut),
        line_desc: 'Pembayaran Kas/Bank'
      })
    } else if (catType === 'income') {
      const totalCashIn = catTaxMode === 'exclusive' ? rawVal + taxVal : rawVal

      lines.push({
        account_id: catPayAccount,
        debit: Math.round(totalCashIn),
        credit: 0,
        line_desc: 'Penerimaan Kas/Bank'
      })

      lines.push({
        account_id: catCategoryAccount,
        debit: 0,
        credit: Math.round(netVal),
        line_desc: `Pendapatan ${catMemo ? '- ' + catMemo : ''}`
      })

      if (taxVal > 0 && ppnKeluaranAcc) {
        lines.push({
          account_id: ppnKeluaranAcc.id,
          debit: 0,
          credit: Math.round(taxVal),
          line_desc: 'PPN Keluaran (11%)'
        })
      }
    } else if (catType === 'transfer') {
      lines.push({
        account_id: catCategoryAccount,
        debit: Math.round(rawVal),
        credit: 0,
        line_desc: 'Transfer Masuk Bank Tujuan'
      })
      lines.push({
        account_id: catPayAccount,
        debit: 0,
        credit: Math.round(rawVal),
        line_desc: 'Transfer Keluar Bank Asal'
      })
    }

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0)
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0)

    return { lines, totalDebit, totalCredit, netVal, taxVal }
  }, [catAmount, catType, catPayAccount, catCategoryAccount, catTaxType, catTaxMode, catMemo, accounts])

  // Manual Journal Lines Balance Validation
  const jnlBalance = useMemo(() => {
    let totalDebit = 0
    let totalCredit = 0

    jnlLines.forEach(l => {
      totalDebit += (parseFloat(String(l.debit)) || 0)
      totalCredit += (parseFloat(String(l.credit)) || 0)
    })

    const rate = jnlExchangeRate > 0 ? jnlExchangeRate : 1
    totalDebit = totalDebit * rate
    totalCredit = totalCredit * rate

    const diff = Math.abs(totalDebit - totalCredit)
    const isBalanced = diff < 0.01 && totalDebit > 0

    return { totalDebit, totalCredit, diff, isBalanced }
  }, [jnlLines, jnlExchangeRate])

  // Handle Dynamic Rows in Manual Journal Grid
  const addJournalLine = () => {
    setJnlLines([...jnlLines, { account_id: '', debit: 0, credit: 0, line_desc: '' }])
  }

  const removeJournalLine = (index: number) => {
    if (jnlLines.length <= 2) return
    setJnlLines(jnlLines.filter((_, i) => i !== index))
  }

  const updateJournalLine = (index: number, field: keyof JournalLine, value: any) => {
    const updated = [...jnlLines]
    if (field === 'debit') {
      const num = parseFloat(value) || 0
      updated[index].debit = num
      if (num > 0) updated[index].credit = 0
    } else if (field === 'credit') {
      const num = parseFloat(value) || 0
      updated[index].credit = num
      if (num > 0) updated[index].debit = 0
    } else {
      (updated[index] as any)[field] = value
    }
    setJnlLines(updated)
  }

  // Handle Form Submission
  const handleSubmitTransaction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeBusiness?.id) return
    setErrorMsg('')
    setSuccessMsg('')
    setSubmitting(true)

    try {
      let payload: any = null

      if (modalTab === 'categorized') {
        const rawVal = parseFloat(catAmount) || 0
        if (rawVal <= 0) {
          setErrorMsg('Nominal transaksi harus lebih dari 0')
          setSubmitting(false)
          return
        }
        if (!catPayAccount || !catCategoryAccount) {
          setErrorMsg('Pilih akun Kas/Bank dan Kategori Akun secara lengkap')
          setSubmitting(false)
          return
        }

        const typeLabel = catType === 'income' ? 'Pemasukan' : catType === 'expense' ? 'Pengeluaran' : 'Transfer Bank'
        const fullDesc = `[Kategori: ${typeLabel}] ${catMemo || 'Transaksi ' + typeLabel} ${catRef ? '(Ref: ' + catRef + ')' : ''} ${catContact ? '(Kontak: ' + catContact + ')' : ''}`.trim()

        payload = {
          business_id: activeBusiness.id,
          date: catDate,
          description: fullDesc,
          journal_lines: catPreview.lines.map(l => ({
            account_id: l.account_id,
            debit: l.debit,
            credit: l.credit
          }))
        }
      } else {
        if (!jnlBalance.isBalanced) {
          setErrorMsg(`Jurnal tidak seimbang! Total Debet (Rp ${jnlBalance.totalDebit.toLocaleString('id-ID')}) ≠ Total Kredit (Rp ${jnlBalance.totalCredit.toLocaleString('id-ID')}). Selisih: Rp ${jnlBalance.diff.toLocaleString('id-ID')}`)
          setSubmitting(false)
          return
        }

        const fullDesc = `[Jurnal Umum] ${jnlMemo || 'Jurnal Penyesuaian'} ${jnlRef ? '(Ref: ' + jnlRef + ')' : ''} ${jnlCurrency !== 'IDR' ? '[' + jnlCurrency + ' @ ' + jnlExchangeRate + ']' : ''}`.trim()

        payload = {
          business_id: activeBusiness.id,
          date: jnlDate,
          description: fullDesc,
          journal_lines: jnlLines.map(l => ({
            account_id: l.account_id,
            debit: Math.round((parseFloat(String(l.debit)) || 0) * (jnlExchangeRate || 1)),
            credit: Math.round((parseFloat(String(l.credit)) || 0) * (jnlExchangeRate || 1))
          }))
        }
      }

      const res = await fetch('/api/accounting/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Gagal menyimpan transaksi')
      }

      setSuccessMsg('Transaksi jurnal berhasil disimpan ke dalam pembukuan!')
      setIsCreateModalOpen(false)
      setCatAmount('')
      setCatMemo('')
      setCatRef('')
      setJnlMemo('')
      setJnlRef('')
      setJnlLines([
        { account_id: '', debit: 0, credit: 0, line_desc: '' },
        { account_id: '', debit: 0, credit: 0, line_desc: '' }
      ])
      loadTransactions()
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan saat menyimpan')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Void / Reverse Transaction
  const handleVoidTransaction = async (tx: Transaction) => {
    const clean = cleanDescriptionString(tx.description)
    if (tx.description?.includes('[VOID') || tx.description?.includes('REVERSAL') || reversedDescriptionsSet.has(clean)) {
      alert('Transaksi ini sudah dibatalkan (void) sebelumnya.')
      return
    }

    if (!confirm(`Apakah Anda yakin ingin membatalkan (Void) transaksi "${tx.description}"? Sesuai standar akuntansi PSAK, sistem akan otomatis membuat Jurnal Pembalik (Reversal Entry) untuk menjaga integritas jejak audit.`)) {
      return
    }

    try {
      const res = await fetch(`/api/accounting/transactions/${tx.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void' })
      })
      const json = await res.json()

      if (!res.ok) {
        alert(`Gagal membatalkan transaksi: ${json.error}`)
        return
      }

      alert('Transaksi berhasil di-void dengan jurnal pembalik!')
      loadTransactions()
    } catch (e: any) {
      alert(`Terjadi kesalahan: ${e.message}`)
    }
  }

  // Edit Journal Balance Calculation
  const editJnlBalance = useMemo(() => {
    let totalDebit = 0
    let totalCredit = 0
    editJnlLines.forEach(line => {
      totalDebit += parseFloat(String(line.debit)) || 0
      totalCredit += parseFloat(String(line.credit)) || 0
    })
    const diff = Math.abs(totalDebit - totalCredit)
    return {
      totalDebit,
      totalCredit,
      diff,
      isBalanced: diff < 0.01 && totalDebit > 0 && totalCredit > 0
    }
  }, [editJnlLines])



  const handleOpenEdit = (tx: Transaction) => {
    const clean = cleanDescriptionString(tx.description)
    if (tx.description?.includes('[VOID') || tx.description?.includes('REVERSAL') || reversedDescriptionsSet.has(clean)) {
      alert('Transaksi yang sudah dibatalkan (void) tidak dapat diedit.')
      return
    }
    setEditingTransaction(tx)
    try {
      const dt = new Date(tx.date)
      const isoDate = !isNaN(dt.getTime()) ? dt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
      setEditDate(isoDate)
    } catch {
      setEditDate(new Date().toISOString().split('T')[0])
    }
    const baseDesc = cleanDescriptionString(tx.description)
    setEditDescription(baseDesc)
    setEditJnlLines((tx.journal_lines || []).map(l => ({
      account_id: l.account_id,
      debit: l.debit || 0,
      credit: l.credit || 0,
      line_desc: l.line_desc || ''
    })))
    setErrorMsg('')
    setSuccessMsg('')
  }


  const updateEditJournalLine = (index: number, field: keyof JournalLine, value: any) => {
    setEditJnlLines(prev => {
      const updated = [...prev]
      const line = { ...updated[index] }
      if (field === 'debit') {
        line.debit = parseFloat(value) || 0
        if (line.debit > 0) line.credit = 0
      } else if (field === 'credit') {
        line.credit = parseFloat(value) || 0
        if (line.credit > 0) line.debit = 0
      } else if (field === 'account_id') {
        line.account_id = value
      }
      updated[index] = line
      return updated
    })
  }

  const addEditJournalLine = () => {
    setEditJnlLines(prev => [...prev, { account_id: '', debit: 0, credit: 0, line_desc: '' }])
  }

  const removeEditJournalLine = (index: number) => {
    if (editJnlLines.length <= 2) return
    setEditJnlLines(prev => prev.filter((_, idx) => idx !== index))
  }

  const handleSaveEditTransaction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTransaction) return
    if (!editJnlBalance.isBalanced) {
      alert('Jurnal tidak seimbang! Total Debet dan Total Kredit harus bernilai sama.')
      return
    }
    setEditSubmitting(true)
    setErrorMsg('')
    try {
      const res = await fetch(`/api/accounting/transactions/${editingTransaction.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editDate,
          description: editDescription,
          journal_lines: editJnlLines,
          order_id: editingTransaction.order_id
        })
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Gagal mengedit transaksi')
      }
      setSuccessMsg('Transaksi berhasil diperbarui dan riwayat edit telah dicatat!')
      setEditingTransaction(null)
      loadTransactions()
    } catch (err: any) {
      setErrorMsg(`Gagal memperbarui transaksi: ${err.message}`)
    } finally {
      setEditSubmitting(false)
    }
  }

  // WaveApps-Style Helper to resolve Account & Category for each transaction
  const getAccountAndCategoryInfo = (tx: Transaction) => {
    const lines = tx.journal_lines || []
    const desc = tx.description || ''
    const isVoid = desc.includes('[VOID') || desc.includes('REVERSAL')
    const isOrder = !!tx.order_id || desc.includes('[Penjualan')
    const isPurchase = desc.includes('[Pembelian')
    const isStockOpname = desc.includes('[Stock Opname')

    // Check if created as manual journal entry or split entry (>2 lines)
    const isExplicitJournal = desc.startsWith('[Jurnal Umum') || desc.startsWith('[JU') || lines.length > 2 || (!desc.includes('[Kategori') && !desc.includes('[Pemasukan') && !desc.includes('[Pengeluaran') && !tx.order_id && lines.length !== 2)

    if (isVoid) {
      return {
        accountName: null,
        categoryName: 'Jurnal Pembalik (Void)',
        isJournalEntry: true,
        categoryStyle: 'bg-red-50 text-red-700 border-red-200'
      }
    }

    if (isOrder) {
      const payLine = lines.find(l => l.accounts?.type === 'ASSET' || l.accounts?.type === 'LIABILITY')
      return {
        accountName: payLine?.accounts?.name || 'Kas / Piutang Usaha',
        categoryName: 'Penjualan / Pesanan',
        isJournalEntry: true,
        categoryStyle: 'bg-purple-50 text-purple-700 border-purple-200'
      }
    }

    if (isPurchase) {
      const payLine = lines.find(l => l.accounts?.type === 'ASSET' || l.accounts?.type === 'LIABILITY')
      return {
        accountName: payLine?.accounts?.name || 'Hutang / Kas',
        categoryName: 'Pembelian Barang',
        isJournalEntry: true,
        categoryStyle: 'bg-indigo-50 text-indigo-700 border-indigo-200'
      }
    }

    if (isStockOpname) {
      return {
        accountName: null,
        categoryName: 'Penyesuaian Stok',
        isJournalEntry: true,
        categoryStyle: 'bg-gray-100 text-gray-700 border-gray-200'
      }
    }

    if (isExplicitJournal) {
      return {
        accountName: null,
        categoryName: 'Jurnal Umum',
        isJournalEntry: true,
        categoryStyle: 'bg-blue-50 text-blue-700 border-blue-200'
      }
    }

    // 2-Line Categorized Transaction (Income / Expense / Transfer)
    if (lines.length === 2) {
      const l1 = lines[0]
      const l2 = lines[1]

      let payAcc = null
      let catAcc = null

      if (l1.accounts?.type === 'ASSET' || l1.accounts?.type === 'LIABILITY') {
        payAcc = l1.accounts
        catAcc = l2.accounts
      } else if (l2.accounts?.type === 'ASSET' || l2.accounts?.type === 'LIABILITY') {
        payAcc = l2.accounts
        catAcc = l1.accounts
      } else {
        catAcc = l1.accounts
        payAcc = l2.accounts
      }

      return {
        accountName: payAcc?.name || null,
        categoryName: catAcc?.name || 'Transaksi Terkategori',
        isJournalEntry: false,
        categoryStyle: ''
      }
    }

    return {
      accountName: null,
      categoryName: 'Jurnal Umum',
      isJournalEntry: true,
      categoryStyle: 'bg-blue-50 text-blue-700 border-blue-200'
    }
  }

  // Export Data to Excel (.xlsx)


  const exportToExcel = () => {
    if (transactions.length === 0) {
      alert('Tidak ada data transaksi untuk diekspor')
      return
    }

    const exportRows: any[] = []

    transactions.forEach(tx => {
      (tx.journal_lines || []).forEach(jl => {
        exportRows.push({
          'ID Transaksi': tx.id,
          'Tanggal': new Date(tx.date).toLocaleString('id-ID'),
          'Keterangan Transaksi': tx.description,
          'Kode Akun': jl.accounts?.code || '',
          'Nama Akun': jl.accounts?.name || '',
          'Tipe Akun': jl.accounts?.type || '',
          'Debet (Rp)': jl.debit,
          'Kredit (Rp)': jl.credit,
          'Order ID / Ref': tx.order_id || ''
        })
      })
    })

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Daftar Jurnal & Transaksi')
    XLSX.writeFile(workbook, `Transaksi_Akuntansi_${dateLimits.start}_s.d_${dateLimits.end}.xlsx`)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ─── Header & Title ──────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="su-label mb-1">AKUNTANSI & JURNAL</div>
          <h1 className="su-heading">Transaksi & Jurnal umum</h1>
          <p className="text-sm text-[var(--su-text-muted)] mt-1">
            Kelola jurnal berpasangan (double-entry), transaksi terkategori, serta pembalikan transaksi sesuai standar PSAK & Go Global.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportToExcel}
            className="px-4 py-2.5 bg-white border border-[var(--su-border)] text-sm font-semibold rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Ekspor Excel
          </button>
          <button
            onClick={() => { setIsCreateModalOpen(true); setErrorMsg(''); setSuccessMsg(''); }}
            className="px-4 py-2.5 bg-[var(--su-primary)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--su-primary-dark)] flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Tambah Transaksi Baru
          </button>
        </div>
      </div>

      {/* ─── Notification Banners ────────────────────────────────────────── */}
      {successMsg && (
        <div className="p-4 bg-[var(--su-success-light)] border border-green-200 text-green-800 rounded-xl text-sm font-medium flex items-center justify-between">
          <span>✅ {successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="text-green-600 hover:text-green-900">✕</button>
        </div>
      )}


      {/* ─── Filter Bar Controls ─────────────────────────────────────────── */}
      <div className="p-4 bg-white rounded-xl border border-[var(--su-border)] shadow-xs space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg text-xs font-medium">
            {(['this-month', 'this-quarter', 'this-year', 'last-month', 'custom'] as DateRangeKey[]).map(key => (
              <button
                key={key}
                onClick={() => setDatePreset(key)}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer capitalize ${datePreset === key ? 'bg-white text-[var(--su-primary)] font-bold shadow-xs' : 'text-[var(--su-text-muted)] hover:text-black'}`}
              >
                {key === 'this-month' ? 'Bulan Ini' : key === 'this-quarter' ? 'Kuartal Ini' : key === 'this-year' ? 'Tahun Ini' : key === 'last-month' ? 'Bulan Lalu' : 'Kustom'}
              </button>
            ))}
          </div>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1.5 border border-[var(--su-border)] rounded-md focus:outline-none focus:border-[var(--su-primary)]"
              />
              <span>s.d</span>
              <input
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1.5 border border-[var(--su-border)] rounded-md focus:outline-none focus:border-[var(--su-primary)]"
              />
            </div>
          )}

          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Cari transaksi atau no. referensi..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-[var(--su-border)] rounded-lg focus:outline-none focus:border-[var(--su-primary)]"
            />
            <svg className="absolute left-3 top-2.5 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>

          <div className="w-64">
            <SearchableAccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={setSelectedAccountId}
              placeholder="Semua Akun (COA)"
            />
          </div>

          <select
            value={transactionTypeFilter}
            onChange={e => setTransactionTypeFilter(e.target.value as any)}
            className="px-3 py-1.5 text-sm border border-[var(--su-border)] rounded-lg focus:outline-none focus:border-[var(--su-primary)] bg-white"
          >
            <option value="all">Semua Tipe Transaksi</option>
            <option value="categorized">Transaksi Terkategori</option>
            <option value="journal">Jurnal Umum Manual</option>
          </select>
        </div>
      </div>

      {/* ─── Transactions Data Table ────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[var(--su-border)] shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[var(--su-text-muted)] space-y-3">
            <div className="inline-block animate-spin w-8 h-8 border-4 border-[var(--su-primary)] border-t-transparent rounded-full"></div>
            <div>Memuat data transaksi & jurnal...</div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-4xl">🧾</div>
            <div className="text-lg font-bold text-[var(--su-text)]">Belum Ada Transaksi</div>
            <p className="text-sm text-[var(--su-text-muted)] max-w-md mx-auto">
              Tidak ada transaksi ditemukan pada periode terpilih. Klik &quot;Tambah Transaksi Baru&quot; untuk membuat jurnal entry atau transaksi terkategori.
            </p>
          </div>
        ) : (
          <div>
            {renderPaginationControls()}
            <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-[var(--su-border)] text-[var(--su-text-muted)] text-xs uppercase font-semibold">
                  <th className="py-3.5 px-4">Tanggal</th>
                  <th className="py-3.5 px-4">Deskripsi / Transaksi</th>
                  <th className="py-3.5 px-4">Akun Pembayaran</th>
                  <th className="py-3.5 px-4">Kategori</th>
                  <th className="py-3.5 px-4 text-right">Total Nominal</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--su-border)]">
                {paginatedTransactions.map(tx => {
                  const cleanDescription = cleanDescriptionString(tx.description)
                  const isReversalTx = tx.description?.includes('[VOID') || tx.description?.includes('REVERSAL')
                  const isOriginalReversedTx = reversedDescriptionsSet.has(cleanDescription)
                  const isVoid = isReversalTx || isOriginalReversedTx
                  const totalAmount = (tx.journal_lines || []).reduce((sum, l) => sum + (parseFloat(String(l.debit)) || 0), 0)

                  // Extract edit history timestamp if present
                  const editMatch = tx.description?.match(/\[Diedit:\s*([^\]]+)\]/)


                  // WaveApps style account & category resolution
                  const { accountName, categoryName, isJournalEntry, categoryStyle } = getAccountAndCategoryInfo(tx)

                  return (
                    <tr key={tx.id} className={`hover:bg-gray-50/80 transition-colors ${isOriginalReversedTx ? 'opacity-60 bg-red-50/30' : isReversalTx ? 'bg-purple-50/20' : ''}`}>
                      <td className="py-3.5 px-4 font-mono text-xs text-[var(--su-text-muted)] whitespace-nowrap">
                        {new Date(tx.date).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: '2-digit' })}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-[var(--su-text)] text-sm line-clamp-2">{cleanDescription}</div>
                        {editMatch && (
                          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200" title={`Transaksi ini pernah diedit pada ${editMatch[1]}`}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                            <span>Diedit: {editMatch[1]}</span>
                          </div>
                        )}
                        {tx.order_id && (
                          <div className="text-xs text-blue-600 font-mono mt-0.5">Order Ref: #{tx.order_id.slice(0, 8)}</div>
                        )}
                      </td>
                      
                      {/* Akun Pembayaran Column */}
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                        {accountName ? (
                          <span className="font-medium text-gray-900">{accountName}</span>
                        ) : (
                          <span className="text-gray-400 font-mono text-xs">-</span>
                        )}
                      </td>

                      {/* Kategori Column */}
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                        {isJournalEntry ? (
                          <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${categoryStyle}`}>
                            {categoryName}
                          </span>
                        ) : (
                          <span className="font-semibold text-gray-800 bg-gray-100/90 px-2.5 py-1 rounded-md border border-gray-200">
                            {categoryName}
                          </span>
                        )}
                      </td>

                      {/* Total Nominal Column */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-gray-900 whitespace-nowrap">
                        {formatCurrencyIDR(totalAmount)}
                      </td>

                      {/* Status Column */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {isOriginalReversedTx ? (
                          <span className="px-2.5 py-1 text-xs font-bold text-red-700 bg-red-100 rounded-full border border-red-200">
                            Dibatalkan
                          </span>
                        ) : isReversalTx ? (
                          <span className="px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-100 rounded-full border border-purple-200" title="Transaksi Jurnal Pembalik yang aktif membalikkan transaksi asli">
                            Jurnal Pembalik
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-xs font-bold text-green-700 bg-green-100 rounded-full border border-green-200">
                            Diposting
                          </span>
                        )}
                      </td>

                      {/* Aksi Column */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setDetailTransaction(tx)}
                            title="Lihat Detail Rincian Jurnal"
                            className="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          {!isVoid && (
                            <>
                              <button
                                onClick={() => handleOpenEdit(tx)}
                                title="Edit Transaksi (WaveApps Style)"
                                className="p-1.5 text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button
                                onClick={() => handleVoidTransaction(tx)}
                                title="Batalkan (Void with Reversal Entry)"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

            </table>
          </div>
          {renderPaginationControls()}
        </div>
        )}
      </div>

      {/* ─── CREATE TRANSACTION MODAL (WaveApps Dual Mode via Portal) ──── */}
      {mounted && isCreateModalOpen && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-4xl w-full my-6 overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-extrabold text-blue-600 uppercase tracking-widest">AKUNTANSI & JURNAL</div>
                <h2 className="text-xl font-extrabold text-gray-900 mt-0.5">Tambah Transaksi Keuangan</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gray-400 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex border-b border-gray-200 bg-white px-6 pt-3 gap-6">
              <button
                type="button"
                onClick={() => setModalTab('categorized')}
                className={`pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${modalTab === 'categorized' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                <span>⚡ Transaksi Terkategori (Cepat)</span>
              </button>
              <button
                type="button"
                onClick={() => setModalTab('journal')}
                className={`pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${modalTab === 'journal' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                <span>📘 Jurnal Umum (Double-Entry Manual)</span>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitTransaction} className="p-6 overflow-y-auto space-y-6 flex-1">
              {errorMsg && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl flex items-center justify-between">
                  <span>⚠️ {errorMsg}</span>
                  <button type="button" onClick={() => setErrorMsg('')} className="text-red-500 hover:text-red-800 font-bold">✕</button>
                </div>
              )}

              {/* ─── TAB 1: CATEGORIZED ENTRY ────────────────────────────── */}
              {modalTab === 'categorized' && (
                <div className="space-y-5">
                  {/* Transaction Type Card Selector */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Tipe Transaksi</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: 'expense', label: '💸 Pengeluaran', desc: 'Beban Operasional / Kas Keluar', color: 'border-red-200 bg-red-50/40 text-red-900 ring-red-500' },
                        { id: 'income', label: '💰 Pemasukan', desc: 'Pendapatan / Kas Masuk', color: 'border-green-200 bg-green-50/40 text-green-900 ring-green-500' },
                        { id: 'transfer', label: '🔄 Transfer Bank', desc: 'Pindah Kas antar Rekening', color: 'border-blue-200 bg-blue-50/40 text-blue-900 ring-blue-500' }
                      ].map(typeItem => (
                        <div
                          key={typeItem.id}
                          onClick={() => setCatType(typeItem.id as any)}
                          className={`p-3.5 border rounded-xl cursor-pointer transition-all ${catType === typeItem.id ? `${typeItem.color} ring-2 shadow-xs` : 'border-gray-200 hover:bg-gray-50'}`}
                        >
                          <div className="text-sm font-bold">{typeItem.label}</div>
                          <div className="text-xs text-gray-500 mt-1">{typeItem.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">Tanggal Transaksi</label>
                      <input
                        type="date"
                        required
                        value={catDate}
                        onChange={e => setCatDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">
                        {catType === 'transfer' ? 'Dari Akun (Kas Asal)' : 'Akun Kas / Bank (Pembayaran)'}
                      </label>
                      <SearchableAccountSelect
                        accounts={accounts}
                        value={catPayAccount}
                        onChange={setCatPayAccount}
                        filterTypes={['ASSET']}
                        placeholder="-- Pilih Akun Kas/Bank --"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">
                        {catType === 'income' ? 'Kategori Pendapatan (Revenue)' : catType === 'expense' ? 'Kategori Beban (Expense)' : 'Ke Akun (Kas Tujuan)'}
                      </label>
                      <SearchableAccountSelect
                        accounts={accounts}
                        value={catCategoryAccount}
                        onChange={setCatCategoryAccount}
                        filterTypes={catType === 'income' ? ['REVENUE'] : catType === 'expense' ? ['EXPENSE'] : ['ASSET']}
                        placeholder="-- Pilih Kategori Utama --"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">Nominal (Rp)</label>
                      <input
                        type="number"
                        min="1"
                        required
                        placeholder="Contoh: 500000"
                        value={catAmount}
                        onChange={e => setCatAmount(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm font-mono font-bold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Indonesian Tax Setup (PSAK) */}
                  {catType !== 'transfer' && (
                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-800">🇮🇩 Pengaturan Pajak Indonesia (PSAK)</span>
                        <div className="flex items-center gap-4 text-xs font-medium">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="taxMode"
                              checked={catTaxMode === 'inclusive'}
                              onChange={() => setCatTaxMode('inclusive')}
                            />
                            <span>Harga Inklusif Pajak</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="taxMode"
                              checked={catTaxMode === 'exclusive'}
                              onChange={() => setCatTaxMode('exclusive')}
                            />
                            <span>Eksklusif (Pajak Plus)</span>
                          </label>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { id: 'none', label: 'Tanpa Pajak' },
                          { id: 'ppn11', label: 'PPN 11%' },
                          { id: 'pph23', label: 'PPh 23 (2%)' },
                          { id: 'pph42', label: 'PPh Final 4(2) (10%)' }
                        ].map(tax => (
                          <button
                            key={tax.id}
                            type="button"
                            onClick={() => setCatTaxType(tax.id as any)}
                            className={`py-2 px-3 text-xs font-bold rounded-lg border transition-all cursor-pointer ${catTaxType === tax.id ? 'bg-white border-blue-600 text-blue-600 shadow-xs' : 'bg-gray-100 border-transparent text-gray-600 hover:bg-gray-200'}`}
                          >
                            {tax.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">Kontak / Customer / Vendor (Opsional)</label>
                      <input
                        type="text"
                        placeholder="Nama Pemasok / Pelanggan"
                        value={catContact}
                        onChange={e => setCatContact(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">No. Referensi / Bukti Nota</label>
                      <input
                        type="text"
                        placeholder="Contoh: INV/2026/07/001"
                        value={catRef}
                        onChange={e => setCatRef(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">Catatan / Keterangan Transaksi</label>
                    <input
                      type="text"
                      placeholder="Pembayaran sewa kantor bulan Juli 2026"
                      value={catMemo}
                      onChange={e => setCatMemo(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Real-time Double-Entry Preview Box */}
                  {catPreview.lines.length > 0 && (
                    <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-xl space-y-2">
                      <div className="text-xs font-bold text-blue-900 flex items-center justify-between">
                        <span>🔍 Pratinjau Otomatis Jurnal Berpasangan (Double-Entry)</span>
                        <span className="font-mono text-green-700">Total: {formatCurrencyIDR(catPreview.totalDebit)}</span>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        {catPreview.lines.map((line, idx) => {
                          const accObj = accounts.find(a => a.id === line.account_id)
                          return (
                            <div key={idx} className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-blue-100 font-mono">
                              <span className="text-gray-800 font-semibold">
                                [{accObj?.code}] {accObj?.name}
                              </span>
                              <span className="font-bold">
                                {line.debit > 0 ? (
                                  <span className="text-green-700">Debet: {formatCurrencyIDR(line.debit)}</span>
                                ) : (
                                  <span className="text-blue-700">Kredit: {formatCurrencyIDR(line.credit)}</span>
                                )}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ─── TAB 2: MANUAL JOURNAL ENTRY ─────────────────────────── */}
              {modalTab === 'journal' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">Tanggal Jurnal</label>
                      <input
                        type="date"
                        required
                        value={jnlDate}
                        onChange={e => setJnlDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">No. Referensi / Jurnal</label>
                      <input
                        type="text"
                        placeholder="Contoh: JU-2026-001"
                        value={jnlRef}
                        onChange={e => setJnlRef(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">Mata Uang & Kurs</label>
                      <div className="flex gap-2">
                        <select
                          value={jnlCurrency}
                          onChange={e => setJnlCurrency(e.target.value)}
                          className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg bg-white font-medium"
                        >
                          <option value="IDR">IDR (Rp)</option>
                          <option value="USD">USD ($)</option>
                          <option value="SGD">SGD (S$)</option>
                          <option value="EUR">EUR (€)</option>
                        </select>
                        {jnlCurrency !== 'IDR' && (
                          <input
                            type="number"
                            step="any"
                            placeholder="Kurs IDR"
                            value={jnlExchangeRate}
                            onChange={e => setJnlExchangeRate(parseFloat(e.target.value) || 1)}
                            className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg font-mono"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">Catatan / Deskripsi Jurnal</label>
                    <input
                      type="text"
                      required
                      placeholder="Penyesuaian depresiasi aset / akrual beban"
                      value={jnlMemo}
                      onChange={e => setJnlMemo(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Multi-Line Dynamic Journal Table Grid */}
                  <div className="border border-gray-300 rounded-xl overflow-hidden shadow-xs">
                    <div className="bg-gray-100 px-4 py-2.5 border-b border-gray-300 grid grid-cols-12 gap-3 text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="col-span-5">Akun (Chart of Accounts)</div>
                      <div className="col-span-3 text-right">Debet (Rp)</div>
                      <div className="col-span-3 text-right">Kredit (Rp)</div>
                      <div className="col-span-1 text-center">Hapus</div>
                    </div>
                    <div className="divide-y divide-gray-200 bg-white">
                      {jnlLines.map((line, idx) => (
                        <div key={idx} className="p-3 grid grid-cols-12 gap-3 items-center text-xs">
                          <div className="col-span-5">
                            <SearchableAccountSelect
                              accounts={accounts}
                              value={line.account_id}
                              onChange={val => updateJournalLine(idx, 'account_id', val)}
                              placeholder="-- Pilih Akun --"
                              required
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={line.debit || ''}
                              onChange={e => updateJournalLine(idx, 'debit', e.target.value)}
                              className="w-full p-2.5 border border-gray-300 rounded-lg text-right font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={line.credit || ''}
                              onChange={e => updateJournalLine(idx, 'credit', e.target.value)}
                              className="w-full p-2.5 border border-gray-300 rounded-lg text-right font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="col-span-1 text-center">
                            <button
                              type="button"
                              onClick={() => removeJournalLine(idx)}
                              disabled={jnlLines.length <= 2}
                              className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-3 bg-gray-50 border-t border-gray-300 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={addJournalLine}
                        className="px-3.5 py-2 bg-white border border-gray-300 text-xs font-bold text-blue-600 rounded-lg hover:bg-blue-50 transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <span>+ Tambah Baris Jurnal</span>
                      </button>

                      {/* Real-time Balance Checker Badge */}
                      <div className="flex items-center gap-4 text-xs font-mono font-bold">
                        <div>Total Dr: {formatCurrencyIDR(jnlBalance.totalDebit)}</div>
                        <div>Total Cr: {formatCurrencyIDR(jnlBalance.totalCredit)}</div>
                        {jnlBalance.isBalanced ? (
                          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full border border-green-300">
                            ✅ Seimbang (Balanced)
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full border border-red-300">
                            ⚠️ Selisih: {formatCurrencyIDR(jnlBalance.diff)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2.5 border border-gray-300 text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting || (modalTab === 'journal' && !jnlBalance.isBalanced)}
                  className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all cursor-pointer flex items-center gap-2"
                >
                  {submitting && <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>}
                  <span>Posting Jurnal Keuangan</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ─── EDIT TRANSACTION MODAL (WaveApps Style via Portal) ──────────── */}
      {mounted && editingTransaction && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-4xl w-full my-6 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-amber-50/60 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-extrabold text-amber-700 uppercase tracking-widest flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  <span>EDIT TRANSAKSI (WAVEAPPS STYLE)</span>
                </div>
                <h2 className="text-xl font-extrabold text-gray-900 mt-0.5">Ubah Transaksi & Jurnal Keuangan</h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingTransaction(null)}
                className="text-gray-400 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleSaveEditTransaction} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Tanggal Transaksi</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Keterangan / Deskripsi Transaksi</label>
                  <input
                    type="text"
                    required
                    placeholder="misal: Pembelian Perlengkapan Kantor, FB Ads, dll."
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-gray-700 uppercase">Rincian Baris Jurnal (Double-Entry)</label>
                  <span className="text-xs text-gray-500 font-medium">Setiap perubahan akan mencatat timestamp riwayat edit.</span>
                </div>

                <div className="border border-gray-300 rounded-xl overflow-hidden shadow-xs">
                  <div className="bg-gray-100 px-4 py-2.5 border-b border-gray-300 grid grid-cols-12 gap-3 text-xs font-bold text-gray-700 uppercase tracking-wider">
                    <div className="col-span-5">Akun (Chart of Accounts)</div>
                    <div className="col-span-3 text-right">Debet (Rp)</div>
                    <div className="col-span-3 text-right">Kredit (Rp)</div>
                    <div className="col-span-1 text-center">Hapus</div>
                  </div>
                  <div className="divide-y divide-gray-200 bg-white">
                    {editJnlLines.map((line, idx) => (
                      <div key={idx} className="p-3 grid grid-cols-12 gap-3 items-center text-xs">
                        <div className="col-span-5">
                          <SearchableAccountSelect
                            accounts={accounts}
                            value={line.account_id}
                            onChange={val => updateEditJournalLine(idx, 'account_id', val)}
                            placeholder="-- Pilih Akun --"
                            required
                          />
                        </div>
                        <div className="col-span-3">
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={line.debit || ''}
                            onChange={e => updateEditJournalLine(idx, 'debit', e.target.value)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-right font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                        <div className="col-span-3">
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={line.credit || ''}
                            onChange={e => updateEditJournalLine(idx, 'credit', e.target.value)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-right font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                        <div className="col-span-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeEditJournalLine(idx)}
                            disabled={editJnlLines.length <= 2}
                            className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 bg-gray-50 border-t border-gray-300 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={addEditJournalLine}
                      className="px-3.5 py-2 bg-white border border-gray-300 text-xs font-bold text-amber-700 rounded-lg hover:bg-amber-50 transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span>+ Tambah Baris Jurnal</span>
                    </button>

                    {/* Real-time Balance Checker Badge */}
                    <div className="flex items-center gap-4 text-xs font-mono font-bold">
                      <div>Total Dr: {formatCurrencyIDR(editJnlBalance.totalDebit)}</div>
                      <div>Total Cr: {formatCurrencyIDR(editJnlBalance.totalCredit)}</div>
                      {editJnlBalance.isBalanced ? (
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full border border-green-300">
                          ✅ Seimbang (Balanced)
                        </span>
                      ) : (
                        <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full border border-red-300">
                          ⚠️ Selisih: {formatCurrencyIDR(editJnlBalance.diff)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingTransaction(null)}
                  className="px-4 py-2.5 border border-gray-300 text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting || !editJnlBalance.isBalanced}
                  className="px-5 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all cursor-pointer flex items-center gap-2"
                >
                  {editSubmitting && <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>}
                  <span>Simpan Perubahan Transaksi</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ─── TRANSACTION DETAIL MODAL ────────────────────────────────────── */}
      {mounted && detailTransaction && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-2xl w-full overflow-hidden">
            {(() => {
              const editMatch = detailTransaction.description?.match(/\[Diedit:\s*([^\]]+)\]/)
              const cleanDesc = cleanDescriptionString(detailTransaction.description)
              const historyList = parseHistoryList(detailTransaction.description)


              return (
                <>
                  <div className="p-5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-blue-600 uppercase tracking-wider">RINCIAN JURNAL & AUDIT TRAIL</div>
                      <h3 className="text-lg font-bold text-gray-900 mt-0.5">{cleanDesc}</h3>
                      {editMatch && (
                        <div className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-medium">
                          <span>✏️ Riwayat Edit Terakhir: {editMatch[1]}</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailTransaction(null)}
                      className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-200 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-6 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
                    <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3.5 rounded-xl border border-gray-200">
                      <div>
                        <span className="text-gray-500 font-semibold block mb-0.5">Tanggal Transaksi Saat Ini:</span>
                        <span className="font-mono text-gray-900 font-bold">
                          {new Date(detailTransaction.date).toLocaleString('id-ID')}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 font-semibold block mb-0.5">ID Referensi:</span>
                        <span className="font-mono text-gray-900 font-bold">{detailTransaction.id}</span>
                      </div>
                    </div>

                    {/* Versi Terbaru Saat Ini */}
                    <div className="space-y-2">
                      <div className="font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <span>Versi Terkini (Diposting)</span>
                      </div>
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                              <th className="p-3">Kode Akun</th>
                              <th className="p-3">Nama Akun</th>
                              <th className="p-3 text-right">Debet (Rp)</th>
                              <th className="p-3 text-right">Kredit (Rp)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {(detailTransaction.journal_lines || []).map((jl, idx) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="p-3 font-mono font-bold text-gray-700">{jl.accounts?.code || '---'}</td>
                                <td className="p-3 font-semibold text-gray-900">{jl.accounts?.name || 'Akun'} ({jl.accounts?.type || ''})</td>
                                <td className="p-3 text-right font-mono font-bold text-green-700">
                                  {jl.debit > 0 ? formatCurrencyIDR(jl.debit) : '-'}
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-blue-700">
                                  {jl.credit > 0 ? formatCurrencyIDR(jl.credit) : '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Versi Data Sebelum Edit (Audit Trail Log) */}
                    {historyList.length > 0 && (
                      <div className="space-y-3 pt-4 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <div className="font-bold text-amber-800 flex items-center gap-2 text-sm">
                            <span>📜 Riwayat Data Sebelum Diedit ({historyList.length} versi lampau)</span>
                          </div>
                          <span className="text-[11px] text-gray-500 font-medium">Audit Trail System</span>
                        </div>

                        <div className="space-y-3">
                          {historyList.slice().reverse().map((hist: any, hIdx: number) => (
                            <div key={hIdx} className="bg-amber-50/50 border border-amber-200 rounded-xl p-3.5 space-y-2.5">
                              <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                                <div className="font-bold text-amber-900 text-xs flex items-center gap-1.5">
                                  <span>🕒 Diedit pada: {hist.edited_at}</span>
                                </div>
                                <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                                  Versi #{historyList.length - hIdx}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-700">
                                <div>
                                  <span className="font-semibold text-gray-500">Tanggal Sebelum Edit: </span>
                                  <span className="font-mono font-bold">{hist.prev_date ? new Date(hist.prev_date).toLocaleDateString('id-ID') : '-'}</span>
                                </div>
                                <div>
                                  <span className="font-semibold text-gray-500">Deskripsi Sebelum Edit: </span>
                                  <span className="font-bold">{hist.prev_desc || '-'}</span>
                                </div>
                              </div>

                              <div className="border border-amber-200 rounded-lg overflow-hidden bg-white">
                                <table className="w-full text-left border-collapse text-[11px]">
                                  <thead>
                                    <tr className="bg-amber-100/70 text-amber-900 font-bold border-b border-amber-200">
                                      <th className="p-2">Kode</th>
                                      <th className="p-2">Nama Akun Lama</th>
                                      <th className="p-2 text-right">Debet (Rp)</th>
                                      <th className="p-2 text-right">Kredit (Rp)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-amber-100">
                                    {(hist.prev_lines || []).map((pl: any, plIdx: number) => (
                                      <tr key={plIdx}>
                                        <td className="p-2 font-mono font-bold text-gray-600">{pl.code || '---'}</td>
                                        <td className="p-2 font-medium text-gray-800">{pl.name}</td>
                                        <td className="p-2 text-right font-mono font-bold text-emerald-700">
                                          {pl.debit > 0 ? formatCurrencyIDR(pl.debit) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono font-bold text-blue-700">
                                          {pl.credit > 0 ? formatCurrencyIDR(pl.credit) : '-'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-4 border-t border-gray-200 bg-gray-50 text-right">
                    <button
                      type="button"
                      onClick={() => setDetailTransaction(null)}
                      className="px-4 py-2 bg-gray-800 text-white text-xs font-semibold rounded-lg hover:bg-black cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}

