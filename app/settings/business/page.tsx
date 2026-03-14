"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link' // Tambahkan Link untuk navigasi

export default function BusinessSettings() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  const [loading, setLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [business, setBusiness] = useState<any>(null)
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
      
      if (profile?.businesses) {
        setBusiness(profile.businesses)
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

  if (loading) return (
    <div className="max-w-4xl mx-auto p-10 text-center">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p className="text-slate-400 font-bold tracking-tighter uppercase text-xs">Menyinkronkan data...</p>
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <header className="mb-10">
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Pengaturan Bisnis</h1>
        <p className="text-slate-500 font-medium">Kelola profil perusahaan dan aksesibilitas anggota tim.</p>
      </header>

      {!business && !isCreating ? (
        /* STATE KOSONG */
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] p-16 text-center">
          <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Aktifkan Bisnis Anda</h2>
          <p className="text-slate-500 mt-3 mb-10 max-w-sm mx-auto font-medium leading-relaxed">
            Anda memerlukan profil bisnis aktif untuk mulai mencatat pelanggan dan mengundang staff.
          </p>
          <button 
            onClick={() => setIsCreating(true)}
            className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-200 hover:bg-blue-700 hover:-translate-y-1 transition-all active:translate-y-0"
          >
            + Daftarkan Bisnis Sekarang
          </button>
        </div>
      ) : isCreating ? (
        /* FORM PEMBUATAN */
        <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 shadow-2xl shadow-slate-200/50">
          <h2 className="text-2xl font-black mb-8 text-slate-800">Detail Entitas Bisnis</h2>
          <div className="space-y-6 mb-10">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase ml-1 tracking-widest">Nama Bisnis</label>
              <input 
                type="text"
                className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 outline-none transition-all font-bold text-slate-700"
                placeholder="Misal: ShapeUp Fitness Center"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase ml-1 tracking-widest">WhatsApp / Telepon</label>
              <input 
                type="text"
                className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 outline-none transition-all font-bold text-slate-700"
                placeholder="0812xxxx"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
              />
            </div>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => setIsCreating(false)}
              className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black hover:bg-slate-200 transition-all uppercase text-sm tracking-widest"
            >
              Batal
            </button>
            <button 
              onClick={handleCreateBusiness}
              className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 uppercase text-sm tracking-widest"
            >
              Simpan & Aktifkan
            </button>
          </div>
        </div>
      ) : (
        /* STATE TERDAFTAR */
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Kartu Profil Bisnis */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-6">
                  <div className="flex items-center gap-1.5 bg-green-50 text-green-600 px-3 py-1 rounded-full">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping"></div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Aktif</span>
                  </div>
               </div>
               <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-black text-2xl mb-6 shadow-lg shadow-blue-100">
                 {business.name.charAt(0)}
               </div>
               <h3 className="text-3xl font-black text-slate-800 tracking-tight mb-1">{business.name}</h3>
               <p className="text-slate-500 font-bold mb-8 italic">{business.phone || 'Kontak belum ditambahkan'}</p>
               
               <div className="pt-6 border-t border-slate-50 flex gap-6">
                  <button className="text-xs font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-colors">Edit Detail</button>
                  <button className="text-xs font-black text-slate-300 uppercase tracking-widest hover:text-red-500 transition-colors">Nonaktifkan</button>
               </div>
            </div>

            {/* MENU MENUJU HALAMAN STAFF (GANTI) */}
            <Link 
              href="/settings/staff"
              className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 shadow-xl hover:scale-[1.02] transition-all group relative overflow-hidden"
            >
              <div className="relative z-10 h-full flex flex-col justify-between">
                <div>
                  <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-600 transition-colors">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-black text-white tracking-tight">Manajemen Tim</h3>
                  <p className="text-slate-400 text-sm font-medium mt-1">Kelola akses, tambah staff baru, atau edit role anggota tim.</p>
                </div>
                <div className="text-blue-400 text-xs font-black uppercase tracking-widest flex items-center gap-2 mt-6">
                  Buka Pengaturan Staff 
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>
              </div>
              {/* Background Dekoratif */}
              <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-blue-600/10 rounded-full blur-3xl group-hover:bg-blue-600/20 transition-all"></div>
            </Link>
          </div>

          {/* Tips Tambahan */}
          <div className="bg-blue-50 border border-blue-100 rounded-3xl p-6 flex items-start gap-4">
             <div className="text-xl">💡</div>
             <p className="text-sm text-blue-800 font-medium leading-relaxed">
               Semua staff yang Anda tambahkan melalui menu <b>Manajemen Tim</b> akan secara otomatis memiliki akses terbatas sesuai role mereka ke bisnis <b>{business.name}</b>.
             </p>
          </div>
        </div>
      )}
    </div>
  )
}