export function StatsPanel({ customers }: { customers: any[] }) {
  const formatIDR = (val: number) => new Intl.NumberFormat('id-ID').format(val || 0)
  
  const totalLTV = customers.reduce((acc, curr) => acc + (Number(curr.ltv) || 0), 0)
  const avgLTV = customers.length > 0 ? totalLTV / customers.length : 0
  const repeatRate = customers.length > 0 
    ? (customers.filter(c => (c.total_order_count || 0) > 1).length / customers.length) * 100 
    : 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div className="bg-white border-4 border-black p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total LTV</p>
        <p className="text-2xl font-black italic">Rp {formatIDR(totalLTV)}</p>
      </div>
      <div className="bg-white border-4 border-black p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Avg. LTV / Cust</p>
        <p className="text-2xl font-black italic">Rp {formatIDR(avgLTV)}</p>
      </div>
      <div className="bg-[#2e8540] border-4 border-black p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-2">Repeat Order Rate</p>
        <p className="text-2xl font-black italic text-white">{repeatRate.toFixed(1)}%</p>
      </div>
    </div>
  )
}