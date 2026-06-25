import { useMemo } from 'react'

const fmtCompact = (v: number) => {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}M`
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}jt`
  if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}rb`
  return `${v}`
}

function ChartCard({
  title,
  buckets,
  total,
  maxCount,
  colorVar,
}: {
  title: string
  buckets: { label: string; count: number; color: string }[]
  total: number
  maxCount: number
  colorVar: string
}) {
  return (
    <div style={{
      background: 'white', border: '1px solid var(--su-border)',
      borderRadius: '10px', padding: '20px',
      boxShadow: 'var(--su-shadow-sm)',
    }}>
      <h3 style={{
        margin: '0 0 16px', fontSize: '11px', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '0.14em',
        color: 'var(--su-text-muted)',
      }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {buckets.map(b => {
          const pct     = total > 0 ? (b.count / total) * 100 : 0
          const barPct  = maxCount > 0 ? (b.count / maxCount) * 100 : 0
          return (
            <div key={b.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--su-text-muted)' }}>{b.label}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--su-text)' }}>
                  {b.count.toLocaleString('id-ID')}
                  <span style={{ fontSize: '9px', fontWeight: 500, color: 'var(--su-text-faint)', marginLeft: '4px' }}>
                    ({pct.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div style={{ height: '6px', background: 'var(--su-bg)', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '99px',
                  background: b.color,
                  width: `${Math.max(barPct, pct > 0 ? 2 : 0)}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AnalyticsCharts({ customers }: { customers: any[] }) {
  const cltvDist = useMemo(() => {
    const buckets = [
      { label: '< 100rb',       min: 0,       max: 100000,   count: 0, color: '#2563EB' },
      { label: '100rb – 500rb', min: 100000,   max: 500000,   count: 0, color: '#6366F1' },
      { label: '500rb – 1jt',   min: 500000,   max: 1000000,  count: 0, color: '#8B5CF6' },
      { label: '1jt – 5jt',     min: 1000000,  max: 5000000,  count: 0, color: '#A855F7' },
      { label: '> 5jt',         min: 5000000,  max: Infinity, count: 0, color: '#D946EF' },
    ]
    customers.forEach(c => {
      const v = Number(c.ltv) || 0
      const b = buckets.find(b => v >= b.min && v < b.max)
      if (b) b.count++
    })
    return { buckets, total: customers.length, maxCount: Math.max(...buckets.map(b => b.count), 1) }
  }, [customers])

  const aovDist = useMemo(() => {
    const buckets = [
      { label: '< 50rb',        min: 0,      max: 50000,    count: 0, color: '#10B981' },
      { label: '50rb – 150rb',  min: 50000,  max: 150000,   count: 0, color: '#059669' },
      { label: '150rb – 300rb', min: 150000, max: 300000,   count: 0, color: '#0D9488' },
      { label: '300rb – 500rb', min: 300000, max: 500000,   count: 0, color: '#0891B2' },
      { label: '> 500rb',       min: 500000, max: Infinity, count: 0, color: '#0284C7' },
    ]
    customers.forEach(c => {
      const v = Number(c.aov) || 0
      const b = buckets.find(b => v >= b.min && v < b.max)
      if (b) b.count++
    })
    return { buckets, total: customers.length, maxCount: Math.max(...buckets.map(b => b.count), 1) }
  }, [customers])

  const ordersDist = useMemo(() => {
    const buckets = [
      { label: '1 Order',     min: 1,  max: 2,        count: 0, color: '#F59E0B' },
      { label: '2 Order',     min: 2,  max: 3,        count: 0, color: '#F97316' },
      { label: '3 – 5 Order', min: 3,  max: 6,        count: 0, color: '#EF4444' },
      { label: '6 – 10',      min: 6,  max: 11,       count: 0, color: '#DC2626' },
      { label: '> 10',        min: 11, max: Infinity,  count: 0, color: '#B91C1C' },
    ]
    customers.forEach(c => {
      const v = Number(c.total_order_count) || 0
      const b = buckets.find(b => v >= b.min && v < b.max)
      if (b) b.count++
    })
    return { buckets, total: customers.length, maxCount: Math.max(...buckets.map(b => b.count), 1) }
  }, [customers])

  if (customers.length === 0) {
    return (
      <div style={{
        background: 'white', border: '1px solid var(--su-border)',
        borderRadius: '10px', padding: '40px', textAlign: 'center',
        color: 'var(--su-text-faint)', fontSize: '13px', fontStyle: 'italic',
        marginBottom: '24px', boxShadow: 'var(--su-shadow-sm)',
      }}>
        Tidak ada data pelanggan untuk grafik.
      </div>
    )
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '16px',
      marginBottom: '24px',
    }}>
      <ChartCard title="Distribusi Nilai Pelanggan (LTV)" {...cltvDist} colorVar="primary" />
      <ChartCard title="Distribusi Rata-rata Order (AOV)" {...aovDist} colorVar="success" />
      <ChartCard title="Distribusi Pembelian Ulang" {...ordersDist} colorVar="accent" />
    </div>
  )
}
