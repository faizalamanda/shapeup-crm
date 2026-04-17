"use client"

// Kategori variabel yang mendukung Order & Customer sesuai request Toko Alamanda
const VARIABLES = [
  // GROUP: ORDER / COMPLETE
  { key: 'date_order', label: 'ORDER: TANGGAL PESANAN', type: 'date' },
  { key: 'date_completed', label: 'COMPLETE: TANGGAL SELESAI', type: 'date' },
  { key: 'order_status', label: 'ORDER: STATUS', type: 'select', options: ['completed', 'processing', 'pending', 'cancelled', 'on-hold'] },
  
  // GROUP: CUSTOMER & LIFESTYLE
  { key: 'customer_city', label: 'CUSTOMER: KOTA', type: 'text', placeholder: 'KOTA' },
  { key: 'total_spent', label: 'ORDER: TOTAL BELANJA', type: 'number', placeholder: 'RP' },
];

/**
 * FUNGSI GENERATOR SQL: Menghasilkan string untuk kolom sql_filter
 * Menggunakan prinsip "Sapu Bersih" (<=) agar data lama tetap terjaring
 */
export const generateSQLFilter = (filters: any[]) => {
  if (!filters || filters.length === 0) return "TRUE";

  return filters.map((f, idx) => {
    let sqlPart = "TRUE";
    
    // Mapping Key UI ke Kolom Database
    const columnMap: any = {
      order_status: "o.status",
      customer_city: "o.raw_source_data->'billing'->>'city'",
      total_spent: "(o.raw_source_data->>'total')::numeric",
      date_order: "o.created_at",
      date_completed: "o.date_completed"
    };

    const col = columnMap[f.key] || f.key;
    const val = f.value;

    // Logika Operator
    switch (f.op) {
      case 'is': 
      case 'equal':
      case 'equal to':
        sqlPart = `${col} = '${val}'`; break;
      case 'is not': 
        sqlPart = `${col} != '${val}'`; break;
      case 'contains': 
        sqlPart = `${col} ILIKE '%${val}%'`; break;
      case 'more than': 
        sqlPart = `${col} > ${val}`; break;
      case 'less than': 
        sqlPart = `${col} < ${val}`; break;
      case 'after': 
        sqlPart = `${col} > '${val}'`; break;
      case 'before': 
        sqlPart = `${col} < '${val}'`; break;
      case 'after_x_days': 
        // Sapu semua yang umurnya SUDAH LEBIH dari X hari
        sqlPart = `${col} <= (NOW() - interval '${val} days')`; 
        break;
      case 'after_x_hours': 
        // Sapu semua yang umurnya SUDAH LEBIH dari X jam
        sqlPart = `${col} <= (NOW() - interval '${val} hours')`;
        break;
      default: sqlPart = "TRUE";
    }

    return idx === 0 ? `(${sqlPart})` : `${f.logic || 'AND'} (${sqlPart})`;
  }).join(' ');
};

/**
 * FUNGSI GENERATOR JADWAL: Menghasilkan string untuk kolom scheduling_logic
 */
export const generateScheduling = (filters: any[]) => {
  const timeFilter = filters.find(f => f.op === 'after_x_days' || f.op === 'after_x_hours');
  
  if (timeFilter) {
    const col = timeFilter.key === 'date_completed' ? 'o.date_completed' : 'o.created_at';
    const unit = timeFilter.op === 'after_x_days' ? 'days' : 'hours';
    return `${col} + interval '${timeFilter.value} ${unit}'`;
  }

  return "NOW()";
};

export default function AudienceSegmentBuilder({ filters, setFilters }: any) {
  
  const getOps = (key: string) => {
    const field = VARIABLES.find(v => v.key === key)
    
    if (field?.type === 'date') {
      return [
        { id: 'equal', label: 'SAMA DENGAN' },
        { id: 'before', label: 'SEBELUM' },
        { id: 'after', label: 'SESUDAH' },
        { id: 'after_x_days', label: 'SETELAH X HARI' },
        { id: 'after_x_hours', label: 'SETELAH X JAM' }
      ]
    }
    
    if (field?.type === 'number') return [
      { id: 'equal to', label: 'EQUAL TO' },
      { id: 'more than', label: 'MORE THAN' },
      { id: 'less than', label: 'LESS THAN' }
    ]
    
    if (field?.type === 'select') return [
      { id: 'is', label: 'IS' },
      { id: 'is not', label: 'IS NOT' }
    ]

    return [
      { id: 'is', label: 'IS' },
      { id: 'contains', label: 'CONTAINS' },
      { id: 'is not', label: 'IS NOT' }
    ]
  }

  const addFilter = () => {
    setFilters([...filters, { 
      id: Date.now(), 
      key: 'order_status', 
      op: 'is', 
      value: 'on-hold', 
      logic: 'AND' 
    }])
  }

  const updateFilter = (id: number, field: string, val: string) => {
    setFilters(filters.map((f: any) => {
      if (f.id === id) {
        const updated = { ...f, [field]: val };
        if (field === 'key') {
          updated.op = getOps(val)[0].id;
          updated.value = '';
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
        const availableOps = getOps(f.key);

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
              <select 
                value={f.key} 
                onChange={(e) => updateFilter(f.id, 'key', e.target.value)} 
                className="bg-slate-50 px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 uppercase outline-none focus:bg-white"
              >
                {VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>

              <select 
                value={f.op} 
                onChange={(e) => updateFilter(f.id, 'op', e.target.value)} 
                className="px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 text-blue-600 uppercase outline-none bg-white"
              >
                {availableOps.map(op => <option key={op.id} value={op.id}>{op.label}</option>)}
              </select>

              {currentVar?.type === 'select' ? (
                <select 
                  value={f.value} 
                  onChange={(e) => updateFilter(f.id, 'value', e.target.value)}
                  className="px-4 py-2.5 text-[11px] font-black outline-none md:w-40 uppercase bg-white text-slate-700"
                >
                  <option value="">PILIH...</option>
                  {currentVar.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input 
                  type={f.op.includes('after_x') || currentVar?.type === 'number' ? 'number' : (currentVar?.type === 'date' ? 'date' : 'text')} 
                  value={f.value} 
                  onChange={(e) => updateFilter(f.id, 'value', e.target.value)} 
                  className="px-4 py-2.5 text-[11px] font-bold outline-none md:w-40 uppercase placeholder:text-slate-300" 
                  placeholder={f.op.includes('after_x') ? "NILAI" : (currentVar?.placeholder || "NILAI")} 
                />
              )}

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