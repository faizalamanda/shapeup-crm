import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

interface CustomerDetailProps {
  customer: any
  onClose: () => void
}

export function CustomerDetail({ customer, onClose }: CustomerDetailProps) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'order' | 'contact' | 'notes'>('order')
  const [orders, setOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (customer) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [customer])

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    if (customer?.customer_id) {
      fetchCustomerOrders()
    }
  }, [customer])

  async function fetchCustomerOrders() {
    setLoadingOrders(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customer.customer_id)
        .order('order_date', { ascending: false })

      if (error) throw error
      setOrders(data || [])
    } catch (err) {
      console.error('Error fetching customer orders:', err)
    } finally {
      setLoadingOrders(false)
    }
  }

  if (!customer || !mounted) return null

  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 pb-10 overflow-y-auto bg-slate-900/60 backdrop-blur-[2px]" onClick={onClose}>
      <div className="bg-white w-full max-w-4xl border border-slate-200 shadow-2xl rounded-2xl relative mx-4 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-start bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2.5 bg-blue-50 px-2.5 py-1 inline-block rounded-md border border-blue-100">
              Profil Pelanggan
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">{customer.name || 'Tanpa Nama'}</h2>
            <div className="flex items-center gap-3 mt-2 text-slate-500 text-xs font-semibold">
              <span>+{customer.phone}</span>
              {customer.email && (
                <>
                  <span className="text-slate-300">|</span>
                  <span>{customer.email}</span>
                </>
              )}
              {customer.category && (
                <>
                  <span className="text-slate-300">|</span>
                  <span className="text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded text-[9px] font-bold uppercase">{customer.category}</span>
                </>
              )}
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 font-bold text-[10px] tracking-wider uppercase bg-white border border-slate-200 px-4 py-2.5 rounded-xl shadow-sm transition-all"
          >
            Tutup
          </button>
        </div>

        {/* Content Body */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
          {/* Main Area */}
          <div className="md:col-span-2 p-8 border-r border-slate-100 min-h-[450px]">
            {/* Tabs */}
            <div className="flex gap-6 border-b border-slate-200 mb-6 font-black text-[10px] uppercase tracking-widest">
              {['order', 'contact', 'notes'].map((tab) => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`pb-3 transition-all border-b-2 ${
                    activeTab === tab 
                      ? 'border-blue-600 text-blue-600 font-black' 
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {tab === 'order' ? 'Riwayat Belanja' : tab === 'contact' ? 'Interaksi' : 'Catatan'}
                </button>
              ))}
            </div>

            {/* Riwayat Belanja (Orders) */}
            {activeTab === 'order' && (
              <div className="space-y-4">
                {loadingOrders ? (
                  <div className="py-12 text-center text-slate-400 font-bold uppercase tracking-wider text-xs animate-pulse">
                    Memuat riwayat transaksi...
                  </div>
                ) : orders.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 font-medium italic text-sm">
                    Belum ada riwayat transaksi terdaftar.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-2">
                    {orders.map((o) => {
                      // Parse items
                      let items: any[] = []
                      if (o.items_json) {
                        try {
                          items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : o.items_json
                        } catch (e) {
                          items = []
                        }
                      }

                      return (
                        <div key={o.id} className="p-4 border border-slate-100 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors shadow-sm">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="font-bold text-slate-800 text-sm">Order #{o.order_number || o.id.slice(0, 8)}</span>
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider ml-2.5">
                                {o.order_date 
                                  ? new Date(o.order_date).toLocaleDateString('id-ID', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric'
                                    })
                                  : '-'}
                              </span>
                            </div>
                            <span className="font-black text-slate-900 text-sm">{formatIDR(o.grand_total)}</span>
                          </div>
                          
                          {/* Items and Sub-details */}
                          <div className="space-y-1 pl-1 mb-2">
                            {items.map((item: any, idx: number) => (
                              <p key={idx} className="text-xs text-slate-600 font-medium flex justify-between">
                                <span>• {item.name || item.product_name}</span>
                                <span className="text-slate-400 font-bold text-[10px]">{item.quantity} pcs</span>
                              </p>
                            ))}
                          </div>

                          <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider pt-2 border-t border-slate-100 text-slate-400">
                            <span>Metode: {o.payment_method || 'COD'}</span>
                            <span className={`px-1.5 py-0.5 rounded ${
                              ['completed', 'complete'].includes(o.status?.toLowerCase())
                                ? 'bg-emerald-50 text-emerald-600'
                                : ['failed', 'cancelled'].includes(o.status?.toLowerCase())
                                ? 'bg-red-50 text-red-600'
                                : 'bg-amber-50 text-amber-600'
                            }`}>
                              {o.status}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Interaksi Tab */}
            {activeTab === 'contact' && (
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Terakhir Dihubungi</p>
                  <p className="text-xs font-bold text-slate-800">Belum pernah dilakukan follow-up broadcast via sistem.</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Platform Sumber</p>
                  <p className="text-xs font-bold text-slate-800">{orders[0]?.source_platform || 'WooCommerce Store'}</p>
                </div>
              </div>
            )}

            {/* Catatan Tab */}
            {activeTab === 'notes' && (
              <div className="bg-amber-50/50 p-6 border-l-4 border-amber-400 rounded-r-xl italic text-xs text-slate-700 leading-relaxed shadow-sm">
                "{customer.notes || 'Tidak ada catatan khusus mengenai pelanggan ini.'}"
              </div>
            )}
          </div>

          {/* Sidebar Area */}
          <div className="p-8 bg-slate-50/50 rounded-br-2xl rounded-bl-2xl md:rounded-bl-none space-y-8 border-t md:border-t-0 md:border-l border-slate-100">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Alamat Pengiriman</label>
              <p className="text-xs font-semibold leading-relaxed text-slate-600 bg-white p-4 border border-slate-200/60 rounded-xl shadow-sm">
                {customer.address || 'Belum ada alamat terdaftar.'}
              </p>
            </div>
            
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Metrik Keaktifan</label>
              <div className="space-y-3 text-xs font-bold uppercase tracking-wide">
                <div className="flex justify-between py-2 border-b border-slate-200/50">
                  <span className="text-slate-400">Total Transaksi</span>
                  <span className="text-slate-800">{customer.total_order_count || 0}x</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200/50 text-blue-600">
                  <span className="text-slate-400">Total Spend (LTV)</span>
                  <span>{formatIDR(customer.ltv || 0)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200/50">
                  <span className="text-slate-400">Rata-rata Order (AOV)</span>
                  <span className="text-slate-800">{formatIDR(customer.aov || 0)}</span>
                </div>
              </div>
            </div>

            <a 
              href={`https://wa.me/${customer.phone}`} 
              target="_blank" 
              rel="noreferrer"
              className="block w-full bg-[#25D366] hover:bg-[#20ba5a] text-white py-3.5 rounded-xl text-[10px] font-black text-center shadow-md shadow-emerald-100 uppercase tracking-wider transition-all active:scale-95"
            >
              Hubungi via WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}