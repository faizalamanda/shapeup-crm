"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'

export default function YCloudMessageEditor() {
  const [selectedTemplate, setSelectedTemplate] = useState({ name: 'NOTIFIKASI_ORDER_LUNAS', vars: 3, body: 'Halo {{1}}, pembayaran order {{2}} sebesar {{3}} telah kami terima.' })

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm text-[10px]">4</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">KONTEN PESAN (YCLOUD)</h3>
      </div>
      
      <Card>
        <div className="space-y-8">
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase mb-3 tracking-widest">PILIH TEMPLATE WHATSAPP</label>
            <select className="w-full p-4 border border-slate-300 rounded-xl font-bold text-xs uppercase shadow-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all bg-white">
              <option>NOTIFIKASI_ORDER_LUNAS (3 VARS)</option>
              <option>RESI_PENGIRIMAN (2 VARS)</option>
              <option>FOLLOW_UP_BELUM_BAYAR (2 VARS)</option>
            </select>
          </div>

          <div className="p-5 bg-slate-900 rounded-xl text-slate-300 font-mono text-[11px] leading-relaxed border-l-4 border-blue-500 shadow-inner">
            <span className="text-blue-400 font-black block mb-2 uppercase tracking-widest text-[9px]">Preview dari YCloud:</span>
            {selectedTemplate.body}
          </div>

          <div className="pt-6 border-t border-slate-100">
            <label className="block text-[11px] font-black text-slate-600 uppercase mb-6 tracking-widest text-center">ISI VARIABEL TEMPLATE</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array.from({ length: selectedTemplate.vars }).map((_, i) => (
                <div key={i} className="space-y-2 group">
                  <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest group-hover:text-blue-500 transition-colors">Variabel {"{{" + (i + 1) + "}}"}</label>
                  <div className="flex border border-slate-300 rounded-lg overflow-hidden shadow-sm transition-all focus-within:ring-2 focus-within:ring-blue-500">
                    <select className="bg-slate-50 px-3 py-2.5 text-[10px] font-black border-r border-slate-200 outline-none uppercase text-slate-700">
                      <option>DYNAMIC</option>
                      <option>CUSTOM</option>
                    </select>
                    <input type="text" className="px-4 py-2.5 text-[10px] font-bold outline-none flex-1 uppercase placeholder:text-slate-300" placeholder="PILIH FIELD / TEXT..." />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 pt-2 px-1">
        {['nama_cust', 'no_order', 'total', 'resi', 'kurir'].map(tag => (
          <span key={tag} className="px-2.5 py-1.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-bold text-slate-500 uppercase tracking-tight hover:bg-slate-900 hover:text-white transition-all cursor-pointer">
            {"{{" + tag + "}}"}
          </span>
        ))}
      </div>
    </section>
  )
}