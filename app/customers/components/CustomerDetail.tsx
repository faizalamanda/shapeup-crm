import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import { CustomerAddressForm, AddressData, EMPTY_ADDRESS } from '@/components/CustomerAddressForm'

interface CustomerDetailProps {
  customer: any
  onClose: () => void
  onUpdate?: (updatedCustomer: any) => void
}

// Deterministic colors for custom tags
function getTagColors(tag: string) {
  const colors = [
    { bg: 'bg-blue-50 border-blue-100 text-blue-700', hexBg: '#eff6ff', hexText: '#1d4ed8' },
    { bg: 'bg-purple-50 border-purple-100 text-purple-700', hexBg: '#fdf4ff', hexText: '#9333ea' },
    { bg: 'bg-emerald-50 border-emerald-100 text-emerald-700', hexBg: '#f0fdf4', hexText: '#16a34a' },
    { bg: 'bg-amber-50 border-amber-100 text-amber-700', hexBg: '#fffbeb', hexText: '#d97706' },
    { bg: 'bg-rose-50 border-rose-100 text-rose-700', hexBg: '#fff1f2', hexText: '#e11d48' },
    { bg: 'bg-cyan-50 border-cyan-100 text-cyan-700', hexBg: '#ecfeff', hexText: '#0891b2' },
  ]
  const hash = tag.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

export function CustomerDetail({ customer, onClose, onUpdate }: CustomerDetailProps) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'order' | 'contact' | 'notes'>('order')
  const [orders, setOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)

  // Full customer details from DB
  const [fullCustomer, setFullCustomer] = useState<any>(null)
  const [loadingCustomer, setLoadingCustomer] = useState(false)

  // Edit Mode state
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // Edit Form Fields
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editAddress, setEditAddress] = useState<AddressData>(EMPTY_ADDRESS)
  
  // Custom CRM fields in metadata
  const [editNotes, setEditNotes] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editJobTitle, setEditJobTitle] = useState('')
  const [editInstagram, setEditInstagram] = useState('')
  const [editAltPhone, setEditAltPhone] = useState('')
  const [editLeadSource, setEditLeadSource] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [newTagInput, setNewTagInput] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (customer) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [customer])

  // Fetch full customer details
  const fetchFullCustomer = useCallback(async () => {
    if (!customer?.customer_id) return
    setLoadingCustomer(true)
    try {
      const res = await fetch(`/api/customers/${customer.customer_id}`)
      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Gagal memuat detail pelanggan')
      }
      setFullCustomer(result.customer)
    } catch (err) {
      console.error('Error fetching full customer data:', err)
    } finally {
      setLoadingCustomer(false)
    }
  }, [customer?.customer_id])

  // Fetch orders history
  const fetchCustomerOrders = useCallback(async () => {
    if (!customer?.customer_id) return
    setLoadingOrders(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customer.customer_id)
        .order('order_date', { ascending: false })

      if (error) throw error
      setOrders(data || [])
    } catch (err) {
      console.error('Error fetching customer orders:', err)
    } finally {
      setLoadingOrders(false)
    }
  }, [customer?.customer_id, supabase])

  useEffect(() => {
    if (customer?.customer_id) {
      fetchFullCustomer()
      fetchCustomerOrders()
      setIsEditing(false)
      setSaveStatus('idle')
    }
  }, [customer, fetchFullCustomer, fetchCustomerOrders])

  // Populate Edit Form fields
  const handleEnterEditMode = () => {
    if (!fullCustomer) return
    setEditName(fullCustomer.name || '')
    setEditPhone(fullCustomer.phone || '')
    setEditEmail(fullCustomer.email || '')
    setEditCategory(fullCustomer.category || 'General')
    
    // Address data fallback
    setEditAddress(fullCustomer.address_data || {
      country_preset: 'indonesia',
      country: 'Indonesia',
      address_line1: '',
      address_line2: '',
      subdistrict: '',
      city: '',
      state: '',
      postcode: '',
    })

    const meta = fullCustomer.metadata || {}
    setEditNotes(meta.notes || '')
    setEditCompany(meta.company || '')
    setEditJobTitle(meta.job_title || '')
    setEditInstagram(meta.instagram || '')
    setEditAltPhone(meta.alt_phone || '')
    setEditLeadSource(meta.lead_source || '')
    setEditTags(meta.tags || [])
    setNewTagInput('')
    
    setIsEditing(true)
    setSaveStatus('idle')
    setErrorMessage('')
  }

  // Tag Management helpers
  const handleAddTag = () => {
    const cleanTag = newTagInput.trim().toUpperCase()
    if (!cleanTag) return
    if (editTags.includes(cleanTag)) {
      setNewTagInput('')
      return
    }
    setEditTags([...editTags, cleanTag])
    setNewTagInput('')
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setEditTags(editTags.filter(t => t !== tagToRemove))
  }

  // Submit update
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editName.trim()) {
      setErrorMessage('Nama Lengkap wajib diisi!')
      return
    }
    if (!editPhone.trim()) {
      setErrorMessage('Nomor HP/WhatsApp wajib diisi!')
      return
    }

    setSaving(true)
    setSaveStatus('saving')
    setErrorMessage('')

    try {
      const response = await fetch(`/api/customers/${customer.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          phone: editPhone.trim(),
          email: editEmail.trim() || null,
          category: editCategory,
          address_data: editAddress,
          metadata: {
            notes: editNotes.trim(),
            company: editCompany.trim(),
            job_title: editJobTitle.trim(),
            instagram: editInstagram.trim(),
            alt_phone: editAltPhone.trim(),
            lead_source: editLeadSource,
            tags: editTags,
          }
        })
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Gagal menyimpan perubahan data customer')
      }

      setSaveStatus('success')
      // Update full customer state
      setFullCustomer(result.customer)

      // Notify parent list to update UI in-place
      if (onUpdate) {
        onUpdate(result.customer)
      }

      // Exit edit mode after a brief delay
      setTimeout(() => {
        setIsEditing(false)
        setSaveStatus('idle')
      }, 1000)

    } catch (err: any) {
      console.error(err)
      setSaveStatus('error')
      setErrorMessage(err.message || 'Gagal menyimpan perubahan.')
    } finally {
      setSaving(false)
    }
  }

  if (!customer || !mounted) return null

  const formatIDR = (val: number) => 
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

  // Construct a readable address from the full customer address data
  const renderReadableAddress = () => {
    const ad = fullCustomer?.address_data
    if (!ad) return 'Belum ada alamat terdaftar.'
    const parts = [
      ad.address_line1,
      ad.address_line2,
      ad.subdistrict ? `Kec. ${ad.subdistrict}` : '',
      ad.city,
      ad.state,
      ad.postcode,
      ad.country
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : 'Belum ada alamat terdaftar.'
  }

  const tags = fullCustomer?.metadata?.tags || []

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 pb-10 overflow-y-auto bg-slate-900/60 backdrop-blur-[2px]" onClick={onClose}>
      <div className="bg-white w-full max-w-4xl border border-slate-200 shadow-2xl rounded-2xl relative mx-4 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-start bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100">
                Profil Pelanggan
              </span>
              {fullCustomer?.category && (
                <span className="text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest">
                  {fullCustomer.category}
                </span>
              )}
            </div>
            
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">
              {isEditing ? 'Edit Data Pelanggan' : (fullCustomer?.name || customer.name || 'Tanpa Nama')}
            </h2>

            {/* Display Tags */}
            {!isEditing && tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {tags.map((tag: string) => {
                  const tagColors = getTagColors(tag)
                  return (
                    <span 
                      key={tag}
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${tagColors.bg}`}
                    >
                      {tag}
                    </span>
                  )
                })}
              </div>
            )}

            {!isEditing && (
              <div className="flex items-center gap-3 mt-3 text-slate-500 text-xs font-semibold">
                <span>+{fullCustomer?.phone || customer.phone}</span>
                {(fullCustomer?.email || customer.email) && (
                  <>
                    <span className="text-slate-300">|</span>
                    <span>{fullCustomer?.email || customer.email}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isEditing && (
              <button 
                onClick={handleEnterEditMode}
                className="text-white hover:bg-blue-700 font-bold text-[10px] tracking-wider uppercase bg-blue-600 border border-blue-700 px-4 py-2.5 rounded-xl shadow-sm transition-all"
              >
                ✏️ Edit Profil
              </button>
            )}
            <button 
              onClick={onClose} 
              className="text-slate-400 hover:text-slate-600 font-bold text-[10px] tracking-wider uppercase bg-white border border-slate-200 px-4 py-2.5 rounded-xl shadow-sm transition-all"
            >
              Tutup
            </button>
          </div>
        </div>

        {/* ── VIEW MODE ──────────────────────────────────────────────────────── */}
        {!isEditing && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            
            {/* Main Area */}
            <div className="md:col-span-2 p-8 border-r border-slate-100 min-h-[450px]">
              
              {/* Tabs */}
              <div className="flex gap-6 border-b border-slate-200 mb-6 font-black text-[10px] uppercase tracking-widest">
                {['order', 'contact', 'notes'].map((tab) => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`pb-3 transition-all border-b-2 ${
                      activeTab === tab 
                        ? 'border-blue-600 text-blue-600 font-black' 
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {tab === 'order' ? 'Riwayat Belanja' : tab === 'contact' ? 'Interaksi & CRM' : 'Catatan'}
                  </button>
                ))}
              </div>

              {/* Riwayat Belanja (Orders) */}
              {activeTab === 'order' && (
                <div className="space-y-4">
                  {loadingOrders ? (
                    <div className="py-12 text-center text-slate-400 font-bold uppercase tracking-wider text-xs animate-pulse">
                      Memuat riwayat transaksi...
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 font-medium italic text-sm">
                      Belum ada riwayat transaksi terdaftar.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-2">
                      {orders.map((o) => {
                        let items: any[] = []
                        if (o.items_json) {
                          try {
                            items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : o.items_json
                          } catch (e) {
                            items = []
                          }
                        }

                        return (
                          <div key={o.id} className="p-4 border border-slate-100 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <span className="font-bold text-slate-800 text-sm">Order #{o.order_number || o.id.slice(0, 8)}</span>
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider ml-2.5">
                                  {o.order_date 
                                    ? new Date(o.order_date).toLocaleDateString('id-ID', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric'
                                      })
                                    : '-'}
                                </span>
                              </div>
                              <span className="font-black text-slate-900 text-sm">{formatIDR(o.grand_total)}</span>
                            </div>
                            
                            <div className="space-y-1 pl-1 mb-2">
                              {items.map((item: any, idx: number) => (
                                <p key={idx} className="text-xs text-slate-600 font-medium flex justify-between">
                                  <span>• {item.name || item.product_name}</span>
                                  <span className="text-slate-400 font-bold text-[10px]">{item.quantity} pcs</span>
                                </p>
                              ))}
                            </div>

                            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider pt-2 border-t border-slate-100 text-slate-400">
                              <span>Metode: {o.payment_method || 'COD'}</span>
                              <span className={`px-1.5 py-0.5 rounded ${
                                ['completed', 'complete'].includes(o.status?.toLowerCase())
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : ['failed', 'cancelled'].includes(o.status?.toLowerCase())
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-amber-50 text-amber-600'
                              }`}>
                                {o.status}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Interaksi & CRM Tab */}
              {activeTab === 'contact' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Nama Perusahaan</p>
                      <p className="text-xs font-bold text-slate-800">{fullCustomer?.metadata?.company || '—'}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Jabatan / Pekerjaan</p>
                      <p className="text-xs font-bold text-slate-800">{fullCustomer?.metadata?.job_title || '—'}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Instagram</p>
                      {fullCustomer?.metadata?.instagram ? (
                        <a 
                          href={`https://instagram.com/${fullCustomer.metadata.instagram.replace(/^@/, '')}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-xs font-bold text-blue-600 hover:underline"
                        >
                          @{fullCustomer.metadata.instagram.replace(/^@/, '')}
                        </a>
                      ) : (
                        <p className="text-xs font-bold text-slate-800">—</p>
                      )}
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">No HP Alternatif</p>
                      <p className="text-xs font-bold text-slate-800">{fullCustomer?.metadata?.alt_phone || '—'}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Sumber Kontak (Lead Source)</p>
                      <span className="inline-block text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">
                        {fullCustomer?.metadata?.lead_source || orders[0]?.source_platform || 'WooCommerce Store'}
                      </span>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Terakhir Dihubungi</p>
                      <p className="text-xs font-bold text-slate-800">Belum pernah dilakukan follow-up broadcast via sistem.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Catatan Tab */}
              {activeTab === 'notes' && (
                <div className="bg-amber-50/50 p-6 border-l-4 border-amber-400 rounded-r-xl text-xs text-slate-750 leading-relaxed shadow-sm whitespace-pre-wrap">
                  {fullCustomer?.metadata?.notes ? `"${fullCustomer.metadata.notes}"` : '"Tidak ada catatan khusus mengenai pelanggan ini."'}
                </div>
              )}
            </div>

            {/* Sidebar Area */}
            <div className="p-8 bg-slate-50/50 rounded-br-2xl rounded-bl-2xl md:rounded-bl-none space-y-8 border-t md:border-t-0 md:border-l border-slate-100">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Alamat Pengiriman</label>
                <p className="text-xs font-semibold leading-relaxed text-slate-600 bg-white p-4 border border-slate-200/60 rounded-xl shadow-sm">
                  {loadingCustomer ? 'Memuat alamat...' : renderReadableAddress()}
                </p>
              </div>
              
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Metrik Keaktifan</label>
                <div className="space-y-3 text-xs font-bold uppercase tracking-wide">
                  <div className="flex justify-between py-2 border-b border-slate-200/50">
                    <span className="text-slate-400">Total Transaksi</span>
                    <span className="text-slate-800">{customer.total_order_count || 0}x</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200/50 text-blue-600">
                    <span className="text-slate-400">Total Spend (LTV)</span>
                    <span>{formatIDR(customer.ltv || 0)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200/50">
                    <span className="text-slate-400">Rata-rata Order (AOV)</span>
                    <span className="text-slate-800">{formatIDR(customer.aov || 0)}</span>
                  </div>
                </div>
              </div>

              <a 
                href={`https://wa.me/${fullCustomer?.phone || customer.phone}`} 
                target="_blank" 
                rel="noreferrer"
                className="block w-full bg-[#25D366] hover:bg-[#20ba5a] text-white py-3.5 rounded-xl text-[10px] font-black text-center shadow-md shadow-emerald-100 uppercase tracking-wider transition-all active:scale-95"
              >
                Hubungi via WhatsApp
              </a>
            </div>
          </div>
        )}

        {/* ── EDIT MODE ──────────────────────────────────────────────────────── */}
        {isEditing && (
          <form onSubmit={handleSave}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
              
              {/* Left Column (Fields) */}
              <div className="md:col-span-2 p-8 border-r border-slate-100 space-y-6 max-h-[550px] overflow-y-auto">
                
                {/* Save status message */}
                {saveStatus === 'success' && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl flex items-center gap-2">
                    ✅ Perubahan berhasil disimpan!
                  </div>
                )}
                {saveStatus === 'error' && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center gap-2">
                    ❌ {errorMessage || 'Gagal menyimpan perubahan'}
                  </div>
                )}

                {/* Section 1: Identitas */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100">
                    👤 Informasi Identitas
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Nama Lengkap *</label>
                      <input 
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white font-medium"
                        placeholder="Contoh: Frida Ayu Meryana"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Nomor HP / WhatsApp *</label>
                      <input 
                        type="text"
                        value={editPhone}
                        onChange={e => setEditPhone(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white font-medium"
                        placeholder="Contoh: 08123456789"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Email</label>
                      <input 
                        type="email"
                        value={editEmail}
                        onChange={e => setEditEmail(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white font-medium"
                        placeholder="Contoh: frida@email.com"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Kategori Pelanggan</label>
                      <select
                        value={editCategory}
                        onChange={e => setEditCategory(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white font-medium"
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

                {/* Section 2: CRM & Kontak Tambahan */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100">
                    🏢 Profil CRM & Kontak Tambahan
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Nama Perusahaan</label>
                      <input 
                        type="text"
                        value={editCompany}
                        onChange={e => setEditCompany(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white"
                        placeholder="Nama Perusahaan / Organisasi"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Jabatan / Pekerjaan</label>
                      <input 
                        type="text"
                        value={editJobTitle}
                        onChange={e => setEditJobTitle(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white"
                        placeholder="Contoh: Owner, Purchasing Manager"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Instagram Handle</label>
                      <div className="relative">
                        <span className="absolute left-3 top-3 text-slate-400 text-sm font-semibold">@</span>
                        <input 
                          type="text"
                          value={editInstagram.replace(/^@/, '')}
                          onChange={e => setEditInstagram(e.target.value)}
                          className="w-full pl-8 pr-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white"
                          placeholder="username"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">No HP Alternatif</label>
                      <input 
                        type="text"
                        value={editAltPhone}
                        onChange={e => setEditAltPhone(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white"
                        placeholder="Contoh: 08129999999"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Sumber Kontak (Lead Source)</label>
                      <select
                        value={editLeadSource}
                        onChange={e => setEditLeadSource(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white"
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

                {/* Section 3: CRM Label / Tags */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100">
                    🏷️ Label / Tag Pelanggan
                  </h3>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Tambahkan Tag Baru</label>
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
                        className="flex-1 p-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white"
                        placeholder="Ketik tag (contoh: WHOLESALE, REAPEATBUYER) lalu tekan Enter"
                      />
                      <button
                        type="button"
                        onClick={handleAddTag}
                        className="px-4 py-2 border border-slate-200 hover:border-blue-500 hover:text-blue-600 bg-white rounded-xl text-xs font-bold text-slate-600 transition-all"
                      >
                        Tambah
                      </button>
                    </div>
                  </div>

                  {editTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {editTags.map(tag => {
                        const tagColors = getTagColors(tag)
                        return (
                          <span 
                            key={tag}
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${tagColors.bg}`}
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(tag)}
                              className="text-slate-400 hover:text-slate-600 font-bold ml-0.5 focus:outline-none"
                              title="Hapus tag"
                            >
                              ✕
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Belum ada label/tag yang diberikan ke pelanggan ini.</p>
                  )}
                </div>

                {/* Section 4: Catatan */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100">
                    ✍️ Catatan CRM (CRM Notes)
                  </h3>
                  <textarea 
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    rows={4}
                    className="w-full p-3 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:outline-none bg-white"
                    placeholder="Tulis riwayat negoisasi, preferensi ukuran, komplain, atau keterangan spesifik customer di sini..."
                  />
                </div>

              </div>

              {/* Right Column (Address Form) */}
              <div className="p-8 bg-slate-50/50 rounded-br-2xl space-y-6 max-h-[550px] overflow-y-auto border-t md:border-t-0 md:border-l border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-2 border-b border-slate-100">
                  📍 Alamat Pengiriman
                </h3>
                <CustomerAddressForm 
                  value={editAddress}
                  onChange={setEditAddress}
                  compact={true}
                />
              </div>

            </div>

            {/* Edit Footer (Simpan / Batal) */}
            <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={saving}
                className="px-5 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-550 hover:bg-slate-100 transition-all disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-400 transition-all flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  'Simpan Perubahan'
                )}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>,
    document.body
  )
}