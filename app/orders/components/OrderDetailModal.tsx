"use client"

export function OrderDetailModal({ order, onClose }: { order: any, onClose: () => void }) {
  if (!order) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  // FIX 1: Pastikan Alamat Selalu String
  const renderAddress = () => {
    const addr = order.shipping_address || order.billing_address || order.customer_address
    if (!addr) return "Alamat tidak tersedia"
    if (typeof addr === 'object') {
      // Jika alamat berupa object (seperti billing {address_1, city, dll})
      return `${addr.first_name || ''} ${addr.address_1 || ''}, ${addr.city || ''} ${addr.postcode || ''}`
    }
    return String(addr)
  }

  const items = Array.isArray(order.items_json) ? order.items_json : []

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-white p-6 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Pesanan #{order.order_number || order.id}</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              {order.order_date ? new Date(order.order_date).toLocaleString('id-ID') : '-'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 font-bold">✕</button>
        </div>

        <div className="p-8 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="space-y-6">
            <div>
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3">Penerima</h3>
              <p className="font-bold text-slate-800 text-lg">{order.customer?.name || 'Pelanggan'}</p>
              <p className="text-slate-400 font-medium text-sm">+{order.customer?.phone || '-'}</p>
            </div>

            <div>
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3">Alamat Lengkap</h3>
              <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 italic">
                {/* Panggil fungsi FIX 1 */}
                {renderAddress()}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-4">Rincian Item</h3>
              <div className="space-y-4">
                {items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-start border-b border-slate-50 pb-3 text-xs">
                    <div className="flex-1">
                      {/* FIX 2: Pastikan item.name adalah string, bukan object */}
                      <p className="font-bold text-slate-800">{typeof item.name === 'object' ? 'Produk' : item.name}</p>
                      <p className="text-[10px] text-slate-400 mt-1">Jumlah: {item.quantity || 0}</p>
                      
                      {/* FIX 3: Render Meta Data dengan aman */}
                      {Array.isArray(item.meta_data) && item.meta_data.map((meta: any, idx: number) => {
                        const label = typeof meta.display_key === 'string' ? meta.display_key : 'Info';
                        const value = typeof meta.display_value === 'string' ? meta.display_value : '';
                        if (!value) return null;
                        return (
                          <span key={idx} className="inline-block bg-orange-50 text-orange-600 text-[9px] px-1.5 py-0.5 rounded font-black mt-1 mr-1 uppercase">
                            {label}: {value}
                          </span>
                        );
                      })}
                    </div>
                    <p className="font-black text-slate-800 ml-4">{formatIDR(item.subtotal)}</p>
                  </div>
                ))}
              </div>
            </div>

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

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <a 
            href={`https://wa.me/${order.customer?.phone || ''}`}
            target="_blank"
            className="flex-1 bg-[#22C55E] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest text-center shadow-lg shadow-green-100"
          >
            WhatsApp Pelanggan
          </a>
          <button onClick={onClose} className="px-6 py-3 border border-slate-200 rounded-xl text-slate-500 font-bold text-[10px] uppercase tracking-widest">
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}