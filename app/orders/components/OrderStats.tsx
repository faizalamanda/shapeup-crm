export function OrderStats({ orders }: { orders: any[] }) {
  const totalOmzet = orders.reduce((acc, curr) => acc + curr.total_order, 0)
  const pending = orders.filter(o => o.status === 'Pending').length
  const completed = orders.filter(o => o.status === 'Selesai').length

  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-slate-300 rounded shadow-sm bg-white overflow-hidden mb-8">
      <div className="p-6 border-r border-slate-200">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] block mb-1">Total Omzet</label>
        <div className="text-3xl font-bold tracking-tight">{formatIDR(totalOmzet)}</div>
      </div>
      <div className="p-6 border-r border-slate-200 bg-[#fdfdfd]">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] block mb-1">Perlu Diproses</label>
        <div className="text-3xl font-bold text-orange-600 tracking-tight">{pending} <span className="text-sm font-normal text-slate-400">Order</span></div>
      </div>
      <div className="p-6">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] block mb-1">Selesai</label>
        <div className="text-3xl font-bold text-green-700 tracking-tight">{completed}</div>
      </div>
    </div>
  )
}