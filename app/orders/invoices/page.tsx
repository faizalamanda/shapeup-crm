"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'

// Types matching the schema
type Invoice = {
  id: string
  order_number: string
  order_date: string
  grand_total: number
  status: 'pending' | 'processing' | 'completed' | 'cancelled'
  payment_method: string | null
  raw_source_data: {
    due_date: string | null
    payment_terms: string
    notes: string
    custom_title?: string
    accent_color?: string
    layout_style?: string
  } | null
  customers: {
    id: string
    name: string
    phone: string
    email: string | null
  } | null
}

const formatIDR = (value: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value)
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'pending': // Draft
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200">Draft</span>
    case 'processing': // Sent / Unpaid
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">Belum Bayar</span>
    case 'completed': // Paid
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Lunas</span>
    case 'cancelled': // Cancelled
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200">Batal</span>
    default:
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-50 text-gray-700 border border-gray-200">{status}</span>
  }
}

export default function InvoicesPage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Load Invoices
  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()

      if (!profile?.active_business_id) return

      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(*)')
        .eq('business_id', profile.active_business_id)
        .eq('source_platform', 'Invoice')
        .order('created_at', { ascending: false })

      if (error) throw error
      setInvoices(data as unknown as Invoice[])
    } catch (err) {
      console.error('Failed to load invoices:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  // Memoized Metrics Calculations (Wave Apps inspired)
  const metrics = useMemo(() => {
    let overdue = 0
    let outstanding = 0
    let draft = 0
    let paid30Days = 0

    const today = new Date()
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

    invoices.forEach(inv => {
      const total = Number(inv.grand_total || 0)
      if (inv.status === 'pending') {
        draft += total
      } else if (inv.status === 'processing') {
        outstanding += total
        // Check if overdue
        const dueDateStr = inv.raw_source_data?.due_date
        if (dueDateStr) {
          const dueDate = new Date(dueDateStr)
          if (dueDate < today) {
            overdue += total
          }
        }
      } else if (inv.status === 'completed') {
        const orderDate = new Date(inv.order_date)
        if (orderDate >= thirtyDaysAgo) {
          paid30Days += total
        }
      }
    })

    return { overdue, outstanding, draft, paid30Days }
  }, [invoices])

  // Filtered Invoices for Table
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // 1. Status Filter
      if (activeTab === 'draft' && inv.status !== 'pending') return false
      if (activeTab === 'unpaid' && inv.status !== 'processing') return false
      if (activeTab === 'paid' && inv.status !== 'completed') return false
      if (activeTab === 'cancelled' && inv.status !== 'cancelled') return false

      // 2. Search Filter
      if (searchQuery.trim() === '') return true
      const q = searchQuery.toLowerCase()
      const invNum = (inv.order_number || '').toLowerCase()
      const custName = (inv.customers?.name || '').toLowerCase()
      return invNum.includes(q) || custName.includes(q)
    })
  }, [invoices, activeTab, searchQuery])

  return (
    <div className="space-y-6 text-[#1C1C1A] px-2 py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[#1C1C1A]">Tagihan (Invoices)</h1>
          <p className="text-sm text-[#70706E]">Kelola piutang, penagihan pelanggan, dan pembayaran gaya Wave Apps</p>
        </div>
        <Link
          href="/orders/invoices/new"
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-bold text-white bg-[#1E40AF] hover:bg-[#1D4ED8] rounded-xl shadow-sm transition-all duration-200"
        >
          ➕ Buat Invoice Baru
        </Link>
      </div>

      {/* Metric Cards (Wave Apps Concept) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white border border-[#EBEBEA] shadow-sm hover:border-[#1E40AF]/30 transition-all">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-600">Jatuh Tempo (Overdue)</p>
          <p className="text-2xl font-black mt-2 text-rose-700">{formatIDR(metrics.overdue)}</p>
          <p className="text-[10px] text-[#70706E] mt-1">Invoice unpaid melewati tenggat waktu</p>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#EBEBEA] shadow-sm hover:border-[#1E40AF]/30 transition-all">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Belum Lunas (Outstanding)</p>
          <p className="text-2xl font-black mt-2 text-blue-800">{formatIDR(metrics.outstanding)}</p>
          <p className="text-[10px] text-[#70706E] mt-1">Tagihan aktif terkirim ke customer</p>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#EBEBEA] shadow-sm hover:border-[#1E40AF]/30 transition-all">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Draft</p>
          <p className="text-2xl font-black mt-2 text-amber-700">{formatIDR(metrics.draft)}</p>
          <p className="text-[10px] text-[#70706E] mt-1">Faktur belum resmi diterbitkan</p>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#EBEBEA] shadow-sm hover:border-[#1E40AF]/30 transition-all">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Lunas (30 Hari Terakhir)</p>
          <p className="text-2xl font-black mt-2 text-emerald-800">{formatIDR(metrics.paid30Days)}</p>
          <p className="text-[10px] text-[#70706E] mt-1">Pendapatan invoice tertagih</p>
        </div>
      </div>

      {/* Main Container */}
      <div className="bg-white rounded-2xl border border-[#EBEBEA] shadow-sm overflow-hidden">
        {/* Filters bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border-b border-[#EBEBEA] bg-[#FAFAFA]">
          <div className="flex flex-wrap gap-1 bg-[#F0F0EF] p-1 rounded-xl w-fit">
            {[
              { id: 'all', label: 'Semua' },
              { id: 'draft', label: 'Draft' },
              { id: 'unpaid', label: 'Belum Bayar' },
              { id: 'paid', label: 'Lunas' },
              { id: 'cancelled', label: 'Batal' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-white text-[#1C1C1A] shadow-sm'
                    : 'text-[#70706E] hover:text-[#1C1C1A]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <input
              type="text"
              placeholder="Cari nomor invoice atau pelanggan..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-sm rounded-xl border border-[#EBEBEA] bg-white focus:outline-none focus:ring-2 focus:ring-[#1E40AF]/20 focus:border-[#1E40AF] transition-all"
            />
            <span className="absolute left-3 top-2.5 text-gray-400 text-xs">🔍</span>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-10 h-10 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
              <p className="text-sm font-bold text-[#70706E]">Memuat data invoice...</p>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-5xl mb-4">📄</p>
              <p className="text-base font-bold text-[#1C1C1A]">Tidak Ada Invoice Ditemukan</p>
              <p className="text-xs text-[#70706E] mt-1">Silakan buat invoice baru atau ubah filter pencarian Anda</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EBEBEA] text-xs font-bold uppercase tracking-wider text-[#70706E] bg-[#FAFAFA]">
                  <th className="p-4">No. Invoice</th>
                  <th className="p-4">Pelanggan</th>
                  <th className="p-4">Tanggal Faktur</th>
                  <th className="p-4">Jatuh Tempo</th>
                  <th className="p-4 text-right">Total</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBEBEA] text-sm text-[#1C1C1A]">
                {filteredInvoices.map(inv => {
                  const invDate = new Date(inv.order_date).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  })
                  const dueDate = inv.raw_source_data?.due_date
                    ? new Date(inv.raw_source_data.due_date).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })
                    : '-'

                  return (
                    <tr key={inv.id} className="hover:bg-[#F9F9F9] transition-all">
                      <td className="p-4 font-bold text-[#1E40AF]">
                        <Link href={`/orders/invoices/${inv.id}`} className="hover:underline">
                          {inv.order_number}
                        </Link>
                      </td>
                      <td className="p-4">
                        <div className="font-semibold">{inv.customers?.name || 'Customer Umum'}</div>
                        <div className="text-xs text-[#70706E]">{inv.customers?.phone || ''}</div>
                      </td>
                      <td className="p-4 text-[#70706E]">{invDate}</td>
                      <td className="p-4 text-[#70706E]">{dueDate}</td>
                      <td className="p-4 text-right font-bold text-slate-800">
                        {formatIDR(inv.grand_total)}
                      </td>
                      <td className="p-4">{getStatusBadge(inv.status)}</td>
                      <td className="p-4 text-center">
                        <Link
                          href={`/orders/invoices/${inv.id}`}
                          className="inline-flex items-center justify-center px-3 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-all"
                        >
                          Lihat Detail 🔎
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
