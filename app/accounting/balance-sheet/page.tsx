"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { 
  formatCurrencyIDR, 
  fetchLedgerBalances, 
  Account 
} from '../utils'

export default function BalanceSheetPage() {
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

  // Snapshot date
  const [asOfDate, setAsOfDate] = useState(() => {
    const d = new Date()
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  })

  // Collapsible groups
  const [showAssetsDetail, setShowAssetsDetail] = useState(true)
  const [showLiabilitiesDetail, setShowLiabilitiesDetail] = useState(true)
  const [showEquityDetail, setShowEquityDetail] = useState(true)

  // Toggle for showing zero balance accounts
  const [showZeroBalances, setShowZeroBalances] = useState(false)

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
          const tz = biz?.timezone || 'Asia/Jakarta'
          setActiveBizName(biz?.name || 'Toko')
          setActiveBizTimezone(tz)
          // Update asOfDate to match business localzone
          const d = new Date()
          const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
          setAsOfDate(formatter.format(d))
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

  // Fetch ledger data up to snapshot date
  const loadData = useCallback(async (businessId: string, date: string, timezone: string) => {
    setLoading(true)
    try {
      const data = await fetchLedgerBalances(supabase, businessId, date, undefined, timezone)
      setAccounts(data.accounts)
      setBalances(data.balances)
      setErrorMsg(null)
    } catch (err: any) {
      console.error('Error loading balance sheet data:', err)
      setErrorMsg(err.message || 'Gagal memuat data Neraca')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Trigger load when date or business changes
  useEffect(() => {
    if (activeBizId && asOfDate && activeBizTimezone) {
      loadData(activeBizId, asOfDate, activeBizTimezone)
    }
  }, [activeBizId, asOfDate, activeBizTimezone, loadData])

  // Calculate Balance Sheet values
  const sheetData = useMemo(() => {
    if (Object.keys(balances).length === 0) {
      return {
        currentAssets: [],
        totalCurrentAssets: 0,
        fixedAssets: [],
        totalFixedAssets: 0,
        totalAssets: 0,
        currentLiabilities: [],
        totalCurrentLiabilities: 0,
        longTermLiabilities: [],
        totalLongTermLiabilities: 0,
        totalLiabilities: 0,
        equityList: [],
        retainedEarnings: 0,
        totalEquity: 0,
        isBalanced: true,
        difference: 0
      }
    }

    const accountBalances: Record<string, number> = {}
    let historicalRevenue = 0
    let historicalExpense = 0

    accounts.forEach(acc => {
      const b = balances[acc.id] || { debit: 0, credit: 0 }
      
      if (acc.type === 'ASSET') {
        accountBalances[acc.id] = b.debit - b.credit
      } else if (acc.type === 'LIABILITY') {
        accountBalances[acc.id] = b.credit - b.debit
      } else if (acc.type === 'EQUITY') {
        accountBalances[acc.id] = b.credit - b.debit
      } else if (acc.type === 'REVENUE') {
        historicalRevenue += (b.credit - b.debit)
      } else if (acc.type === 'EXPENSE') {
        historicalExpense += (b.debit - b.credit)
      }
    })

    const currentAssets: { account: Account; balance: number }[] = []
    const fixedAssets: { account: Account; balance: number }[] = []
    const currentLiabilities: { account: Account; balance: number }[] = []
    const longTermLiabilities: { account: Account; balance: number }[] = []
    const equityList: { account: Account; balance: number }[] = []

    accounts.forEach(acc => {
      const bal = accountBalances[acc.id] || 0
      
      if (acc.type === 'ASSET') {
        const isCurrentAsset = acc.sub_type ? (
          acc.sub_type === 'bank_cash' ||
          acc.sub_type === 'receivable' ||
          acc.sub_type === 'current_assets' ||
          acc.sub_type === 'prepayments'
        ) : (
          acc.code.startsWith('101') || 
          acc.code.startsWith('1100') ||
          acc.code.startsWith('102') ||
          acc.code.startsWith('103') ||
          acc.name.toLowerCase().includes('kas') ||
          acc.name.toLowerCase().includes('bank') ||
          acc.name.toLowerCase().includes('qris') ||
          acc.name.toLowerCase().includes('piutang') ||
          acc.name.toLowerCase().includes('persediaan')
        );

        if (isCurrentAsset) {
          currentAssets.push({ account: acc, balance: bal })
        } else {
          fixedAssets.push({ account: acc, balance: bal })
        }
      } else if (acc.type === 'LIABILITY') {
        const isLongTerm = acc.sub_type === 'non_current_liabilities' || 
                           acc.code.startsWith('21') || 
                           acc.code.startsWith('22');
        if (isLongTerm) {
          longTermLiabilities.push({ account: acc, balance: bal })
        } else {
          currentLiabilities.push({ account: acc, balance: bal })
        }
      } else if (acc.type === 'EQUITY') {
        equityList.push({ account: acc, balance: bal })
      }
    })

    const totalCurrentAssets = currentAssets.reduce((sum, item) => sum + item.balance, 0)
    const totalFixedAssets = fixedAssets.reduce((sum, item) => sum + item.balance, 0)
    const totalAssets = totalCurrentAssets + totalFixedAssets

    const totalCurrentLiabilities = currentLiabilities.reduce((sum, item) => sum + item.balance, 0)
    const totalLongTermLiabilities = longTermLiabilities.reduce((sum, item) => sum + item.balance, 0)
    const totalLiabilities = totalCurrentLiabilities + totalLongTermLiabilities

    // Retained earnings = historical revenue - expense
    const retainedEarnings = historicalRevenue - historicalExpense
    const totalCapital = equityList.reduce((sum, item) => sum + item.balance, 0)
    const totalEquity = totalCapital + retainedEarnings

    const difference = Math.abs(totalAssets - (totalLiabilities + totalEquity))
    const isBalanced = difference < 0.05 // Float accuracy threshold

    const filterFn = (item: { balance: number }) => showZeroBalances || item.balance !== 0

    return {
      currentAssets: currentAssets.filter(filterFn),
      totalCurrentAssets,
      fixedAssets: fixedAssets.filter(filterFn),
      totalFixedAssets,
      totalAssets,
      currentLiabilities: currentLiabilities.filter(filterFn),
      totalCurrentLiabilities,
      longTermLiabilities: longTermLiabilities.filter(filterFn),
      totalLongTermLiabilities,
      totalLiabilities,
      equityList: equityList.filter(filterFn),
      retainedEarnings,
      totalEquity,
      isBalanced,
      difference
    }
  }, [accounts, balances, showZeroBalances])

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
            grid-template-columns: repeat(3, 1fr) !important;
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

      {/* Page Header (Hides on print) */}
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
            Neraca Keuangan (Balance Sheet)
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Laporan posisi keuangan bisnis yang menggambarkan total aset, kewajiban, dan ekuitas pada tanggal tertentu.
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          🖨️ Cetak Neraca
        </button>
      </div>

      {/* Printed Brand Header (Only shown when printing) */}
      <div className="hidden print-header">
        <h1 className="text-xl font-bold uppercase tracking-wide">{activeBizName || 'ShapeUp CRM'}</h1>
        <h2 className="text-lg font-black uppercase text-blue-600 mt-1">Neraca Keuangan (Balance Sheet)</h2>
        <p className="text-xs text-gray-500 mt-1">
          Per Tanggal: {asOfDate}
        </p>
        <hr className="my-4 border-gray-300" />
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Per Tanggal (As of Date)</label>
            <input
              type="date"
              className="p-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tampilan Akun</label>
            <button
              type="button"
              onClick={() => setShowZeroBalances(!showZeroBalances)}
              className="flex items-center gap-2.5 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-700 transition-all cursor-pointer select-none"
            >
              <div className={`w-8 h-4.5 flex items-center rounded-full p-0.5 transition-colors duration-200 ${showZeroBalances ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`bg-white w-3.5 h-3.5 rounded-full shadow-sm transform transition-transform duration-200 ${showZeroBalances ? 'translate-x-3.5' : 'translate-x-0'}`} />
              </div>
              <span>{showZeroBalances ? 'Tampilkan Semua Akun (Termasuk Rp 0)' : 'Hanya Akun Aktif (Tidak Nol)'}</span>
            </button>
          </div>
        </div>

        {sheetData.isBalanced ? (
          <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg text-xs font-bold uppercase">
            <span>✓</span> Neraca Seimbang
          </div>
        ) : (
          <div className="flex items-center gap-2 text-rose-800 bg-rose-50 border border-rose-100 px-3 py-1.5 rounded-lg text-xs font-bold uppercase">
            <span>⚠️</span> Selisih: {formatCurrencyIDR(sheetData.difference)}
          </div>
        )}
      </div>

      {/* Loading & Errors */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Memuat data Neraca keuangan...
        </div>
      ) : errorMsg ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-xs font-semibold">
          ⚠️ {errorMsg}
        </div>
      ) : (
        <div className="print-container space-y-6">

          {/* KPI Row (Waveapps style summary) */}
          <div className="kpi-grid grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            {/* Total Assets */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Total Aset (Assets)</div>
              <div className="text-xl font-black text-gray-900 mt-1">{formatCurrencyIDR(sheetData.totalAssets)}</div>
              <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Kas, Piutang & Persediaan</div>
            </div>

            {/* Total Liabilities */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Total Kewajiban (Liabilities)</div>
              <div className="text-xl font-black text-rose-600 mt-1">{formatCurrencyIDR(sheetData.totalLiabilities)}</div>
              <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Hutang Usaha / Bills</div>
            </div>

            {/* Total Equity */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Total Ekuitas (Equity)</div>
              <div className="text-xl font-black text-emerald-700 mt-1">{formatCurrencyIDR(sheetData.totalEquity)}</div>
              <div className="text-[9px] text-emerald-600 font-bold mt-1.5 uppercase">Modal & Laba Ditahan</div>
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
                  
                  {/* ─── 1. ASSETS SECTION ─── */}
                  <tr className="bg-gray-50/40">
                    <td className="p-4 flex items-center gap-2">
                      <button 
                        onClick={() => setShowAssetsDetail(!showAssetsDetail)}
                        className="no-print text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer select-none"
                      >
                        {showAssetsDetail ? '▼' : '▶'}
                      </button>
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Aset (Assets)</span>
                    </td>
                    <td className="p-4 text-right font-extrabold text-gray-900">
                      {formatCurrencyIDR(sheetData.totalAssets)}
                    </td>
                  </tr>

                  {showAssetsDetail && (
                    <>
                      {/* Current Assets */}
                      <tr className="bg-gray-50/10">
                        <td className="p-3 pl-8 font-bold text-gray-700 uppercase tracking-wide text-[10px]">Aset Lancar</td>
                        <td className="p-3 text-right font-bold text-gray-800">{formatCurrencyIDR(sheetData.totalCurrentAssets)}</td>
                      </tr>
                      {sheetData.currentAssets.map(item => (
                        <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                          <td className="p-3 pl-12 text-gray-600 font-medium">
                            ({item.account.code}) {item.account.name}
                          </td>
                          <td className="p-3 text-right font-semibold text-gray-800">
                            {formatCurrencyIDR(item.balance)}
                          </td>
                        </tr>
                      ))}

                      {/* Fixed Assets */}
                      {sheetData.totalFixedAssets > 0 && (
                        <>
                          <tr className="bg-gray-50/10 border-t border-gray-100">
                            <td className="p-3 pl-8 font-bold text-gray-700 uppercase tracking-wide text-[10px]">Aset Tetap</td>
                            <td className="p-3 text-right font-bold text-gray-800">{formatCurrencyIDR(sheetData.totalFixedAssets)}</td>
                          </tr>
                          {sheetData.fixedAssets.map(item => (
                            <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                              <td className="p-3 pl-12 text-gray-600 font-medium">
                                ({item.account.code}) {item.account.name}
                              </td>
                              <td className="p-3 text-right font-semibold text-gray-800">
                                {formatCurrencyIDR(item.balance)}
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </>
                  )}

                  {/* ─── 2. LIABILITIES SECTION ─── */}
                  <tr className="bg-gray-50/40">
                    <td className="p-4 flex items-center gap-2">
                      <button 
                        onClick={() => setShowLiabilitiesDetail(!showLiabilitiesDetail)}
                        className="no-print text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer select-none"
                      >
                        {showLiabilitiesDetail ? '▼' : '▶'}
                      </button>
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Kewajiban (Liabilities)</span>
                    </td>
                    <td className="p-4 text-right font-extrabold text-rose-600">
                      {formatCurrencyIDR(sheetData.totalLiabilities)}
                    </td>
                  </tr>

                  {showLiabilitiesDetail && (
                    <>
                      {/* Kewajiban Lancar */}
                      <tr className="bg-gray-50/10">
                        <td className="p-3 pl-8 font-bold text-gray-700 uppercase tracking-wide text-[10px]">Kewajiban Lancar</td>
                        <td className="p-3 text-right font-bold text-rose-600">{formatCurrencyIDR(sheetData.totalCurrentLiabilities)}</td>
                      </tr>
                      {sheetData.currentLiabilities.length === 0 ? (
                        <tr>
                          <td className="p-3 pl-12 text-gray-400 italic font-normal">Tidak ada hutang / kewajiban lancar</td>
                          <td className="p-3 text-right text-gray-400">-</td>
                        </tr>
                      ) : (
                        sheetData.currentLiabilities.map(item => (
                          <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                            <td className="p-3 pl-12 text-gray-600 font-medium">
                              ({item.account.code}) {item.account.name}
                            </td>
                            <td className="p-3 text-right font-semibold text-rose-650">
                              {formatCurrencyIDR(item.balance)}
                            </td>
                          </tr>
                        ))
                      )}

                      {/* Kewajiban Jangka Panjang */}
                      {sheetData.totalLongTermLiabilities > 0 && (
                        <>
                          <tr className="bg-gray-50/10 border-t border-gray-100">
                            <td className="p-3 pl-8 font-bold text-gray-700 uppercase tracking-wide text-[10px]">Kewajiban Jangka Panjang</td>
                            <td className="p-3 text-right font-bold text-rose-600">{formatCurrencyIDR(sheetData.totalLongTermLiabilities)}</td>
                          </tr>
                          {sheetData.longTermLiabilities.map(item => (
                            <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                              <td className="p-3 pl-12 text-gray-600 font-medium">
                                ({item.account.code}) {item.account.name}
                              </td>
                              <td className="p-3 text-right font-semibold text-rose-650">
                                {formatCurrencyIDR(item.balance)}
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </>
                  )}

                  {/* ─── 3. EQUITY SECTION ─── */}
                  <tr className="bg-gray-50/40">
                    <td className="p-4 flex items-center gap-2">
                      <button 
                        onClick={() => setShowEquityDetail(!showEquityDetail)}
                        className="no-print text-gray-400 hover:text-gray-600 font-bold text-xs cursor-pointer select-none"
                      >
                        {showEquityDetail ? '▼' : '▶'}
                      </button>
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Ekuitas (Equity)</span>
                    </td>
                    <td className="p-4 text-right font-extrabold text-emerald-800">
                      {formatCurrencyIDR(sheetData.totalEquity)}
                    </td>
                  </tr>

                  {showEquityDetail && (
                    <>
                      {/* Capital accounts */}
                      {sheetData.equityList.map(item => (
                        <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                          <td className="p-3 pl-8 text-gray-600 font-medium">
                            ({item.account.code}) {item.account.name}
                          </td>
                          <td className="p-3 text-right font-semibold text-gray-800">
                            {formatCurrencyIDR(item.balance)}
                          </td>
                        </tr>
                      ))}

                      {/* Retained Earnings */}
                      <tr className="hover:bg-gray-50/30 transition-colors">
                        <td className="p-3 pl-8 text-gray-600 font-bold">
                          Laba Bersih Tahun Berjalan (Retained Earnings)
                        </td>
                        <td className={`p-3 text-right font-black ${
                          sheetData.retainedEarnings >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}>
                          {formatCurrencyIDR(sheetData.retainedEarnings)}
                        </td>
                      </tr>
                    </>
                  )}

                  {/* LIABILITIES AND EQUITY FOOTER */}
                  <tr className="bg-gray-100/50 border-t-2 border-gray-300 font-black text-sm">
                    <td className="p-4 pl-6 uppercase tracking-wider text-gray-900">
                      Total Kewajiban dan Ekuitas
                    </td>
                    <td className="p-4 text-right text-base text-gray-900">
                      {formatCurrencyIDR(sheetData.totalLiabilities + sheetData.totalEquity)}
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
