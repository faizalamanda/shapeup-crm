"use client"
import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(val || 0))

const TODAY = new Date()

function getInitials(name: string): string {
  return (name || '?')
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

// Deterministic avatar color from name
const AVATAR_COLORS = [
  ['#EFF6FF', '#2563EB'],
  ['#FFF7ED', '#D97706'],
  ['#F0FDF4', '#16A34A'],
  ['#FDF4FF', '#9333EA'],
  ['#FFF1F2', '#E11D48'],
  ['#F0F9FF', '#0284C7'],
]
function avatarColor(name: string) {
  const idx = (name || '').charCodeAt(0) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

function getCustomerBadges(c: any) {
  const badges: { label: string; bg: string; color: string }[] = []

  if ((Number(c.ltv) || 0) >= 1000000) {
    badges.push({ label: 'VIP', bg: '#EFF6FF', color: '#1D4ED8' })
  }
  if (c.last_order_date) {
    const diff = Math.ceil((TODAY.getTime() - new Date(c.last_order_date).getTime()) / 86400000)
    if (diff > 60) badges.push({ label: 'Churn Risk', bg: '#FEF2F2', color: '#DC2626' })
  }
  if (c.joined_at) {
    const diffJ = Math.ceil((TODAY.getTime() - new Date(c.joined_at).getTime()) / 86400000)
    if (diffJ <= 30 && (c.total_order_count || 0) <= 1) {
      badges.push({ label: 'Baru', bg: '#F0FDF4', color: '#16A34A' })
    }
  }
  if ((c.total_order_count || 0) === 1 && !badges.find(b => b.label === 'Baru')) {
    badges.push({ label: '1-Time', bg: '#F7F7F5', color: '#6B6B63' })
  }
  return badges
}

function getTagColors(tag: string) {
  const colors = [
    { bg: '#EFF6FF', text: '#1D4ED8', border: 'rgba(37,99,235,0.2)' },
    { bg: '#FDF4FF', text: '#9333EA', border: 'rgba(147,51,234,0.2)' },
    { bg: '#F0FDF4', text: '#16A34A', border: 'rgba(22,163,74,0.2)' },
    { bg: '#FFFBEB', text: '#D97706', border: 'rgba(217,119,6,0.2)' },
    { bg: '#FFF1F2', text: '#E11D48', border: 'rgba(225,29,72,0.2)' },
    { bg: '#ECFEFF', text: '#0891B2', border: 'rgba(8,145,178,0.2)' },
  ]
  const hash = (tag || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

// ─── Inline Badges (Karakteristik) Component ─────────────────────────────
function CustomerBadges({ c }: { c: any }) {
  const badges = useMemo(() => getCustomerBadges(c), [c])

  if (badges.length === 0) {
    return <span style={{ fontSize: '11px', color: 'var(--su-text-faint)' }}>—</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {badges.map(b => (
        <span
          key={b.label}
          style={{ background: b.bg, color: b.color }}
          className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
        >
          {b.label}
        </span>
      ))}
    </div>
  )
}

// ─── Inline Async Tag List Component ──────────────────────────────────────
function CustomerTagList({ c, onTagUpdate }: { c: any; onTagUpdate?: (id: string, tags: string[]) => void }) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingTag, setDeletingTag] = useState<string | null>(null)

  const customTags: string[] = c.metadata?.tags || []

  const handleAddTag = async (newTag: string) => {
    const cleanTag = newTag.trim().toUpperCase()
    if (!cleanTag) return
    if (customTags.includes(cleanTag)) {
      setTagInput('')
      setPopoverOpen(false)
      return
    }

    const updatedTags = [...customTags, cleanTag]
    setSaving(true)
    try {
      const customerId = c.customer_id || c.id
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            tags: updatedTags
          }
        })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Gagal menambahkan tag')

      if (onTagUpdate) {
        onTagUpdate(customerId, updatedTags)
      }
      setTagInput('')
      setPopoverOpen(false)
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan tag baru')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTag = async (tagToRemove: string) => {
    const updatedTags = customTags.filter(t => t !== tagToRemove)
    setDeletingTag(tagToRemove)
    try {
      const customerId = c.customer_id || c.id
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            tags: updatedTags
          }
        })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Gagal menghapus tag')

      if (onTagUpdate) {
        onTagUpdate(customerId, updatedTags)
      }
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus tag')
    } finally {
      setDeletingTag(null)
    }
  }

  const PRESET_SUGGESTIONS = ['VIP', 'RESELLER', 'GROSIR', 'DROPSHIP', 'PRIORITY', 'REPEAT', 'PROMO']

  return (
    <div className="flex flex-wrap items-center gap-1 relative" onClick={e => e.stopPropagation()}>
      {/* Custom Customer Tags */}
      {customTags.map(tag => {
        const color = getTagColors(tag)
        const isDeleting = deletingTag === tag
        return (
          <span
            key={tag}
            style={{ background: color.bg, color: color.text, borderColor: color.border }}
            className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md border shadow-2xs group transition-all"
          >
            <span>{tag}</span>
            <button
              type="button"
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteTag(tag)
              }}
              className="text-gray-400 hover:text-red-600 focus:outline-none font-bold text-[10px] leading-none opacity-70 group-hover:opacity-100 transition-opacity"
              title={`Hapus tag ${tag}`}
            >
              {isDeleting ? '...' : '✕'}
            </button>
          </span>
        )
      })}

      {/* Add Tag Button & Popover */}
      <div className="relative inline-block">
        <button
          type="button"
          disabled={saving}
          onClick={() => setPopoverOpen(!popoverOpen)}
          className="inline-flex items-center gap-1 text-[9px] font-extrabold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200/80 px-2 py-0.5 rounded-md cursor-pointer transition-all active:scale-95"
          title="Tambah tag baru untuk pelanggan ini"
        >
          {saving ? (
            <span className="w-2.5 h-2.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin inline-block" />
          ) : (
            <>
              <span>+ Tag</span>
            </>
          )}
        </button>

        {popoverOpen && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={(e) => {
              e.stopPropagation()
              setPopoverOpen(false)
            }}
          >
            <div
              className="bg-white border border-gray-200 rounded-2xl shadow-2xl p-4 w-full max-w-xs text-xs flex flex-col gap-3 animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <div>
                  <h4 className="text-xs font-bold text-gray-900">Tambah Tag Customer</h4>
                  <p className="text-[10px] text-gray-500 font-medium truncate max-w-[200px]">
                    {c.name || 'Tanpa Nama'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPopoverOpen(false)}
                  className="text-gray-400 hover:text-gray-600 font-bold p-1 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  ✕
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleAddTag(tagInput)
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  autoFocus
                  placeholder="cth: RESELLER"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-semibold text-gray-900 focus:outline-none focus:border-blue-500 uppercase"
                />
                <button
                  type="submit"
                  disabled={!tagInput.trim() || saving}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shrink-0 transition-colors"
                >
                  {saving ? '...' : '+ Tag'}
                </button>
              </form>

              {/* Quick Suggestions */}
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
                <span className="text-[9px] font-bold text-gray-400 w-full uppercase tracking-wider">Rekomendasi:</span>
                {PRESET_SUGGESTIONS.filter(st => !customTags.includes(st)).slice(0, 6).map(st => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleAddTag(st)}
                    className="text-[10px] font-bold bg-gray-100 hover:bg-blue-50 hover:text-blue-600 text-gray-700 px-2 py-1 rounded-lg border border-gray-200/80 transition-colors"
                  >
                    +{st}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}

// ─── Desktop Row Component ────────────────────────────────────────────────
function CustomerDesktopRow({
  c,
  onSelect,
  onTagUpdate,
}: {
  c: any
  onSelect: (c: any) => void
  onTagUpdate?: (id: string, tags: string[]) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [avatarBg, avatarText] = avatarColor(c.name || '')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1.1fr 1.3fr 95px 65px 120px 110px 95px 64px',
        alignItems: 'center',
        gap: 0,
        cursor: 'pointer',
        background: hovered ? '#FFFDF0' : 'white',
        borderBottom: '1px solid var(--su-border)',
        transition: 'background 0.12s',
        boxSizing: 'border-box',
        minHeight: '60px',
        padding: '8px 0',
      }}
      onClick={() => onSelect(c)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Name + Phone */}
      <div style={{ padding: '0 8px 0 16px', display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
          background: avatarBg, color: avatarText,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 800,
        }}>
          {getInitials(c.name)}
        </div>
        <div style={{ overflow: 'hidden' }}>
          <p style={{
            fontSize: '13px', fontWeight: 700, color: hovered ? 'var(--su-primary)' : 'var(--su-text)',
            margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'color 0.12s',
          }}>{c.name || 'Tanpa Nama'}</p>
          <p style={{ fontSize: '10px', color: 'var(--su-text-faint)', margin: 0, fontWeight: 500 }}>
            +{c.phone}
          </p>
        </div>
      </div>

      {/* Karakteristik */}
      <div style={{ padding: '0 8px' }}>
        <CustomerBadges c={c} />
      </div>

      {/* Tag / Label */}
      <div style={{ padding: '0 8px' }}>
        <CustomerTagList c={c} onTagUpdate={onTagUpdate} />
      </div>

      {/* Joined */}
      <div style={{ padding: '0 8px', textAlign: 'center' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--su-text-muted)' }}>
          {c.joined_at
            ? new Date(c.joined_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })
            : '—'}
        </span>
      </div>

      {/* Orders */}
      <div style={{ padding: '0 8px', textAlign: 'center' }}>
        <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--su-text)' }}>
          {c.total_order_count || 0}
        </span>
      </div>

      {/* LTV */}
      <div style={{ padding: '0 8px', textAlign: 'right' }}>
        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--su-text)' }}>
          {formatIDR(c.ltv)}
        </span>
      </div>

      {/* AOV */}
      <div style={{ padding: '0 8px', textAlign: 'right' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--su-text-muted)' }}>
          {formatIDR(c.aov)}
        </span>
      </div>

      {/* Last order */}
      <div style={{ padding: '0 8px', textAlign: 'center' }}>
        <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--su-text-muted)', margin: 0 }}>
          {c.last_order_date
            ? new Date(c.last_order_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
            : '—'}
        </p>
        {c.last_order_status && (
          <span style={{
            fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
            padding: '1px 5px', borderRadius: '4px',
            background: ['completed', 'complete'].includes(c.last_order_status.toLowerCase())
              ? '#F0FDF4' : ['failed', 'cancelled'].includes(c.last_order_status.toLowerCase())
              ? '#FEF2F2' : '#FFFBEB',
            color: ['completed', 'complete'].includes(c.last_order_status.toLowerCase())
              ? '#16A34A' : ['failed', 'cancelled'].includes(c.last_order_status.toLowerCase())
              ? '#DC2626' : '#D97706',
          }}>
            {c.last_order_status}
          </span>
        )}
      </div>

      {/* WA Button */}
      <div style={{ padding: '0 12px 0 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <a
          href={`https://wa.me/${c.phone}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '32px', height: '32px', borderRadius: '8px',
            background: '#25D366', color: 'white',
            textDecoration: 'none', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#20ba5a'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#25D366'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
          title={`WA +${c.phone}`}
        >
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.197 1.451 4.793 1.451 5.385 0 9.768-4.383 9.771-9.77.002-2.61-1.012-5.064-2.855-6.907C16.488 2.083 14.04 1.07 11.43 1.07 6.046 1.07 1.663 5.453 1.66 10.84c-.001 1.705.452 3.37 1.31 4.866l-.998 3.648 3.732-.979z"/>
          </svg>
        </a>
      </div>
    </div>
  )
}

// ─── Compact WhatsApp/Contacts Style Mobile Row Component ─────────────────────
function CustomerMobileCard({
  c,
  onSelect,
  onTagUpdate,
}: {
  c: any
  onSelect: (c: any) => void
  onTagUpdate?: (id: string, tags: string[]) => void
}) {
  const [avatarBg, avatarText] = avatarColor(c.name || '')

  return (
    <div
      className="bg-white border border-gray-200/80 rounded-xl p-3 shadow-2xs mb-2 flex flex-col gap-2 transition-all active:scale-[0.99] cursor-pointer hover:border-blue-300"
      onClick={() => onSelect(c)}
    >
      {/* Primary Row: Avatar + Name/Phone + LTV/Orders & WA */}
      <div className="flex items-center justify-between gap-2">
        {/* Left: Avatar & Customer Name / Phone */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            style={{ background: avatarBg, color: avatarText }}
            className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-black shadow-2xs border border-white"
          >
            {getInitials(c.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-gray-900 truncate leading-snug">
              {c.name || 'Tanpa Nama'}
            </h4>
            <p className="text-[10px] text-gray-500 font-medium leading-none mt-0.5 flex items-center gap-1">
              <span>+{c.phone}</span>
              {c.joined_at && (
                <span className="text-[9px] text-gray-400">
                  • {new Date(c.joined_at).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Right: LTV Value & Order Count */}
        <div className="text-right shrink-0">
          <div className="text-xs font-extrabold text-blue-700 leading-tight">
            {formatIDR(c.ltv)}
          </div>
          <div className="text-[9px] font-semibold text-gray-500 mt-0.5">
            {c.total_order_count || 0} order
          </div>
        </div>

        {/* Action: Quick WhatsApp Contact */}
        <div className="shrink-0 pl-1" onClick={e => e.stopPropagation()}>
          <a
            href={`https://wa.me/${c.phone}`}
            target="_blank"
            rel="noreferrer"
            className="w-7 h-7 rounded-lg bg-green-500 hover:bg-green-600 text-white flex items-center justify-center shadow-2xs transition-transform active:scale-95"
            title={`WA +${c.phone}`}
          >
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.197 1.451 4.793 1.451 5.385 0 9.768-4.383 9.771-9.77.002-2.61-1.012-5.064-2.855-6.907C16.488 2.083 14.04 1.07 11.43 1.07 6.046 1.07 1.663 5.453 1.66 10.84c-.001 1.705.452 3.37 1.31 4.866l-.998 3.648 3.732-.979z"/>
            </svg>
          </a>
        </div>
      </div>

      {/* Secondary Row: Separated Karakteristik & Tag List */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-gray-100/80">
        <div className="flex items-center gap-1 flex-wrap">
          <CustomerBadges c={c} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <CustomerTagList c={c} onTagUpdate={onTagUpdate} />
        </div>
      </div>
    </div>
  )
}

// ─── Main CustomerTable Component ──────────────────────────────────────────
export function CustomerTable({
  customers,
  onSelect,
  onTagUpdate,
}: {
  customers: any[]
  onSelect: (c: any) => void
  onTagUpdate?: (id: string, tags: string[]) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Sort State
  const [sortKey, setSortKey] = useState<string>('ltv')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Reset scroll on data change or sorting change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
    }
  }, [customers, sortKey, sortDirection])

  // Sorting Logic
  const sortedCustomers = useMemo(() => {
    const sorted = [...customers]
    if (!sortKey) return sorted

    sorted.sort((a, b) => {
      let aVal = a[sortKey]
      let bVal = b[sortKey]

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return sortDirection === 'asc' ? 1 : -1
      if (bVal === null || bVal === undefined) return sortDirection === 'asc' ? -1 : 1

      // Numeric comparison
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }

      // Date comparison
      if (sortKey === 'joined_at' || sortKey === 'last_order_date') {
        const aTime = new Date(aVal).getTime()
        const bTime = new Date(bVal).getTime()
        const aValid = !isNaN(aTime)
        const bValid = !isNaN(bTime)
        if (!aValid) return sortDirection === 'asc' ? 1 : -1
        if (!bValid) return sortDirection === 'asc' ? -1 : 1
        return sortDirection === 'asc' ? aTime - bTime : bTime - aTime
      }

      // String comparison (case insensitive)
      const aStr = String(aVal).toLowerCase()
      const bStr = String(bVal).toLowerCase()
      if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1
      if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return sorted
  }, [customers, sortKey, sortDirection])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDirection('desc')
    }
  }

  const colHeader = (
    label: string, 
    fieldKey?: string, 
    align: 'left' | 'center' | 'right' = 'left'
  ) => {
    const isSorted = sortKey === fieldKey
    const cursor = fieldKey ? 'pointer' : 'default'

    return (
      <div 
        onClick={() => fieldKey && handleSort(fieldKey)}
        style={{
          fontSize: '9px', 
          fontWeight: 800, 
          textTransform: 'uppercase', 
          letterSpacing: '0.16em',
          color: isSorted ? 'var(--su-primary)' : 'var(--su-text-faint)', 
          textAlign: align, 
          padding: '0 8px',
          cursor,
          userSelect: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
          gap: '4px',
          transition: 'color 0.12s',
          width: '100%',
        }}
        className={fieldKey ? 'su-sortable-header' : ''}
      >
        <span>{label}</span>
        {isSorted && (
          <span style={{ fontSize: '8px', color: 'var(--su-primary)' }}>
            {sortDirection === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </div>
    )
  }

  if (sortedCustomers.length === 0) {
    return (
      <div style={{
        background: 'white',
        border: '1px solid var(--su-border)',
        borderRadius: '12px',
        padding: '48px 24px', textAlign: 'center',
        color: 'var(--su-text-faint)', fontSize: '13px', fontStyle: 'italic',
      }}>
        Tidak ada pelanggan yang cocok dengan kriteria segmentasi.
      </div>
    )
  }

  return (
    <div>
      {/* ── MOBILE VIEW: Shopee/Amazon Style Compact Cards (< 768px) ── */}
      <div className="block md:hidden">
        {sortedCustomers.map((c, i) => (
          <CustomerMobileCard
            key={c.customer_id || c.id || i}
            c={c}
            onSelect={onSelect}
            onTagUpdate={onTagUpdate}
          />
        ))}
      </div>

      {/* ── DESKTOP VIEW: Responsive Table Container (>= 768px) ─────── */}
      <div className="hidden md:block">
        <div style={{
          background: 'white',
          border: '1px solid var(--su-border)',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: 'var(--su-shadow-sm)',
        }}>
          {/* Horizontal scroll container for table */}
          <div className="overflow-x-auto">
            <div style={{ minWidth: '1050px' }}>
              {/* Table Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '200px 1.1fr 1.3fr 95px 65px 120px 110px 95px 64px',
                background: '#FAFAF8',
                borderBottom: '1px solid var(--su-border)',
                height: '38px',
                alignItems: 'center',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}>
                <div style={{ paddingLeft: '8px' }}>{colHeader('Nama Pelanggan', 'name')}</div>
                {colHeader('Karakteristik')}
                {colHeader('Tag / Label')}
                {colHeader('Bergabung', 'joined_at', 'center')}
                {colHeader('Orders', 'total_order_count', 'center')}
                {colHeader('LTV Total', 'ltv', 'right')}
                {colHeader('AOV', 'aov', 'right')}
                {colHeader('Terakhir', 'last_order_date', 'center')}
                {colHeader('Aksi', undefined, 'center')}
              </div>

              {/* Table Rows */}
              <div ref={containerRef}>
                {sortedCustomers.map((c, i) => (
                  <CustomerDesktopRow
                    key={c.customer_id || c.id || i}
                    c={c}
                    onSelect={onSelect}
                    onTagUpdate={onTagUpdate}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}