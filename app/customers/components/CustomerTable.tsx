export function CustomerTable({ customers, onSelect }: { customers: any[], onSelect: (c: any) => void }) {
  const formatIDR = (val: number) => new Intl.NumberFormat('id-ID').format(Math.round(val || 0))

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-[#F8FAFC] border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <th className="p-5">Nama Pelanggan</th>
            <th className="p-5">Order</th>
            <th className="p-5 text-right">LTV</th>
            <th className="p-5 text-right">AOV</th>
            <th className="p-5 text-center">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {customers.map((c, idx) => (
            <tr 
              key={idx} 
              className="hover:bg-slate-50/50 transition-colors cursor-pointer group"
              onClick={() => onSelect(c)} // <--- INI PEMICUNYA
            >
              <td className="p-5 font-bold text-blue-700">{c.name}</td>
              <td className="p-5 text-center font-bold text-slate-700">{c.total_order_count || 0}</td>
              <td className="p-5 text-right font-bold text-slate-800 text-sm">Rp {formatIDR(c.ltv)}</td>
              <td className="p-5 text-right font-bold text-slate-800 text-sm">Rp {formatIDR(c.aov)}</td>
              <td className="p-5 text-center">
                <button className="bg-[#22C55E] text-white px-3 py-1 rounded text-[10px] font-bold uppercase">WA</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}