import { useMemo } from 'react'

interface AnalyticsChartsProps {
  customers: any[]
}

const formatCompactIDR = (value: number) => {
  if (value >= 1000000000) return `Rp ${(value / 1000000000).toFixed(1)}M`
  if (value >= 1000000) return `Rp ${(value / 1000000).toFixed(1)}jt`
  if (value >= 1000) return `Rp ${(value / 1000).toFixed(0)}rb`
  return `Rp ${value}`
}

export function AnalyticsCharts({ customers }: AnalyticsChartsProps) {
  // 1. CLTV Distribution
  const cltvDistribution = useMemo(() => {
    const buckets = [
      { label: '< 100rb', min: 0, max: 100000, count: 0, color: 'bg-blue-500' },
      { label: '100rb - 500rb', min: 100000, max: 500000, count: 0, color: 'bg-indigo-500' },
      { label: '500rb - 1jt', min: 500000, max: 1000000, count: 0, color: 'bg-violet-500' },
      { label: '1jt - 5jt', min: 1000000, max: 5000000, count: 0, color: 'bg-purple-500' },
      { label: '> 5jt', min: 5000000, max: Infinity, count: 0, color: 'bg-fuchsia-500' }
    ]

    customers.forEach((c) => {
      const val = Number(c.ltv) || 0
      const bucket = buckets.find((b) => val >= b.min && val < b.max)
      if (bucket) bucket.count++
    })

    const total = customers.length
    const maxCount = Math.max(...buckets.map((b) => b.count), 1)

    return { buckets, total, maxCount }
  }, [customers])

  // 2. AOV Distribution
  const aovDistribution = useMemo(() => {
    const buckets = [
      { label: '< 50rb', min: 0, max: 50000, count: 0, color: 'bg-emerald-500' },
      { label: '50rb - 150rb', min: 50000, max: 150000, count: 0, color: 'bg-teal-500' },
      { label: '150rb - 300rb', min: 150000, max: 300000, count: 0, color: 'bg-cyan-500' },
      { label: '300rb - 500rb', min: 300000, max: 500000, count: 0, color: 'bg-sky-500' },
      { label: '> 500rb', min: 500000, max: Infinity, count: 0, color: 'bg-blue-500' }
    ]

    customers.forEach((c) => {
      const val = Number(c.aov) || 0
      const bucket = buckets.find((b) => val >= b.min && val < b.max)
      if (bucket) bucket.count++
    })

    const total = customers.length
    const maxCount = Math.max(...buckets.map((b) => b.count), 1)

    return { buckets, total, maxCount }
  }, [customers])

  // 3. Orders Count Distribution
  const ordersDistribution = useMemo(() => {
    const buckets = [
      { label: '1 Order', min: 1, max: 2, count: 0, color: 'bg-amber-500' },
      { label: '2 Order', min: 2, max: 3, count: 0, color: 'bg-orange-500' },
      { label: '3 - 5 Order', min: 3, max: 6, count: 0, color: 'bg-red-500' },
      { label: '6 - 10 Order', min: 6, max: 11, count: 0, color: 'bg-rose-500' },
      { label: '> 10 Order', min: 11, max: Infinity, count: 0, color: 'bg-pink-500' }
    ]

    customers.forEach((c) => {
      const val = Number(c.total_order_count) || 0
      const bucket = buckets.find((b) => val >= b.min && val < b.max)
      if (bucket) bucket.count++
    })

    const total = customers.length
    const maxCount = Math.max(...buckets.map((b) => b.count), 1)

    return { buckets, total, maxCount }
  }, [customers])

  if (customers.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 font-medium italic mb-8 shadow-sm">
        Tidak ada data pelanggan untuk ditampilkan di grafik.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
      {/* CLTV Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-6">Distribusi Nilai Pelanggan (CLTV)</h3>
        <div className="flex flex-col gap-5">
          {cltvDistribution.buckets.map((b) => {
            const pct = cltvDistribution.total > 0 ? (b.count / cltvDistribution.total) * 100 : 0
            const heightPct = (b.count / cltvDistribution.maxCount) * 100

            return (
              <div key={b.label} className="group">
                <div className="flex items-center justify-between mb-1.5 text-xs font-bold text-slate-700">
                  <span className="group-hover:text-slate-900 transition-colors">{b.label}</span>
                  <span className="text-slate-500">
                    {b.count} orang <span className="text-[10px] text-slate-400 ml-1 font-normal">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-4 w-full bg-slate-100 rounded-md overflow-hidden relative">
                  <div
                    className={`h-full rounded-md transition-all duration-500 ease-out ${b.color}`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* AOV Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-6">Distribusi Rata-rata Order (AOV)</h3>
        <div className="flex flex-col gap-5">
          {aovDistribution.buckets.map((b) => {
            const pct = aovDistribution.total > 0 ? (b.count / aovDistribution.total) * 100 : 0
            const heightPct = (b.count / aovDistribution.maxCount) * 100

            return (
              <div key={b.label} className="group">
                <div className="flex items-center justify-between mb-1.5 text-xs font-bold text-slate-700">
                  <span className="group-hover:text-slate-900 transition-colors">{b.label}</span>
                  <span className="text-slate-500">
                    {b.count} orang <span className="text-[10px] text-slate-400 ml-1 font-normal">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-4 w-full bg-slate-100 rounded-md overflow-hidden relative">
                  <div
                    className={`h-full rounded-md transition-all duration-500 ease-out ${b.color}`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Repeat Orders Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-6">Distribusi Pembelian Ulang</h3>
        <div className="flex flex-col gap-5">
          {ordersDistribution.buckets.map((b) => {
            const pct = ordersDistribution.total > 0 ? (b.count / ordersDistribution.total) * 100 : 0

            return (
              <div key={b.label} className="group">
                <div className="flex items-center justify-between mb-1.5 text-xs font-bold text-slate-700">
                  <span className="group-hover:text-slate-900 transition-colors">{b.label}</span>
                  <span className="text-slate-500">
                    {b.count} orang <span className="text-[10px] text-slate-400 ml-1 font-normal">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-4 w-full bg-slate-100 rounded-md overflow-hidden relative">
                  <div
                    className={`h-full rounded-md transition-all duration-500 ease-out ${b.color}`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
