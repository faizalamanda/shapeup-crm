"use client"

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { logoutAction } from '@/app/auth/actions'

export interface UserContextType {
  userProfile: any | null
  activeBusiness: any | null
  businesses: any[]
  currentUserRole: string | null
  currentUserPermissions: string[]
  isWabaActive: boolean
  bizLoading: boolean
  isLoggingOut: boolean
  refreshProfile: (forceRefresh?: boolean) => Promise<void>
  handleLogout: () => Promise<void>
  handleSwitchBusiness: (bizId: string) => Promise<void>
}

const UserContext = createContext<UserContextType>({
  userProfile: null,
  activeBusiness: null,
  businesses: [],
  currentUserRole: 'admin',
  currentUserPermissions: ['full_access'],
  isWabaActive: false,
  bizLoading: true,
  isLoggingOut: false,
  refreshProfile: async () => {},
  handleLogout: async () => {},
  handleSwitchBusiness: async () => {},
})

export function AppUserProvider({ children }: { children: React.ReactNode }) {
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
      return localStorage.getItem('su_cached_role') || null
    }
    return null
  })

  const [currentUserPermissions, setCurrentUserPermissions] = useState<string[]>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = localStorage.getItem('su_cached_perms')
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed
        }
      } catch (e) {}
    }
    return ['full_access']
  })

  const [isWabaActive, setIsWabaActive] = useState(false)
  const [bizLoading, setBizLoading] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const loadIdRef = useRef(0)
  const loadedUserIdRef = useRef<string | null>(null)

  const loadProfileAndBusinesses = useCallback(async (userId: string, forceRefresh = false) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const lastUserId = localStorage.getItem('su_last_logged_in_user_id')
        if (lastUserId && lastUserId !== userId) {
          const keysToRemove: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && (key.startsWith('su_') || key.startsWith('cache_') || key.startsWith('shapeup_'))) {
              keysToRemove.push(key)
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k))
        }
        localStorage.setItem('su_last_logged_in_user_id', userId)
      }
    } catch (e) {
      console.error('[UserContext] Error checking localStorage cache:', e)
    }

    if (!forceRefresh && loadedUserIdRef.current === userId) {
      setBizLoading(false)
      return
    }

    const loadId = ++loadIdRef.current

    try {
      const [profileResult, bsResult, ownedResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('business_staff').select('role, permissions, businesses (*)').eq('profile_id', userId),
        supabase.from('businesses').select('*').eq('owner_id', userId),
      ])

      if (loadId !== loadIdRef.current) return

      const profile = profileResult.data
      setUserProfile(profile || null)
      if (profile) {
        loadedUserIdRef.current = userId
      }

      const bizMap = new Map<string, any>()
      bsResult.data?.forEach((item: any) => {
        if (item.businesses) bizMap.set(item.businesses.id, item.businesses)
      })
      ownedResult.data?.forEach((biz: any) => {
        bizMap.set(biz.id, biz)
      })

      const combined = Array.from(bizMap.values())
      setBusinesses(combined)

      const activeBizId = profile?.active_business_id || combined[0]?.id
      let selectedActiveBiz: any = null

      if (activeBizId) {
        const active = combined.find(b => b.id === activeBizId)
        if (active) {
          setActiveBusiness(active)
          selectedActiveBiz = active
        } else {
          const { data: fallbackBiz } = await supabase.from('businesses').select('*').eq('id', activeBizId).single()
          if (loadId === loadIdRef.current && fallbackBiz) {
            setActiveBusiness(fallbackBiz)
            selectedActiveBiz = fallbackBiz
          } else if (combined.length > 0) {
            setActiveBusiness(combined[0])
            selectedActiveBiz = combined[0]
          }
        }
      } else if (combined.length > 0) {
        setActiveBusiness(combined[0])
        selectedActiveBiz = combined[0]
      } else {
        setActiveBusiness(null)
      }

      if (activeBizId) {
        const { data: wabaInt } = await supabase
          .from('integrations')
          .select('is_active, api_credentials')
          .eq('platform_name', 'waba_official')
          .filter('api_credentials->>business_id', 'eq', activeBizId)
          .maybeSingle()

        setIsWabaActive(Boolean(wabaInt && wabaInt.is_active === true))
      } else {
        setIsWabaActive(false)
      }

      // Resolve role and permissions (Business Owners & Admins always get full_access)
      const activeBs = bsResult.data?.find((item: any) => item.businesses?.id === activeBizId)
      const isUserOwner = Boolean(ownedResult.data && ownedResult.data.some((b: any) => b.id === activeBizId))
      const isGlobalAdmin = profile?.role === 'admin'
      const isBsAdmin = activeBs?.role === 'admin'
      const isUserAdmin = isGlobalAdmin || isBsAdmin || isUserOwner

      let resolvedRole = 'staff'
      let resolvedPerms: string[] = []

      if (isUserAdmin) {
        resolvedRole = 'admin'
        resolvedPerms = ['full_access']
      } else if (activeBs) {
        resolvedRole = activeBs.role || 'staff'
        resolvedPerms = Array.isArray(activeBs.permissions) ? activeBs.permissions : []
      } else if (ownedResult.data && ownedResult.data.length > 0) {
        resolvedRole = 'admin'
        resolvedPerms = ['full_access']
      }

      setCurrentUserRole(resolvedRole)
      setCurrentUserPermissions(resolvedPerms)

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          if (profile) localStorage.setItem('su_cached_user_profile', JSON.stringify(profile))
          if (combined) localStorage.setItem('su_cached_businesses', JSON.stringify(combined))
          if (selectedActiveBiz) localStorage.setItem('su_cached_active_biz', JSON.stringify(selectedActiveBiz))
          localStorage.setItem('su_cached_role', resolvedRole)
          localStorage.setItem('su_cached_perms', JSON.stringify(resolvedPerms))
        }
      } catch (e) {
        console.error('[UserContext] Error setting cache:', e)
      }
    } catch (err) {
      console.error('[UserContext] Error loading profile and businesses:', err)
    } finally {
      if (loadId === loadIdRef.current) {
        setBizLoading(false)
      }
    }
  }, [supabase])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user?.id) {
          const force = event === 'SIGNED_IN' || event === 'USER_UPDATED' || session.user.id !== loadedUserIdRef.current
          loadProfileAndBusinesses(session.user.id, force)
        } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
          loadedUserIdRef.current = null
          setUserProfile(null)
          setBusinesses([])
          setActiveBusiness(null)
          setCurrentUserRole('admin')
          setCurrentUserPermissions(['full_access'])
          setBizLoading(false)
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, loadProfileAndBusinesses])

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
      if (typeof window !== 'undefined') {
        sessionStorage.clear()
        if (window.localStorage) {
          const keysToRemove: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && (key.startsWith('su_') || key.startsWith('cache_') || key.startsWith('shapeup_') || key.startsWith('sb-'))) {
              keysToRemove.push(key)
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k))
        }
      }
    } catch (e) {
      console.error('[UserContext] LocalStorage clear error:', e)
    }

    loadedUserIdRef.current = null
    setUserProfile(null)
    setBusinesses([])
    setActiveBusiness(null)
    setCurrentUserRole('admin')
    setCurrentUserPermissions(['full_access'])
    setBizLoading(false)

    const forceRedirectTimer = setTimeout(() => {
      window.location.href = '/login'
    }, 800)

    try {
      await Promise.allSettled([
        supabase.auth.signOut(),
        logoutAction()
      ])
    } catch (e) {
      console.error('[UserContext] SignOut error:', e)
    } finally {
      clearTimeout(forceRedirectTimer)
      window.location.href = '/login'
    }
  }

  const value = useMemo<UserContextType>(() => ({
    userProfile,
    activeBusiness,
    businesses,
    currentUserRole,
    currentUserPermissions,
    isWabaActive,
    bizLoading,
    isLoggingOut,
    refreshProfile: async (forceRefresh = true) => {
      if (loadedUserIdRef.current) {
        await loadProfileAndBusinesses(loadedUserIdRef.current, forceRefresh)
      }
    },
    handleLogout,
    handleSwitchBusiness,
  }), [userProfile, activeBusiness, businesses, currentUserRole, currentUserPermissions, isWabaActive, bizLoading, isLoggingOut, loadProfileAndBusinesses])

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function UserProvider({ children, value }: { children: React.ReactNode; value?: UserContextType }) {
  if (value) {
    return <UserContext.Provider value={value}>{children}</UserContext.Provider>
  }
  return <AppUserProvider>{children}</AppUserProvider>
}

export function useUserContext() {
  return useContext(UserContext)
}
