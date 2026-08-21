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
    <div
      style={{ borderLeftColor: accentColor }}
      className="bg-white border border-gray-200/90 rounded-xl p-3 sm:p-4 border-l-4 shadow-xs flex flex-col gap-1 transition-all hover:shadow-md"
    >
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400 m-0 truncate">
        {label}
      </p>
      <div className="text-base sm:text-lg font-black text-gray-900 leading-tight my-0.5 truncate">
        {value}
      </div>
      <p className="text-[10px] text-gray-400 m-0 truncate font-medium">{sub}</p>
    </div>
  )
}

export function StatsPanel({ customers, totalCount }: { customers: any[]; totalCount?: number }) {
  const total = totalCount !== undefined && totalCount > 0 ? totalCount : customers.length

  const totalRevenue = customers.reduce((a, c) => a + (Number(c.ltv) || 0), 0)
  const avgLTV = customers.length > 0 ? totalRevenue / customers.length : 0

  const withOrders = customers.filter(c => (c.total_order_count || 0) > 0)
  const avgAOV = withOrders.length > 0
    ? withOrders.reduce((a, c) => a + (Number(c.aov) || 0), 0) / withOrders.length
    : 0

  const repeatRate = customers.length > 0
    ? (customers.filter(c => (c.total_order_count || 0) > 1).length / customers.length) * 100
    : 0

  const vipCount = customers.filter(c => (Number(c.ltv) || 0) >= 1000000).length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 mb-6">
      <StatCard
        label="Total Customer"
        value={
          <span className="text-gray-900">
            {total.toLocaleString('id-ID')}
            <span className="text-xs font-semibold text-gray-400 ml-1">org</span>
          </span>
        }
        sub="Dalam segmen aktif"
        accentColor="#2563EB"
      />
      <StatCard
        label="Omset Segmen"
        value={
          <span className="text-blue-600 text-sm sm:text-base font-extrabold" title={formatIDR(totalRevenue)}>
            {formatIDR(totalRevenue)}
          </span>
        }
        sub="Order selesai"
        accentColor="#6366F1"
      />
      <StatCard
        label="Rata-rata LTV"
        value={
          <span className="text-sm sm:text-base font-bold text-gray-900" title={formatIDR(avgLTV)}>
            {formatIDR(avgLTV)}
          </span>
        }
        sub="Order selesai"
        accentColor="#0284C7"
      />
      <StatCard
        label="Rata-rata AOV"
        value={
          <span className="text-sm sm:text-base font-bold text-gray-900" title={formatIDR(avgAOV)}>
            {formatIDR(avgAOV)}
          </span>
        }
        sub="Order selesai"
        accentColor="#F59E0B"
      />
      <StatCard
        label="Repeat Rate"
        value={<span className="text-emerald-600 font-extrabold">{repeatRate.toFixed(1)}%</span>}
        sub="Order > 1 kali"
        accentColor="#16A34A"
      />
      <StatCard
        label="VIP (LTV ≥ 1jt)"
        value={<span className="text-purple-600 font-extrabold">{vipCount.toLocaleString('id-ID')}</span>}
        sub="LTV selesai ≥ 1jt"
        accentColor="#9333EA"
      />
    </div>
  )
}