"use client"
import { useState } from 'react'

export default function CustomerPage() {
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'order' | 'contact' | 'notes'>('order')

  // Data Dummy untuk simulasi tampilan
  const customers = [
    { 
      id: 1, name: 'Budi Santoso', phone: '628123456789', 
      email: 'budi.santoso@gmail.com', address: 'Jl. Senopati No. 12, Jakarta Selatan',
      order_count: 12, ltv: 15400000, category: 'VIP',
      last_contact: '2 hari yang lalu',
      notes: 'Pelanggan loyal sejak 2023. Lebih suka pengiriman instan.'
    },
    { 
      id: 2, name: 'Siti Aminah', phone: '628998877665', 
      email: 'siti.am@outlook.com', address: 'Gg. Swadaya, Bandung',
      order_count: 2, ltv: 450000, category: 'General',
      last_contact: '1 minggu yang lalu',
      notes: 'Sensitive dengan harga, suka tanya promo.'
    }
  ]

  const formatIDR = (val: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
        <div>
          <h1 className="text-5xl font-black text-slate-900 tracking-tighter">Database</h1>
          <p className="text-slate-400 font-bold uppercase text-xs tracking-[0.2em] mt-2">Asset Pelanggan & Profitabilitas</p>
        </div>
        <button className="h-14 px-8 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-200 hover:scale-105 active:scale-95 transition-all">
          + Pelanggan Baru
        </button>
      </header>

      {/* SEARCH & FILTER (Visual Only) */}
      <div className="flex gap-4 mb-8">
        <div className="flex-1 relative">
          <input 
            type="text" 
            placeholder="Cari nama atau nomor hp..." 
            className="w-full h-14 pl-14 pr-6 bg-white border border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold transition-all shadow-sm"
          />
          <span className="absolute left-6 top-4 opacity-30 text-xl">🔍</span>
        </div>
        <button className="h-14 px-6 bg-white border border-slate-200 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition-all">Filter</button>
      </div>

      {/* TABLE LIST */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest pl-10">Info Pelanggan</th>
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Frekuensi</th>
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Metrik (LTV/AOV)</th>
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right pr-10">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((c) => (
              <tr 
                key={c.id} 
                onClick={() => setSelectedCustomer(c)}
                className="group cursor-pointer hover:bg-slate-50/80 transition-all"
              >
                <td className="p-6 pl-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 text-white rounded-xl flex items-center justify-center font-black">
                      {c.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-black text-slate-800 text-lg tracking-tight">{c.name}</p>
                      <p className="text-slate-400 font-bold text-xs">{c.phone}</p>
                    </div>
                  </div>
                </td>
                <td className="p-6 text-center">
                  <div className="inline-block px-4 py-1.5 bg-blue-50 text-blue-700 rounded-full font-black text-xs">
                    {c.order_count}x Beli
                  </div>
                </td>
                <td className="p-6">
                  <p className="font-black text-slate-800 text-sm">{formatIDR(c.ltv)} <span className="text-slate-300 font-medium">LTV</span></p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                    AOV: {formatIDR(c.ltv / c.order_count)}
                  </p>
                </td>
                <td className="p-6 text-right pr-10">
                  <div className="flex justify-end gap-2">
                    <a 
                      href={`https://wa.me/${c.phone}`} 
                      onClick={(e) => e.stopPropagation()}
                      className="w-10 h-10 bg-green-500 text-white rounded-xl flex items-center justify-center hover:bg-green-600 transition-all shadow-lg shadow-green-100"
                    >
                      📞
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DETAIL DRAWER (SLIDE-OVER) */}
      {selectedCustomer && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]" onClick={() => setSelectedCustomer(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white z-[101] shadow-2xl p-0 flex flex-col animate-in slide-in-from-right duration-300">
            
            {/* Drawer Header */}
            <div className="p-10 pb-6 border-b border-slate-50">
              <div className="flex justify-between items-start mb-6">
                 <span className="px-4 py-1.5 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-100">
                    {selectedCustomer.category}
                 </span>
                 <button onClick={() => setSelectedCustomer(null)} className="text-slate-300 hover:text-slate-900 transition-colors font-bold uppercase text-[10px] tracking-widest">Tutup Esc</button>
              </div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">{selectedCustomer.name}</h2>
              <div className="flex gap-4 mt-2">
                <p className="text-slate-400 font-bold">{selectedCustomer.email}</p>
                <span className="text-slate-200">|</span>
                <p className="text-slate-400 font-bold">{selectedCustomer.phone}</p>
              </div>
            </div>

            {/* Drawer Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-10 pt-8 space-y-10">
              
              {/* ALAMAT */}
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Alamat Pengiriman</p>
                <p className="font-bold text-slate-700 leading-relaxed bg-slate-50 p-6 rounded-3xl border border-slate-100">
                   {selectedCustomer.address}
                </p>
              </div>

              {/* TABS */}
              <div>
                <div className="flex gap-8 border-b border-slate-100 mb-8">
                  {['order', 'contact', 'notes'].map((tab) => (
                    <button 
                      key={tab}
                      onClick={() => setActiveTab(tab as any)}
                      className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-300'}`}
                    >
                      {tab === 'order' ? 'History Order' : tab === 'contact' ? 'Kontak' : 'Catatan'}
                    </button>
                  ))}
                </div>

                {/* TAB CONTENT: ORDER */}
                {activeTab === 'order' && (
                  <div className="space-y-4">
                    <div className="p-5 bg-white border border-slate-100 rounded-2xl flex justify-between items-center hover:border-blue-100 transition-all">
                       <div>
                         <p className="font-black text-slate-800 tracking-tight">Order #1209</p>
                         <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">14 Feb 2024 • 3 Items</p>
                       </div>
                       <p className="font-black text-slate-900">{formatIDR(1250000)}</p>
                    </div>
                    <div className="p-5 bg-white border border-slate-100 rounded-2xl flex justify-between items-center opacity-50">
                       <div>
                         <p className="font-black text-slate-800 tracking-tight">Order #1102</p>
                         <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">22 Jan 2024 • 1 Items</p>
                       </div>
                       <p className="font-black text-slate-900">{formatIDR(450000)}</p>
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: NOTES */}
                {activeTab === 'notes' && (
                  <div className="bg-yellow-50 p-6 rounded-3xl border border-yellow-100">
                    <p className="text-yellow-800 font-bold italic leading-relaxed">"{selectedCustomer.notes}"</p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Action Footer */}
            <div className="p-8 border-t border-slate-50 bg-slate-50/50 flex gap-4">
               <button className="flex-1 h-14 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white transition-all">Edit Profil</button>
               <button className="flex-1 h-14 bg-green-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-green-600 shadow-lg shadow-green-100 transition-all">Chat WhatsApp</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}