"use client"
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SettingsIndexPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/settings/business')
  }, [router])

  return (
    <div className="min-h-screen bg-[#f4f1ea] p-16 text-center font-black text-slate-400 uppercase tracking-widest animate-pulse">
      Mengarahkan ke Pengaturan Unit Bisnis...
    </div>
  )
}