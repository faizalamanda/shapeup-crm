"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'

type Account = {
  id: string
  code: string
  name: string
  type: string
}

type PurchaseItem = {
  product_id?: string
  name: string
  quantity: number
  price: number
  is_physical: boolean
}

type Purchase = {
  id: string
  business_id: string
  transaction_id: string | null
  supplier_id: string | null
  purchase_number: string
  date: string
  due_date: string | null
  subtotal: number
  discount_amount: number
  other_fees: number
  grand_total: number
  amount_paid: number
  payment_status: 'unpaid' | 'partial' | 'paid'
  items_json: PurchaseItem[]
  attachment_url: string | null
  suppliers?: { id: string; name: string } | null
}

interface PurchaseDetailModalProps {
  purchase: Purchase
  accounts: Account[]
  onClose: () => void
}

export function PurchaseDetailModal({ purchase, accounts, onClose }: PurchaseDetailModalProps) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'journal'>('details')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (purchase) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [purchase])

  // Fetch payments and journal entries when purchase changes
  useEffect(() => {
    if (!purchase?.id) return

    async function fetchPurchaseDetails() {
      setLoading(true)
      setPaymentsLoading(true)
      setError(null)

      try {
        // 1. Fetch payment logs for this purchase
        const { data: payData, error: payErr } = await supabase
          .from('purchase_payments')
          .select('*')
          .eq('purchase_id', purchase.id)
          .order('date', { ascending: true })

        if (payErr) throw payErr
        setPayments(payData || [])
        setPaymentsLoading(false)

        // 2. Resolve transaction IDs (main purchase tx + payment txs)
        const txIds = [purchase.transaction_id].filter(Boolean) as string[]
        if (payData) {
          payData.forEach(p => {
            if (p.transaction_id) txIds.push(p.transaction_id)
          })
        }

        if (txIds.length === 0) {
          setTransactions([])
          return
        }

        // 3. Fetch transactions and their journal lines
        const { data: txData, error: txErr } = await supabase
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
          .in('id', txIds)
          .order('date', { ascending: true })

        if (txErr) throw txErr
        setTransactions(txData || [])
      } catch (err: any) {
        console.error('Error fetching details for purchase:', err)
        setError(err.message || 'Gagal memuat data detail pembelian')
      } finally {
        setLoading(false)
        setPaymentsLoading(false)
      }
    }

    setActiveTab('details')
    fetchPurchaseDetails()
  }, [purchase?.id, purchase.transaction_id])

  if (!purchase || !mounted) return null

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  const getAccountDisplay = (id: string) => {
    const acc = accounts.find(a => a.id === id)
    return acc ? `(${acc.code}) ${acc.name}` : '-'
  }

  const items = Array.isArray(purchase.items_json) ? purchase.items_json : []
  const outstandingAmount = Math.max(0, purchase.grand_total - purchase.amount_paid)

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[99] flex justify-center items-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[90vh] font-sans">
        
        {/* HEADER */}
        <div className="p-8 md:p-10 border-b border-slate-100 flex justify-between items-start">
          <div>
            <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-1 rounded-sm uppercase tracking-widest mb-4 inline-block">
              Detail Tagihan Pembelian (Bill)
            </span>
            <h2 className="text-3xl md:text-4xl font-black text-[#1a1c23] tracking-tight mb-2 uppercase italic">
              #{purchase.purchase_number}
            </h2>
            <div className="flex items-center gap-4 text-slate-400 text-sm">
              <span className="text-slate-800 font-bold">{purchase.suppliers?.name || 'Tanpa Pemasok'}</span>
              <span className="h-4 w-[1px] bg-slate-200"></span>
              <span>📅 {purchase.date}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-[10px] font-black border border-slate-100 px-4 py-2 rounded-sm transition-all uppercase">
            [ Close ]
          </button>
        </div>

        {/* BODY */}
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          
          {/* LEFT PANEL */}
          <div className="flex-1 p-6 md:p-10 overflow-y-auto border-r border-slate-50 bg-white">
            <div className="flex gap-8 border-b border-slate-100 pb-2 mb-6">
              <button 
                onClick={() => setActiveTab('details')}
                className={`text-[10px] font-black pb-2 uppercase tracking-widest transition-all ${
                  activeTab === 'details' ? 'border-b-2 border-yellow-500 text-slate-800' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Rincian Tagihan
              </button>
              <button 
                onClick={() => setActiveTab('journal')}
                className={`text-[10px] font-black pb-2 uppercase tracking-widest transition-all ${
                  activeTab === 'journal' ? 'border-b-2 border-yellow-500 text-slate-800' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Jurnal Entry
              </button>
            </div>

            {activeTab === 'details' ? (
              <div className="space-y-6">
                
                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 border border-slate-100 rounded-sm">
                    <p className="text-[8px] text-slate-450 font-black uppercase mb-1">Tanggal Tagihan</p>
                    <p className="text-xs font-bold text-slate-800">{purchase.date}</p>
                  </div>
                  <div className="bg-slate-50 p-4 border border-slate-100 rounded-sm">
                    <p className="text-[8px] text-slate-450 font-black uppercase mb-1">Jatuh Tempo</p>
                    <p className="text-xs font-bold text-slate-800">{purchase.due_date || '-'}</p>
                  </div>
                </div>

                {/* Items Breakdown Table */}
                <div>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Item Pembelian</h3>
                  <div className="border border-slate-200 rounded-sm overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs font-sans">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
                          <th className="py-2.5 px-4">Nama Item</th>
                          <th className="py-2.5 px-4 text-center">Fisik/Jasa</th>
                          <th className="py-2.5 px-4 text-center">Qty</th>
                          <th className="py-2.5 px-4 text-right">Harga Satuan</th>
                          <th className="py-2.5 px-4 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 text-slate-700">
                        {items.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="py-2.5 px-4 font-bold">{item.name}</td>
                            <td className="py-2.5 px-4 text-center">
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                                item.is_physical 
                                  ? 'text-blue-700 bg-blue-50 border-blue-100'
                                  : 'text-amber-700 bg-amber-50 border-amber-100'
                              }`}>
                                {item.is_physical ? '📦 Fisik' : '⚙️ Jasa'}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-center font-bold text-slate-900">{item.quantity}</td>
                            <td className="py-2.5 px-4 text-right font-medium">{formatIDR(item.price)}</td>
                            <td className="py-2.5 px-4 text-right font-black text-slate-900">{formatIDR(item.quantity * item.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Payment History */}
                <div>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Riwayat Pembayaran Cicilan</h3>
                  {paymentsLoading ? (
                    <div className="text-slate-400 text-xs font-semibold animate-pulse">Memuat riwayat pembayaran...</div>
                  ) : payments.length === 0 ? (
                    <div className="text-center py-6 border border-dashed border-slate-250 text-slate-400 text-xs font-bold uppercase tracking-wider">
                      Belum ada pembayaran cicilan.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-sm overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs font-sans">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
                            <th className="py-2.5 px-4">Tanggal</th>
                            <th className="py-2.5 px-4">Kas/Bank</th>
                            <th className="py-2.5 px-4">Catatan</th>
                            {payments.some(p => Number(p.write_off_amount) !== 0) && (
                              <th className="py-2.5 px-4 text-right">Penyesuaian</th>
                            )}
                            <th className="py-2.5 px-4 text-right">Jumlah</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-slate-700">
                          {payments.map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50/50">
                              <td className="py-2.5 px-4 font-bold">{p.date}</td>
                              <td className="py-2.5 px-4 font-semibold">{getAccountDisplay(p.payment_method_account_id)}</td>
                              <td className="py-2.5 px-4 italic text-slate-500 font-medium">{p.notes || '-'}</td>
                              {payments.some(x => Number(x.write_off_amount) !== 0) && (
                                <td className="py-2.5 px-4 text-right text-rose-600 font-semibold">
                                  {Number(p.write_off_amount) !== 0 ? formatIDR(p.write_off_amount) : '-'}
                                </td>
                              )}
                              <td className="py-2.5 px-4 text-right font-black text-slate-900">{formatIDR(p.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              /* JOURNAL ENTRY TAB */
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
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Tidak ada catatan jurnal untuk pembelian ini.</p>
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
                              year: 'numeric'
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

          {/* RIGHT PANEL */}
          <div className="w-full md:w-[380px] bg-[#fbfbfb] p-6 md:p-10 space-y-8 overflow-y-auto">
            
            {/* ATTACHMENT / NOTA */}
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Nota / Bukti</h3>
              <div className="bg-white p-6 border border-slate-200 rounded-sm shadow-sm relative overflow-hidden flex flex-col items-center justify-center text-center">
                {purchase.attachment_url ? (
                  <>
                    <span className="text-3xl mb-2">📄</span>
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-3">Bukti Nota Pembelian</p>
                    <a 
                      href={purchase.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full bg-blue-50 text-blue-600 border border-blue-100 text-center py-2.5 rounded-sm font-black text-[9px] uppercase tracking-wider hover:bg-blue-100 transition-all"
                    >
                      Buka di Tab Baru
                    </a>
                  </>
                ) : (
                  <>
                    <span className="text-3xl mb-2 text-slate-300">🤷‍♂️</span>
                    <p className="text-[10px] font-bold text-slate-450 uppercase">Tidak ada bukti nota terlampir.</p>
                  </>
                )}
              </div>
            </div>

            {/* STATUS BADGE */}
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-white p-4 border border-slate-200">
                    <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Status</p>
                    <p className={`text-[10px] font-black uppercase ${
                      purchase.payment_status === 'paid' ? 'text-emerald-600' : (purchase.payment_status === 'partial' ? 'text-amber-600' : 'text-rose-600')
                    }`}>
                      {purchase.payment_status === 'paid' ? 'Lunas' : (purchase.payment_status === 'partial' ? 'Cicilan' : 'Belum Bayar')}
                    </p>
                </div>
                <div className="bg-white p-4 border border-slate-200">
                    <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Total Items</p>
                    <p className="text-[10px] font-black text-slate-800 uppercase">
                      {items.reduce((acc, i) => acc + i.quantity, 0)} Pcs
                    </p>
                </div>
            </div>

            {/* TOTALS */}
            <div className="pt-6 border-t border-slate-200 space-y-3">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400">
                <span>Subtotal</span>
                <span className="text-slate-700">{formatIDR(purchase.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-rose-455">
                <span>Diskon</span>
                <span>-{formatIDR(purchase.discount_amount)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400">
                <span>Biaya Lainnya</span>
                <span className="text-slate-700">{formatIDR(purchase.other_fees)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400 border-t border-slate-100 pt-2">
                <span>Total Tagihan</span>
                <span className="text-slate-850 font-black">{formatIDR(purchase.grand_total)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-emerald-500">
                <span>Sudah Dibayar</span>
                <span>{formatIDR(purchase.amount_paid)}</span>
              </div>
              <div className="pt-5 border-t-2 border-slate-900 flex justify-between items-center">
                <span className="text-[11px] font-black text-slate-900 uppercase">Sisa Hutang</span>
                <span className="text-xl font-black text-rose-600">{formatIDR(outstandingAmount)}</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
