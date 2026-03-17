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
    // Supaya session/state di seluruh aplikasi terupdate dengan bisnis baru
    window.location.reload()
  }

  if (loading) return <div className="p-20 text-center font-black text-[#2e2e2e] uppercase italic">Loading Headquarters...</div>

  return (
    <div className="min-h-screen bg-[#f4f1ea] p-8 md:p-16 text-[#2e2e2e]">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER BASECAMP STYLE */}
        <header className="text-center mb-16 border-b-4 border-[#2e2e2e] pb-12">
          <h1 className="text-5xl font-black tracking-tight mb-4 uppercase italic">The Headquarters</h1>
          <p className="text-lg font-bold text-slate-600 uppercase tracking-widest">Manage Business Units & Access</p>
        </header>

        {/* GRID KOTAK-KOTAK TEGAS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#2e2e2e] border-4 border-[#2e2e2e] shadow-[12px_12px_0px_0px_rgba(0,0,0,0.1)]">
          {businesses.map((biz) => (
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
              <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mb-10">{biz.phone || 'No Contact Data'}</p>

              <div className="flex flex-wrap gap-6 pt-6 border-t-2 border-slate-100 items-center">
                {activeBid !== biz.id ? (
                  <button 
                    onClick={() => handleSwitch(biz.id)}
                    className="text-sm font-black text-blue-600 uppercase tracking-widest hover:underline"
                  >
                    Switch To This
                  </button>
                ) : (
                  <span className="text-sm font-black text-green-600 uppercase tracking-widest">✓ Current Business</span>
                )}

                {/* DOUBLE CHECK LINK: SESUAI TARGET shapeup-crm.vercel.app/settings/staff */}
                {userRole === 'admin' && (
                  <Link 
                    href="/settings/staff" 
                    className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 hover:bg-yellow-200 transition-colors"
                  >
                    Manage Staff
                  </Link>
                )}
              </div>
            </div>
          ))}

          {/* ADD BUSINESS SLOT (ADMIN ONLY) */}
          {userRole === 'admin' && (
            <button 
              onClick={() => setIsCreating(true)}
              className="bg-white p-10 flex flex-col items-center justify-center hover:bg-[#fcfaf7] transition-all group border-t-4 border-[#2e2e2e] md:border-t-0"
            >
              <div className="w-16 h-16 border-4 border-dashed border-slate-300 rounded-full flex items-center justify-center mb-4 group-hover:border-black group-hover:bg-black group-hover:text-white transition-all">
                <span className="text-3xl font-black">+</span>
              </div>
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest group-hover:text-black">New Business Unit</span>
            </button>
          )}
        </div>

        {/* FOOTER INFO ROLE */}
        <div className="mt-12 text-center">
          <span className="inline-block border-2 border-black px-4 py-1 text-[10px] font-black uppercase tracking-widest bg-white">
            Access Level: {userRole}
          </span>
        </div>

      </div>
    </div>
  )
}