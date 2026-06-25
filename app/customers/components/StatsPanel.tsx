const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round(val || 0))

function StatCard({
  label,
  value,
  sub,
  accentColor,
}: {
  label: string
  value: React.ReactNode
  sub: string
  accentColor: string
}) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--su-border)',
      borderRadius: '10px',
      padding: '16px 20px',
      borderLeft: `3px solid ${accentColor}`,
      boxShadow: 'var(--su-shadow-sm)',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--su-shadow)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--su-shadow-sm)' }}
    >
      <p style={{
        fontSize: '9px', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: '0.18em', color: 'var(--su-text-faint)', margin: 0,
      }}>{label}</p>
      <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--su-text)', lineHeight: 1.2, margin: '2px 0' }}>
        {value}
      </div>
      <p style={{ fontSize: '10px', color: 'var(--su-text-faint)', margin: 0 }}>{sub}</p>
    </div>
  )
}

export function StatsPanel({ customers }: { customers: any[] }) {
  const total = customers.length

  const totalRevenue = customers.reduce((a, c) => a + (Number(c.ltv) || 0), 0)
  const avgLTV = total > 0 ? totalRevenue / total : 0

  const withOrders = customers.filter(c => (c.total_order_count || 0) > 0)
  const avgAOV = withOrders.length > 0
    ? withOrders.reduce((a, c) => a + (Number(c.aov) || 0), 0) / withOrders.length
    : 0

  const repeatRate = total > 0
    ? (customers.filter(c => (c.total_order_count || 0) > 1).length / total) * 100
    : 0

  const vipCount = customers.filter(c => (Number(c.ltv) || 0) >= 1000000).length

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '12px',
      marginBottom: '24px',
    }}>
      <StatCard
        label="Total Customer"
        value={<span style={{ color: 'var(--su-text)' }}>{total.toLocaleString('id-ID')}<span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--su-text-faint)', marginLeft: '4px' }}>orang</span></span>}
        sub="Dalam segmen aktif"
        accentColor="var(--su-primary)"
      />
      <StatCard
        label="Omset Segmen (LTV)"
        value={<span style={{ color: 'var(--su-primary)', fontSize: '16px' }} title={formatIDR(totalRevenue)}>{formatIDR(totalRevenue)}</span>}
        sub="Akumulasi seluruh belanja"
        accentColor="#6366F1"
      />
      <StatCard
        label="Rata-rata LTV"
        value={<span style={{ fontSize: '16px' }} title={formatIDR(avgLTV)}>{formatIDR(avgLTV)}</span>}
        sub="Nilai per pelanggan"
        accentColor="var(--su-accent)"
      />
      <StatCard
        label="Rata-rata AOV"
        value={<span style={{ fontSize: '16px' }} title={formatIDR(avgAOV)}>{formatIDR(avgAOV)}</span>}
        sub="Nilai per transaksi"
        accentColor="#F59E0B"
      />
      <StatCard
        label="Repeat Order Rate"
        value={<span style={{ color: 'var(--su-success)' }}>{repeatRate.toFixed(1)}%</span>}
        sub="Membeli lebih dari sekali"
        accentColor="var(--su-success)"
      />
      <StatCard
        label="VIP (LTV ≥ 1jt)"
        value={<span style={{ color: '#7C3AED' }}>{vipCount.toLocaleString('id-ID')}</span>}
        sub="Pelanggan bernilai tinggi"
        accentColor="#7C3AED"
      />
    </div>
  )
}