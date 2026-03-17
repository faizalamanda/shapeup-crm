export function CustomerTable({ customers, onSelect }: { customers: any[], onSelect: (c: any) => void }) {
  const formatIDR = (val: number) => new Intl.NumberFormat('id-ID').format(val || 0)

  return (
    <div className="bg-white border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-black text-white text-[10px] font-black uppercase tracking-widest">
            <th className="p-5 border-r border-white/10">Pelanggan</th>
            <th className="p-5 border-r border-white/10 text-center">Order</th>
            <th className="p-5 border-r border-white/10 text-right">LTV (Total)</th>
            <th className="p-5 border-r border-white/10 text-right">AOV (Avg)</th>
            <th className="p-5 text-right uppercase">Terakhir Order</th>
          </tr>
        </thead>
        <tbody className="divide-y-2 divide-slate-100">
          {customers.map((c) => (
            <tr key={c.customer_id} className="hover:bg-yellow-50 transition-colors group cursor-pointer" onClick={() => onSelect(c)}>
              <td className="p-5">
                <p className="font-black text-slate-800 uppercase leading-none mb-1">{c.customer_name}</p>
                <p className="text-xs font-bold text-slate-400">+{c.phone}</p>
              </td>
              <td className="p-5 text-center">
                <span className="bg-slate-900 text-white px-3 py-1 text-[10px] font-black italic">
                  {(c.total_order_count || 0)}x
                </span>
              </td>
              <td className="p-5 text-right font-black text-slate-800">
                Rp {formatIDR(c.ltv)}
              </td>
              <td className="p-5 text-right font-black text-blue-600">
                Rp {formatIDR(c.aov)}
              </td>
              <td className="p-5 text-right text-xs font-bold text-slate-400">
                {c.last_order_date ? new Date(c.last_order_date).toLocaleDateString('id-ID') : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}