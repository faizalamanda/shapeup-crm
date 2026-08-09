"use client"
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import {
  isCustomerMatchFilters,
  formatDateKeyID,
  type MarketingFilter,
  type MarketingOrderPreview,
  type PreviewPerson,
} from '../utils/filterEvaluator'

type AudiencePreviewModalProps = {
  isOpen: boolean
  onClose: () => void
  scenarioName: string
  filters: MarketingFilter[]
  businessId?: string | null
  timezone?: string
}

let globalCachedBusinessId: string | null = null
const INITIAL_BATCH_SIZE = 10

export default function AudiencePreviewModal({
  isOpen,
  onClose,
  scenarioName,
  filters,
  businessId,
  timezone = 'Asia/Jakarta',
}: AudiencePreviewModalProps) {
  const [previewList, setPreviewList] = useState<PreviewPerson[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH_SIZE)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Lock background body scroll when modal is open and clear previous stale list
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      setVisibleCount(INITIAL_BATCH_SIZE)
      setPreviewList([])
      setPreviewLoading(true)
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen, filters, scenarioName, businessId])

  useEffect(() => {
    if (!isOpen) return

    let isMounted = true

    const fetchAudience = async () => {
      setPreviewLoading(true)

      try {
        let activeBid = businessId || globalCachedBusinessId
        if (!activeBid) {
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('active_business_id')
              .eq('id', user.id)
              .single()
            activeBid = profile?.active_business_id || null
            if (activeBid) globalCachedBusinessId = activeBid
          }
        }

        if (!activeBid) {
          if (isMounted) setPreviewList([])
          return
        }

        // Check if any filter requires fetching order level data
        const requiresOrders = filters.some((f) =>
          ['product_name', 'customer_city', 'date_completed'].includes(f.key)
        )

        // Server-Side Pushdown Query for customer_metrics with targeted lightweight columns
        let query = supabase
          .from('customer_metrics')
          .select('customer_id, name, phone, email, ltv, aov, total_order_count, completed_order_count, last_order_date, last_order_status, joined_at')
          .eq('business_id', activeBid)

        const hasOrLogic = filters.some((f) => f.logic === 'OR')

        if (!hasOrLogic && filters.length > 0) {
          filters.forEach((f) => {
            const key = f.key
            const op = f.op
            const val = f.value || ''
            const numVal = Number(val)

            if (key === 'customer_ltv' || key === 'ltv') {
              if (Number.isFinite(numVal)) {
                if (op === 'greater_or_equal' || op === 'greater than or equal to' || op === 'at_least') {
                  query = query.gte('ltv', numVal)
                } else if (op === 'less_or_equal' || op === 'less than or equal to' || op === 'at_most') {
                  query = query.lte('ltv', numVal)
                } else if (op === 'more than' || op === 'greater') {
                  query = query.gt('ltv', numVal)
                } else if (op === 'less than' || op === 'less') {
                  query = query.lt('ltv', numVal)
                } else if (op === 'equal to' || op === 'equal' || op === 'is') {
                  query = query.eq('ltv', numVal)
                }
              }
            } else if (key === 'customer_aov' || key === 'aov') {
              if (Number.isFinite(numVal)) {
                if (op === 'greater_or_equal' || op === 'greater than or equal to' || op === 'at_least') {
                  query = query.gte('aov', numVal)
                } else if (op === 'less_or_equal' || op === 'less than or equal to' || op === 'at_most') {
                  query = query.lte('aov', numVal)
                } else if (op === 'more than' || op === 'greater') {
                  query = query.gt('aov', numVal)
                } else if (op === 'less than' || op === 'less') {
                  query = query.lt('aov', numVal)
                } else if (op === 'equal to' || op === 'equal' || op === 'is') {
                  query = query.eq('aov', numVal)
                }
              }
            } else if (key === 'customer_total_orders' || key === 'total_order_count') {
              if (Number.isFinite(numVal)) {
                if (op === 'greater_or_equal' || op === 'greater than or equal to' || op === 'at_least') {
                  query = query.gte('total_order_count', numVal)
                } else if (op === 'less_or_equal' || op === 'less than or equal to' || op === 'at_most') {
                  query = query.lte('total_order_count', numVal)
                } else if (op === 'more than' || op === 'greater') {
                  query = query.gt('total_order_count', numVal)
                } else if (op === 'less than' || op === 'less') {
                  query = query.lt('total_order_count', numVal)
                } else if (op === 'equal to' || op === 'equal' || op === 'is') {
                  query = query.eq('total_order_count', numVal)
                }
              }
            } else if (key === 'order_status' && (op === 'is' || op === 'equal')) {
              query = query.ilike('last_order_status', val)
            }
          })
        }

        // Fast metric fetch: fetch first chunk (0..999). Only fetch page 2 if page 1 returned 1000 items!
        const fetchMetricsPromise = (async () => {
          const res1 = await query.order('customer_id', { ascending: true }).range(0, 999)
          const c1 = res1.data || []
          if (c1.length < 1000) return c1

          const res2 = await query.order('customer_id', { ascending: true }).range(1000, 1999)
          const c2 = res2.data || []
          return [...c1, ...c2]
        })()

        const fetchOrdersPromise = requiresOrders
          ? (async () => {
              const { data: oData } = await supabase
                .from('orders')
                .select('id, customer_id, status, created_at, order_date, order_date_utc, updated_at, items_json, raw_source_data')
                .eq('business_id', activeBid)
                .order('created_at', { ascending: false })
                .limit(1000)
              return (oData || []) as MarketingOrderPreview[]
            })()
          : Promise.resolve([])

        const [rawCustomers, previewOrders] = await Promise.all([
          fetchMetricsPromise,
          fetchOrdersPromise,
        ])

        if (!isMounted) return

        // Deduplicate customer metrics by customer_id or phone
        const uniqueCustomersMap = new Map<string, any>()
        rawCustomers.forEach((c: any) => {
          const key = c.customer_id || c.phone || c.email || c.name
          if (key && !uniqueCustomersMap.has(key)) {
            uniqueCustomersMap.set(key, c)
          }
        })
        const allCustomers = Array.from(uniqueCustomersMap.values())

        const customerOrdersMap = new Map<string, MarketingOrderPreview[]>()
        previewOrders.forEach((o) => {
          if (!o.customer_id) return
          const existing = customerOrdersMap.get(o.customer_id) || []
          existing.push(o)
          customerOrdersMap.set(o.customer_id, existing)
        })

        // Filter customers using isCustomerMatchFilters
        const filteredCustomers = allCustomers.filter((c: any) => {
          const cOrders = customerOrdersMap.get(c.customer_id) || []
          return isCustomerMatchFilters(c, cOrders, filters, timezone)
        })

        // Sort by LTV descending
        const sorted = filteredCustomers.sort((a: any, b: any) => Number(b.ltv || 0) - Number(a.ltv || 0))

        if (isMounted) {
          setPreviewList(
            sorted.map((c: any) => {
              const ltvFormatted = `Rp ${Number(c.ltv || 0).toLocaleString('id-ID')}`
              const countText = `${c.total_order_count || c.completed_order_count || 0} ORDER`
              return {
                name: c.name || 'Customer',
                orderId: `LTV: ${ltvFormatted} (${countText})`,
                status: (c.last_order_status || 'CUSTOMER').toUpperCase(),
                time: c.last_order_date
                  ? formatDateKeyID(c.last_order_date, timezone)
                  : (c.joined_at ? formatDateKeyID(c.joined_at, timezone) : '-'),
              }
            })
          )
        }
      } catch (err) {
        console.error('Audience Preview Error:', err)
      } finally {
        if (isMounted) setPreviewLoading(false)
      }
    }

    fetchAudience()

    return () => {
      isMounted = false
    }
  }, [isOpen, businessId, filters, timezone])

  if (!isOpen || !mounted) return null

  const getStatusBadgeStyle = (status: string) => {
    const s = (status || '').toUpperCase()
    if (s === 'COMPLETED') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (s === 'PROCESSING') return 'bg-blue-50 text-blue-700 border-blue-200'
    if (s === 'PENDING' || s === 'ON-HOLD') return 'bg-amber-50 text-amber-700 border-amber-200'
    if (s === 'CANCELLED') return 'bg-red-50 text-red-700 border-red-200'
    return 'bg-slate-100 text-slate-700 border-slate-200'
  }

  const displayedList = previewList.slice(0, visibleCount)

  const modalNode = (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 flex flex-col max-h-[85vh]">
        {/* MODAL HEADER */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/80 flex justify-between items-center shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">Preview Target Audience</h3>
              {previewLoading ? (
                <span className="bg-slate-200 text-slate-600 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-sm tracking-wider animate-pulse">
                  MENGHITUNG...
                </span>
              ) : (
                <span className="bg-blue-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-sm tracking-wider">
                  {displayedList.length} DARI {previewList.length} MATCH
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 font-extrabold uppercase mt-1 tracking-wider">
              Skenario: <span className="text-blue-600 font-black">{scenarioName || 'DRAFT AUTOMATION'}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-all flex items-center justify-center text-sm font-bold"
            aria-label="Tutup Preview"
          >
            ✕
          </button>
        </div>

        {/* MODAL CONTENT */}
        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {previewLoading ? (
            <div className="p-16 text-center space-y-3">
              <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">
                Menghitung Target Audience...
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {displayedList.map((person, idx) => (
                <div key={idx} className="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-slate-900 text-xs uppercase tracking-tight truncate">
                      {person.name}
                    </p>
                    <p className="text-[10px] font-bold text-slate-500 mt-0.5 tracking-tight">
                      {person.orderId}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${getStatusBadgeStyle(person.status)}`}>
                      {person.status}
                    </span>
                    <span className="text-[9px] font-bold text-slate-400">
                      {person.time}
                    </span>
                  </div>
                </div>
              ))}

              {visibleCount < previewList.length && (
                <div className="p-3 text-center bg-slate-50/80 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + 10)}
                    className="px-5 py-2.5 bg-white hover:bg-blue-50 text-blue-600 border border-blue-200 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm active:scale-95"
                  >
                    + MUAT LEBIH BANYAK (+10 DATA)
                  </button>
                </div>
              )}

              {previewList.length === 0 && (
                <div className="p-16 text-center">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                    Tidak ada customer ditemukan<br />dengan kriteria filter ini.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex justify-between items-center shrink-0">
          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
            {previewLoading
              ? 'MENGHITUNG TARGET AUDIENCE...'
              : previewList.length > 0
              ? `MENAMPILKAN ${displayedList.length} DARI ${previewList.length} CUSTOMER`
              : ''}
          </span>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-black uppercase shadow-md transition-all active:scale-95"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalNode, document.body)
}
