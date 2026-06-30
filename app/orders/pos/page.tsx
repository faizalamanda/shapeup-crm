"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import AddCustomerModal from './components/AddCustomerModal'
import OrderHistoryModal from './components/OrderHistoryModal'

type Product = {
  id: string
  name: string
  sku: string | null
  price: number
  cost_price: number
  type: 'physical' | 'service'
  category_id: string | null
  stock_type: 'tracked' | 'available' | 'unavailable'
  stock_quantity: number
}

type Category = {
  id: string
  name: string
}

type Customer = {
  id: string
  name: string
  phone: string
  email?: string
}

type CartItem = {
  product: Product
  quantity: number
  discountPercent: number // e.g. 10 for 10%
  customPrice: number // defaults to product.price
}

// Pastel card styling helpers
const getPastelColor = (name: string) => {
  const colors = [
    'bg-[#EBF5FF] text-[#1E40AF] border-[#BFDBFE]', // Blue
    'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]', // Emerald
    'bg-[#EEF2FF] text-[#3730A3] border-[#C7D2FE]', // Indigo
    'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]', // Amber
    'bg-[#FFF1F2] text-[#9F1239] border-[#FECDD3]', // Rose
    'bg-[#F5F3FF] text-[#5B21B6] border-[#DDD6FE]', // Purple
    'bg-[#ECFEFF] text-[#075985] border-[#A5F3FC]', // Cyan
    'bg-[#F0FDFA] text-[#0F766E] border-[#99F6E4]', // Teal
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % colors.length
  return colors[index]
}

const getInitials = (name: string) => {
  const cleanName = name.trim().replace(/[^a-zA-Z0-9\s]/g, '')
  const parts = cleanName.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return cleanName.slice(0, 2).toUpperCase()
}

export default function POSPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Auth & Business State
  const [loadingInit, setLoadingInit] = useState(true)
  const [businessId, setBusinessId] = useState<string>('')
  const [userProfile, setUserProfile] = useState<any>(null)
  const [isSessionOpen, setIsSessionOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Database Data
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false)

  const filteredCustomers = customers.filter(c => {
    const q = customerSearch.toLowerCase().trim()
    if (!q) return true
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    )
  })

  // POS State
  const [cart, setCart] = useState<CartItem[]>([])
  const [expandedCartItemIdx, setExpandedCartItemIdx] = useState<number | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  // SumUp POS Specific State
  const [activeTab, setActiveTab] = useState<'catalog' | 'keypad'>('catalog')
  const [keypadAmount, setKeypadAmount] = useState<string>('0')
  const [customItemName, setCustomItemName] = useState<string>('')

  // UI Modals
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false)
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isCartOpenMobile, setIsCartOpenMobile] = useState(false)

  // Checkout State
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('cash')
  const [cashReceived, setCashReceived] = useState<number>(0)
  const [checkingOut, setCheckingOut] = useState(false)

  // Initialize
  useEffect(() => {
    async function checkUser() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('active_business_id, full_name')
            .eq('id', user.id)
            .single()

          if (profile) {
            setUserProfile(profile)
            if (profile.active_business_id) {
              setBusinessId(profile.active_business_id)
              await loadData(profile.active_business_id)
            }
          }
        }
      } catch (err) {
        console.error('Error initializing POS:', err)
      } finally {
        setLoadingInit(false)
      }
    }
    checkUser()
  }, [])

  // Load Products, Categories, Customers
  const loadData = async (bId: string) => {
    try {
      // 1. Fetch Products
      const { data: dbProds } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', bId)
        .order('name', { ascending: true })

      setProducts(dbProds || [])

      // 2. Fetch Categories
      const { data: dbCats } = await supabase
        .from('categories')
        .select('*')
        .eq('business_id', bId)
        .order('name', { ascending: true })

      setCategories(dbCats || [])

      // 3. Fetch Customers in Batches to bypass Supabase 1000-row limit
      let allCusts: any[] = []
      let from = 0
      let total = 0
      const BATCH_SIZE = 1000

      // First batch
      const { data: firstBatch, error: firstErr, count } = await supabase
        .from('customer_metrics')
        .select('customer_id, name, phone', { count: 'exact' })
        .eq('business_id', bId)
        .order('name', { ascending: true })
        .range(from, from + BATCH_SIZE - 1)

      if (!firstErr && firstBatch) {
        total = count ?? 0
        allCusts.push(...firstBatch)
        from += BATCH_SIZE

        // Map and show the first batch immediately
        const mappedFirst = allCusts.map(c => ({
          id: c.customer_id,
          name: c.name,
          phone: c.phone,
          email: ''
        }))
        setCustomers(mappedFirst)

        // Load the remaining batches in the background
        while (from < total) {
          const { data: nextBatch, error: nextErr } = await supabase
            .from('customer_metrics')
            .select('customer_id, name, phone')
            .eq('business_id', bId)
            .order('name', { ascending: true })
            .range(from, from + BATCH_SIZE - 1)

          if (nextErr || !nextBatch || nextBatch.length === 0) break

          allCusts.push(...nextBatch)
          from += BATCH_SIZE

          const mappedNext = allCusts.map(c => ({
            id: c.customer_id,
            name: c.name,
            phone: c.phone,
            email: ''
          }))
          setCustomers(mappedNext)
        }
      }
    } catch (e) {
      console.error('Error loading database data:', e)
    }
  }

  // Reload data on demand (like after a customer is added or order refund)
  const refreshData = async () => {
    if (businessId) {
      await loadData(businessId)
    }
  }

  // Cart Calculations
  const getSubtotal = () => {
    return cart.reduce((acc, item) => acc + item.customPrice * item.quantity, 0)
  }

  const getDiscountAmount = () => {
    return cart.reduce((acc, item) => acc + (item.customPrice * item.quantity * (item.discountPercent / 100)), 0)
  }

  const getGrandTotal = () => {
    return Math.max(0, getSubtotal() - getDiscountAmount())
  }

  // Keypad Actions (SumUp Style)
  const handleKeypadPress = (val: string) => {
    if (val === '⌫') {
      setKeypadAmount(prev => prev.length > 1 ? prev.slice(0, -1) : '0')
    } else if (val === 'C') {
      setKeypadAmount('0')
    } else {
      setKeypadAmount(prev => {
        if (prev === '0') {
          if (val === '00' || val === '0') return '0'
          return val
        }
        if (prev.length >= 10) return prev
        return prev + val
      })
    }
  }

  const handleAddCustomAmount = () => {
    const amount = parseInt(keypadAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('Masukkan nominal jumlah terlebih dahulu!')
      return
    }
    
    const nameToUse = customItemName.trim() || 'Biaya Kustom'
    
    const customProduct: Product = {
      id: `custom-${Date.now()}`,
      name: `${nameToUse} (Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount)})`,
      sku: 'CUSTOM',
      price: amount,
      cost_price: 0,
      type: 'service',
      category_id: null,
      stock_type: 'available',
      stock_quantity: 0
    }

    handleAddToCart(customProduct)
    setKeypadAmount('0')
    setCustomItemName('')
  }

  // Inline Cart Increment/Decrement
  const handleDecrementQty = (idx: number) => {
    setCart(prev => {
      const updated = [...prev]
      if (updated[idx].quantity > 1) {
        updated[idx].quantity -= 1
      } else {
        if (expandedCartItemIdx === idx) {
          setExpandedCartItemIdx(null)
        }
        return prev.filter((_, i) => i !== idx)
      }
      return updated
    })
  }

  const handleIncrementQty = (idx: number) => {
    setCart(prev => {
      const updated = [...prev]
      const product = updated[idx].product
      if (product.stock_type === 'tracked' && updated[idx].quantity >= product.stock_quantity) {
        alert(`Stok produk "${product.name}" tidak mencukupi untuk ditambah lagi!`)
        return prev
      }
      updated[idx].quantity += 1
      return updated
    })
  }

  // Add Item to Cart
  const handleAddToCart = (product: Product) => {
    if (product.stock_type === 'unavailable') return
    if (product.stock_type === 'tracked' && product.stock_quantity <= 0) return

    setCart(prev => {
      const existingIdx = prev.findIndex(item => item.product.id === product.id)

      if (existingIdx > -1) {
        const updated = [...prev]
        const existing = updated[existingIdx]
        
        // Stock limit check
        if (product.stock_type === 'tracked' && existing.quantity >= product.stock_quantity) {
          alert(`Stok produk "${product.name}" tidak mencukupi untuk ditambah lagi!`)
          return prev
        }

        updated[existingIdx] = {
          ...existing,
          quantity: existing.quantity + 1
        }
        setExpandedCartItemIdx(existingIdx)
        return updated
      } else {
        const newCart = [
          ...prev,
          {
            product,
            quantity: 1,
            discountPercent: 0,
            customPrice: product.price
          }
        ]
        setExpandedCartItemIdx(newCart.length - 1)
        return newCart
      }
    })
  }

  const handleRemoveFromCart = (index: number) => {
    setCart(prev => {
      const updated = prev.filter((_, i) => i !== index)
      setExpandedCartItemIdx(null)
      return updated
    })
  }

  // Handle Checkout Submit
  const handleCheckoutSubmit = async () => {
    if (cart.length === 0) return
    const invalidItem = cart.find(i => i.quantity <= 0)
    if (invalidItem) {
      return alert(`Jumlah barang "${invalidItem.product.name}" harus lebih dari 0!`)
    }

    setCheckingOut(true)
    try {
      const payload = {
        customer_id: selectedCustomer?.id || 'guest',
        items: cart.map(item => ({
          id: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          price: item.customPrice,
          discount: item.customPrice * (item.discountPercent / 100)
        })),
        payment_method: paymentMethod,
        discount_amount: getDiscountAmount(),
        grand_total: getGrandTotal(),
        subtotal: getSubtotal()
      }

      const res = await fetch('/api/pos/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Gagal memproses pembayaran POS')
      }

      alert(`Transaksi Sukses! #${json.order_number}`)
      
      // Clear cart & close modal
      setCart([])
      setExpandedCartItemIdx(null)
      setSelectedCustomer(null)
      setIsPaymentOpen(false)
      setCashReceived(0)
      setIsCartOpenMobile(false)
      
      // Reload product stock and data
      await refreshData()
    } catch (err: any) {
      console.error('Checkout error:', err)
      alert('Gagal memproses transaksi: ' + err.message)
    } finally {
      setCheckingOut(false)
    }
  }

  // Format Helper
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val)
  }

  // Filtering Products
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesCategory = selectedCategoryId ? p.category_id === selectedCategoryId : true
    return matchesSearch && matchesCategory
  })

  if (loadingInit) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F7F7F5] space-y-4 font-sans text-[#1C1C1A]">
        <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-black uppercase tracking-widest text-[#6B6B63]">Memuat Layanan Kasir POS...</p>
      </div>
    )
  }

  if (!isSessionOpen) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 font-sans text-[#1C1C1A] antialiased bg-[#F7F7F5]">
        <div className="bg-white border border-[#E2E2DC] p-10 rounded-3xl shadow-md w-full max-w-lg text-center space-y-8">
          
          {/* Logo Mark & Welcome */}
          <div className="space-y-3">
            <div className="mx-auto w-16 h-16 bg-[#2563EB] rounded-2xl flex items-center justify-center text-white font-black text-3xl shadow-md">
              S
            </div>
            <div>
              <span className="text-[9px] font-black text-[#2563EB] uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-md border border-blue-100">Point of Sale</span>
              <h1 className="text-2xl font-black text-[#1C1C1A] tracking-tight mt-3">ShapeUp POS Kasir</h1>
              <p className="text-xs text-[#6B6B63] font-bold uppercase tracking-wider mt-1">Sesi Penjualan CRM</p>
            </div>
          </div>

          <hr className="border-[#E2E2DC]" />

          {/* Session details */}
          <div className="bg-[#F7F7F5] p-5 rounded-2xl border border-[#E2E2DC] text-left space-y-3 text-[11px] font-semibold text-[#6B6B63]">
            <div className="flex justify-between items-center">
              <span>👤 Kasir Aktif</span>
              <span className="font-black text-[#1C1C1A]">{userProfile?.full_name || 'Petugas Toko'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>📦 Katalog Produk</span>
              <span className="font-black text-[#1C1C1A]">{products.length} Item Tersedia</span>
            </div>
            <div className="flex justify-between items-center">
              <span>👥 CRM Pelanggan</span>
              <span className="font-black text-[#1C1C1A]">{customers.length} Member Terhubung</span>
            </div>
          </div>

          {/* Open Button */}
          <div>
            <button
              onClick={() => setIsSessionOpen(true)}
              className="w-full py-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-md transition-all active:scale-[0.98]"
            >
              🚀 Buka Sesi Kasir POS
            </button>
            <p className="text-[9px] text-[#A8A89E] font-bold uppercase tracking-widest mt-3">
              Membuka POS dalam mode fokus layar penuh
            </p>
          </div>

        </div>
      </div>
    )
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#F7F7F5] flex flex-col h-screen overflow-hidden font-sans text-[#1C1C1A] antialiased">
      
      {/* HEADER BAR (SumUp style: Clean, light white) */}
      <header className="flex justify-between items-center px-6 py-4 bg-white border-b border-[#E2E2DC] shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          {/* SumUp styled logomark */}
          <div className="w-9 h-9 bg-[#2563EB] rounded-xl flex items-center justify-center text-white font-black text-xl shadow-sm">
            S
          </div>
          <div>
            <h1 className="text-md font-bold tracking-tight flex items-center gap-1.5 text-[#1C1C1A]">
              shapeup <span className="text-[#2563EB] font-black uppercase text-[10px] tracking-widest bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">pos</span>
            </h1>
            <p className="text-[9px] text-[#6B6B63] font-bold uppercase tracking-wider">Point of Sale Kasir</p>
          </div>

          {/* Close Session Button */}
          <button 
            onClick={() => setIsSessionOpen(false)}
            className="ml-4 px-3.5 py-2 bg-white border border-[#E2E2DC] hover:bg-red-50 hover:border-red-200 text-[#6B6B63] hover:text-[#DC2626] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
          >
            ✕ Tutup Sesi
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsOrderHistoryOpen(true)}
            className="px-4 py-2 bg-white border border-[#E2E2DC] text-[#1C1C1A] hover:bg-slate-50 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-xs flex items-center gap-1.5"
          >
            <span>📋</span> Riwayat & Refund
          </button>
          
          {/* Mobile Cart Toggle */}
          <button
            onClick={() => setIsCartOpenMobile(!isCartOpenMobile)}
            className="md:hidden px-4 py-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8] rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-sm"
          >
            {isCartOpenMobile ? 'Kembali Belanja' : `Keranjang (${cart.reduce((a, b) => a + b.quantity, 0)})`}
          </button>
        </div>
      </header>

      {/* POS WORKSPACE (Flex Reverse: Catalog Left, Cart Right) */}
      <div className="flex-1 flex overflow-hidden relative flex-row-reverse">
        
        {/* RIGHT COLUMN: CASHIER & CART PANEL (Moved to right side) */}
        <div className={`w-full md:w-[420px] xl:w-[460px] bg-white border-l border-[#E2E2DC] flex flex-col h-full shrink-0 transition-transform duration-300 z-10 
          ${isCartOpenMobile ? 'absolute inset-0 translate-x-0' : 'hidden md:flex absolute md:relative translate-x-full md:translate-x-0'}`}>
          
          {/* CUSTOMER SELECTOR */}
          <div className="p-4 bg-slate-50 border-b border-[#E2E2DC] flex items-center gap-2">
            <div className="flex-1 relative">
              {selectedCustomer ? (
                <div className="flex justify-between items-center bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl px-4 py-3 text-sm">
                  <div>
                    <p className="font-bold text-[#1E40AF]">{selectedCustomer.name}</p>
                    <p className="text-[10px] text-[#3B82F6] font-mono">{selectedCustomer.phone}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedCustomer(null)}
                    className="text-[#3B82F6] hover:text-[#1D4ED8] font-bold text-md w-6 h-6 rounded-full hover:bg-blue-100 flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="relative w-full">
                  <input
                    type="text"
                    placeholder="🔍 Cari nama / nomor HP pelanggan..."
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value)
                      setIsCustomerDropdownOpen(true)
                    }}
                    onFocus={() => setIsCustomerDropdownOpen(true)}
                    className="w-full px-4 py-3 bg-white border border-[#E2E2DC] rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB]"
                  />
                  {isCustomerDropdownOpen && (
                    <>
                      {/* Fixed full-screen transparent click-away handler */}
                      <div 
                        className="fixed inset-0 z-40 cursor-default" 
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsCustomerDropdownOpen(false)
                        }}
                      />
                      {/* Floating autocomplete results */}
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-[#E2E2DC] rounded-xl shadow-lg max-h-60 overflow-y-auto z-50 divide-y divide-slate-100">
                        <div
                          onClick={() => {
                            setSelectedCustomer(null)
                            setCustomerSearch('')
                            setIsCustomerDropdownOpen(false)
                          }}
                          className="px-4 py-3 hover:bg-slate-50 cursor-pointer text-xs font-bold uppercase text-[#6B6B63] select-none"
                        >
                          👤 Customer Tamu (Guest Customer)
                        </div>
                        {filteredCustomers.length === 0 ? (
                          <div className="px-4 py-3 text-xs text-gray-400 italic">
                            Tidak ada pelanggan yang cocok
                          </div>
                        ) : (
                          filteredCustomers.map(c => (
                            <div
                              key={c.id}
                              onClick={() => {
                                setSelectedCustomer(c)
                                setCustomerSearch('')
                                setIsCustomerDropdownOpen(false)
                              }}
                              className="px-4 py-2.5 hover:bg-blue-50 cursor-pointer text-xs flex flex-col transition-colors"
                            >
                              <span className="font-bold text-[#1C1C1A]">{c.name}</span>
                              <span className="text-[10px] text-[#6B6B63] font-mono mt-0.5">{c.phone}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            
            <button 
              onClick={() => setIsAddCustomerOpen(true)}
              className="p-3 bg-[#2563EB] text-white hover:bg-[#1D4ED8] rounded-xl font-bold flex items-center justify-center shrink-0 transition-colors shadow-sm"
              title="Tambah Customer Baru"
            >
              ➕
            </button>
          </div>

          {/* CART ITEM LIST */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#E2E2DC] bg-white">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 text-slate-400">
                <span className="text-4xl mb-2">🛒</span>
                <p className="text-xs font-bold uppercase tracking-wider">Keranjang Belanja Kosong</p>
                <p className="text-[10px] mt-1 text-[#6B6B63]">Pilih produk di katalog untuk ditambahkan.</p>
              </div>
            ) : (
              cart.map((item, idx) => {
                const isExpanded = idx === expandedCartItemIdx
                const sub = item.customPrice * item.quantity
                const discVal = sub * (item.discountPercent / 100)
                const total = sub - discVal

                return (
                  <div 
                    key={idx}
                    className={`flex flex-col transition-all border-l-4 ${isExpanded ? 'bg-slate-50 border-[#2563EB]' : 'border-transparent hover:bg-slate-50/50'}`}
                  >
                    {/* Main Item Row */}
                    <div 
                      onClick={() => setExpandedCartItemIdx(isExpanded ? null : idx)}
                      className="p-4 flex justify-between items-center cursor-pointer select-none"
                    >
                      <div className="flex-1 pr-3">
                        <p className="font-bold text-[#1C1C1A] text-xs uppercase tracking-tight">{item.product.name}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] font-bold text-[#6B6B63]">
                          <span>{formatIDR(item.customPrice)}</span>
                          {item.discountPercent > 0 && (
                            <span className="text-[#DC2626] bg-[#FEF2F2] border border-[#FECDD3] px-1.5 py-0.5 rounded-md text-[9px]">
                              -{item.discountPercent}%
                            </span>
                          )}
                          {item.customPrice !== item.product.price && (
                            <span className="text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] px-1.5 py-0.5 text-[9px] rounded-md italic">
                              Harga Edit
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quantity adjustment & total */}
                      <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Inline Qty Adjustment Buttons */}
                        <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5">
                          <button
                            onClick={() => handleDecrementQty(idx)}
                            className="w-7 h-7 flex items-center justify-center font-bold text-xs text-[#6B6B63] hover:text-[#1C1C1A] hover:bg-white rounded-md transition-all active:scale-90"
                          >
                            －
                          </button>
                          <span className="w-8 text-center text-xs font-bold text-[#1C1C1A]">{item.quantity}</span>
                          <button
                            onClick={() => handleIncrementQty(idx)}
                            className="w-7 h-7 flex items-center justify-center font-bold text-xs text-[#6B6B63] hover:text-[#1C1C1A] hover:bg-white rounded-md transition-all active:scale-90"
                          >
                            ＋
                          </button>
                        </div>

                        <div className="text-right w-24">
                          <span className="font-bold text-xs text-[#1C1C1A]">{formatIDR(total)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Inline Editor (Accordion) */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 bg-slate-100 border-t border-[#E2E2DC] flex items-end gap-3 transition-all animate-in slide-in-from-top duration-150">
                        {item.product.id.startsWith('custom-') && (
                          <div className="flex-2 space-y-1">
                            <label className="block text-[9px] font-bold text-[#6B6B63] uppercase tracking-wider">Nama Item / Keterangan</label>
                            <input
                              type="text"
                              value={item.product.name.split(' (Rp ')[0]}
                              onChange={(e) => {
                                const newName = e.target.value || 'Biaya Kustom'
                                setCart(prev => {
                                  const updated = [...prev]
                                  const amount = updated[idx].customPrice
                                  updated[idx].product = {
                                    ...updated[idx].product,
                                    name: `${newName} (Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount)})`
                                  }
                                  return updated
                                })
                              }}
                              className="w-full p-2 bg-white border border-[#E2E2DC] rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] outline-none"
                            />
                          </div>
                        )}
                        <div className="flex-1 space-y-1">
                          <label className="block text-[9px] font-bold text-[#6B6B63] uppercase tracking-wider">Harga Satuan (Rp)</label>
                          <input
                            type="number"
                            min="0"
                            value={item.customPrice === 0 ? '' : item.customPrice}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value)
                              setCart(prev => {
                                const updated = [...prev]
                                const amount = isNaN(val) ? 0 : val
                                updated[idx].customPrice = amount
                                if (updated[idx].product.id.startsWith('custom-')) {
                                  const baseName = updated[idx].product.name.split(' (Rp ')[0]
                                  updated[idx].product = {
                                    ...updated[idx].product,
                                    name: `${baseName} (Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount)})`
                                  }
                                }
                                return updated
                              })
                            }}
                            className="w-full p-2 bg-white border border-[#E2E2DC] rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] outline-none"
                          />
                        </div>
                        <div className="flex-1 space-y-1">
                          <label className="block text-[9px] font-bold text-[#6B6B63] uppercase tracking-wider">Diskon (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={item.discountPercent === 0 ? '' : item.discountPercent}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value)
                              setCart(prev => {
                                const updated = [...prev]
                                updated[idx].discountPercent = isNaN(val) ? 0 : Math.min(100, val)
                                return updated
                              })
                            }}
                            className="w-full p-2 bg-white border border-[#E2E2DC] rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] outline-none"
                          />
                        </div>
                        <button
                          onClick={() => handleRemoveFromCart(idx)}
                          className="px-4 py-2 bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#DC2626] border border-[#FECDD3] rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0"
                        >
                          Hapus
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* TOTAL & CHECKOUT AREA */}
          <div className="border-t border-[#E2E2DC] bg-[#F7F7F5] shrink-0">
            {/* PRICING SUMS */}
            <div className="p-5 border-b border-[#E2E2DC] bg-white space-y-2">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-[#6B6B63]">
                <span>Subtotal</span>
                <span className="text-[#1C1C1A]">{formatIDR(getSubtotal())}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-[#DC2626]">
                <span>Diskon</span>
                <span>-{formatIDR(getDiscountAmount())}</span>
              </div>
              <div className="pt-3 border-t border-[#E2E2DC] flex justify-between items-center">
                <span className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider">Grand Total</span>
                <span className="text-xl font-black text-[#2563EB]">{formatIDR(getGrandTotal())}</span>
              </div>
            </div>

            {/* CHECKOUT BUTTON */}
            <div className="p-4 bg-white">
              <button
                disabled={cart.length === 0}
                onClick={() => {
                  setCashReceived(Math.ceil(getGrandTotal() / 50000) * 50000 || getGrandTotal())
                  setIsPaymentOpen(true)
                }}
                className="w-full py-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-md shadow-blue-100 disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                💳 Bayar {formatIDR(getGrandTotal())}
              </button>
            </div>
          </div>
        </div>

        {/* LEFT COLUMN: PRODUCT CATALOG & KEYPAD WORKSPACE (Moved to left side) */}
        <div className="flex-1 flex flex-col h-full bg-[#F7F7F5] overflow-hidden">
          
          {/* TABS SELECTOR (KEYPAD VS CATALOG) */}
          <div className="p-4 bg-white border-b border-[#E2E2DC] flex justify-center shrink-0 shadow-xs">
            <div className="inline-flex bg-slate-100 p-1 rounded-xl w-full max-w-md">
              <button
                onClick={() => setActiveTab('catalog')}
                className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${activeTab === 'catalog' ? 'bg-white text-[#2563EB] shadow-xs' : 'text-[#6B6B63] hover:text-[#1C1C1A]'}`}
              >
                Katalog Produk
              </button>
              <button
                onClick={() => setActiveTab('keypad')}
                className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${activeTab === 'keypad' ? 'bg-white text-[#2563EB] shadow-xs' : 'text-[#6B6B63] hover:text-[#1C1C1A]'}`}
              >
                Keypad Nominal
              </button>
            </div>
          </div>

          {activeTab === 'catalog' ? (
            <>
              {/* SEARCH BAR & CATEGORY FILTER */}
              <div className="p-4 bg-white border-b border-[#E2E2DC] shrink-0 space-y-3 shadow-xs">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    🔍
                  </span>
                  <input
                    type="text"
                    placeholder="Cari produk berdasarkan nama atau kode SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] transition-all"
                  />
                </div>

                {/* CATEGORIES PILLS */}
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                  <button
                    onClick={() => setSelectedCategoryId(null)}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap border
                      ${selectedCategoryId === null 
                        ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-xs' 
                        : 'bg-white hover:bg-slate-50 text-[#6B6B63] border-[#E2E2DC]'}`}
                  >
                    Semua Kategori
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap border
                        ${selectedCategoryId === cat.id 
                          ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-xs' 
                          : 'bg-white hover:bg-slate-50 text-[#6B6B63] border-[#E2E2DC]'}`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* PRODUCT GRID */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#F7F7F5]">
                {filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-8 text-[#6B6B63]">
                    <span className="text-4xl mb-2">📦</span>
                    <p className="text-xs font-bold uppercase tracking-wider">Produk Tidak Ditemukan</p>
                    <p className="text-[10px] mt-1 text-[#A8A89E]">Coba ganti kata kunci atau pilih kategori lain.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {filteredProducts.map(product => {
                      const isTracked = product.stock_type === 'tracked'
                      const isAvailable = product.stock_type === 'available'
                      const isUnavailable = product.stock_type === 'unavailable'
                      
                      const outOfStock = isTracked && product.stock_quantity <= 0
                      const isBlocked = isUnavailable || outOfStock

                      // Visual Stock Badge
                      let stockBadge = null
                      if (isTracked) {
                        if (product.stock_quantity > 10) {
                          stockBadge = <span className="bg-green-50 border border-green-200 text-green-700 text-[9px] font-bold px-1.5 py-0.5 rounded-md">Stok: {product.stock_quantity}</span>
                        } else if (product.stock_quantity > 0) {
                          stockBadge = <span className="bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded-md">Stok: {product.stock_quantity}</span>
                        } else {
                          stockBadge = <span className="bg-red-50 border border-red-250 text-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded-md">Habis</span>
                        }
                      } else if (isAvailable) {
                        stockBadge = <span className="bg-green-50 border border-green-200 text-green-700 text-[9px] font-bold px-1.5 py-0.5 rounded-md">Tersedia</span>
                      } else {
                        stockBadge = <span className="bg-slate-100 border border-slate-200 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded-md">Tidak Tersedia</span>
                      }

                      const pastelClass = getPastelColor(product.name)
                      const initials = getInitials(product.name)

                      return (
                        <div
                          key={product.id}
                          onClick={() => !isBlocked && handleAddToCart(product)}
                          className={`bg-white border rounded-2xl p-4 flex flex-col justify-between h-[165px] relative transition-all shadow-xs select-none
                            ${isBlocked 
                              ? 'opacity-40 cursor-not-allowed border-slate-200 bg-slate-50' 
                              : 'cursor-pointer border-[#E2E2DC] hover:border-[#2563EB] hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]'}`}
                        >
                          <div>
                            {/* CATEGORY & STOCK BAR */}
                            <div className="flex justify-between items-start gap-1 mb-2">
                              <span className="text-[8px] bg-slate-100 px-1.5 py-0.5 rounded font-bold text-[#6B6B63] uppercase truncate max-w-[60px]">
                                {categories.find(c => c.id === product.category_id)?.name || 'Jasa'}
                              </span>
                              {stockBadge}
                            </div>

                            {/* PRODUCT BADGE & NAME */}
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${pastelClass} shrink-0`}>
                                {initials}
                              </div>
                              <h4 className="font-bold text-[#1C1C1A] text-xs line-clamp-2 uppercase tracking-tight leading-relaxed">
                                {product.name}
                              </h4>
                            </div>
                            
                            {product.sku && (
                              <p className="text-[9px] text-[#A8A89E] font-mono uppercase tracking-wider">{product.sku}</p>
                            )}
                          </div>

                          {/* PRICE */}
                          <div className="flex justify-between items-end mt-1">
                            <span className="text-xs font-black text-[#1C1C1A]">
                              {formatIDR(product.price)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* KEYPAD WORKSPACE FOR CUSTOM CHARGES */
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#F7F7F5]">
              <div className="w-full max-w-sm bg-white border border-[#E2E2DC] rounded-2xl p-6 shadow-sm flex flex-col space-y-6">
                
                {/* Display screen */}
                <div className="bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl p-5 text-center shadow-inner">
                  <span className="text-[10px] font-bold text-[#6B6B63] uppercase tracking-widest block mb-1">Nominal Custom</span>
                  <span className="text-3xl font-black text-[#2563EB] tracking-tight">{formatIDR(Number(keypadAmount))}</span>
                </div>

                {/* Custom Item Name Input */}
                <div className="space-y-1 text-left">
                  <label className="block text-[9px] font-bold text-[#6B6B63] uppercase tracking-wider">Nama Item / Keterangan (Opsional)</label>
                  <input
                    type="text"
                    placeholder="Contoh: Biaya Kustom, Ongkos Kirim, dll."
                    value={customItemName}
                    onChange={(e) => setCustomItemName(e.target.value)}
                    className="w-full p-3 bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] transition-all"
                  />
                </div>

                {/* Keys grid */}
                <div className="grid grid-cols-3 gap-3">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(key => {
                    const isAction = key === 'C' || key === '⌫'
                    return (
                      <button
                        key={key}
                        onClick={() => handleKeypadPress(key)}
                        className={`py-4 rounded-xl font-bold text-lg border transition-all active:scale-95 ${isAction ? 'bg-slate-50 hover:bg-slate-100 border-[#E2E2DC] text-[#6B6B63]' : 'bg-white hover:bg-slate-50 border-[#E2E2DC] text-[#1C1C1A]'}`}
                      >
                        {key}
                      </button>
                    )
                  })}
                  {/* Double zero key */}
                  <button
                    onClick={() => handleKeypadPress('00')}
                    className="col-span-3 py-3 bg-white hover:bg-slate-50 border border-[#E2E2DC] rounded-xl font-bold text-md text-[#1C1C1A] transition-all active:scale-95"
                  >
                    000
                  </button>
                </div>

                {/* Add to Cart button */}
                <button
                  onClick={handleAddCustomAmount}
                  className="w-full py-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>➕</span> Tambahkan ke Keranjang
                </button>
              </div>
            </div>
          )}

          {/* MOBILE BAR (STICKY BOTTOM) */}
          {cart.length > 0 && !isCartOpenMobile && (
            <div className="md:hidden p-4 bg-white border-t border-[#E2E2DC] shadow-lg flex justify-between items-center shrink-0">
              <div>
                <p className="text-[10px] text-[#6B6B63] font-bold uppercase tracking-wider">Total Belanja</p>
                <p className="text-md font-black text-[#2563EB]">{formatIDR(getGrandTotal())}</p>
              </div>
              <button
                onClick={() => setIsCartOpenMobile(true)}
                className="px-5 py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-md transition-colors"
              >
                Lihat Keranjang ({cart.reduce((a, b) => a + b.quantity, 0)})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PAYMENT / CHECKOUT MODAL */}
      {isPaymentOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-center items-center p-4 z-[99] animate-in fade-in duration-200">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header (Clean, Light) */}
            <div className="px-6 py-4 bg-white border-b border-[#E2E2DC] flex justify-between items-center">
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#2563EB]">Konfirmasi Transaksi</h3>
                <h2 className="text-md font-black uppercase tracking-tight mt-0.5 text-[#1C1C1A]">Metode Pembayaran</h2>
              </div>
              <button 
                onClick={() => {
                  if (!checkingOut) setIsPaymentOpen(false)
                }}
                className="text-[#6B6B63] hover:text-[#1C1C1A] transition-colors text-xl font-light focus:outline-none"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 overflow-y-auto bg-[#F7F7F5] flex-1">
              
              {/* Grand Total Show */}
              <div className="bg-white p-5 border border-[#E2E2DC] rounded-2xl shadow-xs text-center">
                <p className="text-[10px] text-[#6B6B63] font-bold uppercase tracking-wider">Total Harus Dibayar</p>
                <h3 className="text-2xl font-black text-[#2563EB] mt-1">{formatIDR(getGrandTotal())}</h3>
              </div>

              {/* Payment Methods */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-[#6B6B63] uppercase tracking-widest mb-1">Pilih Pembayaran</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`py-3 px-4 border rounded-xl font-bold text-xs text-center transition-all flex items-center justify-center gap-2 
                      ${paymentMethod === 'cash'
                        ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB] shadow-xs'
                        : 'border-[#E2E2DC] bg-white hover:bg-gray-50 text-[#6B6B63]'}`}
                  >
                    💵 Tunai (Cash)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('bank')}
                    className={`py-3 px-4 border rounded-xl font-bold text-xs text-center transition-all flex items-center justify-center gap-2 
                      ${paymentMethod === 'bank'
                        ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB] shadow-xs'
                        : 'border-[#E2E2DC] bg-white hover:bg-gray-50 text-[#6B6B63]'}`}
                  >
                    💳 Card / QRIS
                  </button>
                </div>
              </div>

              {/* Cash Calculator (visible only when Tunai) */}
              {paymentMethod === 'cash' && (
                <div className="p-5 bg-white border border-[#E2E2DC] rounded-2xl space-y-4 shadow-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-[#6B6B63] uppercase tracking-widest mb-2">Uang Tunai Diterima (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 border border-[#E2E2DC] rounded-xl focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] outline-none text-md font-bold text-[#1C1C1A] transition-all"
                      value={cashReceived === 0 ? '' : cashReceived}
                      onChange={e => setCashReceived(Number(e.target.value))}
                    />
                  </div>

                  {/* Cash Shortcuts */}
                  <div className="flex flex-wrap gap-2">
                    {[getGrandTotal(), 50000, 100000, 200000].map(amt => {
                      const roundedAmt = amt === getGrandTotal() ? amt : Math.ceil(getGrandTotal() / amt) * amt
                      if (roundedAmt < getGrandTotal()) return null
                      return (
                        <button
                          key={roundedAmt}
                          onClick={() => setCashReceived(roundedAmt)}
                          className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 border border-[#E2E2DC] rounded-lg text-[10px] font-bold text-[#6B6B63] transition-colors"
                        >
                          {formatIDR(roundedAmt)}
                        </button>
                      )
                    })}
                  </div>

                  {/* Change display */}
                  <div className="pt-4 border-t border-[#E2E2DC] flex justify-between items-center text-xs font-bold uppercase">
                    <span className="text-[#6B6B63]">Kembalian</span>
                    <span className={`text-md font-black ${cashReceived - getGrandTotal() >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                      {cashReceived - getGrandTotal() >= 0 
                        ? formatIDR(cashReceived - getGrandTotal()) 
                        : 'Kurang ' + formatIDR(Math.abs(cashReceived - getGrandTotal()))}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-white border-t border-[#E2E2DC] flex gap-3 justify-end shrink-0">
              <button
                type="button"
                disabled={checkingOut}
                onClick={() => setIsPaymentOpen(false)}
                className="px-5 py-3 border border-[#E2E2DC] rounded-xl text-xs font-bold uppercase tracking-wider text-[#6B6B63] hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Batal
              </button>
              <button
                disabled={checkingOut || (paymentMethod === 'cash' && cashReceived < getGrandTotal())}
                onClick={handleCheckoutSubmit}
                className="px-6 py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md shadow-blue-100 disabled:opacity-50 transition-all"
              >
                {checkingOut ? 'Memproses...' : 'Konfirmasi & Cetak Jurnal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD CUSTOMER MODAL */}
      <AddCustomerModal
        isOpen={isAddCustomerOpen}
        onClose={() => setIsAddCustomerOpen(false)}
        onSave={(newCust) => {
          setSelectedCustomer(newCust)
          refreshData()
        }}
        businessId={businessId}
      />

      {/* ORDER HISTORY MODAL */}
      <OrderHistoryModal
        isOpen={isOrderHistoryOpen}
        onClose={() => setIsOrderHistoryOpen(false)}
        businessId={businessId}
        onRefundCompleted={refreshData}
      />

    </div>,
    document.body
  )
}
