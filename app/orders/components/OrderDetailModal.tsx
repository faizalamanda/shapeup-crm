"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'

export function OrderDetailModal({ order, onClose }: { order: any, onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'items' | 'journal'>('items')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<any[]>([])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (order) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [order])

  useEffect(() => {
    if (!order?.id) return

    async function fetchJournal() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: fetchErr } = await supabase
          .from('transactions')
          .select(`
            id,
            date,
            description,
            journal_lines (
              id,
              debit,
              credit,
              accounts (
                id,
                code,
                name,
                type
              )
            )
          `)
          .eq('order_id', order.id)
          .order('date', { ascending: true })

        if (fetchErr) throw fetchErr
        setTransactions(data || [])
      } catch (err: any) {
        console.error('Error fetching journal lines:', err)
        setError(err.message || 'Gagal memuat data jurnal')
      } finally {
        setLoading(false)
      }
    }

    setActiveTab('items')
    fetchJournal()
  }, [order?.id])

  if (!order || !mounted) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  // 1. AMBIL ALAMAT (Bongkar Raw Data WooCommerce Mas)
  const getAddressFromRaw = () => {
    const raw = order.raw_source_data || {}
    const s = raw.shipping || {}
    const m = raw.meta_data || []

    // Cari Kecamatan dari meta_data
    const kecamatan = m.find((i: any) => i.key === 'shipping_kecamatan')?.value || 
                      m.find((i: any) => i.key === 'billing_kecamatan')?.value || ""

    if (s.address_1) {
      return `${s.address_1}, ${s.address_2 ? s.address_2 + ', ' : ''}${kecamatan ? kecamatan + ', ' : ''}${s.city}, ${s.state} ${s.postcode || ''}`.trim()
    }
    
    return order.shipping_address || "Alamat tidak terbaca."
  }

  const items = Array.isArray(order.items_json) ? order.items_json : []

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[90vh] font-sans">
        
        {/* HEADER */}
        <div className="p-8 md:p-10 border-b border-slate-100 flex justify-between items-start">
          <div>
            <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-1 rounded-sm uppercase tracking-widest mb-4 inline-block">
              Order Detail
            </span>
            <h2 className="text-3xl md:text-4xl font-black text-[#1a1c23] tracking-tight mb-2 uppercase italic">
              #{order.order_number || order.id}
            </h2>
            <div className="flex items-center gap-4 text-slate-400 text-sm">
              <span className="text-slate-800 font-bold">{order.customer?.name || 'Customer'}</span>
              <span className="h-4 w-[1px] bg-slate-200"></span>
              <span>{order.customer?.phone || '-'}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-[10px] font-black border border-slate-100 px-4 py-2 rounded-sm transition-all uppercase">
            [ Close ]
          </button>
        </div>

        {/* BODY */}
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          
          {/* LEFT: Items List */}
          <div className="flex-1 p-6 md:p-10 overflow-y-auto border-r border-slate-50 bg-white">
            <div className="flex gap-8 border-b border-slate-100 pb-2 mb-6">
              <button 
                onClick={() => setActiveTab('items')}
                className={`text-[10px] font-black pb-2 uppercase tracking-widest transition-all ${
                  activeTab === 'items' ? 'border-b-2 border-yellow-500 text-slate-800' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Item Pesanan
              </button>
              <button 
                onClick={() => setActiveTab('journal')}
                className={`text-[10px] font-black pb-2 uppercase tracking-widest transition-all ${
                  activeTab === 'journal' ? 'border-b-2 border-yellow-500 text-slate-800' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Jurnal Item
              </button>
            </div>

            {activeTab === 'items' ? (
              <div className="space-y-4">
                {items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-center p-5 border border-slate-100 rounded-sm">
                    <div className="flex-1 pr-4">
                      <p className="text-xs font-black text-[#1a1c23] uppercase">{item.name}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                          <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded-sm font-black text-slate-500 border border-slate-200">QTY: {item.quantity}</span>
                          {/* SAFE RENDER: Hanya cetak display_value jika dia STRING */}
                          {Array.isArray(item.meta_data) && item.meta_data.map((m: any, idx: number) => (
                             typeof m.display_value === 'string' && !m.key.startsWith('_') && (
                               <span key={idx} className="text-[9px] text-orange-600 font-black uppercase italic">/ {m.display_value}</span>
                             )
                          ))}
                      </div>
                    </div>
                    <p className="font-black text-sm text-[#1a1c23]">{formatIDR(item.subtotal)}</p>
                  </div>
                ))}
              </div>
            ) : (
              /* JOURNAL ITEMS TAB */
              <div className="space-y-6">
                {loading ? (
                  <div className="space-y-6 animate-pulse">
                    {[1, 2].map((n) => (
                      <div key={n} className="p-6 border border-slate-100 rounded-sm space-y-4">
                        <div className="flex justify-between items-center">
                          <div className="h-4 w-1/3 bg-slate-200 rounded"></div>
                          <div className="h-3 w-1/4 bg-slate-100 rounded"></div>
                        </div>
                        <div className="space-y-2 pt-2">
                          <div className="h-10 bg-slate-50 rounded"></div>
                          <div className="h-10 bg-slate-50 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : error ? (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-sm text-red-600 text-xs font-semibold">
                    {error}
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-slate-200 rounded-sm">
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Tidak ada catatan jurnal untuk pesanan ini.</p>
                  </div>
                ) : (
                  transactions.map((tx: any) => {
                    const totalDebit = tx.journal_lines?.reduce((acc: number, line: any) => acc + (Number(line.debit) || 0), 0) || 0
                    const totalCredit = tx.journal_lines?.reduce((acc: number, line: any) => acc + (Number(line.credit) || 0), 0) || 0

                    return (
                      <div key={tx.id} className="border border-slate-200 rounded-sm overflow-hidden bg-white shadow-sm">
                        {/* Transaction Header */}
                        <div className="bg-[#fbfbfb] px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                          <div>
                            <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-sm uppercase tracking-wider border border-blue-100">
                              Ledger Transaction
                            </span>
                            <h4 className="text-xs font-black text-slate-800 uppercase mt-1">
                              {tx.description}
                            </h4>
                          </div>
                          <span className="text-[10px] font-bold text-slate-400">
                            {new Date(tx.date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>

                        {/* Journal Lines Table */}
                        <div className="p-6">
                          <table className="w-full text-left border-collapse text-xs font-sans">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                                <th className="py-2 pb-3 pr-4">Akun</th>
                                <th className="py-2 pb-3 px-4 text-right">Debit</th>
                                <th className="py-2 pb-3 pl-4 text-right">Kredit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tx.journal_lines?.map((line: any) => {
                                const isCredit = (Number(line.credit) || 0) > 0 && (Number(line.debit) || 0) === 0
                                return (
                                  <tr key={line.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                    <td className="py-3 pr-4">
                                      <div className={`flex items-center gap-2 ${isCredit ? 'pl-6' : ''}`}>
                                        <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                          {line.accounts?.code || '-'}
                                        </span>
                                        <span className={`font-bold text-slate-800 uppercase ${isCredit ? 'italic text-slate-500' : ''}`}>
                                          {line.accounts?.name || 'Akun Tidak Dikenal'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4 text-right font-black text-slate-900">
                                      {line.debit > 0 ? formatIDR(line.debit) : '-'}
                                    </td>
                                    <td className="py-3 pl-4 text-right font-black text-slate-900">
                                      {line.credit > 0 ? formatIDR(line.credit) : '-'}
                                    </td>
                                  </tr>
                                )
                              })}
                              
                              {/* Total Row */}
                              <tr className="border-t border-slate-300 font-bold bg-slate-50/30">
                                <td className="py-3 text-right pr-4 text-slate-400 uppercase text-[9px] tracking-wider font-black">
                                  Total
                                </td>
                                <td className="py-3 px-4 text-right text-slate-900 border-b-4 border-double border-slate-900 font-black">
                                  {formatIDR(totalDebit)}
                                </td>
                                <td className="py-3 pl-4 text-right text-slate-900 border-b-4 border-double border-slate-900 font-black">
                                  {formatIDR(totalCredit)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Summary & Shipping */}
          <div className="w-full md:w-[380px] bg-[#fbfbfb] p-6 md:p-10 space-y-8 overflow-y-auto">
            
            {/* ADDRESS */}
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Alamat Pengiriman</h3>
              <div className="bg-white p-6 border border-slate-200 rounded-sm shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-400"></div>
                <p className="text-xs font-bold text-slate-700 leading-relaxed italic uppercase">
                  {getAddressFromRaw()}
                </p>
              </div>
            </div>

            {/* INFO */}
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-white p-4 border border-slate-200">
                    <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Payment</p>
                    <p className="text-[10px] font-black text-slate-800 uppercase">{order.payment_method || 'BACS'}</p>
                </div>
                <div className="bg-white p-4 border border-slate-200">
                    <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Status</p>
                    <p className="text-[10px] font-black text-blue-600 uppercase">{order.status}</p>
                </div>
            </div>

            {/* TOTAL */}
            <div className="pt-6 border-t border-slate-200 space-y-3">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400">
                <span>Subtotal</span>
                <span className="text-slate-700">{formatIDR(order.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400">
                <span>Ongkir</span>
                <span className="text-slate-700">{formatIDR(order.shipping_cost)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-red-400">
                <span>Diskon</span>
                <span>-{formatIDR(order.discount_amount)}</span>
              </div>
              <div className="pt-5 border-t-2 border-slate-900 flex justify-between items-center">
                <span className="text-[11px] font-black text-slate-900 uppercase">Total</span>
                <span className="text-xl font-black text-blue-700">{formatIDR(order.grand_total)}</span>
              </div>
            </div>

            <div className="pt-4">
                <a 
                    href={`https://wa.me/${order.customer?.phone || ''}`}
                    target="_blank"
                    className="block w-full bg-[#1a1c23] text-white text-center py-4 rounded-sm font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-green-600 transition-all"
                >
                    Chat WhatsApp
                </a>
            </div>

          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}