"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'

const VARIABLES = [
  { key: 'customer_name', label: 'CUSTOMER: NAMA', type: 'text' },
  { key: 'customer_city', label: 'CUSTOMER: KOTA', type: 'text' },
  { key: 'total_spent', label: 'ORDER: TOTAL BELANJA', type: 'number' },
  { key: 'payment_method', label: 'ORDER: METODE BAYAR', type: 'text' },
  { key: 'last_contacted', label: 'LOG: TERAKHIR DIHUBUNGI', type: 'date' },
]

export default function AudienceSegmentBuilder() {
  const [filters, setFilters] = useState([{ id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }])

  const getOps = (key: string) => {
    const type = VARIABLES.find(v => v.key === key)?.type
    if (type === 'text') return ['is', 'is not', 'contains', 'starts with']
    if (type === 'number') return ['more than', 'less than', 'equal to', 'between']
    if (type === 'date') return ['before', 'after', 'on', 'more than (days)']
    return ['is']
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm text-[10px]">3</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">SEGMENTASI TARGETING</h3>
      </div>
      <Card className="bg-[#F8FAFC] border-slate-200">
        <div className="space-y-3">
          {filters.map((f, idx) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 animate-in slide-in-from-left-2 duration-300">
              {idx > 0 && (
                <button 
                  onClick={() => {
                    const newFilters = [...filters];
                    newFilters[idx].logic = f.logic === 'AND' ? 'OR' : 'AND';
                    setFilters(newFilters);
                  }} 
                  className={`px-3 py-1 text-[10px] font-black rounded uppercase min-w-[50px] transition-all shadow-sm ${f.logic === 'AND' ? 'bg-blue-600 text-white' : 'bg-orange-500 text-white'}`}
                >
                  {f.logic}
                </button>
              )}
              
              <div className="flex items-center bg-white border border-slate-300 rounded shadow-sm overflow-hidden flex-1 md:flex-none transition-all focus-within:ring-2 focus-within:ring-blue-500">
                <select value={f.key} onChange={(e) => {
                  const newFilters = [...filters];
                  newFilters[idx].key = e.target.value;
                  newFilters[idx].op = getOps(e.target.value)[0]; // Reset operator saat ganti variabel
                  setFilters(newFilters);
                }} className="bg-slate-50 px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 uppercase outline-none text-slate-800">
                  {VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
                
                <select value={f.op} onChange={(e) => {
                  const newFilters = [...filters];
                  newFilters[idx].op = e.target.value;
                  setFilters(newFilters);
                }} className="px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 text-blue-600 uppercase outline-none">
                  {getOps(f.key).map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                
                <input 
                  type="text" 
                  value={f.value}
                  onChange={(e) => {
                    const newFilters = [...filters];
                    newFilters[idx].value = e.target.value;
                    setFilters(newFilters);
                  }}
                  className="px-4 py-2.5 text-[11px] font-bold outline-none md:w-40 uppercase placeholder:text-slate-300" 
                  placeholder="VALUE" 
                />
                
                <button onClick={() => setFilters(filters.filter(item => item.id !== f.id))} className="px-4 py-2.5 bg-slate-50 text-slate-400 hover:text-red-600 border-l border-slate-200 transition-colors">✕</button>
              </div>

              {idx === filters.length - 1 && (
                <button onClick={() => setFilters([...filters, { id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }])} className="w-10 h-10 flex items-center justify-center rounded-lg border border-slate-300 bg-white font-black text-slate-600 hover:bg-slate-900 hover:text-white transition-all shadow-sm active:scale-95">+</button>
              )}
            </div>
          ))}
          <p className="text-[9px] text-slate-400 font-black uppercase mt-4 tracking-tighter">* HANYA KIRIM KE CUSTOMER YANG MEMENUHI SELURUH KRITERIA DI ATAS.</p>
        </div>
      </Card>
    </section>
  )
}