const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/onboarding/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Inject states inside OnboardingPage
const stateInjection = `  const { currentUserRole, currentUserPermissions, isWabaActive, bizLoading: isRoleLoading, userProfile } = useUserContext()

  // Real-time Metrics State
  const [metrics, setMetrics] = useState({
    sales: 0, salesGrowth: 0, trx: 0, trxGrowth: 0, avg: 0, avgGrowth: 0, cust: 0, custGrowth: 0, newCust: 0, newCustGrowth: 0
  })
  const [dateFilter, setDateFilter] = useState('today')
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true)

  useEffect(() => {
    async function fetchMetrics() {
      setIsLoadingMetrics(true)
      try {
        const now = new Date()
        let start1, end1, start2, end2
        const dayMs = 24 * 60 * 60 * 1000

        if (dateFilter === 'today') {
           start1 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
           end1 = new Date(start1.getTime() + dayMs)
           start2 = new Date(start1.getTime() - dayMs)
           end2 = start1
        } else if (dateFilter === 'yesterday') {
           start1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
           end1 = new Date(start1.getTime() + dayMs)
           start2 = new Date(start1.getTime() - dayMs)
           end2 = start1
        } else if (dateFilter === 'last7') {
           start1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
           end1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
           start2 = new Date(start1.getTime() - 7 * dayMs)
           end2 = start1
        } else { // thisMonth
           start1 = new Date(now.getFullYear(), now.getMonth(), 1)
           end1 = new Date(now.getFullYear(), now.getMonth() + 1, 1)
           start2 = new Date(now.getFullYear(), now.getMonth() - 1, 1)
           end2 = start1
        }

        const [o1Res, o2Res, custTotalRes, prevCustTotalRes, custNewRes, prevCustNewRes] = await Promise.all([
          supabase.from('orders').select('grand_total, created_at').gte('created_at', start1.toISOString()).lt('created_at', end1.toISOString()),
          supabase.from('orders').select('grand_total, created_at').gte('created_at', start2.toISOString()).lt('created_at', end2.toISOString()),
          supabase.from('customers').select('id', {count: 'exact', head: true}),
          supabase.from('customers').select('id', {count: 'exact', head: true}).lt('created_at', end2.toISOString()),
          supabase.from('customers').select('id', {count: 'exact', head: true}).gte('created_at', start1.toISOString()).lt('created_at', end1.toISOString()),
          supabase.from('customers').select('id', {count: 'exact', head: true}).gte('created_at', start2.toISOString()).lt('created_at', end2.toISOString())
        ])

        const o1 = o1Res.data || []
        const o2 = o2Res.data || []

        const s1 = o1.reduce((acc, o) => acc + (o.grand_total || 0), 0)
        const t1 = o1.length
        const a1 = t1 > 0 ? s1 / t1 : 0
        
        const s2 = o2.reduce((acc, o) => acc + (o.grand_total || 0), 0)
        const t2 = o2.length
        const a2 = t2 > 0 ? s2 / t2 : 0

        const calcGrowth = (curr, prev) => prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0)

        setMetrics({
          sales: s1, salesGrowth: calcGrowth(s1, s2),
          trx: t1, trxGrowth: calcGrowth(t1, t2),
          avg: a1, avgGrowth: calcGrowth(a1, a2),
          cust: custTotalRes.count || 0, custGrowth: calcGrowth(custTotalRes.count || 0, prevCustTotalRes.count || 0),
          newCust: custNewRes.count || 0, newCustGrowth: calcGrowth(custNewRes.count || 0, prevCustNewRes.count || 0)
        })

      } catch(e) {
        console.error('Error fetching metrics', e)
      }
      setIsLoadingMetrics(false)
    }
    fetchMetrics()
  }, [dateFilter, supabase])
`;

content = content.replace(
  `  const { currentUserRole, currentUserPermissions, isWabaActive, bizLoading: isRoleLoading } = useUserContext()`,
  stateInjection
);

// 2. Replace the static Hero Section with Dynamic one
const staticHeroStart = `      {/* ─── NEW HERO DASHBOARD & AKSI CEPAT ─────────────────────────────── */}`;
const staticHeroEnd = `        {/* Aksi Cepat */}`;

const dynamicHero = `      {/* ─── NEW HERO DASHBOARD & AKSI CEPAT ─────────────────────────────── */}
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Welcome Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              Good morning, {userProfile?.full_name?.split(' ')[0] || userProfile?.name?.split(' ')[0] || 'User'}! <span className="text-2xl animate-wave">👋</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">Semoga hari ini penjualan makin lancar.</p>
          </div>
          
          <div className="flex items-center gap-2 bg-white/60 backdrop-blur-md border border-slate-200/60 px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl shadow-sm w-fit relative group">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="appearance-none bg-transparent text-xs sm:text-sm font-bold text-slate-800 focus:outline-none cursor-pointer pr-4"
            >
              <option value="today">Hari Ini</option>
              <option value="yesterday">Kemarin</option>
              <option value="last7">7 Hari Terakhir</option>
              <option value="thisMonth">Bulan Ini</option>
            </select>
            <svg className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Dashboard Card */}
        <div className={\`bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-100 rounded-3xl p-5 sm:p-6 shadow-sm transition-opacity duration-300 \${isLoadingMetrics ? 'opacity-60' : 'opacity-100'}\`}>
          <div className="flex flex-col lg:flex-row justify-between gap-6">
            
            {/* Left side */}
            <div className="space-y-4 lg:w-1/3">
              <div>
                <h3 className="text-sm font-bold text-slate-700">Penjualan {dateFilter === 'today' ? 'Hari Ini' : dateFilter === 'yesterday' ? 'Kemarin' : dateFilter === 'last7' ? '7 Hari Terakhir' : 'Bulan Ini'}</h3>
                <div className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter mt-1">
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(metrics.sales)}
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-sm">
                  <span className={\`font-bold flex items-center \${metrics.salesGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}\`}>
                    <svg className={\`w-4 h-4 transform \${metrics.salesGrowth < 0 ? 'rotate-180' : ''}\`} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7"/></svg>
                    {Math.abs(metrics.salesGrowth).toFixed(1)}%
                  </span>
                  <span className="text-slate-500">dari periode sblmnya</span>
                </div>
              </div>
            </div>

            {/* Right side (Metrics) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:w-2/3">
              {/* Metric 1 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">{new Intl.NumberFormat('id-ID').format(metrics.trx)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Transaksi</div>
                  <div className={\`text-[10px] font-bold mt-0.5 \${metrics.trxGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}\`}>{metrics.trxGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.trxGrowth).toFixed(1)}%</div>
                </div>
              </div>
              {/* Metric 2 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                  </div>
                  <span className="text-sm font-black text-slate-800 truncate">{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(metrics.avg)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium leading-tight">Rata-rata Transaksi</div>
                  <div className={\`text-[10px] font-bold mt-0.5 \${metrics.avgGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}\`}>{metrics.avgGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.avgGrowth).toFixed(1)}%</div>
                </div>
              </div>
              {/* Metric 3 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">{new Intl.NumberFormat('id-ID').format(metrics.cust)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Pelanggan</div>
                  <div className={\`text-[10px] font-bold mt-0.5 \${metrics.custGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}\`}>{metrics.custGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.custGrowth).toFixed(1)}%</div>
                </div>
              </div>
              {/* Metric 4 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">{new Intl.NumberFormat('id-ID').format(metrics.newCust)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Pelanggan Baru</div>
                  <div className={\`text-[10px] font-bold mt-0.5 \${metrics.newCustGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}\`}>{metrics.newCustGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.newCustGrowth).toFixed(1)}%</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Aksi Cepat */}`;

const startIndex = content.indexOf(staticHeroStart);
const endIndex = content.indexOf(staticHeroEnd) + staticHeroEnd.length;

if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + dynamicHero + content.substring(endIndex);
  fs.writeFileSync(filePath, content);
  console.log('Successfully injected dynamic UI and state!');
} else {
  console.log('Could not find injection boundaries.');
}
