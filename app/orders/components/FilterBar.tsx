import { useState } from 'react'

export interface OrderFilterRule {
  id: string
  field: 'grand_total' | 'total_qty' | 'status' | 'payment_method' | 'order_date'
  operator: 'greater_or_equal' | 'less_or_equal' | 'equal' | 'after' | 'before' | 'is' | 'is_not'
  value: string
}

interface FilterBarProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  rules: OrderFilterRule[]
  setRules: (rules: OrderFilterRule[]) => void
  showCharts: boolean
  setShowCharts: (show: boolean) => void
  availableStatuses: string[]
  availablePaymentMethods: string[]
}

const FIELD_OPTIONS = [
  { value: 'grand_total',    label: 'Total Belanja',       type: 'number' },
  { value: 'total_qty',       label: 'Jumlah Item (Qty)',   type: 'number' },
  { value: 'status',          label: 'Status Pesanan',      type: 'select-status' },
  { value: 'payment_method',  label: 'Metode Pembayaran',   type: 'select-payment' },
  { value: 'order_date',      label: 'Tanggal Pesanan',     type: 'date'   },
]

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: 'greater_or_equal', label: '>= Lebih dari sama dengan' },
    { value: 'less_or_equal',    label: '<= Kurang dari sama dengan' },
    { value: 'equal',            label: '= Sama dengan' },
  ],
  date: [
    { value: 'after',  label: 'Setelah tanggal' },
    { value: 'before', label: 'Sebelum tanggal' },
  ],
  'select-status': [
    { value: 'is',     label: 'Sama dengan' },
    { value: 'is_not', label: 'Tidak sama dengan' },
  ],
  'select-payment': [
    { value: 'is',     label: 'Sama dengan' },
    { value: 'is_not', label: 'Tidak sama dengan' },
  ],
}

const PRESETS = [
  { key: 'all',      label: 'Semua',                     emoji: '📦' },
  { key: 'high_val', label: 'High Value ≥500k',          emoji: '💰' },
  { key: 'cod',      label: 'Bayar COD',                 emoji: '🚚' },
  { key: 'completed',label: 'Selesai / Completed',       emoji: '✅' },
  { key: 'pending',  label: 'Pending / Processing',      emoji: '⏳' },
]

const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  padding: '6px 12px', borderRadius: '7px', cursor: 'pointer',
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
  textTransform: 'uppercase', transition: 'all 0.15s',
  border: '1px solid var(--su-border)', background: 'white',
  color: 'var(--su-text-muted)',
}

export function FilterBar({
  searchQuery, setSearchQuery,
  rules, setRules,
  showCharts, setShowCharts,
  availableStatuses,
  availablePaymentMethods,
}: FilterBarProps) {
  const [showBuilder, setShowBuilder] = useState(false)

  const applyPreset = (key: string) => {
    if (key === 'all') return setRules([])
    if (key === 'high_val') return setRules([{ id: uid(), field: 'grand_total', operator: 'greater_or_equal', value: '500000' }])
    if (key === 'cod') return setRules([{ id: uid(), field: 'payment_method', operator: 'is', value: 'cod' }])
    if (key === 'completed') return setRules([{ id: uid(), field: 'status', operator: 'is', value: 'completed' }])
    if (key === 'pending') return setRules([{ id: uid(), field: 'status', operator: 'is_not', value: 'completed' }])
  }

  const addRule = () => {
    setRules([...rules, { id: uid(), field: 'grand_total', operator: 'greater_or_equal', value: '' }])
    setShowBuilder(true)
  }

  const removeRule = (id: string) => setRules(rules.filter(r => r.id !== id))

  const updateRule = (id: string, updates: Partial<OrderFilterRule>) => {
    setRules(rules.map(r => {
      if (r.id !== id) return r
      const next = { ...r, ...updates }
      if (updates.field) {
        const fieldOpt = FIELD_OPTIONS.find(f => f.value === updates.field)
        const ft = fieldOpt?.type || 'number'
        next.operator = OPERATOR_OPTIONS[ft][0].value as any
        
        if (ft === 'select-status') {
          next.value = availableStatuses[0] || 'completed'
        } else if (ft === 'select-payment') {
          next.value = availablePaymentMethods[0] || 'cod'
        } else {
          next.value = ''
        }
      }
      return next
    }))
  }

  return (
    <div style={{ marginBottom: '24px' }}>

      {/* ── Row 1: Search + Toggles ─────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>

        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <input
            type="text"
            placeholder="Cari pelanggan, nomor HP, nomor order (#)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', height: '38px',
              paddingLeft: '36px', paddingRight: '12px',
              background: 'white', border: '1px solid var(--su-border)',
              borderRadius: '8px', outline: 'none',
              fontSize: '13px', fontWeight: 400, color: 'var(--su-text)',
              transition: 'border-color 0.15s',
              boxSizing: 'border-box',
            }}
            onFocus={e => { (e.currentTarget).style.borderColor = 'var(--su-primary)' }}
            onBlur={e => { (e.currentTarget).style.borderColor = 'var(--su-border)' }}
          />
          <svg
            style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--su-text-faint)' }}
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>

        {/* Segment builder toggle */}
        <button
          onClick={() => setShowBuilder(!showBuilder)}
          style={{
            ...btnBase,
            background: showBuilder || rules.length > 0 ? 'var(--su-primary-light)' : 'white',
            borderColor: showBuilder || rules.length > 0 ? 'rgba(37,99,235,0.25)' : 'var(--su-border)',
            color: showBuilder || rules.length > 0 ? 'var(--su-primary)' : 'var(--su-text-muted)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          Segmentasi {rules.length > 0 && <span style={{ background: 'var(--su-primary)', color: 'white', borderRadius: '99px', padding: '0 5px', fontSize: '9px' }}>{rules.length}</span>}
        </button>

        {/* Charts toggle */}
        <button
          onClick={() => setShowCharts(!showCharts)}
          style={{
            ...btnBase,
            background: showCharts ? 'var(--su-accent-light)' : 'white',
            borderColor: showCharts ? 'rgba(245,158,11,0.3)' : 'var(--su-border)',
            color: showCharts ? 'var(--su-accent-dark)' : 'var(--su-text-muted)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          {showCharts ? 'Sembunyikan Grafik' : 'Lihat Grafik'}
        </button>
      </div>

      {/* ── Row 2: Preset Chips ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--su-text-faint)', marginRight: '4px' }}>
          Preset:
        </span>
        {PRESETS.map(p => {
          return (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              style={{
                ...btnBase,
                padding: '5px 10px',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--su-text)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white'; (e.currentTarget as HTMLElement).style.color = 'var(--su-text-muted)' }}
            >
              {p.emoji} {p.label}
            </button>
          )
        })}
      </div>

      {/* ── Segment Builder Panel ────────────────────────────────────────── */}
      {(showBuilder || rules.length > 0) && (
        <div style={{
          marginTop: '12px', padding: '16px 20px',
          background: 'white', border: '1px solid var(--su-border)',
          borderRadius: '10px', boxShadow: 'var(--su-shadow-sm)',
        }} className="su-fade-in">

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--su-text)' }}>
                Order Segment Builder
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--su-text-faint)' }}>
                Tampilkan pesanan yang memenuhi seluruh kriteria
              </p>
            </div>
            {rules.length > 0 && (
              <button
                onClick={() => setRules([])}
                style={{ fontSize: '10px', fontWeight: 700, color: 'var(--su-danger)', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
              >
                Hapus Semua
              </button>
            )}
          </div>

          {rules.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--su-text-faint)', fontSize: '12px', fontStyle: 'italic', padding: '12px 0' }}>
              Belum ada kriteria. Klik "Tambah Kriteria" untuk mulai menyaring pesanan.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rules.map(rule => {
                const fieldOpt = FIELD_OPTIONS.find(f => f.value === rule.field)
                const ft = fieldOpt?.type || 'number'
                const operators = OPERATOR_OPTIONS[ft] || []
                
                const selectStyle: React.CSSProperties = {
                  padding: '7px 10px', borderRadius: '7px',
                  border: '1px solid var(--su-border)', background: 'white',
                  fontSize: '12px', color: 'var(--su-text)', outline: 'none',
                  fontWeight: 500,
                }
                
                return (
                  <div key={rule.id} style={{
                    display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
                    background: 'var(--su-bg)', padding: '10px 12px', borderRadius: '8px',
                    border: '1px solid var(--su-border)',
                  }}>
                    <select value={rule.field} onChange={e => updateRule(rule.id, { field: e.target.value as any })} style={{ ...selectStyle, minWidth: '180px' }}>
                      {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    
                    <select value={rule.operator} onChange={e => updateRule(rule.id, { operator: e.target.value as any })} style={{ ...selectStyle, minWidth: '180px' }}>
                      {operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                    
                    {ft === 'select-status' ? (
                      <select value={rule.value} onChange={e => updateRule(rule.id, { value: e.target.value })} style={{ ...selectStyle, flex: 1 }}>
                        {availableStatuses.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                      </select>
                    ) : ft === 'select-payment' ? (
                      <select value={rule.value} onChange={e => updateRule(rule.id, { value: e.target.value })} style={{ ...selectStyle, flex: 1 }}>
                        {availablePaymentMethods.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                      </select>
                    ) : (
                      <input
                        type={ft}
                        placeholder={ft === 'number' ? 'Contoh: 150000' : ''}
                        value={rule.value}
                        onChange={e => updateRule(rule.id, { value: e.target.value })}
                        style={{ ...selectStyle, flex: 1, minWidth: '140px' }}
                      />
                    )}
                    
                    <button
                      onClick={() => removeRule(rule.id)}
                      title="Hapus kriteria ini"
                      style={{
                        padding: '7px', borderRadius: '7px', cursor: 'pointer',
                        background: 'none', border: '1px solid var(--su-border)',
                        color: 'var(--su-text-faint)', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--su-danger)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--su-danger)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--su-text-faint)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--su-border)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--su-border)' }}>
            <button
              onClick={addRule}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
                background: 'var(--su-primary)', color: 'white', border: 'none',
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-primary-dark)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-primary)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Tambah Kriteria
            </button>
            <button
              onClick={() => setShowBuilder(false)}
              style={{ fontSize: '11px', fontWeight: 600, color: 'var(--su-text-faint)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function uid() { return Math.random().toString(36).slice(2) }
