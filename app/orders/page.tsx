"use client"
import { useState } from 'react'
import { OrderStats } from './components/OrderStats'
import { OrderTable } from './components/OrderTable'

export default function OrderPage() {
  // DUMMY DATA LENGKAP UNTUK 14 KOLOM
  const [orders] = useState([
    { 
      id: '2001', 
      customer_name: 'Budi Santoso', 
      datetime: '15 Mar 2026 - 10:30', 
      wa_number: '628123456789',
      items_detail: 'Kopi Susu Gula Aren (2), Donat Coklat (1)', 
      total_qty: 3,
      subtotal: 75000,
      shipping: 10000,
      discount: 5000,
      other_fee: 0,
      total_order: 80000,
      payment_method: 'Transfer BCA',
      status: 'Selesai'
    },
    { 
      id: '2002', 
      customer_name: 'Siti Aminah', 
      datetime: '15 Mar 2026 - 11:45', 
      wa_number: '628998877665',
      items_detail: 'Hijab Pashmina Silk (5)', 
      total_qty: 5,
      subtotal: 500000,
      shipping: 20000,
      discount: 25000,
      other_fee: 2500, // Biaya COD
      total_order: 497500,
      payment_method: 'COD',
      status: 'Pending'
    },
    { 
      id: '2003', 
      customer_name: 'Andi Wijaya', 
      datetime: '14 Mar 2026 - 09:15', 
      wa_number: '628112233445',
      items_detail: 'Kaos Polos Hitam XL (10)', 
      total_qty: 10,
      subtotal: 1000000,
      shipping: 35000,
      discount: 0,
      other_fee: 0,
      total_order: 1035000,
      payment_method: 'Mandiri Online',
      status: 'Proses'
    },
    { 
      id: '2004', 
      customer_name: 'Rina Retail', 
      datetime: '14 Mar 2026 - 15:00', 
      wa_number: '628556677889',
      items_detail: 'Paket Reseller Skin Care A (1)', 
      total_qty: 1,
      subtotal: 2500000,
      shipping: 0,
      discount: 100000,
      other_fee: 0,
      total_order: 2400000,
      payment_method: 'Transfer BCA',
      status: 'Selesai'
    }
  ])

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-[100%] mx-auto">
        
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pesanan (Orders)</h1>
            <p className="text-slate-500 text-sm mt-1 font-medium">
              Data transaksi harian. Gunakan scroll horizontal untuk rincian biaya.
            </p>
          </div>
          <button className="bg-[#2e8540] hover:bg-[#246632] text-white px-5 py-2 rounded font-bold text-sm shadow-sm transition-all">+ Buat Order Baru</button>
        </header>

        <OrderStats orders={orders} />
        
        {orders.length > 0 ? (
          <OrderTable orders={orders} />
        ) : (
          <div className="p-20 text-center border-2 border-dashed border-slate-300 rounded text-slate-400 font-bold uppercase text-[10px] tracking-widest bg-white">
            Belum ada pesanan.
          </div>
        )}

      </div>
    </div>
  )
}