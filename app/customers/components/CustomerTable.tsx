export function CustomerTable({ customers, onSelect }: { customers: any[], onSelect: (c: any) => void }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-hidden">
      <table className="w-full text-left border-collapse font-sans text-sm">
        <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[10px] uppercase text-slate-500 font-bold tracking-widest">
          <tr>
            <th className="px-8 py-4">Nama & Kontak</th>
            <th className="px-8 py-4 text-center">Repeat</th>
            <th className="px-8 py-4">LTV / AOV</th>
            <th className="px-8 py-4 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {customers.map((c) => (
            <tr key={c.id} className="hover:bg-[#fffdf0] cursor-pointer group" onClick={() => onSelect(c)}>
              <td className="px-8 py-5">
                <div className="font-bold text-blue-700 group-hover:underline flex items-center gap-2">
                  {c.name}
                  {c.category === 'VIP' && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">VIP</span>}
                </div>
                <div className="text-xs text-slate-500 mt-1">{c.phone}</div>
              </td>
              <td className="px-8 py-5 text-center">
                <div className={`font-bold ${c.order_count > 1 ? 'text-green-600' : 'text-slate-400'}`}>
                  {c.order_count}x
                </div>
              </td>
              <td className="px-8 py-5 text-slate-700">
                <div className="font-bold">{formatIDR(c.ltv)}</div>
                <div className="text-[10px] text-slate-400 uppercase tracking-tighter font-bold">AOV: {formatIDR(c.ltv / c.order_count)}</div>
              </td>
              <td className="px-8 py-5 text-right">
                <a href={`https://wa.me/${c.phone}`} target="_blank" onClick={(e) => e.stopPropagation()} className="inline-block bg-[#25D366] text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest">WA</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}