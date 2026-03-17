"use client"

export function OrderTable({ orders, onSelectOrder }: { orders: any[], onSelectOrder: (o: any) => void }) {
  const formatIDR = (val: any) => {
    const num = Number(val) || 0
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num)
  }

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1600px]">
          <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[9px] uppercase text-slate-500 font-bold tracking-widest text-center whitespace-nowrap">
            <tr>
              <th className="px-4 py-3 sticky left-0 bg-[#f8f9fa] border-r border-slate-200 z-10">ID Order</th>
              <th className="px-4 py-3 sticky left-[75px] bg-[#f8f9fa] border-r border-slate-200 z-10 text-left">Nama Pelanggan</th>
              <th className="px-4 py-3">Tanggal</th>
              <th className="px-4 py-3 text-left">Item Produk</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3 text-right">Subtotal</th>
              <th className="px-4 py-3 text-right">Ongkir</th>
              <th className="px-4 py-3 text-right text-red-500 font-black">Diskon</th>
              <th className="px-4 py-3 text-right bg-slate-50 border-x border-slate-200">Total Order</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[11px] text-center">
            {orders.map((o) => (
              <tr 
                key={o.id} 
                className="hover:bg-[#fffdf0] transition-colors cursor-pointer group"
                onClick={() => onSelectOrder(o)}
              >
                <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-[#fffdf0] border-r border-slate-100 font-bold text-slate-400 text-center">
                  #{o.order_number || o.id.toString().substring(0,6)}
                </td>
                <td className="px-4 py-3 sticky left-[75px] bg-white group-hover:bg-[#fffdf0] border-r border-slate-100 font-bold text-blue-700 text-left whitespace-nowrap">
                  {o.customer?.name || 'No Name'}
                </td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {o.order_date ? new Date(o.order_date).toLocaleDateString('id-ID') : '-'}
                </td>
                <td className="px-4 py-3 text-left">
                  <div className="flex flex-col gap-0.5 max-w-[250px]">
                    {o.items_json?.map((item: any, i: number) => (
                      <p key={i} className="truncate text-slate-600 font-medium">
                        <span className="text-[9px] bg-slate-100 px-1 rounded mr-1 font-black">{item.quantity}x</span> 
                        {item.name}
                      </p>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 font-bold">{o.total_qty || 0}</td>
                <td className="px-4 py-3 text-right">{formatIDR(o.subtotal)}</td>
                <td className="px-4 py-3 text-right">{formatIDR(o.shipping_cost)}</td>
                <td className="px-4 py-3 text-right text-red-500">-{formatIDR(o.discount_amount)}</td>
                <td className="px-4 py-3 text-right font-black text-slate-900 bg-slate-50 group-hover:bg-yellow-50 border-x border-slate-200">
                  {formatIDR(o.grand_total)}
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded border font-black uppercase text-[8px] bg-slate-100 text-slate-500">
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <a href={`https://wa.me/${o.customer?.phone}`} target="_blank" className="bg-[#25D366] text-white p-1.5 rounded-full hover:scale-110 inline-block transition-transform shadow-sm">💬</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}