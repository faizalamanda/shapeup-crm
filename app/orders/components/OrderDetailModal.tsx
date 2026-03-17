"use client"

export function OrderDetailModal({ order, onClose }: { order: any, onClose: () => void }) {
  if (!order) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  // 1. LOGIKA AMBIL ALAMAT DARI RAW SOURCE (PLATFORM SPECIFIC)
  const getAddressFromRaw = () => {
    const raw = order.raw_source_data || {}
    
    // Cek jika struktur WooCommerce (Shipping dulu baru Billing)
    const ship = raw.shipping
    if (ship && ship.address_1) {
      return `${ship.address_1}, ${ship.city}, ${ship.state} ${ship.postcode}`
    }

    const bill = raw.billing
    if (bill && bill.address_1) {
      return `${bill.address_1}, ${bill.city}, ${bill.state} ${bill.postcode}`
    }

    // Jika tidak ada di raw, ambil dari kolom database langsung
    return order.shipping_address || order.billing_address || "Alamat tidak ditemukan di data transaksi."
  }

  // 2. LOGIKA AMBIL METODE PEMBAYARAN
  const getPaymentMethod = () => {
    const raw = order.raw_source_data || {}
    return order.payment_method || raw.payment_method_title || "Manual Transfer"
  }

  // 3. LOGIKA AMBIL ITEM (PROTEKSI ERROR #31)
  const items = Array.isArray(order.items_json) ? order.items_json : []

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[90vh] font-sans">
        
        {/* HEADER: Clean Style */}
        <div className="p-8 md:p-10 border-b border-slate-100 flex justify-between items-start">
          <div>
            <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-1 rounded-sm uppercase tracking-wider mb-4 inline-block">
              Detail Transaksi
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1a1c23] tracking-tight mb-2 uppercase">
              #{order.order_number || order.id.toString().substring(0,8)}
            </h2>
            <div className="flex flex-wrap items-center gap-2 md:gap-4 text-slate-400 text-sm">
              <span className="font-bold text-slate-600">{order.customer?.name || 'Pelanggan'}</span>
              <span className="hidden md:block h-4 w-[1px] bg-slate-200"></span>
              <span>{order.customer?.phone || '-'}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-[10px] font-black border border-slate-100 px-4 py-2 rounded-sm transition-all uppercase tracking-widest">
            [ Close ]
          </button>
        </div>

        {/* CONTENT BODY */}
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          
          {/* LEFT: Produk (Scrolling Area) */}
          <div className="flex-1 p-6 md:p-10 overflow-y-auto border-r border-slate-50">
            <div className="flex gap-8 border-b border-slate-100 pb-2 mb-6">
                <button className="text-xs font-black border-b-2 border-yellow-500 pb-2 uppercase tracking-widest">Item Pesanan</button>
            </div>

            <div className="space-y-4">
              {items.map((item: any, i: number) => (
                <div key={i} className="flex justify-between items-center p-4 border border-slate-100 rounded-sm hover:bg-slate-50 transition-colors">
                  <div className="flex-1 pr-4">
                    <p className="text-xs font-black text-[#1a1c23] uppercase">
                      {typeof item.name === 'string' ? item.name : 'Produk Tanpa Nama'}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1">
                        <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded-sm font-bold">QTY: {item.quantity || 1}</span>
                        {Array.isArray(item.meta_data) && item.meta_data.map((m: any, idx: number) => (
                           <span key={idx} className="text-[10px] text-orange-600 font-bold uppercase italic">/ {m.display_value || m.value}</span>
                        ))}
                    </div>
                  </div>
                  <p className="font-black text-sm text-[#1a1c23]">{formatIDR(item.subtotal)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Sidebar Alamat & Summary */}
          <div className="w-full md:w-[380px] bg-slate-50/50 p-6 md:p-10 space-y-8 overflow-y-auto">
            
            {/* ALAMAT */}
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Alamat Pengiriman</h3>
              <div className="bg-white p-5 border border-slate-200 rounded-sm shadow-sm">
                <p className="text-xs font-bold text-slate-700 leading-relaxed italic">
                  {getAddressFromRaw()}
                </p>
              </div>
            </div>

            {/* METODE PEMBAYARAN */}
            <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Metode & Status</h3>
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white p-3 border border-slate-200 text-center">
                        <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Payment</p>
                        <p className="text-[10px] font-black text-slate-800 uppercase">{getPaymentMethod()}</p>
                    </div>
                    <div className="bg-white p-3 border border-slate-200 text-center">
                        <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Status</p>
                        <p className="text-[10px] font-black text-blue-600 uppercase">{order.status || 'Pending'}</p>
                    </div>
                </div>
            </div>

            {/* RINGKASAN BIAYA */}
            <div className="space-y-3 pt-4 border-t border-slate-200">
              <div className="flex justify-between items-center text-[10px]">
                <span className="font-bold text-slate-400 uppercase">Subtotal</span>
                <span className="font-bold text-slate-700">{formatIDR(order.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span className="font-bold text-slate-400 uppercase">Ongkos Kirim</span>
                <span className="font-bold text-slate-700">{formatIDR(order.shipping_cost)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span className="font-bold text-red-400 uppercase tracking-widest">Diskon</span>
                <span className="font-bold text-red-500">-{formatIDR(order.discount_amount)}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t-2 border-slate-900">
                <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Total Order</span>
                <span className="text-lg font-black text-blue-700">{formatIDR(order.grand_total)}</span>
              </div>
            </div>

            {/* ACTION */}
            <div className="pt-4">
                <a 
                    href={`https://wa.me/${order.customer?.phone || ''}`}
                    target="_blank"
                    className="block w-full bg-[#1a1c23] text-white text-center py-4 rounded-sm font-black text-[10px] uppercase tracking-[0.2em] hover:bg-blue-700 transition-all shadow-xl"
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