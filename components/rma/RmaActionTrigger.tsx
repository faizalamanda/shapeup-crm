'use client'

import React, { useState } from 'react'
import { CreateRmaModal } from '@/app/orders/rma/components/CreateRmaModal'

type RmaActionTriggerProps = {
  order: any
  defaultExpressMode?: boolean
  label?: string
  className?: string
  onCompleted?: (result: any) => void
}

/**
 * Universal Plug-and-Play RMA / Credit Memo Trigger Button.
 * Can be mounted in 1 line inside ANY module:
 * - Orders Table / OrderDetailModal
 * - Invoice Detail
 * - Customer Profile Purchase History
 * - Inbox / WABA Chat Order Sidebar
 * - Pipeline Kanban Deal Card
 */
export function RmaActionTrigger({
  order,
  defaultExpressMode = false,
  label = '🔄 Ajukan Retur / RMA',
  className = 'px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-extrabold rounded-xl text-xs transition cursor-pointer',
  onCompleted
}: RmaActionTriggerProps) {
  const [open, setOpen] = useState(false)

  const normStatus = String(order?.status || '').toLowerCase()
  if (!order?.id || ['cancelled', 'failed', 'pending'].includes(normStatus)) {
    return null
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <CreateRmaModal
        isOpen={open}
        onClose={() => setOpen(false)}
        order={order}
        defaultExpressMode={defaultExpressMode}
        onSuccess={(res) => {
          onCompleted?.(res)
        }}
      />
    </>
  )
}

