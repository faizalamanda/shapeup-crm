"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'

export default function BusinessSettings() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  const [loading, setLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [business, setBusiness] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null) // State untuk simpan role
  const [formData, setFormData] = useState({ name: '', address: '', phone: '' })

  useEffect(() => {
    fetchBusiness()
  }, [])

  async function fetchBusiness() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*, businesses(*)')
        .eq('id', user.id)
        .single()
      
      if (profile) {
        setUserRole(profile.role) // Simpan role admin/staff
        if (profile.businesses) {
          setBusiness(profile.businesses)
        }
      }
    }
    setLoading(false)
  }

  async function handleCreateBusiness() {
    setIsCreating(true)
    const res = await fetch('/api/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
    
    if (res.ok) {
      await fetchBusiness()
      setIsCreating(false)
    } else {
      alert("Gagal membuat bisnis")
      setIsCreating(false)
    }
  }

  if (loading) return <div className="p-10 text-slate-400 animate-pulse font-bold">Menyinkronkan...</div>

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <header className="mb-10">
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Bisnis</h1>
        <p className="text-slate-500 font-medium">Pusat kendali operasional dan tim Anda.</p>
      </header>

      {!business && !isCreating ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] p-16 text-center">
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Belum Ada Bisnis</h2>
          <button 
            onClick={() => setIsCreating(true)}
            className="mt-8 px-10 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl hover:bg-blue-700 transition-all"
          >
            + Buat Bisnis Baru
          </button>
        </div>
      ) : isCreating ? (
        <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 shadow-sm">
          <h2 className="text-2xl font-black mb-8">Detail Bisnis</h2>
          <div className="space-y-4 mb-8">
            <input 
              type="text" placeholder="Nama Bisnis"
              className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
            <input 
              type="text" placeholder="WhatsApp"
              className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold"
              value={formData.phone}
              onChange={e => setFormData({...formData, phone: e.target.value})}
            />
          </div>
          <div className="flex gap-4">
            <button onClick={() => setIsCreating(false)} className="flex-1 py-4 font-bold text-slate-400">Batal</button>
            <button onClick={handleCreateBusiness} className="flex-2 py-4 bg-blue-600 text-white rounded-2xl font-bold">Simpan</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* KARTU BISNIS AKTIF */}
          <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm relative flex flex-col justify-between">
             <div>
                <div className="flex justify-between items-start mb-6">
                  <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg shadow-blue-100">
                    {business.name.charAt(0)}
                  </div>
                  <span className="bg-green-100 text-green-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Active</span>
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">{business.name}</h3>
                <p className="text-slate-500 font-medium mb-8">{business.phone || 'No Phone'}</p>
             </div>
             
             {/* MENU MANAJEMEN TIM DI DALAM CARD */}
             <div className="pt-6 border-t border-slate-50 flex items-center justify-between">
                <div className="flex gap-4">
                  <button className="text-xs font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors">Edit</button>
                  {userRole === 'admin' && (
                    <Link 
                      href="/settings/staff" 
                      className="text-xs font-black text-blue-600 uppercase tracking-widest flex items-center gap-1 hover:gap-2 transition-all"
                    >
                      Kelola Tim <span>→</span>
                    </Link>
                  )}
                </div>
             </div>
          </div>

          {/* TOMBOL TAMBAH BISNIS (Hanya untuk Admin) */}
          {userRole === 'admin' && (
            <button 
              onClick={() => {
                  setFormData({ name: '', address: '', phone: '' });
                  setIsCreating(true);
              }}
              className="border-2 border-dashed border-slate-200 rounded-[2rem] flex flex-col items-center justify-center p-8 hover:bg-slate-50 transition-all group"
            >
              <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-3 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
                  <span className="text-2xl font-bold">+</span>
              </div>
              <span className="text-sm font-black text-slate-500 uppercase tracking-widest group-hover:text-blue-600">Tambah Bisnis</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}