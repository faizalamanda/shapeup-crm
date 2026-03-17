"use client"

export function OrderStats({ orders }: { orders: any[] }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0)

  const totalOmzet = orders.reduce((acc, curr) => acc + (Number(curr.grand_total) || 0), 0)
  const pendingCount = orders.filter(o => o.status === 'processing' || o.status === 'pending').length
  const completedCount = orders.filter(o => o.status === 'completed' || o.status === 'Selesai').length

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div className="bg-white border border-slate-300 p-6 rounded shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Omzet</p>
        <p className="text-2xl font-black text-slate-800 tracking-tight">{formatIDR(totalOmzet)}</p>
      </div>
      <div className="bg-white border border-slate-300 p-6 rounded shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Perlu Diproses</p>
        <p className="text-2xl font-black text-orange-600">{pendingCount} <span className="text-sm font-bold text-slate-300 italic">Order</span></p>
      </div>
      <div className="bg-white border border-slate-300 p-6 rounded shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Selesai</p>
        <p className="text-2xl font-black text-green-600">{completedCount}</p>
      </div>
    </div>
  )
}