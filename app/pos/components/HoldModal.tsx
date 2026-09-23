"use client"
import { useState } from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
  heldOrders: any[]
  onResumeCart: (heldOrder: any) => void
  onDeleteHold: (holdId: string) => Promise<void>
}

export default function HoldModal({ isOpen, onClose, heldOrders, onResumeCart, onDeleteHold }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (!isOpen) return null

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await onDeleteHold(id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">Transaksi Ditahan (Hold)</h3>
            <p className="text-xs text-gray-500">Pilih draft transaksi untuk dilanjutkan ke kasir</p>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-gray-700 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* List */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {heldOrders.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs">
              <div className="text-3xl mb-2">📥</div>
              Tidak ada transaksi yang sedang ditahan.
            </div>
          ) : (
            heldOrders.map((h) => (
              <div
                key={h.id}
                onClick={() => {
                  onResumeCart(h)
                  onClose()
                }}
                className="p-4 border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50/30 rounded-xl transition cursor-pointer flex items-center justify-between group"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900 text-sm">{h.customer_name || 'Walk-in'}</span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                      {h.total_items || (h.cart_json ? h.cart_json.length : 0)} Item
                    </span>
                  </div>
                  {h.note && <div className="text-xs text-gray-500 italic">"{h.note}"</div>}
                  <div className="text-[11px] text-gray-400">
                    Ditahan: {new Date(h.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-right">
                  <div>
                    <div className="text-sm font-extrabold text-indigo-950">
                      Rp {Number(h.grand_total || 0).toLocaleString('id-ID')}
                    </div>
                    <span className="text-[10px] text-indigo-600 font-medium group-hover:underline">
                      Resume Cart →
                    </span>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, h.id)}
                    disabled={deletingId === h.id}
                    title="Hapus Draft"
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 text-right">
          <button
            onClick={onClose}
            className="py-2.5 px-4 border border-gray-300 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs transition"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}
