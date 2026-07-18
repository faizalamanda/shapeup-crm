"use client"
import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Account = {
  id: string
  code: string
  name: string
  type: string
}

const TARGET_FIELDS = [
  { key: 'date', name: 'Tanggal', required: true, desc: 'Tanggal transaksi pengeluaran' },
  { key: 'amount', name: 'Nominal / Jumlah', required: true, desc: 'Total nominal pengeluaran' },
  { key: 'category_account_id', name: 'Kategori Pengeluaran', required: false, desc: 'Akun biaya (OPEX) atau aset (CAPEX)' },
  { key: 'payment_account_id', name: 'Cara Bayar (Kas/Bank)', required: false, desc: 'Akun asal kas atau bank' },
  { key: 'vendor_name', name: 'Nama Vendor / Pemasok', required: false, desc: 'Nama pihak ketiga / toko' },
  { key: 'description', name: 'Deskripsi / Keterangan', required: false, desc: 'Detail pengeluaran' },
  { key: 'payment_status', name: 'Status Pembayaran', required: false, desc: 'Lunas (paid), Tempo (unpaid), DP (partial)' },
  { key: 'due_date', name: 'Tanggal Jatuh Tempo', required: false, desc: 'Jatuh tempo pembayaran' },
  { key: 'amount_paid', name: 'Jumlah Dibayar', required: false, desc: 'Nominal yang sudah dibayarkan' }
]

const DATE_FORMATS = [
  { value: 'AUTO', label: 'Deteksi Otomatis (Auto)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (contoh: 2026-07-18)' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (contoh: 18/07/2026)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (contoh: 07/18/2026)' },
  { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY (contoh: 18-07-2026)' }
]

// Auto-detect mappings based on header keywords
const detectFieldByHeader = (header: string): string => {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '')
  
  if (h.includes('tanggal') || h.includes('tgl') || h.includes('date') || h.includes('waktu') || h.includes('hari')) {
    return 'date'
  }
  if (h.includes('tempo') || h.includes('due')) {
    return 'due_date'
  }
  if (h.includes('dibayar') || h.includes('paidamount') || h.includes('dp') || h.includes('cicilan')) {
    return 'amount_paid'
  }
  if (h.includes('nominal') || h.includes('jumlah') || h.includes('total') || h.includes('amount') || h.includes('biaya') || h.includes('harga') || h.includes('subtotal') || h.includes('grandtotal')) {
    return 'amount'
  }
  if (h.includes('vendor') || h.includes('supplier') || h.includes('pemasok') || h.includes('toko') || h.includes('pihakketiga') || h.includes('namatoko') || h.includes('penerima')) {
    return 'vendor_name'
  }
  if (h.includes('deskripsi') || h.includes('keterangan') || h.includes('ket') || h.includes('notes') || h.includes('description') || h.includes('keperluan') || h.includes('detail')) {
    return 'description'
  }
  if (h.includes('kategori') || h.includes('category') || h.includes('akun') || h.includes('coa') || h.includes('jenis')) {
    return 'category_account_id'
  }
  if (h.includes('status')) {
    return 'payment_status'
  }
  if (h.includes('kas') || h.includes('bank') || h.includes('pembayaran') || h.includes('payment') || h.includes('carabayar') || h.includes('metode')) {
    return 'payment_account_id'
  }
  
  return ''
}

export default function ExpenseImportPage() {
  const router = useRouter()
  
  // Supabase & Context State
  const [supabase] = useState(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ))
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Wizard Steps State
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'result'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawData, setRawData] = useState<any[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  
  // Settings & Defaults
  const [datePref, setDatePref] = useState('AUTO')
  const [defaultCategory, setDefaultCategory] = useState('')
  const [defaultPayment, setDefaultPayment] = useState('')
  const [defaultStatus, setDefaultStatus] = useState('unpaid')

  // Import Execution Status
  const [importLoading, setImportLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)

  // Load User Profile & Business Context
  useEffect(() => {
    async function loadContext() {
      setLoading(true)
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
          setActiveBizName(biz?.name || 'Bisnis Saya')

          const { data: accData, error: accErr } = await supabase
            .from('accounts')
            .select('id, code, name, type')
            .eq('business_id', businessId)
            .order('code', { ascending: true })

          if (accErr) throw accErr
          setAccounts(accData || [])
        }
      } catch (err) {
        console.error('Error loading import page context:', err)
      } finally {
        setLoading(false)
      }
    }
    loadContext()
  }, [supabase, router])

  // Segregate accounts by types
  const categoryAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'EXPENSE' || (a.type === 'ASSET' && !a.code.startsWith('101') && !a.code.startsWith('102')))
  }, [accounts])

  const paymentAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  }, [accounts])

  // Set initial default accounts
  useEffect(() => {
    if (categoryAccounts.length > 0 && !defaultCategory) {
      const stdOp = categoryAccounts.find(a => a.code === '503000')
      setDefaultCategory(stdOp ? stdOp.id : categoryAccounts[0].id)
    }
    if (paymentAccounts.length > 0 && !defaultPayment) {
      setDefaultPayment(paymentAccounts[0].id)
    }
  }, [categoryAccounts, paymentAccounts, defaultCategory, defaultPayment])

  // Parse excel/csv date serials or strings
  const parseDate = (val: any, format: string): string | null => {
    if (!val) return null
    if (val instanceof Date) {
      return val.toISOString().split('T')[0]
    }
    if (typeof val === 'number') {
      try {
        const date = new Date((val - 25569) * 86400 * 1000)
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0]
        }
      } catch (e) {
        // Fallback
      }
    }

    const str = String(val).trim()
    if (!str) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str
    }

    if (format === 'DD/MM/YYYY' || format === 'DD-MM-YYYY') {
      const sep = format.includes('/') ? '/' : '-'
      const parts = str.split(sep)
      if (parts.length === 3) {
        const d = parts[0].padStart(2, '0')
        const m = parts[1].padStart(2, '0')
        const y = parts[2]
        return `${y.length === 2 ? '20' + y : y}-${m}-${d}`
      }
    }

    if (format === 'MM/DD/YYYY' || format === 'MM-DD-YYYY') {
      const sep = format.includes('/') ? '/' : '-'
      const parts = str.split(sep)
      if (parts.length === 3) {
        const m = parts[0].padStart(2, '0')
        const d = parts[1].padStart(2, '0')
        const y = parts[2]
        return `${y.length === 2 ? '20' + y : y}-${m}-${d}`
      }
    }

    // Auto-detect separators
    for (const sep of ['/', '-', '.']) {
      const parts = str.split(sep)
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
        }
        if (parts[2].length === 4) {
          return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
        }
      }
    }

    const nativeTime = Date.parse(str)
    if (!isNaN(nativeTime)) {
      return new Date(nativeTime).toISOString().split('T')[0]
    }
    return null
  }

  const parseAmount = (val: any): number => {
    if (val === undefined || val === null) return 0
    if (typeof val === 'number') return val
    const cleanStr = String(val).replace(/[^0-9.-]/g, '')
    const num = parseFloat(cleanStr)
    return isNaN(num) ? 0 : num
  }

  const resolveAccount = (val: any, list: Account[]): string | null => {
    if (!val) return null
    const str = String(val).trim().toLowerCase()
    if (!str) return null

    const byCode = list.find(a => a.code === str)
    if (byCode) return byCode.id

    const byName = list.find(a => a.name.toLowerCase() === str)
    if (byName) return byName.id

    const bySub = list.find(a => a.name.toLowerCase().includes(str) || str.includes(a.name.toLowerCase()))
    if (bySub) return bySub.id

    return null
  }

  const resolvePaymentStatus = (val: any): 'paid' | 'unpaid' | 'partial' => {
    if (!val) return 'unpaid'
    const str = String(val).trim().toLowerCase()
    if (['lunas', 'paid', 'l', 'y', 'yes', 'sudah'].includes(str)) return 'paid'
    if (['tempo', 'unpaid', 'u', 't', 'n', 'no', 'belum', 'hutang'].includes(str)) return 'unpaid'
    if (['cicil', 'partial', 'dp', 'sebagian'].includes(str)) return 'partial'
    return 'unpaid'
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const selectedFile = files[0]
    setFile(selectedFile)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
        if (data.length === 0) {
          alert('File kosong!')
          return
        }

        const fileHeaders = (data[0] as any[]).map(h => String(h || '').trim()).filter(Boolean)
        const fileRows = data.slice(1)

        setHeaders(fileHeaders)
        
        const formattedRows = fileRows.map(row => {
          const rowObj: Record<string, any> = {}
          fileHeaders.forEach((h, idx) => {
            rowObj[h] = (row as any[])[idx]
          })
          return rowObj
        }).filter(r => Object.values(r).some(v => v !== undefined && v !== null && v !== ''))

        setRawData(formattedRows)

        const presets = JSON.parse(localStorage.getItem('expense_import_mapping_presets') || '{}')
        const initialMapping: Record<string, string> = {}
        
        fileHeaders.forEach(h => {
          if (presets[h]) {
            initialMapping[h] = presets[h]
          } else {
            initialMapping[h] = detectFieldByHeader(h)
          }
        })

        setMapping(initialMapping)
        setStep('mapping')
      } catch (err) {
        console.error('Failed to parse file:', err)
        alert('Gagal membaca file. Pastikan format file Excel atau CSV valid.')
      }
    }
    reader.readAsBinaryString(selectedFile)
  }

  const handleMapChange = (header: string, targetField: string) => {
    setMapping(prev => ({ ...prev, [header]: targetField }))
    
    const presets = JSON.parse(localStorage.getItem('expense_import_mapping_presets') || '{}')
    if (targetField === '') {
      delete presets[header]
    } else {
      presets[header] = targetField
    }
    localStorage.setItem('expense_import_mapping_presets', JSON.stringify(presets))
  }

  const parsedData = useMemo(() => {
    return rawData.map((row, idx) => {
      const result: any = {
        _index: idx + 1,
        _errors: [] as string[],
        _warnings: [] as string[]
      }

      let rawDate: any = null
      let rawAmount: any = null
      let rawCategory: any = null
      let rawPayment: any = null
      let rawVendor: any = null
      let rawDesc: any = null
      let rawStatus: any = null
      let rawDueDate: any = null
      let rawAmountPaid: any = null

      headers.forEach(h => {
        const target = mapping[h]
        if (target === 'date') rawDate = row[h]
        if (target === 'amount') rawAmount = row[h]
        if (target === 'category_account_id') rawCategory = row[h]
        if (target === 'payment_account_id') rawPayment = row[h]
        if (target === 'vendor_name') rawVendor = row[h]
        if (target === 'description') rawDesc = row[h]
        if (target === 'payment_status') rawStatus = row[h]
        if (target === 'due_date') rawDueDate = row[h]
        if (target === 'amount_paid') rawAmountPaid = row[h]
      })

      const parsedDt = parseDate(rawDate, datePref)
      if (!parsedDt) {
        result._errors.push('Tanggal wajib diisi / Format tidak valid')
        result.date = rawDate ? String(rawDate) : '-'
      } else {
        result.date = parsedDt
      }

      const parsedAmt = parseAmount(rawAmount)
      if (rawAmount === undefined || rawAmount === null || parsedAmt <= 0) {
        result._errors.push('Nominal wajib diisi dan harus positif')
        result.amount = 0
      } else {
        result.amount = parsedAmt
      }

      result.vendor_name = rawVendor ? String(rawVendor).trim() : null
      result.description = rawDesc ? String(rawDesc).trim() : null

      const resolvedCatId = resolveAccount(rawCategory, categoryAccounts)
      if (resolvedCatId) {
        result.category_account_id = resolvedCatId
        result._categoryLabel = categoryAccounts.find(a => a.id === resolvedCatId)?.name
      } else {
        result.category_account_id = defaultCategory
        result._categoryLabel = categoryAccounts.find(a => a.id === defaultCategory)?.name
        if (rawCategory) {
          result._warnings.push(`Kategori "${rawCategory}" tidak ditemukan, menggunakan default`)
        }
      }

      const resolvedStatus = rawStatus ? resolvePaymentStatus(rawStatus) : (defaultStatus as 'paid' | 'unpaid' | 'partial')
      result.payment_status = resolvedStatus

      if (resolvedStatus === 'unpaid') {
        const hutangAccount = accounts.find(a => a.code === '201000' || a.name.toLowerCase().includes('hutang'))
        result.payment_account_id = hutangAccount?.id || null
        result._paymentLabel = hutangAccount?.name || 'Hutang Usaha'
        result.amount_paid = 0
        result.outstanding_amount = result.amount
        result.due_date = rawDueDate ? (parseDate(rawDueDate, datePref) || null) : null
        if (!result.due_date) {
          result._warnings.push('Batas tempo (due date) tempo kosong')
        }
      } else {
        const resolvedPayId = resolveAccount(rawPayment, paymentAccounts)
        if (resolvedPayId) {
          result.payment_account_id = resolvedPayId
          result._paymentLabel = paymentAccounts.find(a => a.id === resolvedPayId)?.name
        } else {
          result.payment_account_id = defaultPayment
          result._paymentLabel = paymentAccounts.find(a => a.id === defaultPayment)?.name
          if (rawPayment) {
            result._warnings.push(`Kas/Bank "${rawPayment}" tidak ditemukan, menggunakan default`)
          }
        }

        if (resolvedStatus === 'paid') {
          result.amount_paid = result.amount
          result.outstanding_amount = 0
          result.due_date = null
        } else if (resolvedStatus === 'partial') {
          const amtPaid = parseAmount(rawAmountPaid)
          if (amtPaid < 0 || amtPaid >= result.amount) {
            result._errors.push('Jumlah dibayar tidak valid untuk pembayaran DP / Cicilan')
            result.amount_paid = 0
            result.outstanding_amount = result.amount
          } else {
            result.amount_paid = amtPaid
            result.outstanding_amount = result.amount - amtPaid
          }
          result.due_date = rawDueDate ? (parseDate(rawDueDate, datePref) || null) : null
          if (!result.due_date) {
            result._warnings.push('Batas tempo (due date) cicilan kosong')
          }
        }
      }

      result._valid = result._errors.length === 0
      return result
    })
  }, [rawData, headers, mapping, datePref, defaultCategory, defaultPayment, defaultStatus, categoryAccounts, paymentAccounts, accounts])

  const stats = useMemo(() => {
    const total = parsedData.length
    const valid = parsedData.filter(d => d._valid).length
    const errors = total - valid
    return { total, valid, errors }
  }, [parsedData])

  const handleImportSubmit = async () => {
    const validPayload = parsedData.filter(d => d._valid).map(d => ({
      category_account_id: d.category_account_id,
      payment_account_id: d.payment_account_id,
      amount: d.amount,
      date: d.date,
      description: d.description,
      vendor_name: d.vendor_name,
      payment_status: d.payment_status,
      due_date: d.due_date,
      amount_paid: d.amount_paid
    }))

    if (validPayload.length === 0) {
      alert('Tidak ada data valid untuk diimpor!')
      return
    }

    setImportLoading(true)
    setStep('importing')
    setErrorMessage(null)

    try {
      const response = await fetch('/api/expenses/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenses: validPayload })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Terjadi kesalahan saat mengimpor data.')
      }

      setImportedCount(data.count || validPayload.length)
      setSuccessMessage(data.message || `Berhasil mengimpor ${data.count} data pengeluaran!`)
      setStep('result')
    } catch (err: any) {
      console.error('Import error:', err)
      setErrorMessage(err.message || 'Gagal mengunggah data impor.')
      setStep('result')
    } finally {
      setImportLoading(false)
    }
  }

  const formatPrice = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val)
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Memuat Konfigurasi Bisnis...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 animate-in fade-in duration-200">
      
      {/* Page Navigation & Title */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <Link href="/expenses" className="inline-flex items-center gap-1 text-xs font-extrabold text-blue-600 hover:text-blue-700 uppercase tracking-wider mb-2">
            ⬅ Kembali ke Pengeluaran
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              📤 Import Wizard
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase">
                🏢 {activeBizName}
              </span>
            )}
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 uppercase tracking-wide mt-1">
            Import Pengeluaran (Odoo-Style)
          </h1>
        </div>

        {/* Wizard Steps indicator */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-4 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
          <div className={`flex items-center gap-1 ${step === 'upload' ? 'text-blue-600' : 'text-emerald-600'}`}>
            <span>{step === 'upload' ? '⚪' : '🟢'}</span> Upload
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1 ${step === 'mapping' ? 'text-blue-600' : step !== 'upload' ? 'text-emerald-600' : ''}`}>
            <span>{step === 'mapping' ? '⚪' : step !== 'upload' ? '🟢' : '⚫'}</span> Mapping
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1 ${step === 'preview' ? 'text-blue-600' : step === 'result' ? 'text-emerald-600' : ''}`}>
            <span>{step === 'preview' ? '⚪' : step === 'result' ? '🟢' : '⚫'}</span> Preview
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1 ${step === 'importing' || (step === 'result' && !errorMessage) ? 'text-blue-600' : ''}`}>
            <span>{step === 'importing' ? '⌛' : step === 'result' && !errorMessage ? '🟢' : '⚫'}</span> Selesai
          </div>
        </div>
      </div>

      {/* Main Card Container */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden flex flex-col min-h-[400px]">
        
        {/* Content Area */}
        <div className="flex-1 p-6">
          
          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div className="space-y-6 py-12">
              <div className="max-w-md mx-auto text-center">
                <div className="border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50/10 transition-all rounded-xl p-10 cursor-pointer relative group">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                    onChange={handleFileChange}
                  />
                  <div className="pointer-events-none select-none">
                    <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">📄</div>
                    <h4 className="text-xs font-black uppercase text-gray-700 tracking-wider">
                      Pilih File Excel / CSV
                    </h4>
                    <p className="text-[10px] text-gray-400 mt-1.5 font-medium">
                      Drag & drop atau klik untuk menelusuri file (.xlsx, .xls, .csv)
                    </p>
                  </div>
                </div>
                <div className="mt-6 text-[10px] text-gray-500 font-semibold leading-relaxed">
                  💡 <span className="text-gray-700">Tips:</span> Anda dapat mengunggah file dengan format kolom apa saja. Sistem akan secara otomatis mendeteksi kolom tanggal, nominal, kategori, deskripsi, dan kas. Anda tidak perlu menyesuaikan nama kolom ke format database!
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: MAPPING */}
          {step === 'mapping' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="text-xs font-semibold text-blue-800 space-y-1">
                  <div className="font-extrabold uppercase text-[9px] tracking-wider text-blue-600">Konfigurasi Pengimporan</div>
                  <div>Format Tanggal File:</div>
                  <select
                    className="mt-1 p-2 border border-blue-200 rounded-md bg-white text-xs font-bold text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={datePref}
                    onChange={e => setDatePref(e.target.value)}
                  >
                    {DATE_FORMATS.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-semibold text-gray-700">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                      Kategori Default
                    </label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-md bg-white text-xs font-bold text-gray-800 outline-none"
                      value={defaultCategory}
                      onChange={e => setDefaultCategory(e.target.value)}
                    >
                      {categoryAccounts.map(a => (
                        <option key={a.id} value={a.id}>⚙️ {a.name} ({a.code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                      Kas/Bank Default
                    </label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-md bg-white text-xs font-bold text-gray-800 outline-none"
                      value={defaultPayment}
                      onChange={e => setDefaultPayment(e.target.value)}
                    >
                      {paymentAccounts.map(a => (
                        <option key={a.id} value={a.id}>🏦 {a.name} ({a.code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                      Status Bayar Default
                    </label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-md bg-white text-xs font-bold text-gray-800 outline-none"
                      value={defaultStatus}
                      onChange={e => setDefaultStatus(e.target.value)}
                    >
                      <option value="paid">🟢 Lunas</option>
                      <option value="unpaid">🔴 Tempo</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-black uppercase text-gray-700 tracking-wider mb-3">
                  Pemetaan Kolom (Column Mapping)
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold tracking-widest uppercase">
                        <th className="p-3">Kolom di File Anda</th>
                        <th className="p-3">Hubungkan ke Kolom Pengeluaran</th>
                        <th className="p-3">Contoh Baris Pertama</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                      {headers.map(header => {
                        const sampleVal = rawData[0] ? rawData[0][header] : '-';
                        const sampleString = sampleVal instanceof Date 
                          ? sampleVal.toLocaleDateString('id-ID')
                          : (sampleVal !== undefined && sampleVal !== null ? String(sampleVal) : '-');

                        return (
                          <tr key={header} className="hover:bg-gray-50/50">
                            <td className="p-3 font-bold text-gray-900">{header}</td>
                            <td className="p-3">
                              <select
                                className={`p-2 border rounded-md text-xs font-bold bg-white focus:outline-none w-64 ${
                                  mapping[header]
                                    ? 'border-blue-300 text-blue-800 bg-blue-50/20'
                                    : 'border-gray-300 text-gray-500'
                                }`}
                                value={mapping[header] || ''}
                                onChange={e => handleMapChange(header, e.target.value)}
                              >
                                <option value="">❌ Abaikan Kolom Ini</option>
                                {TARGET_FIELDS.map(f => (
                                  <option key={f.key} value={f.key}>
                                    {f.required ? '★ ' : ''}{f.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-3 text-gray-500 italic max-w-xs truncate" title={sampleString}>
                              {sampleString}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & VALIDATION */}
          {step === 'preview' && (
            <div className="space-y-6">
              
              {/* Summary Stats Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Total Baris</div>
                  <div className="text-2xl font-black text-blue-800 mt-1">{stats.total}</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Siap Diimpor (Valid)</div>
                  <div className="text-2xl font-black text-emerald-800 mt-1">{stats.valid}</div>
                </div>
                <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Ada Masalah (Error)</div>
                  <div className="text-2xl font-black text-rose-800 mt-1">{stats.errors}</div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-black uppercase text-gray-700 tracking-wider mb-3">
                  Preview Hasil Validasi (Menampilkan 10 Baris Pertama)
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold tracking-widest uppercase">
                          <th className="p-3 w-12 text-center">No</th>
                          <th className="p-3 w-28">Status</th>
                          <th className="p-3">Tanggal / Vendor</th>
                          <th className="p-3">Kategori Akun</th>
                          <th className="p-3">Cara Bayar</th>
                          <th className="p-3">Status Bayar</th>
                          <th className="p-3 text-right">Nominal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                        {parsedData.slice(0, 10).map((row, idx) => (
                          <tr key={idx} className={`hover:bg-gray-50/30 ${!row._valid ? 'bg-red-50/20' : ''}`}>
                            <td className="p-3 text-center text-gray-400 font-bold">{row._index}</td>
                            <td className="p-3">
                              {row._valid ? (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 uppercase">
                                  ✓ Valid
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 uppercase">
                                    ✗ Error
                                  </span>
                                  {row._errors.map((err: string, eIdx: number) => (
                                    <div key={eIdx} className="text-[8px] text-rose-600 font-black tracking-tight leading-none uppercase">
                                      ⚠️ {err}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {row._warnings.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {row._warnings.map((warn: string, wIdx: number) => (
                                    <div key={wIdx} className="text-[8px] text-amber-600 font-semibold leading-none">
                                      🛈 {warn}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="p-3 space-y-0.5">
                              <div className={row._valid ? 'text-gray-900 font-bold' : 'text-rose-700 font-bold'}>
                                {row.date}
                              </div>
                              <div className="text-[10px] text-gray-400 uppercase font-black">
                                {row.vendor_name || 'Tanpa Vendor'}
                              </div>
                            </td>
                            <td className="p-3">
                              <span className="inline-flex text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 uppercase max-w-[150px] truncate" title={row._categoryLabel}>
                                📁 {row._categoryLabel || '-'}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="inline-flex text-[10px] font-semibold text-gray-700 bg-gray-50 px-2 py-0.5 rounded border border-gray-100 uppercase max-w-[150px] truncate" title={row._paymentLabel}>
                                🏦 {row._paymentLabel || '-'}
                              </span>
                            </td>
                            <td className="p-3">
                              {row.payment_status === 'paid' && (
                                <span className="text-emerald-700 font-bold text-[10px] uppercase">🟢 Lunas</span>
                              )}
                              {row.payment_status === 'unpaid' && (
                                <span className="text-rose-700 font-bold text-[10px] uppercase">🔴 Tempo {row.due_date ? `(J.T: ${row.due_date})` : ''}</span>
                              )}
                              {row.payment_status === 'partial' && (
                                <span className="text-amber-700 font-bold text-[10px] uppercase">🟡 DP {formatPrice(row.amount_paid)}</span>
                              )}
                            </td>
                            <td className="p-3 text-right font-black text-gray-900">
                              {formatPrice(row.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {stats.total > 10 && (
                  <div className="text-[10px] text-gray-400 text-center font-bold uppercase tracking-wider mt-3">
                    Menampilkan 10 dari {stats.total} baris data. Baris lain akan diimpor dengan cara yang sama.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: IMPORTING */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-center">
                <h4 className="text-xs font-black uppercase text-gray-800 tracking-wider">Mengunggah dan Memproses Data</h4>
                <p className="text-[10px] text-gray-400 mt-1 font-semibold uppercase">
                  Mengimpor {stats.valid} data pengeluaran ke database ledger...
                </p>
              </div>
            </div>
          )}

          {/* STEP 5: RESULT */}
          {step === 'result' && (
            <div className="py-12 text-center space-y-6 max-w-md mx-auto">
              {errorMessage ? (
                <>
                  <div className="text-6xl">❌</div>
                  <h4 className="text-sm font-black uppercase text-rose-700 tracking-wider">Impor Gagal</h4>
                  <div className="bg-rose-50 border border-rose-100 rounded-lg p-4 text-left">
                    <p className="text-xs font-bold text-rose-800 leading-relaxed uppercase tracking-tight">
                      Detail Kesalahan:
                    </p>
                    <p className="text-xs text-rose-700 mt-1 font-medium break-words">
                      {errorMessage}
                    </p>
                  </div>
                  <button
                    onClick={() => setStep('preview')}
                    className="px-5 py-2.5 bg-gray-600 hover:bg-gray-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm cursor-pointer"
                  >
                    Kembali Ke Preview
                  </button>
                </>
              ) : (
                <>
                  <div className="text-6xl">🎉</div>
                  <h4 className="text-sm font-black uppercase text-emerald-700 tracking-wider">Impor Berhasil!</h4>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-5 text-xs font-bold text-emerald-800 space-y-2.5 uppercase tracking-wide">
                    <div>Bisnis: <span className="text-gray-900">{activeBizName || 'Toko Alamanda'}</span></div>
                    <div>Berhasil Diimpor: <span className="text-gray-900">{importedCount} Pengeluaran</span></div>
                    <div className="text-[9px] text-emerald-600 leading-tight normal-case mt-1.5 font-medium">
                      Jurnal ledger otomatis debit/kredit sudah dibuat seimbang untuk masing-masing transaksi pengeluaran.
                    </div>
                  </div>
                  <Link
                    href="/expenses"
                    className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm cursor-pointer"
                  >
                    Kembali ke Pengeluaran
                  </Link>
                </>
              )}
            </div>
          )}

        </div>

        {/* Footer Navigation Bar */}
        {step !== 'upload' && step !== 'importing' && step !== 'result' && (
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between">
            <button
              onClick={() => {
                if (step === 'mapping') {
                  setStep('upload')
                  setFile(null)
                } else if (step === 'preview') {
                  setStep('mapping')
                }
              }}
              className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            >
              Kembali
            </button>

            <button
              onClick={() => {
                if (step === 'mapping') {
                  const mappedTargets = Object.values(mapping)
                  const missingRequired = TARGET_FIELDS.filter(f => f.required && !mappedTargets.includes(f.key))
                  if (missingRequired.length > 0) {
                    alert(`Kolom wajib belum terpetakan: ${missingRequired.map(f => f.name).join(', ')}`)
                    return
                  }
                  setStep('preview')
                } else if (step === 'preview') {
                  handleImportSubmit()
                }
              }}
              disabled={step === 'preview' && stats.valid === 0}
              className={`px-4 py-2 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 cursor-pointer ${
                step === 'preview' && stats.valid === 0
                  ? 'bg-gray-400 cursor-not-allowed opacity-50'
                  : step === 'preview'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {step === 'mapping' ? 'Lanjutkan ke Preview' : `Impor ${stats.valid} Data`}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
