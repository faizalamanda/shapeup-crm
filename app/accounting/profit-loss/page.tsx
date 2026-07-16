"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { 
  formatCurrencyIDR, 
  getDateRangeLimits, 
  fetchLedgerBalances, 
  DateRangeKey, 
  Account 
} from '../utils'

export default function ProfitLossPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [activeBizTimezone, setActiveBizTimezone] = useState<string>('Asia/Jakarta')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Ledger state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [balances, setBalances] = useState<Record<string, { debit: number; credit: number }>>({})

  // Date range filters
  const [dateRangeType, setDateRangeType] = useState<DateRangeKey>('this-month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Toggle detail rows
  const [showRevenueDetail, setShowRevenueDetail] = useState(true)
  const [showExpenseDetail, setShowExpenseDetail] = useState(true)

  // Initialize dates
  useEffect(() => {
    const limits = getDateRangeLimits(dateRangeType)
    setStartDate(limits.start)
    setEndDate(limits.end)
  }, [dateRangeType])

  // Load Active Business Profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setErrorMsg('User session not found')
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
          setActiveBizName(biz?.name || 'Toko')
          setActiveBizTimezone(biz?.timezone || 'Asia/Jakarta')
        } else {
          setErrorMsg('No active business selected')
          setLoading(false)
        }
      } catch (err: any) {
        console.error('Error loading profile:', err)
        setErrorMsg(err.message || 'Error loading profile')
        setLoading(false)
      }
    }
    loadProfile()
  }, [supabase])

  // Fetch data from Ledger using server-side RPC
  const loadData = useCallback(async (businessId: string, startD: string, endD: string, timezone: string) => {
    setLoading(true)
    try {
      const data = await fetchLedgerBalances(supabase, businessId, endD, startD, timezone)
      setAccounts(data.accounts)
      setBalances(data.balances)
      setErrorMsg(null)
    } catch (err: any) {
      console.error('Error loading ledger data:', err)
      setErrorMsg(err.message || 'Gagal memuat data pembukuan')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Trigger load when business or date range change
  useEffect(() => {
    if (activeBizId && startDate && endDate && activeBizTimezone) {
      loadData(activeBizId, startDate, endDate, activeBizTimezone)
    }
  }, [activeBizId, startDate, endDate, activeBizTimezone, loadData])

  // Dynamic calculations based on selected date range
  const reportData = useMemo(() => {
    if (!startDate || !endDate || Object.keys(balances).length === 0) {
      return {
        revenueList: [],
        totalRevenue: 0,
        hppList: [],
        totalHpp: 0,
        grossProfit: 0,
        expenseList: [],
        totalExpenses: 0,
        netProfit: 0
      }
    }

    // Group accounts and sum balances
    const revenueList: { account: Account; balance: number }[] = []
    const hppList: { account: Account; balance: number }[] = []
    const expenseList: { account: Account; balance: number }[] = []

    accounts.forEach(acc => {
      const b = balances[acc.id] || { debit: 0, credit: 0 }
      let bal = 0
      
      // Calculate based on account type normal balances
      if (acc.type === 'REVENUE') {
        // Normal balance: Credit
        bal = b.credit - b.debit
      } else if (acc.type === 'EXPENSE') {
        // Normal balance: Debit
        bal = b.debit - b.credit
      }

      if (acc.type === 'REVENUE') {
        revenueList.push({ account: acc, balance: bal })
      } else if (acc.type === 'EXPENSE') {
        if (acc.code === '501000' || acc.name.toLowerCase().includes('harga pokok') || acc.name.toLowerCase().includes('hpp')) {
          hppList.push({ account: acc, balance: bal })
        } else {
          expenseList.push({ account: acc, balance: bal })
        }
      }
    })

    const totalRevenue = revenueList.reduce((sum, item) => sum + item.balance, 0)
    const totalHpp = hppList.reduce((sum, item) => sum + item.balance, 0)
    const grossProfit = totalRevenue - totalHpp
    const totalExpenses = expenseList.reduce((sum, item) => sum + item.balance, 0)
    const netProfit = grossProfit - totalExpenses

    return {
      revenueList: revenueList.filter(item => item.balance !== 0),
      totalRevenue,
      hppList: hppList.filter(item => item.balance !== 0),
      totalHpp,
      grossProfit,
      expenseList: expenseList.filter(item => item.balance !== 0),
      totalExpenses,
      netProfit
    }
  }, [accounts, balances, startDate, endDate])

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="space-y-6">
      {/* CSS Print Styles */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          aside, header, button, .no-print, select, input {
            display: none !important;
          }
          main {
            margin-left: 0 !important;
            padding: 0 !important;
          }
          .print-container {
            width: 100% !important;
            max-width: 100% !important;
            box-shadow: none !important;
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
          }
          .print-header {
            display: block !important;
            text-align: center;
            margin-bottom: 30px;
          }
          .kpi-grid {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 10px !important;
            margin-bottom: 30px !important;
          }
          .kpi-card {
            border: 1px solid #ccc !important;
            background: #fafafa !important;
            padding: 10px !important;
          }
        }
      `}</style>

      {/* Page Header (Hides on print, printed header is defined separately below) */}
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 no-print">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Laporan Akuntansi
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 uppercase">
                📍 {activeBizName}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight leading-none uppercase">
            Laporan Laba Rugi
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Tinjau pendapatan, beban, dan profitabilitas bersih bisnis Anda dalam suatu periode.
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          🖨️ Cetak Laporan
        </button>
      </div>

      {/* Printed Brand Header (Only shown when printing) */}
      <div className="hidden print-header">
        <h1 className="text-xl font-bold uppercase tracking-wide">{activeBizName || 'ShapeUp CRM'}</h1>
        <h2 className="text-lg font-black uppercase text-blue-600 mt-1">Laporan Laba Rugi</h2>
        <p className="text-xs text-gray-500 mt-1">
          Periode: {startDate} s/d {endDate}
        </p>
        <hr className="my-4 border-gray-300" />
      </div>

      {/* Date Filter Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center gap-4 no-print">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Rentang Periode</label>
          <select
            className="p-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white min-w-40"
            value={dateRangeType}
            onChange={e => setDateRangeType(e.target.value as DateRangeKey)}
          >
            <option value="this-month">Bulan Ini</option>
            <option value="this-quarter">Kuartal Ini</option>
            <option value="this-year">Tahun Ini</option>
            <option value="last-month">Bulan Lalu</option>
            <option value="last-quarter">Kuartal Lalu</option>
            <option value="last-year">Tahun Lalu</option>
            <option value="custom">Kustom Tanggal</option>
          </select>
        </div>

        {dateRangeType === 'custom' && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tanggal Mulai</label>
              <input
                type="date"
                className="p-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tanggal Selesai</label>
              <input
                type="date"
                className="p-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="ml-auto text-[10px] font-black tracking-widest text-gray-400 uppercase self-end mb-1">
          {startDate} s/d {endDate}
        </div>
      </div>

      {/* Loading & Errors */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Memuat data laporan laba rugi...
        </div>
      ) : errorMsg ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-xs font-semibold">
          ⚠️ {errorMsg}
        </div>
      ) : (
        <div className="print-container space-y-6">
          
          {/* KPI Row (Waveapps style summary) */}
          <div className="kpi-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Revenue */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Total Pendapatan</div>
              <div className="text-xl font-black text-gray-900 mt-1">{formatCurrencyIDR(reportData.totalRevenue)}</div>
              <div className="text-[9px] text-emerald-600 font-bold mt-1.5 uppercase">Inflow kotor periode ini</div>
            </div>

            {/* COGS (HPP) */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Harga Pokok Penjualan (HPP)</div>
              <div className="text-xl font-black text-rose-600 mt-1">{formatCurrencyIDR(reportData.totalHpp)}</div>
              <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Biaya langsung persediaan</div>
            </div>

            {/* Expenses */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Total Beban Operasional</div>
              <div className="text-xl font-black text-orange-600 mt-1">{formatCurrencyIDR(reportData.totalExpenses)}</div>
              <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Beban OPEX umum</div>
            </div>

            {/* Net Income */}
            <div className={`kpi-card border rounded-xl p-5 shadow-xs transition-all ${
              reportData.netProfit >= 0 
                ? 'bg-emerald-50/55 border-emerald-200' 
                : 'bg-rose-50/55 border-rose-200'
            }`}>
              <div className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">Laba Bersih (Net Income)</div>
              <div className={`text-xl font-black mt-1 ${
                reportData.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}>
                {formatCurrencyIDR(reportData.netProfit)}
              </div>
              <div className="text-[9px] font-extrabold mt-1.5 uppercase">
                {reportData.netProfit >= 0 ? '🟢 Surplus Profit' : '🔴 Defisit (Rugi)'}
              </div>
            </div>
            
          </div>

          {/* Statement Report Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                    <th className="p-4 w-2/3">Kategori Akun</th>
                    <th className="p-4 text-right w-1/3">Jumlah</th>
                  </tr>
                </thead>
                <tbody className="text-xs font-semibold text-gray-700 divide-y divide-gray-100">
                  
                  {/* 1. REVENUE SECTION */}
                  <tr className="bg-gray-50/40">
                    <td className="p-4 flex items-center gap-2">
                      <button 
                        onClick={() => setShowRevenueDetail(!showRevenueDetail)}
                        className="no-print text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer select-none"
                      >
                        {showRevenueDetail ? '▼' : '▶'}
                      </button>
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Pendapatan (Revenue)</span>
                    </td>
                    <td className="p-4 text-right font-extrabold text-gray-900">
                      {formatCurrencyIDR(reportData.totalRevenue)}
                    </td>
                  </tr>

                  {showRevenueDetail && (
                    <>
                      {reportData.revenueList.length === 0 ? (
                        <tr>
                          <td className="p-3 pl-10 text-gray-400 italic font-normal">Tidak ada transaksi pendapatan</td>
                          <td className="p-3 text-right text-gray-400">-</td>
                        </tr>
                      ) : (
                        reportData.revenueList.map(item => (
                          <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                            <td className="p-3 pl-10 text-gray-600 font-medium">
                              ({item.account.code}) {item.account.name}
                            </td>
                            <td className="p-3 text-right font-semibold text-gray-800">
                              {formatCurrencyIDR(item.balance)}
                            </td>
                          </tr>
                        ))
                      )}
                    </>
                  )}

                  {/* 2. COST OF GOODS SOLD SECTION */}
                  <tr className="bg-gray-50/40">
                    <td className="p-4 pl-10">
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Harga Pokok Penjualan (HPP)</span>
                    </td>
                    <td className="p-4 text-right font-extrabold text-rose-600">
                      ({formatCurrencyIDR(reportData.totalHpp)})
                    </td>
                  </tr>

                  {showRevenueDetail && reportData.hppList.map(item => (
                    <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                      <td className="p-3 pl-10 text-gray-600 font-medium">
                        ({item.account.code}) {item.account.name}
                      </td>
                      <td className="p-3 text-right font-semibold text-rose-600">
                        {formatCurrencyIDR(item.balance)}
                      </td>
                    </tr>
                  ))}

                  {/* GROSS PROFIT */}
                  <tr className="bg-gray-100/50 border-t border-b border-gray-200">
                    <td className="p-4 pl-6 font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">
                      Laba Kotor (Gross Profit)
                    </td>
                    <td className="p-4 text-right font-black text-gray-900 text-sm">
                      {formatCurrencyIDR(reportData.grossProfit)}
                    </td>
                  </tr>

                  {/* 3. OPERATING EXPENSES SECTION */}
                  <tr className="bg-gray-50/40">
                    <td className="p-4 flex items-center gap-2">
                      <button 
                        onClick={() => setShowExpenseDetail(!showExpenseDetail)}
                        className="no-print text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer select-none"
                      >
                        {showExpenseDetail ? '▼' : '▶'}
                      </button>
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Beban Operasional (Expenses)</span>
                    </td>
                    <td className="p-4 text-right font-extrabold text-orange-600">
                      ({formatCurrencyIDR(reportData.totalExpenses)})
                    </td>
                  </tr>

                  {showExpenseDetail && (
                    <>
                      {reportData.expenseList.length === 0 ? (
                        <tr>
                          <td className="p-3 pl-10 text-gray-400 italic font-normal">Tidak ada transaksi beban</td>
                          <td className="p-3 text-right text-gray-400">-</td>
                        </tr>
                      ) : (
                        reportData.expenseList.map(item => (
                          <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                            <td className="p-3 pl-10 text-gray-600 font-medium">
                              ({item.account.code}) {item.account.name}
                            </td>
                            <td className="p-3 text-right font-semibold text-orange-600">
                              {formatCurrencyIDR(item.balance)}
                            </td>
                          </tr>
                        ))
                      )}
                    </>
                  )}

                  {/* NET INCOME FOOTER */}
                  <tr className={`border-t-2 border-gray-300 font-black text-sm ${
                    reportData.netProfit >= 0 ? 'bg-emerald-50/40' : 'bg-rose-50/40'
                  }`}>
                    <td className="p-4 pl-6 uppercase tracking-wider text-gray-900">
                      Laba Bersih (Net Income)
                    </td>
                    <td className={`p-4 text-right text-base ${
                      reportData.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {formatCurrencyIDR(reportData.netProfit)}
                    </td>
                  </tr>

                </tbody>
              </table>
            </div>
          </div>
          
        </div>
      )}
    </div>
  )
}
