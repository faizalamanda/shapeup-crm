"use client"
import { useRef, useState, useEffect, useCallback, useMemo } from 'react'

const ROW_HEIGHT    = 68   // px per row
const OVERSCAN      = 8    // extra rows to render above/below viewport
const CONTAINER_H   = 600  // visible table height in px

const formatIDR = (val: any) => {
  const num = Number(val) || 0
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num)
}

function OrderRow({ o, onSelect, style }: { o: any; onSelect: (o: any) => void; style: React.CSSProperties }) {
  const [hovered, setHovered] = useState(false)

  // Determinisitc status badge colors
  const statusColor = (status: string) => {
    const s = (status || '').toLowerCase()
    if (['completed', 'selesai'].includes(s)) {
      return { bg: '#F0FDF4', color: '#16A34A', border: 'rgba(22,163,74,0.15)' }
    }
    if (['processing', 'sedang diproses'].includes(s)) {
      return { bg: '#EFF6FF', color: '#2563EB', border: 'rgba(37,99,235,0.15)' }
    }
    if (['pending', 'menunggu pembayaran'].includes(s)) {
      return { bg: '#FFFBEB', color: '#D97706', border: 'rgba(217,119,6,0.15)' }
    }
    if (['failed', 'cancelled', 'batal', 'gagal'].includes(s)) {
      return { bg: '#FEF2F2', color: '#DC2626', border: 'rgba(220,38,38,0.15)' }
    }
    return { bg: '#F7F7F5', color: '#6B6B63', border: 'var(--su-border)' }
  }

  const sc = statusColor(o.status)

  return (
    <div
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: '90px 180px 100px 240px 60px 110px 100px 100px 130px 110px 60px',
        alignItems: 'center',
        gap: 0,
        cursor: 'pointer',
        background: hovered ? '#FFFDF0' : 'white',
        borderBottom: '1px solid var(--su-border)',
        transition: 'background 0.12s',
        boxSizing: 'border-box',
      }}
      onClick={() => onSelect(o)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Order Number */}
      <div style={{ padding: '0 8px 0 16px', fontWeight: 800, color: 'var(--su-text-muted)', fontSize: '11px' }}>
        #{o.order_number || o.id.toString().substring(0, 6)}
      </div>

      {/* Customer Name */}
      <div style={{ padding: '0 8px', overflow: 'hidden' }}>
        <p style={{
          fontSize: '12px', fontWeight: 700,
          color: hovered ? 'var(--su-primary)' : 'var(--su-text)',
          margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 0.12s',
        }}>{o.customer?.name || 'Tanpa Nama'}</p>
        <p style={{ fontSize: '10px', color: 'var(--su-text-faint)', margin: 0, fontWeight: 500 }}>
          {o.customer?.phone ? `+${o.customer.phone}` : '—'}
        </p>
      </div>

      {/* Order Date */}
      <div style={{ padding: '0 8px', fontSize: '11px', color: 'var(--su-text-muted)' }}>
        {o.order_date
          ? new Date(o.order_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })
          : '—'}
      </div>

      {/* Product Items (jsonb list) */}
      <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
        {o.items_json?.slice(0, 2).map((item: any, i: number) => (
          <p key={i} style={{
            fontSize: '11px', color: 'var(--su-text-muted)', margin: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontWeight: 500,
          }}>
            <span style={{
              fontSize: '9px', fontWeight: 800, background: 'var(--su-bg)',
              padding: '1px 4px', borderRadius: '4px', marginRight: '4px',
              border: '1px solid var(--su-border)',
            }}>{item.quantity}x</span>
            {item.name}
          </p>
        ))}
        {o.items_json?.length > 2 && (
          <p style={{ fontSize: '9px', fontWeight: 700, color: 'var(--su-text-faint)', margin: 0 }}>
            + {o.items_json.length - 2} item lainnya
          </p>
        )}
      </div>

      {/* Quantity */}
      <div style={{ padding: '0 8px', textAlign: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--su-text)' }}>
        {o.total_qty || 0}
      </div>

      {/* Subtotal */}
      <div style={{ padding: '0 8px', textAlign: 'right', fontSize: '12px', color: 'var(--su-text-muted)' }}>
        {formatIDR(o.subtotal)}
      </div>

      {/* Shipping Cost */}
      <div style={{ padding: '0 8px', textAlign: 'right', fontSize: '12px', color: 'var(--su-text-muted)' }}>
        {formatIDR(o.shipping_cost)}
      </div>

      {/* Discount Amount */}
      <div style={{ padding: '0 8px', textAlign: 'right', fontSize: '12px', color: 'var(--su-danger)' }}>
        {Number(o.discount_amount) > 0 ? `-${formatIDR(o.discount_amount)}` : '—'}
      </div>

      {/* Grand Total */}
      <div style={{
        padding: '0 12px', textAlign: 'right', fontSize: '13px', fontWeight: 800,
        color: 'var(--su-text)', background: hovered ? '#FFFDE0' : '#FAFAF8',
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        borderLeft: '1px solid var(--su-border)', borderRight: '1px solid var(--su-border)',
        boxSizing: 'border-box',
      }}>
        {formatIDR(o.grand_total)}
      </div>

      {/* Status Badge */}
      <div style={{ padding: '0 8px', textAlign: 'center' }}>
        <span style={{
          fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
          padding: '2px 8px', borderRadius: '5px',
          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
          display: 'inline-block',
        }}>
          {o.status}
        </span>
      </div>

      {/* WhatsApp chat button */}
      <div style={{ padding: '0 12px 0 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        {o.customer?.phone ? (
          <a
            href={`https://wa.me/${o.customer.phone}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '28px', height: '28px', borderRadius: '6px',
              background: '#25D366', color: 'white',
              textDecoration: 'none', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#20ba5a'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#25D366'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
            title={`Hubungi WA +${o.customer.phone}`}
          >
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.197 1.451 4.793 1.451 5.385 0 9.768-4.383 9.771-9.77.002-2.61-1.012-5.064-2.855-6.907C16.488 2.083 14.04 1.07 11.43 1.07 6.046 1.07 1.663 5.453 1.66 10.84c-.001 1.705.452 3.37 1.31 4.866l-.998 3.648 3.732-.979z"/>
            </svg>
          </a>
        ) : (
          <span style={{ fontSize: '11px', color: 'var(--su-text-faint)' }}>—</span>
        )}
      </div>
    </div>
  )
}

export function OrderTable({ orders, onSelectOrder }: { orders: any[]; onSelectOrder: (o: any) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop)
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Reset scroll on data change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      setScrollTop(0)
    }
  }, [orders])

  const totalHeight  = orders.length * ROW_HEIGHT
  const startIndex   = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(CONTAINER_H / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex     = Math.min(orders.length - 1, startIndex + visibleCount)

  const visibleOrders = orders.slice(startIndex, endIndex + 1)
  const offsetY       = startIndex * ROW_HEIGHT

  const colHeader = (label: string, align: 'left' | 'center' | 'right' = 'left', extraStyles?: React.CSSProperties) => (
    <div style={{
      fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em',
      color: 'var(--su-text-faint)', textAlign: align, padding: '0 8px', ...extraStyles
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
      width: '100%',
      overflowX: 'auto',
    }}>
      <div style={{ minWidth: '1280px' }}>
        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '90px 180px 100px 240px 60px 110px 100px 100px 130px 110px 60px',
          background: '#FAFAF8',
          borderBottom: '1px solid var(--su-border)',
          height: '36px',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}>
          <div style={{ paddingLeft: '16px' }}>{colHeader('ID Order')}</div>
          {colHeader('Nama Pelanggan')}
          {colHeader('Tanggal')}
          {colHeader('Item Produk')}
          {colHeader('Qty', 'center')}
          {colHeader('Subtotal', 'right')}
          {colHeader('Ongkir', 'right')}
          {colHeader('Diskon', 'right')}
          {colHeader('Total Order', 'right', { paddingRight: '12px' })}
          {colHeader('Status', 'center')}
          {colHeader('Aksi', 'center')}
        </div>

        {/* Empty state */}
        {orders.length === 0 ? (
          <div style={{
            padding: '48px', textAlign: 'center',
            color: 'var(--su-text-faint)', fontSize: '13px', fontStyle: 'italic',
          }}>
            Tidak ada pesanan yang cocok dengan kriteria segmentasi.
          </div>
        ) : (
          /* Virtual scroll container */
          <div
            ref={containerRef}
            className="su-vscroll-container"
            style={{ height: `${CONTAINER_H}px`, overflowY: 'auto' }}
          >
            {/* Total height spacer */}
            <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
              {/* Offset wrapper for visible rows */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${offsetY}px)` }}>
                {visibleOrders.map((o, i) => (
                  <OrderRow
                    key={o.id || startIndex + i}
                    o={o}
                    onSelect={onSelectOrder}
                    style={{ height: `${ROW_HEIGHT}px` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer count */}
        {orders.length > 0 && (
          <div style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--su-border)',
            background: '#FAFAF8',
            fontSize: '10px', fontWeight: 600,
            color: 'var(--su-text-faint)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>
              Menampilkan {Math.min(endIndex - startIndex + 1, visibleCount)} baris dari {orders.length.toLocaleString('id-ID')}
            </span>
            <span>Virtual Scroll aktif</span>
          </div>
        )}
      </div>
    </div>
  )
}