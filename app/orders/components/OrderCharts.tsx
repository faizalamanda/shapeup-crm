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

export function OrderCharts({ orders }: { orders: any[] }) {
  const valueDist = useMemo(() => {
    const buckets = [
      { label: '< 100rb',       min: 0,       max: 100000,   count: 0, color: '#2563EB' },
      { label: '100rb – 300rb', min: 100000,   max: 300000,   count: 0, color: '#6366F1' },
      { label: '300rb – 500rb', min: 300000,   max: 500000,   count: 0, color: '#8B5CF6' },
      { label: '500rb – 1jt',   min: 500000,   max: 1000000,  count: 0, color: '#A855F7' },
      { label: '> 1jt',         min: 1000000,  max: Infinity, count: 0, color: '#D946EF' },
    ]
    orders.forEach(o => {
      const v = Number(o.grand_total) || 0
      const b = buckets.find(b => v >= b.min && v < b.max)
      if (b) b.count++
    })
    return { buckets, total: orders.length, maxCount: Math.max(...buckets.map(b => b.count), 1) }
  }, [orders])

  const paymentDist = useMemo(() => {
    const counts: Record<string, number> = {}
    orders.forEach(o => {
      const pm = (o.payment_method || 'bacs').toLowerCase()
      counts[pm] = (counts[pm] || 0) + 1
    })

    const sortedPM = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const colors = ['#10B981', '#059669', '#0D9488', '#0891B2', '#0284C7']
    
    const buckets = sortedPM.map(([pm, count], idx) => ({
      label: pm.toUpperCase(),
      count,
      color: colors[idx % colors.length]
    }))

    if (buckets.length === 0) {
      buckets.push({ label: 'N/A', count: 0, color: '#10B981' })
    }

    return { buckets, total: orders.length, maxCount: Math.max(...buckets.map(b => b.count), 1) }
  }, [orders])

  const statusDist = useMemo(() => {
    const counts: Record<string, number> = {}
    orders.forEach(o => {
      const st = (o.status || 'pending').toLowerCase()
      counts[st] = (counts[st] || 0) + 1
    })

    const sortedST = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const colors = ['#F59E0B', '#F97316', '#EF4444', '#DC2626', '#B91C1C']
    
    const buckets = sortedST.map(([st, count], idx) => ({
      label: st.toUpperCase(),
      count,
      color: colors[idx % colors.length]
    }))

    if (buckets.length === 0) {
      buckets.push({ label: 'N/A', count: 0, color: '#F59E0B' })
    }

    return { buckets, total: orders.length, maxCount: Math.max(...buckets.map(b => b.count), 1) }
  }, [orders])

  if (orders.length === 0) {
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
