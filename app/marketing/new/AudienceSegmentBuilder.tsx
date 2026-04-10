"use client"

// Kategori variabel yang mendukung Order & Customer (Non-Order)
const VARIABLES = [
  // GROUP: ORDER
  { key: 'order_status', label: 'ORDER: STATUS', type: 'select', options: ['completed', 'processing', 'pending', 'cancelled', 'on-hold'] },
  { key: 'days_since_completed', label: 'ORDER: HARI SETELAH SELESAI', type: 'number', placeholder: 'CONTOH: 14' },
  { key: 'total_spent', label: 'ORDER: TOTAL BELANJA', type: 'number', placeholder: 'RP' },
  { key: 'payment_method', label: 'ORDER: METODE BAYAR', type: 'text', placeholder: 'MISAL: COD' },
  
  // GROUP: CUSTOMER (NON-ORDER)
  { key: 'customer_name', label: 'CUSTOMER: NAMA', type: 'text', placeholder: 'NAMA' },
  { key: 'customer_city', label: 'CUSTOMER: KOTA', type: 'text', placeholder: 'KOTA' },
  { key: 'days_since_registration', label: 'CUSTOMER: UMUR AKUN (HARI)', type: 'number', placeholder: 'HARI' },
  { key: 'is_birthday', label: 'CUSTOMER: HARI INI ULANG TAHUN', type: 'boolean' },
];

export default function AudienceSegmentBuilder({ filters, setFilters }: any) {
  
  const getOps = (key: string) => {
    const field = VARIABLES.find(v => v.key === key)
    if (field?.type === 'number') return ['equal to', 'more than', 'less than']
    if (field?.type === 'select') return ['is', 'is not']
    if (field?.type === 'boolean') return ['is']
    return ['is', 'contains', 'is not']
  }

  const addFilter = () => {
    setFilters([...filters, { 
      id: Date.now(), 
      key: 'order_status', 
      op: 'is', 
      value: 'completed', 
      logic: 'AND' 
    }])
  }

  const updateFilter = (id: number, field: string, val: string) => {
    setFilters(filters.map((f: any) => {
      if (f.id === id) {
        const updated = { ...f, [field]: val };
        // Reset value jika key berubah agar tidak mismatch tipe data
        if (field === 'key') {
          const newVar = VARIABLES.find(v => v.key === val);
          updated.value = newVar?.type === 'boolean' ? 'true' : '';
          updated.op = getOps(val)[0];
        }
        return updated;
      }
      return f;
    }))
  }

  return (
    <div className="space-y-4 bg-[#F8FAFC] p-6 rounded-xl border border-slate-200 shadow-inner">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-4 bg-blue-600 rounded-full"></div>
        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Kriteria Segmentasi</h4>
      </div>

      {filters.map((f: any, idx: number) => {
        const currentVar = VARIABLES.find(v => v.key === f.key);

        return (
          <div key={f.id} className="flex flex-wrap items-center gap-2 animate-in slide-in-from-left-2">
            {idx > 0 && (
              <button 
                onClick={() => updateFilter(f.id, 'logic', f.logic === 'AND' ? 'OR' : 'AND')}
                className={`px-3 py-1 text-[10px] font-black rounded uppercase min-w-[50px] transition-all shadow-sm ${
                  f.logic === 'AND' ? 'bg-slate-900 text-white' : 'bg-blue-500 text-white'
                }`}
              >
                {f.logic}
              </button>
            )}

            <div className="flex items-center bg-white border border-slate-300 rounded-lg shadow-sm overflow-hidden flex-1 md:flex-none">
              {/* SELECT FIELD */}
              <select 
                value={f.key} 
                onChange={(e) => updateFilter(f.id, 'key', e.target.value)} 
                className="bg-slate-50 px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 uppercase outline-none focus:bg-white"
              >
                {VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>

              {/* SELECT OPERATOR */}
              <select 
                value={f.op} 
                onChange={(e) => updateFilter(f.id, 'op', e.target.value)} 
                className="px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 text-blue-600 uppercase outline-none bg-white"
              >
                {getOps(f.key).map(op => <option key={op} value={op}>{op}</option>)}
              </select>

              {/* DYNAMIC VALUE INPUT */}
              {currentVar?.type === 'select' ? (
                <select 
                  value={f.value} 
                  onChange={(e) => updateFilter(f.id, 'value', e.target.value)}
                  className="px-4 py-2.5 text-[11px] font-black outline-none md:w-40 uppercase bg-white text-slate-700"
                >
                  {currentVar.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : currentVar?.type === 'boolean' ? (
                <select 
                  value={f.value} 
                  onChange={(e) => updateFilter(f.id, 'value', e.target.value)}
                  className="px-4 py-2.5 text-[11px] font-black outline-none md:w-40 uppercase bg-white text-slate-700"
                >
                  <option value="true">YES</option>
                  <option value="false">NO</option>
                </select>
              ) : (
                <input 
                  type={currentVar?.type === 'number' ? 'number' : 'text'} 
                  value={f.value} 
                  onChange={(e) => updateFilter(f.id, 'value', e.target.value)} 
                  className="px-4 py-2.5 text-[11px] font-bold outline-none md:w-40 uppercase placeholder:text-slate-300" 
                  placeholder={currentVar?.placeholder || "VALUE"} 
                />
              )}

              {/* DELETE BUTTON */}
              <button 
                onClick={() => setFilters(filters.filter((item: any) => item.id !== f.id))} 
                className="px-4 py-2.5 bg-slate-50 text-slate-400 hover:text-red-600 border-l border-slate-200 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}

      <div className="pt-2">
        <button 
          onClick={addFilter} 
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-slate-300 bg-white text-[10px] font-black text-slate-500 hover:border-blue-500 hover:text-blue-600 uppercase transition-all shadow-sm"
        >
          <span className="text-sm">+</span> TAMBAH KRITERIA BARU
        </button>
      </div>
    </div>
  )
}