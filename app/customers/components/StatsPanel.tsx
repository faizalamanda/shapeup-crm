export function StatsPanel({ customers }: { customers: any[] }) {
  const formatIDR = (val: number) => new Intl.NumberFormat('id-ID').format(Math.round(val || 0))
  
  const totalLTV = customers.reduce((acc, curr) => acc + (Number(curr.ltv) || 0), 0)
  const avgLTV = customers.length > 0 ? totalLTV / customers.length : 0
  const repeatRate = customers.length > 0 
    ? (customers.filter(c => (c.total_order_count || 0) > 1).length / customers.length) * 100 
    : 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-0 bg-white border border-slate-200 rounded-xl overflow-hidden mb-8 shadow-sm">
      <div className="p-8 border-r border-slate-100">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Total Customer</p>
        <div className="flex items-baseline gap-2">
          <p className="text-4xl font-bold text-slate-800">{customers.length}</p>
          <p className="text-slate-400 font-medium">Orang</p>
        </div>
      </div>
      
      <div className="p-8 border-r border-slate-100">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Repeat Order Rate</p>
        <p className="text-4xl font-bold text-blue-600">{repeatRate.toFixed(1)}%</p>
      </div>
      
      <div className="p-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Rata-Rata LTV</p>
        <p className="text-4xl font-bold text-slate-800">Rp {formatIDR(avgLTV)}</p>
      </div>
    </div>
  )
}