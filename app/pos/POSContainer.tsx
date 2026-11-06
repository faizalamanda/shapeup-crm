"use client"

import { useState, useCallback } from 'react'
import POSHub from './components/POSHub'
import POSWorkspace from './components/POSWorkspace'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

export interface PreloadedPOSSession {
  activeShift: any | null
  cashierName?: string
  accounts?: any[]
  posRegisters?: any[]
}

export default function POSContainer() {
  const [currentView, setCurrentView] = useState<'hub' | 'workspace'>('hub')
  const [preloadedSession, setPreloadedSession] = useState<PreloadedPOSSession | null>(null)

  const handleOpenWorkspace = useCallback((sessionData?: PreloadedPOSSession) => {
    if (sessionData) {
      setPreloadedSession(sessionData)
    }
    setCurrentView('workspace')
  }, [])

  const handleBackToHub = useCallback((updatedSession?: Partial<PreloadedPOSSession>) => {
    if (updatedSession) {
      setPreloadedSession((prev) => (prev ? { ...prev, ...updatedSession } : null))
    }
    setCurrentView('hub')
  }, [])

  // Manage LIFO back navigation so pressing Back in POS Workspace returns to POS Hub
  useModalBackHandler(currentView === 'workspace', handleBackToHub)

  if (currentView === 'workspace') {
    return (
      <POSWorkspace
        onBackToHub={handleBackToHub}
        preloadedSession={preloadedSession || undefined}
      />
    )
  }

  return (
    <POSHub
      onOpenWorkspace={handleOpenWorkspace}
      preloadedSession={preloadedSession || undefined}
    />
  )
}

