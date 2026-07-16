"use client"
import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { 
  formatCurrencyIDR, 
  getDateRangeLimits, 
  DateRangeKey,
  getUtcTimestamp,
} from '../utils'

type CashFlowReport = {
  startingCash: number
  endingCash: number
  netChange: number
  opsInflows: { name: string; amount: number }
  opsOutflowsSuppliers: { name: string; amount: number }
  opsOutflowsExpenses: { name: string; amount: number }
  totalOps: number
  invOutflows: { name: string; amount: number }
  totalInv: number
  finFlows: { name: string; amount: number }
  totalFin: number
}

export default function CashFlowPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [activeBizTimezone, setActiveBizTimezone] = useState<string>('Asia/Jakarta')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Aggregated state
  const [report, setReport] = useState<CashFlowReport | null>(null)

  // Date range filters
  const [dateRangeType, setDateRangeType] = useState<DateRangeKey>('this-month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

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

  // Fetch server-side cash flow summary
  const loadData = useCallback(async (businessId: string, startD: string, endD: string, timezone: string) => {
    setLoading(true)
    try {
      const startOfDayISO = getUtcTimestamp(startD, '00:00:00.000', timezone)
      const endOfDayISO = getUtcTimestamp(endD, '23:59:59.999', timezone)
      
      const { data, error } = await supabase.rpc('get_cash_flow_summary', {
        p_business_id: businessId,
        p_start_date: startOfDayISO,
        p_end_date: endOfDayISO
      })

      if (error) throw error

      const totalOpsInflow = data.ops_inflows.reduce((sum: number, item: any) => sum + item.amount, 0)
      const totalOpsOutflowSupplier = data.ops_outflows_suppliers.reduce((sum: number, item: any) => sum + item.amount, 0)
      const totalOpsOutflowExpense = data.ops_outflows_expenses.reduce((sum: number, item: any) => sum + item.amount, 0)
      const totalOps = totalOpsInflow - (totalOpsOutflowSupplier + totalOpsOutflowExpense)
      
      const totalInv = -data.inv_outflows.reduce((sum: number, item: any) => sum + item.amount, 0)
      const totalFin = data.fin_flows.reduce((sum: number, item: any) => sum + item.amount, 0)

      setReport({
        startingCash: data.starting_cash,
        endingCash: data.ending_cash,
        netChange: data.net_change,
        opsInflows: {
          name: 'Penerimaan Kas dari Pelanggan',
          amount: totalOpsInflow
        },
        opsOutflowsSuppliers: {
          name: 'Pembayaran Kas kepada Pemasok/Pembelian',
          amount: totalOpsOutflowSupplier
        },
        opsOutflowsExpenses: {
          name: 'Pembayaran Kas untuk Beban Operasional',
          amount: totalOpsOutflowExpense
        },
        totalOps,
        invOutflows: {
          name: 'Pembelian Peralatan / Aset Tetap (CAPEX)',
          amount: Math.abs(totalInv)
        },
        totalInv,
        finFlows: {
          name: 'Setoran Modal / Penarikan / Pendanaan',
          amount: totalFin
        },
        totalFin
      })
      setErrorMsg(null)
    } catch (err: any) {
      console.error('Error loading cash flow data:', err)
      setErrorMsg(err.message || 'Gagal memuat data Arus Kas')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Trigger load when dates or business changes
  useEffect(() => {
    if (activeBizId && startDate && endDate && activeBizTimezone) {
      loadData(activeBizId, startDate, endDate, activeBizTimezone)
    }
  }, [activeBizId, startDate, endDate, activeBizTimezone, loadData])

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
            Laporan Arus Kas (Cash Flow Statement)
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Laporan arus kas masuk dan kas keluar berdasarkan aktivitas operasional, investasi, dan pendanaan.
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          🖨️ Cetak Arus Kas
        </button>
      </div>

      {/* Printed Brand Header (Only shown when printing) */}
      <div className="hidden print-header">
        <h1 className="text-xl font-bold uppercase tracking-wide">{activeBizName || 'ShapeUp CRM'}</h1>
        <h2 className="text-lg font-black uppercase text-blue-600 mt-1">Laporan Arus Kas (Cash Flow)</h2>
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
          Memuat data laporan arus kas...
        </div>
      ) : errorMsg ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-xs font-semibold">
          ⚠️ {errorMsg}
        </div>
      ) : report ? (
        <div className="print-container space-y-6">

          {/* KPI Row (Waveapps style summary) */}
          <div className="kpi-grid grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            {/* Starting Cash */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Kas & Bank Awal</div>
              <div className="text-xl font-black text-gray-900 mt-1">{formatCurrencyIDR(report.startingCash)}</div>
              <div className="text-[9px] text-gray-500 font-bold mt-1.5 uppercase">Saldo sebelum {startDate}</div>
            </div>

            {/* Net Change */}
            <div className={`kpi-card border rounded-xl p-5 shadow-xs transition-all ${
              report.netChange >= 0 
                ? 'bg-emerald-50/55 border-emerald-200' 
                : 'bg-rose-50/55 border-rose-200'
            }`}>
              <div className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">Perubahan Bersih Kas</div>
              <div className={`text-xl font-black mt-1 ${
                report.netChange >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}>
                {report.netChange >= 0 ? '+' : ''}{formatCurrencyIDR(report.netChange)}
              </div>
              <div className="text-[9px] font-bold mt-1.5 uppercase">
                {report.netChange >= 0 ? '🟢 Aliran kas masuk bersih' : '🔴 Aliran kas keluar bersih'}
              </div>
            </div>

            {/* Ending Cash */}
            <div className="kpi-card bg-white border border-gray-200 rounded-xl p-5 shadow-xs transition-all">
              <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">Kas & Bank Akhir</div>
              <div className="text-xl font-black text-blue-600 mt-1">{formatCurrencyIDR(report.endingCash)}</div>
              <div className="text-[9px] text-emerald-600 font-bold mt-1.5 uppercase">Saldo per {endDate}</div>
            </div>
            
          </div>

          {/* Statement Report Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                     <th className="p-4 w-2/3">Aktivitas Aliran Kas</th>
                    <th className="p-4 text-right w-1/3">Jumlah</th>
                  </tr>
                </thead>
                <tbody className="text-xs font-semibold text-gray-700 divide-y divide-gray-100">

                  {/* ─── 1. OPERATING ACTIVITIES ─── */}
                  <tr className="bg-gray-50/40">
                    <td className="p-4 pl-8">
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Aktivitas Operasional</span>
                    </td>
                    <td className={`p-4 text-right font-extrabold text-sm ${
                      report.totalOps >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {formatCurrencyIDR(report.totalOps)}
                    </td>
                  </tr>

                  {/* Inflows */}
                  <tr className="hover:bg-gray-50/20">
                    <td className="p-3 pl-12 text-gray-700 font-bold">{report.opsInflows.name}</td>
                    <td className="p-3 text-right text-emerald-700 font-semibold">{formatCurrencyIDR(report.opsInflows.amount)}</td>
                  </tr>

                  {/* Outflows: Suppliers */}
                  <tr className="hover:bg-gray-50/20">
                    <td className="p-3 pl-12 text-gray-700 font-bold">{report.opsOutflowsSuppliers.name}</td>
                    <td className="p-3 text-right text-rose-600 font-semibold">({formatCurrencyIDR(report.opsOutflowsSuppliers.amount)})</td>
                  </tr>

                  {/* Outflows: Expenses */}
                  <tr className="hover:bg-gray-50/20">
                    <td className="p-3 pl-12 text-gray-700 font-bold">{report.opsOutflowsExpenses.name}</td>
                    <td className="p-3 text-right text-rose-600 font-semibold">({formatCurrencyIDR(report.opsOutflowsExpenses.amount)})</td>
                  </tr>

                  {/* ─── 2. INVESTING ACTIVITIES ─── */}
                  <tr className="bg-gray-50/40 border-t border-gray-200">
                    <td className="p-4 pl-8">
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Aktivitas Investasi</span>
                    </td>
                    <td className={`p-4 text-right font-extrabold text-sm ${
                      report.totalInv >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {report.totalInv < 0 ? `(${formatCurrencyIDR(Math.abs(report.totalInv))})` : formatCurrencyIDR(report.totalInv)}
                    </td>
                  </tr>

                  <tr className="hover:bg-gray-50/20">
                    <td className="p-3 pl-12 text-gray-700 font-bold">{report.invOutflows.name}</td>
                    <td className="p-3 text-right text-rose-600 font-semibold">({formatCurrencyIDR(report.invOutflows.amount)})</td>
                  </tr>

                  {/* ─── 3. FINANCING ACTIVITIES ─── */}
                  <tr className="bg-gray-50/40 border-t border-gray-200">
                    <td className="p-4 pl-8">
                      <span className="font-extrabold text-gray-800 uppercase tracking-wider text-[11px]">Aktivitas Pendanaan</span>
                    </td>
                    <td className={`p-4 text-right font-extrabold text-sm ${
                      report.totalFin >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {formatCurrencyIDR(report.totalFin)}
                    </td>
                  </tr>

                  <tr className="hover:bg-gray-50/20">
                    <td className="p-3 pl-12 text-gray-700 font-bold">{report.finFlows.name}</td>
                    <td className={`p-3 text-right font-semibold ${
                      report.finFlows.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {formatCurrencyIDR(report.finFlows.amount)}
                    </td>
                  </tr>

                  {/* ─── STATEMENT RECONCILIATION SUMMARY ─── */}
                  <tr className="bg-gray-100/30 border-t-2 border-gray-300 font-bold text-gray-800">
                    <td className="p-4 pl-6 uppercase tracking-wider text-[11px]">Kenaikan / (Penurunan) Kas Bersih</td>
                    <td className={`p-4 text-right text-sm ${
                      report.netChange >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {report.netChange >= 0 ? '+' : ''}{formatCurrencyIDR(report.netChange)}
                    </td>
                  </tr>

                  <tr className="hover:bg-gray-50/10 font-bold text-gray-600">
                    <td className="p-3 pl-8">Saldo Kas Awal Periode</td>
                    <td className="p-3 text-right text-gray-800">{formatCurrencyIDR(report.startingCash)}</td>
                  </tr>

                  <tr className="bg-gray-100/40 border-t border-b border-gray-300 font-black text-sm">
                    <td className="p-4 pl-6 uppercase tracking-wider text-gray-900">Saldo Kas Akhir Periode</td>
                    <td className="p-4 text-right text-blue-600 text-base">{formatCurrencyIDR(report.endingCash)}</td>
                  </tr>

                </tbody>
              </table>
            </div>
          </div>

          {/* Validation Alert */}
          <div className="bg-blue-50 border border-blue-100 text-blue-800 rounded-xl p-4 text-[10px] uppercase font-bold tracking-wider text-center no-print">
            ✓ Rekonsiliasi: Saldo Kas Awal ({formatCurrencyIDR(report.startingCash)}) + Perubahan Kas ({formatCurrencyIDR(report.netChange)}) = Saldo Kas Akhir ({formatCurrencyIDR(report.endingCash)})
          </div>

        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">
          Tidak ada data untuk ditampilkan
        </div>
      )}
    </div>
  )
}
