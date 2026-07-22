"use client"

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import SettingsLayout from '@/components/SettingsLayout'

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Jakarta', label: 'Indonesia Barat (WIB)' },
  { value: 'Asia/Makassar', label: 'Indonesia Tengah (WITA)' },
  { value: 'Asia/Jayapura', label: 'Indonesia Timur (WIT)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Malaysia (MYT)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Bangkok', label: 'Thailand (ICT)' },
  { value: 'Asia/Manila', label: 'Philippines (PST)' },
  { value: 'Asia/Tokyo', label: 'Japan (JST)' },
  { value: 'Australia/Sydney', label: 'Australia Sydney (AEST)' },
  { value: 'Europe/London', label: 'United Kingdom (GMT/BST)' },
  { value: 'America/New_York', label: 'US Eastern (EST)' },
]

const CURRENCY_OPTIONS = [
  { value: 'IDR', label: 'IDR - Rupiah Indonesia (Rp)' },
  { value: 'USD', label: 'USD - US Dollar ($)' },
  { value: 'MYR', label: 'MYR - Ringgit Malaysia (RM)' },
  { value: 'SGD', label: 'SGD - Singapore Dollar (S$)' },
  { value: 'EUR', label: 'EUR - Euro (€)' },
]

const INDUSTRY_OPTIONS = [
  { value: 'retail', label: 'Retail / E-commerce' },
  { value: 'fnb', label: 'Food & Beverage (F&B)' },
  { value: 'services', label: 'Jasa & Konsultansi' },
  { value: 'fashion', label: 'Fashion & Lifestyle' },
  { value: 'manufacturing', label: 'Manufaktur & Pabrik' },
  { value: 'tech', label: 'Teknologi & Software' },
  { value: 'healthcare', label: 'Kesehatan & Kecantikan' },
  { value: 'other', label: 'Lainnya' },
]

const getTimezoneLabel = (timezone?: string | null) => {
  return TIMEZONE_OPTIONS.find((item) => item.value === timezone)?.label || timezone || 'Asia/Jakarta'
}

type Business = {
  id: string
  name: string
  phone?: string | null
  timezone?: string | null
  address?: string | null
  email?: string | null
  website?: string | null
  legal_name?: string | null
  industry?: string | null
  tax_id?: string | null
  currency?: string | null
  logo_url?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  signatory_name?: string | null
  signatory_title?: string | null
}

function parseBusinessProfile(biz: any): Business {
  if (!biz) return { id: '', name: '' }
  let jsonExtra: Record<string, any> = {}
  if (biz.address) {
    try {
      if (typeof biz.address === 'string' && biz.address.trim().startsWith('{')) {
        jsonExtra = JSON.parse(biz.address)
      }
    } catch (e) {
      // Plain address text
    }
  }

  return {
    id: biz.id,
    name: biz.name || '',
    phone: biz.phone || jsonExtra.phone || '',
    timezone: biz.timezone || jsonExtra.timezone || 'Asia/Jakarta',
    address: jsonExtra.address !== undefined ? jsonExtra.address : (biz.address && !biz.address.trim().startsWith('{') ? biz.address : ''),
    city: biz.city || jsonExtra.city || '',
    province: biz.province || jsonExtra.province || '',
    postal_code: biz.postal_code || jsonExtra.postal_code || '',
    email: biz.email || jsonExtra.email || '',
    website: biz.website || jsonExtra.website || '',
    legal_name: biz.legal_name || jsonExtra.legal_name || '',
    industry: biz.industry || jsonExtra.industry || 'retail',
    tax_id: biz.tax_id || jsonExtra.tax_id || '',
    currency: biz.currency || jsonExtra.currency || 'IDR',
    signatory_name: biz.signatory_name || jsonExtra.signatory_name || '',
    signatory_title: biz.signatory_title || jsonExtra.signatory_title || '',
    logo_url: biz.logo_url || jsonExtra.logo_url || '',
  }
}

function BusinessSettingsInner() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const router = useRouter()
  const searchParams = useSearchParams()
  const currentTab = searchParams.get('tab') || 'profile'

  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])
  
  const [loading, setLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [activeBid, setActiveBid] = useState<string | null>(null)
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  // Profile Form State for Active Business
  const [profileForm, setProfileForm] = useState<Business>({
    id: '',
    name: '',
    legal_name: '',
    industry: 'retail',
    tax_id: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    city: '',
    province: '',
    postal_code: '',
    timezone: 'Asia/Jakarta',
    currency: 'IDR',
    signatory_name: '',
    signatory_title: '',
    logo_url: '',
  })

  // State for Create Business
  const [formData, setFormData] = useState({ name: '', phone: '', timezone: 'Asia/Jakarta' })
  
  // State for Edit Unit Modal
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null)
  const [editFormData, setEditFormData] = useState({ name: '', phone: '', timezone: 'Asia/Jakarta' })

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isCreating || editingBusiness) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isCreating, editingBusiness])
  
  const [submitting, setSubmitting] = useState(false)
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, active_business_id')
        .eq('id', user.id)
        .single()
      
      setUserRole(profile?.role || 'staff')
      const activeId = profile?.active_business_id || null
      setActiveBid(activeId)

      // Fetch assigned businesses
      const { data: bsData } = await supabase
        .from('business_staff')
        .select('role, businesses (*)')
        .eq('profile_id', user.id)

      // Fetch owned businesses
      const { data: ownedBiz } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)

      const bizMap = new Map<string, any>()
      bsData?.forEach((item: any) => {
        if (item.businesses) {
          bizMap.set(item.businesses.id, item.businesses)
        }
      })
      ownedBiz?.forEach((biz: any) => {
        bizMap.set(biz.id, biz)
      })

      const rawBizList = Array.from(bizMap.values())
      const parsedBizList = rawBizList.map(parseBusinessProfile)
      setBusinesses(parsedBizList)

      if (activeId) {
        const found = parsedBizList.find(b => b.id === activeId) || null
        setActiveBusiness(found)
        if (found) {
          setProfileForm({ ...found })
        }
      }
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchData()
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('create') === 'true') {
        setIsCreating(true)
      }
    }
  }, [fetchData])

  async function handleSwitch(bid: string) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('profiles').update({ active_business_id: bid }).eq('id', user?.id)
    setActiveBid(bid)
    window.location.reload()
  }

  async function handleSaveProfile() {
    if (!activeBusiness?.id) return alert("Pilih unit bisnis aktif terlebih dahulu!")
    if (!profileForm.name.trim()) return alert("Nama bisnis wajib diisi!")

    setSubmitting(true)
    setSaveSuccessMsg('')

    try {
      // Create JSON fallback payload for address/profile_data
      const jsonExtraPayload = {
        address: profileForm.address || '',
        city: profileForm.city || '',
        province: profileForm.province || '',
        postal_code: profileForm.postal_code || '',
        email: profileForm.email || '',
        website: profileForm.website || '',
        legal_name: profileForm.legal_name || '',
        industry: profileForm.industry || 'retail',
        tax_id: profileForm.tax_id || '',
        currency: profileForm.currency || 'IDR',
        signatory_name: profileForm.signatory_name || '',
        signatory_title: profileForm.signatory_title || '',
        logo_url: profileForm.logo_url || '',
        phone: profileForm.phone || '',
        timezone: profileForm.timezone || 'Asia/Jakarta',
      }

      const updatePayload: Record<string, any> = {
        name: profileForm.name.trim(),
        phone: profileForm.phone?.trim() || null,
        timezone: profileForm.timezone || 'Asia/Jakarta',
        address: JSON.stringify(jsonExtraPayload),
      }

      // Try updating with extra column fields if available in schema
      try {
        updatePayload.email = profileForm.email || null
        updatePayload.website = profileForm.website || null
        updatePayload.legal_name = profileForm.legal_name || null
        updatePayload.industry = profileForm.industry || null
        updatePayload.tax_id = profileForm.tax_id || null
        updatePayload.currency = profileForm.currency || 'IDR'
        updatePayload.city = profileForm.city || null
        updatePayload.province = profileForm.province || null
        updatePayload.postal_code = profileForm.postal_code || null
        updatePayload.signatory_name = profileForm.signatory_name || null
        updatePayload.signatory_title = profileForm.signatory_title || null
      } catch (e) {
        // Ignore column extension errors if schema doesn't have columns yet
      }

      const { error } = await supabase
        .from('businesses')
        .update(updatePayload)
        .eq('id', activeBusiness.id)

      if (error) {
        // If column error occurs, fallback to basic update fields with serialized JSON address
        const fallbackPayload = {
          name: profileForm.name.trim(),
          phone: profileForm.phone?.trim() || null,
          timezone: profileForm.timezone || 'Asia/Jakarta',
          address: JSON.stringify(jsonExtraPayload),
        }
        const { error: fbErr } = await supabase
          .from('businesses')
          .update(fallbackPayload)
          .eq('id', activeBusiness.id)

        if (fbErr) throw fbErr
      }

      setSaveSuccessMsg('Profil bisnis berhasil diperbarui!')
      await fetchData()
      setTimeout(() => setSaveSuccessMsg(''), 4000)

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan'
      console.error("Save Profile Error:", message)
      alert("Gagal menyimpan profil bisnis: " + message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreate() {
    if (!formData.name) return alert("Nama bisnis wajib diisi!")
    setSubmitting(true)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Sesi habis, silakan login ulang.")

      const { data: newBiz, error: bizError } = await supabase
        .from('businesses')
        .insert([{ 
          name: formData.name.trim(), 
          phone: formData.phone.trim() || null,
          timezone: formData.timezone,
          owner_id: user.id
        }])
        .select()
        .single()

      if (bizError) throw bizError

      const { error: bsError } = await supabase
        .from('business_staff')
        .insert({
          business_id: newBiz.id,
          profile_id: user.id,
          role: 'admin'
        })
      if (bsError) throw bsError

      if (!activeBid) {
        await supabase
          .from('profiles')
          .update({ active_business_id: newBiz.id })
          .eq('id', user.id)
      }

      setIsCreating(false)
      setFormData({ name: '', phone: '', timezone: 'Asia/Jakarta' })
      fetchData()
      alert("Unit bisnis baru berhasil dibuat!")

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan'
      console.error("Create Error:", message)
      alert("Gagal membuat bisnis: " + message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEditBusiness(biz: Business) {
    setEditingBusiness(biz)
    setEditFormData({
      name: biz.name || '',
      phone: biz.phone || '',
      timezone: biz.timezone || 'Asia/Jakarta',
    })
  }

  async function handleUpdateBusiness() {
    if (!editingBusiness) return
    if (!editFormData.name) return alert("Nama bisnis wajib diisi!")

    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('businesses')
        .update({
          name: editFormData.name,
          phone: editFormData.phone,
          timezone: editFormData.timezone,
        })
        .eq('id', editingBusiness.id)

      if (error) throw error

      setEditingBusiness(null)
      await fetchData()
      alert("Unit bisnis berhasil diperbarui!")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan'
      console.error("Update Error:", message)
      alert("Gagal update bisnis: " + message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <SettingsLayout>
        <div className="bg-white rounded-2xl border border-[#E2E2DC] p-12 flex flex-col items-center justify-center min-h-[350px] gap-3">
          <div className="w-8 h-8 border-3 border-[#E2E2DC] border-t-blue-600 rounded-full animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest text-[#A8A89E]">Memuat Profil Bisnis...</p>
        </div>
      </SettingsLayout>
    )
  }

  return (
    <SettingsLayout
      title={currentTab === 'units' ? "Kelola Unit Bisnis" : "Profil Bisnis (Setting Umum)"}
      subtitle={
        currentTab === 'units'
          ? "Daftar unit bisnis yang Anda kelola. Pilih unit bisnis aktif atau tambahkan unit baru."
          : "Informasi profil umum, legalitas, kontak, alamat, serta penanggung jawab faktur usaha Anda."
      }
    >
      {!activeBid && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-xs font-semibold flex items-center gap-3 shadow-xs">
          <span className="text-lg">⚠️</span>
          <span>Anda belum memilih unit bisnis aktif. Silakan pilih <strong>"Ganti ke Unit Ini"</strong> pada menu Unit Bisnis di bawah.</span>
        </div>
      )}

      {/* TOP VIEW TAB SWITCHER HEADER */}
      <div className="bg-white rounded-2xl border border-[#E2E2DC] p-2 flex items-center gap-2 shadow-xs">
        <button
          onClick={() => router.push('/settings/business?tab=profile')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            currentTab === 'profile'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-[#6B6B63] hover:text-[#1C1C1A] hover:bg-[#F7F7F5]'
          }`}
        >
          <span>🏢</span>
          <span>Profil Umum Bisnis</span>
        </button>

        <button
          onClick={() => router.push('/settings/business?tab=units')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            currentTab === 'units'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-[#6B6B63] hover:text-[#1C1C1A] hover:bg-[#F7F7F5]'
          }`}
        >
          <span>🏬</span>
          <span>Daftar Unit Bisnis ({businesses.length})</span>
        </button>
      </div>

      {/* TAB 1: BUSINESS PROFILE FORM */}
      {currentTab === 'profile' && (
        <div className="space-y-6">
          {saveSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 text-xs font-bold flex items-center justify-between shadow-xs animate-fadeIn">
              <div className="flex items-center gap-2">
                <span className="text-base">✅</span>
                <span>{saveSuccessMsg}</span>
              </div>
              <button onClick={() => setSaveSuccessMsg('')} className="text-emerald-600 hover:text-emerald-900 font-bold">✕</button>
            </div>
          )}

          {/* Business Profile Active Banner */}
          {activeBusiness ? (
            <div className="bg-white rounded-2xl border border-[#E2E2DC] p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white font-black flex items-center justify-center text-2xl shadow-md border-2 border-white ring-4 ring-blue-50">
                  {profileForm.name ? profileForm.name.substring(0, 2).toUpperCase() : 'BI'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-[#1C1C1A] tracking-tight">{profileForm.name || 'Unit Bisnis'}</h2>
                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                      Unit Aktif
                    </span>
                  </div>
                  <p className="text-xs text-[#6B6B63] mt-0.5">
                    {profileForm.legal_name ? `${profileForm.legal_name} • ` : ''}
                    {getTimezoneLabel(profileForm.timezone)} • {profileForm.currency || 'IDR'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => router.push('/settings/business?tab=units')}
                className="px-4 py-2.5 bg-[#F7F7F5] hover:bg-[#EAEAEA] border border-[#E2E2DC] text-[#1C1C1A] rounded-xl text-xs font-bold transition-all flex items-center gap-2 self-start md:self-auto"
              >
                <span>🔄</span>
                <span>Ganti Unit Bisnis</span>
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#E2E2DC] p-6 text-center text-xs font-bold text-[#A8A89E]">
              Tidak ada unit bisnis aktif. Silakan buat atau pilih unit bisnis.
            </div>
          )}

          {/* MAIN PROFILE FORM SECTION */}
          <div className="bg-white rounded-2xl border border-[#E2E2DC] p-6 md:p-8 shadow-xs space-y-8">
            
            {/* Section 1: Informasi Dasar & Brand */}
            <div className="space-y-4">
              <div className="border-b border-[#E2E2DC] pb-3">
                <h3 className="text-sm font-extrabold text-[#1C1C1A] flex items-center gap-2">
                  <span>🏢</span>
                  <span>Informasi Umum &amp; Badan Hukum</span>
                </h3>
                <p className="text-xs text-[#6B6B63] mt-0.5">Identitas utama bisnis yang muncul pada faktur, nota, dan laporan resmi.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Nama Bisnis <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="Contoh: Toko Alamanda Group"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Nama Legal / Badan Hukum (PT/CV/UD)
                  </label>
                  <input
                    type="text"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="Contoh: PT Alamanda Jaya Nusantara"
                    value={profileForm.legal_name || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, legal_name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Kategori / Industri Bisnis
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    value={profileForm.industry || 'retail'}
                    onChange={(e) => setProfileForm({ ...profileForm, industry: e.target.value })}
                  >
                    {INDUSTRY_OPTIONS.map((ind) => (
                      <option key={ind.value} value={ind.value}>{ind.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    NPWP / Tax ID (Nomor Pajak)
                  </label>
                  <input
                    type="text"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="Contoh: 01.234.567.8-901.000"
                    value={profileForm.tax_id || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, tax_id: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Kontak & Media Sosial */}
            <div className="space-y-4 pt-4 border-t border-[#E2E2DC]">
              <div className="border-b border-[#E2E2DC] pb-3">
                <h3 className="text-sm font-extrabold text-[#1C1C1A] flex items-center gap-2">
                  <span>📞</span>
                  <span>Kontak &amp; Komunikasi Usaha</span>
                </h3>
                <p className="text-xs text-[#6B6B63] mt-0.5">Kontak yang digunakan untuk interaksi dengan pelanggan dan faktur.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    No. WhatsApp / Telepon Usaha
                  </label>
                  <input
                    type="text"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="081234567890"
                    value={profileForm.phone || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Email Resmi / Customer Care
                  </label>
                  <input
                    type="email"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="info@bisnisanda.com"
                    value={profileForm.email || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Website / Link Toko Online
                  </label>
                  <input
                    type="url"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="https://bisnisanda.com"
                    value={profileForm.website || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, website: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Alamat Operasional Usaha */}
            <div className="space-y-4 pt-4 border-t border-[#E2E2DC]">
              <div className="border-b border-[#E2E2DC] pb-3">
                <h3 className="text-sm font-extrabold text-[#1C1C1A] flex items-center gap-2">
                  <span>📍</span>
                  <span>Alamat Lengkap Operasional</span>
                </h3>
                <p className="text-xs text-[#6B6B63] mt-0.5">Alamat kantor atau toko tempat usaha Anda beroperasi.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Alamat Jalan / Gedung
                  </label>
                  <input
                    type="text"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="Jl. Merdeka No. 45, Gedung Alamanda Tower Lt. 3"
                    value={profileForm.address || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                      Kota / Kabupaten
                    </label>
                    <input
                      type="text"
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                      placeholder="Jakarta Selatan"
                      value={profileForm.city || ''}
                      onChange={(e) => setProfileForm({ ...profileForm, city: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                      Provinsi
                    </label>
                    <input
                      type="text"
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                      placeholder="DKI Jakarta"
                      value={profileForm.province || ''}
                      onChange={(e) => setProfileForm({ ...profileForm, province: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                      Kode Pos
                    </label>
                    <input
                      type="text"
                      className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                      placeholder="12190"
                      value={profileForm.postal_code || ''}
                      onChange={(e) => setProfileForm({ ...profileForm, postal_code: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4: Pengaturan Regional & Keuangan */}
            <div className="space-y-4 pt-4 border-t border-[#E2E2DC]">
              <div className="border-b border-[#E2E2DC] pb-3">
                <h3 className="text-sm font-extrabold text-[#1C1C1A] flex items-center gap-2">
                  <span>🌐</span>
                  <span>Pengaturan Regional &amp; Mata Uang</span>
                </h3>
                <p className="text-xs text-[#6B6B63] mt-0.5">Penyesuaian waktu pencatatan transaksi &amp; format mata uang utama.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Zona Waktu Transaksi
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    value={profileForm.timezone || 'Asia/Jakarta'}
                    onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })}
                  >
                    {TIMEZONE_OPTIONS.map((timezone) => (
                      <option key={timezone.value} value={timezone.value}>{timezone.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Mata Uang Pembukuan Utama
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    value={profileForm.currency || 'IDR'}
                    onChange={(e) => setProfileForm({ ...profileForm, currency: e.target.value })}
                  >
                    {CURRENCY_OPTIONS.map((curr) => (
                      <option key={curr.value} value={curr.value}>{curr.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 5: Penanggung Jawab & Signatory */}
            <div className="space-y-4 pt-4 border-t border-[#E2E2DC]">
              <div className="border-b border-[#E2E2DC] pb-3">
                <h3 className="text-sm font-extrabold text-[#1C1C1A] flex items-center gap-2">
                  <span>✍️</span>
                  <span>Penanggung Jawab Dokumen &amp; Faktur (Signatory)</span>
                </h3>
                <p className="text-xs text-[#6B6B63] mt-0.5">Nama dan jabatan pengesah yang akan tercetak di bagian bawah Invoice/Nota.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Nama Penanggung Jawab / Pengesah
                  </label>
                  <input
                    type="text"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="Contoh: Alamanda Boss / H. Ahmad"
                    value={profileForm.signatory_name || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, signatory_name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Jabatan / Title
                  </label>
                  <input
                    type="text"
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                    placeholder="Contoh: Direktur Utama / Head of Finance"
                    value={profileForm.signatory_title || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, signatory_title: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* SAVE BUTTON BAR */}
            <div className="pt-6 border-t border-[#E2E2DC] flex items-center justify-between">
              <span className="text-xs text-[#6B6B63]">
                Pastikan data yang Anda masukkan sudah sesuai sebelum menyimpan.
              </span>
              <button
                disabled={submitting}
                onClick={handleSaveProfile}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                <span>💾</span>
                <span>{submitting ? 'Menyimpan Profil...' : 'Simpan Profil Bisnis'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BUSINESS UNITS LIST & SWITCHER */}
      {currentTab === 'units' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-extrabold text-[#1C1C1A]">Daftar Unit Bisnis Anda</h2>
              <p className="text-xs text-[#6B6B63]">Pilih unit bisnis aktif atau tambahkan cabang / unit usaha baru.</p>
            </div>
            <button
              onClick={() => setIsCreating(true)}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 self-start sm:self-auto"
            >
              <span>+</span>
              <span>Tambah Unit Bisnis Baru</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {businesses.map((biz) => {
              const isActive = activeBid === biz.id
              return (
                <div 
                  key={biz.id} 
                  className={`bg-white rounded-2xl border transition-all p-6 flex flex-col justify-between ${
                    isActive 
                      ? 'border-blue-600 ring-2 ring-blue-600/10 shadow-md' 
                      : 'border-[#E2E2DC] hover:border-[#C8C8C0] shadow-xs'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 font-extrabold flex items-center justify-center text-lg">
                        {biz.name ? biz.name.substring(0, 2).toUpperCase() : 'BI'}
                      </div>
                      {isActive && (
                        <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                          Aktif
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-[#1C1C1A] mb-1">{biz.name}</h3>
                    {biz.legal_name && (
                      <p className="text-xs text-[#6B6B63] mb-2 font-medium">{biz.legal_name}</p>
                    )}

                    <div className="space-y-1 text-xs text-[#6B6B63]">
                      <p className="flex items-center gap-1.5">
                        <span>📱</span>
                        <span>{biz.phone || 'Belum ada kontak WA'}</span>
                      </p>
                      <p className="flex items-center gap-1.5">
                        <span>🌐</span>
                        <span>{getTimezoneLabel(biz.timezone)}</span>
                      </p>
                      {biz.city && (
                        <p className="flex items-center gap-1.5">
                          <span>📍</span>
                          <span>{biz.city}, {biz.province || ''}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-6 mt-6 border-t border-[#E2E2DC] text-xs font-bold">
                    {!isActive ? (
                      <button 
                        onClick={() => handleSwitch(biz.id)} 
                        className="text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        Ganti ke Unit Ini
                      </button>
                    ) : (
                      <span className="text-emerald-700 flex items-center gap-1 font-extrabold">
                        ✓ Unit Aktif
                      </span>
                    )}
                    {userRole === 'admin' && (
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => openEditBusiness(biz)} 
                          className="text-[#6B6B63] hover:text-[#1C1C1A]"
                        >
                          Edit Quick Info
                        </button>
                        <Link 
                          href="/settings/staff" 
                          className="text-blue-600 hover:text-blue-700"
                        >
                          Staf &rarr;
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* MODAL CREATE UNIT */}
      {isCreating && mounted && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-fadeIn overflow-y-auto overscroll-contain">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-4">
              <h2 className="text-lg font-extrabold text-[#1C1C1A]">Tambah Unit Bisnis Baru</h2>
              <button 
                onClick={() => setIsCreating(false)} 
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  Nama Bisnis <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  placeholder="Contoh: Toko Cabang Surabaya"
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  No. WhatsApp Kontak
                </label>
                <input 
                  type="text" 
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  placeholder="081234567890"
                  value={formData.phone} 
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  Zona Waktu
                </label>
                <select
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={formData.timezone}
                  onChange={e => setFormData({...formData, timezone: e.target.value})}
                >
                  {TIMEZONE_OPTIONS.map((timezone) => (
                    <option key={timezone.value} value={timezone.value}>{timezone.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                disabled={submitting}
                onClick={() => setIsCreating(false)} 
                className="flex-1 px-4 py-2.5 border border-[#E2E2DC] rounded-xl text-xs font-bold text-[#6B6B63] hover:bg-[#F7F7F5] transition-all disabled:opacity-50 cursor-pointer"
              >
                Batal
              </button>
              <button 
                disabled={submitting}
                onClick={handleCreate} 
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'Menyimpan...' : 'Buat Bisnis'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL EDIT QUICK INFO */}
      {editingBusiness && mounted && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-fadeIn overflow-y-auto overscroll-contain">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-4">
              <h2 className="text-lg font-extrabold text-[#1C1C1A]">Edit Quick Info Unit</h2>
              <button 
                onClick={() => setEditingBusiness(null)} 
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  Nama Bisnis <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={editFormData.name} 
                  onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  No. WhatsApp Kontak
                </label>
                <input 
                  type="text" 
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={editFormData.phone} 
                  onChange={e => setEditFormData({...editFormData, phone: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  Zona Waktu
                </label>
                <select
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={editFormData.timezone}
                  onChange={e => setEditFormData({...editFormData, timezone: e.target.value})}
                >
                  {TIMEZONE_OPTIONS.map((timezone) => (
                    <option key={timezone.value} value={timezone.value}>{timezone.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                disabled={submitting}
                onClick={() => setEditingBusiness(null)} 
                className="flex-1 px-4 py-2.5 border border-[#E2E2DC] rounded-xl text-xs font-bold text-[#6B6B63] hover:bg-[#F7F7F5] transition-all disabled:opacity-50 cursor-pointer"
              >
                Batal
              </button>
              <button 
                disabled={submitting}
                onClick={handleUpdateBusiness} 
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </SettingsLayout>
  )
}

export default function BusinessSettings() {
  return (
    <Suspense fallback={
      <div className="p-8 max-w-7xl mx-auto text-center font-bold text-xs text-[#A8A89E] animate-pulse">
        Memuat Halaman Bisnis...
      </div>
    }>
      <BusinessSettingsInner />
    </Suspense>
  )
}
