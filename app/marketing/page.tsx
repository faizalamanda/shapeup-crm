"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { supabase } from '@/lib/supabase'

export default function MarketingPage() {
  const [scenarios, setScenarios] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchScenarios = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('marketing_scenarios')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setScenarios(data)
    setLoading(false)
  }

  useEffect(() => { fetchScenarios() }, [])

  // FUNGSI DELETE
  const handleDelete = async (id: string, name: string) => {
    if (confirm(`YAKIN INGIN MENGHAPUS SKENARIO: ${name}?`)) {
      const { error } = await supabase
        .from('marketing_scenarios')
        .delete()
        .eq('id', id)
      
      if (error) alert("GAGAL HAPUS: " + error.message)
      else fetchScenarios() // Refresh data
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <PageHeader 
        title="MARKETING AUTOMATION" 
        description="Kelola skenario pesan otomatis Toko Alamanda."
        action={
          <Link href="/marketing/new">
            <Button variant="primary" className="px-6 shadow-md font-black text-xs uppercase">
              + BUAT BARU
            </Button>
          </Link>
        }
      />

      {/* STATS tetap sama ... */}

      <section className="space-y-4">
        <Card>
          <div className="overflow-x-auto -m-4">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f6f8fa] border-b border-gray-200 uppercase text-[10px] text-gray-500 font-black tracking-widest">
                  <th className="p-4">Status</th>
                  <th className="p-4">Nama Skenario</th>
                  <th className="p-4">Trigger</th>
                  <th className="p-4 text-right">Aktivitas</th>
                  <th className="p-4">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scenarios.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 group transition-colors">
                    <td className="p-4">
                      <span className={`inline-block w-2 h-2 rounded-full ${item.is_active ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-slate-300'}`}></span>
                    </td>
                    <td className="p-4">
                      <Link href={`/marketing/edit/${item.id}`} className="font-bold text-blue-600 text-sm uppercase hover:underline">
                        {item.name}
                      </Link>
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-black text-slate-700 bg-slate-100 px-2 py-1 rounded uppercase">
                        {item.trigger_type}
                      </span>
                    </td>
                    <td className="p-4 text-right font-bold text-sm tabular-nums">0</td>
                    <td className="p-4">
                      <div className="flex gap-2">
                         <Link href={`/marketing/edit/${item.id}`} className="p-2 text-slate-400 hover:text-blue-600">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                         </Link>
                         <button onClick={() => handleDelete(item.id, item.name)} className="p-2 text-slate-400 hover:text-red-600">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                         </button>
                      </div>
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