"use client"

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * List of action/ID segment patterns that indicate a sub-page / form route
 */
const ACTION_KEYWORDS = new Set(['new', 'create', 'edit', 'import', 'add', 'copy', 'detail', 'view'])

/**
 * Helper to determine if a path segment is likely a dynamic ID, UUID, or action keyword
 */
function isSubPageSegment(segment: string): boolean {
  if (ACTION_KEYWORDS.has(segment.toLowerCase())) return true
  if (!isNaN(Number(segment))) return true
  if (/^[0-9a-fA-F-]{8,}$/.test(segment)) return true
  return false
}

/**
 * Determine parent path or onboarding destination dynamically based on URL segments
 */
export function getParentPath(pathname: string): string | null {
  if (!pathname || pathname === '/' || pathname === '/onboarding' || pathname === '/login' || pathname === '/register') {
    return null
  }

  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) return null

  // Top level menu items like /orders, /expenses, /products, /customers, /inbox, /marketing, /employees, /settings
  if (segments.length === 1) {
    return '/onboarding'
  }

  // 2 segments: check if second segment is a sub-page action (e.g. /expenses/new, /expenses/import)
  if (segments.length === 2) {
    if (isSubPageSegment(segments[1])) {
      return '/' + segments[0]
    }
    // Top-level sub-menus like /orders/invoices, /orders/pos, /customers/cohorts, /accounting/transactions
    return '/onboarding'
  }

  // 3 or more segments: e.g., /orders/invoices/new, /expenses/edit/123, /customers/cohorts/returning
  const lastSegment = segments[segments.length - 1]
  const secondLastSegment = segments[segments.length - 2]

  if (secondLastSegment === 'edit') {
    return '/' + segments.slice(0, -2).join('/')
  }

  if (isSubPageSegment(lastSegment)) {
    return '/' + segments.slice(0, -1).join('/')
  }

  return '/onboarding'
}

/**
 * Hook to handle mobile / browser Back button like a native app on Mobile screens (< 768px or PWA).
 * On Mobile: Pressing Back on sub-pages returns to parent menu, menu pages return to /onboarding.
 * On Desktop (>= 768px): Preserves standard linear browser back history.
 */
export function useMobileBackToHome() {
  const pathname = usePathname()
  const router = useRouter()
  const currentPathRef = useRef(pathname)

  useEffect(() => {
    currentPathRef.current = pathname
  }, [pathname])

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // 1. Check if on Desktop screen (width >= 768px). On desktop, allow normal browser back navigation.
      if (typeof window !== 'undefined' && window.innerWidth >= 768) {
        return
      }

      // 2. If a modal is open (modalStateKey present), do not redirect.
      if (event.state?.modalStateKey || window.history.state?.modalStateKey) {
        return
      }

      const activePath = currentPathRef.current
      const targetParent = getParentPath(activePath)

      if (targetParent) {
        setTimeout(() => {
          if (window.location.pathname !== targetParent) {
            router.replace(targetParent)
          }
        }, 0)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [router])
}
