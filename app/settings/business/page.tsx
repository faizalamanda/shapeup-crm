"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Jakarta', label: 'Indonesia Barat (WIB)' },
  { value: 'Asia/Makassar', label: 'Indonesia Tengah (WITA)' },
  { value: 'Asia/Jayapura', label: 'Indonesia Timur (WIT)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Malaysia' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Bangkok', label: 'Thailand' },
  { value: 'Asia/Manila', label: 'Philippines' },
  { value: 'Asia/Tokyo', label: 'Japan' },
  { value: 'Australia/Sydney', label: 'Australia Sydney' },
  { value: 'Europe/London', label: 'United Kingdom' },
  { value: 'Europe/Amsterdam', label: 'Netherlands' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Chicago', label: 'US Central' },
  { value: 'America/Denver', label: 'US Mountain' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
]

const getTimezoneLabel = (timezone?: string | null) => {
  return TIMEZONE_OPTIONS.find((item) => item.value === timezone)?.label || timezone || 'Asia/Jakarta'
}

type Business = {
  id: string
  name: string
  phone?: string | null
  timezone?: string | null
}

export default function BusinessSettings() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])
  
  const [loading, setLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [activeBid, setActiveBid] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', phone: '', timezone: 'Asia/Jakarta' })
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null)
  const [editFormData, setEditFormData] = useState({ name: '', phone: '', timezone: 'Asia/Jakarta' })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, active_business_id')
        .eq('id', user.id)
        .single()
      
      setUserRole(profile?.role || 'staff')
      setActiveBid(profile?.active_business_id || null)

      // Ambil bisnis yang ditugaskan di business_staff
      const { data: bsData } = await supabase
        .from('business_staff')
        .select('role, businesses (*)')
        .eq('profile_id', user.id)

      // Ambil bisnis milik sendiri (owner)
      const { data: ownedBiz } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)

      // Gabungkan dan pastikan unik berdasarkan ID
      const bizMap = new Map<string, any>()
      bsData?.forEach((item: any) => {
        if (item.businesses) {
          bizMap.set(item.businesses.id, item.businesses)
        }
      })
      ownedBiz?.forEach((biz: any) => {
        bizMap.set(biz.id, biz)
      })

      setBusinesses(Array.from(bizMap.values()))
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchData()
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('create') === 'true') {
        setIsCreating(true)
        const newUrl = window.location.pathname
        window.history.replaceState({}, document.title, newUrl)
      }
    }
  }, [fetchData])

  async function handleSwitch(bid: string) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('profiles').update({ active_business_id: bid }).eq('id', user?.id)
    setActiveBid(bid)
    window.location.reload()
  }

  // --- PERBAIKAN FITUR CREATE ---
  async function handleCreate() {
    if (!formData.name) return alert("Nama bisnis wajib diisi!")
    setSubmitting(true)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Sesi habis, silakan login ulang.")

      // 1. Insert Bisnis Baru dengan owner_id
      const { data: newBiz, error: bizError } = await supabase
        .from('businesses')
        .insert([{ 
          name: formData.name, 
          phone: formData.phone,
          timezone: formData.timezone,
          owner_id: user.id
        }])
        .select()
        .single()

      if (bizError) throw bizError

      // Hubungkan Owner ke business_staff
      const { error: bsError } = await supabase
        .from('business_staff')
        .insert({
          business_id: newBiz.id,
          profile_id: user.id,
          role: 'admin'
        })
      if (bsError) throw bsError

      // 2. Jika ini bisnis pertama, atau user ingin langsung aktifkan
      if (!activeBid) {
        await supabase
          .from('profiles')
          .update({ active_business_id: newBiz.id })
          .eq('id', user.id)
      }

      // 3. Reset & Refresh
      setIsCreating(false)
      setFormData({ name: '', phone: '', timezone: 'Asia/Jakarta' })
      fetchData() // Ambil data terbaru
      alert("Bisnis baru berhasil dibuat!")

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan'
      console.error("Create Error:", message)
      alert("Gagal membuat bisnis: " + message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEditBusiness(biz: Business) {
    setEditingBusiness(biz)
    setEditFormData({
      name: biz.name || '',
      phone: biz.phone || '',
      timezone: biz.timezone || 'Asia/Jakarta',
    })
  }

  async function handleUpdateBusiness() {
    if (!editingBusiness) return
    if (!editFormData.name) return alert("Nama bisnis wajib diisi!")

    setSubmitting(true)

    try {
      const { error } = await supabase
        .from('businesses')
        .update({
          name: editFormData.name,
          phone: editFormData.phone,
          timezone: editFormData.timezone,
        })
        .eq('id', editingBusiness.id)

      if (error) throw error

      setEditingBusiness(null)
      await fetchData()
      alert("Pengaturan bisnis berhasil disimpan!")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan'
      console.error("Update Error:", message)
      alert("Gagal update bisnis: " + message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-20 text-center font-black text-slate-300 uppercase italic">Loading Headquarters...</div>

  return (
    <div className="min-h-screen bg-[#f4f1ea] p-8 md:p-16 text-[#2e2e2e]">
      <div className="max-w-5xl mx-auto">
        
        <header className="text-center mb-16 border-b-4 border-black pb-12">
          <h1 className="text-5xl font-black tracking-tight mb-4 uppercase italic leading-none">The Headquarters</h1>
          <p className="text-lg font-bold text-slate-600 uppercase tracking-widest">Manage Business Units & Access</p>
        </header>

        {!activeBid && (
          <div className="bg-yellow-50 border-4 border-yellow-400 p-6 mb-10 text-center font-bold text-sm uppercase tracking-wider text-yellow-800 animate-pulse">
            ⚠️ Anda belum memilih unit bisnis aktif. Silakan pilih "Switch To This" pada salah satu unit di bawah atau buat unit bisnis baru untuk mengaktifkannya.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-black border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,0.1)]">
          {businesses.filter(biz => !activeBid || biz.id === activeBid).map((biz) => (
            <div 
              key={biz.id} 
              className={`p-10 transition-all ${activeBid === biz.id ? 'bg-[#fffdfa]' : 'bg-white hover:bg-[#fcfaf7]'}`}
            >
              <div className="flex justify-between items-start mb-8">
                <div className={`text-4xl font-black italic ${activeBid === biz.id ? 'text-blue-600' : 'text-slate-300'}`}>
                  {biz.name.substring(0,2).toUpperCase()}
                </div>
                {activeBid === biz.id && (
                  <div className="bg-blue-600 text-white text-[10px] font-black px-4 py-1 uppercase tracking-[0.2em] border-2 border-black">
                    ACTIVE NOW
                  </div>
                )}
              </div>

              <h3 className="text-3xl font-black tracking-tighter mb-2 uppercase leading-none">{biz.name}</h3>
              <div className="space-y-2 mb-10">
                <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">{biz.phone || 'No Contact Data'}</p>
                <p className="text-blue-600 font-black text-[10px] uppercase tracking-widest">
                  TIMEZONE: {getTimezoneLabel(biz.timezone)}
                </p>
              </div>

              <div className="flex flex-wrap gap-6 pt-6 border-t-2 border-slate-100 items-center">
                {activeBid !== biz.id ? (
                  <button onClick={() => handleSwitch(biz.id)} className="text-sm font-black text-blue-600 uppercase tracking-widest hover:underline">Switch To This</button>
                ) : (
                  <span className="text-sm font-black text-green-600 uppercase tracking-widest">✓ Current</span>
                )}
                {userRole === 'admin' && (
                  <>
                    <button onClick={() => openEditBusiness(biz)} className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 hover:bg-yellow-200">Edit Unit</button>
                    <Link href="/settings/staff" className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 hover:bg-yellow-200">Manage Staff</Link>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* MODAL CREATE (BASECAMP STYLE) */}
        {isCreating && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="bg-white border-4 border-black p-10 max-w-md w-full shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]">
              <h2 className="text-3xl font-black uppercase italic mb-8 border-b-4 border-black pb-4 text-center">New Unit</h2>
              <div className="space-y-6 mb-10">
                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest">Business Name</label>
                  <input 
                    type="text" className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50"
                    placeholder="E.G. TOKO ALAMANDA 2"
                    value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest">WA Contact</label>
                  <input 
                    type="text" className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50"
                    placeholder="628..."
                    value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest">Timezone</label>
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
              <div className="flex gap-4">
                <button 
                  disabled={submitting}
                  onClick={() => setIsCreating(false)} 
                  className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  disabled={submitting}
                  onClick={handleCreate} 
                  className="flex-1 bg-black text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-[#2e8540] disabled:bg-slate-400"
                >
                  {submitting ? 'CREATING...' : 'CREATE'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL EDIT */}
        {editingBusiness && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="bg-white border-4 border-black p-10 max-w-md w-full shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]">
              <h2 className="text-3xl font-black uppercase italic mb-8 border-b-4 border-black pb-4 text-center">Edit Unit</h2>
              <div className="space-y-6 mb-10">
                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest">Business Name</label>
                  <input 
                    type="text" className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50"
                    value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest">WA Contact</label>
                  <input 
                    type="text" className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50"
                    value={editFormData.phone} onChange={e => setEditFormData({...editFormData, phone: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block font-black uppercase text-[10px] mb-2 tracking-widest">Timezone</label>
                  <select
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 bg-white"
                    value={editFormData.timezone}
                    onChange={e => setEditFormData({...editFormData, timezone: e.target.value})}
                  >
                    {TIMEZONE_OPTIONS.map((timezone) => (
                      <option key={timezone.value} value={timezone.value}>{timezone.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-4">
                <button 
                  disabled={submitting}
                  onClick={() => setEditingBusiness(null)} 
                  className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  disabled={submitting}
                  onClick={handleUpdateBusiness} 
                  className="flex-1 bg-black text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-[#2e8540] disabled:bg-slate-400"
                >
                  {submitting ? 'SAVING...' : 'SAVE'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
