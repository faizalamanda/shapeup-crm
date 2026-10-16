"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { formatDisplayDate, DEFAULT_TIMEZONE } from '@/lib/timeUtils'

export function OrderDetailModal({
  order,
  onClose,
  timezone = DEFAULT_TIMEZONE,
}: {
  order: any
  onClose: () => void
  timezone?: string
}) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'items' | 'journal' | 'payments'>('items')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)

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

  // Extract orderId synchronously before async closure (AGENTS.md rule)
  useEffect(() => {
    const orderId = order?.id
    if (!orderId) return

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
          .eq('order_id', orderId)
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

    async function fetchPayments() {
      setLoadingPayments(true)
      try {
        const { data, error: payErr } = await supabase
          .from('order_payments')
          .select(`
            id,
            date,
            payment_kind,
            payment_method,
            amount,
            cash_received,
            change_amount,
            reference_number,
            notes,
            created_at,
            transaction_id,
            transactions (
              id,
              date
            ),
            pos_shifts (
              id,
              cashier_name
            )
          `)
          .eq('order_id', orderId)
          .order('created_at', { ascending: true })

        if (!payErr && data) {
          setPayments(data)
        }
      } catch (err) {
        console.warn('Error fetching order payments:', err)
      } finally {
        setLoadingPayments(false)
      }
    }

    setActiveTab('items')
    fetchJournal()
    fetchPayments()
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

    const kecamatan = m.find((i: any) => i.key === 'shipping_kecamatan')?.value || 
                      m.find((i: any) => i.key === 'billing_kecamatan')?.value || ""

    if (s.address_1) {
      return `${s.address_1}, ${s.address_2 ? s.address_2 + ', ' : ''}${kecamatan ? kecamatan + ', ' : ''}${s.city}, ${s.state} ${s.postcode || ''}`.trim()
    }

    if (order.customer?.address_data) {
      const addr = order.customer.address_data
      const parts = [
        addr.address_line1,
        addr.address_line2,
        addr.subdistrict,
        addr.city,
        addr.state,
        addr.postcode,
        addr.country
      ].filter(Boolean)
      if (parts.length > 0) return parts.join(', ')
    }
    
    return order.shipping_address || "Alamat tidak terbaca."
  }

  // Ambil Kurir & Resi
  const getCourierAndResi = () => {
    const raw = order.raw_source_data || {}
    const meta = raw.meta_data || []
    
    const courier = meta.find((m: any) => m.key === 'shapeup_kurir_awb')?.value || 
                    meta.find((m: any) => m.key === '_kurir_awb')?.value || ''
    
    const resi = meta.find((m: any) => m.key === 'shapeup_resi_awb')?.value || 
                 meta.find((m: any) => m.key === '_resi_awb')?.value || ''
    
    return { courier, resi }
  }

  const items = Array.isArray(order.items_json) ? order.items_json : []

  // Resolve Payment Status & Calculations
  const grandTotal = Number(order.grand_total) || 0
  const effectivePayStatus = (order.payment_status || (order.status === 'completed' ? 'paid' : 'unpaid')).toLowerCase()
  const amountPaid = order.amount_paid !== undefined 
    ? Number(order.amount_paid) 
    : (effectivePayStatus === 'paid' ? grandTotal : 0)
  const outstanding = Math.max(0, grandTotal - amountPaid)

  const paymentStatusColor = (status: string) => {
    if (status === 'paid') return { label: 'Lunas', bg: '#ECFDF5', color: '#059669', border: 'rgba(5, 150, 105, 0.2)' }
    if (status === 'partial') return { label: 'Sebagian / DP', bg: '#FFFBEB', color: '#D97706', border: 'rgba(217, 119, 6, 0.25)' }
    return { label: 'Belum Bayar', bg: '#FEF2F2', color: '#DC2626', border: 'rgba(220, 38, 38, 0.2)' }
  }

  const psc = paymentStatusColor(effectivePayStatus)

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[90vh] font-sans">
        
        {/* HEADER */}
        <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-0.5 rounded-sm uppercase tracking-widest inline-block border border-blue-100">
                Order Detail
              </span>
              <span 
                style={{ background: psc.bg, color: psc.color, border: `1px solid ${psc.border}` }}
                className="text-[10px] font-black px-2 py-0.5 rounded-sm uppercase tracking-wider inline-flex items-center gap-1"
              >
                {effectivePayStatus === 'paid' && <span>✓</span>}
                {psc.label}
              </span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-[#1a1c23] tracking-tight mb-1 uppercase italic">
              #{order.order_number || order.id}
            </h2>
            <div className="flex items-center gap-4 text-slate-400 text-xs">
              <span className="text-slate-800 font-bold">{order.customer?.name || 'Customer'}</span>
              <span className="h-3 w-[1px] bg-slate-200"></span>
              <span>{order.customer?.phone ? `+${order.customer.phone}` : '-'}</span>
              <span className="h-3 w-[1px] bg-slate-200"></span>
              <span>{formatDisplayDate(order.order_date, 'datetime', timezone)}</span>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-800 text-[11px] font-black border border-slate-200 px-3.5 py-1.5 rounded-sm transition-all uppercase hover:bg-slate-50"
          >
            Tutup [×]
          </button>
        </div>

        {/* BODY */}
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          
          {/* LEFT: Items, Ledger, Payments Tabs */}
          <div className="flex-1 p-6 md:p-8 overflow-y-auto border-r border-slate-100 bg-white">
            <div className="flex gap-6 border-b border-slate-100 pb-2 mb-6">
              <button 
                onClick={() => setActiveTab('items')}
                className={`text-[10px] font-black pb-2 uppercase tracking-widest transition-all ${
                  activeTab === 'items' ? 'border-b-2 border-yellow-500 text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Item Pesanan ({items.length})
              </button>
              <button 
                onClick={() => setActiveTab('payments')}
                className={`text-[10px] font-black pb-2 uppercase tracking-widest transition-all ${
                  activeTab === 'payments' ? 'border-b-2 border-yellow-500 text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Riwayat Pembayaran {payments.length > 0 && `(${payments.length})`}
              </button>
              <button 
                onClick={() => setActiveTab('journal')}
                className={`text-[10px] font-black pb-2 uppercase tracking-widest transition-all ${
                  activeTab === 'journal' ? 'border-b-2 border-yellow-500 text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Jurnal Akuntansi {transactions.length > 0 && `(${transactions.length})`}
              </button>
            </div>

            {/* TAB 1: ITEMS */}
            {activeTab === 'items' && (
              <div className="space-y-4">
                {items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-center p-4 border border-slate-100 rounded-sm hover:border-slate-200 transition-colors">
                    <div className="flex-1 pr-4">
                      <p className="text-xs font-black text-[#1a1c23] uppercase">{item.name}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded-sm font-black text-slate-600 border border-slate-200">
                          QTY: {item.quantity}
                        </span>
                        {item.sku && (
                          <span className="text-[9px] bg-slate-50 px-2 py-0.5 rounded-sm font-mono text-slate-500 border border-slate-200">
                            SKU: {item.sku}
                          </span>
                        )}
                        {Array.isArray(item.meta_data) && item.meta_data.map((m: any, idx: number) => (
                          typeof m.display_value === 'string' && !m.key.startsWith('_') && (
                            <span key={idx} className="text-[9px] text-orange-600 font-black uppercase italic">
                              / {m.display_value}
                            </span>
                          )
                        ))}
                      </div>
                    </div>
                    <p className="font-black text-sm text-[#1a1c23]">{formatIDR(item.subtotal || (Number(item.price || 0) * Number(item.quantity || 1)))}</p>
                  </div>
                ))}
              </div>
            )}

            {/* TAB 2: RIWAYAT PEMBAYARAN (Single Source of Truth: order_payments) */}
            {activeTab === 'payments' && (
              <div className="space-y-4">
                {loadingPayments ? (
                  <div className="text-center py-12 text-slate-400 text-xs font-semibold animate-pulse">
                    Memuat riwayat pembayaran...
                  </div>
                ) : payments.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-slate-200 rounded-sm p-6 bg-slate-50/50">
                    <div className="w-8 h-8 mx-auto mb-2 text-slate-300">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-xs text-slate-700 font-bold uppercase tracking-wider mb-1">
                      {effectivePayStatus === 'paid' ? 'Pesanan Tercatat Lunas' : 'Belum Ada Transaksi Pembayaran'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {effectivePayStatus === 'paid' 
                        ? `Pembayaran senilai ${formatIDR(grandTotal)} telah diakui melalui metode ${order.payment_method || 'Online / Gateway'}.`
                        : 'Belum ada bukti kas masuk yang dicatat untuk tagihan pesanan ini.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="border border-slate-200 rounded-sm overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FAFAF8] border-b border-slate-200 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          <tr>
                            <th className="py-2.5 px-3">Tanggal</th>
                            <th className="py-2.5 px-3">Jenis</th>
                            <th className="py-2.5 px-3">Metode</th>
                            <th className="py-2.5 px-3">Kasir / Shift</th>
                            <th className="py-2.5 px-3 text-right">Nominal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {payments.map((p: any) => {
                            const isOutflow = p.payment_kind === 'void' || p.payment_kind === 'refund'
                            return (
                              <tr key={p.id} className="hover:bg-slate-50/50">
                                <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                                  {formatDisplayDate(p.transactions?.date || p.created_at || p.date, 'datetime', timezone)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                    p.payment_kind === 'void' ? 'bg-red-50 text-red-700 border border-red-200' :
                                    p.payment_kind === 'refund' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                                    'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}>
                                    {p.payment_kind === 'void' ? 'Void' : p.payment_kind === 'refund' ? 'Refund' : 'Bayar'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-semibold uppercase text-slate-800">
                                  {p.payment_method}
                                  {p.reference_number && (
                                    <span className="block text-[9px] font-mono text-slate-400">Ref: {p.reference_number}</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                                  {p.pos_shifts?.cashier_name || p.notes || '-'}
                                </td>
                                <td className={`py-2.5 px-3 text-right font-black ${isOutflow ? 'text-red-600' : 'text-slate-900'}`}>
                                  {isOutflow ? `-${formatIDR(p.amount)}` : formatIDR(p.amount)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: JURNAL ITEM */}
            {activeTab === 'journal' && (
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
                            {formatDisplayDate(tx.date, 'datetime', timezone)}
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

          {/* RIGHT: Summary, Status & Shipping */}
          <div className="w-full md:w-[380px] bg-[#fbfbfb] p-6 md:p-8 space-y-6 overflow-y-auto">
            
            {/* ADDRESS */}
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Alamat Pengiriman</h3>
              <div className="bg-white p-4 border border-slate-200 rounded-sm shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-400"></div>
                <p className="text-xs font-bold text-slate-700 leading-relaxed italic uppercase">
                  {getAddressFromRaw()}
                </p>
              </div>
            </div>

            {/* COURIER & RESI */}
            {(() => {
              const { courier, resi } = getCourierAndResi()
              if (!courier && !resi) return null
              return (
                <div>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Informasi Pengiriman</h3>
                  <div className="bg-white p-4 border border-slate-200 rounded-sm shadow-sm relative overflow-hidden space-y-2">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                    {courier && (
                      <div className="text-xs">
                        <span className="text-slate-400 font-bold uppercase">Kurir:</span>{' '}
                        <span className="font-extrabold text-slate-800 uppercase">{courier}</span>
                      </div>
                    )}
                    {resi && (
                      <div className="text-xs">
                        <span className="text-slate-400 font-bold uppercase">No. Resi:</span>{' '}
                        <span className="font-mono font-extrabold text-slate-800 uppercase">{resi}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* STATUS INFO GRID (Metode + Status Order + Status Bayar) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white p-3 border border-slate-200 rounded-sm">
                <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Metode</p>
                <p className="text-[10px] font-black text-slate-800 uppercase truncate" title={order.payment_method || 'Manual'}>
                  {order.payment_method || 'Manual'}
                </p>
              </div>
              <div className="bg-white p-3 border border-slate-200 rounded-sm">
                <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Status Order</p>
                <p className="text-[10px] font-black text-blue-600 uppercase truncate" title={order.status}>
                  {order.status}
                </p>
              </div>
              <div className="bg-white p-3 border border-slate-200 rounded-sm">
                <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Status Bayar</p>
                <span 
                  style={{ background: psc.bg, color: psc.color, border: `1px solid ${psc.border}` }}
                  className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider inline-block truncate"
                >
                  {psc.label}
                </span>
              </div>
            </div>

            {/* TOTAL & FINANCIAL SETTLEMENT */}
            <div className="pt-4 border-t border-slate-200 space-y-2.5">
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
              <div className="pt-3 border-t-2 border-slate-900 flex justify-between items-center">
                <span className="text-[11px] font-black text-slate-900 uppercase">Grand Total</span>
                <span className="text-xl font-black text-blue-700">{formatIDR(order.grand_total)}</span>
              </div>

              {/* Real-time Settlement Status Card */}
              <div className="mt-3 p-3 bg-white border border-slate-200 rounded-sm shadow-sm space-y-2">
                <div className="flex justify-between items-center text-[10px] font-bold">
                  <span className="text-slate-500 uppercase tracking-wider">Sudah Terbayar</span>
                  <span className="text-emerald-700 font-black">{formatIDR(amountPaid)}</span>
                </div>
                {outstanding > 0 ? (
                  <div className="flex justify-between items-center text-[10px] font-bold pt-1.5 border-t border-slate-100">
                    <span className="text-amber-800 uppercase tracking-wider">Sisa Tagihan</span>
                    <span className="text-amber-600 font-black text-xs">{formatIDR(outstanding)}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[9px] font-black text-emerald-600 pt-1 border-t border-slate-100">
                    <span>✓ Tagihan telah lunas sepenuhnya</span>
                  </div>
                )}
              </div>
            </div>

            {/* ACTION BUTTON */}
            <div className="pt-2">
              <a 
                href={`https://wa.me/${order.customer?.phone || ''}`}
                target="_blank"
                rel="noreferrer"
                className="block w-full bg-[#1a1c23] text-white text-center py-3.5 rounded-sm font-black text-[10px] uppercase tracking-[0.2em] shadow-lg hover:bg-green-600 transition-all"
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