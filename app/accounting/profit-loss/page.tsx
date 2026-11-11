"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  formatCurrencyIDR, 
  fetchLedgerBalances, 
  Account 
} from '../utils'
import { useUserContext } from '@/components/UserContext'
import { TemporalDateFilter, TemporalFilterValue } from '@/components/ui/TemporalDateFilter'
import { 
  ComparisonMode,
  getLocalDateRangeLimits, 
  resolveComparisonRange, 
  getBusinessTimezone, 
  DEFAULT_TIMEZONE 
} from '@/lib/localzone'

function calculateGrowth(current: number, previous: number): { percent: number; isUp: boolean } | null {
  if (!previous || previous === 0) return null
  const diff = current - previous
  const percent = (diff / Math.abs(previous)) * 100
  return { percent, isUp: percent >= 0 }
}

function GrowthBadge({ current, previous, reversePolarity = false }: { current: number; previous: number; reversePolarity?: boolean }) {
  const g = calculateGrowth(current, previous)
  if (!g) return null
  const isPositiveGrowth = g.isUp
  // For Revenue/Profit: up is good (green), down is bad (red)
  // For Expenses/HPP: up is bad (red), down is good (green)
  const isGood = reversePolarity ? !isPositiveGrowth : isPositiveGrowth
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${
      isGood ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
    }`}>
      {isPositiveGrowth ? '▲' : '▼'} {Math.abs(g.percent).toFixed(1)}%
    </span>
  )
}

function computePLReportData(accounts: Account[], balMap: Record<string, { debit: number; credit: number }>) {
  if (Object.keys(balMap).length === 0) {
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

  const revenueList: { account: Account; balance: number }[] = []
  const hppList: { account: Account; balance: number }[] = []
  const expenseList: { account: Account; balance: number }[] = []

  accounts.forEach(acc => {
    const b = balMap[acc.id] || { debit: 0, credit: 0 }
    let bal = 0
    
    if (acc.type === 'REVENUE') {
      bal = b.credit - b.debit
    } else if (acc.type === 'EXPENSE') {
      bal = b.debit - b.credit
    }

    if (acc.type === 'REVENUE') {
      revenueList.push({ account: acc, balance: bal })
    } else if (acc.type === 'EXPENSE') {
      const isHpp = acc.sub_type === 'cogs' || 
                    (!acc.sub_type && (
                      acc.code.startsWith('501') || 
                      acc.code === '501000' || 
                      acc.name.toLowerCase().includes('harga pokok') || 
                      acc.name.toLowerCase().includes('hpp')
                    ));
      if (isHpp) {
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
}

export default function ProfitLossPage() {
  const { activeBusiness, bizLoading } = useUserContext()
  const activeBizTimezone = getBusinessTimezone(activeBusiness?.timezone)

  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Ledger state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [balances, setBalances] = useState<Record<string, { debit: number; credit: number }>>({})
  const [prevBalances, setPrevBalances] = useState<Record<string, { debit: number; credit: number }>>({})

  // Temporal Date & Comparison Filter
  const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
    const limits = getLocalDateRangeLimits('this-month', activeBizTimezone)
    const comp = resolveComparisonRange('previous_period', limits.start, limits.end)
    return {
      startDate: limits.start,
      endDate: limits.end,
      preset: 'this-month',
      comparisonMode: 'previous_period',
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }
  })

  const startDate = temporalFilter.startDate
  const endDate = temporalFilter.endDate
  const compStartDate = temporalFilter.comparisonStartDate
  const compEndDate = temporalFilter.comparisonEndDate
  const compMode = temporalFilter.comparisonMode

  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual')

  // Toggle detail rows
  const [showRevenueDetail, setShowRevenueDetail] = useState(true)
  const [showExpenseDetail, setShowExpenseDetail] = useState(true)

  // Load Active Business Profile from UserContext
  useEffect(() => {
    if (bizLoading) return
    if (activeBusiness?.id) {
      setActiveBizId(activeBusiness.id)
      setActiveBizName(activeBusiness.name || 'Toko')

      const savedBasis = localStorage.getItem(`su_pl_basis_${activeBusiness.id}`)
      if (savedBasis === 'accrual' || savedBasis === 'cash') {
        setBasis(savedBasis)
      }
    } else {
      setErrorMsg('Belum ada unit bisnis aktif yang dipilih.')
      setLoading(false)
    }
  }, [activeBusiness, bizLoading])

  // Fetch data from Ledger using server-side RPC
  const loadData = useCallback(async (
    businessId: string, 
    startD: string, 
    endD: string, 
    timezone: string, 
    reportBasis: 'accrual' | 'cash',
    cMode: ComparisonMode,
    cStart: string,
    cEnd: string
  ) => {
    setLoading(true)
    try {
      if (cMode !== 'none' && cStart && cEnd) {
        const [currData, prevData] = await Promise.all([
          fetchLedgerBalances(supabase, businessId, endD, startD, timezone, reportBasis),
          fetchLedgerBalances(supabase, businessId, cEnd, cStart, timezone, reportBasis)
        ])
        setAccounts(currData.accounts)
        setBalances(currData.balances)
        setPrevBalances(prevData.balances)
      } else {
        const data = await fetchLedgerBalances(supabase, businessId, endD, startD, timezone, reportBasis)
        setAccounts(data.accounts)
        setBalances(data.balances)
        setPrevBalances({})
      }
      setErrorMsg(null)
    } catch (err: any) {
      console.error('Error loading ledger data:', err)
      setErrorMsg(err.message || 'Gagal memuat data pembukuan')
    } finally {
      setLoading(false)
    }
  }, [])

  // Trigger load when business, date range, or basis change
  useEffect(() => {
    if (activeBizId && startDate && endDate && activeBizTimezone) {
      loadData(activeBizId, startDate, endDate, activeBizTimezone, basis, compMode, compStartDate, compEndDate)
    }
  }, [activeBizId, startDate, endDate, activeBizTimezone, basis, compMode, compStartDate, compEndDate, loadData])

  // Dynamic calculations based on selected date ranges
  const reportData = useMemo(() => computePLReportData(accounts, balances), [accounts, balances])
  
  const prevReportData = useMemo(() => {
    if (compMode === 'none' || Object.keys(prevBalances).length === 0) return null
    return computePLReportData(accounts, prevBalances)
  }, [accounts, prevBalances, compMode])

  // Map previous balances by account id for easy inline lookup
  const prevBalancesByAccount = useMemo(() => {
    const map = new Map<string, number>()
    if (!prevReportData) return map
    prevReportData.revenueList.forEach(item => map.set(item.account.id, item.balance))
    prevReportData.hppList.forEach(item => map.set(item.account.id, item.balance))
    prevReportData.expenseList.forEach(item => map.set(item.account.id, item.balance))
    return map
  }, [prevReportData])

  const handlePrint = () => {
    window.print()
  }

  const isComparisonActive = compMode !== 'none' && Boolean(prevReportData)

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
          }
          .kpi-grid {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 8px !important;
          }
          .kpi-card {
            border: 1px solid #ccc !important;
            padding: 10px !important;
          }
        }
      `}</style>

      {/* Top Header Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-gray-200 no-print">
        <div>
          <h1 className="text-xl font-black text-gray-900 tracking-tight">Laporan Laba Rugi</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Evaluasi pendapatan, beban, dan profitabilitas bersih unit usaha {activeBizName || ''}.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer shadow-xs active:scale-95"
          >
            🖨️ Cetak Laporan
          </button>
        </div>
      </div>

      {/* Print-Only Header */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-black text-gray-900 uppercase tracking-wider">{activeBizName || 'ShapeUp Business'}</h1>
        <h2 className="text-lg font-black uppercase text-blue-600 mt-1">
          Laporan Laba Rugi ({basis === 'cash' ? 'Cash Basis' : 'Accrual Basis'})
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Periode: {startDate} s/d {endDate} {isComparisonActive ? `vs ${compStartDate} s/d ${compEndDate}` : ''}
        </p>
        <hr className="my-4 border-gray-300" />
      </div>

      {/* Date & Basis Filter Bar (Lifetimely-Grade) */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-end justify-between gap-4 no-print">
        <TemporalDateFilter
          value={temporalFilter}
          onChange={setTemporalFilter}
          timezone={activeBizTimezone}
          showComparison={true}
          allowAllTime={false}
        />

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Basis Pelaporan</label>
          <select
            className="p-2 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white min-w-36"
            value={basis}
            onChange={e => {
              const val = e.target.value as 'accrual' | 'cash'
              setBasis(val)
              if (activeBizId) {
                localStorage.setItem(`su_pl_basis_${activeBizId}`, val)
              }
            }}
          >
            <option value="accrual">Accrual Basis</option>
            <option value="cash">Cash Basis</option>
          </select>
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
          
          {/* KPI Row (Comparative Summary) */}
          <div className="kpi-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Revenue */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Total Pendapatan</span>
                {prevReportData && (
                  <GrowthBadge current={reportData.totalRevenue} previous={prevReportData.totalRevenue} />
                )}
              </div>
              <div className="text-xl font-black text-gray-900 mt-1">{formatCurrencyIDR(reportData.totalRevenue)}</div>
              {prevReportData ? (
                <div className="text-[10px] text-gray-500 font-semibold mt-1">
                  vs {formatCurrencyIDR(prevReportData.totalRevenue)}
                </div>
              ) : (
                <div className="text-[9px] text-emerald-600 font-bold mt-1.5 uppercase">Inflow kotor periode ini</div>
              )}
            </div>

            {/* COGS (HPP) */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Harga Pokok Penjualan (HPP)</span>
                {prevReportData && (
                  <GrowthBadge current={reportData.totalHpp} previous={prevReportData.totalHpp} reversePolarity={true} />
                )}
              </div>
              <div className="text-xl font-black text-rose-600 mt-1">{formatCurrencyIDR(reportData.totalHpp)}</div>
              {prevReportData ? (
                <div className="text-[10px] text-gray-500 font-semibold mt-1">
                  vs {formatCurrencyIDR(prevReportData.totalHpp)}
                </div>
              ) : (
                <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Biaya langsung persediaan</div>
              )}
            </div>

            {/* Expenses */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Total Beban Operasional</span>
                {prevReportData && (
                  <GrowthBadge current={reportData.totalExpenses} previous={prevReportData.totalExpenses} reversePolarity={true} />
                )}
              </div>
              <div className="text-xl font-black text-orange-600 mt-1">{formatCurrencyIDR(reportData.totalExpenses)}</div>
              {prevReportData ? (
                <div className="text-[10px] text-gray-500 font-semibold mt-1">
                  vs {formatCurrencyIDR(prevReportData.totalExpenses)}
                </div>
              ) : (
                <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Beban OPEX umum</div>
              )}
            </div>

            {/* Net Income */}
            <div className={`kpi-card border rounded-xl p-5 shadow-xs transition-all ${
              reportData.netProfit >= 0 
                ? 'bg-emerald-50/55 border-emerald-200' 
                : 'bg-rose-50/55 border-rose-200'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">Laba Bersih (Net Income)</span>
                {prevReportData && (
                  <GrowthBadge current={reportData.netProfit} previous={prevReportData.netProfit} />
                )}
              </div>
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

          {/* Statement Report Table (Comparative Ready) */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                    <th className="p-4">Kategori Akun</th>
                    <th className="p-4 text-right">
                      {isComparisonActive ? 'Periode Berjalan' : 'Jumlah'}
                    </th>
                    {isComparisonActive && (
                      <>
                        <th className="p-4 text-right">Pembanding</th>
                        <th className="p-4 text-right">Perubahan</th>
                      </>
                    )}
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
                    {isComparisonActive && (
                      <>
                        <td className="p-4 text-right font-semibold text-gray-500">
                          {formatCurrencyIDR(prevReportData!.totalRevenue)}
                        </td>
                        <td className="p-4 text-right">
                          <GrowthBadge current={reportData.totalRevenue} previous={prevReportData!.totalRevenue} />
                        </td>
                      </>
                    )}
                  </tr>

                  {showRevenueDetail && (
                    <>
                      {reportData.revenueList.length === 0 ? (
                        <tr>
                          <td className="p-3 pl-10 text-gray-400 italic font-normal">Tidak ada transaksi pendapatan</td>
                          <td className="p-3 text-right text-gray-400">-</td>
                          {isComparisonActive && (
                            <>
                              <td className="p-3 text-right text-gray-400">-</td>
                              <td className="p-3 text-right text-gray-400">-</td>
                            </>
                          )}
                        </tr>
                      ) : (
                        reportData.revenueList.map(item => {
                          const prevBal = prevBalancesByAccount.get(item.account.id) ?? 0
                          return (
                            <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                              <td className="p-3 pl-10 text-gray-600 font-medium">
                                ({item.account.code}) {item.account.name}
                              </td>
                              <td className="p-3 text-right font-semibold text-gray-800">
                                {formatCurrencyIDR(item.balance)}
                              </td>
                              {isComparisonActive && (
                                <>
                                  <td className="p-3 text-right font-medium text-gray-500">
                                    {formatCurrencyIDR(prevBal)}
                                  </td>
                                  <td className="p-3 text-right">
                                    <GrowthBadge current={item.balance} previous={prevBal} />
                                  </td>
                                </>
                              )}
                            </tr>
                          )
                        })
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
                    {isComparisonActive && (
                      <>
                        <td className="p-4 text-right font-semibold text-rose-400">
                          ({formatCurrencyIDR(prevReportData!.totalHpp)})
                        </td>
                        <td className="p-4 text-right">
                          <GrowthBadge current={reportData.totalHpp} previous={prevReportData!.totalHpp} reversePolarity={true} />
                        </td>
                      </>
                    )}
                  </tr>

                  {showRevenueDetail && reportData.hppList.map(item => {
                    const prevBal = prevBalancesByAccount.get(item.account.id) ?? 0
                    return (
                      <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                        <td className="p-3 pl-10 text-gray-600 font-medium">
                          ({item.account.code}) {item.account.name}
                        </td>
                        <td className="p-3 text-right font-semibold text-rose-600">
                          {formatCurrencyIDR(item.balance)}
                        </td>
                        {isComparisonActive && (
                          <>
                            <td className="p-3 text-right font-medium text-rose-400">
                              {formatCurrencyIDR(prevBal)}
                            </td>
                            <td className="p-3 text-right">
                              <GrowthBadge current={item.balance} previous={prevBal} reversePolarity={true} />
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}

                  {/* GROSS PROFIT */}
                  <tr className="bg-gray-100/50 border-t border-b border-gray-200">
                    <td className="p-4 pl-6 font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">
                      Laba Kotor (Gross Profit)
                    </td>
                    <td className="p-4 text-right font-black text-gray-900 text-sm">
                      {formatCurrencyIDR(reportData.grossProfit)}
                    </td>
                    {isComparisonActive && (
                      <>
                        <td className="p-4 text-right font-extrabold text-gray-600 text-sm">
                          {formatCurrencyIDR(prevReportData!.grossProfit)}
                        </td>
                        <td className="p-4 text-right">
                          <GrowthBadge current={reportData.grossProfit} previous={prevReportData!.grossProfit} />
                        </td>
                      </>
                    )}
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
                    {isComparisonActive && (
                      <>
                        <td className="p-4 text-right font-semibold text-orange-400">
                          ({formatCurrencyIDR(prevReportData!.totalExpenses)})
                        </td>
                        <td className="p-4 text-right">
                          <GrowthBadge current={reportData.totalExpenses} previous={prevReportData!.totalExpenses} reversePolarity={true} />
                        </td>
                      </>
                    )}
                  </tr>

                  {showExpenseDetail && (
                    <>
                      {reportData.expenseList.length === 0 ? (
                        <tr>
                          <td className="p-3 pl-10 text-gray-400 italic font-normal">Tidak ada transaksi beban</td>
                          <td className="p-3 text-right text-gray-400">-</td>
                          {isComparisonActive && (
                            <>
                              <td className="p-3 text-right text-gray-400">-</td>
                              <td className="p-3 text-right text-gray-400">-</td>
                            </>
                          )}
                        </tr>
                      ) : (
                        reportData.expenseList.map(item => {
                          const prevBal = prevBalancesByAccount.get(item.account.id) ?? 0
                          return (
                            <tr key={item.account.id} className="hover:bg-gray-50/30 transition-colors">
                              <td className="p-3 pl-10 text-gray-600 font-medium">
                                ({item.account.code}) {item.account.name}
                              </td>
                              <td className="p-3 text-right font-semibold text-orange-600">
                                {formatCurrencyIDR(item.balance)}
                              </td>
                              {isComparisonActive && (
                                <>
                                  <td className="p-3 text-right font-medium text-orange-400">
                                    {formatCurrencyIDR(prevBal)}
                                  </td>
                                  <td className="p-3 text-right">
                                    <GrowthBadge current={item.balance} previous={prevBal} reversePolarity={true} />
                                  </td>
                                </>
                              )}
                            </tr>
                          )
                        })
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
                    {isComparisonActive && (
                      <>
                        <td className={`p-4 text-right text-base font-extrabold ${
                          prevReportData!.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}>
                          {formatCurrencyIDR(prevReportData!.netProfit)}
                        </td>
                        <td className="p-4 text-right">
                          <GrowthBadge current={reportData.netProfit} previous={prevReportData!.netProfit} />
                        </td>
                      </>
                    )}
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
