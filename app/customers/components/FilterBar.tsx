"use client"
import { useState, useEffect, useRef, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export interface FilterRule {
  id: string
  field: 'ltv' | 'aov' | 'total_order_count' | 'days_since_last_order' | 'last_order_status' | 'last_order_date' | 'joined_at' | 'rfm_segment' | 'product_name'
  operator: 'greater_or_equal' | 'less_or_equal' | 'equal' | 'greater' | 'less' | 'after' | 'before' | 'between' | 'is' | 'is_not' | 'contains'
  value: string
}

interface FilterBarProps {
  searchQuery: string
  rules: FilterRule[]
  onApplyFilters: (query: string, rules: FilterRule[]) => void
  showCharts: boolean
  setShowCharts: (show: boolean) => void
  availableStatuses: string[]
  availableProducts: string[]
  businessId: string
  userId: string
  isFetching?: boolean
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

function uid() { return Math.random().toString(36).slice(2) }

export function FilterBar({
  searchQuery,
  rules,
  onApplyFilters,
  showCharts,
  setShowCharts,
  availableStatuses,
  availableProducts,
  businessId,
  userId,
  isFetching = false,
}: FilterBarProps) {
  // Staged / Pending State (FB Ads Manager Style)
  const [pendingQuery, setPendingQuery] = useState(searchQuery)
  const [pendingRules, setPendingRules] = useState<FilterRule[]>(rules)

  // Unified Filter Popover State
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<'main' | 'product' | 'status' | 'ltv' | 'date' | 'rfm' | 'order_count' | 'days_since'>('main')

  // Product Filter State
  const existingProductRule = pendingRules.find(r => r.field === 'product_name')
  const [productOperator, setProductOperator] = useState<'contains' | 'is_not' | 'is'>(
    (existingProductRule?.operator as any) || 'contains'
  )
  const [productSearchInput, setProductSearchInput] = useState(existingProductRule?.value || '')

  // LTV Filter State
  const existingLtvRule = pendingRules.find(r => r.field === 'ltv')
  const [minLtvInput, setMinLtvInput] = useState(existingLtvRule?.value || '')

  // Date Filter State
  const existingDateRule = pendingRules.find(r => r.field === 'last_order_date' || r.field === 'joined_at')
  const [dateField, setDateField] = useState<'last_order_date' | 'joined_at'>(existingDateRule?.field === 'joined_at' ? 'joined_at' : 'last_order_date')
  const [dateOperator, setDateOperator] = useState<'after' | 'before' | 'between'>((existingDateRule?.operator as any) || 'between')
  const initialDates = existingDateRule?.value ? existingDateRule.value.split(',') : ['', '']
  const [startDateInput, setStartDateInput] = useState(initialDates[0] || '')
  const [endDateInput, setEndDateInput]     = useState(initialDates[1] || '')

  // Order Count Filter State
  const existingCountRule = pendingRules.find(r => r.field === 'total_order_count')
  const [countOperator, setCountOperator] = useState<'greater_or_equal' | 'less_or_equal' | 'equal'>((existingCountRule?.operator as any) || 'greater_or_equal')
  const [countInput, setCountInput] = useState(existingCountRule?.value || '')

  // Days Since Last Order State
  const existingDaysRule = pendingRules.find(r => r.field === 'days_since_last_order')
  const [daysOperator, setDaysOperator] = useState<'greater_or_equal' | 'less_or_equal'>((existingDaysRule?.operator as any) || 'greater_or_equal')
  const [daysInput, setDaysInput] = useState(existingDaysRule?.value || '')

  // Presets & Modal State
  const [savedPresets, setSavedPresets] = useState<any[]>([])
  const [activePresetKey, setActivePresetKey] = useState<string>('all')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetEmoji, setPresetEmoji] = useState('🔖')
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // Sync state when props change externally
  useEffect(() => {
    setPendingQuery(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    setPendingRules(rules)
    const pr = rules.find(r => r.field === 'product_name')
    if (pr) {
      setProductOperator((pr.operator as any) || 'contains')
      setProductSearchInput(pr.value || '')
    }
  }, [rules])

  // Close popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
        setActiveCategory('main')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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

  // Check if there are unapplied changes
  const isDirty = pendingQuery !== searchQuery || JSON.stringify(pendingRules) !== JSON.stringify(rules)

  // Execute Search
  const handleSearchSubmit = () => {
    setPopoverOpen(false)
    setActiveCategory('main')
    onApplyFilters(pendingQuery, pendingRules)
  }

  // Handle Preset Apply
  const handleApplyPreset = (presetKey: string, presetRules: any[]) => {
    setActivePresetKey(presetKey)
    const newRules: FilterRule[] = presetRules.map(r => ({
      id: uid(),
      field: r.field,
      operator: r.operator,
      value: r.value
    }))
    setPendingRules(newRules)
    onApplyFilters(pendingQuery, newRules)
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
      const serializedRules = pendingRules.map(({ field, operator, value }) => ({ field, operator, value }))

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
        setPendingRules([])
        onApplyFilters(pendingQuery, [])
      }
      fetchSavedPresets()
    } catch (err: any) {
      showToast(`Gagal menghapus preset: ${err.message}`, 'error')
    }
  }

  // ─── Filter Apply Handlers ──────────────────────────────────────────────
  const handleApplyProductFilter = (valToApply?: string, opToApply?: 'contains' | 'is_not' | 'is') => {
    const val = valToApply !== undefined ? valToApply : productSearchInput
    const op = opToApply !== undefined ? opToApply : productOperator

    const existingWithoutProduct = pendingRules.filter(r => r.field !== 'product_name')
    if (!val.trim()) {
      setPendingRules(existingWithoutProduct)
    } else {
      setPendingRules([...existingWithoutProduct, {
        id: uid(),
        field: 'product_name',
        operator: op,
        value: val.trim()
      }])
    }
    setActivePresetKey('custom')
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  const handleApplyLtvFilter = () => {
    const existing = pendingRules.filter(r => r.field !== 'ltv')
    if (!minLtvInput.trim()) {
      setPendingRules(existing)
    } else {
      setPendingRules([...existing, {
        id: uid(),
        field: 'ltv',
        operator: 'greater_or_equal',
        value: minLtvInput.trim()
      }])
    }
    setActivePresetKey('custom')
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  const handleApplyDateFilter = () => {
    const existing = pendingRules.filter(r => r.field !== 'last_order_date' && r.field !== 'joined_at')
    if (!startDateInput && !endDateInput) {
      setPendingRules(existing)
    } else {
      const val = dateOperator === 'between' ? `${startDateInput},${endDateInput}` : (startDateInput || endDateInput)
      setPendingRules([...existing, {
        id: uid(),
        field: dateField,
        operator: dateOperator,
        value: val
      }])
    }
    setActivePresetKey('custom')
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  const handleApplyRfmFilter = (segmentValue: string) => {
    const existing = pendingRules.filter(r => r.field !== 'rfm_segment')
    setPendingRules([...existing, {
      id: uid(),
      field: 'rfm_segment',
      operator: 'is',
      value: segmentValue
    }])
    setActivePresetKey('custom')
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  const handleApplyOrderCountFilter = () => {
    const existing = pendingRules.filter(r => r.field !== 'total_order_count')
    if (!countInput.trim()) {
      setPendingRules(existing)
    } else {
      setPendingRules([...existing, {
        id: uid(),
        field: 'total_order_count',
        operator: countOperator,
        value: countInput.trim()
      }])
    }
    setActivePresetKey('custom')
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  const handleApplyDaysFilter = () => {
    const existing = pendingRules.filter(r => r.field !== 'days_since_last_order')
    if (!daysInput.trim()) {
      setPendingRules(existing)
    } else {
      setPendingRules([...existing, {
        id: uid(),
        field: 'days_since_last_order',
        operator: daysOperator,
        value: daysInput.trim()
      }])
    }
    setActivePresetKey('custom')
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  const removeRule = (id: string) => {
    const removedRule = pendingRules.find(r => r.id === id)
    setPendingRules(pendingRules.filter(r => r.id !== id))
    setActivePresetKey('custom')
    if (removedRule?.field === 'product_name') setProductSearchInput('')
    if (removedRule?.field === 'ltv') setMinLtvInput('')
    if (removedRule?.field === 'last_order_date' || removedRule?.field === 'joined_at') {
      setStartDateInput('')
      setEndDateInput('')
    }
    if (removedRule?.field === 'total_order_count') setCountInput('')
    if (removedRule?.field === 'days_since_last_order') setDaysInput('')
  }

  // Multi-select for Last Order Status
  const getSelectedStatuses = (): string[] => {
    const rule = pendingRules.find(r => r.field === 'last_order_status')
    if (!rule || !rule.value) return []
    return rule.value.split(',').map(s => s.trim()).filter(Boolean)
  }

  const toggleStatusValue = (valueToToggle: string) => {
    const current = getSelectedStatuses()
    const exists = current.some(v => v.toLowerCase() === valueToToggle.toLowerCase())
    let updated: string[]
    if (exists) {
      updated = current.filter(v => v.toLowerCase() !== valueToToggle.toLowerCase())
    } else {
      updated = [...current, valueToToggle]
    }

    const existingRule = pendingRules.find(r => r.field === 'last_order_status')
    if (updated.length === 0) {
      setPendingRules(pendingRules.filter(r => r.field !== 'last_order_status'))
    } else if (existingRule) {
      setPendingRules(pendingRules.map(r => r.field === 'last_order_status' ? { ...r, value: updated.join(',') } : r))
    } else {
      setPendingRules([...pendingRules, {
        id: uid(),
        field: 'last_order_status',
        operator: 'is',
        value: updated.join(',')
      }])
    }
    setActivePresetKey('custom')
  }

  // Format Chip Text for Badge
  const getRuleChipLabel = (rule: FilterRule): { fieldLabel: string; valueLabel: string; category: 'product' | 'status' | 'ltv' | 'date' | 'rfm' | 'order_count' | 'days_since' } => {
    if (rule.field === 'product_name') {
      const opLabel = rule.operator === 'contains' ? 'berisi' : rule.operator === 'is_not' ? 'tidak berisi' : '='
      return { fieldLabel: 'Produk Order', valueLabel: `${opLabel} "${rule.value}"`, category: 'product' }
    }
    if (rule.field === 'ltv') return { fieldLabel: 'Total Belanja (LTV)', valueLabel: `>= Rp ${Number(rule.value || 0).toLocaleString('id-ID')}`, category: 'ltv' }
    if (rule.field === 'last_order_status') return { fieldLabel: 'Status Last Order', valueLabel: rule.value.toUpperCase(), category: 'status' }
    if (rule.field === 'rfm_segment') {
      const rfmObj = RFM_SEGMENTS.find(s => s.value === rule.value)
      return { fieldLabel: 'Segmen RFM', valueLabel: rfmObj ? rfmObj.label.split(' (')[0] : rule.value.toUpperCase(), category: 'rfm' }
    }
    if (rule.field === 'total_order_count') {
      const opSym = rule.operator === 'greater_or_equal' ? '>=' : rule.operator === 'less_or_equal' ? '<=' : '='
      return { fieldLabel: 'Jumlah Order', valueLabel: `${opSym} ${rule.value}`, category: 'order_count' }
    }
    if (rule.field === 'days_since_last_order') {
      const opSym = rule.operator === 'greater_or_equal' ? '>=' : '<='
      return { fieldLabel: 'Hari Belum Order', valueLabel: `${opSym} ${rule.value} hari`, category: 'days_since' }
    }
    if (rule.field === 'last_order_date' || rule.field === 'joined_at') {
      const name = rule.field === 'joined_at' ? 'Tgl Bergabung' : 'Tgl Last Order'
      return { fieldLabel: name, valueLabel: rule.value.replace(',', ' s/d '), category: 'date' }
    }

    return { fieldLabel: rule.field, valueLabel: rule.value, category: 'product' }
  }

  const selectedStatuses = getSelectedStatuses()
  const filteredCatalogProducts = availableProducts.filter(p =>
    !productSearchInput || p.toLowerCase().includes(productSearchInput.toLowerCase())
  )

  return (
    <div style={{ marginBottom: '24px' }}>

      {/* ── Toast Notification ────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          background: toast.type === 'success' ? 'var(--su-success-light)' : 'var(--su-danger-light)',
          border: `1px solid ${toast.type === 'success' ? 'var(--su-success)' : 'var(--su-danger)'}`,
          padding: '12px 20px', borderRadius: '8px', boxShadow: 'var(--su-shadow-lg)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }} className="su-fade-in">
          <span style={{ fontSize: '16px' }}>{toast.type === 'success' ? '✨' : '❌'}</span>
          <span style={{
            fontSize: '12px', fontWeight: 700,
            color: toast.type === 'success' ? 'var(--su-success)' : 'var(--su-danger)'
          }}>{toast.text}</span>
        </div>
      )}

      {/* ── Single Unified Search & Filter Container (Identical to Order Feature) ── */}
      <div ref={containerRef} style={{ position: 'relative', marginBottom: '12px' }}>
        
        <div style={{
          background: 'white',
          border: isDirty ? '1.5px solid var(--su-primary)' : popoverOpen ? '1.5px solid #2563EB' : '1px solid var(--su-border)',
          borderRadius: '12px',
          padding: '8px 12px',
          boxShadow: popoverOpen || isDirty ? '0 0 0 3px rgba(37,99,235,0.12)' : 'var(--su-shadow-sm)',
          transition: 'all 0.2s',
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>

            {/* Search Icon */}
            <div style={{ color: 'var(--su-text-faint)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>

            {/* Active Filter Chips & Inline Inputs (FB Ads Manager Style) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', flex: '1 1 340px' }}>
              
              {/* Search Query Chip */}
              {pendingQuery && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '4px 9px', borderRadius: '7px',
                  background: 'var(--su-bg)', border: '1px solid var(--su-border)',
                  fontSize: '12px', fontWeight: 600, color: 'var(--su-text)',
                }}>
                  <span style={{ color: 'var(--su-text-faint)' }}>Cari:</span> "{pendingQuery}"
                  <button
                    onClick={() => setPendingQuery('')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--su-text-faint)', display: 'flex', alignItems: 'center' }}
                    title="Hapus kata kunci"
                  >
                    ✕
                  </button>
                </span>
              )}

              {/* Rule Chips (FB Ads Manager Style Badges) */}
              {pendingRules.map(rule => {
                const { fieldLabel, valueLabel, category } = getRuleChipLabel(rule)
                const isProduct = rule.field === 'product_name'
                return (
                  <span
                    key={rule.id}
                    onClick={() => {
                      setActiveCategory(category)
                      setPopoverOpen(true)
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '4px 10px', borderRadius: '7px', cursor: 'pointer',
                      background: isProduct ? '#FEF3C7' : 'var(--su-primary-light)',
                      border: isProduct ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(37,99,235,0.25)',
                      fontSize: '12px', fontWeight: 700,
                      color: isProduct ? '#B45309' : 'var(--su-primary)',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      transition: 'transform 0.1s',
                    }}
                    title="Klik untuk ubah filter ini"
                  >
                    <span>{fieldLabel}:</span>
                    <span style={{ color: 'var(--su-text)' }}>{valueLabel}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeRule(rule.id)
                      }}
                      style={{
                        border: 'none', background: 'none', cursor: 'pointer', padding: 0,
                        color: 'inherit', fontWeight: 800, fontSize: '11px',
                        display: 'flex', alignItems: 'center', opacity: 0.8,
                      }}
                      onMouseEnter={ev => (ev.currentTarget.style.opacity = '1')}
                      onMouseLeave={ev => (ev.currentTarget.style.opacity = '0.8')}
                      title="Hapus filter ini"
                    >
                      ✕
                    </button>
                  </span>
                )
              })}

              {/* "+ Filter" Category Trigger Button (FB Ads Style) */}
              <button
                onClick={() => {
                  setActiveCategory('main')
                  setPopoverOpen(!popoverOpen)
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '4px 10px', borderRadius: '7px', border: '1px dashed var(--su-border)',
                  background: popoverOpen ? 'var(--su-primary-light)' : 'transparent',
                  color: popoverOpen ? 'var(--su-primary)' : 'var(--su-text-muted)',
                  fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <span>+ Filter</span>
                <span style={{ fontSize: '10px' }}>▾</span>
              </button>

              {/* Inline Search Input */}
              <input
                type="text"
                placeholder={pendingRules.length > 0 || pendingQuery ? 'Tambah pencarian...' : 'Cari nama pelanggan, nomor HP, atau klik + Filter...'}
                value={pendingQuery}
                onChange={e => setPendingQuery(e.target.value)}
                onFocus={() => setPopoverOpen(true)}
                onClick={() => setPopoverOpen(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSearchSubmit()
                }}
                style={{
                  flex: 1, minWidth: '200px', border: 'none', outline: 'none',
                  background: 'transparent', fontSize: '13px', color: 'var(--su-text)',
                  padding: '4px 0',
                }}
              />
            </div>

            {/* 🔍 CARI Primary Button */}
            <button
              onClick={handleSearchSubmit}
              disabled={isFetching}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
                background: isDirty ? '#2563EB' : 'var(--su-primary)',
                color: 'white', border: 'none',
                fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
                boxShadow: isDirty ? '0 2px 8px rgba(37,99,235,0.35)' : 'none',
                transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              {isFetching ? (
                <>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid white', borderTopColor: 'transparent' }} className="su-spin" />
                  Memuat...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  Cari {isDirty && <span style={{ background: '#F59E0B', color: 'black', borderRadius: '99px', width: '8px', height: '8px', display: 'inline-block' }} title="Ada perubahan belum diterapkan" />}
                </>
              )}
            </button>

            {/* Save Custom Segment Button */}
            {pendingRules.length > 0 && (
              <button
                onClick={() => setShowSaveModal(true)}
                style={{
                  fontSize: '11px', fontWeight: 700, color: 'var(--su-success)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px 6px', textTransform: 'uppercase', letterSpacing: '0.05em',
                  flexShrink: 0,
                }}
                title="Simpan kriteria filter ini sebagai preset segmen"
              >
                💾 Simpan Segmen
              </button>
            )}

            {/* Reset Button */}
            {(pendingQuery || pendingRules.length > 0) && (
              <button
                onClick={() => {
                  setPendingQuery('')
                  setPendingRules([])
                  setProductSearchInput('')
                  setMinLtvInput('')
                  setStartDateInput('')
                  setEndDateInput('')
                  setCountInput('')
                  setDaysInput('')
                  onApplyFilters('', [])
                }}
                style={{
                  fontSize: '11px', fontWeight: 700, color: 'var(--su-danger)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px 6px', textTransform: 'uppercase', letterSpacing: '0.05em',
                  flexShrink: 0,
                }}
                title="Reset semua filter"
              >
                Reset
              </button>
            )}

            {/* Charts Toggle */}
            <button
              onClick={() => setShowCharts(!showCharts)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', borderRadius: '7px', cursor: 'pointer',
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                border: '1px solid var(--su-border)',
                background: showCharts ? 'var(--su-accent-light)' : 'white',
                color: showCharts ? 'var(--su-accent-dark)' : 'var(--su-text-muted)',
                flexShrink: 0, marginLeft: 'auto',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
              {showCharts ? 'Sembunyikan Grafik' : 'Lihat Grafik'}
            </button>

          </div>
        </div>

        {/* ── UNIFIED FILTER POPOVER ───────────────────────────────────────── */}
        {popoverOpen && (
          <div style={{
            position: 'absolute', top: '108%', left: 0, zIndex: 40,
            background: 'white', border: '1px solid var(--su-border)',
            borderRadius: '12px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
            overflow: 'hidden', width: '420px', maxWidth: '92vw',
          }} className="su-fade-in">
            
            {/* Header Banner */}
            <div style={{
              padding: '10px 16px', background: '#F8FAFC', borderBottom: '1px solid var(--su-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--su-text)' }}>
                  {activeCategory === 'main' ? 'Pilih Kategori Filter Pelanggan' :
                   activeCategory === 'product' ? 'Produk yang Pernah Di-order' :
                   activeCategory === 'ltv' ? 'Total Belanja (LTV)' :
                   activeCategory === 'status' ? 'Status Order Terakhir' :
                   activeCategory === 'rfm' ? 'Segmen RFM' :
                   activeCategory === 'date' ? 'Rentang Tanggal' :
                   activeCategory === 'order_count' ? 'Jumlah Order' : 'Hari Sejak Order Terakhir'}
                </span>
              </div>
              {activeCategory !== 'main' ? (
                <button
                  onClick={() => setActiveCategory('main')}
                  style={{ border: 'none', background: 'none', fontSize: '11px', color: 'var(--su-primary)', cursor: 'pointer', fontWeight: 700 }}
                >
                  ← Kembali
                </button>
              ) : (
                <button
                  onClick={() => setPopoverOpen(false)}
                  style={{ border: 'none', background: 'none', fontSize: '11px', color: 'var(--su-text-faint)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Tutup ✕
                </button>
              )}
            </div>

            {/* Content Container */}
            <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '12px 16px' }}>

              {/* ── 1. MAIN CATEGORY SELECTION LIST ────────────────────────── */}
              {activeCategory === 'main' && (
                <div>
                  
                  {/* Typing suggestions for product search */}
                  {pendingQuery.trim().length > 0 && (
                    <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--su-border)' }}>
                      <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--su-primary)', marginBottom: '6px' }}>
                        Sugesti Kata Kunci Produk:
                      </div>
                      <button
                        onClick={() => {
                          handleApplyProductFilter(pendingQuery, 'contains')
                          setPendingQuery('')
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                          padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.3)',
                          background: '#FFFBEB', cursor: 'pointer', textAlign: 'left',
                          fontSize: '12px', fontWeight: 700, color: '#B45309',
                        }}
                      >
                        <span>🛍️</span>
                        <span>Filter Customer yang pernah beli <strong style={{ color: '#D97706' }}>"{pendingQuery}"</strong></span>
                      </button>
                    </div>
                  )}

                  <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--su-text-faint)', marginBottom: '8px' }}>
                    Pilih Kategori Filter:
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    
                    {/* 1. Product Filter Category */}
                    <button
                      onClick={() => setActiveCategory('product')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                        background: existingProductRule ? '#FFFBEB' : 'white', cursor: 'pointer', textAlign: 'left',
                        fontSize: '13px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = existingProductRule ? '#FFFBEB' : 'white' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px' }}>🛍️</span>
                        <div>
                          <div>Produk yang Pernah Di-order</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {existingProductRule ? `Format: "${existingProductRule.value}"` : 'Filter customer berdasarkan barang yang dibeli'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                    {/* 2. LTV Total Spend Category */}
                    <button
                      onClick={() => setActiveCategory('ltv')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                        background: existingLtvRule ? 'var(--su-primary-light)' : 'white', cursor: 'pointer', textAlign: 'left',
                        fontSize: '13px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = existingLtvRule ? 'var(--su-primary-light)' : 'white' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px' }}>💵</span>
                        <div>
                          <div>Total Belanja (LTV)</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {existingLtvRule ? `>= Rp ${Number(existingLtvRule.value).toLocaleString('id-ID')}` : 'Misal: ≥ Rp 1.000.000'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                    {/* 3. RFM Segment Category */}
                    <button
                      onClick={() => setActiveCategory('rfm')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                        background: 'white', cursor: 'pointer', textAlign: 'left',
                        fontSize: '13px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px' }}>📊</span>
                        <div>
                          <div>Segmen RFM</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>VIP, Loyal, Customer Baru, Churned, dll.</div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Pilih ▾</span>
                    </button>

                    {/* 4. Last Order Status Category */}
                    <button
                      onClick={() => setActiveCategory('status')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                        background: 'white', cursor: 'pointer', textAlign: 'left',
                        fontSize: '13px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px' }}>📋</span>
                        <div>
                          <div>Status Order Terakhir</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {selectedStatuses.length > 0 ? selectedStatuses.join(', ').toUpperCase() : 'Completed, Processing, Pending, dll.'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Pilih ▾</span>
                    </button>

                    {/* 5. Date Range Category */}
                    <button
                      onClick={() => setActiveCategory('date')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                        background: 'white', cursor: 'pointer', textAlign: 'left',
                        fontSize: '13px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px' }}>📅</span>
                        <div>
                          <div>Rentang Tanggal</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>Tanggal order terakhir atau tanggal bergabung</div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                    {/* 6. Total Order Count Category */}
                    <button
                      onClick={() => setActiveCategory('order_count')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                        background: 'white', cursor: 'pointer', textAlign: 'left',
                        fontSize: '13px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px' }}>📦</span>
                        <div>
                          <div>Jumlah Order</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {existingCountRule ? `Jumlah Order ${existingCountRule.operator} ${existingCountRule.value}` : 'Filter berdasarkan total kali order'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                    {/* 7. Days Since Last Order Category */}
                    <button
                      onClick={() => setActiveCategory('days_since')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                        background: 'white', cursor: 'pointer', textAlign: 'left',
                        fontSize: '13px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-bg)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px' }}>⏳</span>
                        <div>
                          <div>Hari Sejak Order Terakhir</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {existingDaysRule ? `> ${existingDaysRule.value} hari` : 'Misal: Belum order > 30 hari'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                  </div>
                </div>
              )}

              {/* ── 2. PRODUCT FILTER FORM ─────────────────────────────────── */}
              {activeCategory === 'product' && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <select
                      disabled
                      style={{
                        padding: '7px 10px', borderRadius: '7px',
                        border: '1px solid var(--su-border)', background: 'var(--su-bg)',
                        fontSize: '12px', color: 'var(--su-text)', fontWeight: 600, flex: 1,
                      }}
                    >
                      <option>Produk Order</option>
                    </select>

                    <select
                      value={productOperator}
                      onChange={e => setProductOperator(e.target.value as any)}
                      style={{
                        padding: '7px 10px', borderRadius: '7px',
                        border: '1px solid var(--su-border)', background: 'white',
                        fontSize: '12px', color: 'var(--su-text)', fontWeight: 600, flex: 1,
                      }}
                    >
                      <option value="contains">berisi kata kunci</option>
                      <option value="is_not">tidak berisi</option>
                      <option value="is">sama persis</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '10px' }}>
                    <input
                      type="text"
                      placeholder="Ketik nama produk (misal: cintya, blouse) atau pilih dari katalog..."
                      value={productSearchInput}
                      onChange={e => setProductSearchInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleApplyProductFilter()
                      }}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: '8px',
                        border: '1px solid var(--su-border)', fontSize: '12px', outline: 'none',
                        boxSizing: 'border-box', fontWeight: 500,
                      }}
                    />
                  </div>

                  {/* Catalog list */}
                  <div style={{
                    maxHeight: '140px', overflowY: 'auto', border: '1px solid var(--su-border)',
                    borderRadius: '8px', padding: '4px', background: '#FAFAFA', marginBottom: '12px',
                  }}>
                    <div style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--su-text-faint)', padding: '2px 6px' }}>
                      Katalog Produk Tersedia:
                    </div>
                    {filteredCatalogProducts.length === 0 ? (
                      <div style={{ fontSize: '11px', color: 'var(--su-text-faint)', padding: '6px', fontStyle: 'italic' }}>
                        Tekan Terapkan untuk menggunakan kata yang diketik.
                      </div>
                    ) : (
                      filteredCatalogProducts.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setProductSearchInput(p)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '5px 8px', borderRadius: '5px', border: 'none',
                            background: productSearchInput === p ? '#E0E7FF' : 'transparent',
                            fontSize: '11px', fontWeight: productSearchInput === p ? 700 : 500,
                            color: productSearchInput === p ? '#3730A3' : 'var(--su-text)',
                            cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}
                        >
                          {p}
                        </button>
                      ))
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
                    <button
                      type="button"
                      onClick={() => setActiveCategory('main')}
                      style={{
                        padding: '6px 14px', borderRadius: '7px', cursor: 'pointer',
                        background: 'white', border: '1px solid var(--su-border)',
                        fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)',
                      }}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyProductFilter()}
                      style={{
                        padding: '6px 16px', borderRadius: '7px', cursor: 'pointer',
                        background: '#2563EB', border: 'none', color: 'white',
                        fontSize: '12px', fontWeight: 800, boxShadow: '0 1px 3px rgba(37,99,235,0.3)',
                      }}
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

              {/* ── 3. LTV FILTER FORM ─────────────────────────────────────── */}
              {activeCategory === 'ltv' && (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--su-text-muted)', marginBottom: '8px' }}>
                    Tampilkan pelanggan dengan Total Belanja (LTV) minimal:
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <input
                      type="number"
                      placeholder="Contoh: 1000000"
                      value={minLtvInput}
                      onChange={e => setMinLtvInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleApplyLtvFilter() }}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: '8px',
                        border: '1px solid var(--su-border)', fontSize: '13px', outline: 'none',
                        boxSizing: 'border-box', fontWeight: 600,
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
                    <button
                      type="button"
                      onClick={() => setActiveCategory('main')}
                      style={{ padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', background: 'white', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)' }}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyLtvFilter}
                      style={{ padding: '6px 16px', borderRadius: '7px', cursor: 'pointer', background: '#2563EB', border: 'none', color: 'white', fontSize: '12px', fontWeight: 800 }}
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

              {/* ── 4. RFM SEGMENT FORM ────────────────────────────────────── */}
              {activeCategory === 'rfm' && (
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                    {RFM_SEGMENTS.map(s => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => handleApplyRfmFilter(s.value)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--su-border)',
                          background: 'white', cursor: 'pointer', textAlign: 'left',
                          fontSize: '12px', fontWeight: 600, color: 'var(--su-text)', transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--su-primary-light)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white' }}
                      >
                        <span>{s.label}</span>
                        <span style={{ fontSize: '11px', color: 'var(--su-primary)', fontWeight: 700 }}>Pilih →</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 5. STATUS MULTI-SELECT ─────────────────────────────────── */}
              {activeCategory === 'status' && (
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto', marginBottom: '12px' }}>
                    {availableStatuses.map(s => {
                      const checked = selectedStatuses.some(v => v.toLowerCase() === s.toLowerCase())
                      return (
                        <label
                          key={s}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
                            background: checked ? 'var(--su-bg)' : 'transparent',
                            fontSize: '12px', fontWeight: 600, color: 'var(--su-text)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleStatusValue(s)}
                            style={{ cursor: 'pointer' }}
                          />
                          {s.toUpperCase()}
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = selectedStatuses.length === availableStatuses.length
                        if (allSelected) {
                          setPendingRules(pendingRules.filter(r => r.field !== 'last_order_status'))
                        } else {
                          const existingRule = pendingRules.find(r => r.field === 'last_order_status')
                          if (existingRule) {
                            setPendingRules(pendingRules.map(r => r.field === 'last_order_status' ? { ...r, value: availableStatuses.join(',') } : r))
                          } else {
                            setPendingRules([...pendingRules, { id: uid(), field: 'last_order_status', operator: 'is', value: availableStatuses.join(',') }])
                          }
                        }
                      }}
                      style={{ border: 'none', background: 'none', fontSize: '11px', color: 'var(--su-primary)', cursor: 'pointer', fontWeight: 700 }}
                    >
                      {selectedStatuses.length === availableStatuses.length ? 'Hapus Semua' : 'Pilih Semua'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPopoverOpen(false)
                        setActiveCategory('main')
                      }}
                      style={{
                        padding: '6px 16px', borderRadius: '7px', cursor: 'pointer',
                        background: '#2563EB', border: 'none', color: 'white',
                        fontSize: '12px', fontWeight: 800,
                      }}
                    >
                      Selesai
                    </button>
                  </div>
                </div>
              )}

              {/* ── 6. DATE RANGE FILTER ───────────────────────────────────── */}
              {activeCategory === 'date' && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <select
                      value={dateField}
                      onChange={e => setDateField(e.target.value as any)}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, flex: 1 }}
                    >
                      <option value="last_order_date">Tanggal Last Order</option>
                      <option value="joined_at">Tanggal Bergabung</option>
                    </select>

                    <select
                      value={dateOperator}
                      onChange={e => setDateOperator(e.target.value as any)}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, flex: 1 }}
                    >
                      <option value="between">Di antara (Rentang)</option>
                      <option value="after">Setelah Tanggal</option>
                      <option value="before">Sebelum Tanggal</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <input
                      type="date"
                      value={startDateInput}
                      onChange={e => setStartDateInput(e.target.value)}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', flex: 1 }}
                    />
                    {dateOperator === 'between' && (
                      <input
                        type="date"
                        value={endDateInput}
                        onChange={e => setEndDateInput(e.target.value)}
                        style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', flex: 1 }}
                      />
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
                    <button
                      type="button"
                      onClick={() => setActiveCategory('main')}
                      style={{ padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', background: 'white', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)' }}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyDateFilter}
                      style={{ padding: '6px 16px', borderRadius: '7px', cursor: 'pointer', background: '#2563EB', border: 'none', color: 'white', fontSize: '12px', fontWeight: 800 }}
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

              {/* ── 7. ORDER COUNT FILTER ──────────────────────────────────── */}
              {activeCategory === 'order_count' && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <select
                      value={countOperator}
                      onChange={e => setCountOperator(e.target.value as any)}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, flex: 1 }}
                    >
                      <option value="greater_or_equal">&ge; Lebih dari / sama</option>
                      <option value="less_or_equal">&le; Kurang dari / sama</option>
                      <option value="equal">= Sama dengan</option>
                    </select>

                    <input
                      type="number"
                      placeholder="Jumlah order (misal: 3)"
                      value={countInput}
                      onChange={e => setCountInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleApplyOrderCountFilter() }}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, flex: 1 }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
                    <button
                      type="button"
                      onClick={() => setActiveCategory('main')}
                      style={{ padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', background: 'white', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)' }}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyOrderCountFilter}
                      style={{ padding: '6px 16px', borderRadius: '7px', cursor: 'pointer', background: '#2563EB', border: 'none', color: 'white', fontSize: '12px', fontWeight: 800 }}
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

              {/* ── 8. DAYS SINCE LAST ORDER ───────────────────────────────── */}
              {activeCategory === 'days_since' && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <select
                      value={daysOperator}
                      onChange={e => setDaysOperator(e.target.value as any)}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, flex: 1 }}
                    >
                      <option value="greater_or_equal">&ge; Lebih dari (Hari)</option>
                      <option value="less_or_equal">&le; Kurang dari (Hari)</option>
                    </select>

                    <input
                      type="number"
                      placeholder="Jumlah hari (misal: 30)"
                      value={daysInput}
                      onChange={e => setDaysInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleApplyDaysFilter() }}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, flex: 1 }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
                    <button
                      type="button"
                      onClick={() => setActiveCategory('main')}
                      style={{ padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', background: 'white', border: '1px solid var(--su-border)', fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)' }}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyDaysFilter}
                      style={{ padding: '6px 16px', borderRadius: '7px', cursor: 'pointer', background: '#2563EB', border: 'none', color: 'white', fontSize: '12px', fontWeight: 800 }}
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

      </div>

      {/* ── Presets Rows ─────────────────────────────────────────────────── */}
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
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', transition: 'all 0.15s',
                border: '1px solid var(--su-border)',
                background: isActive ? 'var(--su-primary)' : 'white',
                color: isActive ? 'white' : 'var(--su-text-muted)',
              }}
            >
              {p.emoji} {p.label}
            </button>
          )
        })}
      </div>

      {/* ── Saved Custom Presets Row ────────────────────────────────────────── */}
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
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '4px 8px 4px 10px', borderRadius: '8px', cursor: 'pointer',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', transition: 'all 0.15s',
                  border: '1px solid var(--su-border)',
                  background: isActive ? 'var(--su-success)' : 'white',
                  color: isActive ? 'white' : 'var(--su-text-muted)',
                }}
              >
                <span>{p.emoji} {p.name}</span>
                <button
                  onClick={(e) => handleDeletePreset(p.id, p.name, e)}
                  style={{
                    background: 'transparent', border: 'none',
                    color: isActive ? 'rgba(255,255,255,0.7)' : 'var(--su-text-faint)',
                    cursor: 'pointer', fontSize: '11px', padding: '0 2px',
                    display: 'flex', alignItems: 'center', fontWeight: 700,
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
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(28, 28, 26, 0.4)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(2px)'
        }}>
          <form onSubmit={handleSavePreset} style={{
            background: 'white', border: '1px solid var(--su-border)',
            borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '380px',
            boxShadow: 'var(--su-shadow-lg)', display: 'flex', flexDirection: 'column', gap: '16px'
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
                  <option value="🌱">🌱</option>
                  <option value="🛍️">🛍️</option>
                  <option value="⚠️">⚠️</option>
                  <option value="👤">👤</option>
                  <option value="🚀">🚀</option>
                  <option value="⭐">⭐</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <label style={{ fontSize: '9px', fontWeight: 800, color: 'var(--su-text-faint)' }}>NAMA SEGMEN</label>
                <input
                  type="text"
                  placeholder="Contoh: Pembeli Cintya Blouse"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  required
                  style={{
                    padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--su-border)',
                    background: '#FAFAF8', fontSize: '13px', color: 'var(--su-text)', outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: '10px', color: 'var(--su-text-faint)', background: 'var(--su-bg)', padding: '8px 12px', borderRadius: '6px' }}>
              Segmen akan menyimpan {pendingRules.length} kriteria filter aktif saat ini.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--su-border)', background: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSaving}
                style={{
                  padding: '6px 16px', borderRadius: '8px', border: 'none',
                  background: 'var(--su-primary)', color: 'white', cursor: 'pointer',
                  fontSize: '12px', fontWeight: 700
                }}
              >
                {isSaving ? 'Menyimpan...' : 'Simpan Segmen'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  )
}