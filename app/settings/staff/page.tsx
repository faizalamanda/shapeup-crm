"use client"
import { useState, useEffect } from 'react'
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

  useEffect(() => {
    fetchStaff()
  }, [])

  async function fetchStaff() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    if (profile?.business_id) {
      const { data: staff } = await supabase
        .from('profiles')
        .select('*')
        .eq('business_id', profile.business_id)
      
      if (staff) setStaffList(staff)
    }
    setLoading(false)
  }

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
        alert("Staff berhasil dibuat!")
        setIsModalOpen(false)
        setEmail(''); setPassword(''); setName('')
        fetchStaff()
      } else {
        alert(result.error || "Gagal membuat staff")
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Manajemen Tim</h1>
          <p className="text-slate-500 font-medium">Buat akun untuk karyawan Anda.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
        >
          + Tambah Staff
        </button>
      </header>

      {/* Tabel Staff */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Nama</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Email</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {staffList.map((s) => (
              <tr key={s.id}>
                <td className="px-6 py-4 font-bold text-slate-700">{s.full_name || 'Staff'}</td>
                <td className="px-6 py-4 text-slate-500">{s.email}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${s.role === 'admin' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                    {s.role}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL FORM */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-black mb-6">Tambah Staff Baru</h2>
            <form onSubmit={handleCreateStaff} className="space-y-4">
              <input 
                type="text" placeholder="Nama Lengkap" required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                value={name} onChange={e => setName(e.target.value)}
              />
              <input 
                type="email" placeholder="Email Staff" required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                value={email} onChange={e => setEmail(e.target.value)}
              />
              <input 
                type="password" placeholder="Password untuk Staff" required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                value={password} onChange={e => setPassword(e.target.value)}
              />
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 font-bold text-slate-500">Batal</button>
                <button type="submit" disabled={submitting} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">
                  {submitting ? 'Menyimpan...' : 'Buat Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}