"use client"
import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function StaffSettings() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [staffList, setStaffList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // State Form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Gunakan useCallback agar fungsi bisa dipanggil berulang dengan aman
  const fetchStaff = useCallback(async () => {
    setLoading(true)
    try {
        const { data: { user } } = await supabase.auth.getUser()
        console.log("1. User Login ID:", user?.id) // DEBUG

        const { data: myProfile } = await supabase
        .from('profiles')
        .select('business_id, role')
        .eq('id', user?.id)
        .single()

        console.log("2. Profile Anda di DB:", myProfile) // DEBUG

        if (myProfile?.business_id) {
        const { data: staff, error: staffError } = await supabase
            .from('profiles')
            .select('*')
            .eq('business_id', myProfile.business_id)
        
        console.log("3. Data Staff yang didapat:", staff) // DEBUG
        
        if (staffError) throw staffError
        setStaffList(staff || [])
        }
    } catch (error) {
        console.error("Error detail:", error)
    } finally {
        setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchStaff()
  }, [fetchStaff])

  async function handleCreateStaff(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: name })
      })

      const result = await res.json()
      
      if (res.ok) {
        alert("Akun Staff berhasil dibuat dan diaktifkan!")
        setIsModalOpen(false)
        setEmail(''); setPassword(''); setName('')
        // Refresh daftar setelah berhasil
        fetchStaff()
      } else {
        alert(result.error || "Gagal membuat staff")
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi ke server")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Manajemen Tim</h1>
          <p className="text-slate-500 font-medium">Kelola akses anggota tim ke dashboard {staffList[0]?.businesses?.name || 'bisnis'}.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 text-white px-7 py-3.5 rounded-2xl font-bold shadow-xl shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
          </svg>
          Tambah Anggota
        </button>
      </header>

      {/* Tabel Staff */}
      <div className="bg-white border border-slate-200/60 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-5 text-xs font-bold text-slate-400 uppercase tracking-widest">Nama Lengkap</th>
                <th className="px-8 py-5 text-xs font-bold text-slate-400 uppercase tracking-widest">Email</th>
                <th className="px-8 py-5 text-xs font-bold text-slate-400 uppercase tracking-widest">Role</th>
                <th className="px-8 py-5 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-8 py-12 text-center text-slate-400 font-medium animate-pulse">
                    Menyinkronkan data tim...
                  </td>
                </tr>
              ) : staffList.length > 0 ? (
                staffList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-5 font-bold text-slate-700">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-sm font-black">
                          {s.full_name?.charAt(0).toUpperCase() || 'S'}
                        </div>
                        {s.full_name || 'Staff Tanpa Nama'}
                      </div>
                    </td>
                    <td className="px-8 py-5 text-slate-500 font-medium">{s.email}</td>
                    <td className="px-8 py-5">
                      <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight ${
                        s.role === 'admin' 
                        ? 'bg-blue-100 text-blue-700' 
                        : 'bg-slate-100 text-slate-600'
                      }`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2 text-green-500 text-xs font-bold">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                        Aktif
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-8 py-20 text-center">
                    <p className="text-slate-400 font-medium">Belum ada staff yang terdaftar.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL FORM */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] p-10 w-full max-w-md shadow-2xl transform transition-all scale-100">
            <div className="text-center mb-8">
               <h2 className="text-3xl font-black text-slate-900 tracking-tight">Tambah Tim</h2>
               <p className="text-slate-500 mt-2 font-medium">Buat kredensial login untuk staff Anda.</p>
            </div>
            
            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1 uppercase tracking-wider">Nama Lengkap</label>
                <input 
                  type="text" placeholder="Contoh: Budi Santoso" required
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-800"
                  value={name} onChange={e => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1 uppercase tracking-wider">Email Kerja</label>
                <input 
                  type="email" placeholder="budi@shapeup.com" required
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-800"
                  value={email} onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1 uppercase tracking-wider">Password Awal</label>
                <input 
                  type="password" placeholder="Min. 6 karakter" required
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-800"
                  value={password} onChange={e => setPassword(e.target.value)}
                />
              </div>

              <div className="flex gap-4 mt-10">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="flex-1 py-4 font-bold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  disabled={submitting} 
                  className="flex-[1.5] py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50"
                >
                  {submitting ? 'Mendaftarkan...' : 'Buat Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}