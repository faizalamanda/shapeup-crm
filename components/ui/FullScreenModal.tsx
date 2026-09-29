"use client"

import { type ReactNode, useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

type FullScreenModalProps = {
  isOpen: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  description?: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
  closeLabel?: string
  showCloseButton?: boolean
  /** Width used from the `sm` breakpoint upward. Mobile is always full-screen. */
  desktopSize?: 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'
}

let scrollLockCount = 0
let previousBodyOverflow = ''
const subscribeToMount = () => () => undefined
const desktopSizeClasses = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-6xl',
  fullscreen: 'sm:h-[100dvh] sm:max-h-none sm:max-w-none sm:rounded-none',
} as const

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow
}

/** Shared full-screen dialog shell for mobile and PWA flows. */
export function FullScreenModal({
  isOpen,
  onClose,
  title,
  children,
  description,
  footer,
  className = '',
  contentClassName = '',
  closeLabel = 'Tutup',
  showCloseButton = true,
  desktopSize = 'md',
}: FullScreenModalProps) {
  const mounted = useSyncExternalStore(subscribeToMount, () => true, () => false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useModalBackHandler(isOpen, onClose)

  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialogs = document.querySelectorAll<HTMLElement>('.su-modal-dialog')
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    lockBodyScroll()
    dialogRef.current?.focus()
    document.addEventListener('keydown', handleTabKey)
    return () => {
      document.removeEventListener('keydown', handleTabKey)
      unlockBodyScroll()
      previouslyFocused?.focus()
    }
  }, [isOpen])

  if (!mounted || !isOpen) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[1000] flex h-[100dvh] w-screen items-stretch justify-center bg-slate-950/45 sm:items-center ${desktopSize === 'fullscreen' ? 'sm:p-0' : 'sm:p-6'}`}
    >
      <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      className={`su-modal-dialog flex h-[100dvh] w-screen flex-col bg-[var(--su-surface)] text-[var(--su-text)] outline-none sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:overflow-hidden sm:rounded-2xl sm:shadow-2xl ${desktopSizeClasses[desktopSize]} ${className}`}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--su-border)] bg-[var(--su-surface)] px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-base font-extrabold tracking-tight">{title}</h2>
          {description && <p id={descriptionId} className="mt-0.5 text-xs text-[var(--su-text-muted)]">{description}</p>}
        </div>
        {showCloseButton && (
          <button type="button" onClick={onClose} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-[var(--su-text-muted)] transition-colors hover:bg-[var(--su-bg)] hover:text-[var(--su-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--su-primary)]" aria-label={closeLabel}>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </header>

      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 ${contentClassName}`}>
        {children}
      </div>

      {footer && <footer className="shrink-0 border-t border-[var(--su-border)] bg-[var(--su-surface)] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 sm:px-6">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
