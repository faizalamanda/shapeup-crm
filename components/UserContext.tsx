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
  isOffline: boolean
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
  isOffline: false,
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
  const [bizLoading, setBizLoading] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return !Boolean(localStorage.getItem('su_cached_user_profile'))
    }
    return true
  })
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isOffline, setIsOffline] = useState(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      return !navigator.onLine
    }
    return false
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
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
      if (profile) {
        setUserProfile(profile)
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
      if (combined.length > 0) {
        setBusinesses(combined)
      }

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
            if (!combined.some(b => b.id === fallbackBiz.id)) {
              combined.push(fallbackBiz)
              setBusinesses(combined)
            }
          } else if (combined.length > 0) {
            setActiveBusiness(combined[0])
            selectedActiveBiz = combined[0]
          }
        }
      } else if (combined.length > 0) {
        setActiveBusiness(combined[0])
        selectedActiveBiz = combined[0]
      }

      // Auto-heal missing active_business_id in profiles table
      if (profile && !profile.active_business_id && selectedActiveBiz?.id) {
        supabase
          .from('profiles')
          .update({ active_business_id: selectedActiveBiz.id })
          .eq('id', userId)
          .then(({ error }) => {
            if (error) console.error('[UserContext] Auto-heal active_business_id error:', error)
          })
      }

      const targetBizId = activeBizId || selectedActiveBiz?.id
      if (targetBizId) {
        const { data: wabaInt } = await supabase
          .from('integrations')
          .select('is_active, api_credentials')
          .eq('platform_name', 'waba_official')
          .filter('api_credentials->>business_id', 'eq', targetBizId)
          .maybeSingle()

        setIsWabaActive(Boolean(wabaInt && wabaInt.is_active === true))
      } else {
        setIsWabaActive(false)
      }

      // Resolve role and permissions (Business Owners & Admins always get full_access)
      const activeBs = bsResult.data?.find((item: any) => item.businesses?.id === targetBizId)
      const isUserOwner = Boolean(ownedResult.data && ownedResult.data.some((b: any) => b.id === targetBizId))
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
          if (combined && combined.length > 0) localStorage.setItem('su_cached_businesses', JSON.stringify(combined))
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

  const clearCachedUserData = useCallback(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && (key.startsWith('su_') || key.startsWith('cache_') || key.startsWith('shapeup_') || key.startsWith('sb-'))) {
            keysToRemove.push(key)
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k))
      } catch (e) {
        console.error('[UserContext] Error clearing local cache:', e)
      }
    }
  }, [])

  const isLoggingOutRef = useRef(false)

  const handleUnauthenticatedSession = useCallback((reason = 'INITIAL_SESSION') => {
    // If reason is not explicit logout, check if user has local cached profile
    if (reason !== 'EXPLICIT_LOGOUT' && !isLoggingOutRef.current) {
      const hasCachedProfile = typeof window !== 'undefined' && Boolean(localStorage.getItem('su_cached_user_profile'))
      if (hasCachedProfile) {
        console.warn('[UserContext] Suppressing unauthenticated redirect due to existing cached profile.')
        setBizLoading(false)
        return
      }
    }

    loadedUserIdRef.current = null
    setUserProfile(null)
    setBusinesses([])
    setActiveBusiness(null)
    setCurrentUserRole('admin')
    setCurrentUserPermissions(['full_access'])
    setBizLoading(false)

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

    if (isOnline) {
      clearCachedUserData()
      if (typeof window !== 'undefined') {
        const currentPath = window.location.pathname
        const isPublicRoute = currentPath === '/login' || currentPath === '/register' || currentPath === '/'
        if (!isPublicRoute) {
          window.location.href = `/login?next=${encodeURIComponent(currentPath)}`
        }
      }
    }
  }, [clearCachedUserData])

  useEffect(() => {
    // Safety timeout (3.5 seconds): Release loading state gracefully without kicking user out
    const safetyTimeoutId = setTimeout(async () => {
      if (loadedUserIdRef.current) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user?.id) {
          loadProfileAndBusinesses(session.user.id, true)
        } else {
          setBizLoading(false)
        }
      } catch (e) {
        setBizLoading(false)
      }
    }, 3500)

    const handleBusinessUpdated = () => {
      if (loadedUserIdRef.current) {
        loadProfileAndBusinesses(loadedUserIdRef.current, true)
      } else {
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user?.id) loadProfileAndBusinesses(user.id, true)
        })
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('shapeup:business_updated', handleBusinessUpdated)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        clearTimeout(safetyTimeoutId)
        if (session?.user?.id) {
          const force = event === 'SIGNED_IN' || event === 'USER_UPDATED' || session.user.id !== loadedUserIdRef.current
          loadProfileAndBusinesses(session.user.id, force)
        } else if (event === 'SIGNED_OUT') {
          if (isLoggingOutRef.current) {
            handleUnauthenticatedSession('EXPLICIT_LOGOUT')
          } else {
            // Verify if user is truly unauthenticated or if it was a transient auth error
            try {
              const { data: { user } } = await supabase.auth.getUser()
              if (user?.id) {
                loadProfileAndBusinesses(user.id, false)
              } else {
                handleUnauthenticatedSession('SIGNED_OUT')
              }
            } catch {
              setBizLoading(false)
            }
          }
        } else if (event === 'INITIAL_SESSION' && !session) {
          try {
            const { data: { user } } = await supabase.auth.getUser()
            if (user?.id) {
              loadProfileAndBusinesses(user.id, true)
            } else {
              const lastUserId = typeof window !== 'undefined' ? localStorage.getItem('su_last_logged_in_user_id') : null
              const cachedProfile = typeof window !== 'undefined' ? localStorage.getItem('su_cached_user_profile') : null
              if (!lastUserId && !cachedProfile && !userProfile) {
                handleUnauthenticatedSession('INITIAL_SESSION')
              } else {
                setBizLoading(false)
              }
            }
          } catch {
            setBizLoading(false)
          }
        }
      }
    )

    return () => {
      clearTimeout(safetyTimeoutId)
      if (typeof window !== 'undefined') {
        window.removeEventListener('shapeup:business_updated', handleBusinessUpdated)
      }
      subscription.unsubscribe()
    }
  }, [supabase, loadProfileAndBusinesses, handleUnauthenticatedSession, userProfile])


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
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('shapeup:business_updated'))
      }
      await loadProfileAndBusinesses(user.id, true)
      window.location.reload()
    }
  }

  const handleLogout = async () => {
    isLoggingOutRef.current = true
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
    isOffline,
    refreshProfile: async (forceRefresh = true) => {
      const uid = loadedUserIdRef.current || (await supabase.auth.getUser()).data.user?.id
      if (uid) {
        await loadProfileAndBusinesses(uid, forceRefresh)
      }
    },
    handleLogout,
    handleSwitchBusiness,
  }), [userProfile, activeBusiness, businesses, currentUserRole, currentUserPermissions, isWabaActive, bizLoading, isLoggingOut, isOffline, loadProfileAndBusinesses, supabase])

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
