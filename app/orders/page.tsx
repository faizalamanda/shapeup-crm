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
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // 1. Ambil Bisnis Aktif
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id, businesses!active_business_id(name)')
        .eq('id', user.id)
        .single()

      if (profile?.active_business_id) {
        setActiveBiz(profile.businesses)

        // 2. Ambil Data Orders Real
        const { data: orderData, error } = await supabase
          .from('orders')
          .select('*')
          .eq('business_id', profile.active_business_id)
          .order('order_date', { ascending: false })

        if (!error) setOrders(orderData || [])
      }
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-[100%] mx-auto">
        
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Pesanan (Orders)</h1>
              <span className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full font-black uppercase">
                📍 {activeBiz?.name || 'Loading...'}
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-1 font-medium">
              Data transaksi real-time dari unit bisnis aktif.
            </p>
          </div>
          <button className="bg-[#2e8540] hover:bg-[#246632] text-white px-5 py-2 rounded font-bold text-sm shadow-sm transition-all">+ Buat Order Baru</button>
        </header>

        {loading ? (
          <div className="p-20 text-center font-bold text-slate-400 animate-pulse">MENYINKRONKAN PESANAN...</div>
        ) : (
          <>
            <OrderStats orders={orders} />
            {orders.length > 0 ? (
              <OrderTable orders={orders} />
            ) : (
              <div className="p-20 text-center border-2 border-dashed border-slate-300 rounded text-slate-400 font-bold uppercase text-[10px] tracking-widest bg-white">
                Belum ada pesanan masuk untuk unit ini.
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}