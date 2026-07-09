"use client"
import { useState, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Jakarta', label: 'Indonesia Barat (WIB)' },
  { value: 'Asia/Makassar', label: 'Indonesia Tengah (WITA)' },
  { value: 'Asia/Jayapura', label: 'Indonesia Timur (WIT)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Malaysia' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Bangkok', label: 'Thailand' },
  { value: 'Asia/Manila', label: 'Philippines' },
]

const INDUSTRIES = [
  { id: 'retail', name: 'Retail / E-commerce', icon: '📦' },
  { id: 'fnb', name: 'Food & Beverage', icon: '🍔' },
  { id: 'services', name: 'Services / Jasa', icon: '🛠️' },
  { id: 'other', name: 'Lainnya', icon: '✨' },
]

type OnboardingProps = {
  onLogout: () => Promise<void>
}

export default function BusinessOnboarding({ onLogout }: OnboardingProps) {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    timezone: 'Asia/Jakarta',
    industry: 'retail',
  })
  const [submitting, setSubmitting] = useState(false)
  const [initProgress, setInitProgress] = useState<string[]>([])
  const [currentProgressText, setCurrentProgressText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

  const handleCreateBusiness = async () => {
    if (!formData.name.trim()) {
      setErrorMsg("Nama bisnis wajib diisi!")
      return
    }
    setErrorMsg("")
    setSubmitting(true)
    setStep(3)

    try {
      // Step 3-1: Get user session
      setCurrentProgressText("Menghubungkan sesi pengguna...")
      await delay(800)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Sesi habis, silakan login ulang.")
      setInitProgress(prev => [...prev, 'user'])

      // Step 3-2: Insert Business
      setCurrentProgressText("Mendaftarkan unit bisnis baru...")
      await delay(1000)
      const { data: newBiz, error: bizError } = await supabase
        .from('businesses')
        .insert([{ 
          name: formData.name.trim(), 
          phone: formData.phone.trim() || null,
          timezone: formData.timezone,
          owner_id: user.id
        }])
        .select()
        .single()

      if (bizError) throw bizError
      setInitProgress(prev => [...prev, 'biz'])

      // Step 3-3: Setup staff/admin role
      setCurrentProgressText("Menyusun sistem staff & admin...")
      await delay(1000)
      const { error: bsError } = await supabase
        .from('business_staff')
        .insert({
          business_id: newBiz.id,
          profile_id: user.id,
          role: 'admin'
        })
      if (bsError) throw bsError
      setInitProgress(prev => [...prev, 'staff'])

      // Step 3-4: Sync active business ID to profile
      setCurrentProgressText("Menyinkronkan data profil...")
      await delay(800)
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ active_business_id: newBiz.id })
        .eq('id', user.id)
      if (profileError) throw profileError
      setInitProgress(prev => [...prev, 'profile'])

      setCurrentProgressText("Semua siap! Mengalihkan ke dashboard...")
      await delay(1200)

      // Reload page to refresh all layouts and context
      window.location.reload()
    } catch (err: any) {
      console.error("Onboarding Error:", err)
      setErrorMsg(err.message || "Gagal membuat bisnis, silakan coba lagi.")
      setSubmitting(false)
      setStep(2) // Fallback to form step on error
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f1ea] flex flex-col items-center justify-center p-6 md:p-12 text-[#2e2e2e]">
      <div className="w-full max-w-xl bg-white border-4 border-black p-8 md:p-12 shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] relative transition-all duration-300">
        
        {/* Decorative corner tag */}
        <div className="absolute -top-4 -right-4 bg-yellow-400 text-black border-2 border-black font-black uppercase text-[10px] px-3 py-1 tracking-widest shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          ShapeUp CRM
        </div>

        {/* STEP 1: WELCOME */}
        {step === 1 && (
          <div className="space-y-8">
            <div className="text-center md:text-left">
              <h1 className="text-4xl md:text-5xl font-black uppercase italic leading-none tracking-tight mb-4">
                Selamat Datang!
              </h1>
              <p className="text-sm font-bold text-slate-600 uppercase tracking-widest">
                LANGKAH PERTAMA MEMULAI BISNIS ANDA
              </p>
            </div>

            <div className="h-1 bg-black w-full" />

            <div className="space-y-6">
              <p className="text-base font-bold text-slate-700 leading-relaxed">
                Mari hubungkan toko atau unit bisnismu untuk mulai mengelola pesanan, pelanggan, produk, hingga laporan keuangan secara otomatis dalam satu dashboard terintegrasi.
              </p>

              <div className="grid grid-cols-1 gap-4 pt-2">
                <div className="border-2 border-black p-4 bg-yellow-50 flex items-start gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <span className="text-2xl">📦</span>
                  <div>
                    <h4 className="font-extrabold uppercase text-xs tracking-wider">Order & Invoice Tracking</h4>
                    <p className="text-xs text-slate-600 mt-1 font-semibold">Tarik data penjualan WooCommerce, POS, & transaksi manual secara otomatis.</p>
                  </div>
                </div>

                <div className="border-2 border-black p-4 bg-blue-50 flex items-start gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <span className="text-2xl">👥</span>
                  <div>
                    <h4 className="font-extrabold uppercase text-xs tracking-wider">Customer Retention & LTV</h4>
                    <p className="text-xs text-slate-600 mt-1 font-semibold">Pantau loyalitas pelanggan, cohort belanja, & tingkat pengembalian order.</p>
                  </div>
                </div>

                <div className="border-2 border-black p-4 bg-emerald-50 flex items-start gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <span className="text-2xl">⚖️</span>
                  <div>
                    <h4 className="font-extrabold uppercase text-xs tracking-wider">Double-Entry Ledger</h4>
                    <p className="text-xs text-slate-600 mt-1 font-semibold">Pembukuan otomatis dengan standar akuntansi yang presisi untuk bisnis Anda.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-6">
              <button
                onClick={() => onLogout()}
                className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 transition-all active:translate-y-0.5"
              >
                Logout
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 bg-[#2563EB] text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-blue-700 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all active:translate-y-0.5 active:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              >
                Setup Bisnis Saya ➜
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: BUSINESS DETAILS FORM */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-black uppercase italic leading-none tracking-tight">
                Detail Bisnis Anda
              </h2>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">
                Lengkapi data dasar untuk menginisialisasi workspace
              </p>
            </div>

            <div className="h-1 bg-black w-full" />

            {errorMsg && (
              <div className="bg-red-50 border-2 border-red-500 text-red-700 p-4 font-bold text-xs uppercase tracking-wider">
                ⚠️ {errorMsg}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className="block font-black uppercase text-[10px] mb-2 tracking-widest text-slate-700">Nama Bisnis / Toko <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 placeholder-slate-400"
                  placeholder="E.G. TOKO ALAMANDA SEJAHTERA"
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest text-slate-700">Kontak WA Bisnis</label>
                  <input 
                    type="text" 
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 placeholder-slate-400"
                    placeholder="Contoh: 628123456789"
                    value={formData.phone} 
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest text-slate-700">Zona Waktu</label>
                  <select
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 bg-white"
                    value={formData.timezone}
                    onChange={e => setFormData({...formData, timezone: e.target.value})}
                  >
                    {TIMEZONE_OPTIONS.map((timezone) => (
                      <option key={timezone.value} value={timezone.value}>{timezone.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-black uppercase text-[10px] mb-3 tracking-widest text-slate-700">Kategori / Bidang Industri</label>
                <div className="grid grid-cols-2 gap-3">
                  {INDUSTRIES.map((ind) => {
                    const isSelected = formData.industry === ind.id
                    return (
                      <button
                        key={ind.id}
                        type="button"
                        onClick={() => setFormData({...formData, industry: ind.id})}
                        className={`p-4 border-2 border-black flex flex-col items-center justify-center gap-2 font-black text-xs uppercase tracking-wider transition-all duration-150 ${
                          isSelected 
                            ? 'bg-yellow-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' 
                            : 'bg-white hover:bg-slate-50 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        }`}
                      >
                        <span className="text-2xl">{ind.icon}</span>
                        <span>{ind.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-6">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 transition-all active:translate-y-0.5"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleCreateBusiness}
                className="flex-1 bg-[#16A34A] text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-green-700 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all active:translate-y-0.5 active:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              >
                Buat Bisnis Baru ➜
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: LOADING / INITIALIZATION PROCESS */}
        {step === 3 && (
          <div className="space-y-8 py-4">
            <div className="text-center">
              <h2 className="text-3xl font-black uppercase italic leading-none tracking-tight mb-2">
                Menyiapkan Bisnis Anda
              </h2>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Harap tunggu selagi kami mengkonfigurasi sistem
              </p>
            </div>

            <div className="h-1 bg-black w-full" />

            {/* Micro progress animation */}
            <div className="space-y-4 max-w-sm mx-auto">
              <div className="flex items-center gap-3 font-bold text-sm">
                <span className={initProgress.includes('user') ? 'text-green-600' : 'text-slate-400'}>
                  {initProgress.includes('user') ? '✓' : '●'}
                </span>
                <span className={initProgress.includes('user') ? 'line-through text-slate-400 font-semibold' : 'text-slate-800'}>
                  Menghubungkan sesi pengguna
                </span>
              </div>

              <div className="flex items-center gap-3 font-bold text-sm">
                <span className={initProgress.includes('biz') ? 'text-green-600' : 'text-slate-400'}>
                  {initProgress.includes('biz') ? '✓' : '●'}
                </span>
                <span className={initProgress.includes('biz') ? 'line-through text-slate-400 font-semibold' : 'text-slate-800'}>
                  Mendaftarkan unit bisnis baru
                </span>
              </div>

              <div className="flex items-center gap-3 font-bold text-sm">
                <span className={initProgress.includes('staff') ? 'text-green-600' : 'text-slate-400'}>
                  {initProgress.includes('staff') ? '✓' : '●'}
                </span>
                <span className={initProgress.includes('staff') ? 'line-through text-slate-400 font-semibold' : 'text-slate-800'}>
                  Menyusun sistem staff & admin
                </span>
              </div>

              <div className="flex items-center gap-3 font-bold text-sm">
                <span className={initProgress.includes('profile') ? 'text-green-600' : 'text-slate-400'}>
                  {initProgress.includes('profile') ? '✓' : '●'}
                </span>
                <span className={initProgress.includes('profile') ? 'line-through text-slate-400 font-semibold' : 'text-slate-800'}>
                  Menyinkronkan data profil
                </span>
              </div>
            </div>

            {/* Spinner and Status Indicator */}
            <div className="flex flex-col items-center justify-center gap-3 pt-4">
              <div className="w-8 height-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin h-8" />
              <span className="font-extrabold uppercase text-[10px] tracking-widest text-slate-500 animate-pulse">
                {currentProgressText}
              </span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
