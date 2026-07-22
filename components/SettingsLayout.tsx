"use client"

import React, { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

type SettingsLayoutProps = {
  children: React.ReactNode
  title?: string
  subtitle?: string
}

function SettingsContent({ children, title, subtitle }: SettingsLayoutProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentTab = searchParams.get('tab') || 'profile'

  const navGroups = [
    {
      group: 'Profil & Unit Bisnis',
      items: [
        {
          id: 'profile',
          name: 'Profil Bisnis',
          href: '/settings/business?tab=profile',
          icon: '🏢',
          description: 'Profil umum, alamat, & legalitas',
          isActive: pathname === '/settings/business' && currentTab === 'profile',
        },
        {
          id: 'units',
          name: 'Daftar Unit Bisnis',
          href: '/settings/business?tab=units',
          icon: '🏬',
          description: 'Kelola & ganti unit bisnis',
          isActive: pathname === '/settings/business' && currentTab === 'units',
        },
      ],
    },
    {
      group: 'Pengguna & Tim',
      items: [
        {
          id: 'staff',
          name: 'Staf & Hak Akses',
          href: '/settings/staff',
          icon: '👥',
          description: 'Kelola anggota tim & perizinan',
          isActive: pathname.startsWith('/settings/staff'),
        },
      ],
    },
    {
      group: 'Integrasi & Ekosistem',
      items: [
        {
          id: 'integrations',
          name: 'Integrasi & Plugin',
          href: '/settings/integrations',
          icon: '🔌',
          description: 'WooCommerce, Shopify, & Webhook',
          isActive: pathname.startsWith('/settings/integrations'),
        },
      ],
    },
  ]

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-52px)] bg-[#F9F9F8]">
      {/* Left Submenu Sidebar (Flush against main sidebar) */}
      <aside className="w-full lg:w-64 xl:w-72 flex-shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-[#E2E2DC] p-4 sm:p-5 space-y-6">
        <div className="px-2 pt-1 pb-2 border-b border-[#E2E2DC] flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-wider text-[#1C1C1A]">
            Menu Pengaturan
          </span>
          <span className="text-[10px] font-bold bg-[#F4F4F0] text-[#6B6B63] px-2 py-0.5 rounded-md">
            v2.0
          </span>
        </div>

        <div className="space-y-6">
          {navGroups.map((group, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="px-2 text-[10px] font-extrabold text-[#A8A89E] uppercase tracking-widest">
                {group.group}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-start gap-3 p-2.5 rounded-xl text-xs transition-all group ${
                      item.isActive
                        ? 'bg-blue-600 text-white font-bold shadow-xs ring-2 ring-blue-600/20'
                        : 'text-[#6B6B63] hover:text-[#1C1C1A] hover:bg-[#F7F7F5]'
                    }`}
                  >
                    <span className="text-base flex-shrink-0 mt-0.5">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className={`font-bold leading-snug ${item.isActive ? 'text-white' : 'text-[#1C1C1A]'}`}>
                        {item.name}
                      </div>
                      <div className={`text-[11px] truncate mt-0.5 ${item.isActive ? 'text-blue-100 font-medium' : 'text-[#8C8C82]'}`}>
                        {item.description}
                      </div>
                    </div>
                    {item.isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white self-center ml-auto" />
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Quick Info Box */}
        <div className="p-3.5 bg-[#F7F7F5] rounded-xl border border-[#E2E2DC] text-[11px] text-[#6B6B63] space-y-1">
          <div className="font-bold text-[#1C1C1A] flex items-center gap-1.5">
            <span>💡</span>
            <span>Tips Pengaturan</span>
          </div>
          <p className="leading-relaxed text-[#6B6B63]">
            Perubahan pada profil bisnis akan langsung tercermin pada invoice, nota, dan laporan keuangan.
          </p>
        </div>
      </aside>

      {/* Right Setting Content Column */}
      <main className="flex-1 min-w-0 w-full p-4 sm:p-6 md:p-8 space-y-6">
        {/* Header Title inside Content Setting Column */}
        <div className="bg-white rounded-2xl border border-[#E2E2DC] p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-extrabold tracking-wider uppercase text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">
                Pengaturan Sistem
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-[#1C1C1A] tracking-tight">
              {title || 'Pengaturan & Konfigurasi'}
            </h1>
            <p className="text-xs md:text-sm text-[#6B6B63] mt-1 font-medium">
              {subtitle || 'Kelola profil unit bisnis, hak akses tim, serta integrasi platform & WooCommerce.'}
            </p>
          </div>
        </div>

        {/* Page Content */}
        {children}
      </main>
    </div>
  )
}

export default function SettingsLayout(props: SettingsLayoutProps) {
  return (
    <Suspense fallback={
      <div className="p-8 max-w-7xl mx-auto text-center font-bold text-xs text-[#A8A89E] animate-pulse">
        Memuat Pengaturan...
      </div>
    }>
      <SettingsContent {...props} />
    </Suspense>
  )
}
