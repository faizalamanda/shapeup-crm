"use client"
import { Inter } from 'next/font/google'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logoutAction } from '@/app/auth/actions'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { canAccessPath } from '@/lib/permissions'
import "./globals.css"
import BusinessOnboarding from '@/components/BusinessOnboarding'
import { UserProvider, UserContextType } from '@/components/UserContext'

const inter = Inter({ subsets: ['latin'] })

type MenuItem = {
  name: string
  href: string
  icon: React.ReactNode
  children?: { name: string; href: string }[]
}

const Icons = {
  onboarding: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="12 8 8 16 16 16 12 8"/>
    </svg>
  ),
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
  employees: (
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
  chevronDown: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  pemasukan: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  expenses: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
    </svg>
  ),
  inbox: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  accounting: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
}

const menuItems: MenuItem[] = [
  { name: 'Onboarding',   href: '/onboarding',        icon: Icons.onboarding },
  { name: 'Overview',     href: '/dashboard',         icon: Icons.overview },
  { name: 'Inbox / Chat', href: '/inbox',             icon: Icons.inbox },
  {
    name: 'Pemasukan',    href: '/orders',            icon: Icons.pemasukan,
    children: [
      { name: 'Orders',   href: '/orders' },
      { name: 'Invoices', href: '/orders/invoices' },
      { name: 'POS',      href: '/orders/pos' },
    ],
  },
  {
    name: 'Customers', href: '/customers', icon: Icons.customers,
    children: [
      { name: 'Customer List',      href: '/customers' },
      { name: 'Returning Cohort',   href: '/customers/cohorts/returning' },
      { name: 'Product Retention',  href: '/customers/product-retention' },
    ],
  },
  {
    name: 'Products', href: '/products', icon: Icons.products,
    children: [
      { name: 'Daftar Produk', href: '/products' },
      { name: 'Pembelian',     href: '/purchases' },
      { name: 'Stock Opname',  href: '/stock-opname' },
    ],
  },
  {
    name: 'Pengeluaran', href: '/expenses', icon: Icons.expenses,
    children: [
      { name: 'Daftar Pengeluaran', href: '/expenses' },
      { name: 'Pemasok (Suppliers)', href: '/suppliers' },
    ],
  },
  {
    name: 'Akuntansi', href: '/accounting/transactions', icon: Icons.accounting,
    children: [
      { name: 'Transaksi & Jurnal', href: '/accounting/transactions' },
      { name: 'Laporan Arus Kas', href: '/accounting/cash-flow' },
      { name: 'Laporan Laba Rugi', href: '/accounting/profit-loss' },
      { name: 'Neraca Keuangan', href: '/accounting/balance-sheet' },
      { name: 'Bagan Akun (COA)', href: '/accounting/coa' },
    ],
  },
  { name: 'Marketing',    href: '/marketing',         icon: Icons.marketing },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const pathname = usePathname()
  const noSidebar = ["/login", "/register", "/"].includes(pathname)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({})

  // Business switcher & User context states (initialized with instant local cache if present)
  const [businesses, setBusinesses] = useState<any[]>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = localStorage.getItem('su_cached_businesses')
        if (saved) return JSON.parse(saved)
      } catch (e) {}
    }
    return []
  })

  const [activeBusiness, setActiveBusiness] = useState<any>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = localStorage.getItem('su_cached_active_biz')
        if (saved) return JSON.parse(saved)
      } catch (e) {}
    }
    return null
  })

  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  const [userProfile, setUserProfile] = useState<any>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = localStorage.getItem('su_cached_user_profile')
        if (saved) return JSON.parse(saved)
      } catch (e) {}
    }
    return null
  })

  const [currentUserRole, setCurrentUserRole] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('su_cached_role')
    }
    return null
  })

  const [currentUserPermissions, setCurrentUserPermissions] = useState<string[]>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = localStorage.getItem('su_cached_perms')
        if (saved) return JSON.parse(saved)
      } catch (e) {}
    }
    return []
  })

  const [isWabaActive, setIsWabaActive] = useState(false)
  const [bizLoading, setBizLoading] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    const updated: Record<string, boolean> = {}
    menuItems.forEach(item => {
      if (item.children) {
        const hasActiveChild = item.children.some(child => 
          pathname === child.href || (child.href !== '/' && pathname.startsWith(child.href))
        )
        if (hasActiveChild || pathname === item.href || (item.href !== '/dashboard' && item.href !== '#' && pathname.startsWith(item.href))) {
          updated[item.name] = true
        }
      }
    })
    setExpandedMenus(prev => ({ ...prev, ...updated }))
  }, [pathname])

  // Load profile and businesses — onAuthStateChange as single source of truth
  const loadIdRef = useRef(0)
  const loadedUserIdRef = useRef<string | null>(null)

  const loadProfileAndBusinesses = useCallback(async (userId: string, forceRefresh = false) => {
    // Check if the active user changed from the previous session
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const lastUserId = localStorage.getItem('su_last_logged_in_user_id')
        if (lastUserId && lastUserId !== userId) {
          console.log('[Layout] Active user changed from', lastUserId, 'to', userId, '- clearing local storage cache')
          const keysToRemove: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (
              key && (
                key.startsWith('su_') ||
                key.startsWith('cache_') ||
                key.startsWith('shapeup_')
              )
            ) {
              keysToRemove.push(key)
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k))
        }
        localStorage.setItem('su_last_logged_in_user_id', userId)
      }
    } catch (e) {
      console.error('[Layout] Error checking user localStorage cache:', e)
    }

    if (!forceRefresh && loadedUserIdRef.current === userId) {
      console.log('[Layout] Profile already loaded for userId:', userId, '- skipping DB fetch')
      setBizLoading(false)
      return
    }

    const loadId = ++loadIdRef.current

    console.log('[Layout] loadProfileAndBusinesses called, userId:', userId)

    try {
      const [profileResult, bsResult, ownedResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('business_staff').select('role, permissions, businesses (*)').eq('profile_id', userId),
        supabase.from('businesses').select('*').eq('owner_id', userId),
      ])

      console.log('[Layout] profileResult:', profileResult.data, profileResult.error)
      console.log('[Layout] bsResult:', bsResult.data, bsResult.error)
      console.log('[Layout] ownedResult:', ownedResult.data, ownedResult.error)

      // If a newer load has started, discard this result
      if (loadId !== loadIdRef.current) return

      const profile = profileResult.data
      setUserProfile(profile || null)
      if (profile) {
        loadedUserIdRef.current = userId
      }

      // Combine and deduplicate businesses
      const bizMap = new Map<string, any>()
      bsResult.data?.forEach((item: any) => {
        if (item.businesses) {
          bizMap.set(item.businesses.id, item.businesses)
        }
      })
      ownedResult.data?.forEach((biz: any) => {
        bizMap.set(biz.id, biz)
      })

      const combined = Array.from(bizMap.values())
      console.log('[Layout] combined businesses:', combined)
      setBusinesses(combined)

      // Find and set the active business
      const activeBizId = profile?.active_business_id || combined[0]?.id
      let selectedActiveBiz: any = null

      if (activeBizId) {
        const active = combined.find(b => b.id === activeBizId)
        if (active) {
          console.log('[Layout] active business found:', active.name)
          setActiveBusiness(active)
          selectedActiveBiz = active
        } else {
          // Fallback: direct lookup (edge case)
          const { data: fallbackBiz } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', activeBizId)
            .single()
          if (loadId === loadIdRef.current && fallbackBiz) {
            console.log('[Layout] fallback business:', fallbackBiz.name)
            setActiveBusiness(fallbackBiz)
            selectedActiveBiz = fallbackBiz
          } else if (combined.length > 0) {
            setActiveBusiness(combined[0])
            selectedActiveBiz = combined[0]
          }
        }
      } else if (combined.length > 0) {
        console.log('[Layout] no active_business_id, auto-selecting first:', combined[0].name)
        setActiveBusiness(combined[0])
        selectedActiveBiz = combined[0]
      } else {
        console.log('[Layout] no businesses found at all')
        setActiveBusiness(null)
      }

      // Check if WABA Official integration is active for this business
      if (activeBizId) {
        const { data: wabaInt } = await supabase
          .from('integrations')
          .select('is_active, api_credentials')
          .eq('platform_name', 'waba_official')
          .filter('api_credentials->>business_id', 'eq', activeBizId)
          .maybeSingle()

        const active = Boolean(
          wabaInt &&
          wabaInt.is_active === true
        )
        setIsWabaActive(active)
      } else {
        setIsWabaActive(false)
      }

      // Resolve role and permissions
      const activeBs = bsResult.data?.find((item: any) => item.businesses?.id === activeBizId)
      const isUserAdmin = profile?.role === 'admin' || activeBs?.role === 'admin' || ownedResult.data?.some((biz: any) => biz.id === activeBizId)
      
      let resolvedRole = 'staff'
      let resolvedPerms: string[] = []

      if (isUserAdmin) {
        resolvedRole = 'admin'
        resolvedPerms = ['full_access']
      } else if (activeBs) {
        resolvedRole = activeBs.role || 'staff'
        resolvedPerms = activeBs.permissions || []
      }

      setCurrentUserRole(resolvedRole)
      setCurrentUserPermissions(resolvedPerms)

      // Save to localStorage cache for instant loading on next refresh
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          if (profile) localStorage.setItem('su_cached_user_profile', JSON.stringify(profile))
          if (combined) localStorage.setItem('su_cached_businesses', JSON.stringify(combined))
          if (selectedActiveBiz) localStorage.setItem('su_cached_active_biz', JSON.stringify(selectedActiveBiz))
          localStorage.setItem('su_cached_role', resolvedRole)
          localStorage.setItem('su_cached_perms', JSON.stringify(resolvedPerms))
        }
      } catch (e) {
        console.error('[Layout] Error setting user cache:', e)
      }
    } catch (err) {
      console.error('[Layout] Error loading profile and businesses:', err)
    } finally {
      if (loadId === loadIdRef.current) {
        setBizLoading(false)
      }
    }
  }, [supabase])

  // Load profile and businesses — onAuthStateChange as single source of truth
  useEffect(() => {
    // onAuthStateChange is the single source of truth.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('[Layout] onAuthStateChange event:', event, 'user:', session?.user?.id)
        if (session?.user?.id) {
          const force = event === 'SIGNED_IN' || event === 'USER_UPDATED' || session.user.id !== loadedUserIdRef.current
          loadProfileAndBusinesses(session.user.id, force)
        } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
          setIsLoggingOut(true)
          loadedUserIdRef.current = null
          setUserProfile(null)
          setBusinesses([])
          setActiveBusiness(null)
          setCurrentUserRole(null)
          setCurrentUserPermissions([])
          setBizLoading(false)
          if (!noSidebar && typeof window !== 'undefined') {
            window.location.href = '/login'
          }
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, loadProfileAndBusinesses, noSidebar])

  // Sync session on navigation/pathname change when we are on a page with sidebar
  useEffect(() => {
    if (!noSidebar) {
      if (!loadedUserIdRef.current) {
        console.log('[Layout] Pathname changed to sidebar page without loaded profile. Re-checking session...')
        supabase.auth.getSession().then(({ data: { session } }) => {
          const sessionUserId = session?.user?.id

          if (sessionUserId) {
            console.log('[Layout] Loading profile for session user ID:', sessionUserId)
            loadProfileAndBusinesses(sessionUserId)
          } else {
            setBizLoading(false)
          }
        })
      }
    }
  }, [pathname, noSidebar, supabase, loadProfileAndBusinesses])

  // Dynamic menu filtering based on permissions
  const allowedMenuItems = useMemo(() => {
    if (bizLoading && !userProfile) {
      let initialList = [...menuItems]
      if (!isWabaActive) {
        initialList = initialList.filter(m => m.href !== '/inbox')
      }
      return initialList
    }
    
    const role = currentUserRole
    const perms = currentUserPermissions

    if (role === 'admin' || perms.includes('full_access')) {
      // Admin/Full access sees all standard items (+ HR item if admin)
      let fullList = [...menuItems]
      if (!isWabaActive) {
        fullList = fullList.filter(m => m.href !== '/inbox')
      }
      // Insert HR right after Akuntansi
      const akuntansiIdx = fullList.findIndex(m => m.name === 'Akuntansi')
      const insertIdx = akuntansiIdx !== -1 ? akuntansiIdx + 1 : fullList.length
      fullList.splice(insertIdx, 0, { name: 'Karyawan & Gaji', href: '/employees', icon: Icons.employees })
      return fullList
    }

    const allowed: MenuItem[] = []

    // 0. Onboarding (accessible to all active users)
    const onboardingItem = menuItems.find(m => m.name === 'Onboarding')
    if (onboardingItem) allowed.push(onboardingItem)

    // 1. Inbox / Chat (Paid Plugin — only shown if active for current business)
    if (isWabaActive) {
      const inboxItem = menuItems.find(m => m.name === 'Inbox / Chat')
      if (inboxItem) allowed.push(inboxItem)
    }

    // 1. Overview
    if (
      perms.includes('view_financials_no_salary') ||
      perms.includes('input_journal_expenses') ||
      perms.includes('manage_invoices') ||
      perms.includes('manage_bills') ||
      perms.includes('manage_products') ||
      perms.includes('manage_purchases')
    ) {
      const overviewItem = menuItems.find(m => m.name === 'Overview')
      if (overviewItem) allowed.push(overviewItem)
    }

    // 2. Pemasukan (Orders, Invoices, POS)
    if (
      perms.includes('view_financials_no_salary') ||
      perms.includes('manage_invoices')
    ) {
      const pemasukanItem = menuItems.find(m => m.name === 'Pemasukan')
      if (pemasukanItem) allowed.push(pemasukanItem)
    }

    // 3. Customers
    if (
      perms.includes('view_financials_no_salary') ||
      perms.includes('manage_invoices')
    ) {
      const customersItem = menuItems.find(m => m.name === 'Customers')
      if (customersItem) allowed.push(customersItem)
    }

    // 4. Products
    if (
      perms.includes('view_financials_no_salary') ||
      perms.includes('manage_invoices') ||
      perms.includes('manage_bills') ||
      perms.includes('manage_products') ||
      perms.includes('manage_purchases')
    ) {
      const productsItem = menuItems.find(m => m.name === 'Products')
      if (productsItem) {
        // Dynamically filter children submenus based on specific permissions
        const filteredChildren = productsItem.children?.filter(child => {
          if (child.href === '/products' || child.href === '/stock-opname') {
            return (
              perms.includes('view_financials_no_salary') ||
              perms.includes('manage_invoices') ||
              perms.includes('manage_products')
            )
          }
          if (child.href === '/purchases') {
            return (
              perms.includes('view_financials_no_salary') ||
              perms.includes('manage_bills') ||
              perms.includes('manage_purchases')
            )
          }
          return true
        })

        if (filteredChildren && filteredChildren.length > 0) {
          allowed.push({ ...productsItem, children: filteredChildren })
        }
      }
    }

    // 5. Pengeluaran (Expenses, Purchases, Suppliers)
    if (
      perms.includes('view_financials_no_salary') ||
      perms.includes('input_journal_expenses') ||
      perms.includes('manage_bills') ||
      perms.includes('manage_purchases')
    ) {
      const expensesItem = menuItems.find(m => m.name === 'Pengeluaran')
      if (expensesItem) {
        const filteredChildren = expensesItem.children?.filter(child => {
          if (child.href === '/expenses') {
            return (
              perms.includes('view_financials_no_salary') ||
              perms.includes('input_journal_expenses') ||
              perms.includes('manage_bills')
            )
          }
          if (child.href === '/suppliers') {
            return (
              perms.includes('view_financials_no_salary') ||
              perms.includes('input_journal_expenses') ||
              perms.includes('manage_bills') ||
              perms.includes('manage_purchases')
            )
          }
          return true
        })

        if (filteredChildren && filteredChildren.length > 0) {
          allowed.push({ ...expensesItem, children: filteredChildren })
        }
      }
    }

    // 6. Akuntansi (Cash Flow, P&L, Balance Sheet)
    if (perms.includes('view_financials_no_salary')) {
      const accountingItem = menuItems.find(m => m.name === 'Akuntansi')
      if (accountingItem) allowed.push(accountingItem)
    }

    // 7. Karyawan & Gaji (HR)
    if (perms.includes('manage_employees_salary')) {
      allowed.push({ name: 'Karyawan & Gaji', href: '/employees', icon: Icons.employees })
    }

    // 8. Marketing
    if (perms.includes('manage_marketing')) {
      const marketingItem = menuItems.find(m => m.name === 'Marketing')
      if (marketingItem) allowed.push(marketingItem)
    }

    return allowed
  }, [currentUserRole, currentUserPermissions, bizLoading, isWabaActive])

  // Route protection path check using centralized canAccessPath
  const isAllowedPath = useMemo(() => {
    if (noSidebar || isLoggingOut) return true
    if (bizLoading && !currentUserRole) return false
    return canAccessPath(pathname, {
      role: currentUserRole,
      permissions: currentUserPermissions,
      isWabaActive,
    })
  }, [pathname, currentUserRole, currentUserPermissions, noSidebar, bizLoading, isLoggingOut, isWabaActive])

  const accessDeniedScreen = (
    <div className="min-h-[70vh] bg-[#f4f1ea] p-4 md:p-8 text-[#2e2e2e] flex items-center justify-center">
      <div className="bg-white border-4 border-black p-10 text-center space-y-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-xl">
        <div className="w-16 h-16 bg-red-100 border-4 border-black flex items-center justify-center text-3xl mx-auto rounded-full">
          🚫
        </div>
        <h2 className="text-3xl font-black uppercase italic tracking-tight text-slate-900 leading-none">
          Akses Ditolak
        </h2>
        <p className="text-sm font-bold text-slate-600 uppercase tracking-widest leading-relaxed">
          Anda tidak memiliki hak akses (izin) untuk membuka modul ini.
        </p>
        <div className="pt-4">
          <Link 
            href={currentUserPermissions.includes('manage_employees_salary') ? "/employees" : "/dashboard"} 
            className="inline-block bg-black text-white font-black uppercase text-xs tracking-widest px-8 py-4 border-4 border-black hover:bg-yellow-200 hover:text-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px]"
          >
            Kembali ke Halaman Utama
          </Link>
        </div>
      </div>
    </div>
  )

  // Close switcher dropdown on click outside
  useEffect(() => {
    if (!isDropdownOpen) return
    const closeDropdown = () => setIsDropdownOpen(false)
    window.addEventListener('click', closeDropdown)
    return () => window.removeEventListener('click', closeDropdown)
  }, [isDropdownOpen])

  const handleSwitchBusiness = async (bizId: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('profiles')
      .update({ active_business_id: bizId })
      .eq('id', user.id)

    if (error) {
      alert("Gagal mengaktifkan bisnis: " + error.message)
    } else {
      // Clear ALL dashboard caches so the new business data loads fresh
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.startsWith('su_dash_orders_') || key.startsWith('su_dash_metrics_') || key.startsWith('su_dash_ts_'))) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k))
      window.location.reload()
    }
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('[Layout] Client signOut error:', e)
    }

    loadedUserIdRef.current = null
    setUserProfile(null)
    setBusinesses([])
    setActiveBusiness(null)
    setCurrentUserRole(null)
    setCurrentUserPermissions([])
    setBizLoading(false)

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (
            key && (
              key.startsWith('su_') ||
              key.startsWith('cache_') ||
              key.startsWith('shapeup_')
            )
          ) {
            keysToRemove.push(key)
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k))
      }
    } catch (e) {
      console.error('[Layout] LocalStorage clear error:', e)
    }

    try {
      await logoutAction()
    } catch (e) {
      console.error('[Layout] logoutAction error:', e)
    } finally {
      window.location.href = '/login'
    }
  }

  const userContextValue = useMemo<UserContextType>(() => ({
    userProfile,
    activeBusiness,
    businesses,
    currentUserRole,
    currentUserPermissions,
    isWabaActive,
    bizLoading,
    refreshProfile: async (forceRefresh = true) => {
      if (loadedUserIdRef.current) {
        await loadProfileAndBusinesses(loadedUserIdRef.current, forceRefresh)
      }
    }
  }), [userProfile, activeBusiness, businesses, currentUserRole, currentUserPermissions, isWabaActive, bizLoading, loadProfileAndBusinesses])

  if (noSidebar) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>
          <UserProvider value={userContextValue}>
            {children}
          </UserProvider>
        </body>
      </html>
    )
  }

  // Intercept layout to display logout screen during logout
  if (isLoggingOut) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className} style={{ background: '#0F172A', color: '#FFFFFF' }}>
          <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
            <div className="w-14 h-14 bg-gradient-to-br from-red-500 to-amber-500 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-xl shadow-red-500/20 mb-6 animate-pulse">
              👋
            </div>
            <h2 className="text-xl font-extrabold text-slate-100 tracking-tight mb-2">
              ShapeUp CRM
            </h2>
            <p className="text-sm text-slate-400 font-medium tracking-wide flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin text-red-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Sedang keluar dari akun...</span>
            </p>
          </div>
        </body>
      </html>
    )
  }

  // Intercept layout to display loading screen on initial login when cache is empty
  if (bizLoading && !currentUserRole) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className} style={{ background: '#0F172A', color: '#FFFFFF' }}>
          <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-amber-500 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-xl shadow-blue-500/20 mb-6 animate-pulse">
              S
            </div>
            <h2 className="text-xl font-extrabold text-slate-100 tracking-tight mb-2">
              ShapeUp CRM
            </h2>
            <p className="text-sm text-slate-400 font-medium tracking-wide flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Memuat profil & hak akses user...</span>
            </p>
          </div>
        </body>
      </html>
    )
  }

  // Intercept layout to display onboarding if user is logged in but has no businesses
  if (!bizLoading && userProfile && businesses.length === 0) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>
          <BusinessOnboarding onLogout={handleLogout} />
        </body>
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
          zIndex: 30,
          transition: 'transform 0.25s ease',
        }}
          className={`${isMobileMenuOpen ? 'translate-x-0 z-50' : '-translate-x-full z-30'} lg:translate-x-0 lg:z-30`}
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

          {/* Business Switcher (WaveApps style) */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsDropdownOpen(!isDropdownOpen)
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#FFFEF9',
                cursor: 'pointer',
                textAlign: 'left',
                outline: 'none',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '14px', flexShrink: 0 }}>🏢</span>
                <span style={{ 
                  fontSize: '11px', 
                  fontWeight: 800, 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block',
                  flex: 1,
                  color: bizLoading ? 'rgba(255,254,249,0.3)' : undefined,
                }}>
                  {bizLoading ? 'Memuat...' : (activeBusiness ? activeBusiness.name : 'Pilih Bisnis')}
                </span>
              </div>
              <span style={{ 
                transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', 
                transition: 'transform 0.2s',
                display: 'flex',
                alignItems: 'center',
                opacity: 0.6,
                flexShrink: 0,
              }}>
                {Icons.chevronDown}
              </span>
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div 
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: '16px',
                  right: '16px',
                  marginTop: '6px',
                  background: '#1C1C1A',
                  border: '2px solid #000',
                  borderRadius: '8px',
                  boxShadow: '8px 8px 0px 0px rgba(0,0,0,0.15)',
                  zIndex: 60,
                  maxHeight: '220px',
                  overflowY: 'auto',
                  padding: '6px 0',
                }}
              >
                <div style={{ padding: '6px 12px', fontSize: '9px', fontWeight: 850, color: 'rgba(255,254,249,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Unit Bisnis Anda
                </div>
                {businesses.length === 0 ? (
                  <div style={{ padding: '8px 12px', fontSize: '11px', color: 'rgba(255,254,249,0.5)', fontStyle: 'italic' }}>
                    Belum ada bisnis
                  </div>
                ) : (
                  businesses.map((biz) => {
                    const isActive = activeBusiness?.id === biz.id
                    return (
                      <button
                        key={biz.id}
                        onClick={() => {
                          handleSwitchBusiness(biz.id)
                          setIsDropdownOpen(false)
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: isActive ? 'rgba(245,158,11,0.15)' : 'transparent',
                          border: 'none',
                          color: isActive ? '#F59E0B' : 'rgba(255,254,249,0.7)',
                          fontSize: '11px',
                          fontWeight: isActive ? 800 : 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>{biz.name}</span>
                        {isActive && <span style={{ fontSize: '10px', color: '#F59E0B', fontWeight: 'black' }}>✓</span>}
                      </button>
                    )
                  })
                )}
                {userProfile?.role === 'admin' && (
                  <>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
                    <Link
                      href="/settings/business?create=true"
                      onClick={() => setIsDropdownOpen(false)}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        color: '#F59E0B',
                        fontSize: '10px',
                        fontWeight: 800,
                        textDecoration: 'none',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      ➕ Buat Bisnis Baru
                    </Link>
                  </>
                )}
                {currentUserRole === 'admin' && (
                  <>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
                    <Link
                      href="/settings/business"
                      onClick={() => setIsDropdownOpen(false)}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        color: 'rgba(255,254,249,0.5)',
                        fontSize: '10px',
                        fontWeight: 800,
                        textDecoration: 'none',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      ⚙️ Kelola Bisnis
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
            {allowedMenuItems.map((item) => {
              const isChildActive = Boolean(item.children?.some(child => pathname === child.href))
              const isActive = pathname === item.href || 
                (item.href !== '/dashboard' && item.href !== '#' && pathname.startsWith(item.href)) ||
                isChildActive
              const showChildren = Boolean(item.children?.length && expandedMenus[item.name])

              return (
                <div key={item.name} style={{ marginBottom: '2px' }}>
                  <Link
                    href={item.href}
                    onClick={(e) => {
                      if (item.children && item.children.length > 0) {
                        e.preventDefault()
                        setExpandedMenus(prev => ({
                          ...prev,
                          [item.name]: !prev[item.name]
                        }))
                      } else {
                        setIsMobileMenuOpen(false)
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ opacity: isActive ? 1 : 0.6, flexShrink: 0 }}>{item.icon}</span>
                      <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '11px' }}>{item.name}</span>
                    </div>
                    {item.children && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setExpandedMenus(prev => ({
                            ...prev,
                            [item.name]: !prev[item.name]
                          }))
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px 4px',
                          display: 'flex',
                          alignItems: 'center',
                          opacity: 0.7,
                          color: 'inherit',
                          transform: expandedMenus[item.name] ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                        }}
                      >
                        {Icons.chevronDown}
                      </button>
                    )}
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
            {currentUserRole === 'admin' && (
              <Link
                href="/settings/business"
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
            )}
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
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--su-text)', lineHeight: 1.3 }}>
                  {currentUserRole === 'admin' ? 'Owner / Admin' : 'Anggota Tim'}
                </div>
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
              <UserProvider value={userContextValue}>
                {isAllowedPath ? children : accessDeniedScreen}
              </UserProvider>
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
