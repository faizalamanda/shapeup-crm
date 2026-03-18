"use client"
import { useState } from 'react'

export default function MarketingAutomation() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [scenarios, setScenarios] = useState([
    { id: 1, name: 'NOTIFIKASI ORDER COD (OK)', event: 'order_created', platform: 'YCloud', status: true, sent: 842 },
  ])

  return (
    <div className="p-10 font-sans antialiased text-slate-800">
      {/* Tombol Buat Skenario - Font Extrabold & Jelas */}
      <div className="flex justify-between items-center mb-12">
        <h1 className="text-4xl font-extrabold tracking-tight uppercase italic text-slate-900">
          Marketing <span className="text-blue-700">Automation</span>
        </h1>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-slate-900 hover:bg-blue-700 text-white px-10 py-5 rounded-md font-black text-sm uppercase tracking-widest shadow-2xl transition-all active:scale-95"
        >
          + Buat Skenario Baru
        </button>
      </div>

      {/* --- MODAL START --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
            
            {/* Modal Header */}
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 italic">Seting Skenario & Segmentasi</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-900 font-black text-xl">✕</button>
            </div>

            {/* Modal Body */}
            <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
              
              {/* Nama Skenario */}
              <div>
                <label className="block text-[12px] font-black uppercase tracking-widest text-slate-400 mb-3">Nama Skenario</label>
                <input type="text" placeholder="CONTOH: FOLLOW UP COD SEMARANG" className="w-full p-4 border-2 border-slate-100 rounded-lg focus:border-blue-600 outline-none text-lg font-bold uppercase tracking-tight" />
              </div>

              {/* Segmentasi Logic */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[12px] font-black uppercase tracking-widest text-slate-400 mb-3">Trigger Event</label>
                  <select className="w-full p-4 border-2 border-slate-100 rounded-lg font-bold text-slate-700 bg-white outline-none focus:border-blue-600 appearance-none">
                    <option>ORDER CREATED</option>
                    <option>ORDER COMPLETED</option>
                    <option>ORDER CANCELLED</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-black uppercase tracking-widest text-slate-400 mb-3">Platform</label>
                  <select className="w-full p-4 border-2 border-slate-100 rounded-lg font-bold text-slate-700 bg-white outline-none focus:border-blue-600 appearance-none">
                    <option>YCLOUD (WHATSAPP)</option>
                    <option>EMAIL (RESEND)</option>
                    <option>FONNTE (WA LOCAL)</option>
                  </select>
                </div>
              </div>

              {/* Advanced Segmentation Filter */}
              <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
                <p className="text-[11px] font-black uppercase tracking-widest text-blue-600 mb-4 italic">Target Segmentasi (Opsional)</p>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-slate-600 w-32">Min. Belanja:</span>
                    <input type="number" placeholder="Rp 0" className="flex-1 p-3 border border-slate-200 rounded-md font-black text-slate-800" />
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-slate-600 w-32">Wilayah/Kota:</span>
                    <input type="text" placeholder="SEMUA KOTA" className="flex-1 p-3 border border-slate-200 rounded-md font-bold uppercase" />
                  </div>
                </div>
              </div>

              {/* Pesan Template */}
              <div>
                <label className="block text-[12px] font-black uppercase tracking-widest text-slate-400 mb-3">Isi Pesan (Gunakan Variabel)</label>
                <textarea rows={4} placeholder="Halo {{nama}}, terima kasih sudah order..." className="w-full p-5 border-2 border-slate-100 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-600 leading-relaxed"></textarea>
                <div className="flex gap-2 mt-3">
                  {['{{nama}}', '{{total}}', '{{no_order}}'].map(tag => (
                    <span key={tag} className="text-[10px] font-black bg-blue-100 text-blue-700 px-2 py-1 rounded cursor-pointer hover:bg-blue-200 transition-colors">{tag}</span>
                  ))}
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-8 border-t border-slate-100 bg-slate-50 flex gap-4">
              <button className="flex-1 bg-slate-900 text-white py-4 rounded-xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all">Simpan Skenario</button>
              <button onClick={() => setIsModalOpen(false)} className="px-8 py-4 text-slate-400 font-bold uppercase tracking-widest hover:text-slate-900 transition-colors">Batal</button>
            </div>

          </div>
        </div>
      )}
      {/* --- MODAL END --- */}

      {/* Tabel Skenario Mas (Keep yang kemarin) */}
      {/* ... data tabel ... */}
    </div>
  )
}