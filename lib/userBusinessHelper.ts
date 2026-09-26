import type { SupabaseClient } from '@supabase/supabase-js'

export interface UserBusinessContext {
  userProfile: any | null
  businesses: any[]
  activeBusiness: any | null
  activeBusinessId: string
  currentUserRole: string
  currentUserPermissions: string[]
}

/**
 * Unified helper module to fetch user profile, assigned + owned businesses,
 * active business, and resolved role & permissions in 1 parallel DB round-trip.
 * 
 * Used by:
 * - components/UserContext.tsx
 * - app/settings/business/page.tsx
 * - lib/apiContext.ts
 */
export async function fetchUserBusinessContext(
  userId: string,
  supabase: SupabaseClient
): Promise<UserBusinessContext> {
  const [profileRes, bsRes, ownedRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('business_staff').select('role, permissions, businesses (*)').eq('profile_id', userId),
    supabase.from('businesses').select('*').eq('owner_id', userId)
  ])

  const profile = profileRes.data || null

  const bizMap = new Map<string, any>()
  bsRes.data?.forEach((item: any) => {
    if (item.businesses) bizMap.set(item.businesses.id, item.businesses)
  })
  ownedRes.data?.forEach((biz: any) => {
    bizMap.set(biz.id, biz)
  })

  const combined = Array.from(bizMap.values())

  let activeBizId = profile?.active_business_id || combined[0]?.id || ''
  let selectedActiveBiz: any = null

  if (activeBizId) {
    const active = combined.find(b => b.id === activeBizId)
    if (active) {
      selectedActiveBiz = active
    } else {
      const { data: fallbackBiz } = await supabase.from('businesses').select('*').eq('id', activeBizId).maybeSingle()
      if (fallbackBiz) {
        selectedActiveBiz = fallbackBiz
        if (!combined.some(b => b.id === fallbackBiz.id)) {
          combined.push(fallbackBiz)
        }
      } else if (combined.length > 0) {
        selectedActiveBiz = combined[0]
        activeBizId = combined[0].id
      }
    }
  } else if (combined.length > 0) {
    selectedActiveBiz = combined[0]
    activeBizId = combined[0].id
  }

  // Auto-heal missing active_business_id in profiles table if needed
  if (!profile?.active_business_id && selectedActiveBiz?.id) {
    supabase
      .from('profiles')
      .upsert({ id: userId, active_business_id: selectedActiveBiz.id }, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) console.error('[userBusinessHelper] Auto-heal error:', error)
      })
  }

  // Resolve role and permissions for active business
  const targetBizId = activeBizId || selectedActiveBiz?.id
  const activeBs = bsRes.data?.find((item: any) => item.businesses?.id === targetBizId)
  const isUserOwner = Boolean(ownedRes.data && ownedRes.data.some((b: any) => b.id === targetBizId))
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
  } else if (ownedRes.data && ownedRes.data.length > 0) {
    resolvedRole = 'admin'
    resolvedPerms = ['full_access']
  }

  return {
    userProfile: profile,
    businesses: combined,
    activeBusiness: selectedActiveBiz,
    activeBusinessId: targetBizId || '',
    currentUserRole: resolvedRole,
    currentUserPermissions: resolvedPerms
  }
}
