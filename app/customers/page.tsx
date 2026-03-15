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
      <div className="max-w-6xl mx-auto">
        
        <header className="border-b-2 border-slate-200 pb-6 mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pelanggan</h1>
            <p className="text-slate-500 text-sm mt-1">Gunakan tombol WA untuk menghubungi pelanggan secara langsung.</p>
          </div>
          <button className="bg-[#2e8540] hover:bg-[#246632] text-white px-5 py-2 rounded shadow-sm font-bold text-sm transition-colors">
            + Tambah Pelanggan
          </button>
        </header>

        <div className="bg-white border border-slate-300 shadow-sm rounded-md overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-[#f8f9fa] border-b border-slate-300">
              <tr className="text-xs uppercase text-slate-500 font-semibold tracking-wider">
                <th className="px-6 py-3">Nama & Kontak</th>
                <th className="px-6 py-3">Transaksi</th>
                <th className="px-6 py-3">LTV / AOV</th>
                <th className="px-6 py-3 text-center">Hubungi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {customers.map((c) => (
                <tr 
                  key={c.id} 
                  className="hover:bg-[#fffdf0] cursor-pointer transition-colors group"
                  onClick={() => setSelectedCustomer(c)}
                >
                  <td className="px-6 py-4">
                    <div className="font-bold text-blue-700 group-hover:underline">{c.name}</div>
                    <div className="text-sm text-slate-500">{c.phone}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium">{c.order_count} kali order</div>
                    <div className="text-[11px] text-slate-400 uppercase">Terakhir: {c.last_contact}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-800">{formatIDR(c.ltv)}</div>
                    <div className="text-[11px] text-slate-500 uppercase tracking-tighter">AOV: {formatIDR(c.ltv / c.order_count)}</div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {/* TOMBOL WA DI TABEL */}
                    <a 
                      href={`https://wa.me/${c.phone}`} 
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()} // Supaya tidak buka modal saat klik tombol
                      className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white px-3 py-1.5 rounded text-[11px] font-bold transition-colors shadow-sm"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                      WHATSAPP
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="mt-8 text-center text-slate-400 text-xs">
          Menampilkan {customers.length} pelanggan terdaftar • {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
        </footer>
      </div>

      {/* DETAIL DRAWER / MODAL */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 pb-10 overflow-y-auto bg-[#2e2e2e]/60 backdrop-blur-[1px]" onClick={() => setSelectedCustomer(null)}>
          <div className="bg-white w-full max-w-4xl border border-slate-400 shadow-2xl rounded-sm p-12 relative" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setSelectedCustomer(null)}
              className="absolute top-8 right-12 text-slate-400 hover:text-red-600 font-bold text-sm tracking-widest"
            >
              [ TUTUP ]
            </button>

            <div className="border-b border-slate-100 pb-8 mb-8">
              <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2 px-2 py-0.5 bg-blue-50 inline-block rounded">Profil Pelanggan</div>
              <h2 className="text-4xl font-bold mb-2 tracking-tight">{selectedCustomer.name}</h2>
              <div className="flex gap-4 text-slate-500 text-sm font-medium">
                <span>ID: CUST-{selectedCustomer.id}</span>
                <span>•</span>
                <span>{selectedCustomer.phone}</span>
                <span>•</span>
                <span className="italic">{selectedCustomer.email}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-12">
              <div className="col-span-2 space-y-10">
                <div>
                  <div className="flex gap-8 border-b border-slate-200 mb-6">
                    {['order', 'contact', 'notes'].map((tab) => (
                      <button 
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all ${activeTab === tab ? 'border-b-4 border-yellow-400 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        {tab === 'order' ? 'Riwayat Pesanan' : tab === 'contact' ? 'Riwayat Kontak' : 'Catatan'}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'order' && (
                    <div className="space-y-2">
                      <div className="flex justify-between p-4 border border-slate-200 rounded text-sm bg-slate-50 hover:bg-white transition-colors">
                        <span className="font-bold">Order #1209 <span className="text-slate-400 font-normal ml-2">14 Feb 2024</span></span>
                        <span className="font-bold text-slate-700">{formatIDR(1250000)}</span>
                      </div>
                      <div className="flex justify-between p-4 border border-slate-200 rounded text-sm bg-slate-50 hover:bg-white transition-colors">
                        <span className="font-bold">Order #1188 <span className="text-slate-400 font-normal ml-2">01 Jan 2024</span></span>
                        <span className="font-bold text-slate-700">{formatIDR(2250000)}</span>
                      </div>
                    </div>
                  )}

                  {activeTab === 'notes' && (
                    <div className="p-6 bg-[#fffde7] border-l-4 border-yellow-400 text-slate-800 text-sm leading-relaxed shadow-sm">
                      <strong>Catatan Internal:</strong><br/>
                      <span className="italic">"{selectedCustomer.notes}"</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-[#f9f9f9] p-6 border border-slate-200 rounded shadow-sm">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-3 tracking-widest">Alamat Pengiriman</label>
                  <p className="text-xs font-medium leading-relaxed text-slate-600">{selectedCustomer.address}</p>
                </div>
                
                <div className="bg-[#f9f9f9] p-6 border border-slate-200 rounded shadow-sm">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-3 tracking-widest">Metrik Performa</label>
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs font-bold border-b border-slate-100 pb-2">
                      <span className="text-slate-500 font-medium tracking-tight">Total Transaksi:</span>
                      <span>{selectedCustomer.order_count}x</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold border-b border-slate-100 pb-2">
                      <span className="text-slate-500 font-medium tracking-tight">Total LTV:</span>
                      <span className="text-blue-700">{formatIDR(selectedCustomer.ltv)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-500 font-medium tracking-tight">Rata-rata (AOV):</span>
                      <span>{formatIDR(selectedCustomer.ltv / selectedCustomer.order_count)}</span>
                    </div>
                  </div>
                </div>

                <a 
                  href={`https://wa.me/${selectedCustomer.phone}`}
                  target="_blank"
                  className="block w-full bg-[#2e8540] hover:bg-[#246632] text-white py-3 rounded text-xs font-bold text-center shadow-md transition-all uppercase tracking-widest"
                >
                  Hubungi via WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}