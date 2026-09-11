const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/onboarding/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: dependency array
content = content.replace(
  `    }
    fetchMetrics()
  }, [dateFilter, supabase])`,
  `    }
    fetchMetrics()
  }, [dateFilter, supabase, activeBusiness?.id])`
);

// Fix 2: fetchMetrics content
const oldFetch = `  useEffect(() => {
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
        ])`;

const newFetch = `  useEffect(() => {
    async function fetchMetrics() {
      if (!activeBusiness?.id) return;
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

        const withBiz = (query) => query.eq('business_id', activeBusiness.id);

        const [o1Res, o2Res, custTotalRes, prevCustTotalRes, custNewRes, prevCustNewRes] = await Promise.all([
          withBiz(supabase.from('orders').select('grand_total, created_at').gte('created_at', start1.toISOString()).lt('created_at', end1.toISOString())),
          withBiz(supabase.from('orders').select('grand_total, created_at').gte('created_at', start2.toISOString()).lt('created_at', end2.toISOString())),
          withBiz(supabase.from('customers').select('id', {count: 'exact', head: true})),
          withBiz(supabase.from('customers').select('id', {count: 'exact', head: true}).lt('created_at', end2.toISOString())),
          withBiz(supabase.from('customers').select('id', {count: 'exact', head: true}).gte('created_at', start1.toISOString()).lt('created_at', end1.toISOString())),
          withBiz(supabase.from('customers').select('id', {count: 'exact', head: true}).gte('created_at', start2.toISOString()).lt('created_at', end2.toISOString()))
        ])`;

content = content.replace(oldFetch, newFetch);

// Fix 3: Add canAccessPath to Aksi Cepat
const oldAksi = `          <div className="flex overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 gap-3 sm:gap-4 no-scrollbar snap-x">
            {/* Kasir (POS) */}
            <Link href="/orders/pos" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#7C5A48] text-white hover:bg-[#684b3c] transition-all transform active:scale-95 shadow-md">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>
              <span className="text-[11px] sm:text-xs font-bold text-center leading-tight">Kasir (POS)</span>
            </Link>

            {/* Produk */}
            <Link href="/products" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FFF6EE] border border-[#FFE8D6] hover:bg-[#FFE8D6] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-[#B47953]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Produk</span>
            </Link>

            {/* Stok */}
            <Link href="/stock-opname" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#F0FDF4] border border-[#DCFCE7] hover:bg-[#DCFCE7] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-emerald-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Stok</span>
            </Link>

            {/* Pelanggan */}
            <Link href="/customers" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#EFF6FF] border border-[#DBEAFE] hover:bg-[#DBEAFE] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-blue-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Pelanggan</span>
            </Link>

            {/* Pesanan */}
            <Link href="/orders" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FEF2F2] border border-[#FEE2E2] hover:bg-[#FEE2E2] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-red-500">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Pesanan</span>
            </Link>

            {/* Laporan */}
            <Link href="/accounting/profit-loss" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FAF5FF] border border-[#F3E8FF] hover:bg-[#F3E8FF] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-purple-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Laporan</span>
            </Link>
          </div>`;

const newAksi = `          <div className="flex overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 gap-3 sm:gap-4 no-scrollbar snap-x">
            {/* Kasir (POS) */}
            {canAccessPath('/orders/pos', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/orders/pos" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#7C5A48] text-white hover:bg-[#684b3c] transition-all transform active:scale-95 shadow-md">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>
              <span className="text-[11px] sm:text-xs font-bold text-center leading-tight">Kasir (POS)</span>
            </Link>
            )}

            {/* Produk */}
            {canAccessPath('/products', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/products" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FFF6EE] border border-[#FFE8D6] hover:bg-[#FFE8D6] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-[#B47953]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Produk</span>
            </Link>
            )}

            {/* Stok */}
            {canAccessPath('/stock-opname', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/stock-opname" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#F0FDF4] border border-[#DCFCE7] hover:bg-[#DCFCE7] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-emerald-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Stok</span>
            </Link>
            )}

            {/* Pelanggan */}
            {canAccessPath('/customers', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/customers" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#EFF6FF] border border-[#DBEAFE] hover:bg-[#DBEAFE] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-blue-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Pelanggan</span>
            </Link>
            )}

            {/* Pesanan */}
            {canAccessPath('/orders', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/orders" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FEF2F2] border border-[#FEE2E2] hover:bg-[#FEE2E2] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-red-500">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Pesanan</span>
            </Link>
            )}

            {/* Laporan */}
            {canAccessPath('/accounting/profit-loss', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/accounting/profit-loss" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FAF5FF] border border-[#F3E8FF] hover:bg-[#F3E8FF] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-purple-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Laporan</span>
            </Link>
            )}
          </div>`;

content = content.replace(oldAksi, newAksi);

fs.writeFileSync(filePath, content);
console.log('Fixed missing business_id and Aksi Cepat access rights!');
