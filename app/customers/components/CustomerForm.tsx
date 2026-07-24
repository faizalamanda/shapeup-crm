"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CustomerAddressForm, AddressData, EMPTY_ADDRESS } from '@/components/CustomerAddressForm'

interface CustomerFormProps {
  mode: 'create' | 'edit'
  customerId?: string
  initialCustomer?: any
}

function getTagColors(tag: string) {
  const colors = [
    { bg: 'bg-blue-50 border-blue-100 text-blue-700' },
    { bg: 'bg-purple-50 border-purple-100 text-purple-700' },
    { bg: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
    { bg: 'bg-amber-50 border-amber-100 text-amber-700' },
    { bg: 'bg-rose-50 border-rose-100 text-rose-700' },
    { bg: 'bg-cyan-50 border-cyan-100 text-cyan-700' },
  ]
  const hash = tag.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

export function CustomerForm({ mode, customerId, initialCustomer }: CustomerFormProps) {
  const router = useRouter()

  // Form Fields State
  const [name, setName]               = useState('')
  const [phone, setPhone]             = useState('')
  const [email, setEmail]             = useState('')
  const [category, setCategory]       = useState('General')
  const [address, setAddress]         = useState<AddressData>(EMPTY_ADDRESS)

  // Metadata / CRM Fields State
  const [notes, setNotes]             = useState('')
  const [company, setCompany]         = useState('')
  const [jobTitle, setJobTitle]       = useState('')
  const [instagram, setInstagram]     = useState('')
  const [altPhone, setAltPhone]       = useState('')
  const [leadSource, setLeadSource]   = useState('')
  const [tags, setTags]               = useState<string[]>([])
  const [newTagInput, setNewTagInput] = useState('')

  // UI / Action State
  const [loading, setLoading]         = useState(mode === 'edit' && !initialCustomer)
  const [saving, setSaving]           = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  // Populate data in Edit mode if provided or fetch if missing
  useEffect(() => {
    if (mode === 'edit') {
      if (initialCustomer) {
        populateFields(initialCustomer)
        setLoading(false)
      } else if (customerId) {
        fetchCustomerData(customerId)
      }
    }
  }, [mode, customerId, initialCustomer])

  const fetchCustomerData = async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/customers/${id}`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memuat data pelanggan')
      }
      populateFields(data.customer)
    } catch (err: any) {
      console.error(err)
      setErrorMessage(err.message || 'Gagal mengambil data pelanggan')
    } finally {
      setLoading(false)
    }
  }

  const populateFields = (data: any) => {
    setName(data.name || '')
    setPhone(data.phone || '')
    setEmail(data.email || '')
    setCategory(data.category || 'General')

    setAddress(data.address_data || { ...EMPTY_ADDRESS })

    const meta = data.metadata || {}
    setNotes(meta.notes || '')
    setCompany(meta.company || '')
    setJobTitle(meta.job_title || '')
    setInstagram(meta.instagram || '')
    setAltPhone(meta.alt_phone || '')
    setLeadSource(meta.lead_source || '')
    setTags(meta.tags || [])
  }

  // Tag helper actions
  const handleAddTag = () => {
    const cleanTag = newTagInput.trim().toUpperCase()
    if (!cleanTag) return
    if (tags.includes(cleanTag)) {
      setNewTagInput('')
      return
    }
    setTags([...tags, cleanTag])
    setNewTagInput('')
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove))
  }

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setErrorMessage('Nama Lengkap wajib diisi!')
      return
    }
    if (!phone.trim()) {
      setErrorMessage('Nomor HP / WhatsApp wajib diisi!')
      return
    }

    setSaving(true)
    setErrorMessage('')

    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      category,
      address_data: address,
      metadata: {
        notes: notes.trim(),
        company: company.trim(),
        job_title: jobTitle.trim(),
        instagram: instagram.trim(),
        alt_phone: altPhone.trim(),
        lead_source: leadSource,
        tags,
      }
    }

    try {
      const url = mode === 'create' ? '/api/customers' : `/api/customers/${customerId}`
      const method = mode === 'create' ? 'POST' : 'PATCH'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Gagal menyimpan data pelanggan')
      }

      // Success -> Show Success Modal
      setShowSuccessModal(true)

    } catch (err: any) {
      console.error(err)
      setErrorMessage(err.message || 'Terjadi kesalahan saat menyimpan')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Memuat Data Pelanggan...</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">
      
      {/* ── Page Header & Navigation ────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link
            href="/customers"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors mb-2 group"
          >
            <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Kembali ke Customer
          </Link>

          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {mode === 'create' ? 'Tambah Pelanggan Baru' : 'Edit Data Pelanggan'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {mode === 'create'
              ? 'Lengkapi profil pelanggan baru untuk mempermudah transaksi dan pelacakan CRM.'
              : 'Perbarui rincian profil, kontak, alamat pengiriman, dan label pelanggan.'}
          </p>
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/customers"
            className="px-4 py-2.5 border border-slate-200 bg-white rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all"
          >
            Batal
          </Link>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-400 transition-all flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                Menyimpan...
              </>
            ) : (
              mode === 'create' ? 'Simpan Pelanggan' : 'Simpan Perubahan'
            )}
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-2xl flex items-center gap-3 shadow-sm">
          <span>❌</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ── Main Form Grid ──────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column (Identity, CRM & Notes) — 7 cols */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Card 1: Identitas Pelanggan */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <span>👤</span> Informasi Identitas
              </h2>
              <span className="text-[10px] text-slate-400 font-semibold">* Wajib diisi</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Nama Lengkap *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white font-medium text-slate-900"
                  placeholder="Contoh: Frida Ayu Meryana"
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Nomor HP / WhatsApp *
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white font-medium text-slate-900"
                  placeholder="Contoh: 08123456789"
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900"
                  placeholder="Contoh: frida@email.com"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Kategori Pelanggan
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white font-medium text-slate-900"
                >
                  <option value="General">General</option>
                  <option value="VIP">VIP</option>
                  <option value="Reseller">Reseller</option>
                  <option value="Dropshipper">Dropshipper</option>
                  <option value="Wholesale">Wholesale</option>
                </select>
              </div>
            </div>
          </div>

          {/* Card 2: Profil CRM & Kontak Tambahan */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-3 border-b border-slate-100 flex items-center gap-2">
              <span>🏢</span> Profil CRM & Kontak Tambahan
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Nama Perusahaan
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900"
                  placeholder="Nama Perusahaan / PT / CV"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Jabatan / Pekerjaan
                </label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={e => setJobTitle(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900"
                  placeholder="Contoh: Purchasing, Director, CEO"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Instagram Handle
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3.5 text-slate-400 text-sm font-bold">@</span>
                  <input
                    type="text"
                    value={instagram.replace(/^@/, '')}
                    onChange={e => setInstagram(e.target.value)}
                    className="w-full pl-8 pr-3 py-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900"
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  No. HP Alternatif
                </label>
                <input
                  type="text"
                  value={altPhone}
                  onChange={e => setAltPhone(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900"
                  placeholder="Contoh: 08129999999"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Sumber Kontak (Lead Source)
                </label>
                <select
                  value={leadSource}
                  onChange={e => setLeadSource(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900 font-medium"
                >
                  <option value="">-- Pilih Sumber Kontak --</option>
                  <option value="WooCommerce">WooCommerce Store</option>
                  <option value="Manual Invoice">Manual Invoice</option>
                  <option value="WhatsApp">WhatsApp Chat</option>
                  <option value="Instagram DM">Instagram DM</option>
                  <option value="Facebook Ads">Facebook Ads</option>
                  <option value="Google Search">Google Organic</option>
                  <option value="POS">Point of Sale (POS)</option>
                  <option value="Referral">Rekomendasi / Referral</option>
                  <option value="Offline Event">Event / Bazaar</option>
                  <option value="Lainnya">Lainnya</option>
                </select>
              </div>
            </div>
          </div>

          {/* Card 3: Label / Tag Pelanggan */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-3 border-b border-slate-100 flex items-center gap-2">
              <span>🏷️</span> Label / Tag Pelanggan
            </h2>

            <div>
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                Tambahkan Tag Baru
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={e => setNewTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddTag()
                    }
                  }}
                  className="flex-1 p-2.5 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900"
                  placeholder="Ketik tag lalu tekan Enter (misal: WHOLESALE, PRIORITY)"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-4 py-2.5 border border-slate-200 hover:border-blue-500 hover:text-blue-600 bg-white rounded-xl text-xs font-bold text-slate-700 transition-all"
                >
                  + Tambah
                </button>
              </div>
            </div>

            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {tags.map(tag => {
                  const tagColors = getTagColors(tag)
                  return (
                    <span
                      key={tag}
                      className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 ${tagColors.bg}`}
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-slate-400 hover:text-slate-700 font-bold ml-1 focus:outline-none"
                        title="Hapus tag"
                      >
                        ✕
                      </button>
                    </span>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">Belum ada label/tag yang diberikan.</p>
            )}
          </div>

          {/* Card 4: Catatan CRM */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-3 border-b border-slate-100 flex items-center gap-2">
              <span>✍️</span> Catatan CRM (CRM Notes)
            </h2>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              className="w-full p-3.5 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 focus:outline-none bg-white text-slate-900 leading-relaxed"
              placeholder="Tulis riwayat negosiasi, preferensi ukuran, komplain, atau keterangan spesifik pelanggan di sini..."
            />
          </div>

        </div>

        {/* Right Column (Shipping Address) — 5 cols */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4 sticky top-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-3 border-b border-slate-100 flex items-center gap-2">
              <span>📍</span> Alamat Pengiriman
            </h2>

            <CustomerAddressForm
              value={address}
              onChange={setAddress}
              compact={true}
            />
          </div>
        </div>

      </form>

      {/* Bottom Sticky Action Bar */}
      <div className="mt-10 p-4 bg-white border border-slate-200/80 rounded-2xl shadow-lg flex items-center justify-between">
        <Link
          href="/customers"
          className="px-5 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all"
        >
          ← Batal
        </Link>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-8 py-3 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-400 transition-all flex items-center gap-2"
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
              Menyimpan Data...
            </>
          ) : (
            mode === 'create' ? 'Simpan Pelanggan Baru' : 'Simpan Perubahan'
          )}
        </button>
      </div>

      {/* ── SUCCESS MODAL OVERLAY ──────────────────────────────────────── */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 text-center space-y-5 animate-scaleUp">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl">
              ✅
            </div>

            <div>
              <h3 className="text-lg font-extrabold text-slate-900">
                {mode === 'create' ? 'Pelanggan Berhasil Ditambahkan!' : 'Perubahan Berhasil Disimpan!'}
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Data pelanggan <strong className="text-slate-800">{name}</strong> telah berhasil tersimpan dalam database.
              </p>
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => router.push('/customers')}
                className="w-full py-3 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
              >
                <span>📋</span> Kembali ke Daftar Customer
              </button>

              <button
                type="button"
                onClick={() => setShowSuccessModal(false)}
                className="w-full py-2.5 border border-slate-200 bg-white text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all"
              >
                Tutup / Tetap di Halaman Ini
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
