"use client"
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'

export default function StaffSettings() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  const [loading, setLoading] = useState(true)
  const [staffList, setStaffList] = useState<any[]>([])
  const [activeBiz, setActiveBiz] = useState<any>(null)
  const [emailInvite, setEmailInvite] = useState('')

  useEffect(() => {
    fetchStaffData()
  }, [])

  async function fetchStaffData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // 1. Cek Bisnis mana yang sedang Aktif di Profil User
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id, businesses!active_business_id(name, id)')
        .eq('id', user.id)
        .single()

      if (profile?.active_business_id) {
        setActiveBiz(profile.businesses)

        // 2. Ambil semua profil yang memiliki business_id yang sama
        const { data: staff } = await supabase
          .from('profiles')
          .select('*')
          .eq('active_business_id', profile.active_business_id)
        
        setStaffList(staff || [])
      }
    }
    setLoading(false)
  }

  async function handleAddStaff() {
    if (!emailInvite) return alert("Masukkan email staff")
    // Logika invite atau tambah staff ke database profiles
    alert("Fitur invite email " + emailInvite + " sedang diproses")
    setEmailInvite('')
  }

  if (loading) return <div className="p-20 text-center font-black text-slate-400">LOADING TEAM...</div>

  return (
    <div className="min-h-screen bg-[#f4f1ea] p-8 md:p-16 text-[#2e2e2e]">
      <div className="max-w-4xl mx-auto">
        
        {/* BREADCRUMB / BACK LINK */}
        <Link href="/settings/business" className="inline-block mb-6 font-black uppercase text-[10px] tracking-widest border-b-2 border-black pb-1 hover:bg-yellow-200">
          ← Back to Headquarters
        </Link>

        {/* HEADER BASECAMP STYLE */}
        <header className="border-4 border-black bg-white p-10 mb-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-black uppercase italic tracking-tighter leading-none mb-2">Team Access</h1>
              <p className="font-bold text-slate-500 uppercase text-xs tracking-[0.2em]">
                Managing staff for: <span className="text-blue-600">{activeBiz?.name}</span>
              </p>
            </div>
            <div className="bg-black text-white px-4 py-2 font-black text-[10px] uppercase tracking-widest">
              Staff Count: {staffList.length}
            </div>
          </div>
        </header>

        {/* ADD STAFF FORM (BASECAMP CARD) */}
        <section className="border-4 border-black bg-white p-8 mb-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,0.05)]">
          <h2 className="text-xl font-black uppercase italic mb-6">Invite New Staff</h2>
          <div className="flex flex-col md:flex-row gap-4">
            <input 
              type="email" 
              placeholder="Enter staff email address..."
              className="flex-1 p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 placeholder:text-slate-300"
              value={emailInvite}
              onChange={(e) => setEmailInvite(e.target.value)}
            />
            <button 
              onClick={handleAddStaff}
              className="bg-[#2e8540] text-white px-10 py-4 font-black uppercase tracking-widest border-4 border-black hover:bg-black transition-all active:translate-y-1"
            >
              Add to Team
            </button>
          </div>
          <p className="mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            * Staff will be automatically linked to the active business unit.
          </p>
        </section>

        {/* STAFF LIST TABLE STYLE */}
        <div className="border-4 border-black bg-white overflow-hidden shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black text-white text-[10px] font-black uppercase tracking-[0.2em]">
                <th className="p-5 border-r border-white/20">Name / Identity</th>
                <th className="p-5 border-r border-white/20">Role</th>
                <th className="p-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y-4 divide-black">
              {staffList.map((staff) => (
                <tr key={staff.id} className="hover:bg-yellow-50 transition-colors group">
                  <td className="p-6">
                    <p className="font-black text-lg uppercase leading-none mb-1">{staff.full_name || 'Anonymous Staff'}</p>
                    <p className="text-xs font-bold text-slate-400">{staff.email}</p>
                  </td>
                  <td className="p-6">
                    <span className={`inline-block px-3 py-1 border-2 border-black font-black text-[10px] uppercase tracking-widest ${staff.role === 'admin' ? 'bg-yellow-300' : 'bg-slate-100'}`}>
                      {staff.role}
                    </span>
                  </td>
                  <td className="p-6 text-right">
                    <button className="text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-600 hover:text-white border-2 border-red-600 px-3 py-1 transition-all">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}