"use client"
import React, { useEffect, useState } from 'react'
import PipelineMain from '@/plugins/pipeline'
import Link from 'next/link'

export default function PipelinePage() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    async function checkPluginStatus() {
      try {
        const res = await fetch('/api/integrations')
        const json = await res.json()
        if (json.success && Array.isArray(json.integrations)) {
          const pluginRecord = json.integrations.find(
            (i: any) => i.platform_name === 'pipeline'
          )
          // Default to inactive if not explicitly activated
          setEnabled(pluginRecord ? pluginRecord.is_active === true : false)
        } else {
          setEnabled(false)
        }
      } catch {
        setEnabled(false)
      }
    }
    checkPluginStatus()
  }, [])

  if (enabled === null) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (enabled === false) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-6 flex flex-col items-center justify-center">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 max-w-md text-center shadow-xl space-y-4">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center text-3xl mx-auto font-black">
            📊
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Plugin Pipeline Nonaktif</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Modul <strong>Universal Pipeline &amp; Kanban</strong> saat ini belum diaktifkan untuk unit bisnis ini. Silakan aktifkan terlebih dahulu di Pengaturan Plugin &amp; Integrasi.
            </p>
          </div>
          <Link
            href="/settings/integrations"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md transition-all w-full"
          >
            Aktifkan Plugin di Pengaturan Integrasi
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-full min-h-[calc(100vh-140px)] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden text-gray-900 dark:text-gray-100">
      <PipelineMain />
    </div>
  )
}
