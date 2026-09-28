"use client"
import React, { useEffect, useState } from 'react'
import InventoryReportsMain from '@/plugins/inventory-reports'
import Link from 'next/link'

export default function InventoryReportsPage() {
  // FIX E: Render InventoryReportsMain immediately (enabled=true by default).
  // Plugin check runs in background and only blocks UI if explicitly disabled.
  // This eliminates 100-200ms sequential delay before data fetch starts.
  const [enabled, setEnabled] = useState<boolean>(true)

  useEffect(() => {
    // Non-blocking background check: does NOT delay mount of InventoryReportsMain
    fetch('/api/integrations')
      .then(res => res.json())
      .then(json => {
        if (json.success && Array.isArray(json.integrations)) {
          const pluginRecord = json.integrations.find(
            (i: any) => i.platform_name === 'inventory_reports'
          )
          // Only disable if explicitly set to false — default is enabled
          if (pluginRecord && pluginRecord.is_active === false) {
            setEnabled(false)
          }
        }
      })
      .catch(() => {
        // Network error — keep enabled (fail open)
      })
  }, [])

  if (enabled === false) {
    return (
      <div className="min-h-screen bg-[#F7F7F5] text-[#1C1C1A] p-6 flex flex-col items-center justify-center">
        <div className="bg-white border border-[#E2E2DC] rounded-2xl p-8 max-w-md text-center shadow-xs">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="text-xl font-bold text-[#1C1C1A] mb-2">Plugin Belum Diaktifkan</h2>
          <p className="text-xs text-[#6B6B63] mb-6">
            Modul <strong>Laporan Inventory &amp; Stok</strong> saat ini nonaktif. Silakan aktifkan plugin ini terlebih dahulu pada menu Pengaturan Integrasi.
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
