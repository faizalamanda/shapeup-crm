const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/onboarding/page.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

const newComponent = `      {/* ─── NEW HERO DASHBOARD & AKSI CEPAT ─────────────────────────────── */}
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Welcome Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              Good morning, Faiz! <span className="text-2xl animate-wave">👋</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">Semoga hari ini penjualan makin lancar.</p>
          </div>
          
          <div className="flex items-center gap-2 bg-white/60 backdrop-blur-md border border-slate-200/60 px-4 py-2 rounded-xl shadow-sm w-fit">
            <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div>
              <div className="text-xs font-bold text-slate-800">{new Date().toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
          </div>
        </div>

        {/* Dashboard Card */}
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-100 rounded-3xl p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row justify-between gap-6">
            
            {/* Left side */}
            <div className="space-y-4 lg:w-1/3">
              <div>
                <h3 className="text-sm font-bold text-slate-700">Penjualan Hari Ini</h3>
                <div className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter mt-1">
                  Rp 8.420.000
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-sm">
                  <span className="text-emerald-600 font-bold flex items-center">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7"/></svg>
                    12,4%
                  </span>
                  <span className="text-slate-500">dari Senin lalu</span>
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
                  <span className="text-lg font-black text-slate-800">184</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Transaksi</div>
                  <div className="text-[10px] font-bold text-emerald-600 mt-0.5">↑ 10%</div>
                </div>
              </div>
              {/* Metric 2 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                  </div>
                  <span className="text-sm font-black text-slate-800 truncate">Rp 45.800</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium leading-tight">Rata-rata Transaksi</div>
                  <div className="text-[10px] font-bold text-emerald-600 mt-0.5">↑ 6%</div>
                </div>
              </div>
              {/* Metric 3 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">127</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Pelanggan</div>
                  <div className="text-[10px] font-bold text-emerald-600 mt-0.5">↑ 18%</div>
                </div>
              </div>
              {/* Metric 4 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">32</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Pelanggan Baru</div>
                  <div className="text-[10px] font-bold text-emerald-600 mt-0.5">↑ 33%</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Aksi Cepat */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-extrabold text-slate-900">Aksi Cepat</h2>
            <Link href="/orders" className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1">
              Lihat semua <span>→</span>
            </Link>
          </div>
          
          <div className="flex overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 gap-3 sm:gap-4 no-scrollbar snap-x">
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
          </div>
        </div>
      </div>`;

// Replace lines 521 to 757 (inclusive) with new component
lines.splice(521, 237, newComponent);

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Successfully replaced Quick Menu with Dashboard & Aksi Cepat!');
