"use client"
export default function DashboardPage() {
  const stats = [
    { label: 'Total Customers', value: '1,284', grow: '+12%', icon: '👤' },
    { label: 'Total Revenue', value: 'Rp 45.2M', grow: '+8.4%', icon: '💰' },
    { label: 'Open Opportunities', value: '24', grow: '-2', icon: '🎯' },
    { label: 'Abandoned Carts', value: '12', grow: '+5', icon: '🛒' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Selamat Datang, Chief! 👋</h1>
        <p className="text-slate-500">Inilah performa bisnis Anda hari ini.</p>
      </div>

      {/* STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <span className="text-2xl">{stat.icon}</span>
              <span className={`text-xs font-bold px-2 py-1 rounded ${stat.grow.startsWith('+') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                {stat.grow}
              </span>
            </div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ROW 2: CHART PLACEHOLDER & RECENT ACTIVITY */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 h-80 flex flex-col justify-center items-center text-slate-400">
           <span className="text-4xl mb-2">📈</span>
           <p>Grafik Penjualan akan muncul di sini</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200">
           <h3 className="font-bold mb-4">Aktivitas Terbaru</h3>
           <div className="space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="flex gap-3 text-sm border-l-2 border-blue-500 pl-3">
                  <p className="text-slate-600"><span className="font-bold text-slate-900">Andi</span> baru saja melakukan pembelian.</p>
                </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  )
}