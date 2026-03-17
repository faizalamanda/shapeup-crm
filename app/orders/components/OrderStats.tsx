"use client"

export function OrderStats({ orders }: { orders: any[] }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0)

  // Perhitungan Omzet yang aman dari NaN
  const totalOmzet = orders.reduce((acc, curr) => acc + (Number(curr.grand_total || curr.total_amount) || 0), 0)
  const totalOrders = orders.length
  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'processing').length

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div className="bg-white border border-slate-300 p-6 rounded shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total Omzet</p>
        <p className="text-2xl font-black text-slate-800">{formatIDR(totalOmzet)}</p>
      </div>
      <div className="bg-white border border-slate-300 p-6 rounded shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total Pesanan</p>
        <p className="text-2xl font-black text-slate-800">{totalOrders} <span className="text-sm font-bold text-slate-400 italic">Transaksi</span></p>
      </div>
      <div className="bg-white border border-slate-300 p-6 rounded shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Perlu Diproses</p>
        <p className="text-2xl font-black text-orange-600">{pendingOrders} <span className="text-sm font-bold text-orange-300 italic">Pesanan</span></p>
      </div>
    </div>
  )
}