"use client"

export function OrderTable({ orders }: { orders: any[] }) {
  const formatIDR = (val: any) => {
    const num = Number(val) || 0
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num)
  }

  const statusColor: any = {
    'completed': 'bg-green-50 text-green-700 border-green-200',
    'processing': 'bg-blue-50 text-blue-700 border-blue-200',
    'pending': 'bg-orange-50 text-orange-700 border-orange-200',
    'cancelled': 'bg-red-50 text-red-700 border-red-200',
    'on-hold': 'bg-slate-50 text-slate-700 border-slate-200'
  }

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1600px]">
          <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[9px] uppercase text-slate-500 font-bold tracking-widest text-center">
            <tr>
              <th className="px-4 py-3 sticky left-0 bg-[#f8f9fa] border-r border-slate-200 z-10">ID</th>
              <th className="px-4 py-3 sticky left-[52px] bg-[#f8f9fa] border-r border-slate-200 z-10 text-left">Nama</th>
              <th className="px-4 py-3">Tanggal</th>
              <th className="px-4 py-3 text-left">No WA</th>
              <th className="px-4 py-3 text-left">Items</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3 text-right">Subtotal</th>
              <th className="px-4 py-3 text-right">Ongkir</th>
              <th className="px-4 py-3 text-right text-red-500 font-black">Diskon</th>
              <th className="px-4 py-3 text-right bg-slate-50 border-x border-slate-200">Total Order</th>
              <th className="px-4 py-3">Metode</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[11px] text-center">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-[#fffdf0] transition-colors group">
                <td className="px-4 py-2 sticky left-0 bg-white group-hover:bg-[#fffdf0] border-r border-slate-100 font-bold text-slate-400">
                  #{o.order_number || o.id.toString().substring(0,5)}
                </td>
                
                {/* NAMA DARI JOIN TABLE CUSTOMER */}
                <td className="px-4 py-2 sticky left-[52px] bg-white group-hover:bg-[#fffdf0] border-r border-slate-100 font-bold text-blue-700 text-left whitespace-nowrap">
                  {o.customer?.name || 'Pelanggan'}
                </td>

                <td className="px-4 py-2 text-slate-500">
                  {o.order_date ? new Date(o.order_date).toLocaleDateString('id-ID') : '-'}
                </td>
                
                {/* WA DARI JOIN TABLE CUSTOMER */}
                <td className="px-4 py-2 text-left font-medium">
                  {o.customer?.phone || '-'}
                </td>

                <td className="px-4 py-2 text-left truncate max-w-[200px]" title="Detail Pesanan">
                  {o.items_json ? "Cek Detail..." : "-"}
                </td>
                
                <td className="px-4 py-2 font-bold">{o.total_qty || 0}</td>
                <td className="px-4 py-2 text-right">{formatIDR(o.subtotal)}</td>
                
                {/* KOLOM SESUAI DATABASE: shipping_cost */}
                <td className="px-4 py-2 text-right">{formatIDR(o.shipping_cost)}</td>
                
                {/* KOLOM SESUAI DATABASE: discount_amount */}
                <td className="px-4 py-2 text-right text-red-500">-{formatIDR(o.discount_amount)}</td>
                
                {/* TOTAL ORDER: grand_total */}
                <td className="px-4 py-2 text-right font-black text-slate-900 bg-slate-50 group-hover:bg-yellow-50 border-x border-slate-200">
                  {formatIDR(o.grand_total)}
                </td>

                <td className="px-4 py-2 font-bold text-slate-500 uppercase text-[9px]">
                  {o.payment_method || '-'}
                </td>

                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded border font-black uppercase text-[8px] tracking-tighter ${statusColor[o.status] || 'bg-slate-100'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {o.customer?.phone && (
                    <a href={`https://wa.me/${o.customer.phone}`} target="_blank" className="bg-[#25D366] text-white p-1 rounded hover:scale-110 inline-block transition-transform">💬</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}