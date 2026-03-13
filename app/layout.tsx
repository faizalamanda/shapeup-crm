"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import "./globals.css"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const noSidebar = ["/login", "/register", "/"].includes(pathname)

  if (noSidebar) return <html lang="en"><body>{children}</body></html>

  const menuItems = [
    { name: 'Dashboard', href: '/dashboard', icon: '📊' },
    { name: 'Customers', href: '/customers', icon: '👥' },
    { name: 'Orders', href: '/orders', icon: '📦' },
    { name: 'Opportunities', href: '/opportunities', icon: '🎯' },
  ]

  return (
    <html lang="en">
      <body className="flex bg-slate-50 text-slate-900">
        {/* SIDEBAR */}
        <aside className="w-72 bg-white border-r border-slate-200 h-screen sticky top-0 flex flex-col">
          <div className="p-8">
            <h1 className="text-2xl font-black italic text-blue-600 tracking-tighter">SHAPEUP <span className="text-slate-400 font-light">CRM</span></h1>
          </div>
          
          <nav className="flex-1 px-4 space-y-1">
            {menuItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${
                  pathname === item.href 
                  ? 'bg-blue-50 text-blue-600 shadow-sm' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                {item.name}
              </Link>
            ))}
          </nav>

          <div className="p-4 border-t border-slate-100">
            <Link href="/settings" className="flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-slate-900 font-medium">
              <span>⚙️</span> Settings
            </Link>
          </div>
        </aside>

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 flex flex-col min-h-screen">
          {/* TOPBAR */}
          <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
            <div className="font-semibold text-slate-500 capitalize">
              {pathname.replace('/', '') || 'Overview'}
            </div>
            <div className="flex items-center gap-4">
               <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
                 JD
               </div>
            </div>
          </header>

          {/* PAGE CONTENT */}
          <main className="p-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}