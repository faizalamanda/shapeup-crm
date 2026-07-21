"use client"
import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export interface FilterRule {
  id: string
  field: 'ltv' | 'aov' | 'total_order_count' | 'days_since_last_order' | 'last_order_status' | 'last_order_date' | 'joined_at' | 'rfm_segment'
  operator: 'greater_or_equal' | 'less_or_equal' | 'equal' | 'greater' | 'less' | 'after' | 'before' | 'between' | 'is' | 'is_not'
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
  businessId: string
  userId: string
}

const FIELD_OPTIONS = [
  { value: 'ltv',                   label: 'Total Belanja (LTV)',         type: 'number' },
  { value: 'aov',                   label: 'Rata-rata Order (AOV)',       type: 'number' },
  { value: 'total_order_count',     label: 'Jumlah Order',                type: 'number' },
  { value: 'days_since_last_order', label: 'Hari Sejak Order Terakhir',    type: 'number' },
  { value: 'rfm_segment',           label: 'Segmen RFM',                  type: 'rfm_select' },
  { value: 'last_order_status',     label: 'Status Order Terakhir',       type: 'select' },
  { value: 'last_order_date',       label: 'Tanggal Order Terakhir',      type: 'date'   },
  { value: 'joined_at',             label: 'Tanggal Bergabung',           type: 'date'   },
]

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: 'greater_or_equal', label: '>= Lebih dari sama dengan' },
    { value: 'less_or_equal',    label: '<= Kurang dari sama dengan' },
    { value: 'equal',            label: '= Sama dengan' },
    { value: 'greater',          label: '> Lebih besar dari' },
    { value: 'less',             label: '< Lebih kecil dari' },
    { value: 'between',          label: 'Di antara (min, max)' },
  ],
  date: [
    { value: 'after',            label: 'Setelah tanggal' },
    { value: 'before',           label: 'Sebelum tanggal' },
    { value: 'between',          label: 'Di antara tanggal' },
  ],
  select: [
    { value: 'is',               label: 'Sama dengan' },
    { value: 'is_not',           label: 'Tidak sama dengan' },
  ],
  rfm_select: [
    { value: 'is',               label: 'Sama dengan' },
    { value: 'is_not',           label: 'Tidak sama dengan' },
  ],
}

const RFM_SEGMENTS = [
  { value: 'vip',      label: 'VIP (LTV ≥ 1jt & Order ≥ 2)' },
  { value: 'loyal',    label: 'Loyal (Order ≥ 3 & Aktif ≤ 30 hari)' },
  { value: 'new',      label: 'Pelanggan Baru (1 Order & Aktif ≤ 30 hari)' },
  { value: 'regular',  label: 'Regular Customer' },
  { value: 'at_risk',  label: 'At Risk (Belum Order > 60 hari)' },
  { value: 'churned',  label: 'Churned (Belum Order > 90 hari)' },
  { value: 'one_time', label: 'One-Timer (1 Order & Belum Order > 30 hari)' },
  { value: 'lost',     label: 'Lost (0 Order)' },
]

const DEFAULT_PRESETS = [
  { key: 'all',      label: 'Semua Pelanggan', emoji: '👥', rules: [] },
  { key: 'vip',      label: 'VIP Segment',      emoji: '💎', rules: [{ field: 'ltv', operator: 'greater_or_equal', value: '1000000' }] },
  { key: 'loyal',    label: 'Loyal & Aktif',    emoji: '🔥', rules: [{ field: 'rfm_segment', operator: 'is', value: 'loyal' }] },
  { key: 'new',      label: 'Baru Bergabung',   emoji: '🌱', rules: [{ field: 'rfm_segment', operator: 'is', value: 'new' }] },
  { key: 'churn',    label: 'Churn Risk (60h)', emoji: '⚠️', rules: [{ field: 'days_since_last_order', operator: 'greater_or_equal', value: '60' }] },
  { key: 'one_time', label: 'One-Timer',        emoji: '👤', rules: [{ field: 'total_order_count', operator: 'equal', value: '1' }] },
]

const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
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
  businessId,
  userId,
}: FilterBarProps) {
  const [showBuilder, setShowBuilder] = useState(false)
  const [savedPresets, setSavedPresets] = useState<any[]>([])
  const [activePresetKey, setActivePresetKey] = useState<string>('all')

  // Save preset Modal & State
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetEmoji, setPresetEmoji] = useState('🔖')
  const [isSaving, setIsSaving] = useState(false)

  // Notification Toast State
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type })
    setTimeout(() => {
      setToast(null)
    }, 4000)
  }, [])

  // Fetch saved presets from Supabase
  const fetchSavedPresets = useCallback(async () => {
    if (!businessId || !userId) return
    try {
      const { data, error } = await supabase
        .from('customer_segment_presets')
        .select('*')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setSavedPresets(data || [])
    } catch (err: any) {
      console.error('Error fetching presets:', err.message)
    }
  }, [businessId, userId, supabase])

  useEffect(() => {
    fetchSavedPresets()
  }, [fetchSavedPresets])

  // Apply default or custom preset
  const handleApplyPreset = (presetKey: string, presetRules: any[]) => {
    setActivePresetKey(presetKey)
    // Map rule inputs to have random IDs
    const newRules = presetRules.map(r => ({
      id: uid(),
      field: r.field,
      operator: r.operator,
      value: r.value
    }))
    setRules(newRules)
    showToast(`Segmen "${DEFAULT_PRESETS.find(p => p.key === presetKey)?.label || savedPresets.find(p => p.id === presetKey)?.name || 'Custom'}" diterapkan.`)
  }

  // Save current segmentation rule list
  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!presetName.trim()) {
      showToast('Nama preset tidak boleh kosong!', 'error')
      return
    }
    if (!businessId || !userId) {
      showToast('Autentikasi tidak valid. Coba refresh halaman.', 'error')
      return
    }

    setIsSaving(true)
    try {
      // Serialize rules without dynamic IDs
      const serializedRules = rules.map(({ field, operator, value }) => ({ field, operator, value }))

      const { data, error } = await supabase
        .from('customer_segment_presets')
        .insert({
          business_id: businessId,
          user_id: userId,
          name: presetName,
          emoji: presetEmoji,
          rules: serializedRules
        })
        .select()
        .single()

      if (error) throw error

      showToast(`Preset "${presetName}" berhasil disimpan!`, 'success')
      setPresetName('')
      setShowSaveModal(false)
      fetchSavedPresets()
      if (data) {
        setActivePresetKey(data.id)
      }
    } catch (err: any) {
      showToast(`Gagal menyimpan preset: ${err.message}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // Delete custom preset
  const handleDeletePreset = async (presetId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Hapus preset "${name}"?`)) return

    try {
      const { error } = await supabase
        .from('customer_segment_presets')
        .delete()
        .eq('id', presetId)

      if (error) throw error

      showToast(`Preset "${name}" berhasil dihapus.`, 'success')
      if (activePresetKey === presetId) {
        setActivePresetKey('all')
        setRules([])
      }
      fetchSavedPresets()
    } catch (err: any) {
      showToast(`Gagal menghapus preset: ${err.message}`, 'error')
    }
  }

  const addRule = () => {
    setRules([...rules, { id: uid(), field: 'ltv', operator: 'greater_or_equal', value: '' }])
    setShowBuilder(true)
    setActivePresetKey('custom')
  }

  const removeRule = (id: string) => {
    const nextRules = rules.filter(r => r.id !== id)
    setRules(nextRules)
    setActivePresetKey('custom')
  }

  const updateRule = (id: string, updates: Partial<FilterRule>) => {
    setActivePresetKey('custom')
    setRules(rules.map(r => {
      if (r.id !== id) return r
      const next = { ...r, ...updates }
      if (updates.field) {
        const ft = FIELD_OPTIONS.find(f => f.value === updates.field)?.type || 'number'
        next.operator = OPERATOR_OPTIONS[ft][0].value as any
        if (ft === 'select') {
          next.value = availableStatuses[0] || 'completed'
        } else if (ft === 'rfm_select') {
          next.value = 'vip'
        } else {
          next.value = ''
        }
      }
      return next
    }))
  }

  return (
    <div style={{ marginBottom: '24px', position: 'relative' }}>

      {/* ── Toast Notification ────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          background: toast.type === 'success' ? 'var(--su-success-light)' : 'var(--su-danger-light)',
          border: `1px solid ${toast.type === 'success' ? 'var(--su-success)' : 'var(--su-danger)'}`,
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: 'var(--su-shadow-lg)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }} className="su-fade-in">
          <span style={{ fontSize: '16px' }}>{toast.type === 'success' ? '✨' : '❌'}</span>
          <span style={{
            fontSize: '12px',
            fontWeight: 700,
            color: toast.type === 'success' ? 'var(--su-success)' : 'var(--su-danger)'
          }}>{toast.text}</span>
        </div>
      )}

      {/* ── Row 1: Search + Toggles ─────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>

        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <input
            type="text"
            placeholder="Cari nama, nomor HP..."
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
          Filter Segmentasi {rules.length > 0 && <span style={{ background: 'var(--su-primary)', color: 'white', borderRadius: '99px', padding: '0 5px', fontSize: '9px' }}>{rules.length}</span>}
        </button>

        {/* Save Segment Button */}
        {rules.length > 0 && (
          <button
            onClick={() => setShowSaveModal(true)}
            style={{
              ...btnBase,
              background: 'white',
              borderColor: 'var(--su-success)',
              color: 'var(--su-success)',
            }}
          >
            💾 Simpan Segmen Ini
          </button>
        )}

        {/* Charts toggle */}
        <button
          onClick={() => setShowCharts(!showCharts)}
          style={{
            ...btnBase,
            background: showCharts ? 'var(--su-accent-light)' : 'white',
            borderColor: showCharts ? 'rgba(245,158,11,0.3)' : 'var(--su-border)',
            color: showCharts ? 'var(--su-accent-dark)' : 'var(--su-text-muted)',
            marginLeft: 'auto'
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          {showCharts ? 'Sembunyikan Grafik' : 'Lihat Grafik'}
        </button>
      </div>

      {/* ── Row 2: Default Presets ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--su-text-faint)', marginRight: '4px' }}>
          Preset Sistem:
        </span>
        {DEFAULT_PRESETS.map(p => {
          const isActive = activePresetKey === p.key
          return (
            <button
              key={p.key}
              onClick={() => handleApplyPreset(p.key, p.rules)}
              style={{
                ...btnBase,
                padding: '5px 10px',
                background: isActive ? 'var(--su-primary)' : 'white',
                borderColor: isActive ? 'var(--su-primary)' : 'var(--su-border)',
                color: isActive ? 'white' : 'var(--su-text-muted)',
              }}
            >
              {p.emoji} {p.label}
            </button>
          )
        })}
      </div>

      {/* ── Row 3: Saved Custom Presets ──────────────────────────────────────── */}
      {savedPresets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', background: '#FAFAF8', padding: '6px 12px', borderRadius: '8px', border: '1px dashed var(--su-border)', marginBottom: '12px' }}>
          <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--su-text-faint)', marginRight: '4px' }}>
            Segmen Tersimpan:
          </span>
          {savedPresets.map(p => {
            const isActive = activePresetKey === p.id
            return (
              <div
                key={p.id}
                onClick={() => handleApplyPreset(p.id, p.rules)}
                style={{
                  ...btnBase,
                  padding: '4px 8px 4px 10px',
                  background: isActive ? 'var(--su-success)' : 'white',
                  borderColor: isActive ? 'var(--su-success)' : 'var(--su-border)',
                  color: isActive ? 'white' : 'var(--su-text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{p.emoji} {p.name}</span>
                <button
                  onClick={(e) => handleDeletePreset(p.id, p.name, e)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isActive ? 'rgba(255,255,255,0.7)' : 'var(--su-text-faint)',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '0 2px',
                    display: 'flex',
                    alignItems: 'center',
                    fontWeight: 700,
                  }}
                  title="Hapus Preset"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Save Segment Modal ───────────────────────────────────────────── */}
      {showSaveModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(28, 28, 26, 0.4)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(2px)'
        }}>
          <form onSubmit={handleSavePreset} style={{
            background: 'white',
            border: '1px solid var(--su-border)',
            borderRadius: '12px',
            padding: '24px',
            width: '100%',
            maxWidth: '380px',
            boxShadow: 'var(--su-shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }} className="su-fade-in">
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--su-text)' }}>
              Simpan Segmen Baru
            </h3>
            
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '70px' }}>
                <label style={{ fontSize: '9px', fontWeight: 800, color: 'var(--su-text-faint)' }}>EMOJI</label>
                <select
                  value={presetEmoji}
                  onChange={e => setPresetEmoji(e.target.value)}
                  style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--su-border)', background: '#FAFAF8', fontSize: '16px' }}
                >
                  <option value="🔖">🔖</option>
                  <option value="💎">💎</option>
                  <option value="🔥">🔥</option>
                  <option value="⚡">⚡</option>
                  <option value="⚠️">⚠️</option>
                  <option value="💰">💰</option>
                  <option value="👤">👤</option>
                  <option value="🚀">🚀</option>
                  <option value="📦">📦</option>
                  <option value="🌟">🌟</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <label style={{ fontSize: '9px', fontWeight: 800, color: 'var(--su-text-faint)' }}>NAMA SEGMEN</label>
                <input
                  type="text"
                  placeholder="Contoh: VIP High Spenders"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  required
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--su-border)',
                    background: '#FAFAF8',
                    fontSize: '13px',
                    color: 'var(--su-text)',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: '10px', color: 'var(--su-text-faint)', background: 'var(--su-bg)', padding: '8px 12px', borderRadius: '6px' }}>
              Segmen akan menyimpan {rules.length} kriteria filter aktif saat ini.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                style={{ ...btnBase, textTransform: 'none', fontWeight: 600 }}
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSaving}
                style={{
                  ...btnBase,
                  background: 'var(--su-primary)',
                  color: 'white',
                  borderColor: 'var(--su-primary)',
                  textTransform: 'none',
                  fontWeight: 700
                }}
              >
                {isSaving ? 'Menyimpan...' : 'Simpan Segmen'}
              </button>
            </div>
          </form>
        </div>
      )}

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
                Segment Builder
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--su-text-faint)' }}>
                Tampilkan pelanggan yang memenuhi semua kriteria di bawah ini:
              </p>
            </div>
            {rules.length > 0 && (
              <button
                onClick={() => {
                  setRules([])
                  setActivePresetKey('all')
                  showToast('Semua kriteria filter dibersihkan.')
                }}
                style={{ fontSize: '10px', fontWeight: 700, color: 'var(--su-danger)', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
              >
                Hapus Semua
              </button>
            )}
          </div>

          {rules.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--su-text-faint)', fontSize: '12px', fontStyle: 'italic', padding: '12px 0' }}>
              Belum ada kriteria. Klik "Tambah Kriteria" untuk mulai segmentasi.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rules.map(rule => {
                const ft = FIELD_OPTIONS.find(f => f.value === rule.field)?.type || 'number'
                const operators = OPERATOR_OPTIONS[ft]
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
                    {/* Field */}
                    <select
                      value={rule.field}
                      onChange={e => updateRule(rule.id, { field: e.target.value as any })}
                      style={{ ...selectStyle, minWidth: '180px' }}
                    >
                      {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>

                    {/* Operator */}
                    <select
                      value={rule.operator}
                      onChange={e => updateRule(rule.id, { operator: e.target.value as any })}
                      style={{ ...selectStyle, minWidth: '180px' }}
                    >
                      {operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>

                    {/* Value Input */}
                    {ft === 'select' ? (
                      <select
                        value={rule.value}
                        onChange={e => updateRule(rule.id, { value: e.target.value })}
                        style={{ ...selectStyle, flex: 1 }}
                      >
                        {availableStatuses.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                      </select>
                    ) : ft === 'rfm_select' ? (
                      <select
                        value={rule.value}
                        onChange={e => updateRule(rule.id, { value: e.target.value })}
                        style={{ ...selectStyle, flex: 1 }}
                      >
                        {RFM_SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    ) : rule.operator === 'between' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '160px' }}>
                        <input
                          type={ft}
                          placeholder="Min"
                          value={(rule.value || '').split(',')[0] || ''}
                          onChange={e => {
                            const max = (rule.value || '').split(',')[1] || ''
                            updateRule(rule.id, { value: `${e.target.value},${max}` })
                          }}
                          style={{ ...selectStyle, width: '50%' }}
                        />
                        <span style={{ fontSize: '11px', color: 'var(--su-text-faint)' }}>s/d</span>
                        <input
                          type={ft}
                          placeholder="Max"
                          value={(rule.value || '').split(',')[1] || ''}
                          onChange={e => {
                            const min = (rule.value || '').split(',')[0] || ''
                            updateRule(rule.id, { value: `${min},${e.target.value}` })
                          }}
                          style={{ ...selectStyle, width: '50%' }}
                        />
                      </div>
                    ) : (
                      <input
                        type={ft}
                        placeholder={ft === 'number' ? 'Contoh: 500000' : ''}
                        value={rule.value}
                        onChange={e => updateRule(rule.id, { value: e.target.value })}
                        style={{ ...selectStyle, flex: 1, minWidth: '140px' }}
                      />
                    )}

                    {/* Delete Rule button */}
                    <button
                      onClick={() => removeRule(rule.id)}
                      title="Hapus rule ini"
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
              Tutup Panel Builder
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function uid() { return Math.random().toString(36).slice(2) }