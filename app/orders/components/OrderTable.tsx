export function OrderTable({ orders }: { orders: any[] }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  const statusColor: any = {
    'Selesai': 'bg-green-50 text-green-700 border-green-200',
    'Pending': 'bg-orange-50 text-orange-700 border-orange-200',
    'Batal': 'bg-red-50 text-red-700 border-red-200'
  }

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-x-auto">
      <table className="w-full text-left border-collapse font-sans">
        <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[10px] uppercase text-slate-500 font-bold tracking-widest">
          <tr>
            <th className="px-6 py-3">ID Order</th>
            <th className="px-6 py-3">Pelanggan</th>
            <th className="px-6 py-3">Tanggal</th>
            <th className="px-6 py-3 text-center">Status</th>
            <th className="px-6 py-3 text-right">Total Tagihan</th>
            <th className="px-6 py-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-sm">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-[#fffdf0] cursor-pointer transition-colors">
              <td className="px-6 py-3 font-bold text-slate-900">#{o.id}</td>
              <td className="px-6 py-3 font-bold text-blue-700">{o.customer_name}</td>
              <td className="px-6 py-3 text-slate-500">{o.date}</td>
              <td className="px-6 py-3 text-center">
                <span className={`text-[9px] px-2 py-0.5 rounded border font-black uppercase tracking-tighter ${statusColor[o.status]}`}>
                  {o.status}
                </span>
              </td>
              <td className="px-6 py-3 text-right font-black text-slate-800">{formatIDR(o.total_amount)}</td>
              <td className="px-6 py-3 text-right">
                <button className="text-[10px] font-bold text-slate-400 hover:text-blue-600 uppercase tracking-widest">Detail ↗</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}