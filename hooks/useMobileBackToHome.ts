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
  // Check if segment is numeric ID, UUID, or contains digits (e.g., order ID, customer ID)
  if (!isNaN(Number(segment))) return true
  if (/^[0-9a-fA-F-]{8,}$/.test(segment)) return true
  return false
}

/**
 * Determine parent path or onboarding destination dynamically based on URL segments
 */
export function getParentPath(pathname: string): string | null {
  // Ignore auth pages, root, and onboarding
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
    // e.g. /orders/invoices/123/edit -> /orders/invoices
    return '/' + segments.slice(0, -2).join('/')
  }

  if (isSubPageSegment(lastSegment)) {
    // e.g. /orders/invoices/new -> /orders/invoices
    return '/' + segments.slice(0, -1).join('/')
  }

  // Fallback for multi-segment sub-menus (e.g. /customers/cohorts/returning -> /onboarding)
  return '/onboarding'
}

/**
 * Hook to handle mobile / browser Back button like a native app.
 * Pressing Back on sub-pages (e.g. /orders/invoices/new) returns to parent menu (/orders/invoices).
 * Pressing Back on menu pages (e.g. /orders, /expenses) returns to /onboarding.
 * Modals automatically take precedence and close without navigating away.
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
      // 1. If a modal is open (detected via history state modalStateKey), do not redirect.
      // useModalBackHandler will handle closing the modal.
      if (event.state?.modalStateKey || window.history.state?.modalStateKey) {
        return
      }

      const activePath = currentPathRef.current
      const targetParent = getParentPath(activePath)

      if (targetParent) {
        // Prevent default browser stack traversal and replace with target parent or onboarding
        router.replace(targetParent)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [router])
}
