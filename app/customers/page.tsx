"use client"
import { useState } from 'react'

export default function CustomerPage() {
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'order' | 'contact' | 'notes'>('order')

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
    <div className="min-h-screen bg-[#fcfaf7] text-[#2e2e2e] font-sans p-8">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER BASECAMP STYLE */}
        <header className="border-b-2 border-slate-200 pb-6 mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pelanggan</h1>
            <p className="text-slate-500 text-sm mt-1">Daftar semua orang yang pernah bertransaksi dengan bisnis Anda.</p>
          </div>
          <button className="bg-[#2e8540] hover:bg-[#246632] text-white px-5 py-2 rounded shadow-sm font-bold text-sm transition-colors">
            + Tambah Pelanggan
          </button>
        </header>

        {/* LIST - KOTAK LEBIH TEGAS */}
        <div className="bg-white border border-slate-300 shadow-sm rounded-md overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-[#f8f9fa] border-b border-slate-300">
              <tr className="text-xs uppercase text-slate-500 font-semibold tracking-wider">
                <th className="px-6 py-3">Nama & Kontak</th>
                <th className="px-6 py-3">Transaksi</th>
                <th className="px-6 py-3 text-right">LTV / AOV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {customers.map((c) => (
                <tr 
                  key={c.id} 
                  onClick={() => setSelectedCustomer(c)}
                  className="hover:bg-[#fffdf0] cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="font-bold text-blue-700 hover:underline">{c.name}</div>
                    <div className="text-sm text-slate-500">{c.phone}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium">{c.order_count} kali order</div>
                    <div className="text-[11px] text-slate-400">Terakhir: {c.last_contact}</div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="text-sm font-bold text-slate-800">{formatIDR(c.ltv)}</div>
                    <div className="text-[11px] text-slate-500 uppercase tracking-tighter">AOV: {formatIDR(c.ltv / c.order_count)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* FOOTER KECIL */}
        <footer className="mt-8 text-center text-slate-400 text-xs">
          Menampilkan {customers.length} pelanggan terdaftar.
        </footer>
      </div>

      {/* DETAIL DRAWER / SLIDE-IN (Khas Basecamp Modal) */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 pb-10 overflow-y-auto bg-[#2e2e2e]/50 backdrop-blur-[1px]">
          <div className="bg-white w-full max-w-3xl border-2 border-slate-400 shadow-2xl rounded-sm p-12 relative min-h-[80vh]">
            
            <button 
              onClick={() => setSelectedCustomer(null)}
              className="absolute top-8 right-12 text-slate-400 hover:text-red-600 font-bold"
            >
              [ Tutup ]
            </button>

            <div className="border-b border-slate-100 pb-8 mb-8">
              <div className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Profil Pelanggan</div>
              <h2 className="text-4xl font-bold mb-2">{selectedCustomer.name}</h2>
              <div className="flex gap-4 text-slate-500">
                <span>{selectedCustomer.phone}</span>
                <span>•</span>
                <span className="italic">{selectedCustomer.email}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-12">
              <div className="col-span-2 space-y-10">
                {/* TABS KOTAK TEGAS */}
                <div>
                  <div className="flex gap-6 border-b border-slate-200 mb-6">
                    {['order', 'contact', 'notes'].map((tab) => (
                      <button 
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={`pb-3 text-sm font-bold transition-all ${activeTab === tab ? 'border-b-4 border-yellow-400 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        {tab === 'order' ? 'Riwayat Pesanan' : tab === 'contact' ? 'Kontak' : 'Catatan'}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'order' && (
                    <div className="space-y-3">
                      <div className="flex justify-between p-3 border border-slate-200 rounded text-sm bg-slate-50">
                        <span className="font-bold">Order #1209 — <span className="text-slate-500 font-normal italic">14 Feb 2024</span></span>
                        <span className="font-bold text-slate-700">{formatIDR(1250000)}</span>
                      </div>
                    </div>
                  )}

                  {activeTab === 'notes' && (
                    <div className="p-6 bg-[#fffde7] border-l-4 border-yellow-400 text-slate-800 text-sm leading-relaxed italic">
                      {selectedCustomer.notes}
                    </div>
                  )}
                </div>
              </div>

              {/* SIDEBAR DETAIL */}
              <div className="space-y-8 bg-[#f9f9f9] p-6 border border-slate-200 rounded">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2">Alamat Utama</label>
                  <p className="text-xs font-medium leading-relaxed">{selectedCustomer.address}</p>
                </div>
                
                <div className="pt-4 border-t border-slate-200">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2">Ringkasan Nilai</label>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-500">Total Order:</span>
                      <span>{selectedCustomer.order_count}x</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-500">LTV:</span>
                      <span className="text-blue-700">{formatIDR(selectedCustomer.ltv)}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button className="w-full bg-[#2e8540] text-white py-2 rounded text-xs font-bold shadow-sm">
                    Hubungi via WhatsApp
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}