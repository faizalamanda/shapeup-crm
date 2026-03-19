"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'

export default function YCloudMessageEditor() {
  const [selectedTemplate, setSelectedTemplate] = useState({ name: 'NOTIFIKASI_ORDER', vars: 2, body: 'Halo {{1}}, order {{2}} sedang diproses.' })

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">4</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">KONTEN PESAN (YCLOUD)</h3>
      </div>
      <Card>
        <div className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">PILIH TEMPLATE</label>
            <select className="w-full p-3 border border-slate-300 rounded font-bold text-xs uppercase">
              <option>NOTIFIKASI_ORDER (2 VARS)</option>
              <option>RESI_PENGIRIMAN (3 VARS)</option>
            </select>
          </div>

          <div className="p-4 bg-slate-900 rounded-lg text-slate-400 font-mono text-[11px] border-l-4 border-blue-500">
            <span className="text-blue-400 block mb-1">PREVIEW:</span>
            {selectedTemplate.body}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-6">
            {Array.from({ length: selectedTemplate.vars }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <label className="text-[10px] font-black text-blue-600 uppercase tracking-tight">Variabel {"{{" + (i + 1) + "}}"}</label>
                <div className="flex border border-slate-300 rounded-md overflow-hidden shadow-sm">
                  <select className="bg-slate-50 px-2 py-2 text-[9px] font-black border-r outline-none">
                    <option>DYNAMIC</option><option>CUSTOM</option>
                  </select>
                  <input type="text" className="px-3 py-2 text-[10px] font-bold outline-none flex-1 uppercase" placeholder="PILIH FIELD..." />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </section>
  )
}