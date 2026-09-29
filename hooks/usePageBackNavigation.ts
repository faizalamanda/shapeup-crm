"use client"

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { isModalBackHandlingActive } from '@/hooks/useModalBackHandler'

export function isMobileOrStandaloneApp() {
  if (typeof window === 'undefined') return false

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true

  return window.innerWidth < 768 || isStandalone
}

type PageBackNavigationOptions = {
  mobileFallback?: string
}

/**
 * Navigation used by the visible Back control in PageLayout.
 * Browser/device Back is handled once in the application layout by
 * `useMobileBackToHome`, while this handles an explicit UI action.
 */
export function usePageBackNavigation({
  mobileFallback = '/onboarding',
}: PageBackNavigationOptions = {}) {
  const router = useRouter()

  return useCallback(() => {
    // A modal owns the latest history entry and must close before this page.
    if (isModalBackHandlingActive()) {
      window.history.back()
      return
    }

    if (isMobileOrStandaloneApp()) {
      router.replace(mobileFallback)
      return
    }

    router.back()
  }, [mobileFallback, router])
}
