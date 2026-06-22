import { useState } from 'react'

export interface FilterRule {
  id: string
  field: 'ltv' | 'aov' | 'total_order_count' | 'last_order_status' | 'last_order_date' | 'joined_at'
  operator: 'greater_or_equal' | 'less_or_equal' | 'equal' | 'after' | 'before' | 'is' | 'is_not'
  value: string
}

interface FilterBarProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  rules: FilterRule[]
  setRules: (rules: FilterRule[]) => void
  showCharts: boolean
  setShowCharts: (show: boolean) => void
  availableStatuses: string[]
}

const FIELD_OPTIONS = [
  { value: 'ltv', label: 'Total Belanja (LTV)', type: 'number' },
  { value: 'aov', label: 'Rata-rata Order (AOV)', type: 'number' },
  { value: 'total_order_count', label: 'Jumlah Order', type: 'number' },
  { value: 'last_order_status', label: 'Status Order Terakhir', type: 'select' },
  { value: 'last_order_date', label: 'Tanggal Order Terakhir', type: 'date' },
  { value: 'joined_at', label: 'Tanggal Bergabung', type: 'date' }
]

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: 'greater_or_equal', label: 'Lebih dari / sama dengan (>=)' },
    { value: 'less_or_equal', label: 'Kurang dari / sama dengan (<=)' },
    { value: 'equal', label: 'Sama dengan (=)' }
  ],
  date: [
    { value: 'after', label: 'Setelah tanggal' },
    { value: 'before', label: 'Sebelum tanggal' }
  ],
  select: [
    { value: 'is', label: 'Sama dengan' },
    { value: 'is_not', label: 'Tidak sama dengan' }
  ]
}

export function FilterBar({
  searchQuery,
  setSearchQuery,
  rules,
  setRules,
  showCharts,
  setShowCharts,
  availableStatuses
}: FilterBarProps) {
  const [showBuilder, setShowBuilder] = useState(false)

  // Predefined Presets
  const applyPreset = (presetName: string) => {
    const today = new Date('2026-06-22') // Current context time
    
    if (presetName === 'all') {
      setRules([])
    } else if (presetName === 'vip') {
      setRules([
        {
          id: Math.random().toString(),
          field: 'ltv',
          operator: 'greater_or_equal',
          value: '1000000'
        }
      ])
    } else if (presetName === 'churn') {
      // 60 days ago
      const sixtyDaysAgo = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)
      const dateStr = sixtyDaysAgo.toISOString().split('T')[0]
      setRules([
        {
          id: Math.random().toString(),
          field: 'last_order_date',
          operator: 'before',
          value: dateStr
        }
      ])
    } else if (presetName === 'high_aov') {
      setRules([
        {
          id: Math.random().toString(),
          field: 'aov',
          operator: 'greater_or_equal',
          value: '500000'
        }
      ])
    } else if (presetName === 'one_time') {
      setRules([
        {
          id: Math.random().toString(),
          field: 'total_order_count',
          operator: 'equal',
          value: '1'
        }
      ])
    }
  }

  const addRule = () => {
    const defaultField = 'ltv'
    const defaultType = 'number'
    const defaultOperator = OPERATOR_OPTIONS[defaultType][0].value as any
    
    setRules([
      ...rules,
      {
        id: Math.random().toString(),
        field: defaultField,
        operator: defaultOperator,
        value: ''
      }
    ])
    setShowBuilder(true)
  }

  const removeRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id))
  }

  const updateRule = (id: string, updates: Partial<FilterRule>) => {
    setRules(rules.map(r => {
      if (r.id === id) {
        const updated = { ...r, ...updates }
        
        // Reset operator & value if field changed
        if (updates.field) {
          const fieldType = FIELD_OPTIONS.find(f => f.value === updates.field)?.type || 'number'
          updated.operator = OPERATOR_OPTIONS[fieldType][0].value as any
          updated.value = fieldType === 'select' ? (availableStatuses[0] || '') : ''
        }
        return updated
      }
      return r
    }))
  }

  return (
    <div className="space-y-4 mb-8">
      {/* Search and Top Toggles */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Cari nama pelanggan, nomor hp..."
            className="w-full h-11 pl-10 pr-4 bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-sm font-medium transition-all shadow-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3.5 top-3 text-slate-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </div>

        {/* Action Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowBuilder(!showBuilder)}
            className={`h-11 px-5 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${
              showBuilder || rules.length > 0
                ? 'bg-blue-50 border-blue-200 text-blue-600'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 8.293A1 1 0 013 7.586V4z" />
            </svg>
            Segmentasi ({rules.length})
          </button>

          <button
            onClick={() => setShowCharts(!showCharts)}
            className={`h-11 px-5 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${
              showCharts
                ? 'bg-amber-50 border-amber-200 text-amber-600'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {showCharts ? 'Sembunyikan Grafik' : 'Tampilkan Grafik'}
          </button>
        </div>
      </div>

      {/* Preset Segments Quick Bar */}
      <div className="flex flex-wrap items-center gap-2 py-1">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-2">Preset:</span>
        <button
          onClick={() => applyPreset('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
            rules.length === 0
              ? 'bg-slate-900 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Semua Pelanggan
        </button>
        <button
          onClick={() => applyPreset('vip')}
          className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wide border border-blue-100 transition-colors"
        >
          💎 VIP Only (&ge;1jt)
        </button>
        <button
          onClick={() => applyPreset('churn')}
          className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold uppercase tracking-wide border border-red-100 transition-colors"
        >
          ⚠️ Churn Risk (&gt;60 hari)
        </button>
        <button
          onClick={() => applyPreset('high_aov')}
          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold uppercase tracking-wide border border-emerald-100 transition-colors"
        >
          💰 High AOV (&ge;500k)
        </button>
        <button
          onClick={() => applyPreset('one_time')}
          className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wide border border-amber-100 transition-colors"
        >
          👤 One-Time Buyer
        </button>
      </div>

      {/* Dynamic Segment Builder */}
      {(showBuilder || rules.length > 0) && (
        <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Segment Builder (Metorik Style)</h3>
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Filter pelanggan yang memenuhi semua kriteria di bawah ini</p>
            </div>
            {rules.length > 0 && (
              <button
                onClick={() => setRules([])}
                className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-700"
              >
                Hapus Semua Filter
              </button>
            )}
          </div>

          {rules.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-xs font-medium italic">
              Belum ada filter tambahan yang aktif. Klik "Tambah Kriteria" untuk memulai segmentasi.
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => {
                const selectedField = FIELD_OPTIONS.find(f => f.value === rule.field)
                const fieldType = selectedField?.type || 'number'
                const operators = OPERATOR_OPTIONS[fieldType]

                return (
                  <div key={rule.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    {/* Field selector */}
                    <select
                      value={rule.field}
                      onChange={(e) => updateRule(rule.id, { field: e.target.value as any })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 min-w-[180px]"
                    >
                      {FIELD_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>

                    {/* Operator selector */}
                    <select
                      value={rule.operator}
                      onChange={(e) => updateRule(rule.id, { operator: e.target.value as any })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 min-w-[180px]"
                    >
                      {operators.map((op) => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>

                    {/* Value Input */}
                    {fieldType === 'select' ? (
                      <select
                        value={rule.value}
                        onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
                      >
                        {availableStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={fieldType}
                        placeholder={fieldType === 'number' ? 'Contoh: 500000' : ''}
                        value={rule.value}
                        onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-500"
                      />
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => removeRule(rule.id)}
                      className="text-slate-400 hover:text-red-500 p-2 transition-colors self-end sm:self-auto"
                      title="Hapus filter ini"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <button
              onClick={addRule}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              Tambah Kriteria
            </button>
            <button
              onClick={() => setShowBuilder(false)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold uppercase tracking-wider"
            >
              Tutup Panel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}