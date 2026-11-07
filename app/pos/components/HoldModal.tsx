"use client"
import { useState, useMemo } from 'react'
import { formatDisplayDate } from '@/lib/timeUtils'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

type Props = {
  isOpen: boolean
  onClose: () => void
  heldOrders: any[]
  onResumeCart: (heldOrder: any) => void
  onDeleteHold: (holdId: string) => Promise<void>
  timezone?: string
  onPrintHoldOrder?: (heldOrder: any) => void
  onPrintHeldOrdersSummary?: (heldOrders: any[]) => void
  onPrintKitchenTicket?: (heldOrder: any) => void
}

export default function HoldModal({
  isOpen,
  onClose,
  heldOrders,
  onResumeCart,
  onDeleteHold,
  timezone,
  onPrintHoldOrder,
  onPrintHeldOrdersSummary,
  onPrintKitchenTicket
}: Props) {
  useModalBackHandler(isOpen, onClose)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredHeldOrders = useMemo(() => {
    if (!searchQuery.trim()) return heldOrders
    const q = searchQuery.toLowerCase().trim()
    return heldOrders.filter((h) => {
      const shortId = `#hld-${(h.id || '').slice(0, 6).toLowerCase()}`
      const rawId = (h.id || '').toLowerCase()
      const customer = (h.customer_name || '').toLowerCase()
      const note = (h.note || '').toLowerCase()
      return shortId.includes(q) || rawId.includes(q) || customer.includes(q) || note.includes(q)
    })
  }, [heldOrders, searchQuery])

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

  const handlePrintSingle = (e: React.MouseEvent, h: any) => {
    e.stopPropagation()
    if (onPrintHoldOrder) {
      onPrintHoldOrder(h)
    }
  }

  const handlePrintSummary = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onPrintHeldOrdersSummary && heldOrders.length > 0) {
      onPrintHeldOrdersSummary(heldOrders)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 text-lg">Transaksi Ditahan</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
                {heldOrders.length}
              </span>
            </div>
            <p className="text-xs text-gray-500">Pilih draft transaksi, cari no. nota, atau cetak bill</p>
          </div>
          <div className="flex items-center gap-2">
            {onPrintHeldOrdersSummary && heldOrders.length > 0 && (
              <button
                type="button"
                onClick={handlePrintSummary}
                title="Cetak Rekap Seluruh Pesanan Ditahan"
                className="py-1.5 px-3 bg-white border border-gray-200 hover:border-indigo-500 hover:text-indigo-600 text-gray-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
              >
                <span>🖨️</span>
                <span>Cetak Rekap</span>
              </button>
            )}
            <button 
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-gray-700 flex items-center justify-center transition cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {heldOrders.length > 0 && (
          <div className="px-5 py-2.5 border-b border-gray-100 bg-gray-50/40">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400 text-xs">
                🔍
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari No. Nota (#HLD-...), nama pelanggan, atau catatan..."
                className="w-full pl-8 pr-8 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-gray-400 hover:text-gray-600 text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

        {/* List */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {heldOrders.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs">
              <div className="text-3xl mb-2">📥</div>
              Tidak ada transaksi yang sedang ditahan.
            </div>
          ) : filteredHeldOrders.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs space-y-2">
              <div className="text-3xl mb-1">🔍</div>
              <div>Tidak ada transaksi yang cocok dengan <b>"{searchQuery}"</b></div>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs text-indigo-600 hover:underline font-medium cursor-pointer"
              >
                Reset Pencarian
              </button>
            </div>
          ) : (
            filteredHeldOrders.map((h) => {
              const shortId = `#HLD-${(h.id || '').slice(0, 6).toUpperCase()}`
              return (
                <div
                  key={h.id}
                  onClick={() => {
                    onResumeCart(h)
                    onClose()
                  }}
                  className="p-3.5 border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50/30 rounded-xl transition cursor-pointer flex items-center justify-between group gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded border border-slate-200">
                        {shortId}
                      </span>
                      <span className="font-bold text-gray-900 text-sm truncate">
                        {h.customer_name || 'Walk-in'}
                      </span>
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                        {h.total_items || (h.cart_json ? h.cart_json.length : 0)} Item
                      </span>
                    </div>
                    {h.note && (
                      <div className="text-xs text-gray-500 italic truncate max-w-sm">
                        "{h.note}"
                      </div>
                    )}
                    <div className="text-[11px] text-gray-400">
                      Ditahan: {formatDisplayDate(h.created_at, 'time', timezone)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 text-right shrink-0">
                    <div>
                      <div className="text-sm font-extrabold text-indigo-950">
                        Rp {Number(h.grand_total || 0).toLocaleString('id-ID')}
                      </div>
                      <span className="text-[10px] text-indigo-600 font-medium group-hover:underline block">
                        Lanjutkan →
                      </span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      {onPrintKitchenTicket && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onPrintKitchenTicket(h)
                          }}
                          title="Cetak Nota Dapur &amp; Bar (Kitchen Chit)"
                          className="p-2 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                        >
                          🍳
                        </button>
                      )}
                      {onPrintHoldOrder && (
                        <button
                          type="button"
                          onClick={(e) => handlePrintSingle(e, h)}
                          title="Cetak Bill Sementara (Slip Hold)"
                          className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                        >
                          🖨️
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, h.id)}
                        disabled={deletingId === h.id}
                        title="Hapus Draft"
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer disabled:opacity-50"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
          <div className="text-[11px] text-gray-500">
            {heldOrders.length > 0 && (
              <span>
                Total Nilai: <strong className="text-gray-800">Rp {heldOrders.reduce((sum, h) => sum + Number(h.grand_total || 0), 0).toLocaleString('id-ID')}</strong>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 border border-gray-300 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}
