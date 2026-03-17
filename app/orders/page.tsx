"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { OrderStats } from './components/OrderStats'
import { OrderTable } from './components/OrderTable'

export default function OrderPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBiz, setActiveBiz] = useState<any>(null)

  useEffect(() => {
    fetchOrders()
  }, [])

  async function fetchOrders() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id, businesses!active_business_id(name)')
        .eq('id', user.id)
        .single()

      if (profile?.active_business_id) {
        setActiveBiz(profile.businesses)

        // AMBIL DATA DENGAN JOIN KE CUSTOMER_METRICS UNTUK AMBIL NAMA & WA
        const { data: orderData, error } = await supabase
          .from('orders')
          .select(`
            *,
            customer:customer_metrics(name, phone)
          `)
          .eq('business_id', profile.active_business_id)
          .order('order_date', { ascending: false })

        if (error) throw error
        setOrders(orderData || [])
      }
    } catch (err) {
      console.error("Fetch error:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-[100%] mx-auto">
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              Pesanan
              {activeBiz && <span className="text-[10px] bg-blue-600 text-white px-3 py-1 rounded-full uppercase font-black">📍 {activeBiz.name}</span>}
            </h1>
            <p className="text-slate-500 text-sm mt-1 font-medium">Manajemen transaksi dan pengiriman.</p>
          </div>
          <button className="bg-[#2e8540] text-white px-6 py-2 rounded font-bold text-sm shadow-md active:scale-95 transition-all">+ Buat Order</button>
        </header>

        {loading ? (
          <div className="p-20 text-center font-black text-slate-300 animate-pulse tracking-widest uppercase">Sinkronisasi Data...</div>
        ) : (
          <>
            <OrderStats orders={orders} />
            <OrderTable orders={orders} />
          </>
        )}
      </div>
    </div>
  )
}