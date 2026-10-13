"use client"

import { useState } from 'react'
import POSHub from './components/POSHub'
import POSWorkspace from './components/POSWorkspace'

export default function POSContainer() {
  const [currentView, setCurrentView] = useState<'hub' | 'workspace'>('hub')

  if (currentView === 'workspace') {
    return <POSWorkspace onBackToHub={() => setCurrentView('hub')} />
  }

  return <POSHub onOpenWorkspace={() => setCurrentView('workspace')} />
}
