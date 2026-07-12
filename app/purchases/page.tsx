"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

type Supplier = {
  id: string
  name: string
}

type Product = {
  id: string
  name: string
  sku: string | null
  price: number
  cost_price: number
  type: 'physical' | 'service'
}

type Account = {
  id: string
  code: string
  name: string
  type: string
}

type PurchaseItem = {
  product_id?: string
  name: string
  quantity: number
  price: number
  is_physical: boolean
}

type PurchasePayment = {
  id: string
  date: string
  amount: number
  write_off_amount: number
  notes: string | null
}

type Purchase = {
  id: string
  business_id: string
  transaction_id: string | null
  supplier_id: string | null
  purchase_number: string
  date: string
  due_date: string | null
  subtotal: number
  discount_amount: number
  other_fees: number
  grand_total: number
  amount_paid: number
  payment_status: 'unpaid' | 'partial' | 'paid'
  items_json: PurchaseItem[]
  attachment_url: string | null
  created_at: string
  suppliers?: { id: string; name: string } | null
  payments?: PurchasePayment[]
}

export default function PurchasesPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Filter
  const [searchQuery, setSearchQuery] = useState('')

  // Create Bill Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)

  // Record Payment Modal State
  const [isPayOpen, setIsPayOpen] = useState(false)
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null)
  const [payLoading, setPayLoading] = useState(false)

  // Upload progress
  const [uploadProgress, setUploadProgress] = useState('')
  const [compressing, setCompressing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form Create State
  const [formSupplierId, setFormSupplierId] = useState('')
  const [formPurchaseNumber, setFormPurchaseNumber] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formDueDate, setFormDueDate] = useState('')
  const [formItems, setFormItems] = useState<PurchaseItem[]>([{ name: '', quantity: 1, price: 0, is_physical: true }])
  const [formDiscount, setFormDiscount] = useState('0')
  const [formFees, setFormFees] = useState('0')
  const [formAmountPaid, setFormAmountPaid] = useState('0')
  const [formPaymentAccountId, setFormPaymentAccountId] = useState('')
  const [formAttachmentUrl, setFormAttachmentUrl] = useState('')

  // Form Payment State
  const [payAmount, setPayAmount] = useState('')
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])
  const [payWriteOffAmount, setPayWriteOffAmount] = useState('0')
  const [payWriteOffAccountId, setPayWriteOffAccountId] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch Page Data
  const fetchData = useCallback(async (businessId: string) => {
    setLoading(true)
    try {
      // 1. Fetch Purchases
      const res = await fetch('/api/purchases')
      if (!res.ok) throw new Error('Gagal memuat data pembelian')
      const purData = await res.json()
      setPurchases(purData)

      // 2. Fetch Suppliers
      const supRes = await fetch('/api/suppliers')
      if (supRes.ok) {
        const supData = await supRes.json()
        setSuppliers(supData)
      }

      // 3. Fetch Products
      const { data: prodData } = await supabase
        .from('products')
        .select('id, name, sku, price, cost_price, type')
        .eq('business_id', businessId)
        .order('name', { ascending: true })
      setProducts(prodData || [])

      // 4. Fetch Accounts
      const { data: accData } = await supabase
        .from('accounts')
        .select('id, code, name, type')
        .eq('business_id', businessId)
        .order('code', { ascending: true })
      setAccounts(accData || [])
    } catch (err) {
      console.error('Error fetching purchases data:', err)
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

  // Payment Source Accounts (101xxx assets)
  const paymentAccounts = useMemo(() => {
    return accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  }, [accounts])

  // Filtered purchases
  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      const q = searchQuery.toLowerCase()
      return (
        p.purchase_number.toLowerCase().includes(q) ||
        (p.suppliers?.name || '').toLowerCase().includes(q)
      )
    })
  }, [purchases, searchQuery])

  // Calculate Subtotal dynamically in Creation form
  const createSubtotal = useMemo(() => {
    return formItems.reduce((sum, item) => sum + (item.quantity * item.price), 0)
  }, [formItems])

  const createGrandTotal = useMemo(() => {
    const disc = parseFloat(formDiscount) || 0
    const fee = parseFloat(formFees) || 0
    return Math.max(0, createSubtotal - disc + fee)
  }, [createSubtotal, formDiscount, formFees])

  // Handle adding items to creation form
  const addItemRow = () => {
    setFormItems([...formItems, { name: '', quantity: 1, price: 0, is_physical: true }])
  }

  const removeItemRow = (idx: number) => {
    if (formItems.length === 1) return
    setFormItems(formItems.filter((_, i) => i !== idx))
  }

  const handleItemChange = (idx: number, field: keyof PurchaseItem, val: any) => {
    const updated = [...formItems]
    if (field === 'product_id') {
      const selectedProd = products.find(p => p.id === val)
      if (selectedProd) {
        updated[idx] = {
          product_id: selectedProd.id,
          name: selectedProd.name,
          quantity: updated[idx].quantity,
          price: selectedProd.cost_price || selectedProd.price || 0,
          is_physical: selectedProd.type === 'physical'
        }
      } else {
        updated[idx] = { ...updated[idx], product_id: undefined }
      }
    } else {
      updated[idx] = { ...updated[idx], [field]: val } as any
    }
    setFormItems(updated)
  }

  // Handle image upload & compression
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeBizId) return

    setCompressing(true)
    setUploadProgress('Mempersiapkan berkas...')

    try {
      let finalFile: Blob | File = file

      if (file.type.startsWith('image/')) {
        setUploadProgress('Mengompres nota pembelian...')
        finalFile = await compressImage(file)
      }

      setUploadProgress('Mengunggah nota...')
      const fileExt = file.type.startsWith('image/') ? 'jpg' : file.name.split('.').pop()
      const fileName = `${activeBizId}/${Date.now()}_purchase_receipt.${fileExt}`

      const { data, error } = await supabase.storage
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
      setUploadProgress('Nota terunggah! ✅')
    } catch (err: any) {
      console.error(err)
      alert('Gagal mengunggah kuitansi: ' + err.message)
      setUploadProgress('')
    } finally {
      setCompressing(false)
    }
  }

  // Compress helper
  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (event) => {
        const img = new Image()
        img.src = event.target?.result as string
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const MAX = 1024
          let w = img.width
          let h = img.height
          if (w > h && w > MAX) {
            h *= MAX / w
            w = MAX
          } else if (h > MAX) {
            w *= MAX / h
            h = MAX
          }
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(img, 0, 0, w, h)
          canvas.toBlob(b => b ? resolve(b) : reject('Blob null'), 'image/jpeg', 0.75)
        }
      }
    })
  }

  // Open Create Modal
  const openCreateModal = () => {
    setFormSupplierId('')
    setFormPurchaseNumber(`PUR-${Date.now().toString().slice(-6)}`)
    setFormDate(new Date().toISOString().split('T')[0])
    setFormDueDate('')
    setFormItems([{ name: '', quantity: 1, price: 0, is_physical: true }])
    setFormDiscount('0')
    setFormFees('0')
    setFormAmountPaid('0')
    setFormPaymentAccountId('')
    setFormAttachmentUrl('')
    setUploadProgress('')
    setIsCreateOpen(true)
  }

  // Submit Bill
  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // validate
    if (formItems.some(i => !i.name.trim() || i.quantity <= 0 || i.price < 0)) {
      alert('Mohon periksa baris barang pembelian, nama barang wajib diisi dan harga/kuantitas harus valid!')
      return
    }

    const paidAmt = parseFloat(formAmountPaid) || 0
    if (paidAmt > 0 && !formPaymentAccountId) {
      alert('Pilih Kas/Bank untuk uang muka/pembayaran awal!')
      return
    }

    setCreateLoading(true)
    try {
      const payload = {
        supplier_id: formSupplierId || null,
        purchase_number: formPurchaseNumber.trim(),
        date: formDate,
        due_date: formDueDate || null,
        items: formItems.map(i => ({
          product_id: i.product_id,
          name: i.name.trim(),
          quantity: i.quantity,
          price: i.price,
          is_physical: i.is_physical
        })),
        discount_amount: parseFloat(formDiscount) || 0,
        other_fees: parseFloat(formFees) || 0,
        amount_paid: paidAmt,
        payment_method_account_id: formPaymentAccountId || null,
        attachment_url: formAttachmentUrl || null
      }

      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menyimpan pembelian')
      }

      setIsCreateOpen(false)
      if (activeBizId) {
        await fetchData(activeBizId)
      }
    } catch (err: any) {
      console.error(err)
      alert(err.message)
    } finally {
      setCreateLoading(false)
    }
  }

  // Delete Purchase
  const handleDelete = async (id: string, num: string) => {
    if (!confirm(`Hapus pembelian "${num}"? Penghapusan akan membatalkan semua log pembayaran dan jurnal terkait.`)) return

    try {
      const res = await fetch(`/api/purchases?id=${id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal menghapus pembelian')
      }

      if (activeBizId) {
        await fetchData(activeBizId)
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  // Open Payment Modal
  const openPayModal = (purchase: Purchase) => {
    setSelectedPurchase(purchase)
    const remaining = purchase.grand_total - purchase.amount_paid
    setPayAmount(remaining.toString())
    setPayAccountId('')
    setPayDate(new Date().toISOString().split('T')[0])
    setPayWriteOffAmount('0')
    setPayWriteOffAccountId('')
    setPayNotes('')
    setIsPayOpen(true)
  }

  // Submit Payment
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPurchase) return

    const amount = parseFloat(payAmount) || 0
    if (amount <= 0) {
      alert('Nominal pembayaran harus lebih dari 0!')
      return
    }

    if (!payAccountId) {
      alert('Pilih Kas/Bank untuk pembayaran!')
      return
    }

    const writeOff = parseFloat(payWriteOffAmount) || 0
    if (writeOff !== 0 && !payWriteOffAccountId) {
      alert('Pilih akun write-off jika ada selisih!')
      return
    }

    setPayLoading(true)
    try {
      const payload = {
        amount,
        payment_method_account_id: payAccountId,
        date: payDate,
        write_off_amount: writeOff,
        write_off_account_id: payWriteOffAccountId || null,
        notes: payNotes.trim() || null
      }

      const res = await fetch(`/api/purchases/${selectedPurchase.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal mencatat pembayaran')
      }

      setIsPayOpen(false)
      if (activeBizId) {
        await fetchData(activeBizId)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setPayLoading(false)
    }
  }

  // Formatting Currency
  const formatPrice = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val)
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
            Pembelian (Bills)
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 font-medium">
            Catat tagihan pembelian barang/jasa dari pemasok, perbarui persediaan produk (WAC), serta cicil pembayaran hutang.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="w-full md:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
        >
          ➕ Buat Pembelian
        </button>
      </div>

      {/* Filter / Search */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <input
            type="text"
            placeholder="Cari nomor tagihan atau nama pemasok..."
            className="w-full p-2.5 pl-8 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-gray-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3 top-3.5 text-gray-400 text-xs">🔍</span>
        </div>
      </div>

      {/* Purchases Table */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">
          Memuat data pembelian...
        </div>
      ) : purchases.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-xs">
          <span className="text-3xl">📦</span>
          <h3 className="text-sm font-extrabold text-gray-800 mt-2 uppercase tracking-wide">Belum ada tagihan pembelian</h3>
          <p className="text-xs text-gray-400 mt-1">Buat tagihan pembelian baru untuk menambah stok barang fisik Anda.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-400 font-bold tracking-widest">
                  <th className="p-4">No. Tagihan</th>
                  <th className="p-4">Tanggal / Jatuh Tempo</th>
                  <th className="p-4">Pemasok</th>
                  <th className="p-4">Total Tagihan</th>
                  <th className="p-4">Sudah Dibayar</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                {filteredPurchases.map(p => {
                  const remaining = p.grand_total - p.amount_paid
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4 space-y-1">
                        <div className="font-bold text-gray-900">{p.purchase_number}</div>
                        {p.attachment_url && (
                          <a
                            href={p.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase"
                          >
                            📎 Nota
                          </a>
                        )}
                      </td>
                      <td className="p-4 space-y-0.5 text-gray-600">
                        <div>📅 {p.date}</div>
                        {p.due_date && <div className="text-[10px] text-red-500 font-bold">🚨 JT: {p.due_date}</div>}
                      </td>
                      <td className="p-4 text-gray-950 font-bold">{p.suppliers?.name || 'Tanpa Pemasok'}</td>
                      <td className="p-4 text-gray-900 font-bold text-sm">{formatPrice(p.grand_total)}</td>
                      <td className="p-4 text-emerald-700 font-bold">{formatPrice(p.amount_paid)}</td>
                      <td className="p-4">
                        {p.payment_status === 'paid' && (
                          <span className="inline-flex text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                            Lunas
                          </span>
                        )}
                        {p.payment_status === 'partial' && (
                          <span className="inline-flex text-[9px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                            Cicilan
                          </span>
                        )}
                        {p.payment_status === 'unpaid' && (
                          <span className="inline-flex text-[9px] font-black uppercase tracking-wider text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                            Belum Bayar
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        {p.payment_status !== 'paid' && (
                          <button
                            onClick={() => openPayModal(p)}
                            className="px-2.5 py-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
                          >
                            💰 Bayar
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(p.id, p.purchase_number)}
                          className="px-2.5 py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded border border-red-100 transition-colors uppercase font-bold text-[10px] tracking-wider cursor-pointer"
                        >
                          🗑️ Hapus
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Purchase bill Modal */}
      {isCreateOpen && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-2xl w-full overflow-hidden my-8 animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                📦 Tambah Pembelian Stok Baru
              </h2>
              <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSubmitCreate} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">No. Pembelian / Invoice *</label>
                  <input
                    type="text"
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formPurchaseNumber}
                    onChange={e => setFormPurchaseNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Pemasok (Supplier)</label>
                  <select
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formSupplierId}
                    onChange={e => setFormSupplierId(e.target.value)}
                  >
                    <option value="">-- Pilih Pemasok (Opsional) --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Tanggal Pembelian *</label>
                  <input
                    type="date"
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Jatuh Tempo Pembayaran</label>
                  <input
                    type="date"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formDueDate}
                    onChange={e => setFormDueDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-2 border-t border-gray-100 pt-3">
                <div className="flex justify-between items-center">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Rincian Barang / Jasa</h4>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-wider cursor-pointer"
                  >
                    ➕ Tambah Baris
                  </button>
                </div>

                {formItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                    <div className="flex-1 min-w-[140px]">
                      <select
                        className="w-full p-2 border border-gray-300 rounded text-xs font-semibold text-gray-800 bg-white"
                        value={item.product_id || ''}
                        onChange={e => handleItemChange(idx, 'product_id', e.target.value)}
                      >
                        <option value="">-- Pilih Produk / Jasa --</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku || '-'})</option>)}
                      </select>
                    </div>

                    <div className="w-32">
                      <input
                        type="text"
                        placeholder="Nama Manual/Barang"
                        required
                        className="w-full p-2 border border-gray-300 rounded text-xs font-semibold text-gray-800 bg-white"
                        value={item.name}
                        onChange={e => handleItemChange(idx, 'name', e.target.value)}
                      />
                    </div>

                    <div className="w-16">
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        required
                        className="w-full p-2 border border-gray-300 rounded text-xs font-semibold text-gray-800 bg-white"
                        value={item.quantity}
                        onChange={e => handleItemChange(idx, 'quantity', parseInt(e.target.value) || 0)}
                      />
                    </div>

                    <div className="w-24">
                      <input
                        type="number"
                        min="0"
                        placeholder="Harga"
                        required
                        className="w-full p-2 border border-gray-300 rounded text-xs font-semibold text-gray-800 bg-white"
                        value={item.price}
                        onChange={e => handleItemChange(idx, 'price', parseFloat(e.target.value) || 0)}
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={item.is_physical}
                        onChange={e => handleItemChange(idx, 'is_physical', e.target.checked)}
                      />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Fisik</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItemRow(idx)}
                      disabled={formItems.length === 1}
                      className="text-red-500 hover:text-red-700 text-xs font-bold px-1 disabled:opacity-30 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Discount, Fees, and Initial Payment */}
              <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-3">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Potongan / Diskon (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                      value={formDiscount}
                      onChange={e => setFormDiscount(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Biaya Ongkir / Lain-lain (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                      value={formFees}
                      onChange={e => setFormFees(e.target.value)}
                    />
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500 font-bold uppercase">
                      <span>Subtotal:</span>
                      <span>{formatPrice(createSubtotal)}</span>
                    </div>
                    {parseFloat(formDiscount) > 0 && (
                      <div className="flex justify-between text-xs text-red-500 font-bold uppercase">
                        <span>Diskon:</span>
                        <span>-{formatPrice(parseFloat(formDiscount))}</span>
                      </div>
                    )}
                    {parseFloat(formFees) > 0 && (
                      <div className="flex justify-between text-xs text-blue-500 font-bold uppercase">
                        <span>Biaya Tambahan:</span>
                        <span>+{formatPrice(parseFloat(formFees))}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between text-sm text-gray-900 font-black uppercase pt-2 border-t border-gray-300">
                    <span>Total Tagihan:</span>
                    <span>{formatPrice(createGrandTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Initial Payment DP */}
              <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Uang Muka / Jumlah Dibayar (Rp)</label>
                  <input
                    type="number"
                    min="0"
                    max={createGrandTotal}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formAmountPaid}
                    onChange={e => setFormAmountPaid(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Metode Bayar (Kas/Bank)</label>
                  <select
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={formPaymentAccountId}
                    onChange={e => setFormPaymentAccountId(e.target.value)}
                    disabled={parseFloat(formAmountPaid) <= 0}
                  >
                    <option value="">-- Pilih Kas/Bank --</option>
                    {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Receipt upload */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5 flex justify-between">
                  <span>Nota Pembelian / Bukti Bayar</span>
                  <span className="text-[9px] text-gray-400 font-normal normal-case">(Otomatis dikompres &lt; 200KB)</span>
                </label>
                <div className="flex gap-2 items-center">
                  <input type="file" accept="image/*,application/pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={compressing}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                  >
                    📂 {compressing ? 'Mengolah...' : 'Pilih Nota'}
                  </button>
                  {formAttachmentUrl && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">Terlampir! ✓</span>
                  )}
                </div>
                {uploadProgress && <p className="text-[10px] text-gray-500 mt-1 font-semibold italic">{uploadProgress}</p>}
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={createLoading || compressing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {createLoading ? 'Menyimpan...' : 'Simpan Pembelian'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Record Payment installment Modal */}
      {isPayOpen && selectedPurchase && mounted && createPortal(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-700">
                💰 Cicil / Lunasi Hutang Pembelian
              </h2>
              <button onClick={() => setIsPayOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-6 space-y-4">
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 space-y-1">
                <div className="flex justify-between">
                  <span>No. Pembelian:</span>
                  <span className="text-gray-900">{selectedPurchase.purchase_number}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Tagihan:</span>
                  <span className="text-gray-900">{formatPrice(selectedPurchase.grand_total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Sudah Dibayar:</span>
                  <span className="text-emerald-700">{formatPrice(selectedPurchase.amount_paid)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-1 text-sm font-black text-red-600">
                  <span>Sisa Hutang:</span>
                  <span>{formatPrice(selectedPurchase.grand_total - selectedPurchase.amount_paid)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Tanggal Pembayaran *</label>
                  <input
                    type="date"
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Cara Bayar (Kas/Bank) *</label>
                  <select
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={payAccountId}
                    onChange={e => setPayAccountId(e.target.value)}
                  >
                    <option value="">-- Pilih Kas/Bank --</option>
                    {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Jumlah Dibayarkan (Rp) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    max={selectedPurchase.grand_total - selectedPurchase.amount_paid}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5 flex justify-between">
                    <span>Selisih / Write-off</span>
                    <span className="text-[9px] text-gray-400 normal-case">(+/-)</span>
                  </label>
                  <input
                    type="number"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={payWriteOffAmount}
                    onChange={e => setPayWriteOffAmount(e.target.value)}
                  />
                </div>
              </div>

              {parseFloat(payWriteOffAmount) !== 0 && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Akun Penyesuaian Write-off *</label>
                  <select
                    required
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    value={payWriteOffAccountId}
                    onChange={e => setPayWriteOffAccountId(e.target.value)}
                  >
                    <option value="">-- Pilih Akun Biaya Bank / Selisih --</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>({a.code}) {a.name} [{a.type}]</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Catatan Pembayaran</label>
                <textarea
                  placeholder="Keterangan transfer bank, nomor referensi cicilan, dll..."
                  rows={2}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white resize-none"
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                />
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPayOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={payLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {payLoading ? 'Menyimpan...' : 'Bayar Tagihan'}
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
