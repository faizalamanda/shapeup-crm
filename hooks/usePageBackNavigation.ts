"use client"

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { isModalBackHandlingActive, closeTopActiveModal } from '@/hooks/useModalBackHandler'

/**
 * Detects touch devices (Smartphones, iPads, Android Tablets) and standalone PWA installations,
 * using W3C Pointer & Interaction Media Queries (pointer: coarse) and touch capabilities,
 * without relying strictly on screen width breakpoints.
 */
export function isTouchOrStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  // Primary input is coarse touch (fingers on phones, iPads, Android tablets)
  const isCoarseTouch =
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(hover: none)').matches

  // Touch capability check (iOS Safari, iPadOS, Android tablets)
  const hasTouchCapability =
    ('ontouchstart' in window) ||
    ((navigator?.maxTouchPoints ?? 0) > 0)

  // Breakpoint fallback for small window resize or emulation
  const isSmallScreen = window.innerWidth < 768

  return isStandalone || isCoarseTouch || hasTouchCapability || isSmallScreen
}

// Backward-compatible alias
export const isMobileOrStandaloneApp = isTouchOrStandaloneApp

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
    // If there are multiple active modals, close the top-most one first (one by one).
    if (isModalBackHandlingActive()) {
      closeTopActiveModal()
      return
    }

    if (isMobileOrStandaloneApp()) {
      router.replace(mobileFallback)
      return
    }

    router.back()
  }, [mobileFallback, router])
}
