"use client"
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

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
  created_at?: string
  suppliers?: { id: string; name: string } | null
}

interface PurchaseDetailModalProps {
  purchase: Purchase | null
  accounts: Account[]
  onClose: () => void
  onEdit?: (purchase: any) => void
}

export function PurchaseDetailModal({ purchase, accounts, onClose, onEdit }: PurchaseDetailModalProps) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'stock' | 'journal'>('details')
  
  const [payments, setPayments] = useState<any[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [hasFetchedPayments, setHasFetchedPayments] = useState(false)

  const [stockMoves, setStockMoves] = useState<any[]>([])
  const [stockLoading, setStockLoading] = useState(false)
  const [hasFetchedStock, setHasFetchedStock] = useState(false)

  const [transactions, setTransactions] = useState<any[]>([])
  const [journalLoading, setJournalLoading] = useState(false)
  const [hasFetchedJournal, setHasFetchedJournal] = useState(false)
  const [journalError, setJournalError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Reset states when purchase changes
  useEffect(() => {
    if (purchase?.id) {
      setActiveTab('details')
      setHasFetchedPayments(false)
      setHasFetchedStock(false)
      setHasFetchedJournal(false)
    }
  }, [purchase?.id])

  // Lazy Load: Payments (Details Tab)
  useEffect(() => {
    const purchaseId = purchase?.id;
    if (purchaseId && activeTab === 'details' && !hasFetchedPayments) {
      async function fetchPayments() {
        setPaymentsLoading(true)
        const { data, error } = await supabase
          .from('purchase_payments')
          .select('*')
          .eq('purchase_id', purchaseId)
          .order('date', { ascending: true })
        if (!error && data) {
          setPayments(data)
          setHasFetchedPayments(true)
        }
        setPaymentsLoading(false)
      }
      fetchPayments()
    }
  }, [purchase?.id, activeTab, hasFetchedPayments])

  // Lazy Load: Stock Moves (Jurnal Stok Tab)
  useEffect(() => {
    const purchaseId = purchase?.id;
    if (purchaseId && activeTab === 'stock' && !hasFetchedStock) {
      async function fetchStock() {
        setStockLoading(true)
        const { data, error } = await supabase
          .from('v_stock_moves_ledger')
          .select('id, created_at, reference, type, qty, origin_location_id, system_stock, products ( name )')
          .eq('source_type', 'purchase')
          .eq('source_id', purchaseId)
          .order('created_at', { ascending: false })
        if (!error && data) {
          setStockMoves(data)
          setHasFetchedStock(true)
        }
        setStockLoading(false)
      }
      fetchStock()
    }
  }, [purchase?.id, activeTab, hasFetchedStock])

  // Lazy Load: Journal Lines (Jurnal Keuangan Tab)
  useEffect(() => {
    const purchaseId = purchase?.id;
    const txId = purchase?.transaction_id;
    
    if (purchaseId && activeTab === 'journal' && !hasFetchedJournal) {
      async function fetchJournal() {
        setJournalLoading(true)
        setJournalError(null)
        try {
          const { data: payData } = await supabase.from('purchase_payments').select('transaction_id').eq('purchase_id', purchaseId)
          const txIds = [txId].filter(Boolean) as string[]
          if (payData) {
            payData.forEach(p => { if (p.transaction_id) txIds.push(p.transaction_id) })
          }

          if (txIds.length === 0) {
            setTransactions([])
            setHasFetchedJournal(true)
            setJournalLoading(false)
            return
          }

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
          setHasFetchedJournal(true)
        } catch (err: any) {
          setJournalError(err.message || 'Gagal memuat catatan jurnal')
        } finally {
          setJournalLoading(false)
        }
      }
      fetchJournal()
    }
  }, [purchase?.id, purchase?.transaction_id, activeTab, hasFetchedJournal])

  const formatIDR = (val: any) => new Intl.NumberFormat('id-ID', { 
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0 
  }).format(Number(val) || 0)

  const getAccountDisplay = (id: string) => {
    const acc = accounts.find(a => a.id === id)
    return acc ? `(${acc.code}) ${acc.name}` : '-'
  }

  const displayPayments = useMemo(() => {
    if (payments.length > 0) return payments

    if (purchase?.amount_paid && Number(purchase.amount_paid) > 0) {
      return [{
        id: `initial-pur-pay-${purchase?.id}`,
        date: purchase.date,
        payment_method_account_id: '',
        notes: purchase.payment_status === 'paid' ? 'Pembayaran Lunas Saat Pembelian Dibuat' : 'Uang Muka / DP',
        amount: purchase.amount_paid
      }]
    }
    return []
  }, [payments, purchase])

  if (!purchase || !mounted) return null

  const items = Array.isArray(purchase.items_json) ? purchase.items_json : []
  const outstandingAmount = Math.max(0, purchase.grand_total - purchase.amount_paid)

  const modalFooter = (
    <div className="flex justify-end gap-2 w-full">
      {purchase.payment_status === 'unpaid' && onEdit && (
        <button 
          onClick={() => {
            onClose()
            onEdit(purchase)
          }} 
          className="text-blue-600 hover:text-blue-700 bg-blue-50 border border-blue-100 text-[10px] md:text-xs font-black px-4 py-2 rounded-sm transition-all uppercase cursor-pointer"
        >
          ✏️ Edit Pembelian
        </button>
      )}
    </div>
  )

  return (
    <FullScreenModal
      isOpen={!!purchase}
      onClose={onClose}
      title={`Tagihan #${purchase.purchase_number}`}
      description={`${purchase.suppliers?.name || 'Tanpa Pemasok'} • ${purchase.date}`}
      desktopSize="xl"
      footer={purchase.payment_status === 'unpaid' && onEdit ? modalFooter : undefined}
    >
      <div className="flex flex-col md:flex-row min-h-full bg-white font-sans">
        
        {/* LEFT PANEL */}
        <div className="flex-1 p-4 md:p-8 border-b md:border-b-0 md:border-r border-slate-200">
          
          {/* TABS */}
          <div className="flex gap-4 md:gap-8 border-b border-slate-100 pb-2 mb-6 overflow-x-auto whitespace-nowrap">
            <button 
              onClick={() => setActiveTab('details')}
              className={`text-[10px] md:text-xs font-black pb-2 uppercase tracking-widest transition-all ${
                activeTab === 'details' ? 'border-b-2 border-yellow-500 text-slate-800' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Rincian Tagihan
            </button>
            <button 
              onClick={() => setActiveTab('stock')}
              className={`text-[10px] md:text-xs font-black pb-2 uppercase tracking-widest transition-all ${
                activeTab === 'stock' ? 'border-b-2 border-emerald-500 text-slate-800' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Jurnal Stok
            </button>
            <button 
              onClick={() => setActiveTab('journal')}
              className={`text-[10px] md:text-xs font-black pb-2 uppercase tracking-widest transition-all ${
                activeTab === 'journal' ? 'border-b-2 border-blue-500 text-slate-800' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Jurnal Keuangan
            </button>
          </div>

          {/* TAB: DETAILS */}
          {activeTab === 'details' && (
            <div className="space-y-6">
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

              <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Item Pembelian</h3>
                <div className="border border-slate-200 rounded-sm overflow-x-auto">
                  <table className="w-full min-w-[500px] text-left border-collapse text-xs font-sans">
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

              <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Riwayat & Detail Pembayaran</h3>
                {paymentsLoading ? (
                  <div className="text-slate-400 text-xs font-semibold animate-pulse">Memuat rincian pembayaran...</div>
                ) : displayPayments.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-slate-250 text-slate-400 text-xs font-bold uppercase tracking-wider">
                    Belum ada pembayaran.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-sm overflow-x-auto">
                    <table className="w-full min-w-[500px] text-left border-collapse text-xs font-sans">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
                          <th className="py-2.5 px-4">Tanggal</th>
                          <th className="py-2.5 px-4">Kas/Bank</th>
                          <th className="py-2.5 px-4">Catatan</th>
                          {displayPayments.some(p => Number(p.write_off_amount) !== 0) && (
                            <th className="py-2.5 px-4 text-right">Penyesuaian</th>
                          )}
                          <th className="py-2.5 px-4 text-right">Jumlah</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 text-slate-700">
                        {displayPayments.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50/50">
                            <td className="py-2.5 px-4 font-bold">{p.date}</td>
                            <td className="py-2.5 px-4 font-semibold">{getAccountDisplay(p.payment_method_account_id)}</td>
                            <td className="py-2.5 px-4 italic text-slate-500 font-medium">{p.notes || '-'}</td>
                            {displayPayments.some(x => Number(x.write_off_amount) !== 0) && (
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
          )}

          {/* TAB: STOCK MOVES (JURNAL STOK) */}
          {activeTab === 'stock' && (
            <div className="space-y-6">
              {stockLoading ? (
                <div className="text-slate-400 text-xs font-semibold animate-pulse">Memuat mutasi stok...</div>
              ) : stockMoves.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-sm">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Tidak ada mutasi stok fisik yang tercatat untuk pembelian ini.</p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-sm overflow-hidden bg-white shadow-sm">
                  <div className="bg-[#fbfbfb] px-4 md:px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                    <div>
                      <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-sm uppercase tracking-wider border border-emerald-100">
                        Inventory Ledger
                      </span>
                      <h4 className="text-xs font-black text-slate-800 uppercase mt-1">
                        Catatan Mutasi Pembelian
                      </h4>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[500px] text-left border-collapse text-xs font-sans">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
                          <th className="py-2.5 px-4">Waktu</th>
                          <th className="py-2.5 px-4">Produk</th>
                          <th className="py-2.5 px-4">Referensi</th>
                          <th className="py-2.5 px-4 text-right">Mutasi</th>
                          <th className="py-2.5 px-4 text-right">Saldo Sistem</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 text-slate-700">
                        {stockMoves.map((m: any) => {
                          const isAddition = m.type === 'receipt' || (m.type === 'adjustment' && !m.origin_location_id);
                          const qtyText = isAddition ? `+${m.qty}` : `-${m.qty}`;
                          const qtyColor = isAddition ? 'text-emerald-600' : 'text-rose-600';
                          return (
                            <tr key={m.id} className="hover:bg-slate-50/50">
                              <td className="py-2.5 px-4 whitespace-nowrap text-[10px]">
                                {new Date(m.created_at).toLocaleString('id-ID', {
                                  day: '2-digit', month: 'short', year: 'numeric',
                                  hour: '2-digit', minute: '2-digit'
                                })}
                              </td>
                              <td className="py-2.5 px-4 font-bold text-slate-800">{m.products?.name}</td>
                              <td className="py-2.5 px-4 text-slate-500 font-mono text-[10px]">{m.reference || '-'}</td>
                              <td className={`py-2.5 px-4 text-right font-black ${qtyColor}`}>{qtyText}</td>
                              <td className="py-2.5 px-4 text-right font-black text-slate-900 bg-slate-50/50 border-l border-slate-100">
                                {m.system_stock}
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

          {/* TAB: JOURNAL (JURNAL KEUANGAN) */}
          {activeTab === 'journal' && (
            <div className="space-y-6">
              {journalLoading ? (
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
              ) : journalError ? (
                <div className="p-4 bg-red-50 border border-red-100 rounded-sm text-red-600 text-xs font-semibold">
                  {journalError}
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
                      <div className="bg-[#fbfbfb] px-4 md:px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                        <div>
                          <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-sm uppercase tracking-wider border border-blue-100">
                            Financial Ledger
                          </span>
                          <h4 className="text-xs font-black text-slate-800 uppercase mt-1">
                            {tx.description}
                          </h4>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 hidden sm:block">
                          {new Date(tx.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>

                      <div className="p-4 md:p-6 overflow-x-auto">
                        <table className="w-full min-w-[400px] text-left border-collapse text-xs font-sans">
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
        <div className="w-full md:w-[320px] lg:w-[380px] bg-[#fbfbfb] p-4 md:p-8 space-y-8 shrink-0 border-t md:border-t-0 border-slate-200">
          
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
              <div className="bg-white p-4 border border-slate-200 rounded-sm">
                  <p className="text-[8px] text-slate-400 font-black uppercase mb-1">Status</p>
                  <p className={`text-[10px] font-black uppercase ${
                    purchase.payment_status === 'paid' ? 'text-emerald-600' : (purchase.payment_status === 'partial' ? 'text-amber-600' : 'text-rose-600')
                  }`}>
                    {purchase.payment_status === 'paid' ? 'Lunas' : (purchase.payment_status === 'partial' ? 'Cicilan' : 'Belum Bayar')}
                  </p>
              </div>
              <div className="bg-white p-4 border border-slate-200 rounded-sm">
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
            <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400 border-t border-slate-100 pt-2 mt-2">
              <span>Total Tagihan</span>
              <span className="text-slate-850 font-black">{formatIDR(purchase.grand_total)}</span>
            </div>
            <div className="flex justify-between items-center text-[10px] font-bold uppercase text-emerald-500">
              <span>Sudah Dibayar</span>
              <span>{formatIDR(purchase.amount_paid)}</span>
            </div>
            <div className="pt-5 mt-3 border-t-2 border-slate-900 flex justify-between items-center">
              <span className="text-[11px] font-black text-slate-900 uppercase">Sisa Hutang</span>
              <span className="text-xl font-black text-rose-600">{formatIDR(outstandingAmount)}</span>
            </div>
          </div>

        </div>
      </div>
    </FullScreenModal>
  )
}
