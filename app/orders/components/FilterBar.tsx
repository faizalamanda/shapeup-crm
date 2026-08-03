import { useState } from 'react'

export interface OrderFilterRule {
  id: string
  field: 'grand_total' | 'total_qty' | 'status' | 'payment_method' | 'order_date' | 'product_name' | 'source_platform'
  operator: 'greater_or_equal' | 'less_or_equal' | 'equal' | 'after' | 'before' | 'between' | 'is' | 'is_not' | 'in' | 'not_in' | 'contains'
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
  availableOrderSources: string[]
  availableProducts: string[]
}

const FIELD_OPTIONS = [
  { value: 'grand_total',     label: 'Total Belanja (Rp)',   type: 'number' },
  { value: 'total_qty',       label: 'Jumlah Item (Qty)',    type: 'number' },
  { value: 'status',          label: 'Status Pesanan',       type: 'select-status' },
  { value: 'payment_method',  label: 'Metode Pembayaran',    type: 'select-payment' },
  { value: 'order_date',      label: 'Tanggal Pesanan',      type: 'date'   },
  { value: 'product_name',    label: 'Nama / Segmen Produk', type: 'select-product' },
  { value: 'source_platform', label: 'Sumber Order',         type: 'select-source' },
]

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: 'greater_or_equal', label: '>= Lebih dari atau sama dengan' },
    { value: 'less_or_equal',    label: '<= Kurang dari atau sama dengan' },
    { value: 'equal',            label: '= Sama dengan' },
  ],
  date: [
    { value: 'between', label: '↔️ Rentang tanggal (s/d)' },
    { value: 'equal',   label: '= Pada tanggal' },
    { value: 'after',   label: '>= Pada / setelah tanggal' },
    { value: 'before',  label: '<= Pada / sebelum tanggal' },
  ],
  'select-status': [
    { value: 'is',     label: 'Adalah salah satu dari' },
    { value: 'is_not', label: 'Bukan salah satu dari' },
  ],
  'select-payment': [
    { value: 'is',     label: 'Adalah salah satu dari' },
    { value: 'is_not', label: 'Bukan salah satu dari' },
  ],
  'select-product': [
    { value: 'contains', label: 'Mengandung nama / kata' },
    { value: 'is',       label: 'Sama persis dengan' },
    { value: 'is_not',   label: 'Tidak mengandung' },
  ],
  'select-source': [
    { value: 'is',     label: 'Adalah salah satu dari' },
    { value: 'is_not', label: 'Bukan salah satu dari' },
  ],
}

const PRESETS = [
  { key: 'all',        label: 'Semua',                     emoji: '📦' },
  { key: 'this_month', label: 'Bulan Ini',                 emoji: '📅' },
  { key: 'last_month', label: 'Bulan Lalu',                emoji: '⏪' },
  { key: 'high_val',   label: 'High Value ≥500k',          emoji: '💰' },
  { key: 'cod',        label: 'Bayar COD',                 emoji: '🚚' },
  { key: 'completed',  label: 'Selesai / Completed',       emoji: '✅' },
  { key: 'pending',    label: 'Pending / Processing',      emoji: '⏳' },
  { key: 'woocommerce',label: 'WooCommerce',               emoji: '🌐' },
  { key: 'pos',        label: 'POS / Toko',                emoji: '🏪' },
]

function getDatePresetRange(preset: 'today' | 'this_month' | 'last_month' | 'last_7' | 'last_30' | 'this_year'): { op: string; val: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  const formatDate = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  if (preset === 'today') {
    const todayStr = formatDate(now)
    return { op: 'equal', val: todayStr }
  }

  if (preset === 'this_month') {
    const start = new Date(year, month, 1)
    const end = new Date(year, month + 1, 0)
    return { op: 'between', val: `${formatDate(start)},${formatDate(end)}` }
  }

  if (preset === 'last_month') {
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 0)
    return { op: 'between', val: `${formatDate(start)},${formatDate(end)}` }
  }

  if (preset === 'last_7') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    return { op: 'between', val: `${formatDate(start)},${formatDate(now)}` }
  }

  if (preset === 'last_30') {
    const start = new Date(now)
    start.setDate(now.getDate() - 29)
    return { op: 'between', val: `${formatDate(start)},${formatDate(now)}` }
  }

  if (preset === 'this_year') {
    const start = new Date(year, 0, 1)
    const end = new Date(year, 11, 31)
    return { op: 'between', val: `${formatDate(start)},${formatDate(end)}` }
  }

  return { op: 'between', val: '' }
}

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
  availableOrderSources,
  availableProducts,
}: FilterBarProps) {
  const [showBuilder, setShowBuilder] = useState(false)

  const applyPreset = (key: string) => {
    if (key === 'all') return setRules([])
    if (key === 'this_month') {
      const p = getDatePresetRange('this_month')
      return setRules([{ id: uid(), field: 'order_date', operator: p.op as any, value: p.val }])
    }
    if (key === 'last_month') {
      const p = getDatePresetRange('last_month')
      return setRules([{ id: uid(), field: 'order_date', operator: p.op as any, value: p.val }])
    }
    if (key === 'high_val') return setRules([{ id: uid(), field: 'grand_total', operator: 'greater_or_equal', value: '500000' }])
    if (key === 'cod') return setRules([{ id: uid(), field: 'payment_method', operator: 'is', value: 'cod' }])
    if (key === 'completed') return setRules([{ id: uid(), field: 'status', operator: 'is', value: 'completed' }])
    if (key === 'pending') return setRules([{ id: uid(), field: 'status', operator: 'is', value: 'pending,processing' }])
    if (key === 'woocommerce') return setRules([{ id: uid(), field: 'source_platform', operator: 'is', value: 'WooCommerce' }])
    if (key === 'pos') return setRules([{ id: uid(), field: 'source_platform', operator: 'is', value: 'POS' }])
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
        } else if (ft === 'select-source') {
          next.value = availableOrderSources[0] || 'WooCommerce'
        } else if (ft === 'date') {
          const res = getDatePresetRange('this_month')
          next.operator = res.op as any
          next.value = res.val
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

                const currentVals = rule.value ? rule.value.split(',').map(s => s.trim()) : []

                const togglePill = (valToToggle: string) => {
                  let next: string[]
                  const exists = currentVals.some(v => v.toLowerCase() === valToToggle.toLowerCase())
                  if (exists) {
                    next = currentVals.filter(v => v.toLowerCase() !== valToToggle.toLowerCase())
                  } else {
                    next = [...currentVals, valToToggle]
                  }
                  updateRule(rule.id, { value: next.join(',') })
                }
                
                return (
                  <div key={rule.id} style={{
                    display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-start',
                    background: 'var(--su-bg)', padding: '10px 12px', borderRadius: '8px',
                    border: '1px solid var(--su-border)',
                  }}>
                    <select value={rule.field} onChange={e => updateRule(rule.id, { field: e.target.value as any })} style={{ ...selectStyle, minWidth: '180px' }}>
                      {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    
                    <select value={rule.operator} onChange={e => updateRule(rule.id, { operator: e.target.value as any })} style={{ ...selectStyle, minWidth: '190px' }}>
                      {operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                    
                    {/* Value Field Component */}
                    {ft === 'select-status' ? (
                      <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {availableStatuses.map(s => {
                            const isSelected = currentVals.some(v => v.toLowerCase() === s.toLowerCase())
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => togglePill(s)}
                                style={{
                                  padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                                  fontSize: '11px', fontWeight: 700,
                                  border: isSelected ? '1px solid var(--su-primary)' : '1px solid var(--su-border)',
                                  background: isSelected ? 'var(--su-primary)' : 'white',
                                  color: isSelected ? 'white' : 'var(--su-text-muted)',
                                  transition: 'all 0.15s',
                                  boxShadow: isSelected ? '0 1px 2px rgba(37,99,235,0.2)' : 'none',
                                }}
                              >
                                {isSelected ? '✓ ' : '+ '}{s.toUpperCase()}
                              </button>
                            )
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
                          <button
                            type="button"
                            onClick={() => updateRule(rule.id, { value: availableStatuses.join(',') })}
                            style={{ border: 'none', background: 'none', color: 'var(--su-primary)', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                          >
                            Pilih Semua
                          </button>
                          <button
                            type="button"
                            onClick={() => updateRule(rule.id, { value: '' })}
                            style={{ border: 'none', background: 'none', color: 'var(--su-text-faint)', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                          >
                            Hapus Pilihan
                          </button>
                        </div>
                      </div>
                    ) : ft === 'select-source' ? (
                      <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {availableOrderSources.map(src => {
                            const isSelected = currentVals.some(v => v.toLowerCase() === src.toLowerCase())
                            return (
                              <button
                                key={src}
                                type="button"
                                onClick={() => togglePill(src)}
                                style={{
                                  padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                                  fontSize: '11px', fontWeight: 700,
                                  border: isSelected ? '1px solid var(--su-accent-dark)' : '1px solid var(--su-border)',
                                  background: isSelected ? 'var(--su-accent-light)' : 'white',
                                  color: isSelected ? 'var(--su-accent-dark)' : 'var(--su-text-muted)',
                                  transition: 'all 0.15s',
                                }}
                              >
                                {isSelected ? '✓ ' : '+ '}{src}
                              </button>
                            )
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
                          <button
                            type="button"
                            onClick={() => updateRule(rule.id, { value: availableOrderSources.join(',') })}
                            style={{ border: 'none', background: 'none', color: 'var(--su-primary)', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                          >
                            Pilih Semua
                          </button>
                          <button
                            type="button"
                            onClick={() => updateRule(rule.id, { value: '' })}
                            style={{ border: 'none', background: 'none', color: 'var(--su-text-faint)', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                          >
                            Hapus Pilihan
                          </button>
                        </div>
                      </div>
                    ) : ft === 'select-payment' ? (
                      <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {availablePaymentMethods.map(p => {
                            const isSelected = currentVals.some(v => v.toLowerCase() === p.toLowerCase())
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => togglePill(p)}
                                style={{
                                  padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                                  fontSize: '11px', fontWeight: 700,
                                  border: isSelected ? '1px solid #16A34A' : '1px solid var(--su-border)',
                                  background: isSelected ? '#F0FDF4' : 'white',
                                  color: isSelected ? '#16A34A' : 'var(--su-text-muted)',
                                  transition: 'all 0.15s',
                                }}
                              >
                                {isSelected ? '✓ ' : '+ '}{p.toUpperCase()}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : ft === 'select-product' ? (
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <input
                          type="text"
                          list="product-name-list"
                          placeholder="Ketik kata / pilih nama produk..."
                          value={rule.value}
                          onChange={e => updateRule(rule.id, { value: e.target.value })}
                          style={{ ...selectStyle, width: '100%' }}
                        />
                        <datalist id="product-name-list">
                          {availableProducts.map(p => <option key={p} value={p} />)}
                        </datalist>
                      </div>
                    ) : ft === 'date' ? (
                      <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {rule.operator === 'between' ? (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                              type="date"
                              value={rule.value.split(',')[0] || ''}
                              onChange={e => {
                                const parts = rule.value.split(',')
                                updateRule(rule.id, { value: `${e.target.value},${parts[1] || ''}` })
                              }}
                              style={{ ...selectStyle, flex: 1 }}
                            />
                            <span style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 600 }}>s/d</span>
                            <input
                              type="date"
                              value={rule.value.split(',')[1] || ''}
                              onChange={e => {
                                const parts = rule.value.split(',')
                                updateRule(rule.id, { value: `${parts[0] || ''},${e.target.value}` })
                              }}
                              style={{ ...selectStyle, flex: 1 }}
                            />
                          </div>
                        ) : (
                          <input
                            type="date"
                            value={rule.value.split(',')[0] || ''}
                            onChange={e => updateRule(rule.id, { value: e.target.value })}
                            style={{ ...selectStyle, width: '100%' }}
                          />
                        )}

                        {/* Quick Date Presets */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--su-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: '2px' }}>
                            Pintas:
                          </span>
                          {[
                            { label: '📅 Bulan Ini', preset: 'this_month' },
                            { label: '⏪ Bulan Lalu', preset: 'last_month' },
                            { label: '⚡ 7 Hari', preset: 'last_7' },
                            { label: '📊 30 Hari', preset: 'last_30' },
                            { label: '🎯 Hari Ini', preset: 'today' },
                            { label: '🗓️ Tahun Ini', preset: 'this_year' },
                          ].map(p => (
                            <button
                              key={p.preset}
                              type="button"
                              onClick={() => {
                                const res = getDatePresetRange(p.preset as any)
                                updateRule(rule.id, { operator: res.op as any, value: res.val })
                              }}
                              style={{
                                padding: '3px 8px', borderRadius: '5px', cursor: 'pointer',
                                fontSize: '10px', fontWeight: 700,
                                border: '1px solid var(--su-border)', background: 'white',
                                color: 'var(--su-text-muted)', transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--su-primary)'; (e.currentTarget as HTMLElement).style.color = 'var(--su-primary)' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--su-border)'; (e.currentTarget as HTMLElement).style.color = 'var(--su-text-muted)' }}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <input
                        type="number"
                        placeholder="Contoh: 150000"
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
                        alignSelf: 'center',
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

