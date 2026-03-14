"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

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
      // Ambil bisnis yang dimiliki user ini
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
    }
  }

  if (loading) return <div className="p-10 text-slate-400 animate-pulse">Memuat data...</div>

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Bisnis Anda</h1>
        <p className="text-slate-500 font-medium">Kelola entitas bisnis dan operasional tim.</p>
      </header>

      {!business && !isCreating ? (
        /* STATE KOSONG */
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center">
          <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800">Belum Ada Bisnis Terdaftar</h2>
          <p className="text-slate-500 mt-2 mb-8 max-w-sm mx-auto">
            Anda belum memiliki bisnis yang terhubung. Buat bisnis pertama Anda untuk mulai mengelola pelanggan dan pesanan.
          </p>
          <button 
            onClick={() => setIsCreating(true)}
            className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
          >
            + Buat Bisnis Baru
          </button>
        </div>
      ) : isCreating ? (
        /* FORM PEMBUATAN */
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
          <h2 className="text-xl font-bold mb-6">Detail Bisnis Baru</h2>
          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Nama Bisnis</label>
              <input 
                type="text"
                className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                placeholder="Misal: ShapeUp Fitness Center"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">WhatsApp / Phone</label>
              <input 
                type="text"
                className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                placeholder="0812xxxx"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setIsCreating(false)}
              className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
            >
              Batal
            </button>
            <button 
              onClick={handleCreateBusiness}
              className="flex-2 px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
            >
              Simpan & Aktifkan
            </button>
          </div>
        </div>
      ) : (
        /* STATE TERDAFTAR */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4">
                <span className="bg-green-100 text-green-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Active</span>
             </div>
             <div className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center font-bold text-xl mb-4">
               {business.name.charAt(0)}
             </div>
             <h3 className="text-2xl font-black text-slate-800">{business.name}</h3>
             <p className="text-slate-500 font-medium mb-6">{business.phone || 'No phone added'}</p>
             
             <div className="pt-6 border-t border-slate-100 flex gap-4">
                <button className="text-sm font-bold text-blue-600 hover:underline">Edit Detail</button>
                <button className="text-sm font-bold text-slate-400 hover:text-red-500 transition-colors">Nonaktifkan</button>
             </div>
          </div>

          {/* Tombol Tambah Lagi (Untuk Multi-Business di masa depan) */}
          <button 
            onClick={() => {
                setFormData({ name: '', address: '', phone: '' });
                setIsCreating(true);
            }}
            className="border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center p-8 hover:bg-slate-50 transition-all group"
          >
            <div className="w-10 h-10 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-2 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all">
                <span className="text-2xl font-bold">+</span>
            </div>
            <span className="text-sm font-bold text-slate-500 group-hover:text-blue-600">Tambah Bisnis Lain</span>
          </button>
        </div>
      )}
    </div>
  )
}