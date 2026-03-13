"use client"
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function CustomerList() {
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCustomers()
  }, [])

  async function fetchCustomers() {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('ltv', { ascending: false }) // Prioritaskan pelanggan dengan LTV tertinggi

    if (data) setCustomers(data)
    setLoading(false)
  }

  return (
    <div className="p-8 bg-white min-h-screen text-black">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Data Pelanggan (CRM)</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg">+ Tambah Manual</button>
      </div>

      <div className="overflow-x-auto border rounded-xl">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="p-4 font-semibold">Nama / Email</th>
              <th className="p-4 font-semibold text-center">Jml Order</th>
              <th className="p-4 font-semibold text-right">Avg. Sales</th>
              <th className="p-4 font-semibold text-right text-blue-600">LTV</th>
              <th className="p-4 font-semibold text-center">Terakhir Beli</th>
              <th className="p-4 font-semibold text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c: any) => (
              <tr key={c.id} className="border-b hover:bg-slate-50 cursor-pointer">
                <td className="p-4">
                  <div className="font-bold">{c.full_name}</div>
                  <div className="text-xs text-slate-500">{c.email}</div>
                </td>
                <td className="p-4 text-center">{c.total_orders}</td>
                <td className="p-4 text-right">Rp {Number(c.avg_purchase_value).toLocaleString()}</td>
                <td className="p-4 text-right font-bold text-blue-600">Rp {Number(c.ltv).toLocaleString()}</td>
                <td className="p-4 text-center text-sm">
                  {c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString('id-ID') : '-'}
                </td>
                <td className="p-4 text-center">
                  <button className="text-blue-500 hover:underline text-sm">Detail</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && !loading && (
          <div className="p-10 text-center text-slate-400">Belum ada data pelanggan.</div>
        )}
      </div>
    </div>
  )
}