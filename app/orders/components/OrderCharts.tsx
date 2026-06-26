import { useMemo } from 'react'

function ChartCard({
  title,
  buckets,
  total,
  maxCount,
}: {
  title: string
  buckets: { label: string; count: number; color: string }[]
  total: number
  maxCount: number
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

export interface OrderChartsData {
  value_dist: {
    under_100k: number
    "100k_300k": number
    "300k_500k": number
    "500k_1m": number
    over_1m: number
  }
  payment_dist: { payment_method: string; count: number }[]
  status_dist: { status: string; count: number }[]
}

export function OrderCharts({ data }: { data: OrderChartsData | null }) {
  const valueDist = useMemo(() => {
    if (!data?.value_dist) return { buckets: [], total: 0, maxCount: 1 }
    
    const buckets = [
      { label: '< 100rb',       count: data.value_dist.under_100k || 0, color: '#2563EB' },
      { label: '100rb – 300rb', count: data.value_dist["100k_300k"] || 0, color: '#6366F1' },
      { label: '300rb – 500rb', count: data.value_dist["300k_500k"] || 0, color: '#8B5CF6' },
      { label: '500rb – 1jt',   count: data.value_dist["500k_1m"] || 0, color: '#A855F7' },
      { label: '> 1jt',         count: data.value_dist.over_1m || 0, color: '#D946EF' },
    ]
    const total = buckets.reduce((sum, b) => sum + b.count, 0)
    const maxCount = Math.max(...buckets.map(b => b.count), 1)
    return { buckets, total, maxCount }
  }, [data])

  const paymentDist = useMemo(() => {
    if (!data?.payment_dist || data.payment_dist.length === 0) {
      return { buckets: [{ label: 'N/A', count: 0, color: '#10B981' }], total: 0, maxCount: 1 }
    }
    const colors = ['#10B981', '#059669', '#0D9488', '#0891B2', '#0284C7']
    const buckets = data.payment_dist.map((item, idx) => ({
      label: (item.payment_method || 'Manual').toUpperCase(),
      count: Number(item.count) || 0,
      color: colors[idx % colors.length]
    }))
    const total = buckets.reduce((sum, b) => sum + b.count, 0)
    const maxCount = Math.max(...buckets.map(b => b.count), 1)
    return { buckets, total, maxCount }
  }, [data])

  const statusDist = useMemo(() => {
    if (!data?.status_dist || data.status_dist.length === 0) {
      return { buckets: [{ label: 'N/A', count: 0, color: '#F59E0B' }], total: 0, maxCount: 1 }
    }
    const colors = ['#F59E0B', '#F97316', '#EF4444', '#DC2626', '#B91C1C']
    const buckets = data.status_dist.map((item, idx) => ({
      label: (item.status || 'Pending').toUpperCase(),
      count: Number(item.count) || 0,
      color: colors[idx % colors.length]
    }))
    const total = buckets.reduce((sum, b) => sum + b.count, 0)
    const maxCount = Math.max(...buckets.map(b => b.count), 1)
    return { buckets, total, maxCount }
  }, [data])

  const totalAll = valueDist.total + paymentDist.total + statusDist.total
  if (!data || totalAll === 0) {
    return (
      <div style={{
        background: 'white', border: '1px solid var(--su-border)',
        borderRadius: '10px', padding: '40px', textAlign: 'center',
        color: 'var(--su-text-faint)', fontSize: '13px', fontStyle: 'italic',
        marginBottom: '24px', boxShadow: 'var(--su-shadow-sm)',
      }}>
        Tidak ada data pesanan untuk grafik.
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
      <ChartCard title="Distribusi Nilai Pesanan" {...valueDist} />
      <ChartCard title="Distribusi Metode Pembayaran" {...paymentDist} />
      <ChartCard title="Distribusi Status Pesanan" {...statusDist} />
    </div>
  )
}
