"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function BusinessSettings() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  const [loading, setLoading] = useState(true)
  const [businesses, setBusinesses] = useState<any[]>([])
  const [activeBid, setActiveBid] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // Ambil data profil untuk tahu mana yang aktif
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()
      
      setActiveBid(profile?.active_business_id)

      // Ambil semua bisnis yang terhubung dengan user ini
      // (Asumsi ada tabel relasi atau kolom owner_id di businesses)
      const { data: bizData } = await supabase
        .from('businesses')
        .select('*')
      
      setBusinesses(bizData || [])
    }
    setLoading(false)
  }

  async function handleSwitchBusiness(bid: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('profiles')
      .update({ active_business_id: bid })
      .eq('id', user.id)

    if (!error) {
      setActiveBid(bid)
      alert("Berhasil pindah bisnis!")
      window.location.reload() // Refresh agar semua komponen membaca BID baru
    }
  }

  if (loading) return <div className="p-10 font-bold text-slate-400">Loading...</div>

  return (
    <div className="max-w-4xl mx-auto p-8">
      <header className="mb-10">
        <h1 className="text-3xl font-black text-slate-900">Pilih Unit Bisnis</h1>
        <p className="text-slate-500">Pilih bisnis yang ingin Anda kelola saat ini.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {businesses.map((biz) => (
          <div key={biz.id} className={`p-8 rounded-[2rem] border-2 transition-all ${activeBid === biz.id ? 'border-blue-600 bg-blue-50/30' : 'border-slate-100 bg-white'}`}>
            <div className="flex justify-between items-start mb-4">
               <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-lg ${activeBid === biz.id ? 'bg-blue-600' : 'bg-slate-400'}`}>
                 {biz.name.charAt(0)}
               </div>
               {activeBid === biz.id && (
                 <span className="bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Active Now</span>
               )}
            </div>
            
            <h3 className="text-xl font-black text-slate-800">{biz.name}</h3>
            <p className="text-slate-500 text-sm mb-6">{biz.phone}</p>

            {activeBid !== biz.id ? (
              <button 
                onClick={() => handleSwitchBusiness(biz.id)}
                className="w-full py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 hover:bg-slate-50 transition-all"
              >
                Gunakan Bisnis Ini
              </button>
            ) : (
              <div className="w-full py-3 text-center font-bold text-blue-600 bg-blue-100/50 rounded-xl">
                Sedang Digunakan ✅
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}