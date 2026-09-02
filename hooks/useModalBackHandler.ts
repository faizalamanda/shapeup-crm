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

function handleGlobalPopState() {
  if (isProgrammaticBack) {
    isProgrammaticBack = false
    return
  }

  // Close ONLY the top-most active modal on smartphone/browser Back press
  if (modalStack.length > 0) {
    const topModal = modalStack[modalStack.length - 1]
    topModal.onClose()
  }
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  // Support W3C WAI-ARIA Escape key dismissal for desktop modal dialogs
  if (e.key === 'Escape' && modalStack.length > 0) {
    const topModal = modalStack[modalStack.length - 1]
    topModal.onClose()
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

