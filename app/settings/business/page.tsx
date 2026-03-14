"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function BusinessSettings() {
  // Inisialisasi client standar baru
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [business, setBusiness] = useState({ id: '', name: '', address: '', phone: '' })

  useEffect(() => {
    fetchBusiness()
  }, [])

  async function fetchBusiness() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id, businesses(*)')
        .eq('id', user.id)
        .single()
      
      if (profile?.businesses) {
        setBusiness(profile.businesses)
      }
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!business.name) return alert("Nama bisnis wajib diisi")
    setSaving(true)
    const res = await fetch('/api/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(business)
    })
    
    if (res.ok) {
      alert("Pengaturan Bisnis Berhasil Disimpan!")
      fetchBusiness()
    }
    setSaving(false)
  }

  if (loading) return <div className="p-10 text-center text-slate-500">Memuat data...</div>

  return (
    <div className="max-w-2xl mx-auto py-12 px-6 text-black">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">
          {business.id ? 'Profil Bisnis' : 'Daftarkan Bisnis Anda'}
        </h1>
      </div>

      <div className="bg-white rounded-[2.5rem] border-2 border-slate-100 p-10 shadow-sm">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase text-slate-400">Nama Bisnis</label>
            <input 
              value={business.name}
              onChange={e => setBusiness({...business, name: e.target.value})}
              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:border-blue-500 outline-none transition-all"
              placeholder="Nama Toko Anda"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase text-slate-400">WhatsApp Bisnis</label>
            <input 
              value={business.phone}
              onChange={e => setBusiness({...business, phone: e.target.value})}
              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:border-blue-500 outline-none transition-all"
              placeholder="0812..."
            />
          </div>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-3xl font-black uppercase tracking-widest transition-all"
          >
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>
    </div>
  )
}