"use client"
import React, { useState } from 'react'
import { KitchenTicketData } from '@/lib/pos/kitchenTicketBuilder'
import { dispatchAllKitchenTickets, printSingleKitchenTicket } from '@/lib/pos/kitchenPrinterDispatcher'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

interface Props {
  isOpen: boolean
  onClose: () => void
  tickets: KitchenTicketData[]
}

export default function KitchenTicketPreviewModal({ isOpen, onClose, tickets }: Props) {
  useModalBackHandler(isOpen, onClose)

  const [activeTab, setActiveTab] = useState<number>(0)
  const [isPrinting, setIsPrinting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  if (!isOpen || !tickets || tickets.length === 0) return null

  const currentTicket = tickets[activeTab] || tickets[0]

  const handlePrintAll = async () => {
    setIsPrinting(true)
    setStatusMessage(null)
    try {
      const res = await dispatchAllKitchenTickets(tickets)
      setStatusMessage(res.message)
      if (res.success) {
        setTimeout(() => {
          onClose()
        }, 1200)
      }
    } catch (err: any) {
      setStatusMessage('Gagal mencetak: ' + (err.message || 'Terjadi kesalahan'))
    } finally {
      setIsPrinting(false)
    }
  }

  const handlePrintCurrent = async () => {
    if (!currentTicket) return
    setIsPrinting(true)
    setStatusMessage(null)
    try {
      const res = await printSingleKitchenTicket(currentTicket)
      setStatusMessage(res.message || `✓ Nota ${currentTicket.stationName} berhasil dikirim.`)
      if (res.success && tickets.length === 1) {
        setTimeout(() => {
          onClose()
        }, 1200)
      }
    } catch (err: any) {
      setStatusMessage('Gagal mencetak: ' + (err.message || 'Terjadi kesalahan'))
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto no-print">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col max-h-[92vh] border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍳</span>
            <div>
              <h3 className="font-bold text-sm leading-tight text-white">Preview Nota Produksi (Dapur &amp; Bar)</h3>
              <p className="text-[11px] text-slate-300">
                {tickets.length} Stasiun Terdeteksi &bull; Tanpa Harga Moneter
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer text-sm"
          >
            ✕
          </button>
        </div>

        {/* Station Tabs (if multi-station) */}
        {tickets.length > 1 && (
          <div className="px-3 pt-2 bg-slate-100 border-b border-slate-200 flex gap-1.5 overflow-x-auto">
            {tickets.map((t, idx) => {
              const isActive = activeTab === idx
              return (
                <button
                  key={t.stationId}
                  type="button"
                  onClick={() => {
                    setActiveTab(idx)
                    setStatusMessage(null)
                  }}
                  className={`px-3 py-2 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap border-t border-x ${
                    isActive
                      ? 'bg-white text-slate-900 border-slate-200 border-b-transparent shadow-xs'
                      : 'bg-slate-200/60 text-slate-600 hover:bg-slate-200 border-transparent'
                  }`}
                >
                  <span>{t.stationIcon}</span>
                  <span>{t.stationName}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isActive ? 'bg-slate-900 text-white' : 'bg-slate-300 text-slate-700'
                  }`}>
                    {t.items.reduce((acc, it) => acc + it.quantity, 0)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Thermal Chit Preview Area */}
        <div className="p-4 overflow-y-auto flex-1 bg-slate-100/60 flex justify-center">
          <div className="w-full max-w-[340px] bg-white rounded-lg shadow-md border border-slate-300/80 p-3.5 font-mono text-slate-950 text-xs select-none">
            
            {/* Reprint Banner */}
            {currentTicket.isReprint && (
              <div className="text-center border-2 border-black font-black text-xs py-1 mb-2 tracking-wider">
                *** CETAK ULANG (REPRINT) ***
              </div>
            )}

            {/* Station Banner */}
            <div className="text-center border-2 border-black py-1.5 px-1 mb-2">
              <div className="text-[10px] font-bold tracking-widest text-slate-600">NOTA PRODUKSI F&amp;B</div>
              <div className="text-base font-black tracking-wide leading-tight">
                [ {currentTicket.stationLabel} ]
              </div>
              <div className="text-[10px] font-bold mt-0.5">
                STATUS: {currentTicket.ticketKind === 'ADD-ON' ? 'TAMBAHAN (ADD-ON)' : currentTicket.ticketKind === 'HOLD' ? 'PESANAN MEJA (HOLD)' : 'PESANAN BARU'}
              </div>
            </div>

            {/* Giant Table or Queue Banner */}
            {currentTicket.tableNumber && (
              <div className="text-center bg-black text-white py-1.5 px-1 my-1 rounded-xs">
                <div className="text-lg font-black tracking-wider leading-tight">
                  {currentTicket.tableNumber}
                </div>
                <div className="text-[10px] font-bold tracking-widest text-slate-200">
                  TIPE: {currentTicket.orderType}
                </div>
              </div>
            )}

            {currentTicket.queueNumber && (
              <div className="text-center border border-black py-1 my-1">
                <span className="text-[10px] font-bold">NO. ANTREAN: </span>
                <span className="text-base font-black">#{currentTicket.queueNumber}</span>
              </div>
            )}

            {/* Meta */}
            <div className="text-[11px] my-2 leading-relaxed border-t border-b border-black py-1">
              <div className="flex justify-between">
                <span>Waktu Masuk:</span>
                <span className="font-bold">{currentTicket.timestamp}</span>
              </div>
              <div className="flex justify-between">
                <span>No. Ref:</span>
                <span className="font-bold">{currentTicket.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Server/Kasir:</span>
                <span>{currentTicket.cashierOrServer}</span>
              </div>
              {currentTicket.customerName && currentTicket.customerName !== 'Pelanggan Walk-in' && (
                <div className="flex justify-between">
                  <span>Tamu:</span>
                  <span className="font-bold">{currentTicket.customerName}</span>
                </div>
              )}
            </div>

            {/* Item List Header */}
            <div className="text-[11px] font-black tracking-wider my-1">
              QTY &nbsp; MENU &amp; INSTRUKSI MASAK
            </div>
            <div className="border-t border-dashed border-black mb-2" />

            {/* Items */}
            <div className="space-y-2">
              {currentTicket.items.map((it, i) => (
                <div key={i} className="border-b border-dotted border-slate-300 pb-1.5">
                  <div className="flex items-baseline gap-1 font-black text-sm text-black">
                    <span className="inline-block min-w-[24px] text-indigo-700">{it.quantity}x</span>
                    <span className="uppercase">{it.name}</span>
                  </div>
                  {it.modifiers && it.modifiers.map((m, mi) => (
                    <div key={mi} className="pl-6 text-[11px] font-bold text-slate-800 uppercase">
                      * {m.option}
                    </div>
                  ))}
                  {it.note && (
                    <div className="pl-6 text-[11px] font-bold italic text-rose-700">
                      Note: {it.note}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Global Order Note */}
            {currentTicket.globalOrderNote && (
              <div className="mt-3 border-2 border-dashed border-black p-2 bg-slate-50">
                <div className="text-[10px] font-black uppercase text-slate-600">Catatan Khusus Meja:</div>
                <div className="text-xs font-black text-black mt-0.5">
                  &gt;&gt; {currentTicket.globalOrderNote} &lt;&lt;
                </div>
              </div>
            )}

            <div className="border-t-2 border-black mt-3 pt-1 text-center text-[10px] font-bold tracking-widest text-slate-500">
              -- AKHIR INSTRUKSI DAPUR --
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-100 bg-white space-y-2">
          {statusMessage && (
            <div className={`p-2.5 rounded-xl text-xs font-medium text-center ${
              statusMessage.startsWith('✓')
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}>
              {statusMessage}
            </div>
          )}

          <div className="flex gap-2">
            {tickets.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={handlePrintCurrent}
                  disabled={isPrinting}
                  className="flex-1 py-2.5 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>🖨️</span>
                  <span>Cetak {currentTicket.stationName} Saja</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintAll}
                  disabled={isPrinting}
                  className="flex-1 py-2.5 px-3 bg-slate-950 hover:bg-black text-white rounded-xl font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>🖨️</span>
                  <span>{isPrinting ? 'Mencetak...' : `Cetak Semua (${tickets.length} Stasiun)`}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handlePrintCurrent}
                disabled={isPrinting}
                className="w-full py-2.5 px-4 bg-slate-950 hover:bg-black text-white rounded-xl font-bold text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>🖨️</span>
                <span>{isPrinting ? 'Mencetak...' : 'Cetak Nota Dapur Sekarang'}</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

