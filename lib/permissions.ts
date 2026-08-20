/**
 * ShapeUp CRM — Centralized Access Control & Permissions Registry
 * 
 * Single source of truth for route guards, plugin activation checks,
 * and user permission validation across Sidebar, Onboarding, and Pages.
 */

export interface AccessContext {
  role: string | null
  permissions: string[]
  isWabaActive?: boolean
}

/**
 * Checks if a given path/href is accessible based on user role, permissions,
 * and integration/plugin activation status.
 */
export function canAccessPath(href: string, context: AccessContext): boolean {
  const { role, permissions = [], isWabaActive = false } = context

  // 1. Integration / Paid Plugin Guard (Evaluated BEFORE role overrides)
  // If a paid plugin (e.g. WABA Inbox) is inactive for the business,
  // access is denied for ALL users, including Admins.
  if (href.startsWith('/inbox') && !isWabaActive) {
    return false
  }

  // 2. Public / Always accessible routes
  if (href.startsWith('/onboarding') || href === '/') {
    return true
  }

  // 3. Unauthenticated / Initial Loading State Fallback
  if (!role) return false

  // 3. Admin & Full Access Overrides (Applies to standard features)
  if (role === 'admin' || permissions.includes('full_access')) {
    return true
  }

  // 4. Restricted System / Owner Only Routes
  if (href.startsWith('/settings')) {
    return false
  }

  // 5. Specific Staff Permission Guards
  if (href.startsWith('/employees')) {
    return permissions.includes('manage_employees_salary')
  }

  if (href.startsWith('/accounting')) {
    return permissions.includes('view_financials_no_salary')
  }

  if (href.startsWith('/expenses')) {
    return (
      permissions.includes('view_financials_no_salary') ||
      permissions.includes('input_journal_expenses') ||
      permissions.includes('manage_bills')
    )
  }

  if (href.startsWith('/suppliers')) {
    return (
      permissions.includes('view_financials_no_salary') ||
      permissions.includes('input_journal_expenses') ||
      permissions.includes('manage_bills') ||
      permissions.includes('manage_purchases')
    )
  }

  if (href.startsWith('/orders') || href.startsWith('/customers')) {
    return (
      permissions.includes('view_financials_no_salary') ||
      permissions.includes('manage_invoices')
    )
  }

  if (href.startsWith('/products') || href.startsWith('/stock-opname')) {
    return (
      permissions.includes('view_financials_no_salary') ||
      permissions.includes('manage_invoices') ||
      permissions.includes('manage_products')
    )
  }

  return true
}
