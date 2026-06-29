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
  const [activeCartIndex, setActiveCartIndex] = useState<number | null>(null)
  const [numpadMode, setNumpadMode] = useState<'qty' | 'disc' | 'price'>('qty')
  const [numpadBuffer, setNumpadBuffer] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

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

  // Numpad Actions
  const handleNumpadPress = (val: string) => {
    if (activeCartIndex === null || cart.length === 0) return

    let currentVal = numpadBuffer
    if (val === '⌫') {
      currentVal = currentVal.slice(0, -1)
    } else {
      // Limit size of typed numbers to prevent overflow
      if (currentVal.length < 10) {
        currentVal += val
      }
    }

    setNumpadBuffer(currentVal)
    updateActiveCartItem(currentVal)
  }

  const updateActiveCartItem = (bufferVal: string) => {
    if (activeCartIndex === null) return

    setCart(prev => {
      const updated = [...prev]
      const item = { ...updated[activeCartIndex] }

      if (numpadMode === 'qty') {
        const qty = parseInt(bufferVal)
        item.quantity = isNaN(qty) ? 0 : qty
      } else if (numpadMode === 'disc') {
        const disc = parseFloat(bufferVal)
        item.discountPercent = isNaN(disc) ? 0 : Math.min(100, disc)
      } else if (numpadMode === 'price') {
        const prc = parseFloat(bufferVal)
        item.customPrice = isNaN(prc) ? 0 : prc
      }

      updated[activeCartIndex] = item
      return updated
    })
  }

  const handleModeChange = (mode: 'qty' | 'disc' | 'price') => {
    setNumpadMode(mode)
    setNumpadBuffer('')
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
        setActiveCartIndex(existingIdx)
        setNumpadBuffer('')
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
        setActiveCartIndex(newCart.length - 1)
        setNumpadBuffer('')
        return newCart
      }
    })
  }

  const handleRemoveFromCart = (index: number) => {
    setCart(prev => {
      const updated = prev.filter((_, i) => i !== index)
      if (updated.length === 0) {
        setActiveCartIndex(null)
      } else {
        setActiveCartIndex(Math.max(0, index - 1))
      }
      setNumpadBuffer('')
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
      setActiveCartIndex(null)
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 space-y-4">
        <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-black text-slate-800 uppercase tracking-widest">Memuat Layanan Kasir POS...</p>
      </div>
    )
  }
  if (!isSessionOpen) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 font-sans text-gray-800 antialiased">
        <div className="bg-white border border-slate-200/80 p-10 rounded-[2.5rem] shadow-xl shadow-slate-155/30 w-full max-w-lg text-center space-y-8">
          
          {/* Logo Mark & Welcome */}
          <div className="space-y-3">
            <div className="mx-auto w-16 h-16 bg-yellow-500 rounded-3xl flex items-center justify-center text-slate-900 font-black text-3xl shadow-lg shadow-yellow-100/50">
              S
            </div>
            <div>
              <span className="text-[9px] font-black text-blue-650 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-md border border-blue-100">Point of Sale</span>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-3">ShapeUp POS Kasir</h1>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Sesi Penjualan CRM</p>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Session details */}
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-150 text-left space-y-3 text-[11px] font-semibold text-slate-500">
            <div className="flex justify-between items-center">
              <span>👤 Kasir Aktif</span>
              <span className="font-black text-slate-800">{userProfile?.full_name || 'Petugas Toko'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>📦 Katalog Produk</span>
              <span className="font-black text-slate-800">{products.length} Item Tersedia</span>
            </div>
            <div className="flex justify-between items-center">
              <span>👥 CRM Pelanggan</span>
              <span className="font-black text-slate-800">{customers.length} Member Terhubung</span>
            </div>
          </div>

          {/* Open Button */}
          <div>
            <button
              onClick={() => setIsSessionOpen(true)}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-blue-100 active:scale-[0.98] transform transition-all flex items-center justify-center gap-2"
            >
              🚀 Buka Sesi Kasir POS
            </button>
            <p className="text-[9px] text-slate-450 font-bold uppercase tracking-widest mt-3">
              Membuka POS dalam mode fokus layar penuh
            </p>
          </div>

        </div>
      </div>
    )
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#f8f9fa] flex flex-col h-screen overflow-hidden font-sans text-gray-800 antialiased">
      
      {/* HEADER BAR */}
      <header className="flex justify-between items-center px-6 py-4 bg-[#1a1c23] border-b border-slate-800 text-white shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 bg-yellow-500 rounded-lg flex items-center justify-center text-slate-900 font-black text-lg">
            S
          </div>
          <div>
            <h1 className="text-md font-black uppercase tracking-widest italic flex items-center gap-1.5">
              ShapeUp <span className="text-yellow-500">POS</span>
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Point of Sale Kasir</p>
          </div>

          {/* Close Session Button */}
          <button 
            onClick={() => setIsSessionOpen(false)}
            className="ml-4 px-3.5 py-2 bg-slate-800 border border-slate-700 hover:bg-red-600 hover:border-red-650 text-slate-300 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
          >
            ✕ Tutup Sesi
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsOrderHistoryOpen(true)}
            className="px-4 py-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
          >
            📋 Riwayat & Refund
          </button>
          
          {/* Mobile Cart Toggle */}
          <button
            onClick={() => setIsCartOpenMobile(!isCartOpenMobile)}
            className="md:hidden px-4 py-2 bg-yellow-500 text-slate-900 hover:bg-yellow-600 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
          >
            {isCartOpenMobile ? 'Kembali Belanja' : `Keranjang (${cart.reduce((a, b) => a + b.quantity, 0)})`}
          </button>
        </div>
      </header>

      {/* POS WORKSPACE */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* LEFT COLUMN: CASHIER & CART PANEL */}
        <div className={`w-full md:w-[480px] xl:w-[520px] bg-white border-r border-gray-200 flex flex-col h-full shrink-0 transition-transform duration-300 z-10 
          ${isCartOpenMobile ? 'absolute inset-0 translate-x-0' : 'hidden md:flex absolute md:relative -translate-x-full md:translate-x-0'}`}>
          
          {/* CUSTOMER SELECTOR */}
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <div className="flex-1 relative">
              {selectedCustomer ? (
                <div className="flex justify-between items-center bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm">
                  <div>
                    <p className="font-bold text-blue-900">{selectedCustomer.name}</p>
                    <p className="text-[10px] text-blue-700 font-mono">{selectedCustomer.phone}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedCustomer(null)}
                    className="text-blue-500 hover:text-blue-700 font-bold text-md w-6 h-6 rounded-full hover:bg-blue-100 flex items-center justify-center"
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
                    className="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-sm font-semibold outline-none focus:border-blue-600"
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
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-250 rounded-xl shadow-xl max-h-60 overflow-y-auto z-50 divide-y divide-gray-100">
                        <div
                          onClick={() => {
                            setSelectedCustomer(null)
                            setCustomerSearch('')
                            setIsCustomerDropdownOpen(false)
                          }}
                          className="px-4 py-3 hover:bg-slate-50 cursor-pointer text-xs font-black uppercase text-gray-400 select-none"
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
                              <span className="font-bold text-gray-800">{c.name}</span>
                              <span className="text-[10px] text-gray-400 font-mono mt-0.5">{c.phone}</span>
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
              className="p-3 bg-blue-600 text-white hover:bg-blue-700 rounded-xl font-bold flex items-center justify-center shrink-0 transition-colors shadow-sm"
              title="Tambah Customer Baru"
            >
              ➕
            </button>
          </div>

          {/* CART ITEM LIST */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 bg-white">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
                <span className="text-4xl mb-2">🛒</span>
                <p className="text-xs font-black uppercase tracking-wider">Keranjang Belanja Kosong</p>
                <p className="text-[10px] mt-1 text-gray-400">Pilih produk di katalog untuk ditambahkan.</p>
              </div>
            ) : (
              cart.map((item, idx) => {
                const isActive = idx === activeCartIndex
                const sub = item.customPrice * item.quantity
                const discVal = sub * (item.discountPercent / 100)
                const total = sub - discVal

                return (
                  <div 
                    key={idx}
                    onClick={() => {
                      setActiveCartIndex(idx)
                      setNumpadBuffer('')
                    }}
                    className={`p-4 flex justify-between items-start transition-all cursor-pointer select-none border-l-4 
                      ${isActive ? 'bg-yellow-50/50 border-yellow-500' : 'border-transparent hover:bg-slate-50/50'}`}
                  >
                    <div className="flex-1 pr-3">
                      <p className="font-bold text-gray-800 text-xs uppercase tracking-tight">{item.product.name}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] font-bold text-gray-400">
                        <span>{item.quantity} x {formatIDR(item.customPrice)}</span>
                        {item.discountPercent > 0 && (
                          <span className="text-red-500 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-md">
                            -{item.discountPercent}%
                          </span>
                        )}
                        {item.customPrice !== item.product.price && (
                          <span className="text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md italic">
                            Harga Edit
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end">
                      <span className="font-black text-xs text-[#1a1c23]">{formatIDR(total)}</span>
                      {isActive && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFromCart(idx)
                          }}
                          className="mt-1 text-[9px] font-black text-red-500 uppercase hover:underline"
                        >
                          [ Hapus ]
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* TOTAL & NUMPAD AREA */}
          <div className="border-t border-gray-200 bg-slate-50 shrink-0">
            {/* PRICING SUMS */}
            <div className="p-5 border-b border-gray-200 bg-white space-y-2">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-gray-400">
                <span>Subtotal</span>
                <span className="text-gray-800">{formatIDR(getSubtotal())}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-red-400">
                <span>Diskon</span>
                <span>-{formatIDR(getDiscountAmount())}</span>
              </div>
              <div className="pt-3 border-t-2 border-slate-900 flex justify-between items-center">
                <span className="text-[11px] font-black text-slate-900 uppercase">Grand Total</span>
                <span className="text-xl font-black text-blue-700">{formatIDR(getGrandTotal())}</span>
              </div>
            </div>

            {/* NUMPAD CONTROL PANEL (Odoo POS Style) */}
            <div className="p-3 grid grid-cols-4 gap-2 bg-slate-100">
              
              {/* Numpad buttons 1-9 */}
              <div className="col-span-3 grid grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => (
                  <button
                    key={k}
                    onClick={() => handleNumpadPress(k)}
                    className="py-3.5 bg-white hover:bg-slate-50 border border-gray-200/80 rounded-xl font-black text-sm text-gray-800 shadow-xs active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    {k}
                  </button>
                ))}
              </div>

              {/* Mode & Action buttons */}
              <div className="col-span-1 flex flex-col gap-1.5">
                <button
                  onClick={() => handleModeChange('qty')}
                  className={`py-2 border rounded-xl font-black text-[10px] uppercase tracking-wider shadow-xs transition-all flex-1 
                    ${numpadMode === 'qty' ? 'bg-yellow-500 text-slate-900 border-yellow-600' : 'bg-white hover:bg-slate-50 border-gray-200 text-gray-500'}`}
                >
                  Qty
                </button>
                <button
                  onClick={() => handleModeChange('disc')}
                  className={`py-2 border rounded-xl font-black text-[10px] uppercase tracking-wider shadow-xs transition-all flex-1
                    ${numpadMode === 'disc' ? 'bg-yellow-500 text-slate-900 border-yellow-600' : 'bg-white hover:bg-slate-50 border-gray-200 text-gray-500'}`}
                >
                  % Disc
                </button>
                <button
                  onClick={() => handleModeChange('price')}
                  className={`py-2 border rounded-xl font-black text-[10px] uppercase tracking-wider shadow-xs transition-all flex-1
                    ${numpadMode === 'price' ? 'bg-yellow-500 text-slate-900 border-yellow-600' : 'bg-white hover:bg-slate-50 border-gray-200 text-gray-500'}`}
                >
                  Price
                </button>
              </div>

              {/* CHECKOUT BUTTON */}
              <button
                disabled={cart.length === 0}
                onClick={() => {
                  setCashReceived(Math.ceil(getGrandTotal() / 50000) * 50000 || getGrandTotal())
                  setIsPaymentOpen(true)
                }}
                className="col-span-4 mt-2 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-[0.2em] shadow-md shadow-blue-100 disabled:opacity-50 transform active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                💳 Proses Pembayaran
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: PRODUCT CATALOG */}
        <div className="flex-1 flex flex-col h-full bg-[#f8f9fa] overflow-hidden">
          
          {/* SEARCH BAR & CATEGORY FILTER */}
          <div className="p-4 bg-white border-b border-gray-200 shrink-0 space-y-3 shadow-xs">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                🔍
              </span>
              <input
                type="text"
                placeholder="Cari produk berdasarkan nama atau kode SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-3 bg-slate-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all"
              />
            </div>

            {/* CATEGORIES PILLS */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap border
                  ${selectedCategoryId === null 
                    ? 'bg-[#1a1c23] text-white border-slate-900 shadow-sm' 
                    : 'bg-white hover:bg-slate-50 text-gray-500 border-gray-200'}`}
              >
                Semua Kategori
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap border
                    ${selectedCategoryId === cat.id 
                      ? 'bg-[#1a1c23] text-white border-slate-900 shadow-sm' 
                      : 'bg-white hover:bg-slate-50 text-gray-500 border-gray-200'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* PRODUCT GRID */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
                <span className="text-4xl mb-2">📦</span>
                <p className="text-xs font-black uppercase tracking-wider">Produk Tidak Ditemukan</p>
                <p className="text-[10px] mt-1 text-gray-400">Coba ganti kata kunci atau pilih kategori lain.</p>
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

                  return (
                    <div
                      key={product.id}
                      onClick={() => !isBlocked && handleAddToCart(product)}
                      className={`bg-white border rounded-2xl p-4 flex flex-col justify-between h-[160px] relative transition-all shadow-xs select-none
                        ${isBlocked 
                          ? 'opacity-45 cursor-not-allowed border-gray-200 bg-slate-50' 
                          : 'cursor-pointer border-gray-200 hover:border-blue-600 hover:shadow-lg hover:shadow-blue-50/50 hover:-translate-y-0.5 active:scale-[0.98]'}`}
                    >
                      <div>
                        {/* CATEGORY & STOCK BAR */}
                        <div className="flex justify-between items-start gap-1 mb-2">
                          <span className="text-[8px] bg-slate-100 px-1.5 py-0.5 rounded font-black text-slate-400 uppercase truncate max-w-[60px]">
                            {categories.find(c => c.id === product.category_id)?.name || 'Jasa'}
                          </span>
                          {stockBadge}
                        </div>

                        {/* PRODUCT NAME */}
                        <h4 className="font-bold text-gray-800 text-xs line-clamp-2 uppercase tracking-tight leading-relaxed">
                          {product.name}
                        </h4>
                        
                        {product.sku && (
                          <p className="text-[9px] text-gray-300 font-mono mt-1 uppercase tracking-wider">{product.sku}</p>
                        )}
                      </div>

                      {/* PRICE */}
                      <div className="flex justify-between items-end mt-4">
                        <span className="text-xs font-black text-slate-900">
                          {formatIDR(product.price)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* MOBILE BAR (STICKY BOTTOM) */}
          {cart.length > 0 && !isCartOpenMobile && (
            <div className="md:hidden p-4 bg-white border-t border-gray-200 shadow-2xl flex justify-between items-center shrink-0">
              <div>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Belanja</p>
                <p className="text-md font-black text-blue-700">{formatIDR(getGrandTotal())}</p>
              </div>
              <button
                onClick={() => setIsCartOpenMobile(true)}
                className="px-5 py-3 bg-[#1a1c23] hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition-colors"
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
          <div className="bg-white border border-gray-300 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-4 bg-[#1a1c23] text-white flex justify-between items-center">
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-yellow-500">Konfirmasi Transaksi</h3>
                <h2 className="text-md font-black uppercase tracking-tight mt-0.5">Metode Pembayaran</h2>
              </div>
              <button 
                onClick={() => {
                  if (!checkingOut) setIsPaymentOpen(false)
                }}
                className="text-slate-400 hover:text-white transition-colors text-xl font-light focus:outline-none"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 overflow-y-auto bg-slate-50 flex-1">
              
              {/* Grand Total Show */}
              <div className="bg-white p-5 border border-gray-200 rounded-2xl shadow-xs text-center">
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Total Harus Dibayar</p>
                <h3 className="text-2xl font-black text-blue-700 mt-1">{formatIDR(getGrandTotal())}</h3>
              </div>

              {/* Payment Methods */}
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Pilih Pembayaran</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`py-3 px-4 border rounded-xl font-black text-xs text-center transition-all flex items-center justify-center gap-2 
                      ${paymentMethod === 'cash'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-600'}`}
                  >
                    💵 Tunai (Cash)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('bank')}
                    className={`py-3 px-4 border rounded-xl font-black text-xs text-center transition-all flex items-center justify-center gap-2 
                      ${paymentMethod === 'bank'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-600'}`}
                  >
                    💳 Card / QRIS
                  </button>
                </div>
              </div>

              {/* Cash Calculator (visible only when Tunai) */}
              {paymentMethod === 'cash' && (
                <div className="p-5 bg-white border border-gray-200 rounded-2xl space-y-4 shadow-xs">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Uang Tunai Diterima (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 outline-none text-md font-bold text-gray-800 transition-all"
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
                          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 transition-colors"
                        >
                          {formatIDR(roundedAmt)}
                        </button>
                      )
                    })}
                  </div>

                  {/* Change display */}
                  <div className="pt-4 border-t border-slate-150 flex justify-between items-center text-xs font-bold uppercase">
                    <span className="text-gray-400">Kembalian</span>
                    <span className={`text-md font-black ${cashReceived - getGrandTotal() >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {cashReceived - getGrandTotal() >= 0 
                        ? formatIDR(cashReceived - getGrandTotal()) 
                        : 'Kurang ' + formatIDR(Math.abs(cashReceived - getGrandTotal()))}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end shrink-0">
              <button
                type="button"
                disabled={checkingOut}
                onClick={() => setIsPaymentOpen(false)}
                className="px-5 py-3 border border-gray-300 rounded-xl text-xs font-bold uppercase tracking-wider text-gray-650 hover:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                Batal
              </button>
              <button
                disabled={checkingOut || (paymentMethod === 'cash' && cashReceived < getGrandTotal())}
                onClick={handleCheckoutSubmit}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-md shadow-blue-100 disabled:opacity-50 transition-all"
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
