import React from 'react'

export function OrderStatsSkeleton() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '12px',
      marginBottom: '24px',
    }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} style={{
          background: 'white',
          border: '1px solid var(--su-border)',
          borderRadius: '10px',
          padding: '16px 20px',
          borderLeft: '3px solid var(--su-border)',
          boxShadow: 'var(--su-shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div className="su-skeleton" style={{ width: '80px', height: '10px' }} />
          <div className="su-skeleton" style={{ width: '130px', height: '24px', margin: '4px 0' }} />
          <div className="su-skeleton" style={{ width: '100px', height: '10px' }} />
        </div>
      ))}
    </div>
  )
}

export function OrderChartsSkeleton() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '16px',
      marginBottom: '24px',
    }}>
      {[...Array(3)].map((_, i) => (
        <div key={i} style={{
          background: 'white', border: '1px solid var(--su-border)',
          borderRadius: '10px', padding: '20px',
          boxShadow: 'var(--su-shadow-sm)',
        }}>
          <div className="su-skeleton" style={{ width: '160px', height: '12px', marginBottom: '20px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[...Array(4)].map((_, j) => (
              <div key={j}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div className="su-skeleton" style={{ width: '90px', height: '10px' }} />
                  <div className="su-skeleton" style={{ width: '50px', height: '10px' }} />
                </div>
                <div className="su-skeleton" style={{ width: '100%', height: '6px', borderRadius: '99px' }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function OrderTableSkeleton() {
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
        {/* Table Header matching OrderTable.tsx exactly */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '90px 180px 100px 240px 60px 110px 100px 100px 130px 110px 60px',
          background: '#FAFAF8',
          borderBottom: '1px solid var(--su-border)',
          height: '36px',
          alignItems: 'center',
        }}>
          <div style={{ paddingLeft: '16px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)' }}>ID Order</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)' }}>Nama Pelanggan</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)' }}>Tanggal</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)' }}>Item Produk</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)', textAlign: 'center' }}>Qty</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)', textAlign: 'right' }}>Subtotal</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)', textAlign: 'right' }}>Ongkir</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)', textAlign: 'right' }}>Diskon</div>
          <div style={{ padding: '0 12px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)', textAlign: 'right' }}>Total Order</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)', textAlign: 'center' }}>Status</div>
          <div style={{ padding: '0 8px', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--su-text-faint)', textAlign: 'center' }}>Aksi</div>
        </div>

        {/* Skeleton Rows mimicking ROW_HEIGHT (68px) and grid layout */}
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '90px 180px 100px 240px 60px 110px 100px 100px 130px 110px 60px',
              alignItems: 'center',
              height: '68px',
              borderBottom: '1px solid var(--su-border)',
              background: 'white',
            }}
          >
            {/* Order Number */}
            <div style={{ padding: '0 8px 0 16px' }}>
              <div className="su-skeleton" style={{ width: '50px', height: '12px' }} />
            </div>

            {/* Customer Name */}
            <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="su-skeleton" style={{ width: '110px', height: '12px' }} />
              <div className="su-skeleton" style={{ width: '70px', height: '9px' }} />
            </div>

            {/* Date */}
            <div style={{ padding: '0 8px' }}>
              <div className="su-skeleton" style={{ width: '60px', height: '11px' }} />
            </div>

            {/* Items */}
            <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="su-skeleton" style={{ width: '160px', height: '10px' }} />
              <div className="su-skeleton" style={{ width: '120px', height: '10px' }} />
            </div>

            {/* Qty */}
            <div style={{ padding: '0 8px', textAlign: 'center' }}>
              <div className="su-skeleton" style={{ width: '16px', height: '12px' }} />
            </div>

            {/* Subtotal */}
            <div style={{ padding: '0 8px', display: 'flex', justifyContent: 'flex-end' }}>
              <div className="su-skeleton" style={{ width: '75px', height: '12px' }} />
            </div>

            {/* Ongkir */}
            <div style={{ padding: '0 8px', display: 'flex', justifyContent: 'flex-end' }}>
              <div className="su-skeleton" style={{ width: '55px', height: '12px' }} />
            </div>

            {/* Diskon */}
            <div style={{ padding: '0 8px', display: 'flex', justifyContent: 'flex-end' }}>
              <div className="su-skeleton" style={{ width: '45px', height: '12px' }} />
            </div>

            {/* Total Order */}
            <div style={{ padding: '0 12px', display: 'flex', justifyContent: 'flex-end', background: '#FAFAF8', height: '100%', alignItems: 'center', borderLeft: '1px solid var(--su-border)', borderRight: '1px solid var(--su-border)' }}>
              <div className="su-skeleton" style={{ width: '80px', height: '13px' }} />
            </div>

            {/* Status */}
            <div style={{ padding: '0 8px', display: 'flex', justifyContent: 'center' }}>
              <div className="su-skeleton" style={{ width: '70px', height: '16px', borderRadius: '5px' }} />
            </div>

            {/* Actions */}
            <div style={{ padding: '0 12px 0 8px', display: 'flex', justifyContent: 'center' }}>
              <div className="su-skeleton" style={{ width: '28px', height: '28px', borderRadius: '6px' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
