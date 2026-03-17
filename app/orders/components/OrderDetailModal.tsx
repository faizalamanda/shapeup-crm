"use client"

export function OrderDetailModal({ order, onClose }: { order: any, onClose: () => void }) {
  if (!order) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  // FUNGSI AMBIL ALAMAT DARI RAW JSON (WOOCOMMERCE / OTHERS)
  const getAddressFromRaw = () => {
    const raw = order.raw_source_data || {}
    
    // Jika dari WooCommerce
    if (raw.shipping) {
      const { address_1, city, state, postcode } = raw.shipping
      if (address_1) return `${address_1}, ${city}, ${state} ${postcode}`
    }
    
    if (raw.billing) {
      const { address_1, city, state, postcode } = raw.billing
      if (address_1) return `${address_1}, ${city}, ${state} ${postcode}`
    }

    // Fallback ke data string jika ada
    return order.shipping_address || order.billing_address || "Belum diinput."
  }

  // FUNGSI AMBIL METODE PEMBAYARAN
  const getPaymentMethod = () => {
    return order.payment_method || order.raw_source_data?.payment_method_title || "Tidak terdeteksi"
  }

  const items = Array.isArray(order.items_json) ? order.items_json : []

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[90vh] font-sans">
        
        {/* HEADER STYLE: Bersih seperti lampiran */}
        <div className="p-10 border-b border-slate-100 flex justify-between items-start">
          <div>
            <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded-sm uppercase tracking-wider mb-4 inline-block">
              Detail Pesanan
            </span>
            <h2 className="text-4xl font-bold text-[#1a1c23] tracking-tight mb-2">
              #{order.order_number || order.id.toString().substring(0,6)}
            </h2>
            <div className="flex items-center gap-4 text-slate-400 text-sm">
              <span>{order.customer?.name || 'Pelanggan'}</span>
              <span className="h-4 w-[1px] bg-slate-200"></span>
              <span>{order.customer?.phone || '-'}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-sm font-bold border border-slate-100 px-4 py-2 rounded-sm transition-all">
            [ TUTUP ]
          </button>
        </div>

        {/* CONTENT BODY */}
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          
          {/* SISI KIRI: PRODUK & RINCIAN */}
          <div className="flex-1 p-10 overflow-y-auto border-r border-slate-50">
            <div className="flex gap-8 border-b border-slate-100 pb-2 mb-6">
                <button className="text-sm font-bold border-b-2 border-yellow-500 pb-2">Item Pesanan</button>
                <button className="text-sm font-bold text-slate-300 pb-2">Log Aktivitas</button>
            </div>

            <div className="space-y-6">
              {items.map((item: any, i: number) => (
                <div key={i} className="flex justify-between items-center p-4 border border-slate-100 rounded-sm">
                  <div>
                    <p className="text-sm font-bold text-[#1a1c23]">Order #{order.order_number} <span className="font-normal text-slate-400 ml-2">{new Date(order.order_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span></p>
                    <p className="text-xs text-slate-500 mt-1">{item.name} (x{item.quantity})</p>
                    {Array.isArray(item.meta_data) && item.meta_data.map((m: any, idx: number) => (
                       <span key={idx} className="text-[10px] text-orange-500 font-bold mr-2">/ {m.display_value || m.value}</span>
                    ))}
                  </div>
                  <p className="font-bold text-[#1a1c23]">{formatIDR(item.subtotal)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* SISI KANAN: ALAMAT & METRIK */}
          <div className="w-full md:w-[350px] bg-slate-50/50 p-10 space-y-10">
            
            {/* ALAMAT PENGIRIMAN */}
            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Alamat Pengiriman</h3>
              <div className="bg-white p-6 border border-slate-200 rounded-sm shadow-sm min-h-[100px] flex items-center">
                <p className="text-sm font-bold text-slate-700 leading-relaxed italic">
                  {getAddressFromRaw()}
                </p>
              </div>
            </div>

            {/* METRIK NILAI */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Metrik Nilai</h3>
              
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-400 uppercase">Metode Bayar</span>
                <span className="font-bold text-[#1a1c23]">{getPaymentMethod()}</span>
              </div>

              <div className="flex justify-between items-center text-xs pt-4 border-t border-slate-100">
                <span className="font-bold text-slate-400 uppercase">LTV (Total Order)</span>
                <span className="font-bold text-blue-600">{formatIDR(order.grand_total)}</span>
              </div>
            </div>

            {/* TOMBOL AKSI */}
            <div className="pt-6">
                <a 
                href={`https://wa.me/${order.customer?.phone}`}
                target="_blank"
                className="block w-full bg-[#2e8540] text-white text-center py-4 rounded-sm font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-[#246632] transition-all"
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