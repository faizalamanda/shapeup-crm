"use client"

export function CustomerTable({ customers, onSelect }: { customers: any[], onSelect: (c: any) => void }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  const copyToClipboard = (e: React.MouseEvent, text: string) => {
    e.stopPropagation(); 
    navigator.clipboard.writeText(text);
    alert("Nomor WA berhasil disalin!");
  };

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-hidden">
      <table className="w-full text-left border-collapse font-sans text-sm">
        <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[10px] uppercase text-slate-500 font-bold tracking-widest text-center">
          <tr>
            <th className="px-8 py-4 text-left">Nama & Kontak</th>
            <th className="px-8 py-4">Repeat</th>
            <th className="px-8 py-4">LTV / AOV</th>
            <th className="px-8 py-4 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-center">
          {customers.map((c) => (
            <tr key={c.id} className="hover:bg-[#fffdf0] cursor-pointer group transition-colors" onClick={() => onSelect(c)}>
              <td className="px-8 py-5 text-left">
                <div className="font-bold text-blue-700 group-hover:underline flex items-center gap-2">
                  {c.name}
                  {c.category === 'VIP' && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200 font-black uppercase tracking-tighter">VIP</span>}
                </div>
                <div className="flex items-center gap-2 text-slate-500 mt-1">
                  <span className="text-xs">{c.phone}</span>
                  <button 
                    onClick={(e) => copyToClipboard(e, c.phone)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded transition-all"
                    title="Salin Nomor"
                  >
                    📋
                  </button>
                </div>
              </td>
              <td className="px-8 py-5">
                <div className={`font-bold ${c.order_count > 1 ? 'text-green-600' : 'text-slate-400'}`}>
                  {c.order_count}x
                </div>
              </td>
              <td className="px-8 py-5">
                <div className="font-bold text-slate-800">{formatIDR(c.ltv)}</div>
                {/* AOV Dibuat Lebih Kontras */}
                <div className="text-[11px] text-slate-600 uppercase tracking-tighter font-bold mt-0.5">
                  AOV: <span className="text-slate-900">{formatIDR(c.ltv / c.order_count)}</span>
                </div>
              </td>
              <td className="px-8 py-5 text-right">
                <a 
                  href={`https://wa.me/${c.phone}`} 
                  target="_blank" 
                  onClick={(e) => e.stopPropagation()} 
                  className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest shadow-sm transition-colors"
                >
                  <span>💬</span> WA
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}