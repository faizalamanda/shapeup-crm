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

  // 1. Integration / Paid Plugin Guard
  if (href.startsWith('/inbox') && !isWabaActive) {
    return false
  }

  // 2. Public / Always accessible routes
  if (href.startsWith('/onboarding') || href === '/') {
    return true
  }

  // 3. Unauthenticated / Initial Loading State Fallback
  if (!role) return false

  // 4. Admin or Full Access Override (All modules accessible)
  if (role === 'admin' || permissions.includes('full_access')) {
    return true
  }

  // 5. System Settings (Owner / Admin only)
  if (href.startsWith('/settings')) {
    return false
  }

  // 6. HR & Employees Module (Requires manage_employees_salary)
  if (href.startsWith('/employees')) {
    return permissions.includes('manage_employees_salary')
  }

  // 7. Akuntansi / Accounting Financials (Requires view_financials_no_salary)
  if (href.startsWith('/accounting')) {
    return permissions.includes('view_financials_no_salary')
  }

  // 8. Overview / Dashboard
  if (href === '/dashboard') {
    return true
  }

  // 9. Pemasukan (Orders, Invoices, POS) & Customers
  if (href.startsWith('/orders') || href.startsWith('/customers')) {
    return (
      permissions.includes('manage_invoices') ||
      permissions.includes('view_financials_no_salary')
    )
  }

  // 10. Products & Stock Opname
  if (href.startsWith('/products') || href.startsWith('/stock-opname')) {
    return (
      permissions.includes('manage_products') ||
      permissions.includes('view_financials_no_salary')
    )
  }

  // 11. Daftar Pengeluaran (General Operational Expenses)
  if (href === '/expenses' || href.startsWith('/expenses/')) {
    return (
      permissions.includes('input_journal_expenses') ||
      permissions.includes('manage_bills') ||
      permissions.includes('view_financials_no_salary')
    )
  }

  // 12. Pembelian Produk (Product Purchases)
  if (href.startsWith('/purchases')) {
    return (
      permissions.includes('manage_purchases') ||
      permissions.includes('manage_bills') ||
      permissions.includes('view_financials_no_salary')
    )
  }

  // 13. Pemasok (Suppliers)
  if (href.startsWith('/suppliers')) {
    return (
      permissions.includes('manage_purchases') ||
      permissions.includes('manage_bills') ||
      permissions.includes('input_journal_expenses') ||
      permissions.includes('view_financials_no_salary')
    )
  }

  // 14. Marketing
  if (href.startsWith('/marketing')) {
    return permissions.includes('manage_marketing')
  }

  return false
}
