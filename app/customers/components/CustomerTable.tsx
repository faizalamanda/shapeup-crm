export function CustomerTable({ customers }: { customers: any[] }) {
  const formatIDR = (val: number) => new Intl.NumberFormat('id-ID').format(Math.round(val || 0))

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-[#F8FAFC] border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <th className="p-5">Nama Pelanggan</th>
            <th className="p-5">Tipe</th>
            <th className="p-5">Whatsapp</th>
            <th className="p-5 text-center">Order</th>
            <th className="p-5 text-right">LTV</th>
            <th className="p-5 text-right">AOV</th>
            <th className="p-5 text-center">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {customers.map((c, idx) => (
            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
              <td className="p-5 font-bold text-blue-700">{c.name}</td>
              <td className="p-5">
                <span className="text-[9px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-500 uppercase tracking-tighter">
                  {c.category || 'GENERAL'}
                </span>
              </td>
              <td className="p-5 text-slate-500 font-medium">{c.phone}</td>
              <td className="p-5 text-center font-bold text-slate-700">
                {/* PAKAI total_order_count DARI DB */}
                {c.total_order_count || 0}
              </td>
              <td className="p-5 text-right font-bold text-slate-800">
                Rp {formatIDR(c.ltv)}
              </td>
              <td className="p-5 text-right font-bold text-slate-800">
                {/* PAKAI aov DARI DB AGAR TIDAK NaN */}
                Rp {formatIDR(c.aov)}
              </td>
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