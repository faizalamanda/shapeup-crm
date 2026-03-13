"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import "./globals.css"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const noSidebar = ["/login", "/register", "/"].includes(pathname)

  if (noSidebar) return <html lang="en"><body>{children}</body></html>

  const menuItems = [
    { name: 'Overview', href: '/dashboard', icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2zM14 11a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z' },
    { name: 'Customers', href: '/customers', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
    { name: 'Orders', href: '/orders', icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' },
    { name: 'Opportunities', href: '/opportunities', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  ]

  return (
    <html lang="en">
      <body className="flex bg-[#F8FAFC] text-[#1E293B] antialiased">
        {/* SIDEBAR MODERN */}
        <aside className="w-64 bg-white h-screen sticky top-0 border-r border-slate-200/60 flex flex-col z-50">
          <div className="p-7 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-blue-200">S</div>
              <span className="text-xl font-bold tracking-tight text-slate-800">ShapeUp</span>
            </div>
          </div>
          
          <nav className="flex-1 px-4 space-y-1.5">
            {menuItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  pathname === item.href 
                  ? 'bg-blue-50 text-blue-600' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.icon} />
                </svg>
                {item.name}
              </Link>
            ))}
          </nav>

          <div className="p-4 mt-auto border-t border-slate-100">
             <Link href="/settings" className="flex items-center gap-3 px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-900">
               ⚙️ Settings
             </Link>
          </div>
        </aside>

        {/* MAIN AREA */}
        <div className="flex-1 min-w-0">
          <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40 px-8 flex items-center justify-between">
            <h2 className="font-bold text-slate-800 capitalize tracking-tight">{pathname.split('/')[1] || 'Dashboard'}</h2>
            <div className="flex items-center gap-4">
              <div className="text-right mr-2 hidden sm:block">
                <p className="text-xs font-bold text-slate-900">Admin ShapeUp</p>
                <p className="text-[10px] text-slate-400">Premium Plan</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600">A</div>
            </div>
          </header>

          <main className="p-8 max-w-7xl mx-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}