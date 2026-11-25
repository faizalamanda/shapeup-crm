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
    <div className={`min-h-full w-full max-w-full min-w-0 text-[var(--su-text)] ${className}`}>
      <div className={`mx-auto w-full min-w-0 ${widthClasses[width]}`}>
        <header className="mb-6 border-b border-[var(--su-border)] pb-4 sm:mb-8">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
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
                {eyebrow && <div className="su-label mb-1">{eyebrow}</div>}
                <h1 className="break-words text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
                {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--su-text-muted)] sm:text-sm">{description}</p>}
              </div>
            </div>

            {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>}
          </div>
        </header>

        <div className={`min-w-0 ${contentClassName}`}>{children}</div>
        {footer && <footer className="mt-8 border-t border-[var(--su-border)] pt-5">{footer}</footer>}
      </div>
    </div>
  )
}
