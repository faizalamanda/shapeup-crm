"use client"
import { useState, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export default function BusinessSettings() {
  const supabase = createClientComponentClient()
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
    <div className="max-w-2xl mx-auto py-12 px-6">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">
          {business.id ? 'Profil Bisnis' : 'Daftarkan Bisnis Anda'}
        </h1>
        <p className="text-slate-500 mt-2 text-sm">
          {business.id 
            ? 'Kelola informasi publik dan identitas bisnis Anda.' 
            : 'Mulai langkah awal CRM Anda dengan membuat entitas bisnis.'}
        </p>
      </div>

      <div className="bg-white rounded-[2.5rem] border-2 border-slate-100 shadow-2xl shadow-slate-200/50 p-10">
        <div className="space-y-8">
          <div className="group space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Nama Bisnis / Toko</label>
            <input 
              value={business.name}
              onChange={e => setBusiness({...business, name: e.target.value})}
              placeholder="Contoh: Hijab Style Official"
              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-blue-500 transition-all text-black font-bold"
            />
          </div>

          <div className="group space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Nomor Kontak Bisnis</label>
            <input 
              value={business.phone}
              onChange={e => setBusiness({...business, phone: e.target.value})}
              placeholder="0812..."
              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-blue-500 transition-all text-black font-medium"
            />
          </div>

          <div className="group space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 ml-1">Alamat Kantor/Gudang</label>
            <textarea 
              value={business.address}
              onChange={e => setBusiness({...business, address: e.target.value})}
              placeholder="Jl. Merdeka No. 123..."
              rows={3}
              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-blue-500 transition-all text-black font-medium resize-none"
            />
          </div>

          <button 
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-5 rounded-3xl font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-blue-500/20 ${
              saving ? 'bg-slate-400' : 'bg-blue-600 hover:bg-blue-500 text-white hover:-translate-y-1'
            }`}
          >
            {saving ? 'Menyimpan...' : business.id ? 'Perbarui Data Bisnis' : 'Aktifkan Bisnis Sekarang'}
          </button>
        </div>
      </div>
      
      {business.id && (
        <div className="mt-8 p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-4">
          <div className="bg-blue-500 text-white w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs">ID</div>
          <div>
            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Business UUID</p>
            <code className="text-[11px] text-blue-600 font-mono">{business.id}</code>
          </div>
        </div>
      )}
    </div>
  )
}