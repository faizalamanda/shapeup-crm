"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function StaffSettings() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [staffList, setStaffList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null)
  
  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('staff')
  const [submitting, setSubmitting] = useState(false)

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingStaff, setEditingStaff] = useState<any>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('staff')
  const [editSubmitting, setEditSubmitting] = useState(false)

  // Self Password State
  const [myPassword, setMyPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [myPasswordLoading, setMyPasswordLoading] = useState(false)
  const [myPasswordMessage, setMyPasswordMessage] = useState({ text: '', type: '' })

  const fetchStaff = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Get logged in user's profile
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('id, business_id, role, full_name, email')
          .eq('id', user.id)
          .single()

        setCurrentUserProfile(myProfile)

        if (myProfile?.business_id) {
          const { data: staff, error: staffError } = await supabase
            .from('profiles')
            .select('*')
            .eq('business_id', myProfile.business_id)
          
          if (staffError) throw staffError
          setStaffList(staff || [])
        }
      }
    } catch (error) {
      console.error("Error fetching staff:", error)
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
        body: JSON.stringify({ email, password, full_name: name, role })
      })

      const result = await res.json()
      
      if (res.ok) {
        alert("Akun Staff berhasil dibuat!")
        setIsModalOpen(false)
        setEmail(''); setPassword(''); setName(''); setRole('staff')
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

  function openEditModal(staff: any) {
    setEditingStaff(staff)
    setEditName(staff.full_name || '')
    setEditEmail(staff.email || '')
    setEditRole(staff.role || 'staff')
    setEditPassword('') // Blank by default, only updated if entered
    setIsEditModalOpen(true)
  }

  async function handleEditStaff(e: React.FormEvent) {
    e.preventDefault()
    setEditSubmitting(true)

    try {
      const payload: any = {
        id: editingStaff.id,
        full_name: editName,
        email: editEmail,
        role: editRole,
      }
      if (editPassword) {
        payload.password = editPassword
      }

      const res = await fetch('/api/staff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()

      if (res.ok) {
        alert("Informasi staff berhasil diperbarui!")
        setIsEditModalOpen(false)
        setEditingStaff(null)
        setEditName(''); setEditEmail(''); setEditRole('staff'); setEditPassword('')
        fetchStaff()
      } else {
        alert(result.error || "Gagal memperbarui staff")
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi ke server")
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleSelfPasswordUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (myPassword !== confirmPassword) {
      setMyPasswordMessage({ text: 'Konfirmasi password tidak cocok!', type: 'error' })
      return
    }
    if (myPassword.length < 6) {
      setMyPasswordMessage({ text: 'Password minimal harus 6 karakter!', type: 'error' })
      return
    }

    setMyPasswordLoading(true)
    setMyPasswordMessage({ text: '', type: '' })

    try {
      const { error } = await supabase.auth.updateUser({ password: myPassword })
      if (error) throw error

      setMyPasswordMessage({ text: 'Password Anda berhasil diperbarui!', type: 'success' })
      setMyPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setMyPasswordMessage({ text: err.message || 'Gagal memperbarui password', type: 'error' })
    } finally {
      setMyPasswordLoading(false)
    }
  }

  const isAdmin = currentUserProfile?.role === 'admin'

  return (
    <div className="min-h-screen bg-[#f4f1ea] p-4 md:p-8 text-[#2e2e2e]">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <header className="border-b-4 border-black pb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-4xl font-black uppercase italic tracking-tight text-slate-900 leading-none">Manajemen Tim</h1>
            <p className="text-sm font-bold text-slate-600 uppercase tracking-widest mt-2">Kelola akses anggota tim ke dashboard bisnis.</p>
          </div>
          {isAdmin && (
            <button 
              onClick={() => setIsModalOpen(true)}
              className="bg-black text-white font-black uppercase text-xs tracking-widest px-6 py-4 border-4 border-black hover:bg-yellow-200 hover:text-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] cursor-pointer"
            >
              + Tambah Anggota
            </button>
          )}
        </header>

        {/* Tabel Staff */}
        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fffdfa] border-b-4 border-black">
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-black border-r-4 border-black">Nama Lengkap</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-black border-r-4 border-black">Email</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-black border-r-4 border-black">Role</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-black border-r-4 border-black text-center">Status</th>
                  {isAdmin && (
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-black text-right">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={isAdmin ? 5 : 4} className="px-6 py-12 text-center text-slate-400 font-bold uppercase tracking-widest animate-pulse">
                      Menyinkronkan data tim...
                    </td>
                  </tr>
                ) : staffList.length > 0 ? (
                  staffList.map((s) => (
                    <tr key={s.id} className="hover:bg-yellow-50/40 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800 border-r-4 border-black">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 border-2 border-black bg-yellow-200 text-black flex items-center justify-center text-xs font-black uppercase">
                            {s.full_name?.charAt(0).toUpperCase() || 'S'}
                          </div>
                          <span className="truncate">{s.full_name || 'Staff Tanpa Nama'}</span>
                          {s.id === currentUserProfile?.id && (
                            <span className="text-[9px] font-black uppercase bg-black text-white px-1.5 py-0.5 border border-black">Anda</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-bold border-r-4 border-black break-all">{s.email}</td>
                      <td className="px-6 py-4 border-r-4 border-black">
                        {s.role === 'admin' ? (
                          <span className="bg-black text-white text-[9px] font-black px-2 py-0.5 uppercase tracking-widest border-2 border-black">
                            {s.role}
                          </span>
                        ) : (
                          <span className="bg-white text-slate-700 text-[9px] font-black px-2 py-0.5 uppercase tracking-widest border-2 border-slate-400">
                            {s.role || 'staff'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center border-r-4 border-black last:border-r-0">
                        <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-[9px] font-black px-2.5 py-0.5 uppercase tracking-widest border-2 border-green-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse"></span>
                          Aktif
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => openEditModal(s)}
                            className="text-xs font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 hover:bg-yellow-200 px-1 py-0.5 cursor-pointer"
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={isAdmin ? 5 : 4} className="px-6 py-12 text-center text-slate-400 font-bold uppercase">
                      Belum ada staff yang terdaftar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Card Ubah Password Saya */}
        <div className="bg-white border-4 border-black p-8 md:p-10 max-w-xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <h2 className="text-2xl font-black uppercase italic mb-6 border-b-4 border-black pb-3">Ubah Password Saya</h2>
          
          {myPasswordMessage.text && (
            <div className={`p-4 mb-6 border-2 font-bold text-xs uppercase tracking-wider ${
              myPasswordMessage.type === 'success' 
                ? 'bg-green-50 border-green-600 text-green-700' 
                : 'bg-red-50 border-red-600 text-red-700'
            }`}>
              {myPasswordMessage.text}
            </div>
          )}

          <form onSubmit={handleSelfPasswordUpdate} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-xs font-black uppercase tracking-widest">Password Baru</label>
              <input 
                type="password" placeholder="Min. 6 karakter" required
                className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                value={myPassword} onChange={e => setMyPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-black uppercase tracking-widest">Konfirmasi Password Baru</label>
              <input 
                type="password" placeholder="Ulangi password baru" required
                className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              />
            </div>
            <button 
              type="submit" 
              disabled={myPasswordLoading}
              className="bg-black text-white font-black uppercase text-xs tracking-widest py-4 px-6 border-4 border-black hover:bg-yellow-200 hover:text-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] disabled:opacity-50 cursor-pointer w-full md:w-auto"
            >
              {myPasswordLoading ? 'MEMPERBARUI...' : 'UPDATE PASSWORD'}
            </button>
          </form>
        </div>

        {/* MODAL CREATE (BRUTALIST STYLE) */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white border-4 border-black p-8 md:p-10 w-full max-w-md shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] max-h-[90vh] overflow-y-auto">
              <h2 className="text-3xl font-black uppercase italic mb-6 border-b-4 border-black pb-3 text-center">Tambah Tim</h2>
              
              <form onSubmit={handleCreateStaff} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Nama Lengkap</label>
                  <input 
                    type="text" placeholder="Contoh: Budi Santoso" required
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                    value={name} onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Email Kerja</label>
                  <input 
                    type="email" placeholder="budi@shapeup.com" required
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                    value={email} onChange={e => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Password Awal</label>
                  <input 
                    type="password" placeholder="Min. 6 karakter" required
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                    value={password} onChange={e => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Role</label>
                  <select 
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 bg-white text-slate-800 text-sm"
                    value={role} onChange={e => setRole(e.target.value)}
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div className="flex gap-4 pt-6 border-t-4 border-black mt-8">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)} 
                    className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 transition-all cursor-pointer"
                  >
                    Batal
                  </button>
                  <button 
                    type="submit" 
                    disabled={submitting} 
                    className="flex-[1.5] bg-black text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-[#2e8540] hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {submitting ? 'MEMBUAT...' : 'BUAT AKUN'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL EDIT (BRUTALIST STYLE) */}
        {isEditModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white border-4 border-black p-8 md:p-10 w-full max-w-md shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] max-h-[90vh] overflow-y-auto">
              <h2 className="text-3xl font-black uppercase italic mb-6 border-b-4 border-black pb-3 text-center">Edit Tim</h2>
              
              <form onSubmit={handleEditStaff} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Nama Lengkap</label>
                  <input 
                    type="text" required
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                    value={editName} onChange={e => setEditName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Email Kerja</label>
                  <input 
                    type="email" required
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                    value={editEmail} onChange={e => setEditEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Ubah Password (Opsional)</label>
                  <input 
                    type="password" placeholder="Kosongkan jika tidak ingin diubah"
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                    value={editPassword} onChange={e => setEditPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Role</label>
                  <select 
                    className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 bg-white text-slate-800 text-sm"
                    value={editRole} onChange={e => setEditRole(e.target.value)}
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div className="flex gap-4 pt-6 border-t-4 border-black mt-8">
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsEditModalOpen(false)
                      setEditingStaff(null)
                    }} 
                    className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 transition-all cursor-pointer"
                  >
                    Batal
                  </button>
                  <button 
                    type="submit" 
                    disabled={editSubmitting} 
                    className="flex-[1.5] bg-black text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-[#2e8540] hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {editSubmitting ? 'MENYIMPAN...' : 'SIMPAN'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}