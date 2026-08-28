"use client"
import { useEffect, useRef } from 'react'

/**
 * Hook to handle mobile / browser back button when a modal is open.
 * When `isOpen` is true, it pushes a dummy state to history.
 * If the user clicks the browser/smartphone Back button, `onClose` will be triggered to close the modal instead of navigating away.
 */
export function useModalBackHandler(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return

    const modalStateKey = `modal_open_${Math.random().toString(36).substring(2, 9)}`
    
    // Push dummy state to window.history
    window.history.pushState({ modalStateKey }, '')

    const handlePopState = () => {
      // Back button was pressed by user
      onCloseRef.current()
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)

      // If modal closed via X button / backdrop / form submit, clean up dummy history entry
      if (window.history.state?.modalStateKey === modalStateKey) {
        window.history.back()
      }
    }
  }, [isOpen])
}
