"use client"
import { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
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
  const [activeTab, setActiveTab] = useState<'items' | 'journal' | 'payments'>('items')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)

  // Extract orderId synchronously before async closure (AGENTS.md rule)
  useEffect(() => {
    const orderId = order?.id
    if (!orderId) {
      setTransactions([])
      setPayments([])
      return
    }

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

  if (!order) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  // 1. AMBIL ALAMAT (Bongkar Raw Data WooCommerce & Customer Address)
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
  const { courier, resi } = getCourierAndResi()
  const rawAddress = getAddressFromRaw()

  return (
    <FullScreenModal
      isOpen={Boolean(order)}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-slate-900 tracking-tight">
            Nota #{order.order_number || order.id}
          </span>
          <span 
            style={{ background: psc.bg, color: psc.color, border: `1px solid ${psc.border}` }}
            className="text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider inline-flex items-center gap-1"
          >
            {effectivePayStatus === 'paid' && <span>✓</span>}
            {psc.label}
          </span>
          {order.status && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
              {order.status}
            </span>
          )}
        </div>
      }
      description={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-0.5">
          <span className="font-bold text-slate-800">👤 {order.customer?.name || 'Customer'}</span>
          {order.customer?.phone && (
            <>
              <span className="text-slate-300">•</span>
              <span className="font-mono">📞 +{order.customer.phone}</span>
            </>
          )}
          <span className="text-slate-300">•</span>
          <span>📅 {formatDisplayDate(order.order_date_utc || order.order_date, 'datetime', timezone)}</span>
        </div>
      }
      desktopSize="xl"
      footer={
        <div className="flex items-center justify-between w-full flex-wrap gap-2">
          <div>
            {order.customer?.phone && (
              <a 
                href={`https://wa.me/${String(order.customer.phone).replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition shadow-xs"
              >
                <span>💬 Chat WhatsApp</span>
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button 
              type="button"
              onClick={onClose} 
              className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-extrabold rounded-xl text-xs transition"
            >
              Tutup
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col lg:flex-row gap-6 font-sans">
        
        {/* LEFT COLUMN: Tabs (Item Pesanan, Riwayat Pembayaran, Jurnal Akuntansi) */}
        <div className="flex-1 min-w-0 order-2 lg:order-1 space-y-4">
          
          {/* TAB BUTTONS (Touch-friendly Pills) */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3 overflow-x-auto no-scrollbar">
            <button 
              type="button"
              onClick={() => setActiveTab('items')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'items' 
                  ? 'bg-slate-900 text-white shadow-xs' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              Item Pesanan ({items.length})
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'payments' 
                  ? 'bg-slate-900 text-white shadow-xs' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              Riwayat Pembayaran {payments.length > 0 && `(${payments.length})`}
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab('journal')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all whitespace-nowrap ${
                activeTab === 'journal' 
                  ? 'bg-slate-900 text-white shadow-xs' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              Jurnal Akuntansi {transactions.length > 0 && `(${transactions.length})`}
            </button>
          </div>

          {/* TAB 1: ITEMS */}
          {activeTab === 'items' && (
            <div className="space-y-3">
              {items.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl bg-slate-50/50 p-6">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                    Tidak ada rincian item produk pada pesanan ini.
                  </p>
                </div>
              ) : (
                items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-start p-4 bg-white border border-slate-200/80 rounded-xl shadow-2xs hover:border-slate-300 transition-colors">
                    <div className="flex-1 pr-4 space-y-1">
                      <p className="text-xs font-extrabold text-slate-900">{item.name}</p>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-black text-slate-700 border border-slate-200">
                          QTY: {item.quantity}
                        </span>
                        {item.sku && (
                          <span className="text-[10px] bg-slate-50 px-2 py-0.5 rounded font-mono text-slate-600 border border-slate-200">
                            SKU: {item.sku}
                          </span>
                        )}
                        {Array.isArray(item.meta_data) && item.meta_data.map((m: any, idx: number) => (
                          typeof m.display_value === 'string' && !m.key.startsWith('_') && (
                            <span key={idx} className="text-[10px] text-orange-600 font-bold">
                              • {m.display_value}
                            </span>
                          )
                        ))}
                      </div>
                    </div>
                    <p className="font-extrabold text-sm text-slate-900 shrink-0">
                      {formatIDR(item.subtotal || (Number(item.price || 0) * Number(item.quantity || 1)))}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 2: RIWAYAT PEMBAYARAN */}
          {activeTab === 'payments' && (
            <div className="space-y-3">
              {loadingPayments ? (
                <div className="text-center py-12 text-slate-400 text-xs font-semibold animate-pulse">
                  Memuat riwayat pembayaran...
                </div>
              ) : payments.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl p-6 bg-slate-50/50">
                  <div className="w-8 h-8 mx-auto mb-2 text-slate-300">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-xs text-slate-700 font-bold uppercase tracking-wider mb-1">
                    {effectivePayStatus === 'paid' ? 'Pesanan Tercatat Lunas' : 'Belum Ada Transaksi Pembayaran'}
                  </p>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    {effectivePayStatus === 'paid' 
                      ? `Pembayaran senilai ${formatIDR(grandTotal)} telah diakui melalui metode ${order.payment_method || 'Online / Gateway'}.`
                      : 'Belum ada bukti kas masuk yang dicatat untuk tagihan pesanan ini.'}
                  </p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-2xs">
                  <table className="w-full text-left text-xs min-w-[500px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500 tracking-wider">
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
              )}
            </div>
          )}

          {/* TAB 3: JURNAL AKUNTANSI */}
          {activeTab === 'journal' && (
            <div className="space-y-4">
              {loading ? (
                <div className="space-y-4 animate-pulse">
                  {[1, 2].map((n) => (
                    <div key={n} className="p-4 border border-slate-200 rounded-xl space-y-3">
                      <div className="h-4 w-1/3 bg-slate-200 rounded"></div>
                      <div className="h-8 bg-slate-100 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold">
                  {error}
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl p-6 bg-slate-50/50">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                    Tidak ada catatan jurnal untuk pesanan ini.
                  </p>
                </div>
              ) : (
                transactions.map((tx: any) => {
                  const totalDebit = tx.journal_lines?.reduce((acc: number, line: any) => acc + (Number(line.debit) || 0), 0) || 0
                  const totalCredit = tx.journal_lines?.reduce((acc: number, line: any) => acc + (Number(line.credit) || 0), 0) || 0

                  return (
                    <div key={tx.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                      {/* Transaction Header */}
                      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center flex-wrap gap-2">
                        <div>
                          <span className="text-[10px] font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded uppercase tracking-wider border border-blue-200">
                            Ledger Transaction
                          </span>
                          <h4 className="text-xs font-extrabold text-slate-800 uppercase mt-1">
                            {tx.description}
                          </h4>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 font-mono">
                          {formatDisplayDate(tx.date, 'datetime', timezone)}
                        </span>
                      </div>

                      {/* Journal Lines Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs min-w-[460px]">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider text-[10px] bg-slate-50/50">
                              <th className="py-2.5 px-4">Akun</th>
                              <th className="py-2.5 px-4 text-right">Debit</th>
                              <th className="py-2.5 px-4 text-right">Kredit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {tx.journal_lines?.map((line: any) => {
                              const isCredit = (Number(line.credit) || 0) > 0 && (Number(line.debit) || 0) === 0
                              return (
                                <tr key={line.id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="py-2.5 px-4">
                                    <div className={`flex items-center gap-2 ${isCredit ? 'pl-5' : ''}`}>
                                      <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                        {line.accounts?.code || '-'}
                                      </span>
                                      <span className={`font-bold text-slate-800 ${isCredit ? 'italic text-slate-600' : ''}`}>
                                        {line.accounts?.name || 'Akun Tidak Dikenal'}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-black text-slate-900 font-mono">
                                    {line.debit > 0 ? formatIDR(line.debit) : '-'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-black text-slate-900 font-mono">
                                    {line.credit > 0 ? formatIDR(line.credit) : '-'}
                                  </td>
                                </tr>
                              )
                            })}
                            
                            {/* Total Row */}
                            <tr className="border-t-2 border-slate-200 font-bold bg-slate-50/40">
                              <td className="py-2.5 px-4 text-right text-slate-500 uppercase text-[10px] tracking-wider font-extrabold">
                                Total
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-900 font-black font-mono border-b-2 border-slate-900">
                                {formatIDR(totalDebit)}
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-900 font-black font-mono border-b-2 border-slate-900">
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

        {/* RIGHT COLUMN: Summary, Financial Settlement & Logistics */}
        <div className="w-full lg:w-[360px] lg:shrink-0 space-y-4 order-1 lg:order-2">
          
          {/* TOTAL & FINANCIAL SETTLEMENT CARD */}
          <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3 shadow-2xs">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
              Ringkasan Pembayaran
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-500 font-medium">
                <span>Subtotal</span>
                <span className="text-slate-800 font-mono">{formatIDR(order.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500 font-medium">
                <span>Ongkos Kirim</span>
                <span className="text-slate-800 font-mono">{formatIDR(order.shipping_cost)}</span>
              </div>
              {Number(order.discount_amount) > 0 && (
                <div className="flex justify-between items-center text-red-500 font-medium">
                  <span>Diskon</span>
                  <span className="font-mono">-{formatIDR(order.discount_amount)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                <span className="text-xs font-black text-slate-900 uppercase">Grand Total</span>
                <span className="text-base font-black text-blue-700 font-mono">{formatIDR(grandTotal)}</span>
              </div>
            </div>

            {/* Settlement Status Pill / Sub-card */}
            <div className="pt-2 border-t border-slate-200/70 space-y-1.5">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-slate-500 uppercase tracking-wider text-[10px]">Sudah Terbayar</span>
                <span className="text-emerald-700 font-black font-mono">{formatIDR(amountPaid)}</span>
              </div>
              {outstanding > 0 ? (
                <div className="flex justify-between items-center text-xs font-bold pt-1.5 border-t border-slate-200">
                  <span className="text-amber-800 uppercase tracking-wider text-[10px]">Sisa Tagihan</span>
                  <span className="text-amber-600 font-black font-mono">{formatIDR(outstanding)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 pt-1 border-t border-slate-200">
                  <span>✓ Tagihan telah lunas sepenuhnya</span>
                </div>
              )}
            </div>
          </div>

          {/* STATUS INFO GRID (Metode + Status Order + Status Bayar) */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white p-3 border border-slate-200/80 rounded-xl shadow-2xs">
              <p className="text-[8px] text-slate-400 font-bold uppercase mb-1">Metode</p>
              <p className="text-[10px] font-extrabold text-slate-800 uppercase truncate" title={order.payment_method || 'Manual'}>
                {order.payment_method || 'Manual'}
              </p>
            </div>
            <div className="bg-white p-3 border border-slate-200/80 rounded-xl shadow-2xs">
              <p className="text-[8px] text-slate-400 font-bold uppercase mb-1">Status Order</p>
              <p className="text-[10px] font-extrabold text-blue-600 uppercase truncate" title={order.status}>
                {order.status}
              </p>
            </div>
            <div className="bg-white p-3 border border-slate-200/80 rounded-xl shadow-2xs">
              <p className="text-[8px] text-slate-400 font-bold uppercase mb-1">Status Bayar</p>
              <span 
                style={{ background: psc.bg, color: psc.color, border: `1px solid ${psc.border}` }}
                className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider inline-block truncate"
              >
                {psc.label}
              </span>
            </div>
          </div>

          {/* COURIER & RESI CARD */}
          {(courier || resi) && (
            <div className="bg-white p-4 border border-slate-200/80 rounded-xl shadow-2xs space-y-2">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Informasi Ekspedisi
              </h3>
              <div className="space-y-1 text-xs">
                {courier && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-medium">Kurir:</span>
                    <span className="font-extrabold text-slate-800 uppercase">{courier}</span>
                  </div>
                )}
                {resi && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-medium">No. Resi:</span>
                    <span className="font-mono font-extrabold text-slate-800">{resi}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SHIPPING ADDRESS */}
          <div className="bg-white p-4 border border-slate-200/80 rounded-xl shadow-2xs space-y-1.5">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
              Alamat Pengiriman
            </h3>
            <p className="text-xs text-slate-700 leading-relaxed">
              {rawAddress}
            </p>
          </div>

        </div>

      </div>
    </FullScreenModal>
  )
}