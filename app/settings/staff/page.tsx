"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import SettingsLayout from '@/components/SettingsLayout'

export default function StaffSettings() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [staffList, setStaffList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null)
  
  const PERMISSIONS_LIST = useMemo(() => [
    { key: 'full_access', label: 'Akses Penuh', desc: 'Akses penuh ke seluruh modul (P&L, Neraca, detail Gaji karyawan)' },
    { key: 'view_financials_no_salary', label: 'Keuangan Tanpa Gaji', desc: 'Bisa melihat P&L dan Neraca, tapi TIDAK BISA melihat rincian gaji per individu' },
    { key: 'input_journal_expenses', label: 'Input Jurnal & Pengeluaran', desc: 'Hanya bisa input Jurnal harian dan pengeluaran operasional. Tidak punya akses ke dashboard P&L' },
    { key: 'manage_invoices', label: 'Kelola Invoice (Piutang)', desc: 'Bisa mengelola Invoices (Piutang), Orders, POS, Customer, dan Produk' },
    { key: 'manage_bills', label: 'Kelola Bills (Hutang)', desc: 'Bisa mengelola Bills (Hutang/Pembelian), Pengeluaran, dan Pemasok' },
    { key: 'manage_products', label: 'Kelola Produk & Stok', desc: 'Bisa mengelola Daftar Produk, Kategori, dan Stock Opname' },
    { key: 'manage_purchases', label: 'Kelola Pembelian Produk', desc: 'Bisa mengelola Pembelian Produk dan Pemasok (Suppliers)' },
    { key: 'manage_employees_salary', label: 'Kelola Karyawan & Gaji (HR)', desc: 'Hanya bisa mengelola dan menambah data karyawan dan rincian gaji. Tidak punya akses ke modul akuntansi' },
    { key: 'manage_marketing', label: 'Kelola Marketing', desc: 'Bisa mengelola modul Marketing' }
  ], [])
  
  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('staff')
  const [permissions, setPermissions] = useState<string[]>([])
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
  const [editPermissions, setEditPermissions] = useState<string[]>([])
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editMessage, setEditMessage] = useState({ text: '', type: '' })

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState<any>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState({ text: '', type: '' })

  // Search and Role Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'staff'>('all')

  const filteredStaffList = useMemo(() => {
    return staffList.filter(s => {
      const isStaffAdmin = s.role === 'admin'
      const matchesRole = roleFilter === 'all' ? true : (roleFilter === 'admin' ? isStaffAdmin : !isStaffAdmin)
      const q = searchQuery.toLowerCase().trim()
      const matchesQuery = !q || (s.full_name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q))
      return matchesRole && matchesQuery
    })
  }, [staffList, roleFilter, searchQuery])

  // Prevent body scroll when any modal is open
  useEffect(() => {
    if (isModalOpen || isEditModalOpen || isDeleteModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isModalOpen, isEditModalOpen, isDeleteModalOpen])

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
        role,
        permissions: role === 'admin' ? ['full_access'] : permissions
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
        setEmail(''); setPassword(''); setName(''); setRole('staff'); setPermissions([])
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
    setEditPermissions(staff.permissions || [])
    setEditPassword('')
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
        permissions: editRole === 'admin' ? ['full_access'] : editPermissions
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
        setEditName(''); setEditEmail(''); setEditRole('staff'); setEditPassword(''); setEditPermissions([])
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
      <SettingsLayout title="Staf & Hak Akses" subtitle="Kelola anggota tim, tambahkan akun staf, dan atur hak akses modul.">
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-8 text-center space-y-4 max-w-xl mx-auto shadow-sm">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center text-xl mx-auto">
            ⚠️
          </div>
          <h2 className="text-xl font-bold text-[#1C1C1A]">Unit Bisnis Aktif Belum Dipilih</h2>
          <p className="text-xs text-[#6B6B63]">
            Anda harus memilih atau mengaktifkan salah satu unit bisnis terlebih dahulu untuk mengelola anggota tim.
          </p>
          <div className="pt-2">
            <Link 
              href="/settings/business" 
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
            >
              Pilih Unit Bisnis &rarr;
            </Link>
          </div>
        </div>
      </SettingsLayout>
    )
  }

  const isAdmin = currentUserProfile?.role === 'admin'

  return (
    <SettingsLayout title="Staf & Hak Akses" subtitle="Kelola anggota tim, tambahkan akun staf, dan atur hak akses modul.">
      
      {/* Header Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#1C1C1A]">Manajemen Tim &amp; Peran</h2>
          <p className="text-xs text-[#6B6B63]">Kelola anggota tim, tambahkan akun staf, dan atur hak akses modul.</p>
        </div>
        {isAdmin && (
          <button 
            onClick={() => {
              setCreateMessage({ text: '', type: '' })
              setEmail('')
              setPassword('')
              setName('')
              setRole('staff')
              setPermissions([])
              setEmailExists(null)
              setEmailAlreadyInBusiness(null)
              setExistingUserName('')
              setIsModalOpen(true)
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-2 self-start sm:self-auto cursor-pointer"
          >
            <span>+</span>
            <span>Tambah Anggota Tim</span>
          </button>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Cari nama atau email staf..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-[#E2E2DC] rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[#FAF9F5]"
          />
          <svg className="w-4 h-4 text-[#A8A89E] absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#A8A89E] hover:text-[#1C1C1A]"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#6B6B63] whitespace-nowrap">Filter Role:</span>
          <div className="flex items-center bg-[#FAF9F5] p-1 border border-[#E2E2DC] rounded-lg">
            <button
              onClick={() => setRoleFilter('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                roleFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-[#6B6B63] hover:text-[#1C1C1A]'
              }`}
            >
              Semua ({staffList.length})
            </button>
            <button
              onClick={() => setRoleFilter('admin')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                roleFilter === 'admin'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-[#6B6B63] hover:text-[#1C1C1A]'
              }`}
            >
              Admin ({staffList.filter(s => s.role === 'admin').length})
            </button>
            <button
              onClick={() => setRoleFilter('staff')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                roleFilter === 'staff'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-[#6B6B63] hover:text-[#1C1C1A]'
              }`}
            >
              Staff ({staffList.filter(s => s.role !== 'admin').length})
            </button>
          </div>
        </div>
      </div>

      {/* Tabel Staff */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F7F7F5] border-b border-[#E2E2DC]">
                <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-wider text-[#6B6B63]">Nama Lengkap</th>
                <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-wider text-[#6B6B63]">Email</th>
                <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-wider text-[#6B6B63]">Role &amp; Hak Akses</th>
                <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-wider text-[#6B6B63] text-center">Status</th>
                {isAdmin && (
                  <th className="px-6 py-3.5 text-[10px] font-extrabold uppercase tracking-wider text-[#6B6B63] text-right">Aksi</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DC]">
              {loading ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="px-6 py-12 text-center text-[#A8A89E] text-xs font-bold uppercase tracking-wider">
                    Memuat Data Tim...
                  </td>
                </tr>
              ) : filteredStaffList.length > 0 ? (
                filteredStaffList.map((s) => (
                  <tr key={s.id} className="hover:bg-[#F7F7F5] transition-colors">
                    <td className="px-6 py-4 font-semibold text-sm text-[#1C1C1A]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 text-blue-600 font-extrabold flex items-center justify-center text-xs">
                          {s.full_name?.charAt(0).toUpperCase() || 'S'}
                        </div>
                        <span className="truncate">{s.full_name || 'Staff Tanpa Nama'}</span>
                        {s.id === currentUserProfile?.id && (
                          <span className="text-[9px] font-bold uppercase bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">Anda</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-[#6B6B63] break-all">{s.email}</td>
                    <td className="px-6 py-4">
                      <div className="space-y-1.5">
                        <div>
                          {s.role === 'admin' ? (
                            <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                              Admin
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                              {s.role || 'Staff'}
                            </span>
                          )}
                        </div>
                        {s.role !== 'admin' && s.permissions && s.permissions.length > 0 && (
                          <div className="flex flex-wrap gap-1 max-w-sm">
                            {s.permissions.map((pKey: string) => {
                              const pObj = PERMISSIONS_LIST.find(p => p.key === pKey)
                              return (
                                <span key={pKey} className="bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-semibold px-2 py-0.5 rounded-md">
                                  {pObj ? pObj.label : pKey}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        {s.role !== 'admin' && (!s.permissions || s.permissions.length === 0) && (
                          <span className="text-[10px] italic text-[#A8A89E]">Tidak ada akses khusus</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-green-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse"></span>
                        Aktif
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right space-x-3 text-xs font-bold">
                        <button
                          onClick={() => openEditModal(s)}
                          className="text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                        >
                          Edit
                        </button>
                        {s.id !== currentUserProfile?.id && (
                          <button
                            onClick={() => handleRemoveStaff(s)}
                            className="text-red-600 hover:text-red-700 hover:underline cursor-pointer"
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
                  <td colSpan={isAdmin ? 5 : 4} className="px-6 py-12 text-center text-[#A8A89E] text-xs font-semibold">
                    {searchQuery || roleFilter !== 'all'
                      ? 'Tidak ada anggota tim yang sesuai dengan kata kunci / filter role Anda.'
                      : 'Belum ada staff yang terdaftar pada unit bisnis ini.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card Ubah Password Saya */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl p-6 shadow-xs max-w-xl space-y-4">
        <h2 className="text-base font-bold text-[#1C1C1A] border-b border-[#E2E2DC] pb-3">Ubah Password Saya</h2>
        
        {myPasswordMessage.text && (
          <div className={`p-3 rounded-lg text-xs font-semibold ${
            myPasswordMessage.type === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-700' 
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {myPasswordMessage.text}
          </div>
        )}

        <form onSubmit={handleSelfPasswordUpdate} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Password Baru</label>
            <input 
              type="password" placeholder="Minimal 6 karakter" required
              className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={myPassword} onChange={e => setMyPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Konfirmasi Password Baru</label>
            <input 
              type="password" placeholder="Ulangi password baru" required
              className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
          <button 
            type="submit" 
            disabled={myPasswordLoading}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {myPasswordLoading ? 'Memperbarui...' : 'Simpan Password Baru'}
          </button>
        </form>
      </div>

      {/* MODAL CREATE STAFF */}
      {isModalOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[9999] flex items-center justify-center p-4 overflow-y-auto overscroll-contain">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl p-6 md:p-8 w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto space-y-6 my-auto">
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#1C1C1A]">Tambah Anggota Tim</h2>
                <p className="text-xs text-[#6B6B63]">Isi informasi pengguna dan atur hak akses modul di sebelah kanan.</p>
              </div>
              <button 
                onClick={() => {
                  setIsModalOpen(false)
                  setCreateMessage({ text: '', type: '' })
                  setEmailExists(null)
                  setEmailAlreadyInBusiness(null)
                  setExistingUserName('')
                }}
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>
            
            {createMessage.text && (
              <div className={`p-3 rounded-lg text-xs font-semibold ${
                createMessage.type === 'success' 
                  ? 'bg-green-50 border border-green-200 text-green-700' 
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {createMessage.text}
              </div>
            )}

            <form onSubmit={handleCreateStaff} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                {/* Left Column: Form Inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Email Kerja</label>
                    <div className="relative">
                      <input 
                        type="email" placeholder="budi@perusahaan.com" required
                        className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        value={email} onChange={e => setEmail(e.target.value)}
                      />
                      {checkingEmail && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#A8A89E] font-medium">
                          Memeriksa...
                        </span>
                      )}
                    </div>

                    {emailExists === true && (
                      <div className={`mt-2 p-2.5 rounded-lg text-xs font-medium ${
                        emailAlreadyInBusiness
                          ? 'bg-red-50 text-red-700 border border-red-200'
                          : 'bg-green-50 text-green-700 border border-green-200'
                      }`}>
                        {emailAlreadyInBusiness ? (
                          <span>⚠️ Email ini sudah terdaftar sebagai staf di bisnis ini.</span>
                        ) : (
                          <span>💡 Terdaftar sebagai "{existingUserName}". Staf akan ditambahkan ke unit ini.</span>
                        )}
                      </div>
                    )}

                    {emailExists === false && email && email.includes('@') && (
                      <div className="mt-2 p-2.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium">
                        ✨ Email baru siap didaftarkan.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Nama Lengkap</label>
                    <input 
                      type="text" placeholder="Budi Santoso" required
                      disabled={!!emailExists}
                      className={`w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
                        emailExists ? 'bg-[#F7F7F5] text-[#6B6B63] cursor-not-allowed' : ''
                      }`}
                      value={name} onChange={e => setName(e.target.value)}
                    />
                  </div>

                  {!emailExists && (
                    <div>
                      <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Password Awal</label>
                      <input 
                        type="password" placeholder="Minimal 6 karakter" required minLength={6}
                        className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        value={password} onChange={e => setPassword(e.target.value)}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Role Peran</label>
                    <select 
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={role} onChange={e => setRole(e.target.value)}
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>

                {/* Right Column: Hak Akses Modul */}
                <div className="space-y-3 md:border-l md:border-[#E2E2DC] md:pl-6 pt-2 md:pt-0">
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider">
                    Hak Akses Modul
                  </label>
                  {role === 'staff' ? (
                    <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                      {PERMISSIONS_LIST.map((p) => {
                        const checked = permissions.includes(p.key)
                        return (
                          <label 
                            key={p.key} 
                            className={`p-3 border rounded-xl flex items-start gap-3 cursor-pointer transition-all ${
                              checked 
                                ? 'border-blue-500 bg-blue-50/50 shadow-2xs' 
                                : 'border-[#E2E2DC] bg-white hover:border-[#C8C8C0] hover:bg-[#F9F9F8]'
                            }`}
                          >
                            <input 
                              type="checkbox"
                              className="mt-0.5 w-4 h-4 accent-blue-600 cursor-pointer flex-shrink-0"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setPermissions([...permissions, p.key])
                                } else {
                                  setPermissions(permissions.filter(k => k !== p.key))
                                }
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className={`text-xs font-bold ${checked ? 'text-blue-900' : 'text-[#1C1C1A]'}`}>
                                {p.label}
                              </div>
                              <div className="text-[11px] text-[#6B6B63] leading-relaxed mt-0.5">
                                {p.desc}
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2 text-xs text-blue-900">
                      <div className="font-bold flex items-center gap-1.5">
                        <span>👑</span> Peran Admin
                      </div>
                      <p className="text-[11px] text-blue-800 leading-relaxed">
                        Admin memiliki akses penuh ke seluruh fitur dan modul bisnis tanpa batas.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-[#E2E2DC]">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsModalOpen(false)
                    setCreateMessage({ text: '', type: '' })
                    setEmailExists(null)
                    setEmailAlreadyInBusiness(null)
                    setExistingUserName('')
                  }} 
                  className="flex-1 px-4 py-2.5 border border-[#E2E2DC] rounded-lg text-xs font-bold text-[#6B6B63] hover:bg-[#F7F7F5] transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  disabled={submitting || checkingEmail || (!!emailExists && !!emailAlreadyInBusiness)} 
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {submitting 
                    ? (emailExists ? 'Menambahkan...' : 'Membuat...') 
                    : (emailExists ? 'Tambahkan Ke Unit' : 'Buat Akun Staf')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL EDIT STAFF */}
      {isEditModalOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[9999] flex items-center justify-center p-4 overflow-y-auto overscroll-contain">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl p-6 md:p-8 w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto space-y-6 my-auto">
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#1C1C1A]">Edit Data Tim</h2>
                <p className="text-xs text-[#6B6B63]">Perbarui data pengguna dan atur hak akses modul di sebelah kanan.</p>
              </div>
              <button 
                onClick={() => {
                  setIsEditModalOpen(false)
                  setEditingStaff(null)
                  setEditMessage({ text: '', type: '' })
                }}
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {editMessage.text && (
              <div className={`p-3 rounded-lg text-xs font-semibold ${
                editMessage.type === 'success' 
                  ? 'bg-green-50 border border-green-200 text-green-700' 
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {editMessage.text}
              </div>
            )}

            <form onSubmit={handleEditStaff} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                {/* Left Column: Info Inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Nama Lengkap</label>
                    <input 
                      type="text" required
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={editName} onChange={e => setEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#6B6B63] uppercase tracking-wider mb-1.5">Email (Tercatat)</label>
                    <input 
                      type="email" required disabled readOnly
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm bg-[#F7F7F5] text-[#6B6B63] cursor-not-allowed"
                      value={editEmail}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Ubah Password (Opsional)</label>
                    <input 
                      type="password" placeholder="Kosongkan jika tidak diubah" minLength={6}
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={editPassword} onChange={e => setEditPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">Role Peran</label>
                    <select 
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={editRole} onChange={e => setEditRole(e.target.value)}
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>

                {/* Right Column: Hak Akses Modul */}
                <div className="space-y-3 md:border-l md:border-[#E2E2DC] md:pl-6 pt-2 md:pt-0">
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider">
                    Hak Akses Modul
                  </label>
                  {editRole === 'staff' ? (
                    <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                      {PERMISSIONS_LIST.map((p) => {
                        const checked = editPermissions.includes(p.key)
                        return (
                          <label 
                            key={p.key} 
                            className={`p-3 border rounded-xl flex items-start gap-3 cursor-pointer transition-all ${
                              checked 
                                ? 'border-blue-500 bg-blue-50/50 shadow-2xs' 
                                : 'border-[#E2E2DC] bg-white hover:border-[#C8C8C0] hover:bg-[#F9F9F8]'
                            }`}
                          >
                            <input 
                              type="checkbox"
                              className="mt-0.5 w-4 h-4 accent-blue-600 cursor-pointer flex-shrink-0"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditPermissions([...editPermissions, p.key])
                                } else {
                                  setEditPermissions(editPermissions.filter(k => k !== p.key))
                                }
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className={`text-xs font-bold ${checked ? 'text-blue-900' : 'text-[#1C1C1A]'}`}>
                                {p.label}
                              </div>
                              <div className="text-[11px] text-[#6B6B63] leading-relaxed mt-0.5">
                                {p.desc}
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2 text-xs text-blue-900">
                      <div className="font-bold flex items-center gap-1.5">
                        <span>👑</span> Peran Admin
                      </div>
                      <p className="text-[11px] text-blue-800 leading-relaxed">
                        Admin memiliki akses penuh ke seluruh fitur dan modul bisnis tanpa batas.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-[#E2E2DC]">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsEditModalOpen(false)
                    setEditingStaff(null)
                    setEditMessage({ text: '', type: '' })
                  }} 
                  className="flex-1 px-4 py-2.5 border border-[#E2E2DC] rounded-lg text-xs font-bold text-[#6B6B63] hover:bg-[#F7F7F5] transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  disabled={editSubmitting} 
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {editSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL DELETE CONFIRMATION */}
      {isDeleteModalOpen && deletingStaff && mounted && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[9999] flex items-center justify-center p-4 overflow-y-auto overscroll-contain">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl p-6 md:p-8 w-full max-w-md shadow-2xl space-y-6 my-auto">
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-4">
              <h2 className="text-lg font-bold text-red-600">Keluarkan Staf</h2>
              <button 
                onClick={() => {
                  setIsDeleteModalOpen(false)
                  setDeletingStaff(null)
                  setDeleteMessage({ text: '', type: '' })
                }}
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {deleteMessage.text && (
              <div className={`p-3 rounded-lg text-xs font-semibold ${
                deleteMessage.type === 'success' 
                  ? 'bg-green-50 border border-green-200 text-green-700' 
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {deleteMessage.text}
              </div>
            )}

            <div className="space-y-2 text-sm text-[#1C1C1A]">
              <p>
                Apakah Anda yakin ingin mengeluarkan <span className="font-bold text-red-600">{deletingStaff.full_name || deletingStaff.email}</span> dari unit bisnis ini?
              </p>
              <p className="text-xs text-[#6B6B63]">
                Akun staf tidak akan dihapus secara permanen, hanya hak akses penugasan ke bisnis ini yang akan dicabut.
              </p>
            </div>

            <div className="flex gap-3 pt-4 border-t border-[#E2E2DC]">
              <button 
                type="button" 
                onClick={() => {
                  setIsDeleteModalOpen(false)
                  setDeletingStaff(null)
                  setDeleteMessage({ text: '', type: '' })
                }} 
                className="flex-1 px-4 py-2.5 border border-[#E2E2DC] rounded-lg text-xs font-bold text-[#6B6B63] hover:bg-[#F7F7F5] transition-all cursor-pointer"
              >
                Batal
              </button>
              <button 
                type="button"
                disabled={deleteSubmitting} 
                onClick={executeRemoveStaff}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {deleteSubmitting ? 'Mengeluarkan...' : 'Ya, Keluarkan'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </SettingsLayout>
  )
}