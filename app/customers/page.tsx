"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function CustomerPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // States
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'order' | 'contact' | 'notes'>('order')
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Form State untuk Customer Baru
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    category: 'General',
    notes: ''
  })

  useEffect(() => {
    // Sementara kita gunakan data kosong untuk melihat Empty State
    // Jika ingin melihat data, isi array ini atau fetch dari Supabase
    setCustomers([]) 
    setLoading(false)
  }, [])

  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return (
    <div className="min-h-screen bg-[#fcfaf7] text-[#2e2e2e] font-sans p-4 md:p-12">
      <div className="max-w-6xl mx-auto">
        
        {/* HEADER SECTION */}
        <header className="border-b-2 border-slate-200 pb-8 mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">Pelanggan</h1>
            <p className="text-slate-500 text-sm mt-2 max-w-md">
              Kelola database aset bisnis Anda. Pantau loyalitas pelanggan melalui metrik LTV dan riwayat transaksi.
            </p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-[#2e8540] hover:bg-[#246632] text-white px-6 py-2.5 rounded shadow-sm font-bold text-sm transition-colors flex items-center gap-2"
          >
            <span>+</span> Tambah Pelanggan
          </button>
        </header>

        {/* CONDITION: LOADING */}
        {loading && (
          <div className="py-20 text-center text-slate-400 font-medium animate-pulse uppercase tracking-widest text-xs">
            Menyinkronkan Database...
          </div>
        )}

        {/* CONDITION: EMPTY STATE */}
        {!loading && customers.length === 0 && (
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-md p-16 md:p-24 text-center shadow-sm">
            <div className="w-20 h-20 bg-[#f8f9fa] border border-slate-200 rounded-full flex items-center justify-center mx-auto mb-8 text-slate-300">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-3">Mulai Bangun Database Pelanggan</h2>
            <p className="text-slate-500 max-w-md mx-auto mb-10 text-sm leading-relaxed">
              Belum ada data pelanggan. Database yang rapi memudahkan Anda melihat <span className="text-blue-600 font-bold italic">siapa pelanggan paling loyal</span> dan berapa rata-rata belanja mereka.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={() => setIsModalOpen(true)}
                className="bg-[#2e8540] hover:bg-[#246632] text-white px-8 py-3 rounded shadow-md font-bold text-sm transition-all"
              >
                + Tambah Pelanggan Pertama
              </button>
            </div>
          </div>
        )}

        {/* CONDITION: DATA EXISTS */}
        {!loading && customers.length > 0 && (
          <div className="bg-white border border-slate-300 shadow-sm rounded-md overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#f8f9fa] border-b border-slate-300 text-[11px] uppercase text-slate-500 font-bold tracking-widest">
                <tr>
                  <th className="px-8 py-4">Nama & Kontak</th>
                  <th className="px-8 py-4 text-center">Transaksi</th>
                  <th className="px-8 py-4">Metrik (LTV / AOV)</th>
                  <th className="px-8 py-4 text-center">Hubungi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {customers.map((c) => (
                  <tr 
                    key={c.id} 
                    className="hover:bg-[#fffdf0] cursor-pointer transition-colors group"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <td className="px-8 py-5">
                      <div className="font-bold text-blue-700 group-hover:underline text-base">{c.name}</div>
                      <div className="text-xs text-slate-500 font-medium mt-0.5">{c.phone}</div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <div className="text-sm font-bold text-slate-700">{c.order_count || 0}x Order</div>
                      <div className="text-[10px] text-slate-400 uppercase mt-1 tracking-tighter">Status: Aktif</div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-bold text-slate-800">{formatIDR(c.ltv || 0)}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">AOV: {formatIDR(c.ltv / c.order_count || 0)}</div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <a 
                        href={`https://wa.me/${c.phone}`} 
                        target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white px-4 py-2 rounded text-[10px] font-black transition-colors shadow-sm uppercase tracking-widest"
                      >
                        WhatsApp
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* FOOTER */}
        <footer className="mt-12 pt-6 border-t border-slate-200 flex justify-between items-center text-slate-400 text-[11px] font-bold uppercase tracking-widest">
          <div>Total: {customers.length} Pelanggan</div>
          <div className="italic">CRM System v1.0</div>
        </footer>
      </div>

      {/* DETAIL DRAWER / SLIDE-IN MODAL */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 pb-10 overflow-y-auto bg-[#2e2e2e]/70 backdrop-blur-[2px]" onClick={() => setSelectedCustomer(null)}>
          <div className="bg-white w-full max-w-4xl border border-slate-400 shadow-2xl rounded-sm relative mb-10" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="p-10 border-b border-slate-100 flex justify-between items-start bg-[#fcfaf7]">
              <div>
                <div className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.2em] mb-3 bg-blue-50 px-2 py-1 inline-block rounded">Detail Profil</div>
                <h2 className="text-4xl font-bold text-slate-900 tracking-tight">{selectedCustomer.name}</h2>
                <div className="flex items-center gap-4 mt-3 text-slate-500 text-sm font-medium">
                  <span>{selectedCustomer.phone}</span>
                  <span className="text-slate-300">|</span>
                  <span>{selectedCustomer.email || 'No Email'}</span>
                </div>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="text-slate-400 hover:text-red-600 font-bold text-xs tracking-widest uppercase bg-white border border-slate-200 px-4 py-2 rounded shadow-sm transition-all">[ Tutup ]</button>
            </div>

            {/* Modal Body */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
              {/* Content Area */}
              <div className="md:col-span-2 p-10 border-r border-slate-100">
                <div className="flex gap-10 border-b border-slate-200 mb-8">
                  {['order', 'contact', 'notes'].map((tab) => (
                    <button 
                      key={tab}
                      onClick={() => setActiveTab(tab as any)}
                      className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'border-b-4 border-yellow-400 text-slate-900' : 'text-slate-300 hover:text-slate-500'}`}
                    >
                      {tab === 'order' ? 'Riwayat Belanja' : tab === 'contact' ? 'Interaksi' : 'Catatan'}
                    </button>
                  ))}
                </div>

                {activeTab === 'order' && (
                  <div className="space-y-3">
                    <div className="flex justify-between p-4 border border-slate-200 rounded text-sm bg-slate-50 hover:bg-white transition-all cursor-default group">
                      <span className="font-bold text-slate-700">Order #1209 <span className="text-slate-400 font-normal ml-3 italic text-xs">14 Mar 2024</span></span>
                      <span className="font-bold text-slate-900">{formatIDR(1250000)}</span>
                    </div>
                    {/* Map data order di sini nantinya */}
                  </div>
                )}

                {activeTab === 'notes' && (
                  <div className="bg-[#fffde7] p-8 border-l-4 border-yellow-400 shadow-sm">
                    <p className="text-slate-800 text-sm leading-relaxed font-medium italic">
                      "{selectedCustomer.notes || 'Belum ada catatan khusus untuk pelanggan ini.'}"
                    </p>
                  </div>
                )}
              </div>

              {/* Sidebar Area */}
              <div className="p-10 bg-[#f9f9f9] space-y-10">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Alamat Lengkap</label>
                  <p className="text-xs font-bold leading-relaxed text-slate-600 bg-white p-4 border border-slate-200 rounded">
                    {selectedCustomer.address || 'Alamat belum diinput.'}
                  </p>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Statistik Nilai</label>
                  <div className="space-y-4">
                    <div className="flex justify-between text-xs font-bold py-2 border-b border-slate-200">
                      <span className="text-slate-400 font-medium tracking-tight">Total Belanja</span>
                      <span className="text-slate-900">{formatIDR(selectedCustomer.ltv || 0)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold py-2 border-b border-slate-200">
                      <span className="text-slate-400 font-medium tracking-tight">Rata-rata Order</span>
                      <span className="text-slate-900">{formatIDR(selectedCustomer.ltv / selectedCustomer.order_count || 0)}</span>
                    </div>
                  </div>
                </div>

                <a 
                  href={`https://wa.me/${selectedCustomer.phone}`}
                  target="_blank"
                  className="block w-full bg-[#2e8540] hover:bg-[#246632] text-white py-4 rounded text-[10px] font-black text-center shadow-md transition-all uppercase tracking-[0.2em]"
                >
                  Chat WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TAMBAH CUSTOMER (DUMMY UI) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-[#2e2e2e]/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md border-2 border-slate-400 rounded-sm shadow-2xl p-10">
            <h3 className="text-xl font-bold mb-6 tracking-tight">Tambah Pelanggan Baru</h3>
            <div className="space-y-4">
              <input type="text" placeholder="Nama Lengkap" className="w-full border border-slate-300 p-3 rounded-sm outline-none focus:border-blue-600 font-medium text-sm" />
              <input type="text" placeholder="No. WhatsApp (628...)" className="w-full border border-slate-300 p-3 rounded-sm outline-none focus:border-blue-600 font-medium text-sm" />
              <textarea placeholder="Alamat Pengiriman" className="w-full border border-slate-300 p-3 rounded-sm outline-none focus:border-blue-600 font-medium text-sm h-24" />
              <div className="flex gap-4 pt-4">
                <button onClick={() => setIsModalOpen(false)} className="flex-1 font-bold text-slate-400 text-xs uppercase tracking-widest hover:text-slate-600 transition-colors">Batal</button>
                <button className="flex-1 bg-[#2e8540] text-white py-3 rounded font-bold text-xs uppercase tracking-widest shadow-sm">Simpan</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}