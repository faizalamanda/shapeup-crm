"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'

export default function YCloudMessageEditor({ stepNumber }: { stepNumber: number }) {
  const [platform, setPlatform] = useState('YCLOUD')
  // State untuk variabel template {{1}}, {{2}}, dst.
  const [templateVars, setTemplateVars] = useState([{ id: 1, value: '' }])

  const addVar = () => {
    setTemplateVars([...templateVars, { id: templateVars.length + 1, value: '' }])
  }

  const removeVar = (id: number) => {
    if (templateVars.length > 0) {
      setTemplateVars(templateVars.filter(v => v.id !== id))
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">{stepNumber}</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">PENGIRIMAN PESAN</h3>
      </div>

      <Card>
        <div className="space-y-8">
          {/* PILIHAN PLATFORM */}
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase mb-3 tracking-widest">PILIH PLATFORM</label>
            <div className="flex gap-4">
              {['YCLOUD', 'EMAIL'].map((p) => (
                <button 
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`flex-1 p-4 rounded-xl border-2 font-black text-xs uppercase transition-all ${platform === p ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' : 'border-slate-100 text-slate-300'}`}
                >
                  {p} {p === 'EMAIL' && '(SOON)'}
                </button>
              ))}
            </div>
          </div>

          {platform === 'YCLOUD' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* NAMA TEMPLATE */}
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase mb-2 tracking-widest">NAMA TEMPLATE (YCLOUD)</label>
                <input 
                  type="text" 
                  className="w-full p-3 border border-slate-300 rounded-lg font-bold text-sm uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  placeholder="CONTOH: ORDER_NOTIFICATION_ID"
                />
              </div>

              {/* MANAJEMEN VARIABEL */}
              <div className="pt-6 border-t border-slate-100">
                <div className="flex justify-between items-center mb-4">
                  <label className="text-[11px] font-black text-slate-600 uppercase tracking-widest">VARIABEL TEMPLATE</label>
                  <button 
                    onClick={addVar}
                    className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black rounded uppercase hover:bg-blue-600 transition-all"
                  >
                    + TAMBAH VARIABEL
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templateVars.map((v, index) => (
                    <div key={v.id} className="space-y-1.5 animate-in slide-in-from-top-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black text-blue-600 uppercase">ISI VARIABEL {"{{" + (index + 1) + "}}"}</label>
                        <button onClick={() => removeVar(v.id)} className="text-[9px] font-bold text-red-400 hover:text-red-600">HAPUS</button>
                      </div>
                      <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden shadow-sm focus-within:ring-2 focus-within:ring-blue-500">
                        <select className="bg-slate-50 px-2 py-2 text-[9px] font-black border-r border-slate-200 outline-none text-slate-700">
                          <option>TAG DATA</option>
                          <option>MANUAL</option>
                        </select>
                        <input 
                          type="text" 
                          className="px-3 py-2 text-[11px] font-bold outline-none flex-1 uppercase" 
                          placeholder={`PILIH TAG UNTUK {{${index + 1}}}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                
                {templateVars.length === 0 && (
                  <div className="text-center py-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Tanpa Variabel (Hanya Header/Body Statis)</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* TAGS HELPER */}
      <div className="flex flex-wrap gap-2 px-2 pt-2">
        {['nama', 'no_order', 'total', 'link_bayar', 'kurir', 'resi'].map(tag => (
          <span key={tag} className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-[9px] font-bold text-slate-500 uppercase cursor-pointer hover:bg-slate-900 hover:text-white transition-all">
            {"{{" + tag + "}}"}
          </span>
        ))}
      </div>
    </section>
  )
}