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

export function OrderStats({ orders }: { orders: any[] }) {
  const totalOrders = orders.length

  const grossSales = orders.reduce((acc, curr) => acc + (Number(curr.grand_total) || 0), 0)
  
  const totalDiscounts = orders.reduce((acc, curr) => acc + (Number(curr.discount_amount) || 0), 0)
  
  // Net Sales = Gross Sales - Discounts
  const netSales = grossSales - totalDiscounts

  const aov = totalOrders > 0 ? grossSales / totalOrders : 0

  const totalItems = orders.reduce((acc, curr) => acc + (Number(curr.total_qty) || 0), 0)
  const avgItemsPerOrder = totalOrders > 0 ? totalItems / totalOrders : 0

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '12px',
      marginBottom: '24px',
    }}>
      <StatCard
        label="Total Orders"
        value={<span style={{ color: 'var(--su-text)' }}>{totalOrders.toLocaleString('id-ID')}<span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--su-text-faint)', marginLeft: '4px' }}>order</span></span>}
        sub="Dalam segmen aktif"
        accentColor="var(--su-primary)"
      />
      <StatCard
        label="Gross Sales (Omzet)"
        value={<span style={{ color: 'var(--su-primary)', fontSize: '16px' }} title={formatIDR(grossSales)}>{formatIDR(grossSales)}</span>}
        sub="Akumulasi kotor belanja"
        accentColor="#6366F1"
      />
      <StatCard
        label="Net Sales"
        value={<span style={{ color: 'var(--su-success)', fontSize: '16px' }} title={formatIDR(netSales)}>{formatIDR(netSales)}</span>}
        sub="Gross Sales - Diskon"
        accentColor="var(--su-success)"
      />
      <StatCard
        label="Rata-rata Order (AOV)"
        value={<span style={{ fontSize: '16px' }} title={formatIDR(aov)}>{formatIDR(aov)}</span>}
        sub="Nilai belanja rata-rata"
        accentColor="var(--su-accent)"
      />
      <StatCard
        label="Total Diskon"
        value={<span style={{ color: 'var(--su-danger)', fontSize: '16px' }} title={formatIDR(totalDiscounts)}>-{formatIDR(totalDiscounts)}</span>}
        sub="Potongan harga yang diberikan"
        accentColor="var(--su-danger)"
      />
      <StatCard
        label="Avg Items / Order"
        value={<span style={{ color: '#7C3AED' }}>{avgItemsPerOrder.toFixed(1)}<span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--su-text-faint)', marginLeft: '4px' }}>item</span></span>}
        sub="Rata-rata item per order"
        accentColor="#7C3AED"
      />
    </div>
  )
}