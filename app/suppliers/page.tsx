"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

type Customer = {
  id: string
  name: string
}

type Supplier = {
  id: string
  business_id: string
  customer_id: string | null
  name: string
  email: string | null
  phone: string | null
  address: string | null
  created_at: string
  customer?: { id: string; name: string } | null
}

export default function SuppliersPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('')

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

  // Form State
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [formCustomerId, setFormCustomerId] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch Suppliers and Customers
  const fetchData = useCallback(async (businessId: string) => {
    setLoading(true)
    try {
      // 1. Fetch suppliers via API
      const res = await fetch('/api/suppliers')
      if (!res.ok) throw new Error('Gagal memuat data supplier')
      const data = await res.json()
      setSuppliers(data)

      // 2. Fetch customers for linking
      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('id, name')
        .eq('business_id', businessId)
        .order('name', { ascending: true })

      if (custErr) throw custErr
      setCustomers(custData || [])
    } catch (err) {
      console.error('Error fetching suppliers page data:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Load Active Business Profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('active_business_id, businesses!active_business_id(name)')
          .eq('id', user.id)
          .single()

        if (error) throw error

        const businessId = profile?.active_business_id
        if (businessId) {
          setActiveBizId(businessId)
          const biz = Array.isArray(profile.businesses) ? profile.businesses[0] : profile.businesses
          setActiveBizName(biz?.name || 'Bisnis Saya')
          await fetchData(businessId)
        }
      } catch (err) {
        console.error('Error loading profile:', err)
        setLoading(false)
      }
    }
    loadProfile()
  }, [supabase, fetchData])

  // Filtered Suppliers list
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(s => {
      const query = searchQuery.toLowerCase()
      return (
        s.name.toLowerCase().includes(query) ||
        (s.email || '').toLowerCase().includes(query) ||
        (s.phone || '').toLowerCase().includes(query) ||
        (s.address || '').toLowerCase().includes(query)
      )
    })
  }, [suppliers, searchQuery])

  // Open Modal Helpers
  const openAddModal = () => {
    setSelectedSupplier(null)
    setFormName('')
    setFormEmail('')
    setFormPhone('')
    setFormAddress('')
    setFormCustomerId('')
    setIsModalOpen(true)
  }

  const openEditModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier)
    setFormName(supplier.name)
    setFormEmail(supplier.email || '')
    setFormPhone(supplier.phone || '')
    setFormAddress(supplier.address || '')
    setFormCustomerId(supplier.customer_id || '')
    setIsModalOpen(true)
  }

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) {
      alert('Nama pemasok wajib diisi!')
      return
    }

    setSubmitLoading(true)
    try {
      const payload = {
        id: selectedSupplier?.id,
        name: formName.trim(),
        email: formEmail.trim() || null,
        phone: formPhone.trim() || null,
        address: formAddress.trim() || null,
        customer_id: formCustomerId || null
      }

      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menyimpan supplier')
      }

      setIsModalOpen(false)
      if (activeBizId) {
        await fetchData(activeBizId)
      }
    } catch (err: any) {
      console.error('Error saving supplier:', err)
      alert(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  // Handle Delete
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus pemasok "${name}"?`)) return

    try {
      const res = await fetch(`/api/suppliers?id=${id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menghapus supplier')
      }

      if (activeBizId) {
        await fetchData(activeBizId)
      }
    } catch (err: any) {
      console.error('Error deleting supplier:', err)
      alert(err.message)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Page Header */}
      <div className="border-b border-gray-200 pb-5 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              Pembelian & Pengeluaran
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 uppercase">
                📍 {activeBizName}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight leading-none uppercase">
            Pemasok (Suppliers)
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Kelola data kontak mitra pemasok/supplier Anda serta hubungkan dengan data pelanggan.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="w-full md:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          ➕ Tambah Pemasok
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <input
            type="text"
            placeholder="Cari nama, email, telepon, atau alamat pemasok..."
            className="w-full p-2.5 pl-8 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-gray-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3 top-3.5 text-gray-400 text-xs">🔍</span>
        </div>
      </div>

      {/* Suppliers Table */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">
          Memuat data pemasok...
        </div>
      ) : suppliers.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-xs">
          <span className="text-3xl">🤝</span>
          <h3 className="text-sm font-extrabold text-gray-800 mt-2 uppercase tracking-wide">Belum ada pemasok</h3>
          <p className="text-xs text-gray-400 mt-1">Tambahkan pemasok pertama Anda untuk mencatat pembelian stok barang.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                  <th className="p-4">Nama Pemasok</th>
                  <th className="p-4">Kontak</th>
                  <th className="p-4">Alamat</th>
                  <th className="p-4">Status Pelanggan</th>
                  <th className="p-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                {filteredSuppliers.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 font-bold text-gray-900">{s.name}</td>
                    <td className="p-4 space-y-0.5">
                      {s.email && <div className="text-gray-600">✉️ {s.email}</div>}
                      {s.phone && <div className="text-gray-500">📞 {s.phone}</div>}
                      {!s.email && !s.phone && <span className="text-gray-400">-</span>}
                    </td>
                    <td className="p-4 text-gray-500 max-w-xs truncate">{s.address || '-'}</td>
                    <td className="p-4">
                      {s.customer ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                          👤 Terhubung Pelanggan: {s.customer.name}
                        </span>
                      ) : (
                        <span className="text-gray-400 font-normal">Tidak Terhubung</span>
                      )}
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button
                        onClick={() => openEditModal(s)}
                        className="px-2.5 py-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDelete(s.id, s.name)}
                        className="px-2.5 py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded border border-red-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
                      >
                        🗑️ Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isModalOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                {selectedSupplier ? '✏️ Edit Pemasok' : '➕ Tambah Pemasok Baru'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Nama Pemasok *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: PT. Sumber Makmur"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Email Pemasok
                  </label>
                  <input
                    type="email"
                    placeholder="email@pemasok.com"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Nomor Telepon
                  </label>
                  <input
                    type="text"
                    placeholder="08123456789"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Alamat Lengkap
                </label>
                <textarea
                  placeholder="Alamat kantor / gudang supplier..."
                  rows={2}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white resize-none"
                  value={formAddress}
                  onChange={e => setFormAddress(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5 flex justify-between">
                  <span>Hubungkan dengan Profil Pelanggan</span>
                  <span className="text-[9px] text-gray-400 font-normal normal-case">(Opsional jika pelanggan merangkap supplier)</span>
                </label>
                <select
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formCustomerId}
                  onChange={e => setFormCustomerId(e.target.value)}
                >
                  <option value="">-- Pilih Profil Pelanggan --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {submitLoading ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
