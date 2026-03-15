"use client"

export function CustomerTable({ customers, onSelect }: { customers: any[], onSelect: (c: any) => void }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  const copyToClipboard = (e: React.MouseEvent, text: string) => {
    e.stopPropagation(); 
    navigator.clipboard.writeText(text);
    alert("Nomor WA disalin!");
  };

  return (
    <div className="bg-white border border-slate-300 shadow-sm rounded overflow-x-auto">
      <table className="w-full text-left border-collapse font-sans">
        <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[10px] uppercase text-slate-500 font-bold tracking-widest">
          <tr>
            <th className="px-6 py-3 min-w-[200px]">Nama Pelanggan</th>
            <th className="px-4 py-3 text-center">Tipe</th>
            <th className="px-6 py-3">WhatsApp</th>
            <th className="px-4 py-3 text-center">Order</th>
            <th className="px-6 py-3 text-right">LTV</th>
            <th className="px-6 py-3 text-right">AOV</th>
            <th className="px-6 py-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-sm">
          {customers.map((c) => (
            <tr 
              key={c.id} 
              className="hover:bg-[#fffdf0] cursor-pointer group transition-colors" 
              onClick={() => onSelect(c)}
            >
              {/* NAMA */}
              <td className="px-6 py-3 font-bold text-blue-700 truncate max-w-[200px]">
                {c.name}
              </td>

              {/* TIPE / KATEGORI */}
              <td className="px-4 py-3 text-center">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border font-black uppercase tracking-tighter ${
                  c.category === 'VIP' 
                  ? 'bg-yellow-50 text-yellow-700 border-yellow-200' 
                  : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}>
                  {c.category}
                </span>
              </td>

              {/* WHATSAPP + COPY */}
              <td className="px-6 py-3 text-slate-500 font-medium whitespace-nowrap">
                <div className="flex items-center gap-2 group/wa">
                  <span>{c.phone}</span>
                  <button 
                    onClick={(e) => copyToClipboard(e, c.phone)}
                    className="opacity-0 group-hover/wa:opacity-100 p-0.5 hover:bg-slate-200 rounded transition-all"
                  >
                    📋
                  </button>
                </div>
              </td>

              {/* JUMLAH ORDER */}
              <td className="px-4 py-3 text-center font-bold text-slate-600">
                {c.order_count}x
              </td>

              {/* LTV */}
              <td className="px-6 py-3 text-right font-bold text-slate-800 whitespace-nowrap">
                {formatIDR(c.ltv)}
              </td>

              {/* AOV (Satu Baris, Kontras) */}
              <td className="px-6 py-3 text-right font-bold text-slate-600 whitespace-nowrap">
                {formatIDR(c.ltv / c.order_count)}
              </td>

              {/* AKSI */}
              <td className="px-6 py-3 text-right">
                <a 
                  href={`https://wa.me/${c.phone}`} 
                  target="_blank" 
                  onClick={(e) => e.stopPropagation()} 
                  className="inline-flex items-center gap-1.5 bg-[#25D366] hover:bg-[#128C7E] text-white px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-transform active:scale-95 shadow-sm"
                >
                  WA
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}