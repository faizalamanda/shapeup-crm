"use client"

import { type ReactNode } from 'react'
import { usePageBackNavigation } from '@/hooks/usePageBackNavigation'

export type PageWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full'

type PageLayoutProps = {
  title: ReactNode
  children: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  width?: PageWidth
  showBackButton?: boolean
  backLabel?: string
  mobileBackFallback?: string
  className?: string
  contentClassName?: string
}

const widthClasses: Record<PageWidth, string> = {
  sm: 'max-w-2xl',
  md: 'max-w-4xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
  full: 'max-w-none',
}

/**
 * Shared application page shell. It keeps page hierarchy, spacing and mobile
 * navigation consistent while allowing feature content to remain independent.
 */
export function PageLayout({
  title,
  children,
  description,
  eyebrow,
  actions,
  footer,
  width = 'xl',
  showBackButton = true,
  backLabel = 'Kembali',
  mobileBackFallback = '/onboarding',
  className = '',
  contentClassName = '',
}: PageLayoutProps) {
  const goBack = usePageBackNavigation({ mobileFallback: mobileBackFallback })

  return (
    <main className={`min-h-full bg-[var(--su-bg)] text-[var(--su-text)] ${className}`}>
      <div className={`mx-auto w-full ${widthClasses[width]} px-4 py-5 sm:px-6 sm:py-8 lg:px-8`}>
        <header className="sticky top-0 z-20 -mx-4 mb-6 border-b border-[var(--su-border)] bg-[color:var(--su-bg)]/95 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-sm sm:static sm:mx-0 sm:mb-8 sm:rounded-none sm:border-b sm:bg-transparent sm:px-0 sm:pt-0 sm:backdrop-blur-none">
          <div className="flex min-w-0 items-start gap-3">
            {showBackButton && (
              <button
                type="button"
                onClick={goBack}
                className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--su-border)] bg-[var(--su-surface)] text-lg text-[var(--su-text-muted)] shadow-[var(--su-shadow-sm)] transition-colors hover:bg-white hover:text-[var(--su-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--su-primary)]"
                aria-label={backLabel}
              >
                <span aria-hidden="true">‹</span>
              </button>
            )}

            <div className="min-w-0 flex-1">
              {eyebrow && <p className="su-label mb-1">{eyebrow}</p>}
              <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
              {description && <p className="mt-1 max-w-3xl text-sm text-[var(--su-text-muted)]">{description}</p>}
            </div>

            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
        </header>

        <div className={contentClassName}>{children}</div>
        {footer && <footer className="mt-8 border-t border-[var(--su-border)] pt-5">{footer}</footer>}
      </div>
    </main>
  )
}
