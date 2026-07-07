"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'

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
  const [createMessage, setCreateMessage] = useState({ text: '', type: '' })

  // State for dynamic email check
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [emailExists, setEmailExists] = useState<boolean | null>(null)
  const [emailAlreadyInBusiness, setEmailAlreadyInBusiness] = useState<boolean | null>(null)
  const [existingUserName, setExistingUserName] = useState('')

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingStaff, setEditingStaff] = useState<any>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('staff')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editMessage, setEditMessage] = useState({ text: '', type: '' })

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState<any>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState({ text: '', type: '' })

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
          .select('id, business_id, active_business_id, role, full_name, email')
          .eq('id', user.id)
          .single()

        setCurrentUserProfile(myProfile)

        if (myProfile?.active_business_id) {
          const res = await fetch('/api/staff')
          if (!res.ok) {
            const errData = await res.json()
            throw new Error(errData.error || "Gagal mengambil data staff")
          }
          const { staff } = await res.json()
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

  // Debounce email check
  useEffect(() => {
    if (!email || !email.includes('@')) {
      setEmailExists(null)
      setEmailAlreadyInBusiness(null)
      setExistingUserName('')
      return
    }

    const delayDebounceFn = setTimeout(async () => {
      setCheckingEmail(true)
      try {
        const res = await fetch(`/api/staff?email=${encodeURIComponent(email)}`)
        if (res.ok) {
          const data = await res.json()
          if (data.exists) {
            setEmailExists(true)
            setEmailAlreadyInBusiness(data.alreadyInBusiness)
            setExistingUserName(data.full_name || '')
            setName(data.full_name || '')
          } else {
            setEmailExists(false)
            setEmailAlreadyInBusiness(false)
            setExistingUserName('')
          }
        }
      } catch (err) {
        console.error("Error checking email:", err)
      } finally {
        setCheckingEmail(false)
      }
    }, 500)

    return () => clearTimeout(delayDebounceFn)
  }, [email])

  async function handleCreateStaff(e: React.FormEvent) {
    e.preventDefault()
    if (!emailExists && password.length < 6) {
      setCreateMessage({ text: 'Password minimal harus 6 karakter!', type: 'error' })
      return
    }
    setSubmitting(true)
    setCreateMessage({ text: '', type: '' })

    try {
      const payload: any = {
        email,
        full_name: name,
        role
      }
      if (!emailExists) {
        payload.password = password
      }

      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()
      
      if (res.ok) {
        setCreateMessage({ 
          text: emailExists 
            ? 'Staf yang ada berhasil ditambahkan ke unit bisnis ini!' 
            : 'Akun Staff berhasil dibuat!', 
          type: 'success' 
        })
        setEmail(''); setPassword(''); setName(''); setRole('staff')
        setEmailExists(null); setEmailAlreadyInBusiness(null); setExistingUserName('')
        fetchStaff()
        setTimeout(() => {
          setIsModalOpen(false)
          setCreateMessage({ text: '', type: '' })
        }, 1500)
      } else {
        setCreateMessage({ text: result.error || "Gagal membuat staff", type: 'error' })
      }
    } catch (err) {
      setCreateMessage({ text: "Terjadi kesalahan koneksi ke server", type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  function openEditModal(staff: any) {
    setEditMessage({ text: '', type: '' })
    setEditingStaff(staff)
    setEditName(staff.full_name || '')
    setEditEmail(staff.email || '')
    setEditRole(staff.role || 'staff')
    setEditPassword('') // Blank by default, only updated if entered
    setIsEditModalOpen(true)
  }

  async function handleEditStaff(e: React.FormEvent) {
    e.preventDefault()
    if (editPassword && editPassword.length < 6) {
      setEditMessage({ text: 'Password minimal harus 6 karakter!', type: 'error' })
      return
    }
    setEditSubmitting(true)
    setEditMessage({ text: '', type: '' })

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
        setEditMessage({ text: "Informasi staff berhasil diperbarui!", type: 'success' })
        setEditName(''); setEditEmail(''); setEditRole('staff'); setEditPassword('')
        fetchStaff()
        setTimeout(() => {
          setIsEditModalOpen(false)
          setEditingStaff(null)
          setEditMessage({ text: '', type: '' })
        }, 1500)
      } else {
        setEditMessage({ text: result.error || "Gagal memperbarui staff", type: 'error' })
      }
    } catch (err) {
      setEditMessage({ text: "Terjadi kesalahan koneksi ke server", type: 'error' })
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

  function handleRemoveStaff(staff: any) {
    setDeleteMessage({ text: '', type: '' })
    setDeletingStaff(staff)
    setIsDeleteModalOpen(true)
  }

  async function executeRemoveStaff() {
    if (!deletingStaff) return
    setDeleteSubmitting(true)
    setDeleteMessage({ text: '', type: '' })

    try {
      const res = await fetch(`/api/staff?id=${deletingStaff.id}`, {
        method: 'DELETE'
      })

      const result = await res.json()

      if (res.ok) {
        setDeleteMessage({ text: "Staf berhasil dikeluarkan dari unit bisnis ini!", type: 'success' })
        fetchStaff()
        setTimeout(() => {
          setIsDeleteModalOpen(false)
          setDeletingStaff(null)
          setDeleteMessage({ text: '', type: '' })
        }, 1500)
      } else {
        setDeleteMessage({ text: result.error || "Gagal mengeluarkan staf", type: 'error' })
      }
    } catch (err) {
      setDeleteMessage({ text: "Terjadi kesalahan koneksi ke server", type: 'error' })
    } finally {
      setDeleteSubmitting(false)
    }
  }

  if (!loading && !currentUserProfile?.active_business_id) {
    return (
      <div className="min-h-screen bg-[#f4f1ea] p-4 md:p-8 text-[#2e2e2e] flex items-center justify-center">
        <div className="bg-white border-4 border-black p-10 text-center space-y-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-xl">
          <div className="w-16 h-16 bg-red-100 border-4 border-black flex items-center justify-center text-3xl mx-auto rounded-full">
            ⚠️
          </div>
          <h2 className="text-3xl font-black uppercase italic tracking-tight text-slate-900 leading-none">
            Bisnis Aktif Tidak Terdeteksi
          </h2>
          <p className="text-sm font-bold text-slate-600 uppercase tracking-widest leading-relaxed">
            Anda harus memilih atau mengaktifkan salah satu unit bisnis terlebih dahulu untuk mengakses Manajemen Tim.
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
              onClick={() => {
                setCreateMessage({ text: '', type: '' })
                setEmail('')
                setPassword('')
                setName('')
                setRole('staff')
                setEmailExists(null)
                setEmailAlreadyInBusiness(null)
                setExistingUserName('')
                setIsModalOpen(true)
              }}
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
                        <td className="px-6 py-4 text-right space-x-3">
                          <button
                            onClick={() => openEditModal(s)}
                            className="text-xs font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 hover:bg-yellow-200 px-1 py-0.5 cursor-pointer"
                          >
                            Edit
                          </button>
                          {s.id !== currentUserProfile?.id && (
                            <button
                              onClick={() => handleRemoveStaff(s)}
                              className="text-xs font-black text-red-600 uppercase tracking-widest border-b-2 border-red-600 hover:bg-red-50 px-1 py-0.5 cursor-pointer"
                            >
                              Hapus
                            </button>
                          )}
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
              
              {createMessage.text && (
                <div className={`p-4 mb-5 border-4 font-bold text-xs uppercase tracking-wider ${
                  createMessage.type === 'success' 
                    ? 'bg-green-50 border-green-600 text-green-700' 
                    : 'bg-red-50 border-red-600 text-red-700'
                }`}>
                  {createMessage.text}
                </div>
              )}

              <form onSubmit={handleCreateStaff} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Email Kerja</label>
                  <div className="relative">
                    <input 
                      type="email" placeholder="budi@shapeup.com" required
                      className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                      value={email} onChange={e => setEmail(e.target.value)}
                    />
                    {checkingEmail && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 uppercase animate-pulse">
                        Memeriksa...
                      </span>
                    )}
                  </div>

                  {/* Feedback based on email check */}
                  {emailExists === true && (
                    <div className={`p-3 border-2 font-bold text-[11px] uppercase tracking-wider ${
                      emailAlreadyInBusiness
                        ? 'bg-red-50 border-red-600 text-red-700'
                        : 'bg-green-50 border-green-600 text-green-700'
                    }`}>
                      {emailAlreadyInBusiness ? (
                        <span>⚠️ Email ini sudah terdaftar sebagai staf di bisnis ini.</span>
                      ) : (
                        <span>💡 Terdaftar sebagai "${existingUserName}". Staf ini akan ditambahkan ke bisnis ini (password tidak berubah).</span>
                      )}
                    </div>
                  )}

                  {emailExists === false && email && email.includes('@') && (
                    <div className="p-3 bg-green-50 border-2 border-green-600 text-green-700 font-bold text-[11px] uppercase tracking-wider">
                      ✨ Email baru siap didaftarkan.
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Nama Lengkap</label>
                  <input 
                    type="text" placeholder="Contoh: Budi Santoso" required
                    disabled={!!emailExists}
                    className={`w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm ${
                      emailExists ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''
                    }`}
                    value={name} onChange={e => setName(e.target.value)}
                  />
                </div>

                {!emailExists && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-widest">Password Awal</label>
                    <input 
                      type="password" placeholder="Min. 6 karakter" required minLength={6}
                      className="w-full p-4 border-4 border-black font-bold outline-none focus:bg-yellow-50 text-slate-800 text-sm"
                      value={password} onChange={e => setPassword(e.target.value)}
                    />
                  </div>
                )}

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
                    onClick={() => {
                      setIsModalOpen(false)
                      setCreateMessage({ text: '', type: '' })
                      setEmailExists(null)
                      setEmailAlreadyInBusiness(null)
                      setExistingUserName('')
                    }} 
                    className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 transition-all cursor-pointer"
                  >
                    Batal
                  </button>
                  <button 
                    type="submit" 
                    disabled={submitting || checkingEmail || (!!emailExists && !!emailAlreadyInBusiness)} 
                    className="flex-[1.5] bg-black text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-[#2e8540] hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {submitting 
                      ? (emailExists ? 'MENAMBAHKAN...' : 'MEMBUAT...') 
                      : (emailExists ? 'TAMBAHKAN KE BISNIS' : 'BUAT AKUN')}
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
              
              {editMessage.text && (
                <div className={`p-4 mb-5 border-4 font-bold text-xs uppercase tracking-wider ${
                  editMessage.type === 'success' 
                    ? 'bg-green-50 border-green-600 text-green-700' 
                    : 'bg-red-50 border-red-600 text-red-700'
                }`}>
                  {editMessage.text}
                </div>
              )}

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
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-500">Email Kerja (Tidak Dapat Diubah)</label>
                  <input 
                    type="email" required disabled readOnly
                    className="w-full p-4 border-4 border-black font-bold outline-none bg-slate-100 text-slate-500 cursor-not-allowed text-sm"
                    value={editEmail}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black uppercase tracking-widest">Ubah Password (Opsional)</label>
                  <input 
                    type="password" placeholder="Kosongkan jika tidak ingin diubah" minLength={6}
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
                      setEditMessage({ text: '', type: '' })
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

        {/* MODAL DELETE CONFIRMATION (BRUTALIST STYLE) */}
        {isDeleteModalOpen && deletingStaff && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white border-4 border-black p-8 md:p-10 w-full max-w-md shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]">
              <h2 className="text-3xl font-black uppercase italic mb-6 border-b-4 border-black pb-3 text-center text-red-600">Konfirmasi</h2>
              
              {deleteMessage.text && (
                <div className={`p-4 mb-5 border-4 font-bold text-xs uppercase tracking-wider ${
                  deleteMessage.type === 'success' 
                    ? 'bg-green-50 border-green-600 text-green-700' 
                    : 'bg-red-50 border-red-600 text-red-700'
                }`}>
                  {deleteMessage.text}
                </div>
              )}

              <div className="space-y-4 text-center">
                <p className="font-bold text-slate-800">
                  Apakah Anda yakin ingin mengeluarkan <span className="font-black underline text-red-600">{deletingStaff.full_name || deletingStaff.email}</span> dari unit bisnis ini?
                </p>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">
                  Akun mereka tidak akan dihapus secara permanen, hanya penugasan ke bisnis ini yang akan dicabut.
                </p>
              </div>
              <div className="flex gap-4 pt-6 border-t-4 border-black mt-8">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsDeleteModalOpen(false)
                    setDeletingStaff(null)
                    setDeleteMessage({ text: '', type: '' })
                  }} 
                  className="flex-1 font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-slate-100 transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button 
                  type="button"
                  disabled={deleteSubmitting} 
                  onClick={executeRemoveStaff}
                  className="flex-[1.5] bg-red-600 text-white font-black uppercase text-xs tracking-widest py-4 border-4 border-black hover:bg-red-700 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                >
                  {deleteSubmitting ? 'MENGELUARKAN...' : 'YA, KELUARKAN'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}