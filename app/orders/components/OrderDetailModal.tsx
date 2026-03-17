"use client"

export function OrderDetailModal({ order, onClose }: { order: any, onClose: () => void }) {
  if (!order) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  // 1. AMBIL ALAMAT (Bongkar Raw Data WooCommerce Mas)
  const getAddressFromRaw = () => {
    const raw = order.raw_source_data || {}
    const s = raw.shipping || {}
    const m = raw.meta_data || []

    // Cari Kecamatan dari meta_data
    const kecamatan = m.find((i: any) => i.key === 'shipping_kecamatan')?.value || 
                      m.find((i: any) => i.key === 'billing_kecamatan')?.value || ""

    if (s.address_1) {
      return `${s.address_1}, ${s.address_2 ? s.address_2 + ', ' : ''}${kecamatan ? kecamatan + ', ' : ''}${s.city}, ${s.state} ${s.postcode || ''}`.trim()
    }
    
    return order.shipping_address || "Alamat tidak terbaca."
  }

  const items = Array.isArray(order.items_json) ? order.items_json : []

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[90vh] font-sans">
        
        {/* HEADER */}
        <div className="p-8 md:p-10 border-b border-slate-100 flex justify-between items-start">
          <div>
            <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-1 rounded-sm uppercase tracking-widest mb-4 inline-block">
              Order Detail
            </span>
            <h2 className="text-3xl md:text-4xl font-black text-[#1a1c23] tracking-tight mb-2 uppercase italic">
              #{order.order_number || order.id}
            </h2>
            <div className="flex items-center gap-4 text-slate-400 text-sm">
              <span className="text-slate-800 font-bold">{order.customer?.name || 'Customer'}</span>
              <span className="h-4 w-[1px] bg-slate-200"></span>
              <span>{order.customer?.phone || '-'}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-[10px] font-black border border-slate-100 px-4 py-2 rounded-sm transition-all uppercase">
            [ Close ]
          </button>
        </div>

        {/* BODY */}
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          
          {/* LEFT: Items List */}
          <div className="flex-1 p-6 md:p-10 overflow-y-auto border-r border-slate-50 bg-white">
            <div className="flex gap-8 border-b border-slate-100 pb-2 mb-6">
                <button className="text-[10px] font-black border-b-2 border-yellow-500 pb-2 uppercase tracking-widest">Item Pesanan</button>
            </div>

            <div className="space-y-4">
              {items.map((item: any, i: number) => (
                <div key={i} className="flex justify-between items-center p-5 border border-slate-100 rounded-sm">
                  <div className="flex-1 pr-4">
                    <p className="text-xs font-black text-[#1a1c23] uppercase">{item.name}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                        <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded-sm font-black text-slate-500 border border-slate-200">QTY: {item.quantity}</span>
                        {/* SAFE RENDER: Hanya cetak display_value jika dia STRING */}
                        {Array.isArray(item.meta_data) && item.meta_data.map((m: any, idx: number) => (
                           typeof m.display_value === 'string' && !m.key.startsWith('_') && (
                             <span key={idx} className="text-[9px] text-orange-600 font-black uppercase italic">/ {m.display_value}</span>
                           )
                        ))}
                    </div>
                  </div>
                  <p className="font-black text-sm text-[#1a1c23]">{formatIDR(item.subtotal)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Summary & Shipping */}
          <div className="w-full md:w-[380px] bg-[#fbfbfb] p-6 md:p-10 space-y-8 overflow-y-auto">
            
            {/* ADDRESS */}
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Alamat Pengiriman</h3>
              <div className="bg-white p-6 border border-slate-200 rounded-sm shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-400"></div>
                <p className="text-xs font-bold text-slate-700 leading-relaxed italic uppercase">
                  {getAddressFromRaw()}
                </p>
              </div>
            </div>

            {/* INFO */}
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-white p-4 border border-slate-200">
                    <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Payment</p>
                    <p className="text-[10px] font-black text-slate-800 uppercase">{order.payment_method || 'BACS'}</p>
                </div>
                <div className="bg-white p-4 border border-slate-200">
                    <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Status</p>
                    <p className="text-[10px] font-black text-blue-600 uppercase">{order.status}</p>
                </div>
            </div>

            {/* TOTAL */}
            <div className="pt-6 border-t border-slate-200 space-y-3">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400">
                <span>Subtotal</span>
                <span className="text-slate-700">{formatIDR(order.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400">
                <span>Ongkir</span>
                <span className="text-slate-700">{formatIDR(order.shipping_cost)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-red-400">
                <span>Diskon</span>
                <span>-{formatIDR(order.discount_amount)}</span>
              </div>
              <div className="pt-5 border-t-2 border-slate-900 flex justify-between items-center">
                <span className="text-[11px] font-black text-slate-900 uppercase">Total</span>
                <span className="text-xl font-black text-blue-700">{formatIDR(order.grand_total)}</span>
              </div>
            </div>

            <div className="pt-4">
                <a 
                    href={`https://wa.me/${order.customer?.phone || ''}`}
                    target="_blank"
                    className="block w-full bg-[#1a1c23] text-white text-center py-4 rounded-sm font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-green-600 transition-all"
                >
                    Chat WhatsApp
                </a>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}