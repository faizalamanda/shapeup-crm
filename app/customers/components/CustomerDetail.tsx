import { useState } from 'react'

interface CustomerDetailProps {
  customer: any
  onClose: () => void
}

export function CustomerDetail({ customer, onClose }: CustomerDetailProps) {
  const [activeTab, setActiveTab] = useState<'order' | 'contact' | 'notes'>('order')

  if (!customer) return null

  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 pb-10 overflow-y-auto bg-[#2e2e2e]/60 backdrop-blur-[2px]" onClick={onClose}>
      <div className="bg-white w-full max-w-4xl border border-slate-400 shadow-2xl rounded-sm relative mb-10 mx-4" onClick={e => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div className="p-10 border-b border-slate-100 flex justify-between items-start bg-[#fcfaf7]">
          <div>
            <div className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.2em] mb-3 bg-blue-50 px-2 py-1 inline-block rounded">Profil Pelanggan</div>
            <h2 className="text-4xl font-bold text-slate-900 tracking-tight">{customer.name}</h2>
            <div className="flex items-center gap-4 mt-3 text-slate-500 text-sm font-medium font-sans">
              <span>{customer.phone}</span>
              <span className="text-slate-300">|</span>
              <span>{customer.email || 'No Email'}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-red-600 font-bold text-xs tracking-widest uppercase bg-white border border-slate-200 px-4 py-2 rounded shadow-sm transition-all">[ Tutup ]</button>
        </div>

        {/* Modal Body */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
          
          {/* Main Content (Left) */}
          <div className="md:col-span-2 p-10 border-r border-slate-100 min-h-[400px]">
            <div className="flex gap-8 border-b border-slate-200 mb-8">
              {['order', 'contact', 'notes'].map((tab) => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`pb-4 text-[11px] font-bold uppercase tracking-widest transition-all ${activeTab === tab ? 'border-b-4 border-yellow-400 text-slate-900' : 'text-slate-300 hover:text-slate-500'}`}
                >
                  {tab === 'order' ? 'Riwayat Belanja' : tab === 'contact' ? 'Interaksi' : 'Catatan'}
                </button>
              ))}
            </div>

            {activeTab === 'order' && (
              <div className="space-y-2">
                <div className="flex justify-between p-4 border border-slate-200 rounded text-sm bg-slate-50 hover:bg-white transition-all cursor-default group">
                  <span className="font-bold text-slate-700">Order #1209 <span className="text-slate-400 font-normal ml-3 italic text-xs tracking-tight font-sans">14 Mar 2026</span></span>
                  <span className="font-bold text-slate-900">{formatIDR(1250000)}</span>
                </div>
                {/* Loop data order asli di sini nantinya */}
              </div>
            )}

            {activeTab === 'notes' && (
              <div className="bg-[#fffde7] p-8 border-l-4 border-yellow-400 shadow-sm">
                <p className="text-slate-800 text-sm leading-relaxed font-medium italic font-sans">
                  "{customer.notes || 'Belum ada catatan khusus untuk pelanggan ini.'}"
                </p>
              </div>
            )}
          </div>

          {/* Sidebar Area (Right) */}
          <div className="p-10 bg-[#f9f9f9] space-y-10">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Alamat Pengiriman</label>
              <p className="text-xs font-bold leading-relaxed text-slate-600 bg-white p-4 border border-slate-200 rounded font-sans">
                {customer.address || 'Alamat belum diinput.'}
              </p>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Metrik Nilai</label>
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-bold py-2 border-b border-slate-200">
                  <span className="text-slate-400 font-medium tracking-tight uppercase">Total Order</span>
                  <span className="text-slate-900">{customer.order_count}x</span>
                </div>
                <div className="flex justify-between text-xs font-bold py-2 border-b border-slate-200">
                  <span className="text-slate-400 font-medium tracking-tight uppercase">LTV</span>
                  <span className="text-blue-700 font-sans">{formatIDR(customer.ltv || 0)}</span>
                </div>
              </div>
            </div>

            <a 
              href={`https://wa.me/${customer.phone}`}
              target="_blank"
              className="block w-full bg-[#2e8540] hover:bg-[#246632] text-white py-4 rounded text-[10px] font-black text-center shadow-md transition-all uppercase tracking-[0.2em]"
            >
              Hubungi WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}