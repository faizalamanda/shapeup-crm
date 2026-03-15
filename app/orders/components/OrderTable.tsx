"use client"

export function OrderTable({ orders }: { orders: any[] }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  const statusColor: any = {
    'Selesai': 'bg-green-50 text-green-700 border-green-200',
    'Pending': 'bg-orange-50 text-orange-700 border-orange-200',
    'Batal': 'bg-red-50 text-red-700 border-red-200',
    'Proses': 'bg-blue-50 text-blue-700 border-blue-200'
  }

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse font-sans min-w-[1600px]">
          <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[9px] uppercase text-slate-500 font-bold tracking-widest whitespace-nowrap text-center">
            <tr>
              <th className="px-4 py-3 sticky left-0 bg-[#f8f9fa] border-r border-slate-200 z-10">ID</th>
              <th className="px-4 py-3 sticky left-[52px] bg-[#f8f9fa] border-r border-slate-200 z-10 text-left">Nama</th>
              <th className="px-4 py-3">Tanggal & Jam</th>
              <th className="px-4 py-3 text-left">No WA</th>
              <th className="px-4 py-3 text-left">Items (Qty)</th>
              <th className="px-4 py-3">Total Qty</th>
              <th className="px-4 py-3 text-right">Subtotal</th>
              <th className="px-4 py-3 text-right">Ongkir</th>
              <th className="px-4 py-3 text-right text-red-500 font-black">Diskon</th>
              <th className="px-4 py-3 text-right">Biaya Lain</th>
              <th className="px-4 py-3 text-right bg-slate-50 border-x border-slate-200">Total Order</th>
              <th className="px-4 py-3">Metode Pembayaran</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Follow Up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[11px] text-center">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-[#fffdf0] transition-colors group">
                <td className="px-4 py-2 sticky left-0 bg-white group-hover:bg-[#fffdf0] border-r border-slate-100 font-bold text-slate-400">#{o.id}</td>
                <td className="px-4 py-2 sticky left-[52px] bg-white group-hover:bg-[#fffdf0] border-r border-slate-100 font-bold text-blue-700 text-left whitespace-nowrap">{o.customer_name}</td>
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{o.datetime}</td>
                <td className="px-4 py-2 font-medium text-slate-600 text-left">{o.wa_number}</td>
                <td className="px-4 py-2 text-slate-500 text-left truncate max-w-[200px]" title={o.items_detail}>{o.items_detail}</td>
                <td className="px-4 py-2 font-bold">{o.total_qty}</td>
                <td className="px-4 py-2 text-right">{formatIDR(o.subtotal)}</td>
                <td className="px-4 py-2 text-right">{formatIDR(o.shipping)}</td>
                <td className="px-4 py-2 text-right text-red-500">-{formatIDR(o.discount)}</td>
                <td className="px-4 py-2 text-right">{formatIDR(o.other_fee)}</td>
                <td className="px-4 py-2 text-right font-black text-slate-900 bg-slate-50 group-hover:bg-yellow-50 border-x border-slate-200">{formatIDR(o.total_order)}</td>
                <td className="px-4 py-2 font-bold text-slate-500 uppercase text-[9px]">{o.payment_method}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded border font-black uppercase text-[8px] tracking-tighter ${statusColor[o.status]}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <a href={`https://wa.me/${o.wa_number}`} target="_blank" className="inline-block bg-[#25D366] text-white p-1 rounded-sm hover:scale-110 transition-transform">💬</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}