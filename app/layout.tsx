"use client"
import { Inter } from 'next/font/google'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logoutAction } from '@/app/auth/actions'
import { useState, useEffect } from 'react'
import "./globals.css"

const inter = Inter({ subsets: ['latin'] })

type MenuItem = {
  name: string
  href: string
  icon: React.ReactNode
  children?: { name: string; href: string }[]
}

const Icons = {
  overview: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  customers: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  orders: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  ),
  marketing: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  input: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  business: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </svg>
  ),
  products: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  logout: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  menu: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  close: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const handleLogout = async () => {
    await logoutAction()
  }

  const noSidebar = ["/login", "/register", "/"].includes(pathname)

  const menuItems: MenuItem[] = [
    { name: 'Overview',     href: '/dashboard',         icon: Icons.overview },
    {
      name: 'Customers', href: '/customers', icon: Icons.customers,
      children: [
        { name: 'Customer List',      href: '/customers' },
        { name: 'Returning Cohort',   href: '/customers/cohorts/returning' },
        { name: 'Product Retention',  href: '/customers/product-retention' },
      ],
    },
    { name: 'Products',     href: '/products',          icon: Icons.products },
    { name: 'Orders',       href: '/orders',            icon: Icons.orders },
    { name: 'Marketing',    href: '/marketing',         icon: Icons.marketing },
    { name: 'Input Order',  href: '/orders/new',        icon: Icons.input },
    { name: 'Business',     href: '/settings/business', icon: Icons.business },
  ]

  if (!mounted) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className} style={{ background: '#F7F7F5' }} />
      </html>
    )
  }

  if (noSidebar) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>{children}</body>
      </html>
    )
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} style={{ display: 'flex', minHeight: '100vh', background: 'var(--su-bg)', color: 'var(--su-text)' }}>

        {/* ── SIDEBAR ────────────────────────────────────────────────────── */}
        <aside style={{
          width: '220px',
          background: 'var(--su-sidebar-bg)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 50,
          transition: 'transform 0.25s ease',
        }}
          className={`${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
        >
          {/* Logo */}
          <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
                {/* Logo mark */}
                <div style={{
                  width: '32px', height: '32px',
                  background: 'linear-gradient(135deg, #2563EB 0%, #F59E0B 100%)',
                  borderRadius: '8px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 900, fontSize: '14px', color: 'white',
                  flexShrink: 0,
                  boxShadow: '0 4px 12px rgba(37,99,235,0.4)',
                }}>S</div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#FFFEF9', letterSpacing: '-0.01em', lineHeight: 1.1 }}>ShapeUp</div>
                  <div style={{ fontSize: '9px', fontWeight: 600, color: 'rgba(255,254,249,0.35)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>CRM</div>
                </div>
              </Link>
              <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden"
                style={{ color: 'rgba(255,255,255,0.4)', padding: '4px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '6px' }}>
                {Icons.close}
              </button>
            </div>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
            {menuItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
              const showChildren = Boolean(item.children?.length && isActive)

              return (
                <div key={item.href} style={{ marginBottom: '2px' }}>
                  <Link
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', borderRadius: '7px',
                      fontSize: '12px', fontWeight: isActive ? 700 : 500,
                      textDecoration: 'none', transition: 'all 0.15s',
                      color: isActive ? '#FFFEF9' : 'rgba(255,254,249,0.5)',
                      background: isActive ? 'var(--su-sidebar-active)' : 'transparent',
                      borderLeft: isActive ? '2.5px solid #F59E0B' : '2.5px solid transparent',
                      letterSpacing: '0.01em',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'var(--su-sidebar-hover)'
                        ;(e.currentTarget as HTMLElement).style.color = '#FFFEF9'
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
                        ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,254,249,0.5)'
                      }
                    }}
                  >
                    <span style={{ opacity: isActive ? 1 : 0.6, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '11px' }}>{item.name}</span>
                  </Link>

                  {showChildren && (
                    <div style={{ marginLeft: '28px', paddingLeft: '12px', borderLeft: '1px solid rgba(255,255,255,0.07)', marginTop: '2px', marginBottom: '4px' }}>
                      {item.children?.map(child => {
                        const childActive = pathname === child.href
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setIsMobileMenuOpen(false)}
                            style={{
                              display: 'block', padding: '6px 10px', borderRadius: '6px',
                              fontSize: '10px', fontWeight: childActive ? 700 : 500,
                              textDecoration: 'none', transition: 'all 0.15s',
                              color: childActive ? '#F59E0B' : 'rgba(255,254,249,0.4)',
                              background: childActive ? 'rgba(245,158,11,0.08)' : 'transparent',
                              textTransform: 'uppercase', letterSpacing: '0.1em',
                              marginBottom: '1px',
                            }}
                          >
                            {child.name}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          {/* Bottom */}
          <div style={{ padding: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <Link
              href="/settings"
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', borderRadius: '7px',
                fontSize: '11px', fontWeight: 500, textDecoration: 'none',
                color: pathname.startsWith('/settings') ? '#FFFEF9' : 'rgba(255,254,249,0.4)',
                background: pathname.startsWith('/settings') ? 'var(--su-sidebar-active)' : 'transparent',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px',
              }}
            >
              <span style={{ opacity: 0.6 }}>{Icons.settings}</span>
              Settings
            </Link>
            <button
              onClick={handleLogout}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                padding: '8px 12px', borderRadius: '7px', cursor: 'pointer',
                fontSize: '11px', fontWeight: 500,
                color: 'rgba(239,68,68,0.6)',
                background: 'none', border: 'none',
                textTransform: 'uppercase', letterSpacing: '0.06em', transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLElement).style.color = '#EF4444'
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.08)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLElement).style.color = 'rgba(239,68,68,0.6)'
                ;(e.currentTarget as HTMLElement).style.background = 'none'
              }}
            >
              {Icons.logout}
              Logout
            </button>
          </div>
        </aside>

        {/* ── MAIN AREA ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', minWidth: 0 }} className="ml-0 lg:ml-[220px]">

          {/* Topbar */}
          <header style={{
            height: '52px', background: 'var(--su-card)',
            borderBottom: '1px solid var(--su-border)',
            position: 'sticky', top: 0, zIndex: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="lg:hidden"
                style={{ padding: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--su-text-muted)' }}
              >
                {Icons.menu}
              </button>
              <span style={{
                fontSize: '11px', fontWeight: 700,
                color: 'var(--su-text-faint)',
                textTransform: 'uppercase', letterSpacing: '0.14em',
              }}>
                {pathname.split('/').filter(Boolean).map((s, i, arr) => (
                  <span key={i}>
                    {i > 0 && <span style={{ margin: '0 6px', opacity: 0.4 }}>/</span>}
                    <span style={{ color: i === arr.length - 1 ? 'var(--su-text)' : undefined }}>
                      {s.replace(/-/g, ' ')}
                    </span>
                  </span>
                ))}
              </span>
            </div>

            {/* User chip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="hidden sm:block" style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--su-text)', lineHeight: 1.3 }}>Admin</div>
                <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--su-accent)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>Premium</div>
              </div>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #2563EB 0%, #F59E0B 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '12px', color: 'white',
                flexShrink: 0,
              }}>A</div>
            </div>
          </header>

          {/* Page content */}
          <main style={{ flex: 1, overflowY: 'auto', padding: '28px 28px 48px' }}>
            <div style={{ maxWidth: '1600px', margin: '0 auto' }} className="su-fade-in">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile overlay */}
        {isMobileMenuOpen && (
          <div
            onClick={() => setIsMobileMenuOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(28,28,26,0.5)', backdropFilter: 'blur(2px)',
              zIndex: 40,
            }}
            className="lg:hidden su-fade-in"
          />
        )}
      </body>
    </html>
  )
}
