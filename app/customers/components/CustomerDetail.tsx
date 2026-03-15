import { useState } from 'react'

export function CustomerDetail({ customer, onClose }: { customer: any, onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'order' | 'contact' | 'notes'>('order')
  if (!customer) return null

  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 pb-10 overflow-y-auto bg-[#2e2e2e]/60 backdrop-blur-[2px]" onClick={onClose}>
      <div className="bg-white w-full max-w-4xl border border-slate-400 shadow-2xl rounded-sm relative mx-4 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
        
        <div className="p-10 border-b border-slate-100 flex justify-between items-start bg-[#fcfaf7]">
          <div>
            <div className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.2em] mb-3 bg-blue-50 px-2 py-1 inline-block rounded">Profil Pelanggan</div>
            <h2 className="text-4xl font-bold text-slate-900 tracking-tight">{customer.name}</h2>
            <div className="flex items-center gap-4 mt-3 text-slate-500 text-sm font-medium">
              <span>{customer.phone}</span>
              <span className="text-slate-300">|</span>
              <span>{customer.email || 'No Email'}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-red-600 font-bold text-xs tracking-widest uppercase bg-white border border-slate-200 px-4 py-2 rounded shadow-sm transition-all">[ Tutup ]</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
          <div className="md:col-span-2 p-10 border-r border-slate-100 min-h-[400px]">
            <div className="flex gap-8 border-b border-slate-200 mb-8 font-bold text-[11px] uppercase tracking-widest">
              {['order', 'contact', 'notes'].map((tab) => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`pb-4 transition-all ${activeTab === tab ? 'border-b-4 border-yellow-400 text-slate-900' : 'text-slate-300 hover:text-slate-500'}`}
                >
                  {tab === 'order' ? 'Riwayat Belanja' : tab === 'contact' ? 'Interaksi' : 'Catatan'}
                </button>
              ))}
            </div>

            {activeTab === 'order' && (
              <div className="space-y-2">
                <div className="flex justify-between p-4 border border-slate-200 rounded text-sm bg-slate-50 font-bold text-slate-700">
                  <span>Order #1209 <span className="font-normal text-slate-400 italic ml-2">14 Mar 2026</span></span>
                  <span>{formatIDR(1250000)}</span>
                </div>
              </div>
            )}

            {activeTab === 'notes' && (
              <div className="bg-[#fffde7] p-8 border-l-4 border-yellow-400 italic text-sm text-slate-800 leading-relaxed shadow-sm">
                "{customer.notes || 'Tidak ada catatan khusus.'}"
              </div>
            )}
          </div>

          <div className="p-10 bg-[#f9f9f9] space-y-10">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Alamat Pengiriman</label>
              <p className="text-xs font-bold leading-relaxed text-slate-600 bg-white p-4 border border-slate-200 rounded">{customer.address || 'Belum diinput.'}</p>
            </div>
            
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Metrik Nilai</label>
              <div className="space-y-4 text-xs font-bold uppercase tracking-tight">
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-400">Total Order</span>
                  <span className="text-slate-900">{customer.order_count}x</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200 text-blue-700">
                  <span className="text-slate-400">LTV</span>
                  <span>{formatIDR(customer.ltv)}</span>
                </div>
              </div>
            </div>

            <a href={`https://wa.me/${customer.phone}`} target="_blank" className="block w-full bg-[#2e8540] text-white py-4 rounded text-[10px] font-black text-center shadow-md uppercase tracking-[0.2em] transition-transform active:scale-95">Chat WhatsApp</a>
          </div>
        </div>
      </div>
    </div>
  )
}