"use client"
import { useState } from 'react'
import MarketingAutomation from './components/MarketingAutomation' // Path ke sub-folder components lokal
import { PageHeader } from '@/components/ui/PageHeader' // UI Kit di root
import { Button } from '@/components/ui/Button'

export default function MarketingPage() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <main className="min-h-screen bg-[#f8f9fa] p-12 font-sans antialiased">
      <div className="max-w-6xl mx-auto">
        <PageHeader 
          title="Marketing Automation" 
          description="Atur pengiriman pesan otomatis untuk Toko Alamanda."
          action={
            <Button onClick={() => setIsModalOpen(true)}>
              + New Scenario
            </Button>
          }
        />
        
        <MarketingAutomation 
          isModalOpen={isModalOpen} 
          setIsModalOpen={setIsModalOpen} 
        />
      </div>
    </main>
  )
}