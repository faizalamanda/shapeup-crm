"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function SettingsHeader() {
  const pathname = usePathname()

  const tabs = [
    {
      name: 'Unit Bisnis',
      href: '/settings/business',
      icon: '🏢',
      description: 'Kelola bisnis & akses unit',
    },
    {
      name: 'Staf & Akses',
      href: '/settings/staff',
      icon: '👥',
      description: 'Hak akses & anggota tim',
    },
    {
      name: 'Integrasi',
      href: '/settings/integrations',
      icon: '🔌',
      description: 'Hubungkan WooCommerce & Platform',
    },
  ]

  return (
    <div className="mb-8 space-y-6">
      {/* Top Header Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E2E2DC]">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-extrabold tracking-widest uppercase text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">
              Pengaturan Sistem
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#1C1C1A] tracking-tight">
            Pengaturan &amp; Konfigurasi
          </h1>
          <p className="text-xs md:text-sm text-[#6B6B63] mt-1 font-medium">
            Kelola unit bisnis, hak akses staf &amp; peran, serta integrasi platform (WooCommerce &amp; pihak ketiga).
          </p>
        </div>
      </div>

      {/* Navigation Submenu (Tabs) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E2E2DC] pb-4">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || (tab.href !== '/settings/business' && pathname.startsWith(tab.href))
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-600/20'
                  : 'bg-white text-[#6B6B63] hover:text-[#1C1C1A] hover:bg-[#F7F7F5] border border-[#E2E2DC]'
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.name}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
