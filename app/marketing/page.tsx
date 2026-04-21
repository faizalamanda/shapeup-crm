"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { supabase } from '@/lib/supabase'

const getActiveBusinessId = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('active_business_id')
    .eq('id', user.id)
    .single()

  return data?.active_business_id || null
}

// --- HELPER LOGIC: MODULER & MANUSIAWI ---
const isDateMatch = (orderDateStr: string, filterValue: string, operator: string) => {
  if (!orderDateStr || !filterValue) return false;
  
  const orderDate = new Date(orderDateStr);
  orderDate.setHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Jika operatornya adalah "Setelah X Hari" (berbasis angka)
  if (operator === 'after_x_days') {
    const diffTime = today.getTime() - orderDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays === parseInt(filterValue);
  }

  // Jika operator berbasis kalender (Sama Dengan, Sebelum, Sesudah)
  const filterDate = new Date(filterValue);
  filterDate.setHours(0, 0, 0, 0);

  switch (operator) {
    case 'equal': return orderDate.getTime() === filterDate.getTime();
    case 'before': return orderDate.getTime() < filterDate.getTime();
    case 'after': return orderDate.getTime() > filterDate.getTime();
    default: return true;
  }
};

export default function MarketingPage() {
  const [scenarios, setScenarios] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPreview, setSelectedPreview] = useState<any>(null)
  const [previewList, setPreviewList] = useState<any[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const fetchScenarios = async () => {
    setLoading(true)

    try {
      const activeBusinessId = await getActiveBusinessId()

      if (!activeBusinessId) {
        setScenarios([])
        return
      }

      const { data, error } = await supabase
        .from('marketing_scenarios')
        .select('*')
        .eq('business_id', activeBusinessId)
        .order('created_at', { ascending: false })

      if (error) throw error

      setScenarios(data || [])

    } catch (err: any) {
      console.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchScenarios() }, [])

  // --- LOGIC PREVIEW: DENGAN SORTING TIMESTAMP & FILTER MANUSIAWI ---
  useEffect(() => {
    const getValidAudience = async () => {
      if (!selectedPreview) return;
      setPreviewLoading(true);
      
      try {
        const { data: currentMA } = await supabase
          .from('marketing_scenarios')
          .select('filters')
          .eq('id', selectedPreview.id)
          .single();

        const activeFilters = currentMA?.filters || [];
        
        let query = supabase.from('orders').select('*');

        const statusFilter = activeFilters.find((f: any) => f.key === 'order_status');
        if (statusFilter) {
          if (statusFilter.op === 'is') query = query.eq('status', statusFilter.value);
          if (statusFilter.op === 'is not') query = query.neq('status', statusFilter.value);
        }

        const { data: rawOrders, error: orderError } = await query
          .order('created_at', { ascending: false })
          .limit(500);

        if (orderError) throw orderError;

        if (rawOrders) {
          const filtered = rawOrders.filter((order) => {
            let isMatch = true;
            activeFilters.forEach((f: any) => {
              // 1. Filter Kota
              if (f.key === 'customer_city') {
                const city = (order.raw_source_data?.billing?.city || '').toLowerCase();
                const search = (f.value || '').toLowerCase();
                if (!city.includes(search)) isMatch = false;
              }

              // 2. Filter Order Date
              if (f.key === 'date_order') {
                if (!isDateMatch(order.created_at, f.value, f.op)) isMatch = false;
              }

              // 3. Filter Completed Date
              if (f.key === 'date_completed') {
                const completedAt = order.raw_source_data?.date_completed || order.updated_at;
                if (!isDateMatch(completedAt, f.value, f.op)) isMatch = false;
              }
            });
            return isMatch;
          });

          // Urutan tetap: yang paling baru di atas
          const sorted = filtered.sort((a, b) => {
            const timeA = new Date(a.created_at).getTime();
            const timeB = new Date(b.created_at).getTime();
            return timeB - timeA;
          });

          setPreviewList(sorted.map(d => {
            const raw = d.raw_source_data || {};
            return {
              name: raw.billing?.first_name 
                    ? `${raw.billing.first_name} ${raw.billing.last_name || ''}`.trim() 
                    : 'Customer',
              orderId: `#${raw.number || d.id}`,
              status: (d.status || 'unknown').toUpperCase(),
              time: raw.date_completed || d.created_at
                    ? new Date(raw.date_completed || d.created_at).toLocaleDateString('id-ID') 
                    : '-'
            };
          }));
        }
      } catch (err) {
        console.error("Runtime Error:", err);
      } finally {
        setPreviewLoading(false);
      }
    };

    getValidAudience();
  }, [selectedPreview]);

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`YAKIN INGIN MENGHAPUS SKENARIO: ${name}?`)) {
      const { error } = await supabase.from('marketing_scenarios').delete().eq('id', id)
      if (error) alert("GAGAL HAPUS: " + error.message)
      else fetchScenarios()
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

      <section className="space-y-4">
        <Card>
          <div className="overflow-x-auto -m-4">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f6f8fa] border-b border-gray-200 uppercase text-[10px] text-gray-500 font-black tracking-widest">
                  <th className="p-4">Status</th>
                  <th className="p-4">Nama Skenario</th>
                  <th className="p-4 text-center">Preview</th>
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
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => setSelectedPreview(item)}
                        className="p-2 bg-slate-100 hover:bg-blue-100 text-slate-400 hover:text-blue-600 rounded-md transition-all inline-flex items-center"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-black text-slate-700 bg-slate-100 px-2 py-1 rounded uppercase">
                        {item.trigger_type}
                      </span>
                    </td>
                    <td className="p-4 text-right font-bold text-sm tabular-nums text-slate-400">0</td>
                    <td className="p-4 flex gap-2">
                       <Link href={`/marketing/edit/${item.id}`} className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                       </Link>
                       <button onClick={() => handleDelete(item.id, item.name)} className="p-2 text-slate-400 hover:text-red-600 transition-colors">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                       </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* MODAL PREVIEW AUDIENCE */}
      {selectedPreview && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">Preview Audience</h3>
                  {!previewLoading && (
                    <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                      {previewList.length} DATA
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-wider">Skenario: {selectedPreview.name}</p>
              </div>
              <button onClick={() => setSelectedPreview(null)} className="text-slate-300 hover:text-slate-600 transition-colors text-xl font-light">✕</button>
            </div>
            
            <div className="max-h-[350px] overflow-y-auto">
              {previewLoading ? (
                <div className="p-16 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Menghitung Target Audience...</div>
              ) : (
                <table className="w-full text-left">
                  <tbody className="divide-y divide-slate-50 text-[11px]">
                    {previewList.map((person, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-bold uppercase">
                          {person.name}
                          <span className="text-blue-600 block text-[9px] font-mono tracking-tighter">{person.orderId}</span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[9px] uppercase tracking-tighter italic">
                              {person.status}
                            </span>
                            <span className="font-black text-slate-400 text-[9px] tracking-tighter opacity-60">{person.time}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {previewList.length === 0 && (
                      <tr>
                        <td colSpan={2} className="p-16 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">
                          Tidak ada pesanan ditemukan<br/>dengan kriteria filter ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
              <button onClick={() => setSelectedPreview(null)} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase hover:bg-slate-100 transition-all text-slate-600">Tutup</button>
              <button className="flex-1 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase shadow-lg shadow-slate-200 hover:bg-black transition-all">Test Kirim WA</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}