"use client"
import { useState } from 'react'
import { OrderStats } from './components/OrderStats'
import { OrderTable } from './components/OrderTable'

export default function OrderPage() {
  // DUMMY DATA LENGKAP (14 KOLOM)
  const [orders] = useState([
    { 
      id: '1201', 
      customer_name: 'Budi Santoso', 
      datetime: '15 Mar 2026 - 10:30', 
      wa_number: '628123456789',
      items_detail: 'Kopi Kenangan (2), Roti Bakar (1)', 
      total_qty: 3,
      subtotal: 125000,
      shipping: 15000,
      discount: 10000,
      other_fee: 0,
      total_order: 130000,
      payment_method: 'Transfer BCA',
      status: 'Selesai'
    },
    { 
      id: '1202', 
      customer_name: 'Siti Aminah', 
      datetime: '15 Mar 2026 - 11:15', 
      wa_number: '628998877665',
      items_detail: 'Hijab Pashmina Silk Blue (5)', 
      total_qty: 5,
      subtotal: 750000,
      shipping: 20000,
      discount: 50000,
      other_fee: 2500, // Biaya admin COD
      total_order: 722500,
      payment_method: 'COD',
      status: 'Pending'
    },
    { 
      id: '1203', 
      customer_name: 'Andi Wijaya', 
      datetime: '14 Mar 2026 - 09:00', 
      wa_number: '628112233445',
      items_detail: 'Kaos Polos Hitam XL (10), Kaos Putih L (2)', 
      total_qty: 12,
      subtotal: 1200000,
      shipping: 45000,
      discount: 0,
      other_fee: 0,
      total_order: 1245000,
      payment_method: 'Transfer Mandiri',
      status: 'Proses'
    },
    { 
      id: '1204', 
      customer_name: 'Rina Retail', 
      datetime: '14 Mar 2026 - 14:20', 
      wa_number: '628556677889',
      items_detail: 'Paket Reseller Hemat A (1)', 
      total_qty: 1,
      subtotal: 3500000,
      shipping: 0,
      discount: 250000,
      other_fee: 0,
      total_order: 3250000,
      payment_method: 'Transfer BCA',
      status: 'Selesai'
    }
  ])

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-[100%] mx-auto">
        
        {/* HEADER */}
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Pesanan (Orders)</h1>
              <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">Live</span>
            </div>
            <p className="text-slate-500 text-sm font-medium italic">
              Geser tabel ke kanan untuk melihat rincian biaya lengkap dan metode pembayaran.
            </p>
          </div>
          
          <div className="flex gap-3">
            <button className="bg-white border border-slate-300 text-slate-600 px-5 py-2 rounded font-bold text-sm shadow-sm hover:bg-slate-50 transition-all">
              📥 Export Excel
            </button>
            <button className="bg-[#2e8540] hover:bg-[#246632] text-white px-5 py-2 rounded font-bold text-sm shadow-sm transition-all active:scale-95">
              + Buat Order Baru
            </button>
          </div>
        </header>

        {/* STATS PANEL */}
        <OrderStats orders={orders} />

        {/* COMPACT TABLE WITH DUMMY DATA */}
        {orders.length > 0 ? (
          <OrderTable orders={orders} />
        ) : (
          <div className="p-20 text-center border-2 border-dashed border-slate-300 rounded text-slate-400 font-bold uppercase text-[10px] tracking-widest bg-white">
            Data pesanan tidak ditemukan.
          </div>
        )}

        {/* FOOTER PANDUAN */}
        <div className="mt-6 flex items-center gap-6 text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-orange-100 border border-orange-200 rounded"></span> Pending / Perlu Diproses
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-green-100 border border-green-200 rounded"></span> Selesai / Dikirim
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-blue-100 border border-blue-200 rounded"></span> Sedang Diproses
          </div>
        </div>

      </div>
    </div>
  )
}