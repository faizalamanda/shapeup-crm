"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import QuickAddProductModal from '@/components/QuickAddProductModal'

type Customer = {
  id: string
  name: string
  phone: string
  email: string | null
}

type Product = {
  id: string
  name: string
  price: number
  sku: string | null
  cost_price: number | null
}

type InvoiceItemInput = {
  product_id: string | null
  name: string
  sku: string
  price: number
  quantity: number
}

const formatIDR = (value: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value)
}

export default function EditInvoicePage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string

  // Master Data States
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [businessName, setBusinessName] = useState<string>('')
  const [businessId, setBusinessId] = useState<string>('')
  const [loadingData, setLoadingData] = useState<boolean>(true)
  const [loadingInvoice, setLoadingInvoice] = useState<boolean>(true)

  // Invoice status
  const [invoiceStatus, setInvoiceStatus] = useState<string>('pending')

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [isNewCustomer, setIsNewCustomer] = useState<boolean>(false)
  const [newCustName, setNewCustName] = useState<string>('')
  const [newCustPhone, setNewCustPhone] = useState<string>('')
  const [newCustEmail, setNewCustEmail] = useState<string>('')

  // Invoice Fields
  const [invoiceNumber, setInvoiceNumber] = useState<string>('')
  const [invoiceDate, setInvoiceDate] = useState<string>('')
  const [paymentTerms, setPaymentTerms] = useState<string>('due-on-receipt')
  const [dueDate, setDueDate] = useState<string>('')

  // Invoice Items
  const [items, setItems] = useState<InvoiceItemInput[]>([
    { product_id: null, name: '', sku: '', price: 0, quantity: 1 }
  ])

  // Financial summary
  const [discountAmount, setDiscountAmount] = useState<number>(0)
  const [shippingCost, setShippingCost] = useState<number>(0)
  const [otherFees, setOtherFees] = useState<number>(0)
  const [notes, setNotes] = useState<string>('')

  // Customization
  const [customTitle, setCustomTitle] = useState<string>('INVOICE')
  const [customSubtitle, setCustomSubtitle] = useState<string>('')
  const [accentColor, setAccentColor] = useState<string>('slate')
  const [layoutStyle, setLayoutStyle] = useState<string>('modern')
  const [showSku, setShowSku] = useState<boolean>(true)
  const [showDescription, setShowDescription] = useState<boolean>(true)
  const [showNotes, setShowNotes] = useState<boolean>(true)

  // Autocomplete search states per row
  const [productSearchQueries, setProductSearchQueries] = useState<Record<number, string>>({})
  const [showProductDropdown, setShowProductDropdown] = useState<Record<number, boolean>>({})

  // Quick Add Product Modal States
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false)
  const [quickAddName, setQuickAddName] = useState('')
  const [quickAddRowIndex, setQuickAddRowIndex] = useState<number | null>(null)

  // Payment popup
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false)
  const [paymentMethod, setPaymentMethod] = useState<string>('Bank Transfer')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string>('')

  // Check if financials are locked (if already paid/completed)
  const isFinancialsLocked = useMemo(() => invoiceStatus === 'completed', [invoiceStatus])

  // Check if invoice is cancelled
  const isCancelled = useMemo(() => invoiceStatus === 'cancelled', [invoiceStatus])

  // Auto calculate due date when invoice date or terms change
  useEffect(() => {
    if (!invoiceDate || isFinancialsLocked) return
    if (paymentTerms === 'custom') return

    const baseDate = new Date(invoiceDate)
    let daysToAdd = 0

    if (paymentTerms === 'net-15') daysToAdd = 15
    else if (paymentTerms === 'net-30') daysToAdd = 30
    else if (paymentTerms === 'net-60') daysToAdd = 60

    baseDate.setDate(baseDate.getDate() + daysToAdd)
    const yyyy = baseDate.getFullYear()
    const mm = String(baseDate.getMonth() + 1).padStart(2, '0')
    const dd = String(baseDate.getDate()).padStart(2, '0')
    setDueDate(`${yyyy}-${mm}-${dd}`)
  }, [invoiceDate, paymentTerms, isFinancialsLocked])

  // Load Initial Data (Customers & Products)
  useEffect(() => {
    const loadMasterData = async () => {
      setLoadingData(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id, businesses!active_business_id(name)')
          .eq('id', user.id)
          .single()

        if (!profile?.active_business_id) return

        setBusinessId(profile.active_business_id)
        setBusinessName((profile.businesses as { name?: string } | null)?.name || 'Bisnis Saya')

        // Fetch customers from secure endpoint
        const custRes = await fetch('/api/customers')
        if (custRes.ok) {
          const custJson = await custRes.json()
          if (custJson.success) {
            setCustomers(custJson.customers)
          }
        }

        // Fetch products
        const { data: prodData } = await supabase
          .from('products')
          .select('id, name, price, sku, cost_price')
          .eq('business_id', profile.active_business_id)
          .order('name', { ascending: true })

        if (prodData) setProducts(prodData)
      } catch (err) {
        console.error('Error loading master data:', err)
      } finally {
        setLoadingData(false)
      }
    }

    loadMasterData()
  }, [supabase])

  // Load Invoice Details
  useEffect(() => {
    if (!invoiceId) return

    const loadInvoice = async () => {
      setLoadingInvoice(true)
      try {
        const res = await fetch(`/api/orders/invoices/${invoiceId}`)
        if (!res.ok) {
          setErrorMessage('Gagal memuat detail invoice.')
          return
        }

        const json = await res.json()
        if (json.success && json.invoice) {
          const inv = json.invoice
          setInvoiceStatus(inv.status)
          setSelectedCustomerId(inv.customer_id || '')
          setInvoiceNumber(inv.order_number || '')
          
          // Format dates to YYYY-MM-DD
          const fmtDate = (dStr: string) => {
            if (!dStr) return ''
            const d = new Date(dStr)
            const yyyy = d.getFullYear()
            const mm = String(d.getMonth() + 1).padStart(2, '0')
            const dd = String(d.getDate()).padStart(2, '0')
            return `${yyyy}-${mm}-${dd}`
          }

          setInvoiceDate(fmtDate(inv.order_date))
          setDueDate(fmtDate(inv.due_date))

          // Raw source data customization
          const raw = inv.raw_source_data || {}
          setPaymentTerms(raw.payment_terms || 'custom')
          setNotes(raw.notes || '')
          setCustomTitle(raw.custom_title || 'INVOICE')
          setCustomSubtitle(raw.custom_subtitle || '')
          setAccentColor(raw.accent_color || 'slate')
          setLayoutStyle(raw.layout_style || 'modern')
          setShowSku(raw.show_sku !== undefined ? raw.show_sku : true)
          setShowDescription(raw.show_description !== undefined ? raw.show_description : true)
          setShowNotes(raw.show_notes !== undefined ? raw.show_notes : true)

          // Items mapping
          if (Array.isArray(inv.items_json)) {
            const mappedItems = inv.items_json.map((item: any) => ({
              product_id: item.product_id || null,
              name: item.name || '',
              sku: item.sku || '',
              price: Number(item.price || 0),
              quantity: Number(item.quantity || 1)
            }))
            setItems(mappedItems)
          }

          setDiscountAmount(Number(inv.discount_amount || 0))
          setShippingCost(Number(inv.shipping_cost || 0))
          setOtherFees(Number(inv.other_fees || 0))
        } else {
          setErrorMessage('Invoice tidak ditemukan.')
        }
      } catch (err) {
        console.error('Error loading invoice details:', err)
        setErrorMessage('Terjadi kesalahan saat memuat detail invoice.')
      } finally {
        setLoadingInvoice(false)
      }
    }

    loadInvoice()
  }, [invoiceId])

  // Items Handlers
  const handleAddItemRow = () => {
    if (isFinancialsLocked) return
    setItems([...items, { product_id: null, name: '', sku: '', price: 0, quantity: 1 }])
  }

  const handleRemoveItemRow = (index: number) => {
    if (isFinancialsLocked) return
    if (items.length === 1) {
      setItems([{ product_id: null, name: '', sku: '', price: 0, quantity: 1 }])
      return
    }
    const nextItems = [...items]
    nextItems.splice(index, 1)
    setItems(nextItems)
  }

  const handleItemFieldChange = (index: number, field: keyof InvoiceItemInput, val: any) => {
    if (isFinancialsLocked) return
    setItems(prev => {
      const nextItems = [...prev]
      if (field === 'price' || field === 'quantity') {
        nextItems[index] = { ...nextItems[index], [field]: Number(val) }
      } else {
        nextItems[index] = { ...nextItems[index], [field]: val }
      }
      return nextItems
    })
  }

  const handleItemFieldsChange = (index: number, fields: Partial<InvoiceItemInput>) => {
    if (isFinancialsLocked) return
    setItems(prev => {
      const nextItems = [...prev]
      nextItems[index] = {
        ...nextItems[index],
        ...fields
      }
      return nextItems
    })
  }

  const handleQuickAddProductSuccess = (newProduct: Product) => {
    setProducts(prev => {
      if (prev.some(p => p.id === newProduct.id)) return prev
      return [...prev, newProduct].sort((a, b) => a.name.localeCompare(b.name))
    })

    if (quickAddRowIndex !== null) {
      handleItemFieldsChange(quickAddRowIndex, {
        product_id: newProduct.id,
        name: newProduct.name,
        price: newProduct.price,
        sku: newProduct.sku || ''
      })
      setProductSearchQueries(prev => ({ ...prev, [quickAddRowIndex]: '' }))
    }
  }

  // Financial Calculations
  const subtotal = useMemo(() => {
    return items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 1)), 0)
  }, [items])

  const grandTotal = useMemo(() => {
    const total = subtotal - Number(discountAmount || 0) + Number(shippingCost || 0) + Number(otherFees || 0)
    return Math.max(0, total)
  }, [subtotal, discountAmount, shippingCost, otherFees])

  // Submit Handler
  const handleSubmit = async (submitStatus: 'pending' | 'processing' | 'completed') => {
    if (!isFinancialsLocked) {
      if (isNewCustomer && (!newCustName || !newCustPhone)) {
        setErrorMessage('Nama dan Nomor HP Customer baru wajib diisi.')
        return
      }

      if (!isNewCustomer && !selectedCustomerId) {
        setErrorMessage('Pilih Customer terlebih dahulu.')
        return
      }

      // Validate items
      const invalidItems = items.filter(i => !i.name || i.quantity <= 0 || i.price < 0)
      if (invalidItems.length > 0) {
        setErrorMessage('Semua baris item wajib diisi Nama, Jumlah (>0), dan Harga (>=0).')
        return
      }
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const payload: Record<string, any> = {
        customer_id: isNewCustomer ? null : selectedCustomerId,
        customer_name: isNewCustomer ? newCustName : null,
        customer_phone: isNewCustomer ? newCustPhone : null,
        customer_email: isNewCustomer ? newCustEmail : null,
        order_number: invoiceNumber || null,
        order_date: invoiceDate,
        due_date: dueDate,
        payment_terms: paymentTerms,
        items: items,
        discount_amount: Number(discountAmount),
        shipping_cost: Number(shippingCost),
        other_fees: Number(otherFees),
        grand_total: grandTotal,
        status: submitStatus,
        payment_method: submitStatus === 'completed' ? paymentMethod : null,
        notes: notes,
        custom_title: customTitle,
        custom_subtitle: customSubtitle,
        accent_color: accentColor,
        layout_style: layoutStyle,
        show_sku: showSku,
        show_description: showDescription,
        show_notes: showNotes
      }

      const res = await fetch(`/api/orders/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Gagal menyimpan perubahan invoice.')
      }

      router.push(`/orders/invoices/${invoiceId}`)
      router.refresh()
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan sistem.')
    } finally {
      setSubmitting(false)
      setShowPaymentModal(false)
    }
  }

  if (loadingInvoice || loadingData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-2">
        <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-slate-800 animate-spin" />
        <p className="text-xs text-[#70706E]">Memuat data invoice...</p>
      </div>
    )
  }

  if (isCancelled) {
    return (
      <div className="space-y-6 text-[#1C1C1A] px-2 py-4">
        <div className="flex items-center gap-2 text-xs font-bold text-[#70706E]">
          <Link href="/orders/invoices" className="hover:text-[#1C1C1A]">Tagihan</Link>
          <span>/</span>
          <span className="text-[#1C1C1A]">{invoiceNumber || 'Detail'}</span>
          <span>/</span>
          <span className="text-[#1C1C1A]">Edit</span>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm max-w-lg mx-auto text-center space-y-4">
          <div className="text-4xl">🚫</div>
          <h2 className="text-sm font-black text-rose-700">Invoice Telah Dibatalkan</h2>
          <p className="text-xs text-[#70706E]">
            Invoice yang telah dibatalkan tidak dapat diedit atau diubah kembali detail keuangannya.
          </p>
          <div className="pt-2">
            <Link
              href={`/orders/invoices/${invoiceId}`}
              className="inline-flex px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-xl transition-all"
            >
              Kembali ke Detail Invoice
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 text-[#1C1C1A] px-2 py-4">
      {/* Breadcrumb & Title */}
      <div className="flex items-center gap-2 text-xs font-bold text-[#70706E]">
        <Link href="/orders/invoices" className="hover:text-[#1C1C1A]">Tagihan</Link>
        <span>/</span>
        <Link href={`/orders/invoices/${invoiceId}`} className="hover:text-[#1C1C1A]">{invoiceNumber || 'Detail'}</Link>
        <span>/</span>
        <span className="text-[#1C1C1A]">Edit</span>
      </div>

      <div className="flex justify-between items-center border-b border-[#EBEBEA] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-[#1C1C1A]">Edit Invoice</h1>
            {isFinancialsLocked && (
              <span className="px-2 py-0.5 text-[10px] font-bold bg-[#DCFCE7] text-[#15803D] rounded-full border border-[#BBF7D0]">
                LUNAS
              </span>
            )}
          </div>
          <p className="text-xs text-[#70706E]">Penerbit: <span className="font-bold text-[#1C1C1A]">{businessName}</span></p>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
          ⚠️ {errorMessage}
        </div>
      )}

      {isFinancialsLocked && (
        <div className="p-3 text-xs font-medium text-[#15803D] bg-[#F0FDF4] border border-[#DCFCE7] rounded-xl">
          💡 **Invoice ini telah LUNAS.** Sesuai dengan pembukuan kas/bank, rincian produk, nominal, dan customer terkunci. Anda masih dapat menyesuaikan warna aksen, gaya template, catatan kaki, serta judul dokumen di panel kanan.
        </div>
      )}

      {/* Grid: Form (Left) & Customize Panel (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Invoice Form (Left) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section 1: Customer */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">Customer (Bill To)</h2>
              {!isFinancialsLocked && (
                <button
                  type="button"
                  onClick={() => {
                    setIsNewCustomer(!isNewCustomer)
                    setSelectedCustomerId('')
                  }}
                  className="text-xs font-black text-[#1E40AF] hover:underline"
                >
                  {isNewCustomer ? 'Select Existing Customer' : '➕ Tambah Customer Baru'}
                </button>
              )}
            </div>

            {!isNewCustomer ? (
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#70706E]">Customer</label>
                <select
                  value={selectedCustomerId}
                  disabled={isFinancialsLocked}
                  onChange={e => setSelectedCustomerId(e.target.value)}
                  className="w-full p-2.5 text-sm rounded-xl border border-[#EBEBEA] bg-white disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                >
                  <option value="">-- Pilih Customer --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 pt-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#70706E]">Nama Lengkap *</label>
                  <input
                    type="text"
                    disabled={isFinancialsLocked}
                    value={newCustName}
                    onChange={e => setNewCustName(e.target.value)}
                    placeholder="Nama Customer"
                    className="w-full p-2 text-sm rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#70706E]">Nomor HP *</label>
                  <input
                    type="text"
                    disabled={isFinancialsLocked}
                    value={newCustPhone}
                    onChange={e => setNewCustPhone(e.target.value)}
                    placeholder="Contoh: 08123456789"
                    className="w-full p-2 text-sm rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#70706E]">Email (Opsional)</label>
                  <input
                    type="email"
                    disabled={isFinancialsLocked}
                    value={newCustEmail}
                    onChange={e => setNewCustEmail(e.target.value)}
                    placeholder="email@customer.com"
                    className="w-full p-2 text-sm rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Invoice Info */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#70706E]">No. Invoice</label>
              <input
                type="text"
                disabled={isFinancialsLocked}
                placeholder="Otomatis (INV-DDMMYYYY-xxx)"
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#70706E]">Tanggal Invoice</label>
              <input
                type="date"
                disabled={isFinancialsLocked}
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#70706E]">Jatuh Tempo</label>
              <select
                value={paymentTerms}
                disabled={isFinancialsLocked}
                onChange={e => setPaymentTerms(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] bg-white disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              >
                <option value="due-on-receipt">Saat Diterima (Receipt)</option>
                <option value="net-15">Dalam 15 Hari (Net 15)</option>
                <option value="net-30">Dalam 30 Hari (Net 30)</option>
                <option value="net-60">Dalam 60 Hari (Net 60)</option>
                <option value="custom">Pilih Tanggal Kustom</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#70706E]">Tanggal Jatuh Tempo</label>
              <input
                type="date"
                value={dueDate}
                disabled={paymentTerms !== 'custom' || isFinancialsLocked}
                onChange={e => setDueDate(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] bg-white disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>
          </div>

          {/* Section 3: Line Items */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">Detail Item Tagihan</h2>

            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="relative flex flex-col md:flex-row gap-3 items-start md:items-center border-b border-gray-100 pb-3 md:pb-0 md:border-none">
                  {/* Item name input with product search */}
                  <div className="w-full md:flex-1 relative">
                    <input
                      type="text"
                      disabled={isFinancialsLocked}
                      placeholder="Nama Produk / Deskripsi Item"
                      value={item.name}
                      onChange={e => {
                        handleItemFieldChange(idx, 'name', e.target.value)
                        setProductSearchQueries({ ...productSearchQueries, [idx]: e.target.value })
                        setShowProductDropdown({ ...showProductDropdown, [idx]: true })
                      }}
                      onFocus={() => !isFinancialsLocked && setShowProductDropdown({ ...showProductDropdown, [idx]: true })}
                      onBlur={() => setTimeout(() => setShowProductDropdown({ ...showProductDropdown, [idx]: false }), 200)}
                      className="w-full p-2 text-sm rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                    />

                     {/* Product Autocomplete Dropdown */}
                    {!isFinancialsLocked && showProductDropdown[idx] && (
                      <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-[#EBEBEA] rounded-xl shadow-lg z-50 divide-y divide-gray-50">
                        {productSearchQueries[idx] && productSearchQueries[idx].trim() !== '' && (
                          <button
                            key="quick-add-new-btn"
                            type="button"
                            onMouseDown={() => {
                              setQuickAddRowIndex(idx)
                              setQuickAddName(productSearchQueries[idx])
                              setIsQuickAddModalOpen(true)
                            }}
                            className="w-full text-left p-2.5 text-xs text-[#1E40AF] hover:bg-[#1E40AF]/5 font-black border-b border-gray-100 flex items-center gap-1.5 transition-colors"
                          >
                            ➕ Tambah &quot;{productSearchQueries[idx]}&quot; sebagai Produk Baru
                          </button>
                        )}

                        {products
                          .filter(p => {
                            const q = (productSearchQueries[idx] || '').trim().toLowerCase()
                            return !q || p.name.toLowerCase().includes(q)
                          })
                          .map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={() => {
                                handleItemFieldsChange(idx, {
                                  product_id: p.id,
                                  name: p.name,
                                  price: p.price,
                                  sku: p.sku || ''
                                })
                                setProductSearchQueries({ ...productSearchQueries, [idx]: '' })
                              }}
                              className="w-full text-left p-2.5 text-xs hover:bg-[#1E40AF]/5 font-semibold text-slate-800 transition-colors"
                            >
                              📦 {p.name} - <span className="text-[#1E40AF]">{formatIDR(p.price)}</span> {p.sku ? `(SKU: ${p.sku})` : ''}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  {showSku && (
                    <div className="w-full md:w-28">
                      <input
                        type="text"
                        disabled={isFinancialsLocked}
                        placeholder="SKU"
                        value={item.sku}
                        onChange={e => handleItemFieldChange(idx, 'sku', e.target.value)}
                        className="w-full p-2 text-sm rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none font-mono"
                      />
                    </div>
                  )}

                  <div className="flex gap-2 w-full md:w-64 items-center">
                    <div className="w-16">
                      <input
                        type="number"
                        min="1"
                        disabled={isFinancialsLocked}
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={e => handleItemFieldChange(idx, 'quantity', e.target.value)}
                        className="w-full p-2 text-sm text-center rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                      />
                    </div>

                    <div className="flex-1">
                      <input
                        type="number"
                        disabled={isFinancialsLocked}
                        placeholder="Harga Satuan (Rp)"
                        value={item.price || ''}
                        onChange={e => handleItemFieldChange(idx, 'price', e.target.value)}
                        className="w-full p-2 text-sm text-right rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="text-right w-full md:w-28 font-bold text-slate-700 hidden md:block">
                    {formatIDR(item.price * item.quantity)}
                  </div>

                  {!isFinancialsLocked && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItemRow(idx)}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg self-end md:self-center transition-colors"
                      title="Hapus baris"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))}
            </div>

            {!isFinancialsLocked && (
              <button
                type="button"
                onClick={handleAddItemRow}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#1E40AF] bg-[#1E40AF]/5 hover:bg-[#1E40AF]/10 rounded-xl transition-all"
              >
                ➕ Tambah Baris Baru
              </button>
            )}
          </div>

          {/* Section 4: Bottom details & Notes */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">Catatan Faktur & Syarat Ketentuan</h2>
            <textarea
              rows={3}
              placeholder="Masukkan instruksi pembayaran transfer bank, catatan garansi, atau ucapan terima kasih kepada customer..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full p-3 text-sm rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none"
            />
          </div>
        </div>

        {/* Customization & Billing Summary (Right) */}
        <div className="space-y-6">
          {/* Billing Summary */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">Ringkasan Tagihan</h2>
            <div className="divide-y divide-[#EBEBEA] text-xs font-semibold text-[#70706E]">
              <div className="py-2.5 flex justify-between">
                <span>Subtotal</span>
                <span className="text-[#1C1C1A]">{formatIDR(subtotal)}</span>
              </div>

              <div className="py-2.5 flex justify-between items-center gap-3">
                <span>Potongan / Diskon (Rp)</span>
                <input
                  type="number"
                  min="0"
                  disabled={isFinancialsLocked}
                  value={discountAmount || ''}
                  onChange={e => setDiscountAmount(Math.max(0, Number(e.target.value)))}
                  className="w-28 p-1 text-right text-xs rounded-lg border border-[#EBEBEA] disabled:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>

              <div className="py-2.5 flex justify-between items-center gap-3">
                <span>Biaya Pengiriman (Rp)</span>
                <input
                  type="number"
                  min="0"
                  disabled={isFinancialsLocked}
                  value={shippingCost || ''}
                  onChange={e => setShippingCost(Math.max(0, Number(e.target.value)))}
                  className="w-28 p-1 text-right text-xs rounded-lg border border-[#EBEBEA] disabled:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>

              <div className="py-2.5 flex justify-between items-center gap-3">
                <span>Biaya Lainnya (Rp)</span>
                <input
                  type="number"
                  min="0"
                  disabled={isFinancialsLocked}
                  value={otherFees || ''}
                  onChange={e => setOtherFees(Math.max(0, Number(e.target.value)))}
                  className="w-28 p-1 text-right text-xs rounded-lg border border-[#EBEBEA] disabled:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>

              <div className="py-3 flex justify-between text-sm font-black text-[#1C1C1A] border-t-2 border-slate-800">
                <span>Total Akhir</span>
                <span className="text-[#1E40AF]">{formatIDR(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Style Customization (Wave Apps premium feel) */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">Kustomisasi Desain & Teks</h2>

            <div className="space-y-3 text-xs">
              {/* Custom Title */}
              <div className="space-y-1">
                <label className="font-bold text-[#70706E]">Judul Dokumen</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={e => setCustomTitle(e.target.value)}
                  placeholder="INVOICE"
                  className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] focus:ring-1 focus:ring-blue-400 focus:outline-none"
                />
              </div>

              {/* Custom Subtitle */}
              <div className="space-y-1">
                <label className="font-bold text-[#70706E]">Subjudul Dokumen (Opsional)</label>
                <input
                  type="text"
                  value={customSubtitle}
                  onChange={e => setCustomSubtitle(e.target.value)}
                  placeholder="Keterangan tambahan"
                  className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] focus:ring-1 focus:ring-blue-400 focus:outline-none"
                />
              </div>

              {/* Accent Color picker */}
              <div className="space-y-1.5">
                <label className="font-bold text-[#70706E]">Warna Aksen</label>
                <div className="flex gap-2">
                  {[
                    { id: 'slate', bg: 'bg-slate-500' },
                    { id: 'blue', bg: 'bg-blue-600' },
                    { id: 'emerald', bg: 'bg-emerald-600' },
                    { id: 'amber', bg: 'bg-amber-500' },
                    { id: 'indigo', bg: 'bg-indigo-600' },
                    { id: 'rose', bg: 'bg-rose-500' }
                  ].map(color => (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => setAccentColor(color.id)}
                      className={`w-6 h-6 rounded-full ${color.bg} border-2 transition-all ${
                        accentColor === color.id ? 'border-[#1C1C1A] scale-110' : 'border-transparent'
                      }`}
                      title={color.id}
                    />
                  ))}
                </div>
              </div>

              {/* Layout templates */}
              <div className="space-y-1">
                <label className="font-bold text-[#70706E]">Gaya Template</label>
                <select
                  value={layoutStyle}
                  onChange={e => setLayoutStyle(e.target.value)}
                  className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] bg-white focus:outline-none"
                >
                  <option value="modern">Modern (Bold Accent)</option>
                  <option value="classic">Classic (Grid Bordered)</option>
                  <option value="minimal">Minimal (Clean Spacing)</option>
                </select>
              </div>

              {/* Toggles */}
              <div className="pt-2 space-y-2 border-t border-gray-100">
                <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                  <input
                    type="checkbox"
                    checked={showSku}
                    onChange={e => setShowSku(e.target.checked)}
                    className="rounded border-[#EBEBEA] text-[#1E40AF] focus:ring-[#1E40AF]"
                  />
                  <span>Tampilkan Kolom SKU</span>
                </label>

                <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                  <input
                    type="checkbox"
                    checked={showDescription}
                    onChange={e => setShowDescription(e.target.checked)}
                    className="rounded border-[#EBEBEA] text-[#1E40AF] focus:ring-[#1E40AF]"
                  />
                  <span>Tampilkan Detail Item</span>
                </label>

                <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                  <input
                    type="checkbox"
                    checked={showNotes}
                    onChange={e => setShowNotes(e.target.checked)}
                    className="rounded border-[#EBEBEA] text-[#1E40AF] focus:ring-[#1E40AF]"
                  />
                  <span>Tampilkan Catatan Kaki</span>
                </label>
              </div>
            </div>
          </div>

          {/* Action Panel */}
          <div className="p-4 bg-slate-50 border border-[#EBEBEA] rounded-2xl space-y-2.5">
            {isFinancialsLocked ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSubmit('completed')}
                className="w-full py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all"
              >
                {submitting ? 'Menyimpan...' : '💾 Simpan Perubahan Desain'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSubmit('pending')}
                  className="w-full py-2.5 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-all"
                >
                  💾 Simpan sebagai Draft
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSubmit('processing')}
                  className="w-full py-2.5 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-xl transition-all"
                >
                  🚀 Terbitkan (Outstanding)
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowPaymentModal(true)}
                  className="w-full py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all"
                >
                  💰 Simpan & Tandai Lunas
                </button>
              </>
            )}

            <Link
              href={`/orders/invoices/${invoiceId}`}
              className="block w-full py-2 text-xs text-center font-bold text-[#70706E] hover:text-[#1C1C1A] transition-colors"
            >
              Batal
            </Link>
          </div>
        </div>
      </div>

      {/* Immediate Payment modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-[#1C1C1A]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#EBEBEA] shadow-xl p-6 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-sm font-black text-[#1C1C1A]">Tandai Lunas Langsung</h3>
              <p className="text-xs text-[#70706E] mt-1">Pilih metode pembayaran untuk mencatat kas/bank masuk secara langsung.</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#70706E]">Metode Pembayaran</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  className="w-full p-2.5 text-xs font-bold rounded-xl border border-[#EBEBEA] bg-white focus:outline-none"
                >
                  <option value="Bank Transfer">Bank Transfer (Default)</option>
                  <option value="Cash">Cash (Tunai)</option>
                  <option value="QRIS">QRIS</option>
                </select>
              </div>

              <div className="pt-2 flex justify-between text-xs font-bold">
                <span className="text-[#70706E]">Total Invoice</span>
                <span className="text-blue-700 font-extrabold">{formatIDR(grandTotal)}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 py-2 font-bold text-[#70706E] hover:text-[#1C1C1A] transition-colors"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={() => handleSubmit('completed')}
                disabled={submitting}
                className="flex-1 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
              >
                {submitting ? 'Proses...' : 'Konfirmasi Lunas'}
              </button>
            </div>
          </div>
        </div>
      )}

      <QuickAddProductModal
        isOpen={isQuickAddModalOpen}
        onClose={() => setIsQuickAddModalOpen(false)}
        initialName={quickAddName}
        businessId={businessId}
        onSuccess={handleQuickAddProductSuccess}
      />
    </div>
  )
}
