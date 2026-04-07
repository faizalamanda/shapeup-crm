"use client"
import { Inter } from 'next/font/google'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useState, useEffect } from 'react' // Tambah useEffect
import "./globals.css"

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false) // State untuk handle hydration

  // Memastikan komponen sudah nempel di browser sebelum render UI berat
  useEffect(() => {
    setMounted(true)
  }, [])

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.refresh()
    router.push('/login')
  }
  
  const noSidebar = ["/login", "/register", "/"].includes(pathname)

  // Menu Items (Marketing Aktif)
  const menuItems = [
    { name: 'Overview', href: '/dashboard', icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2zM14 11a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z' },
    { name: 'Customers', href: '/customers', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
    { name: 'Orders', href: '/orders', icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' },
    { name: 'Marketing', href: '/marketing', icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' }, 
    { name: 'Manual Input', href: '/orders/new', icon: 'M12 4v16m8-8H4' },
    { name: 'Business', href: '/settings/business', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  ]

  // Jika belum mounted, jangan render body dulu untuk menghindari mismatch atribut dari extension browser
  if (!mounted) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={`${inter.className} bg-[#F8FAFC]`}></body>
      </html>
    )
  }

  // Handle halaman Login/Register/Landing
  if (noSidebar) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>{children}</body>
      </html>
    )
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} flex bg-[#F8FAFC] text-[#1E293B] antialiased min-h-screen`}>
        
        {/* SIDEBAR */}
        <aside className={`
          w-64 bg-white h-screen sticky top-0 border-r border-slate-200/60 flex flex-col z-50 transition-transform duration-300
          fixed lg:sticky lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="p-7 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-blue-200">S</div>
              <span className="text-xl font-bold tracking-tight text-slate-800 uppercase">ShapeUp</span>
            </div>
            <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-slate-400 p-2">✕</button>
          </div>
          
          <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto">
            {menuItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold tracking-tight transition-all duration-200 ${
                  pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                  ? 'bg-blue-50 text-blue-600' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.icon} />
                </svg>
                <span className="uppercase">{item.name}</span>
              </Link>
            ))}
          </nav>

          <div className="p-4 mt-auto border-t border-slate-100 space-y-1">
             <Link href="/settings" className={`flex items-center gap-3 px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-colors ${pathname.startsWith('/settings') ? 'text-blue-600' : 'text-slate-500 hover:text-slate-900'}`}>
               Settings
             </Link>
             <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 rounded-xl transition-all">
               Logout
             </button>
          </div>
        </aside>

        {/* MAIN AREA */}
        <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
          <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40 px-6 md:px-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setIsMobileMenuOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-600">
                ☰
              </button>
              <h2 className="font-bold text-slate-800 uppercase tracking-tight truncate max-w-[150px] md:max-w-none">
                {pathname.split('/').pop()?.replace('-', ' ') || 'Dashboard'}
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right mr-2 hidden sm:block">
                <p className="text-[10px] font-black text-slate-900 uppercase">Admin ShapeUp</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Premium</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center font-bold text-blue-600 text-sm">A</div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
            <div className="w-full max-w-[1600px] mx-auto animate-in fade-in duration-500">
              {children}
            </div>
          </main>
        </div>

        {/* Overlay Mobile */}
        {isMobileMenuOpen && (
          <div onClick={() => setIsMobileMenuOpen(false)} className="fixed inset-0 bg-slate-900/20 backdrop-blur-[2px] z-40 lg:hidden animate-in fade-in" />
        )}
      </body>
    </html>
  )
}