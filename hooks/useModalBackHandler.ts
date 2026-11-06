"use client"
import { useEffect, useRef } from 'react'

interface ModalStackItem {
  id: string
  onClose: () => void
  key: string
}

// Global state for LIFO Modal Registry & Event Dispatching
let modalStack: ModalStackItem[] = []
let isProgrammaticBack = false
let isListenersAttached = false

/**
 * Lets page-level Back handlers yield to the modal stack. This also remains true
 * while a programmatic `history.back()` removes a modal history entry.
 */
export function isModalBackHandlingActive() {
  return modalStack.length > 0 || isProgrammaticBack
}

/**
 * Close ONLY the top-most active modal in the stack (LIFO).
 * If there are multiple active modals, they close sequentially one by one.
 */
export function closeTopActiveModal() {
  if (modalStack.length === 0) return false
  const topModal = modalStack[modalStack.length - 1]
  if (topModal) {
    try {
      topModal.onClose()
    } catch (err) {
      console.error('Error closing top modal on back:', err)
    }
  }
  return true
}

function handleGlobalPopState() {
  if (isProgrammaticBack) {
    isProgrammaticBack = false
    return
  }

  // Close ONLY the top-most active modal (LIFO) so nested modals close one by one
  if (modalStack.length > 0) {
    closeTopActiveModal()
  }
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  // Support W3C WAI-ARIA Escape key dismissal for desktop modal dialogs (one by one)
  if (e.key === 'Escape' && modalStack.length > 0) {
    closeTopActiveModal()
  }
}

function ensureGlobalListeners() {
  if (typeof window === 'undefined') return
  if (!isListenersAttached) {
    window.addEventListener('popstate', handleGlobalPopState)
    window.addEventListener('keydown', handleGlobalKeyDown)
    isListenersAttached = true
  }
}

/**
 * Standard-compliant Hook to handle mobile / browser back button and desktop Escape key when a modal is open.
 * Maintains a global LIFO stack so nested modals close top-to-bottom sequentially.
 */
export function useModalBackHandler(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return

    ensureGlobalListeners()

    const modalId = Math.random().toString(36).substring(2, 9)
    const modalStateKey = `modal_open_${modalId}`

    // Push dummy state to window.history
    window.history.pushState({ modalStateKey }, '')

    const stackItem: ModalStackItem = {
      id: modalId,
      onClose: () => onCloseRef.current(),
      key: modalStateKey
    }
    modalStack.push(stackItem)

    return () => {
      // Remove from global stack
      modalStack = modalStack.filter(item => item.id !== modalId)

      // Clean up history entry if closed programmatically (X, backdrop, submit)
      if (typeof window !== 'undefined' && window.history.state?.modalStateKey === modalStateKey) {
        isProgrammaticBack = true
        window.history.back()
      }
    }
  }, [isOpen])
}
