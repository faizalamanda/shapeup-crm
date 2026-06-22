export function StatsPanel({ customers }: { customers: any[] }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(val || 0))

  const totalCustomers = customers.length
  
  // Total Revenue for this segment is the sum of LTV
  const totalRevenue = customers.reduce((acc, curr) => acc + (Number(curr.ltv) || 0), 0)
  
  // Avg LTV
  const avgLTV = totalCustomers > 0 ? totalRevenue / totalCustomers : 0
  
  // Avg AOV
  const customersWithOrders = customers.filter(c => (c.total_order_count || 0) > 0)
  const avgAOV = customersWithOrders.length > 0 
    ? customersWithOrders.reduce((acc, curr) => acc + (Number(curr.aov) || 0), 0) / customersWithOrders.length 
    : 0

  // Repeat Customer Rate
  const repeatRate = totalCustomers > 0 
    ? (customers.filter(c => (c.total_order_count || 0) > 1).length / totalCustomers) * 100 
    : 0

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
      {/* Total Customers */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Total Customer</p>
        <div className="flex items-baseline gap-1.5">
          <p className="text-3xl font-black text-slate-900">{totalCustomers.toLocaleString('id-ID')}</p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Orang</p>
        </div>
        <p className="text-[9px] text-slate-400 font-medium mt-1">Dalam segmen aktif</p>
      </div>
      
      {/* Total Revenue Segment */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Omset Segmen (LTV)</p>
        <p className="text-xl font-black text-blue-600 truncate" title={formatIDR(totalRevenue)}>
          {formatIDR(totalRevenue)}
        </p>
        <p className="text-[9px] text-slate-400 font-medium mt-2">Akumulasi seluruh belanja</p>
      </div>

      {/* Rata-Rata LTV */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Rata-Rata LTV</p>
        <p className="text-xl font-black text-slate-900 truncate" title={formatIDR(avgLTV)}>
          {formatIDR(avgLTV)}
        </p>
        <p className="text-[9px] text-slate-400 font-medium mt-2">Nilai per pelanggan</p>
      </div>

      {/* Rata-Rata AOV */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Rata-Rata AOV</p>
        <p className="text-xl font-black text-slate-900 truncate" title={formatIDR(avgAOV)}>
          {formatIDR(avgAOV)}
        </p>
        <p className="text-[9px] text-slate-400 font-medium mt-2">Nilai per transaksi</p>
      </div>

      {/* Repeat Order Rate */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow col-span-2 md:col-span-1">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Repeat Order Rate</p>
        <p className="text-3xl font-black text-emerald-600">
          {repeatRate.toFixed(1)}%
        </p>
        <p className="text-[9px] text-slate-400 font-medium mt-1">Membeli lebih dari sekali</p>
      </div>
    </div>
  )
}