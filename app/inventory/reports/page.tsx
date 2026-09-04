"use client"
import React, { useEffect, useState } from 'react'
import InventoryReportsMain from '@/plugins/inventory-reports'
import Link from 'next/link'

export default function InventoryReportsPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    async function checkPluginStatus() {
      try {
        const res = await fetch('/api/integrations')
        const json = await res.json()
        if (json.success && Array.isArray(json.integrations)) {
          const pluginRecord = json.integrations.find(
            (i: any) => i.platform_name === 'inventory_reports'
          )
          // Default to enabled if not explicitly disabled
          setEnabled(pluginRecord ? pluginRecord.is_active !== false : true)
        } else {
          setEnabled(true)
        }
      } catch {
        setEnabled(true)
      }
    }
    checkPluginStatus()
  }, [])

  if (enabled === false) {
    return (
      <div className="min-h-screen bg-[#F7F7F5] text-[#1C1C1A] p-6 flex flex-col items-center justify-center">
        <div className="bg-white border border-[#E2E2DC] rounded-2xl p-8 max-w-md text-center shadow-xs">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="text-xl font-bold text-[#1C1C1A] mb-2">Plugin Belum Diaktifkan</h2>
          <p className="text-xs text-[#6B6B63] mb-6">
            Modul <strong>Laporan Inventory & Stok</strong> saat ini nonaktif. Silakan aktifkan plugin ini terlebih dahulu pada menu Pengaturan Integrasi.
          </p>
          <Link
            href="/settings/integrations"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-all"
          >
            Buka Settings &gt; Plugin &amp; Integrasi
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-[#1C1C1A] p-4 sm:p-6 lg:p-8">
      <InventoryReportsMain />
    </div>
  )
}
