"use client"
import { useState, useEffect, useRef } from 'react'

export interface OrderFilterRule {
  id: string
  field: 'grand_total' | 'total_qty' | 'status' | 'payment_method' | 'order_date' | 'product_name' | 'source_platform'
  operator: 'greater_or_equal' | 'less_or_equal' | 'equal' | 'after' | 'before' | 'between' | 'is' | 'is_not' | 'in' | 'not_in' | 'contains'
  value: string
}

interface FilterBarProps {
  searchQuery: string
  rules: OrderFilterRule[]
  onApplyFilters: (query: string, rules: OrderFilterRule[]) => void
  showCharts: boolean
  setShowCharts: (show: boolean) => void
  availableStatuses: string[]
  availablePaymentMethods: string[]
  availableOrderSources: string[]
  availableProducts: string[]
  isFetching?: boolean
}

function uid() { return Math.random().toString(36).slice(2) }

export function FilterBar({
  searchQuery,
  rules,
  onApplyFilters,
  showCharts,
  setShowCharts,
  availableStatuses,
  availablePaymentMethods,
  availableOrderSources,
  availableProducts,
  isFetching = false,
}: FilterBarProps) {
  // Staged / Pending State
  const [pendingQuery, setPendingQuery] = useState(searchQuery)
  const [pendingRules, setPendingRules] = useState<OrderFilterRule[]>(rules)

  // FB Ads Unified Filter Popover State
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<'main' | 'product' | 'status' | 'source' | 'payment' | 'total' | 'date'>('main')

  // FB Ads Product Filter Form State
  const existingProductRule = pendingRules.find(r => r.field === 'product_name')
  const [productOperator, setProductOperator] = useState<'contains' | 'is_not' | 'is'>(
    (existingProductRule?.operator as any) || 'contains'
  )
  const [productSearchInput, setProductSearchInput] = useState(existingProductRule?.value || '')

  // Total amount state
  const existingTotalRule = pendingRules.find(r => r.field === 'grand_total')
  const [minTotalInput, setMinTotalInput] = useState(existingTotalRule?.value || '')

  // Date range state
  const existingDateRule = pendingRules.find(r => r.field === 'order_date')
  const initialDates = existingDateRule?.value ? existingDateRule.value.split(',') : ['', '']
  const [startDateInput, setStartDateInput] = useState(initialDates[0] || '')
  const [endDateInput, setEndDateInput]     = useState(initialDates[1] || '')

  const containerRef = useRef<HTMLDivElement>(null)

  // Sync state if props change from outside
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

  // Check if there are unapplied changes
  const isDirty = pendingQuery !== searchQuery || JSON.stringify(pendingRules) !== JSON.stringify(rules)

  // Execute Search
  const handleSearchSubmit = () => {
    setPopoverOpen(false)
    setActiveCategory('main')
    onApplyFilters(pendingQuery, pendingRules)
  }

  // Handle FB Ads Product Filter Apply
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
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  // Handle Total Filter Apply
  const handleApplyTotalFilter = () => {
    const existing = pendingRules.filter(r => r.field !== 'grand_total')
    if (!minTotalInput.trim()) {
      setPendingRules(existing)
    } else {
      setPendingRules([...existing, {
        id: uid(),
        field: 'grand_total',
        operator: 'greater_or_equal',
        value: minTotalInput.trim()
      }])
    }
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  // Handle Date Filter Apply
  const handleApplyDateFilter = () => {
    const existing = pendingRules.filter(r => r.field !== 'order_date')
    if (!startDateInput && !endDateInput) {
      setPendingRules(existing)
    } else {
      setPendingRules([...existing, {
        id: uid(),
        field: 'order_date',
        operator: 'between',
        value: `${startDateInput},${endDateInput}`
      }])
    }
    setPopoverOpen(false)
    setActiveCategory('main')
  }

  const removeRule = (id: string) => {
    setPendingRules(pendingRules.filter(r => r.id !== id))
    const removedRule = pendingRules.find(r => r.id === id)
    if (removedRule?.field === 'product_name') setProductSearchInput('')
    if (removedRule?.field === 'grand_total') setMinTotalInput('')
    if (removedRule?.field === 'order_date') {
      setStartDateInput('')
      setEndDateInput('')
    }
  }

  // Quick Multi-select Helper for Status, Source, Payment Method
  const getFieldValues = (fieldName: 'status' | 'source_platform' | 'payment_method'): string[] => {
    const rule = pendingRules.find(r => r.field === fieldName)
    if (!rule || !rule.value) return []
    return rule.value.split(',').map(s => s.trim()).filter(Boolean)
  }

  const toggleFieldValue = (fieldName: 'status' | 'source_platform' | 'payment_method', valueToToggle: string) => {
    const current = getFieldValues(fieldName)
    const exists = current.some(v => v.toLowerCase() === valueToToggle.toLowerCase())
    let updated: string[]
    if (exists) {
      updated = current.filter(v => v.toLowerCase() !== valueToToggle.toLowerCase())
    } else {
      updated = [...current, valueToToggle]
    }

    const existingRule = pendingRules.find(r => r.field === fieldName)
    if (updated.length === 0) {
      setPendingRules(pendingRules.filter(r => r.field !== fieldName))
    } else if (existingRule) {
      setPendingRules(pendingRules.map(r => r.field === fieldName ? { ...r, value: updated.join(',') } : r))
    } else {
      setPendingRules([...pendingRules, {
        id: uid(),
        field: fieldName,
        operator: 'is',
        value: updated.join(',')
      }])
    }
  }

  // Format Chip Text for FB Ads Search Container
  const getRuleChipLabel = (rule: OrderFilterRule): { fieldLabel: string; valueLabel: string; category: 'product' | 'status' | 'source' | 'payment' | 'total' | 'date' } => {
    if (rule.field === 'status') return { fieldLabel: 'Status', valueLabel: rule.value.toUpperCase(), category: 'status' }
    if (rule.field === 'source_platform') return { fieldLabel: 'Sumber', valueLabel: rule.value, category: 'source' }
    if (rule.field === 'payment_method') {
      const pmLabel = rule.value.toLowerCase().includes('bacs') ? 'BANK TRANSFER' : rule.value.toUpperCase()
      return { fieldLabel: 'Pembayaran', valueLabel: pmLabel, category: 'payment' }
    }
    if (rule.field === 'grand_total') return { fieldLabel: 'Total', valueLabel: `>= Rp ${Number(rule.value || 0).toLocaleString('id-ID')}`, category: 'total' }
    if (rule.field === 'product_name') {
      const opLabel = rule.operator === 'contains' ? 'berisi' : rule.operator === 'is_not' ? 'tidak berisi' : '='
      return { fieldLabel: 'Produk', valueLabel: `${opLabel} "${rule.value}"`, category: 'product' }
    }
    if (rule.field === 'order_date') return { fieldLabel: 'Tanggal', valueLabel: rule.value.replace(',', ' s/d '), category: 'date' }
    
    return { fieldLabel: rule.field, valueLabel: rule.value, category: 'product' }
  }

  const selectedStatuses = getFieldValues('status')
  const selectedSources  = getFieldValues('source_platform')
  const selectedPayments = getFieldValues('payment_method')

  // Catalog filtering by typing
  const filteredCatalogProducts = availableProducts.filter(p =>
    !productSearchInput || p.toLowerCase().includes(productSearchInput.toLowerCase())
  )

  return (
    <div style={{ marginBottom: '24px' }}>

      {/* ── Single Unified FB Ads Search & Filter Container ───────────────── */}
      <div ref={containerRef} style={{ position: 'relative' }}>
        
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

              {/* Rule Chips (FB Ads Manager Badges) */}
              {pendingRules.map(rule => {
                const { fieldLabel, valueLabel, category } = getRuleChipLabel(rule)
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
                      background: rule.field === 'product_name' ? '#FEF3C7' : 'var(--su-primary-light)',
                      border: rule.field === 'product_name' ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(37,99,235,0.25)',
                      fontSize: '12px', fontWeight: 700,
                      color: rule.field === 'product_name' ? '#B45309' : 'var(--su-primary)',
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
                placeholder={pendingRules.length > 0 || pendingQuery ? 'Tambah pencarian...' : 'Cari nama pelanggan, HP, order #, atau klik + Filter...'}
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

            {/* Reset Button */}
            {(pendingQuery || pendingRules.length > 0) && (
              <button
                onClick={() => {
                  setPendingQuery('')
                  setPendingRules([])
                  setProductSearchInput('')
                  setMinTotalInput('')
                  setStartDateInput('')
                  setEndDateInput('')
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

        {/* ── FB ADS UNIFIED FILTER POPOVER ───────────────────────────────── */}
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
                  {activeCategory === 'main' ? 'Pilih Kategori Filter' :
                   activeCategory === 'date' ? 'Rentang Tanggal' :
                   activeCategory === 'product' ? 'Produk' :
                   activeCategory === 'status' ? 'Status Pesanan' :
                   activeCategory === 'source' ? 'Sumber Order' :
                   activeCategory === 'payment' ? 'Metode Pembayaran' : 'Total Belanja Minimum'}
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
                  
                  {/* Odoo / Typing suggestions */}
                  {pendingQuery.trim().length > 0 && (
                    <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--su-border)' }}>
                      <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--su-primary)', marginBottom: '6px' }}>
                        Sugesti Kata Kunci:
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
                        <span>Filter Produk mengandung <strong style={{ color: '#D97706' }}>"{pendingQuery}"</strong></span>
                      </button>
                    </div>
                  )}

                  <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--su-text-faint)', marginBottom: '8px' }}>
                    Pilih Kategori Filter:
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    
                    {/* 1. Date Range Category (TOP POSITION) */}
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
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {existingDateRule ? existingDateRule.value.replace(',', ' s/d ') : 'Pilih tanggal mulai & akhir'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                    {/* 2. Product Category (RENAMED TO "Produk") */}
                    <button
                      onClick={() => setActiveCategory('product')}
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
                        <span style={{ fontSize: '16px' }}>🛍️</span>
                        <div>
                          <div>Produk</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>Cari kata kunci atau katalog produk</div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                    {/* 3. Status Category */}
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
                          <div>Status Pesanan</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {selectedStatuses.length > 0 ? selectedStatuses.join(', ').toUpperCase() : 'Completed, Processing, Pending, dll.'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Pilih ▾</span>
                    </button>

                    {/* 4. Source Category */}
                    <button
                      onClick={() => setActiveCategory('source')}
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
                        <span style={{ fontSize: '16px' }}>🌐</span>
                        <div>
                          <div>Sumber Order</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {selectedSources.length > 0 ? selectedSources.join(', ') : 'WooCommerce, POS, Shopee, TikTok, dll.'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Pilih ▾</span>
                    </button>

                    {/* 5. Payment Category */}
                    <button
                      onClick={() => setActiveCategory('payment')}
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
                        <span style={{ fontSize: '16px' }}>💳</span>
                        <div>
                          <div>Metode Pembayaran</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {selectedPayments.length > 0 ? selectedPayments.join(', ').toUpperCase() : 'Bank Transfer, COD, Midtrans, QRIS, dll.'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Pilih ▾</span>
                    </button>

                    {/* 6. Total Minimum Category */}
                    <button
                      onClick={() => setActiveCategory('total')}
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
                        <span style={{ fontSize: '16px' }}>💵</span>
                        <div>
                          <div>Total Belanja Minimum</div>
                          <div style={{ fontSize: '11px', color: 'var(--su-text-muted)', fontWeight: 400 }}>
                            {existingTotalRule ? `>= Rp ${Number(existingTotalRule.value).toLocaleString('id-ID')}` : 'Misal: ≥ Rp 500.000'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--su-primary)', fontWeight: 700 }}>Atur ⚙️</span>
                    </button>

                  </div>
                </div>
              )}

              {/* ── 2. FB ADS PRODUCT FILTER FORM ───────────────────────────── */}
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
                      <option>Produk</option>
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
                      <option value="contains">berisi semua dari</option>
                      <option value="is_not">tidak berisi</option>
                      <option value="is">sama persis dengan</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '10px' }}>
                    <input
                      type="text"
                      placeholder="Ketik kata kunci (misal: ash, serum) atau pilih dari katalog..."
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

              {/* ── 3. STATUS MULTI-SELECT ─────────────────────────────────── */}
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
                            onChange={() => toggleFieldValue('status', s)}
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
                      onClick={() => toggleFieldValue('status', availableStatuses.join(','))}
                      style={{ border: 'none', background: 'none', fontSize: '11px', color: 'var(--su-primary)', cursor: 'pointer', fontWeight: 700 }}
                    >
                      Pilih Semua
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

              {/* ── 4. SOURCE MULTI-SELECT ─────────────────────────────────── */}
              {activeCategory === 'source' && (
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto', marginBottom: '12px' }}>
                    {availableOrderSources.map(src => {
                      const checked = selectedSources.some(v => v.toLowerCase() === src.toLowerCase())
                      return (
                        <label
                          key={src}
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
                            onChange={() => toggleFieldValue('source_platform', src)}
                            style={{ cursor: 'pointer' }}
                          />
                          {src}
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
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

              {/* ── 5. PAYMENT METHOD MULTI-SELECT ──────────────────────────── */}
              {activeCategory === 'payment' && (
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto', marginBottom: '12px' }}>
                    {availablePaymentMethods.map(p => {
                      const checked = selectedPayments.some(v => v.toLowerCase() === p.toLowerCase())
                      const labelText = p.toLowerCase() === 'bacs' ? 'BANK TRANSFER (BACS)' : p.toUpperCase()
                      return (
                        <label
                          key={p}
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
                            onChange={() => toggleFieldValue('payment_method', p)}
                            style={{ cursor: 'pointer' }}
                          />
                          {labelText}
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid var(--su-border)' }}>
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

              {/* ── 6. TOTAL AMOUNT FORM ───────────────────────────────────── */}
              {activeCategory === 'total' && (
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--su-text)', display: 'block', marginBottom: '6px' }}>
                    Minimal Total Belanja (Rp):
                  </label>
                  <input
                    type="number"
                    placeholder="Contoh: 500000"
                    value={minTotalInput}
                    onChange={e => setMinTotalInput(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '8px',
                      border: '1px solid var(--su-border)', fontSize: '13px', outline: 'none',
                      marginBottom: '12px', boxSizing: 'border-box',
                    }}
                  />
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
                      onClick={handleApplyTotalFilter}
                      style={{
                        padding: '6px 16px', borderRadius: '7px', cursor: 'pointer',
                        background: '#2563EB', border: 'none', color: 'white',
                        fontSize: '12px', fontWeight: 800,
                      }}
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

              {/* ── 7. DATE RANGE FORM ─────────────────────────────────────── */}
              {activeCategory === 'date' && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--su-text-faint)', display: 'block', marginBottom: '4px' }}>
                        Tanggal Mulai:
                      </label>
                      <input
                        type="date"
                        value={startDateInput}
                        onChange={e => setStartDateInput(e.target.value)}
                        style={{
                          width: '100%', padding: '6px 8px', borderRadius: '7px',
                          border: '1px solid var(--su-border)', fontSize: '12px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--su-text-faint)', display: 'block', marginBottom: '4px' }}>
                        Tanggal Akhir:
                      </label>
                      <input
                        type="date"
                        value={endDateInput}
                        onChange={e => setEndDateInput(e.target.value)}
                        style={{
                          width: '100%', padding: '6px 8px', borderRadius: '7px',
                          border: '1px solid var(--su-border)', fontSize: '12px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
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
                      onClick={handleApplyDateFilter}
                      style={{
                        padding: '6px 16px', borderRadius: '7px', cursor: 'pointer',
                        background: '#2563EB', border: 'none', color: 'white',
                        fontSize: '12px', fontWeight: 800,
                      }}
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

            </div>

            {/* Footer Banner */}
            <div style={{
              padding: '8px 16px', background: '#F8FAFC', borderTop: '1px solid var(--su-border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '10px', color: 'var(--su-text-faint)' }}>Klik 'Cari' atau Enter untuk memuat</span>
              <button
                type="button"
                onClick={() => setPopoverOpen(false)}
                style={{ border: 'none', background: 'none', fontSize: '11px', fontWeight: 700, color: 'var(--su-primary)', cursor: 'pointer' }}
              >
                Selesai
              </button>
            </div>

          </div>
        )}

      </div>

    </div>
  )
}
