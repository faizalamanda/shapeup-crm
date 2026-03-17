"use client"

export function OrderTable({ orders }: { orders: any[] }) {
  const formatIDR = (val: any) => {
    const num = Number(val) || 0
    return new Intl.NumberFormat('id-ID', { 
      style: 'currency', 
      currency: 'IDR', 
      maximumFractionDigits: 0 
    }).format(num)
  }

  const statusColor: any = {
    'completed': 'bg-green-50 text-green-700 border-green-200',
    'processing': 'bg-blue-50 text-blue-700 border-blue-200',
    'pending': 'bg-orange-50 text-orange-700 border-orange-200',
    'cancelled': 'bg-red-50 text-red-700 border-red-200',
    'on-hold': 'bg-slate-50 text-slate-700 border-slate-200',
    'Selesai': 'bg-green-50 text-green-700 border-green-200'
  }

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse font-sans min-w-[1600px]">
          <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[9px] uppercase text-slate-500 font-bold tracking-widest whitespace-nowrap text-center">
            <tr>
              <th className="px-4 py-3 sticky left-0 bg-[#f8f9fa] border-r border-slate-200 z-10">ID</th>
              <th className="px-4 py-3 sticky left-[52px] bg-[#f8f9fa] border-r border-slate-200 z-10 text-left">Nama</th>
              <th className="px-4 py-3">Tanggal</th>
              <th className="px-4 py-3 text-left">No WA</th>
              <th className="px-4 py-3 text-left">Items Detail</th>
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
                  #{o.order_id || o.id.toString().substring(0,5)}
                </td>
                <td className="px-4 py-2 sticky left-[52px] bg-white group-hover:bg-[#fffdf0] border-r border-slate-100 font-bold text-blue-700 text-left whitespace-nowrap">
                  {/* Fallback Nama */}
                  {o.customer_name || o.billing_first_name || 'Pelanggan'}
                </td>
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                  {o.created_at ? new Date(o.created_at).toLocaleDateString('id-ID') : '-'}
                </td>
                <td className="px-4 py-2 font-medium text-slate-600 text-left">
                  {o.phone || o.billing_phone || o.wa_number || '-'}
                </td>
                <td className="px-4 py-2 text-slate-500 text-left truncate max-w-[200px]" title={o.items_summary}>
                  {o.items_summary || '-'}
                </td>
                <td className="px-4 py-2 font-bold">{o.total_qty || 0}</td>
                <td className="px-4 py-2 text-right">{formatIDR(o.subtotal)}</td>
                <td className="px-4 py-2 text-right">{formatIDR(o.shipping_total)}</td>
                <td className="px-4 py-2 text-right text-red-500">-{formatIDR(o.discount_total)}</td>
                <td className="px-4 py-2 text-right font-black text-slate-900 bg-slate-50 group-hover:bg-yellow-50 border-x border-slate-200">
                  {/* Fallback Total */}
                  {formatIDR(o.grand_total || o.total_amount)}
                </td>
                <td className="px-4 py-2 font-bold text-slate-500 uppercase text-[9px]">
                  {o.payment_method_title || o.payment_method || '-'}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded border font-black uppercase text-[8px] tracking-tighter ${statusColor[o.status] || 'bg-slate-50'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <a href={`https://wa.me/${o.phone || o.billing_phone || o.wa_number}`} target="_blank" className="inline-block bg-[#25D366] text-white p-1 rounded-sm hover:scale-110 transition-transform">💬</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}