export function StatsPanel({ customers }: { customers: any[] }) {
  const total = customers.length
  const repeatUsers = customers.filter(c => c.order_count > 1).length
  const repeatRate = total > 0 ? (repeatUsers / total) * 100 : 0
  const totalLTV = customers.reduce((acc, curr) => acc + curr.ltv, 0)
  const avgLTV = total > 0 ? totalLTV / total : 0

  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-slate-300 rounded shadow-sm bg-white overflow-hidden mb-8">
      <div className="p-6 border-r border-slate-200">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] block mb-1">Total Customer</label>
        <div className="text-3xl font-bold text-slate-800 tracking-tight">{total} <span className="text-sm font-normal text-slate-400">Orang</span></div>
      </div>
      <div className="p-6 border-r border-slate-200 bg-[#fdfdfd]">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] block mb-1">Repeat Order Rate</label>
        <div className="text-3xl font-bold text-blue-600 tracking-tight">{repeatRate.toFixed(1)}%</div>
      </div>
      <div className="p-6">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] block mb-1">Rata-rata LTV</label>
        <div className="text-3xl font-bold text-slate-800 tracking-tight">{formatIDR(avgLTV)}</div>
      </div>
    </div>
  )
}