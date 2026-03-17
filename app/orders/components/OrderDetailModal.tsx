"use client"

export function OrderDetailModal({ order, onClose }: { order: any, onClose: () => void }) {
  if (!order) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(val) || 0)
  
  // Alamat biasanya ada di billing_address atau shipping_address
  const address = order.shipping_address || order.billing_address || order.customer_address || "Alamat belum diatur."

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header Modal */}
        <div className="bg-white p-6 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Pesanan #{order.order_number || order.id}</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{new Date(order.order_date).toLocaleString('id-ID')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-all font-bold">✕</button>
        </div>

        {/* Content Body */}
        <div className="p-8 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-10">
          
          {/* Info Pengiriman */}
          <div className="space-y-6">
            <div>
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3">Penerima</h3>
              <p className="font-bold text-slate-800 text-lg leading-none">{order.customer?.name || 'Pelanggan'}</p>
              <p className="text-slate-400 font-medium text-sm mt-1">+{order.customer?.phone || '-'}</p>
            </div>

            <div>
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3">Alamat Lengkap</h3>
              <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 italic">
                {typeof address === 'string' ? address : "Detail alamat tersedia di sistem kurir."}
              </p>
            </div>

            <div className="flex gap-6">
              <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Metode</h3>
                <p className="text-xs font-bold text-slate-700 uppercase">{order.payment_method || 'Transfer'}</p>
              </div>
              <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Status</h3>
                <p className="text-xs font-bold text-blue-600 uppercase">{order.status}</p>
              </div>
            </div>
          </div>

          {/* Info Produk */}
          <div className="space-y-6">
            <div>
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-4">Rincian Item</h3>
              <div className="space-y-4">
                {order.items_json?.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-start border-b border-slate-50 pb-3">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-800 leading-snug">{item.name}</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-1">Qty: {item.quantity}</p>
                      {item.meta_data?.map((meta: any, idx: number) => (
                        <span key={idx} className="inline-block bg-orange-50 text-orange-600 text-[9px] px-1.5 py-0.5 rounded font-black mt-1 mr-1 uppercase">
                          {meta.display_key}: {meta.display_value}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm font-black text-slate-800 ml-4">{formatIDR(item.subtotal)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Total Section */}
            <div className="bg-slate-900 text-white p-6 rounded-2xl space-y-3">
              <div className="flex justify-between text-[10px] font-bold opacity-50 uppercase">
                <span>Ongkos Kirim</span>
                <span>{formatIDR(order.shipping_cost)}</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold text-red-400 uppercase">
                <span>Diskon</span>
                <span>-{formatIDR(order.discount_amount)}</span>
              </div>
              <div className="pt-3 border-t border-white/10 flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-widest text-yellow-500">Total Bayar</span>
                <span className="text-xl font-black">{formatIDR(order.grand_total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <a 
            href={`https://wa.me/${order.customer?.phone}?text=Halo%20${order.customer?.name},%20konfirmasi%20order%20#${order.order_number}%20di%20Toko%20Alamanda.`}
            target="_blank"
            className="flex-1 bg-[#22C55E] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest text-center shadow-lg shadow-green-200 hover:bg-[#16a34a] transition-all"
          >
            Hubungi Pelanggan via WA
          </a>
          <button onClick={onClose} className="px-6 py-3 border border-slate-200 rounded-xl text-slate-500 font-bold text-[10px] uppercase tracking-widest hover:bg-white transition-all">
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}