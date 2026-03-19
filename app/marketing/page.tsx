"use client"
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'

// Data Dummy untuk Skenario
const SCENARIOS = [
  { 
    id: 1, 
    name: 'FOLLOW UP COD BELUM KONFIRMASI', 
    trigger: 'PENDING_PAYMENT', 
    timing: 'DELAY 15 MENIT',
    status: 'ACTIVE',
    sent: 124
  },
  { 
    id: 2, 
    name: 'NOTIFIKASI RESI PENGIRIMAN', 
    trigger: 'SHIPPED', 
    timing: 'IMMEDIATE',
    status: 'ACTIVE',
    sent: 890
  },
  { 
    id: 3, 
    name: 'RE-ORDER REMINDER (30 HARI)', 
    trigger: 'COMPLETED', 
    timing: 'DELAY 30 HARI',
    status: 'PAUSED',
    sent: 45
  }
]

export default function MarketingPage() {
  return (
    <div className="space-y-8">
      {/* HEADER DENGAN TOMBOL KE HALAMAN CREATE */}
      <PageHeader 
        title="MARKETING AUTOMATION" 
        description="Kelola semua skenario pesan otomatis Toko Alamanda di sini."
        action={
          <Link href="/marketing/new">
            <Button variant="primary" className="px-6 shadow-md shadow-blue-100">
              + BUAT SKENARIO BARU
            </Button>
          </Link>
        }
      />

      {/* STATS RINGKAS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-white border-l-4 border-l-blue-600">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Pesan Terkirim</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">1,059</p>
        </Card>
        <Card className="bg-white border-l-4 border-l-green-500">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Skenario Aktif</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">2</p>
        </Card>
        <Card className="bg-white border-l-4 border-l-slate-400">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Success Rate</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">98.2%</p>
        </Card>
      </div>

      {/* TABEL LIST SKENARIO */}
      <section className="space-y-4">
        <div className="px-2">
          <h3 className="font-bold text-slate-800 uppercase tracking-tight">DAFTAR SKENARIO AKTIF</h3>
        </div>
        
        <Card>
          <div className="overflow-x-auto -m-4">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f6f8fa] border-b border-gray-200">
                  <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Nama Skenario</th>
                  <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-nowrap">Trigger & Timing</th>
                  <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Aktivitas</th>
                  <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {SCENARIOS.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-4">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${item.status === 'ACTIVE' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-slate-300'}`}></span>
                    </td>
                    <td className="p-4">
                      <p className="font-bold text-blue-600 text-[14px] uppercase tracking-tight group-hover:underline cursor-pointer">
                        {item.name}
                      </p>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded inline-block w-fit uppercase">
                          {item.trigger}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400 uppercase">
                          {item.timing}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <p className="text-[13px] font-bold text-slate-700 tabular-nums">{item.sent}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Pesan Terkirim</p>
                    </td>
                    <td className="p-4 text-right">
                      <button className="text-slate-400 hover:text-slate-900 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  )
}