"use client"

import React from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import POSPrinterProductionManager from './POSPrinterProductionManager'

interface Props {
  isOpen: boolean
  onClose: () => void
  onStationsUpdated?: () => void
}

export default function ProductionStationsModal({ isOpen, onClose, onStationsUpdated }: Props) {
  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      title="🔀 Konfigurasi Mode POS, Stasiun Produksi &amp; Printer Mapping"
      description="Pemisahan mode ritel vs resto, stasiun produksi mandiri di database, dan pemetaan printer komputer &amp; Bluetooth"
      desktopSize="lg"
      footer={
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Selesai
          </button>
        </div>
      }
    >
      <POSPrinterProductionManager
        isModal={true}
        onClose={onClose}
        onStationsUpdated={onStationsUpdated}
      />
    </FullScreenModal>
  )
}
