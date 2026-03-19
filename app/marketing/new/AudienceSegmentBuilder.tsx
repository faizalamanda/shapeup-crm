"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'

const VARIABLES = [
  { key: 'customer_name', label: 'CUSTOMER: NAMA', type: 'text' },
  { key: 'total_spent', label: 'ORDER: TOTAL BELANJA', type: 'number' },
  { key: 'last_contacted', label: 'LOG: TERAKHIR DIHUBUNGI', type: 'date' },
]

export default function AudienceSegmentBuilder() {
  const [filters, setFilters] = useState([{ id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }])

  const getOps = (key: string) => {
    const type = VARIABLES.find(v => v.key === key)?.type
    if (type === 'text') return ['is', 'contains', 'is not']
    if (type === 'number') return ['more than', 'less than', 'equal to']
    if (type === 'date') return ['before', 'after', 'on', 'more than (days ago)']
    return ['is']
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">3</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">SEGMENTASI AUDIENCE</h3>
      </div>
      <Card className="bg-slate-50 border-slate-200">
        <div className="space-y-3">
          {filters.map((f, idx) => (
            <div key={f.id} className="flex items-center gap-2 animate-in slide-in-from-left-2">
              {idx > 0 && (
                <button onClick={() => {
                  const newFilters = [...filters];
                  newFilters[idx].logic = f.logic === 'AND' ? 'OR' : 'AND';
                  setFilters(newFilters);
                }} className={`px-3 py-1 text-[10px] font-black rounded uppercase ${f.logic === 'AND' ? 'bg-blue-600 text-white' : 'bg-orange-500 text-white'}`}>
                  {f.logic}
                </button>
              )}
              <div className="flex bg-white border border-slate-300 rounded shadow-sm overflow-hidden flex-1">
                <select value={f.key} onChange={(e) => {
                  const newFilters = [...filters];
                  newFilters[idx].key = e.target.value;
                  setFilters(newFilters);
                }} className="bg-slate-50 px-3 py-2 text-[10px] font-bold border-r uppercase outline-none">
                  {VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
                <select className="px-3 py-2 text-[10px] font-bold border-r text-blue-600 uppercase outline-none">
                  {getOps(f.key).map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input type="text" className="px-3 py-2 text-[10px] font-bold outline-none flex-1 uppercase" placeholder="VALUE" />
                <button onClick={() => setFilters(filters.filter(item => item.id !== f.id))} className="px-3 py-2 text-slate-400 hover:text-red-600 border-l">✕</button>
              </div>
              {idx === filters.length - 1 && (
                <button onClick={() => setFilters([...filters, { id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }])} className="w-8 h-8 rounded border bg-white font-bold hover:bg-slate-900 hover:text-white">+</button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}