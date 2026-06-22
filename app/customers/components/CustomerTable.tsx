export function CustomerTable({ customers, onSelect }: { customers: any[], onSelect: (c: any) => void }) {
  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(val || 0))

  const today = new Date('2026-06-22') // Current context time

  const getCustomerBadges = (c: any) => {
    const badges = []
    
    // VIP Badge: LTV >= 1,000,000
    if ((Number(c.ltv) || 0) >= 1000000) {
      badges.push({
        label: 'VIP',
        className: 'bg-blue-50 text-blue-700 border-blue-100'
      })
    }

    // Churn Risk Badge: Last order was more than 60 days ago
    if (c.last_order_date) {
      const lastOrder = new Date(c.last_order_date)
      const diffTime = Math.abs(today.getTime() - lastOrder.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      if (diffDays > 60) {
        badges.push({
          label: 'Churn Risk',
          className: 'bg-red-50 text-red-700 border-red-100'
        })
      }
    }

    // New Shopper: Joined in last 30 days and only 1 order
    if (c.joined_at) {
      const joined = new Date(c.joined_at)
      const diffTime = Math.abs(today.getTime() - joined.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      if (diffDays <= 30 && (c.total_order_count || 0) <= 1) {
        badges.push({
          label: 'Baru',
          className: 'bg-emerald-50 text-emerald-700 border-emerald-100'
        })
      }
    }

    // One-Time Buyer: Order count is exactly 1 (and not newly joined to keep badges clean)
    if ((c.total_order_count || 0) === 1 && badges.filter(b => b.label === 'Baru').length === 0) {
      badges.push({
        label: '1-Time',
        className: 'bg-slate-100 text-slate-700 border-slate-200'
      })
    }

    return badges
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/75 border-b border-slate-200/60 text-[10px] font-black uppercase tracking-wider text-slate-400">
              <th className="p-4 pl-6">Nama Pelanggan</th>
              <th className="p-4">Karakteristik</th>
              <th className="p-4 text-center">Bergabung</th>
              <th className="p-4 text-center">Total Order</th>
              <th className="p-4 text-right">LTV (Total)</th>
              <th className="p-4 text-right">AOV (Rata-rata)</th>
              <th className="p-4 text-center">Order Terakhir</th>
              <th className="p-4 pr-6 text-center">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-400 font-medium italic text-sm">
                  Tidak ada pelanggan yang cocok dengan kriteria segmentasi.
                </td>
              </tr>
            ) : (
              customers.map((c, idx) => {
                const badges = getCustomerBadges(c)
                
                return (
                  <tr 
                    key={c.customer_id || idx} 
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer group"
                    onClick={() => onSelect(c)}
                  >
                    <td className="p-4 pl-6">
                      <p className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{c.name || 'Tanpa Nama'}</p>
                      <p className="text-[11px] text-slate-400 font-medium">+{c.phone}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1.5">
                        {badges.map((b) => (
                          <span 
                            key={b.label} 
                            className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${b.className}`}
                          >
                            {b.label}
                          </span>
                        ))}
                        {badges.length === 0 && (
                          <span className="text-[10px] text-slate-400 font-medium italic">-</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-center text-xs font-semibold text-slate-600">
                      {c.joined_at 
                        ? new Date(c.joined_at).toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })
                        : '-'}
                    </td>
                    <td className="p-4 text-center font-bold text-slate-800 text-sm">
                      {c.total_order_count || 0}
                    </td>
                    <td className="p-4 text-right font-black text-slate-900 text-sm">
                      {formatIDR(c.ltv)}
                    </td>
                    <td className="p-4 text-right font-bold text-slate-800 text-sm">
                      {formatIDR(c.aov)}
                    </td>
                    <td className="p-4 text-center">
                      <p className="text-xs font-semibold text-slate-600">
                        {c.last_order_date 
                          ? new Date(c.last_order_date).toLocaleDateString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric'
                            })
                          : '-'}
                      </p>
                      {c.last_order_status && (
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                          ['completed', 'complete'].includes(c.last_order_status.toLowerCase())
                            ? 'bg-emerald-50 text-emerald-600'
                            : ['failed', 'cancelled'].includes(c.last_order_status.toLowerCase())
                            ? 'bg-red-50 text-red-600'
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          {c.last_order_status}
                        </span>
                      )}
                    </td>
                    <td className="p-4 pr-6 text-center" onClick={(e) => e.stopPropagation()}>
                      <a 
                        href={`https://wa.me/${c.phone}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 bg-[#22C55E] hover:bg-[#1eb052] text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shadow-sm"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.197 1.451 4.793 1.451 5.385 0 9.768-4.383 9.771-9.77.002-2.61-1.012-5.064-2.855-6.907C16.488 2.083 14.04 1.07 11.43 1.07 6.046 1.07 1.663 5.453 1.66 10.84c-.001 1.705.452 3.37 1.31 4.866l-.998 3.648 3.732-.979z"/>
                        </svg>
                        WA
                      </a>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}