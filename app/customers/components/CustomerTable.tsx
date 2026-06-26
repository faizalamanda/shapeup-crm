"use client"
import { useRef, useState, useEffect, useCallback, useMemo } from 'react'

const ROW_HEIGHT    = 60   // px per row (fixed for virtual scroll)
const OVERSCAN      = 8    // extra rows to render above/below viewport
const CONTAINER_H   = 600  // visible table height in px

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

function CustomerRow({ c, onSelect, style }: { c: any; onSelect: (c: any) => void; style: React.CSSProperties }) {
  const [hovered, setHovered] = useState(false)
  const badges = useMemo(() => getCustomerBadges(c), [c])
  const [avatarBg, avatarText] = avatarColor(c.name || '')

  return (
    <div
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: '2fr 1.2fr 90px 70px 130px 120px 100px 72px',
        alignItems: 'center',
        gap: 0,
        cursor: 'pointer',
        background: hovered ? '#FFFDF0' : 'white',
        borderBottom: '1px solid var(--su-border)',
        transition: 'background 0.12s',
        boxSizing: 'border-box',
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

      {/* Badges */}
      <div style={{ padding: '0 8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {badges.map(b => (
          <span key={b.label} style={{
            fontSize: '8px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: '99px',
            background: b.bg, color: b.color,
          }}>{b.label}</span>
        ))}
        {badges.length === 0 && (
          <span style={{ fontSize: '10px', color: 'var(--su-text-faint)' }}>—</span>
        )}
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

export function CustomerTable({ customers, onSelect }: { customers: any[]; onSelect: (c: any) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop)
    }
  }, [])


  // Reset scroll on data change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      setScrollTop(0)
    }
  }, [customers])

  const totalHeight  = customers.length * ROW_HEIGHT
  const startIndex   = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(CONTAINER_H / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex     = Math.min(customers.length - 1, startIndex + visibleCount)

  const visibleCustomers = customers.slice(startIndex, endIndex + 1)
  const offsetY          = startIndex * ROW_HEIGHT

  const colHeader = (label: string, align: 'left' | 'center' | 'right' = 'left') => (
    <div style={{
      fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em',
      color: 'var(--su-text-faint)', textAlign: align, padding: '0 8px',
    }}>
      {label}
    </div>
  )

  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--su-border)',
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: 'var(--su-shadow-sm)',
    }}>
      {/* Table Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1.2fr 90px 70px 130px 120px 100px 72px',
        background: '#FAFAF8',
        borderBottom: '1px solid var(--su-border)',
        height: '36px',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 1,
      }}>
        <div style={{ paddingLeft: '16px' }}>{colHeader('Nama Pelanggan')}</div>
        {colHeader('Karakteristik')}
        {colHeader('Bergabung', 'center')}
        {colHeader('Orders', 'center')}
        {colHeader('LTV Total', 'right')}
        {colHeader('AOV', 'right')}
        {colHeader('Terakhir', 'center')}
        {colHeader('Aksi', 'center')}
      </div>

      {/* Empty state */}
      {customers.length === 0 ? (
        <div style={{
          padding: '48px', textAlign: 'center',
          color: 'var(--su-text-faint)', fontSize: '13px', fontStyle: 'italic',
        }}>
          Tidak ada pelanggan yang cocok dengan kriteria segmentasi.
        </div>
      ) : (
        /* Virtual scroll container */
        <div
          ref={containerRef}
          className="su-vscroll-container"
          style={{ height: `${CONTAINER_H}px`, overflowY: 'auto' }}
          onScroll={handleScroll}
        >
          {/* Total height spacer */}
          <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
            {/* Offset wrapper for visible rows */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${offsetY}px)` }}>
              {visibleCustomers.map((c, i) => (
                <CustomerRow
                  key={c.customer_id || startIndex + i}
                  c={c}
                  onSelect={onSelect}
                  style={{ height: `${ROW_HEIGHT}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer count */}
      {customers.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--su-border)',
          background: '#FAFAF8',
          fontSize: '10px', fontWeight: 600,
          color: 'var(--su-text-faint)',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>
            Menampilkan {Math.min(endIndex - startIndex + 1, visibleCount)} baris dari {customers.length.toLocaleString('id-ID')}
          </span>
          <span>Virtual Scroll aktif</span>
        </div>
      )}
    </div>
  )
}