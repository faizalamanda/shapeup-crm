"use client"
import { useState } from 'react'
import { OrderStats } from './components/OrderStats'
import { OrderTable } from './components/OrderTable'

export default function OrderPage() {
  const [orders] = useState([
    { id: '1001', customer_name: 'Budi Santoso', date: '15 Mar 2026', status: 'Selesai', total_amount: 500000 },
    { id: '1002', customer_name: 'Siti Aminah', date: '15 Mar 2026', status: 'Pending', total_amount: 1250000 },
    { id: '1003', customer_name: 'Andi Wijaya', date: '14 Mar 2026', status: 'Selesai', total_amount: 750000 },
  ])

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-6xl mx-auto">
        
        {/* HEADER */}
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pesanan (Orders)</h1>
            <p className="text-slate-500 text-sm mt-1 font-medium">
              Pantau arus kas dan status pengiriman pesanan pelanggan Anda.
            </p>
          </div>
          <button className="bg-[#2e8540] hover:bg-[#246632] text-white px-5 py-2 rounded font-bold text-sm shadow-sm transition-all">+ Buat Order Baru</button>
        </header>

        {/* STATS */}
        <OrderStats orders={orders} />

        {/* TABLE */}
        {orders.length > 0 ? (
          <OrderTable orders={orders} />
        ) : (
          <div className="p-20 text-center border-2 border-dashed border-slate-300 rounded text-slate-400 font-bold uppercase text-[10px] tracking-widest bg-white">
            Belum ada pesanan masuk hari ini.
          </div>
        )}

      </div>
    </div>
  )
}