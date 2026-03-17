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
  const [businesses, setBusinesses] = useState<any[]>([])
  const [activeBid, setActiveBid] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', phone: '' })

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // 1. Ambil Profil (Role & Active ID)
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, active_business_id')
        .eq('id', user.id)
        .single()
      
      setUserRole(profile?.role || 'staff')
      setActiveBid(profile?.active_business_id || null)

      // 2. Ambil Semua Bisnis
      const { data: bizData } = await supabase.from('businesses').select('*')
      setBusinesses(bizData || [])
    }
    setLoading(false)
  }

  async function handleSwitch(bid: string) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('profiles').update({ active_business_id: bid }).eq('id', user?.id)
    setActiveBid(bid)
    window.location.reload()
  }

  async function handleCreate() {
    if (!formData.name) return alert("Nama bisnis wajib diisi")
    const res = await fetch('/api/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
    if (res.ok) {
      setIsCreating(false)
      fetchData()
    }
  }

  if (loading) return <div className="p-20 text-center font-bold text-slate-400 animate-pulse">Loading Headquarters...</div>

  return (
    <div className="max-w-5xl mx-auto p-8 md:p-16 text-[#2e2e2e]">
      {/* HEADER ALO BASECAMP */}
      <header className="text-center mb-16">
        <h1 className="text-4xl font-black tracking-tight mb-2">The Headquarters</h1>
        <p className="text-slate-500 font-medium">Manage your business units and team access.</p>
      </header>

      {isCreating ? (
        <div className="max-w-md mx-auto bg-white border-2 border-slate-900 rounded-3xl p-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.05)]">
          <h2 className="text-2xl font-black mb-6">New Business</h2>
          <div className="space-y-4 mb-8">
            <label className="block font-bold text-sm mb-1">Business Name</label>
            <input 
              type="text" className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold"
              value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
            />
            <label className="block font-bold text-sm mb-1">WhatsApp Number</label>
            <input 
              type="text" className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold"
              value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
            />
          </div>
          <div className="flex gap-4">
            <button onClick={() => setIsCreating(false)} className="flex-1 font-bold text-slate-400">Cancel</button>
            <button onClick={handleCreate} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-black transition-all">Create Now</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {businesses.map((biz) => (
            <div key={biz.id} className={`group bg-white border-2 rounded-[2.5rem] p-10 transition-all ${activeBid === biz.id ? 'border-blue-600 shadow-[10px_10px_0px_0px_rgba(37,99,235,0.1)]' : 'border-slate-200 hover:border-slate-400'}`}>
              <div className="flex justify-between items-start mb-6">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl ${activeBid === biz.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {biz.name.charAt(0)}
                </div>
                {activeBid === biz.id && (
                  <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-blue-100">Active Now</span>
                )}
              </div>

              <h3 className="text-2xl font-black tracking-tight mb-2">{biz.name}</h3>
              <p className="text-slate-500 font-medium text-sm mb-8">{biz.phone || 'No Contact Info'}</p>

              <div className="pt-6 border-t-2 border-slate-50 flex items-center justify-between">
                <div className="flex gap-6">
                  {activeBid !== biz.id ? (
                    <button onClick={() => handleSwitch(biz.id)} className="text-xs font-black text-blue-600 uppercase tracking-widest hover:underline">Switch to This</button>
                  ) : (
                    <span className="text-xs font-black text-green-600 uppercase tracking-widest flex items-center gap-1">✓ Active</span>
                  )}
                  {userRole === 'admin' && (
                    <Link href={`/dashboard/settings/staff?bid=${biz.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest hover:text-slate-900">Manage Staff</Link>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* ADD BUSINESS CARD (ADMIN ONLY) */}
          {userRole === 'admin' && (
            <button 
              onClick={() => setIsCreating(true)}
              className="border-2 border-dashed border-slate-300 rounded-[2.5rem] flex flex-col items-center justify-center p-10 hover:bg-slate-50 hover:border-slate-400 transition-all group"
            >
              <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4 group-hover:bg-slate-900 group-hover:text-white transition-all">
                <span className="text-3xl font-bold">+</span>
              </div>
              <span className="text-sm font-black text-slate-500 uppercase tracking-widest">New Business Unit</span>
            </button>
          )}
        </div>
      )}

      {/* FOOTER INFO */}
      <footer className="mt-20 text-center">
        <div className="inline-block bg-slate-100 rounded-2xl px-6 py-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.2em]">
            Logged in as: <span className="text-slate-900">{userRole}</span>
          </p>
        </div>
      </footer>
    </div>
  )
}