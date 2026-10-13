"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageLayout } from '@/components/ui/PageLayout'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate } from '@/lib/timeUtils'

interface PaymentItem {
  id: string
  business_id: string
  date: string
  payment_type: 'inbound' | 'outbound'
  channel: string
  source_document_type: string
  source_document_id: string
  document_number: string
  partner_name: string
  payment_method: string
  amount: number
  account_id?: string
  transaction_id?: string
  shift_id?: string
  cash_received?: number
  change_amount?: number
  reference_number?: string
  notes?: string
  created_at: string
}

interface PaymentKPI {
  totalInbound: number
  totalOutbound: number
  netBalance: number
}

export default function AccountingPaymentsPage() {
  const { activeBusiness, bizLoading } = useUserContext()
  const timezone = activeBusiness?.timezone

  // Filters & Pagination State
  const [paymentType, setPaymentType] = useState<'all' | 'inbound' | 'outbound'>('all')
  const [channel, setChannel] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [sortField, setSortField] = useState<string>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState<number>(1)
  const pageSize = 20

  // Data State
  const [payments, setPayments] = useState<PaymentItem[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [kpi, setKpi] = useState<PaymentKPI>({ totalInbound: 0, totalOutbound: 0, netBalance: 0 })
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Modal Detail State
  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchPayments = useCallback(async () => {
    if (!activeBusiness?.id) return
    setLoading(true)
    setErrorMsg(null)

    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (paymentType !== 'all') params.set('paymentType', paymentType)
      if (channel !== 'all') params.set('channel', channel)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      params.set('sortField', sortField)
      params.set('sortOrder', sortOrder)

      const res = await fetch(`/api/accounting/payments?${params.toString()}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Gagal memuat data pembayaran')
      }

      setPayments(data.payments || [])
      setTotalCount(data.totalCount || 0)
      if (data.kpi) setKpi(data.kpi)
    } catch (err: any) {
      console.error('Fetch payments error:', err)
      setErrorMsg(err.message || 'Terjadi kesalahan saat memuat data pembayaran')
    } finally {
      setLoading(false)
    }
  }, [activeBusiness?.id, page, paymentType, channel, debouncedSearch, dateFrom, dateTo, sortField, sortOrder])

  useEffect(() => {
    if (!bizLoading && activeBusiness?.id) {
      fetchPayments()
    }
  }, [bizLoading, activeBusiness?.id, fetchPayments])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
    setPage(1)
  }

  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val || 0)
  }

  const totalPages = Math.ceil(totalCount / pageSize) || 1

  return (
    <PageLayout
      title="Pembayaran & Kas"
      description="Pusat pencatatan dan rekonsiliasi seluruh mutasi pembayaran kas & bank (Inbound & Outbound)"
      width="xl"
      actions={
        <button
          onClick={() => fetchPayments()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-[var(--su-border)] bg-[var(--su-surface)] text-[var(--su-text)] hover:bg-slate-50 transition shadow-2xs disabled:opacity-50"
        >
          <span>🔄</span>
          <span>{loading ? 'Memuat...' : 'Segarkan Data'}</span>
        </button>
      }
    >
      <div className="space-y-6 pb-12">
        {/* 1. KPI SUMMARY CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Inbound Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                Total Uang Masuk (Inbound)
              </span>
              <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm font-bold">
                📥
              </span>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-black text-slate-900">
                {formatIDR(kpi.totalInbound)}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Penjualan Kasir POS & Invoice Klien</p>
            </div>
          </div>

          {/* Outbound Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">
                Total Uang Keluar (Outbound)
              </span>
              <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-sm font-bold">
                📤
              </span>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-black text-slate-900">
                {formatIDR(kpi.totalOutbound)}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Tagihan Pembelian, Beban Operasional, & Gaji</p>
            </div>
          </div>

          {/* Net Liquidity Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
                Saldo Kas Bersih (Net)
              </span>
              <span className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-bold">
                ⚖️
              </span>
            </div>
            <div className="mt-3">
              <div className={`text-2xl font-black ${kpi.netBalance >= 0 ? 'text-indigo-950' : 'text-rose-600'}`}>
                {formatIDR(kpi.netBalance)}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Mutasi Kas Bersih Periode Ini</p>
            </div>
          </div>
        </div>

        {/* 2. FILTER & CONTROLS BAR */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5 shadow-2xs">
          {/* Type Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold">
              <button
                onClick={() => { setPaymentType('all'); setPage(1) }}
                className={`px-3.5 py-1.5 rounded-lg transition ${paymentType === 'all' ? 'bg-white text-indigo-600 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Semua Mutasi
              </button>
              <button
                onClick={() => { setPaymentType('inbound'); setPage(1) }}
                className={`px-3.5 py-1.5 rounded-lg transition ${paymentType === 'inbound' ? 'bg-white text-emerald-600 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                📥 Penerimaan (Inbound)
              </button>
              <button
                onClick={() => { setPaymentType('outbound'); setPage(1) }}
                className={`px-3.5 py-1.5 rounded-lg transition ${paymentType === 'outbound' ? 'bg-white text-rose-600 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                📤 Pengeluaran (Outbound)
              </button>
            </div>

            {/* Channel Dropdown */}
            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-500 font-medium hidden sm:inline">Saluran:</label>
              <select
                value={channel}
                onChange={(e) => { setChannel(e.target.value); setPage(1) }}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">Semua Saluran</option>
                <option value="POS">POS (Kasir)</option>
                <option value="WooCommerce">WooCommerce</option>
                <option value="Accurate Online">Accurate Online</option>
                <option value="Invoice">Invoice Penjualan</option>
                <option value="Purchases">Pembelian Supplier</option>
                <option value="Expenses">Beban Operasional</option>
                <option value="Payroll">Gaji Karyawan</option>
              </select>
            </div>
          </div>

          {/* Search & Date Range */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Cari nomor dokumen, partner/pelanggan, referensi..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
              />
              <span className="absolute left-2.5 top-2.5 text-slate-400">🔍</span>
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                className="px-2.5 py-1.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                title="Dari Tanggal"
              />
              <span className="text-slate-400">s/d</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                className="px-2.5 py-1.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                title="Sampai Tanggal"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
                  className="text-xs text-rose-600 hover:underline px-1 font-semibold"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 3. TABLE / LIST VIEW */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-semibold text-slate-500">Memuat mutasi pembayaran...</p>
            </div>
          ) : errorMsg ? (
            <div className="p-8 text-center text-xs text-rose-600">
              <p className="font-bold">⚠️ Terjadi Kesalahan</p>
              <p className="mt-1">{errorMsg}</p>
            </div>
          ) : payments.length === 0 ? (
            <div className="p-16 text-center text-slate-400">
              <div className="text-4xl mb-3">💳</div>
              <h4 className="text-sm font-bold text-slate-800">Tidak Ada Data Pembayaran</h4>
              <p className="text-xs text-slate-400 mt-1">
                Belum ada transaksi pembayaran yang cocok dengan filter yang dipilih.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                    <th 
                      onClick={() => handleSort('date')}
                      className="px-4 py-3.5 cursor-pointer hover:text-slate-900 transition"
                    >
                      Tanggal {sortField === 'date' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </th>
                    <th className="px-4 py-3.5">No. Dokumen</th>
                    <th className="px-4 py-3.5">Saluran</th>
                    <th className="px-4 py-3.5">Partner / Pelanggan</th>
                    <th className="px-4 py-3.5">Metode Bayar</th>
                    <th 
                      onClick={() => handleSort('amount')}
                      className="px-4 py-3.5 text-right cursor-pointer hover:text-slate-900 transition"
                    >
                      Jumlah {sortField === 'amount' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </th>
                    <th className="px-4 py-3.5 text-center">Tipe</th>
                    <th className="px-4 py-3.5 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800 font-medium">
                  {payments.map((p) => {
                    const isInbound = p.payment_type === 'inbound'
                    return (
                      <tr 
                        key={p.id}
                        className="hover:bg-slate-50/70 transition cursor-pointer"
                        onClick={() => setSelectedPayment(p)}
                      >
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {formatDisplayDate(p.date, 'short', timezone)}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900 uppercase">
                          {p.document_number || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            p.channel === 'POS' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                            p.channel?.toLowerCase().includes('woo') ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                            p.channel?.toLowerCase().includes('accurate') ? 'bg-teal-50 text-teal-700 border border-teal-200' :
                            p.channel === 'Invoice' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                            p.channel === 'Purchases' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                            'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}>
                            {p.channel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-semibold truncate max-w-[180px]">
                          {p.partner_name || 'Walk-in'}
                        </td>
                        <td className="px-4 py-3 uppercase text-slate-600 font-semibold">
                          {p.payment_method}
                        </td>
                        <td className={`px-4 py-3 text-right font-black ${isInbound ? 'text-emerald-600' : 'text-slate-900'}`}>
                          {isInbound ? '+' : '-'}{formatIDR(p.amount)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            isInbound ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                          }`}>
                            {isInbound ? 'Masuk' : 'Keluar'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedPayment(p)
                            }}
                            className="px-2.5 py-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition font-bold"
                          >
                            Detail
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Footer */}
          {!loading && totalCount > 0 && (
            <div className="p-4 bg-slate-50/50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <span className="text-slate-500">
                Menampilkan <b>{payments.length}</b> dari <b>{totalCount}</b> transaksi
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(prev => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition"
                >
                  ← Sebelumnya
                </button>
                <span className="px-2 font-bold text-slate-800">
                  Halaman {page} dari {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition"
                >
                  Berikutnya →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. MODAL DETAIL PEMBAYARAN */}
      <FullScreenModal
        isOpen={Boolean(selectedPayment)}
        onClose={() => setSelectedPayment(null)}
        title={
          <div className="flex items-center gap-2">
            <span>Rincian Pembayaran</span>
            {selectedPayment && (
              <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                selectedPayment.payment_type === 'inbound' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
              }`}>
                {selectedPayment.payment_type === 'inbound' ? 'Uang Masuk (Inbound)' : 'Uang Keluar (Outbound)'}
              </span>
            )}
          </div>
        }
        description="Detail mutasi kas dan tautan pembukuan akuntansi"
        desktopSize="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setSelectedPayment(null)}
              className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs transition"
            >
              Tutup
            </button>
          </div>
        }
      >
        {selectedPayment && (
          <div className="space-y-4 text-xs">
            {/* Header Highlight Card */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Nomor Dokumen
                  </span>
                  <h4 className="text-base font-black text-slate-900 mt-0.5 uppercase">
                    {selectedPayment.document_number}
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    Saluran: <b>{selectedPayment.channel}</b>
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Nominal Bersih
                  </span>
                  <div className={`text-xl font-black ${selectedPayment.payment_type === 'inbound' ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {formatIDR(selectedPayment.amount)}
                  </div>
                </div>
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 gap-3 p-3.5 bg-white rounded-xl border border-slate-100">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Partner / Pihak</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{selectedPayment.partner_name || '-'}</p>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tanggal Pembayaran</span>
                <p className="font-semibold text-slate-800 text-sm mt-0.5">
                  {formatDisplayDate(selectedPayment.date, 'medium', timezone)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Metode Pembayaran</span>
                <p className="font-bold text-slate-900 uppercase mt-0.5">{selectedPayment.payment_method}</p>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Waktu Pencatatan</span>
                <p className="font-medium text-slate-600 mt-0.5">
                  {formatDisplayDate(selectedPayment.created_at, 'datetime', timezone)}
                </p>
              </div>
            </div>

            {/* Specific Cash Details (Jika POS Tunai) */}
            {selectedPayment.cash_received && selectedPayment.cash_received > 0 ? (
              <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-1.5">
                <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
                  Rincian Uang Kas Laci
                </span>
                <div className="flex justify-between text-slate-700">
                  <span>Uang Diterima dari Pelanggan:</span>
                  <span className="font-bold text-slate-900">{formatIDR(selectedPayment.cash_received)}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Kembalian Diserahkan:</span>
                  <span className="font-bold text-slate-900">{formatIDR(selectedPayment.change_amount || 0)}</span>
                </div>
              </div>
            ) : null}

            {/* Notes / References */}
            {selectedPayment.notes && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Catatan:</span>
                <p className="text-slate-700 mt-0.5 italic">{selectedPayment.notes}</p>
              </div>
            )}

            {/* Accounting Traceability */}
            <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>Status Pembukuan Jurnal:</span>
              <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                ✓ Tercatat di Buku Besar
              </span>
            </div>
          </div>
        )}
      </FullScreenModal>
    </PageLayout>
  )
}
