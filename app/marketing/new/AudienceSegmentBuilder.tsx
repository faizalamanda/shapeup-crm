"use client"

const VARIABLES = [
  { key: 'customer_name', label: 'CUSTOMER: NAMA', type: 'text' },
  { key: 'customer_city', label: 'CUSTOMER: KOTA', type: 'text' },
  { key: 'total_spent', label: 'ORDER: TOTAL BELANJA', type: 'number' },
  { key: 'payment_method', label: 'ORDER: METODE BAYAR', type: 'text' },
];

export default function AudienceSegmentBuilder({ filters, setFilters }: any) {
  const getOps = (key: string) => {
    const type = VARIABLES.find(v => v.key === key)?.type
    if (type === 'text') return ['is', 'contains', 'is not']
    if (type === 'number') return ['more than', 'less than', 'equal to']
    return ['is']
  }

  const addFilter = () => setFilters([...filters, { id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }])
  const updateFilter = (id: number, field: string, val: string) => {
    setFilters(filters.map((f: any) => f.id === id ? { ...f, [field]: val } : f))
  }

  return (
    <div className="space-y-3 bg-[#F8FAFC] p-6 rounded-xl border border-slate-200 shadow-inner">
      {filters.map((f: any, idx: number) => (
        <div key={f.id} className="flex flex-wrap items-center gap-2 animate-in slide-in-from-left-2">
          {idx > 0 && (
            <button 
              onClick={() => updateFilter(f.id, 'logic', f.logic === 'AND' ? 'OR' : 'AND')}
              className={`px-3 py-1 text-[10px] font-black rounded uppercase min-w-[50px] shadow-sm ${f.logic === 'AND' ? 'bg-blue-600 text-white' : 'bg-orange-500 text-white'}`}
            >
              {f.logic}
            </button>
          )}
          <div className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden flex-1 md:flex-none">
            <select value={f.key} onChange={(e) => updateFilter(f.id, 'key', e.target.value)} className="bg-slate-50 px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 uppercase outline-none">
              {VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
            <select value={f.op} onChange={(e) => updateFilter(f.id, 'op', e.target.value)} className="px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 text-blue-600 uppercase outline-none">
              {getOps(f.key).map(op => <option key={op} value={op}>{op}</option>)}
            </select>
            <input type="text" value={f.value} onChange={(e) => updateFilter(f.id, 'value', e.target.value)} className="px-4 py-2.5 text-[11px] font-bold outline-none md:w-40 uppercase" placeholder="VALUE" />
            <button onClick={() => setFilters(filters.filter((item: any) => item.id !== f.id))} className="px-4 py-2.5 bg-slate-50 text-slate-400 hover:text-red-600 border-l border-slate-200">✕</button>
          </div>
        </div>
      ))}
      <div className="pt-2">
        <button onClick={addFilter} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-slate-300 bg-white text-[10px] font-black text-slate-500 hover:text-blue-600 uppercase transition-all">
          <span className="text-lg">+</span> TAMBAH FILTER SEGMENTASI
        </button>
      </div>
    </div>
  )
}