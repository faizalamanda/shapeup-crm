"use client"
import { Card } from '@/components/ui/Card'

export default function YCloudMessageEditor({ templateName, setTemplateName, templateVars, setTemplateVars }: any) {
  const addVar = () => setTemplateVars([...templateVars, { id: Date.now(), value: '', source: 'TAG' }])
  const updateVar = (id: number, field: string, val: string) => {
    setTemplateVars(templateVars.map((v: any) => v.id === id ? { ...v, [field]: val } : v))
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">3</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">PENGIRIMAN PESAN (YCLOUD)</h3>
      </div>
      <Card>
        <div className="space-y-6">
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase mb-2 tracking-widest text-center md:text-left">NAMA TEMPLATE</label>
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} type="text" className="w-full p-3 border border-slate-300 rounded-lg font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="CONTOH: ORDER_NOTIF_ID" />
          </div>
          <div className="pt-6 border-t border-slate-100">
            <div className="flex justify-between items-center mb-4">
              <label className="text-[11px] font-black text-slate-600 uppercase tracking-widest">VARIABEL TEMPLATE</label>
              <button onClick={addVar} className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black rounded uppercase hover:bg-blue-600 transition-all">+ TAMBAH</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templateVars.map((v: any, index: number) => (
                <div key={v.id} className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px] font-black text-blue-600 uppercase">
                    <span>VARIABEL {"{{" + (index + 1) + "}}"}</span>
                    <button onClick={() => setTemplateVars(templateVars.filter((item: any) => item.id !== v.id))} className="text-red-400 hover:text-red-600">HAPUS</button>
                  </div>
                  <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 shadow-sm">
                    <select value={v.source} onChange={(e) => updateVar(v.id, 'source', e.target.value)} className="bg-slate-50 px-2 text-[9px] font-black border-r outline-none uppercase">
                      <option value="TAG">TAG</option><option value="MANUAL">MANUAL</option>
                    </select>
                    <input type="text" value={v.value} onChange={(e) => updateVar(v.id, 'value', e.target.value)} className="px-3 py-2 text-[11px] font-bold outline-none flex-1" placeholder="PILIH TAG / TEXT..." />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </section>
  )
}