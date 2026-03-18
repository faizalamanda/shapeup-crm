"use client"
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const Sidebar = () => {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  const menuItems = [
    { name: 'Dashboard', path: '/' },
    { name: 'Orders', path: '/orders' },
    { name: 'Customers', path: '/customers' },
    { name: 'Marketing Automation', path: '/marketing' },
  ]

  return (
    <>
      {/* MOBILE HEADER (Tampil hanya di HP) */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-gray-200 sticky top-0 z-50">
        <span className="font-bold text-gray-900 tracking-tight uppercase">Toko Alamanda</span>
        <button onClick={() => setIsOpen(!isOpen)} className="p-2 text-gray-600 focus:outline-none">
          {isOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* SIDEBAR CORE */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-[#f6f8fa] border-r border-gray-300 transform transition-transform duration-200 ease-in-out
        lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-8">
          <h2 className="text-xl font-bold text-gray-900 tracking-tight uppercase mb-10">
            Toko <span className="text-blue-600">Alamanda</span>
          </h2>
          
          <nav className="space-y-1">
            {menuItems.map((item) => (
              <Link 
                key={item.path} 
                href={item.path}
                onClick={() => setIsOpen(false)}
                className={`
                  block px-4 py-2.5 rounded-md text-[14px] font-bold uppercase tracking-tight transition-all
                  ${pathname === item.path 
                    ? 'bg-white text-blue-600 border border-gray-300 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}
                `}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* OVERLAY (Klik di luar menu untuk tutup di mobile) */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 z-30 lg:hidden" 
          onClick={() => setIsOpen(false)}
        ></div>
      )}
    </>
  )
}