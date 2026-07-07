"use client"
import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'

export default function SettingsPage() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null)
  const [loadingActiveBusiness, setLoadingActiveBusiness] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let isMounted = true
    const checkActiveBusiness = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id')
          .eq('id', user.id)
          .single()
        if (isMounted) {
          setActiveBusinessId(profile?.active_business_id || null)
        }
      }
      if (isMounted) {
        setLoadingActiveBusiness(false)
      }
    }
    checkActiveBusiness()
    return () => {
      isMounted = false
    }
  }, [supabase])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // Simulasi simpan data ke Environment atau Database
    setTimeout(() => {
      setLoading(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }, 1500)
  }

  if (loadingActiveBusiness) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center font-black text-slate-400 uppercase tracking-widest animate-pulse">
        Memeriksa Unit Bisnis Aktif...
      </div>
    )
  }

  if (!activeBusinessId) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-6">
        <div className="bg-[#fffdfa] border-4 border-black p-10 text-center space-y-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="w-16 h-16 bg-red-50 border-4 border-black flex items-center justify-center text-3xl mx-auto rounded-full">
            ⚠️
          </div>
          <h2 className="text-3xl font-black uppercase italic tracking-tight text-slate-900 leading-none">
            Bisnis Aktif Tidak Terdeteksi
          </h2>
          <p className="text-sm font-bold text-slate-600 uppercase tracking-widest leading-relaxed">
            Anda harus memilih atau mengaktifkan salah satu unit bisnis terlebih dahulu untuk mengakses Pengaturan Integrasi.
          </p>
          <div className="pt-4">
            <Link 
              href="/settings/business" 
              className="inline-block bg-black text-white font-black uppercase text-xs tracking-widest px-8 py-4 border-4 border-black hover:bg-yellow-200 hover:text-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px]"
            >
              Pilih / Aktifkan Bisnis
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Pengaturan Integrasi</h1>
        <p className="text-sm text-slate-500">Hubungkan ShapeUp CRM dengan platform toko online Anda.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-2xl">🛍️</div>
          <div>
            <h3 className="font-bold text-slate-800">WooCommerce</h3>
            <p className="text-xs text-slate-400">Hubungkan data produk, pelanggan, dan pesanan.</p>
          </div>
          <div className="ml-auto">
            <span className="px-2.5 py-1 bg-green-50 text-green-600 text-[10px] font-bold uppercase rounded-full border border-green-100">Aktif</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">URL Toko (WordPress)</label>
            <input 
              type="url" 
              placeholder="https://tokoanda.com"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Consumer Key</label>
              <input 
                type="text" 
                placeholder="ck_xxxxxxxx..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Consumer Secret</label>
              <input 
                type="password" 
                placeholder="cs_xxxxxxxx..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="pt-4 flex items-center justify-between">
            <p className="text-xs text-slate-400 max-w-[300px]">
              Dapatkan kunci API di menu <b>WooCommerce &gt; Settings &gt; Advanced &gt; REST API</b> pada WordPress Anda.
            </p>
            <button 
              type="submit"
              disabled={loading}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                saved ? 'bg-green-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-200'
              }`}
            >
              {loading ? 'Menyimpan...' : saved ? '✅ Tersimpan' : 'Simpan Koneksi'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-slate-100/50 p-6 rounded-2xl border border-dashed border-slate-300 flex items-center justify-center gap-4 group cursor-not-allowed">
          <span className="text-2xl grayscale group-hover:grayscale-0 transition-all">📦</span>
          <span className="text-sm font-medium text-slate-500">Integrasi Shopify (Coming Soon)</span>
      </div>
    </div>
  )
}