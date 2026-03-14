"use client"
import { Inter } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isActive = (path: string) => pathname === path

  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50`}>
        <div className="flex min-h-screen relative">
          
          {/* --- SIDEBAR --- */}
          <aside className="w-72 bg-[#0F172A] text-slate-400 flex flex-col fixed h-screen z-50 border-r border-slate-800">
            {/* Logo */}
            <div className="p-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-500/20">
                  C
                </div>
                <div>
                  <h1 className="text-white font-black text-lg tracking-tighter leading-none">CRM</h1>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Business Suite</p>
                </div>
              </div>
            </div>

            {/* Navigasi */}
            <nav className="flex-1 px-4 space-y-2 mt-4">
              <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-2">Main Menu</p>
              
              <Link href="/orders" className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all group ${isActive('/orders') ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/20' : 'hover:bg-slate-800/50 hover:text-slate-200'}`}>
                <span className="text-xl">📦</span>
                <span className="text-sm font-bold">Daftar Pesanan</span>
              </Link>

              <Link href="/orders/new" className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all group ${isActive('/orders/new') ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/20' : 'hover:bg-slate-800/50 hover:text-slate-200'}`}>
                <span className="text-xl">➕</span>
                <span className="text-sm font-bold">Input Manual</span>
              </Link>
            </nav>

            {/* Bottom Menu */}
            <div className="p-4 mt-auto border-t border-slate-800/50 mb-6">
              <Link href="/settings/business" className={`flex items-center gap-3 px-4 py-4 rounded-2xl transition-all group ${isActive('/settings/business') ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/50'}`}>
                <div className={`p-2 rounded-lg transition-all ${isActive('/settings/business') ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500 group-hover:text-slate-200'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs font-black text-white leading-none">Pengaturan</p>
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Bisnis & Profil</p>
                </div>
              </Link>
            </div>
          </aside>

          {/* --- MAIN CONTENT --- */}
          {/* ml-72 sangat penting agar konten tidak tertutup sidebar */}
          <main className="flex-1 ml-72 min-h-screen bg-slate-50">
            <div className="p-10 max-w-5xl mx-auto">
              {children}
            </div>
          </main>

        </div>
      </body>
    </html>
  )
}