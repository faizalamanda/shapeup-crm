"use client"
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { useAccounts, Account } from '@/hooks/useAccounts'
import { useSuppliers, Supplier } from '@/hooks/useSuppliers'
import { invalidateSuppliersCache } from '@/lib/services/supplierService'

const STANDARD_CATEGORIES = [
  { key: 'marketing', name: 'Pemasaran & Promosi', code: '503100', icon: '📢', desc: 'Biaya iklan, sosmed, brosur, promo' },
  { key: 'utilities', name: 'Utilitas (Listrik/Air/Internet)', code: '503200', icon: '⚡', desc: 'Listrik, air, wifi, pulsa, telepon' },
  { key: 'salaries', name: 'Gaji & Upah Karyawan', code: '503300', icon: '👥', desc: 'Gaji, bonus, lemburan staf' },
  { key: 'supplies', name: 'Perlengkapan Kantor & ATK', code: '503400', icon: '✏️', desc: 'Kertas, pulpen, printer, ATK' },
  { key: 'travel', name: 'Transportasi & Perjalanan', code: '503500', icon: '🚗', desc: 'Bensin, tol, parkir, dinas luar' },
  { key: 'rent', name: 'Sewa Tempat & Fasilitas', code: '503600', icon: '🏢', desc: 'Sewa ruko, gedung, alat' },
  { key: 'repairs', name: 'Pemeliharaan & Perbaikan', code: '503700', icon: '🔧', desc: 'Servis AC, renovasi, perbaikan' },
  { key: 'taxes', name: 'Pajak & Perizinan', code: '503800', icon: '⚖️', desc: 'Pajak usaha, legalitas, izin' },
  { key: 'entertainment', name: 'Konsumsi & Hiburan', code: '503900', icon: '☕', desc: 'Makan rapat, konsumsi, jamuan' },
  { key: 'bank_fees', name: 'Admin Bank & Bunga', code: '504000', icon: '🏦', desc: 'Biaya admin, transfer fee, bunga' },
  { key: 'equipment', name: 'Inventaris & Peralatan (CAPEX)', code: '120000', icon: '💻', desc: 'Laptop, HP, printer, meja, kursi' },
  { key: 'operational', name: 'Beban Operasional Lainnya', code: '503000', icon: '💼', desc: 'Biaya umum operasional lainnya' }
]

const getCategoryDisplay = (account: { code: string; name: string } | null | undefined) => {
  if (!account) return { name: '-', icon: '💸', color: 'text-gray-500 bg-gray-50 border-gray-100' }
  const std = STANDARD_CATEGORIES.find(c => c.code === account.code)
  if (std) {
    return {
      name: std.name,
      icon: std.icon,
      color: 'text-blue-700 bg-blue-50 border-blue-100'
    }
  }
  return {
    name: account.name,
    icon: '⚙️',
    color: 'text-amber-700 bg-amber-50 border-amber-100'
  }
}

export default function NewExpensePage() {
  const { activeBusiness } = useUserContext()
  const router = useRouter()

  const activeBizId = activeBusiness?.id || null
  const activeBizName = activeBusiness?.name || 'Bisnis Saya'

  // Decoupled SWR hooks for Accounts and Suppliers (0ms instant loading)
  const { accounts, loading: accountsLoading } = useAccounts(activeBizId)
  const { suppliers, setSuppliers, loading: suppliersLoading } = useSuppliers(activeBizId)

  const loading = accountsLoading || suppliersLoading
  const [mounted, setMounted] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)

  // Form State
  const [formCategoryAccountId, setFormCategoryAccountId] = useState('')
  const [formPaymentAccountId, setFormPaymentAccountId] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formDescription, setFormDescription] = useState('')
  const [formVendorName, setFormVendorName] = useState('')
  const [formAttachmentUrl, setFormAttachmentUrl] = useState('')

  // Payment Terms States
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid' | 'partial'>('paid')
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() + 30)
    return date.toISOString().split('T')[0]
  })
  const [amountPaid, setAmountPaid] = useState('')

  // File upload UI state
  const [compressing, setCompressing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Category Dropdown States
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Vendor Autocomplete & Dropdown States
  const [isVendorDropdownOpen, setIsVendorDropdownOpen] = useState(false)
  const [vendorSearch, setVendorSearch] = useState('')
  const vendorDropdownRef = useRef<HTMLDivElement>(null)

  // Create Supplier Modal States
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [newVendorEmail, setNewVendorEmail] = useState('')
  const [newVendorPhone, setNewVendorPhone] = useState('')
  const [newVendorAddress, setNewVendorAddress] = useState('')
  const [vendorSubmitLoading, setVendorSubmitLoading] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsCategoryDropdownOpen(false)
      }
      if (vendorDropdownRef.current && !vendorDropdownRef.current.contains(event.target as Node)) {
        setIsVendorDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Filter accounts
  const categoryAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'EXPENSE' || (a.type === 'ASSET' && !a.code.startsWith('101') && !a.code.startsWith('102')))
  }, [accounts])

  const paymentAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  }, [accounts])

  // Filter suppliers based on search text
  const filteredSuppliers = useMemo(() => {
    const q = vendorSearch.toLowerCase()
    return suppliers.filter(s => s.name.toLowerCase().includes(q))
  }, [suppliers, vendorSearch])

  // Image compressor & uploader
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeBizId) return

    setCompressing(true)
    setUploadProgress('Mempersiapkan berkas...')

    try {
      let finalFile: Blob | File = file

      if (file.type.startsWith('image/')) {
        setUploadProgress('Mengompres gambar kuitansi...')
        finalFile = await compressImage(file)
      }

      setUploadProgress('Mengunggah ke storage...')
      const fileExt = file.type.startsWith('image/') ? 'jpg' : file.name.split('.').pop()
      const fileName = `${activeBizId}/${Date.now()}_receipt.${fileExt}`

      const { error } = await supabase.storage
        .from('attachments')
        .upload(fileName, finalFile, {
          contentType: file.type.startsWith('image/') ? 'image/jpeg' : file.type,
          upsert: true
        })

      if (error) throw error

      const { data: { publicUrl } } = supabase.storage
        .from('attachments')
        .getPublicUrl(fileName)

      setFormAttachmentUrl(publicUrl)
      setUploadProgress('Unggahan selesai! ✅')
    } catch (err: any) {
      console.error('Error uploading file:', err)
      alert('Gagal mengunggah kuitansi: ' + err.message)
      setUploadProgress('')
    } finally {
      setCompressing(false)
    }
  }

  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (event) => {
        const img = new Image()
        img.src = event.target?.result as string
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const MAX_WIDTH = 1024
          const MAX_HEIGHT = 1024
          let width = img.width
          let height = img.height

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width
              width = MAX_WIDTH
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height
              height = MAX_HEIGHT
            }
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Canvas context could not be created'))
            return
          }
          
          ctx.drawImage(img, 0, 0, width, height)
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob)
              } else {
                reject(new Error('Canvas compression output null'))
              }
            },
            'image/jpeg',
            0.75
          )
        }
      }
      reader.onerror = (err) => reject(err)
    })
  }

  // Handle new Vendor creation from Modal
  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newVendorName.trim()) {
      alert('Nama vendor wajib diisi!')
      return
    }

    setVendorSubmitLoading(true)
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newVendorName.trim(),
          email: newVendorEmail.trim() || null,
          phone: newVendorPhone.trim() || null,
          address: newVendorAddress.trim() || null
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal membuat vendor baru')
      }

      const created = await res.json()
      setSuppliers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      if (activeBizId) {
        invalidateSuppliersCache(activeBizId)
      }
      setFormVendorName(created.name)
      setVendorSearch(created.name)
      setIsVendorModalOpen(false)
      setIsVendorDropdownOpen(false)
    } catch (err: any) {
      console.error(err)
      alert(err.message)
    } finally {
      setVendorSubmitLoading(false)
    }
  }

  // Open Vendor Modal Helper
  const openNewVendorModal = () => {
    setNewVendorName(vendorSearch)
    setNewVendorEmail('')
    setNewVendorPhone('')
    setNewVendorAddress('')
    setIsVendorModalOpen(true)
  }

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formCategoryAccountId) {
      alert('Silakan pilih kategori pengeluaran terlebih dahulu!')
      return
    }

    if (paymentStatus !== 'unpaid' && !formPaymentAccountId) {
      alert('Silakan pilih cara pembayaran (Kas/Bank) terlebih dahulu!')
      return
    }

    const numAmount = parseFloat(formAmount)
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('Masukkan nominal pengeluaran yang valid!')
      return
    }

    let numAmountPaid = numAmount
    if (paymentStatus === 'unpaid') {
      numAmountPaid = 0
    } else if (paymentStatus === 'partial') {
      const dp = parseFloat(amountPaid)
      if (isNaN(dp) || dp <= 0 || dp >= numAmount) {
        alert('Nominal DP harus bernilai lebih dari 0 dan kurang dari total nominal pengeluaran!')
        return
      }
      numAmountPaid = dp
    }

    setSubmitLoading(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_account_id: formCategoryAccountId,
          payment_account_id: formPaymentAccountId || null,
          amount: numAmount,
          date: formDate,
          description: formDescription,
          vendor_name: formVendorName,
          attachment_url: formAttachmentUrl || null,
          payment_status: paymentStatus,
          due_date: paymentStatus !== 'paid' ? dueDate : null,
          amount_paid: numAmountPaid
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menyimpan pengeluaran')
      }

      router.push('/expenses')
      router.refresh()
    } catch (err: any) {
      console.error(err)
      alert(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-2">
          <div className="h-6 w-24 bg-gray-200 rounded-full animate-pulse"></div>
        </div>
        <div className="h-8 w-64 bg-gray-200 rounded-md animate-pulse"></div>
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div className="h-10 bg-gray-200 rounded-lg animate-pulse w-1/3"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-10 bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded-lg animate-pulse"></div>
          </div>
          <div className="h-24 bg-gray-200 rounded-lg animate-pulse"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/expenses"
              className="text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center gap-1 transition-colors"
            >
              ← Kembali ke Daftar
            </Link>
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 tracking-tight uppercase">
            Catat Pengeluaran Baru
          </h1>
          <p className="text-xs text-gray-500 font-medium">
            Standardisasi pencatatan pengeluaran usaha untuk {activeBizName}
          </p>
        </div>
      </div>

      {/* Form Container */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          {/* Row 1: Date & Vendor */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                Tanggal Transaksi *
              </label>
              <input
                type="date"
                required
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
              />
            </div>

            {/* Vendor Autocomplete Field */}
            <div className="relative" ref={vendorDropdownRef}>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                Vendor / Toko
              </label>
              <input
                type="text"
                placeholder="Cari atau ketik nama vendor..."
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                value={vendorSearch}
                onFocus={() => setIsVendorDropdownOpen(true)}
                onChange={e => {
                  setVendorSearch(e.target.value)
                  setFormVendorName(e.target.value)
                  setIsVendorDropdownOpen(true)
                }}
              />
              
              {isVendorDropdownOpen && (
                <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-250 rounded-xl shadow-lg z-50 overflow-hidden flex flex-col max-h-56">
                  <div className="overflow-y-auto flex-1 divide-y divide-gray-150">
                    
                    {/* Add new vendor inline option */}
                    {vendorSearch.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={openNewVendorModal}
                        className="w-full text-left px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <span>➕ Tambah Vendor Baru: "{vendorSearch}"</span>
                        <span className="text-[9px] bg-blue-100 text-blue-800 px-1 py-0.5 rounded font-black uppercase">BARU</span>
                      </button>
                    )}

                    {filteredSuppliers.map(s => {
                      const isSelected = formVendorName === s.name
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setFormVendorName(s.name)
                            setVendorSearch(s.name)
                            setIsVendorDropdownOpen(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors flex justify-between items-center cursor-pointer ${
                            isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-800'
                          }`}
                        >
                          <span>🏢 {s.name}</span>
                          {s.phone && <span className="text-[10px] text-gray-400 font-normal">{s.phone}</span>}
                        </button>
                      )
                    })}

                    {filteredSuppliers.length === 0 && !vendorSearch.trim() && (
                      <div className="p-3 text-center text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                        Ketik untuk mencari / menambah vendor
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Category Custom Dropdown Selector */}
          <div className="relative" ref={dropdownRef}>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Kategori Pengeluaran (Beban/Aset) *
            </label>
            
            <button
              type="button"
              onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 bg-white flex justify-between items-center outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-left cursor-pointer"
            >
              {formCategoryAccountId ? (
                (() => {
                  const selectedAcc = accounts.find(a => a.id === formCategoryAccountId)
                  if (!selectedAcc) return '-- Pilih Kategori --'
                  const display = getCategoryDisplay(selectedAcc)
                  return (
                    <span className="flex items-center gap-2">
                      <span className="text-sm">{display.icon}</span>
                      <span className="font-bold text-gray-900">{display.name}</span>
                      <span className="text-[10px] text-gray-400">({selectedAcc.code})</span>
                    </span>
                  )
                })()
              ) : (
                <span className="text-gray-400">-- Pilih Kategori --</span>
              )}
              <span className="text-[10px] text-gray-500">▼</span>
            </button>

            {isCategoryDropdownOpen && (
              <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-250 rounded-xl shadow-lg z-50 overflow-hidden flex flex-col max-h-72">
                <div className="p-2 bg-gray-50 border-b border-gray-150">
                  <input
                    type="text"
                    placeholder="Cari kategori atau akun..."
                    className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    value={categorySearch}
                    onChange={e => setCategorySearch(e.target.value)}
                  />
                </div>

                <div className="overflow-y-auto flex-1 divide-y divide-gray-100 max-h-56">
                  {(() => {
                    const filteredStandard = STANDARD_CATEGORIES.filter(cat => {
                      const acc = accounts.find(a => a.code === cat.code)
                      if (!acc) return false
                      return (
                        cat.name.toLowerCase().includes(categorySearch.toLowerCase()) ||
                        cat.desc.toLowerCase().includes(categorySearch.toLowerCase()) ||
                        cat.code.includes(categorySearch)
                      )
                    })

                    return filteredStandard.length > 0 && (
                      <div className="p-1">
                        <div className="px-2 py-1 text-[9px] font-black tracking-widest text-blue-600 uppercase">
                          Kategori Standar
                        </div>
                        {filteredStandard.map(cat => {
                          const acc = accounts.find(a => a.code === cat.code)!
                          const isSelected = formCategoryAccountId === acc.id
                          return (
                            <button
                              key={acc.id}
                              type="button"
                              onClick={() => {
                                setFormCategoryAccountId(acc.id)
                                setIsCategoryDropdownOpen(false)
                              }}
                              className={`w-full text-left p-2 rounded-lg transition-colors flex items-start gap-2.5 cursor-pointer ${
                                isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <span className="text-lg mt-0.5">{cat.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center">
                                  <span className={`text-xs font-bold ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                                    {cat.name}
                                  </span>
                                  <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-black">
                                    {cat.code}
                                  </span>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-0.5 truncate font-normal">
                                  {cat.desc}
                                </p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {(() => {
                    const standardCodes = STANDARD_CATEGORIES.map(c => c.code)
                    const filteredCustom = accounts.filter(a => {
                      const isCustomCategory = (a.type === 'EXPENSE' || (a.type === 'ASSET' && !a.code.startsWith('101') && !a.code.startsWith('102'))) &&
                        !standardCodes.includes(a.code)
                      
                      if (!isCustomCategory) return false
                      return (
                        a.name.toLowerCase().includes(categorySearch.toLowerCase()) ||
                        a.code.includes(categorySearch)
                      )
                    })

                    return filteredCustom.length > 0 && (
                      <div className="p-1">
                        <div className="px-2 py-1 text-[9px] font-black tracking-widest text-amber-700 uppercase">
                          Akun Kustom / Lainnya (COA)
                        </div>
                        {filteredCustom.map(a => {
                          const isSelected = formCategoryAccountId === a.id
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => {
                                setFormCategoryAccountId(a.id)
                                setIsCategoryDropdownOpen(false)
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex justify-between items-center cursor-pointer ${
                                isSelected ? 'bg-amber-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs">⚙️</span>
                                <span className={`text-xs font-bold ${isSelected ? 'text-amber-800' : 'text-gray-800'}`}>
                                  {a.name}
                                </span>
                              </div>
                              <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-black">
                                {a.code}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Row 3: Nominal */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Nominal Pengeluaran *
            </label>
            <input
              type="number"
              required
              min="0"
              step="any"
              placeholder="Masukkan nominal pengeluaran (contoh: 150000)"
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              value={formAmount}
              onChange={e => setFormAmount(e.target.value)}
            />
          </div>

          {/* Row 4: Status Pembayaran (Termin) */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                Status / Termin Pembayaran
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentStatus('paid')}
                  className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg border text-center transition-all cursor-pointer ${
                    paymentStatus === 'paid'
                      ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  🟢 Langsung Lunas
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentStatus('unpaid')}
                  className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg border text-center transition-all cursor-pointer ${
                    paymentStatus === 'unpaid'
                      ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  🔴 Pembayaran Mundur / Tempo
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentStatus('partial')}
                  className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg border text-center transition-all cursor-pointer ${
                    paymentStatus === 'partial'
                      ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  🟡 Uang Muka / Bayar Sebagian (DP)
                </button>
              </div>
            </div>

            {/* Conditional Fields based on Payment Term */}
            {paymentStatus === 'paid' && (
              <div className="animate-in slide-in-from-top-2 duration-200">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Cara Bayar (Kas/Bank) *
                </label>
                <select
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={formPaymentAccountId}
                  onChange={e => setFormPaymentAccountId(e.target.value)}
                >
                  <option value="">-- Pilih Akun Kas/Bank --</option>
                  {paymentAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      🏦 {acc.name} ({acc.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {paymentStatus === 'unpaid' && (
              <div className="animate-in slide-in-from-top-2 duration-200">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Tanggal Jatuh Tempo *
                </label>
                <input
                  type="date"
                  required
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
                <p className="text-[10px] text-gray-400 mt-1 font-medium italic">
                  * Pembayaran akan dikreditkan secara otomatis ke Akun Liabilitas "Hutang Usaha (201000)"
                </p>
              </div>
            )}

            {paymentStatus === 'partial' && (
              <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-200">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Nominal DP (Uang Muka) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    placeholder="Masukkan nominal DP"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={amountPaid}
                    onChange={e => setAmountPaid(e.target.value)}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Cara Bayar DP (Kas/Bank) *
                  </label>
                  <select
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formPaymentAccountId}
                    onChange={e => setFormPaymentAccountId(e.target.value)}
                  >
                    <option value="">-- Pilih Akun Kas/Bank --</option>
                    {paymentAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        🏦 {acc.name} ({acc.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Tanggal Jatuh Tempo Sisa Pembayaran *
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                  />
                  <p className="text-[10px] text-gray-400 mt-1 font-medium italic">
                    * Sisa nominal (Total - DP) akan dialokasikan ke Akun "Hutang Usaha (201000)" secara otomatis
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Row 5: Description */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Deskripsi / Keterangan
            </label>
            <textarea
              placeholder="Contoh: Pembayaran listrik ruko lantai 1"
              rows={3}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white resize-none"
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
            />
          </div>

          {/* Row 6: Attachment upload */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Bukti Nota / Kuitansi
            </label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                disabled={compressing}
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 transition-all cursor-pointer disabled:opacity-50"
              >
                📁 Pilih Berkas
              </button>
              <div className="text-[10px] text-gray-400 font-semibold">
                {uploadProgress || 'Maksimal ukuran 5MB. Gambar otomatis dikompres.'}
              </div>
            </div>

            {formAttachmentUrl && (
              <div className="mt-3 p-3 bg-amber-50/50 border border-amber-200 rounded-lg flex items-center justify-between">
                <span className="text-[10px] font-black text-amber-700 uppercase">
                  ✓ Berkas berhasil diunggah
                </span>
                <a
                  href={formAttachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-extrabold text-blue-600 hover:underline uppercase"
                >
                  Lihat Berkas
                </a>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end border-t border-gray-150 pt-5">
            <Link
              href="/expenses"
              className="px-5 py-2.5 border border-gray-300 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors uppercase tracking-wider"
            >
              Batal
            </Link>
            <button
              type="submit"
              disabled={submitLoading || compressing}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-extrabold rounded-lg shadow-sm transition-all active:scale-98 cursor-pointer uppercase tracking-wider"
            >
              {submitLoading ? 'Menyimpan...' : 'Simpan Pengeluaran'}
            </button>
          </div>
        </form>
      </div>

      {/* Reusable-Style Inline Supplier Creation Modal */}
      {isVendorModalOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3.5 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                🏢 Buat Vendor / Pemasok Baru
              </h2>
              <button
                onClick={() => setIsVendorModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateVendor} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Nama Vendor / Perusahaan *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: CV. Alamanda Abadi"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={newVendorName}
                  onChange={e => setNewVendorName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Alamat Email
                </label>
                <input
                  type="email"
                  placeholder="vendor@email.com"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={newVendorEmail}
                  onChange={e => setNewVendorEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Nomor Telepon
                </label>
                <input
                  type="text"
                  placeholder="081xxxxxxxx"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  value={newVendorPhone}
                  onChange={e => setNewVendorPhone(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Alamat Lengkap
                </label>
                <textarea
                  placeholder="Alamat kantor vendor..."
                  rows={2}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white resize-none"
                  value={newVendorAddress}
                  onChange={e => setNewVendorAddress(e.target.value)}
                />
              </div>

              <div className="pt-3 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsVendorModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={vendorSubmitLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {vendorSubmitLoading ? 'Menyimpan...' : 'Tambah'}
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
