"use client"
import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import VariantSelectorModal from './VariantSelectorModal'
import CashPaymentModal from './CashPaymentModal'
import ReceiptPreviewModal from './ReceiptPreviewModal'
import ShiftModal from './ShiftModal'
import HoldModal from './HoldModal'
import AddCustomerModal from '../../orders/pos/components/AddCustomerModal'
import OrderHistoryModal from '../../orders/pos/components/OrderHistoryModal'
import { ReceiptData } from '@/lib/pos/printerAdapter'

export default function POSWorkspace() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Auth & Profile
  const [loadingInit, setLoadingInit] = useState(true)
  const [businessId, setBusinessId] = useState('')
  const [userProfile, setUserProfile] = useState<any>(null)
  const [activeShift, setActiveShift] = useState<any | null>(null)

  // Data
  const [products, setProducts] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [heldOrders, setHeldOrders] = useState<any[]>([])

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState<'catalog' | 'keypad'>('catalog')

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 250)
    return () => clearTimeout(handler)
  }, [searchQuery])

  // Keypad State
  const [keypadAmount, setKeypadAmount] = useState('0')
  const [customItemName, setCustomItemName] = useState('')

  // Cart & Customer State
  const [cart, setCart] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)
  const [cartDiscountPercent, setCartDiscountPercent] = useState<number>(0)
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')

  // Mobile Bottom Sheet expand state
  const [isMobileCartExpanded, setIsMobileCartExpanded] = useState(false)

  // Modals
  const [selectedProductForVariant, setSelectedProductForVariant] = useState<any | null>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false)
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false)
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false)
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false)

  // Receipt & Payment Data
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)

  // Load Data
  useEffect(() => {
    async function initPOS() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('active_business_id, full_name')
            .eq('id', user.id)
            .single()

          if (profile?.active_business_id) {
            setUserProfile(profile)
            setBusinessId(profile.active_business_id)
            await loadCatalogAndCustomers(profile.active_business_id)
            await checkActiveShift()
          }
        }
      } catch (err) {
        console.error('POS Init Error:', err)
      } finally {
        setLoadingInit(false)
      }
    }
    initPOS()
  }, [])

  const loadCatalogAndCustomers = async (bId: string) => {
    // 1. Fetch Products
    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', bId)
      .order('name', { ascending: true })

    setProducts(prods || [])

    // 2. Fetch Categories
    const { data: cats } = await supabase
      .from('categories')
      .select('*')
      .eq('business_id', bId)
      .order('name', { ascending: true })

    setCategories(cats || [])

    // 3. Fetch Customers
    const { data: custs } = await supabase
      .from('customer_metrics')
      .select('customer_id, name, phone')
      .eq('business_id', bId)
      .limit(100)

    if (custs) {
      setCustomers(custs.map(c => ({ id: c.customer_id, name: c.name, phone: c.phone })))
    }
  }

  const checkActiveShift = async () => {
    try {
      const res = await fetch('/api/pos/shifts')
      if (res.ok) {
        const data = await res.json()
        setActiveShift(data.activeShift)
      }
    } catch (e) {
      console.warn('Could not fetch active shift:', e)
    }
  }

  // Filtered products calculation
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        !debouncedSearch ||
        p.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (p.sku && p.sku.toLowerCase().includes(debouncedSearch.toLowerCase()))

      const matchCategory = !selectedCategoryId || p.category_id === selectedCategoryId
      return matchSearch && matchCategory
    })
  }, [products, debouncedSearch, selectedCategoryId])

  // Cart Calculations
  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.finalPrice * item.quantity, 0)
  }, [cart])

  const discountAmount = useMemo(() => {
    if (cartDiscountPercent > 0) {
      return Math.round((subtotal * cartDiscountPercent) / 100)
    }
    return cart.reduce((acc, item) => acc + (item.discount || 0) * item.quantity, 0)
  }, [subtotal, cartDiscountPercent, cart])

  const grandTotal = useMemo(() => {
    return Math.max(0, subtotal - discountAmount)
  }, [subtotal, discountAmount])

  // Add Product to Cart (1-tap for simple products, or open variant modal)
  const handleProductTap = (p: any) => {
    if (p.stock_type === 'unavailable') return
    // Check if product has variants or modifiers
    if (p.has_variants || p.type === 'fnb') {
      setSelectedProductForVariant(p)
      setIsVariantModalOpen(true)
    } else {
      // Direct 1-tap add
      setCart((prev) => {
        const existingIdx = prev.findIndex((item) => item.product.id === p.id && !item.selectedVariant)
        if (existingIdx > -1) {
          const updated = [...prev]
          updated[existingIdx].quantity += 1
          return updated
        }
        return [...prev, {
          product: p,
          quantity: 1,
          finalPrice: p.price,
          discount: 0
        }]
      })
    }
  }

  // Add Item from Variant Selector Modal
  const handleAddVariantItem = (itemData: any) => {
    setCart((prev) => [
      ...prev,
      {
        product: itemData.product,
        selectedVariant: itemData.selectedVariant,
        selectedModifiers: itemData.selectedModifiers,
        note: itemData.note,
        quantity: 1,
        finalPrice: itemData.finalPrice,
        discount: 0
      }
    ])
  }

  // Cart quantity controls
  const handleUpdateQty = (index: number, delta: number) => {
    setCart((prev) => {
      const copy = [...prev]
      const newQty = copy[index].quantity + delta
      if (newQty <= 0) {
        copy.splice(index, 1)
      } else {
        copy[index].quantity = newQty
      }
      return copy
    })
  }

  const handleRemoveItem = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index))
  }

  // Keypad Handlers
  const handleKeypadPress = (val: string) => {
    if (val === 'C') {
      setKeypadAmount('0')
    } else if (val === '000') {
      if (keypadAmount !== '0') setKeypadAmount(keypadAmount + '000')
    } else {
      setKeypadAmount(keypadAmount === '0' ? val : keypadAmount + val)
    }
  }

  const handleAddCustomKeypadItem = () => {
    const price = Number(keypadAmount)
    if (price <= 0) return

    setCart((prev) => [
      ...prev,
      {
        product: {
          id: 'custom-' + Date.now(),
          name: customItemName.trim() || 'Item Kustom / Manual',
          sku: 'CUSTOM',
          type: 'service',
          stock_type: 'available',
          price: price
        },
        quantity: 1,
        finalPrice: price,
        discount: 0
      }
    ])

    setKeypadAmount('0')
    setCustomItemName('')
  }

  // Hold & Resume Transactions
  const handleSaveHoldOrder = async () => {
    if (cart.length === 0) return
    try {
      const res = await fetch('/api/pos/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          customer_id: selectedCustomer?.id,
          customer_name: selectedCustomer?.name || 'Walk-in',
          cart_json: cart,
          total_items: cart.length,
          grand_total: grandTotal
        })
      })
      const data = await res.json()
      if (data.heldOrder) {
        setHeldOrders((prev) => [data.heldOrder, ...prev])
      }
      setCart([])
      setSelectedCustomer(null)
    } catch (e) {
      console.error('Failed to hold order:', e)
    }
  }

  const handleResumeHoldOrder = (h: any) => {
    if (h.cart_json && Array.isArray(h.cart_json)) {
      setCart(h.cart_json)
    }
    if (h.customer_id) {
      setSelectedCustomer({ id: h.customer_id, name: h.customer_name })
    }
  }

  const handleDeleteHoldOrder = async (holdId: string) => {
    try {
      await fetch('/api/pos/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', hold_id: holdId })
      })
      setHeldOrders((prev) => prev.filter((h) => h.id !== holdId))
    } catch (e) {
      console.error('Failed to delete held order:', e)
    }
  }

  // Shift Management
  const handleOpenShift = async (initialCash: number, note: string, sourceAccountCode: string) => {
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', initial_cash: initialCash, note, source_account_code: sourceAccountCode })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Gagal membuka shift')
    setActiveShift(data.shift)
  }

  const handleCloseShift = async (shiftId: string, actualCash: number, note: string) => {
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', shift_id: shiftId, actual_cash: actualCash, note })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Gagal menutup shift')
    setActiveShift(null)
  }

  // Checkout Execution
  const handleConfirmCheckout = async (paymentInfo: { method: 'cash' | 'bank' | 'qris'; cashReceived: number; changeAmount: number }) => {
    setCheckingOut(true)
    try {
      const itemsPayload = cart.map((item) => ({
        id: item.product.id,
        name: item.product.name,
        price: item.finalPrice,
        quantity: item.quantity,
        discount: item.discount || 0,
        variantId: item.selectedVariant?.id,
        variantName: item.selectedVariant?.name,
        modifiers: item.selectedModifiers,
        note: item.note
      }))

      const res = await fetch('/api/pos/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer?.id || 'guest',
          items: itemsPayload,
          payment_method: paymentInfo.method,
          subtotal: subtotal,
          discount_amount: discountAmount,
          grand_total: grandTotal
        })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Gagal memproses pesanan POS')

      // Prepare Receipt Data
      const receipt: ReceiptData = {
        businessName: userProfile?.full_name ? `${userProfile.full_name}'s Store` : 'ShapeUp POS',
        orderNumber: result.order_number || ('POS-' + Date.now().toString().slice(-6)),
        date: new Date().toLocaleString('id-ID'),
        cashierName: userProfile?.full_name || 'Kasir',
        customerName: selectedCustomer?.name || 'Walk-in Customer',
        items: cart.map((i) => ({
          name: i.product.name,
          variant: i.selectedVariant?.name,
          quantity: i.quantity,
          price: i.finalPrice,
          subtotal: i.finalPrice * i.quantity,
          discount: i.discount,
          note: i.note
        })),
        subtotal: subtotal,
        discountTotal: discountAmount,
        taxTotal: 0,
        grandTotal: grandTotal,
        paymentMethod: paymentInfo.method === 'cash' ? 'Tunai (Cash)' : paymentInfo.method === 'qris' ? 'QRIS' : 'Transfer/Kartu',
        cashReceived: paymentInfo.cashReceived,
        changeAmount: paymentInfo.changeAmount
      }

      setReceiptData(receipt)
      setIsPaymentModalOpen(false)
      setIsReceiptModalOpen(true)

      // Clear Cart
      setCart([])
      setSelectedCustomer(null)
      setCartDiscountPercent(0)
    } catch (err: any) {
      throw err
    } finally {
      setCheckingOut(false)
    }
  }

  if (loadingInit) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-50 text-gray-500">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
        <div className="text-xs font-medium">Memuat Workspace ShapeUp POS...</div>
      </div>
    )
  }

  return (
    <div className="h-screen w-full flex flex-col bg-gray-100 text-gray-900 overflow-hidden font-sans">
      {/* Top Navbar */}
      <header className="h-14 bg-white border-b border-gray-200 px-4 flex items-center justify-between shrink-0 shadow-xs z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-xs">
            POS
          </div>
          <div>
            <h1 className="font-bold text-sm text-gray-900 leading-none">ShapeUp POS</h1>
            <p className="text-[10px] text-gray-500 mt-0.5">Workspace Transaksi Kasir</p>
          </div>
        </div>

        {/* Shift Indicator & Top Actions */}
        <div className="flex items-center gap-2">
          {/* Shift status button */}
          <button
            onClick={() => setIsShiftModalOpen(true)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition ${
              activeShift
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${activeShift ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
            <span>{activeShift ? `Shift Aktif (${activeShift.cashier_name})` : 'Buka Shift Kasir'}</span>
          </button>

          {/* Hold Orders Button */}
          <button
            onClick={() => setIsHoldModalOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 transition relative"
          >
            <span>📥 Draft Hold</span>
            {heldOrders.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                {heldOrders.length}
              </span>
            )}
          </button>

          {/* Transaction History Button */}
          <button
            onClick={() => setIsOrderHistoryOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 transition"
          >
            <span>📋 Riwayat</span>
          </button>
        </div>
      </header>

      {/* Workspace Main Area (Landscape split: Left Catalog, Right Cart) */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL: Catalog Workspace */}
        <div className="flex-1 flex flex-col bg-gray-50/60 overflow-hidden border-r border-gray-200">
          {/* Search Bar & Category Controls */}
          <div className="p-3.5 bg-white border-b border-gray-200 space-y-3">
            <div className="flex items-center gap-2">
              {/* Search Bar */}
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Cari produk (Nama, SKU, Barcode)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                />
                <span className="absolute left-3 top-2.5 text-gray-400 text-xs">🔍</span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* View Mode Toggle (Grid vs List) */}
              <div className="flex bg-gray-100 p-0.5 rounded-xl border border-gray-200 shrink-0">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg text-xs transition ${
                    viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-xs font-bold' : 'text-gray-500'
                  }`}
                  title="Tampilan Grid Thumbnail"
                >
                  ▦ Grid
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-lg text-xs transition ${
                    viewMode === 'list' ? 'bg-white text-indigo-600 shadow-xs font-bold' : 'text-gray-500'
                  }`}
                  title="Tampilan List SKU Compact"
                >
                  ☰ List
                </button>
              </div>

              {/* Catalog vs Keypad Tab */}
              <div className="flex bg-gray-100 p-0.5 rounded-xl border border-gray-200 shrink-0">
                <button
                  onClick={() => setActiveTab('catalog')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === 'catalog' ? 'bg-indigo-600 text-white shadow-xs' : 'text-gray-600'
                  }`}
                >
                  Katalog
                </button>
                <button
                  onClick={() => setActiveTab('keypad')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === 'keypad' ? 'bg-indigo-600 text-white shadow-xs' : 'text-gray-600'
                  }`}
                >
                  Keypad Manual
                </button>
              </div>
            </div>

            {/* Category Pills */}
            {activeTab === 'catalog' && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
                <button
                  onClick={() => setSelectedCategoryId(null)}
                  className={`px-3 py-1 rounded-full font-medium whitespace-nowrap transition ${
                    selectedCategoryId === null
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Semua Kategori ({products.length})
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCategoryId(c.id)}
                    className={`px-3 py-1 rounded-full font-medium whitespace-nowrap transition ${
                      selectedCategoryId === c.id
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Catalog Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'catalog' ? (
              filteredProducts.length === 0 ? (
                <div className="py-20 text-center text-gray-400 text-xs">
                  <div className="text-4xl mb-2">🔍</div>
                  Produk tidak ditemukan untuk kata kunci ini.
                </div>
              ) : viewMode === 'grid' ? (
                /* GRID VIEW */
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filteredProducts.map((p) => {
                    const isOutOfStock = p.stock_type === 'tracked' && p.stock_quantity <= 0
                    return (
                      <div
                        key={p.id}
                        onClick={() => !isOutOfStock && handleProductTap(p)}
                        className={`bg-white rounded-2xl border p-3 flex flex-col justify-between transition cursor-pointer shadow-xs hover:shadow-md ${
                          isOutOfStock ? 'opacity-50 cursor-not-allowed border-gray-200 bg-gray-50' : 'border-gray-200 hover:border-indigo-400'
                        }`}
                      >
                        <div>
                          {/* Stock status badge */}
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-[10px] font-mono text-gray-400 truncate max-w-[80px]">
                              {p.sku || 'SKU-N/A'}
                            </span>
                            {isOutOfStock ? (
                              <span className="text-[9px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded">Habis</span>
                            ) : p.stock_type === 'tracked' ? (
                              <span className="text-[9px] bg-emerald-50 text-emerald-700 font-medium px-1.5 py-0.5 rounded">
                                Stok: {p.stock_quantity}
                              </span>
                            ) : null}
                          </div>
                          <h4 className="font-bold text-xs text-gray-900 line-clamp-2 leading-snug">{p.name}</h4>
                        </div>

                        <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
                          <span className="text-xs font-extrabold text-indigo-950">
                            Rp {p.price.toLocaleString('id-ID')}
                          </span>
                          <span className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center text-xs group-hover:bg-indigo-600 group-hover:text-white transition">
                            +
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* LIST VIEW */
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100 shadow-xs">
                  {filteredProducts.map((p) => {
                    const isOutOfStock = p.stock_type === 'tracked' && p.stock_quantity <= 0
                    return (
                      <div
                        key={p.id}
                        onClick={() => !isOutOfStock && handleProductTap(p)}
                        className={`p-3.5 flex items-center justify-between hover:bg-indigo-50/40 transition cursor-pointer ${
                          isOutOfStock ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-xs text-gray-900">{p.name}</div>
                          <div className="text-[10px] text-gray-400 font-mono">SKU: {p.sku || '-'}</div>
                        </div>

                        <div className="flex items-center gap-4 text-right">
                          {p.stock_type === 'tracked' && (
                            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                              isOutOfStock ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                            }`}>
                              Stok: {p.stock_quantity}
                            </span>
                          )}
                          <span className="text-xs font-extrabold text-indigo-950">
                            Rp {p.price.toLocaleString('id-ID')}
                          </span>
                          <button 
                            disabled={isOutOfStock}
                            className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition"
                          >
                            + Tambah
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              /* KEYPAD MODE */
              <div className="max-w-md mx-auto bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    Nama Item / Layanan Kustom
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Ongkos Kirim / Jasa Jahit..."
                    value={customItemName}
                    onChange={(e) => setCustomItemName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div className="bg-gray-50 border rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Nominal Input (Rp)</div>
                  <div className="text-3xl font-black text-indigo-950 mt-1">
                    Rp {Number(keypadAmount).toLocaleString('id-ID')}
                  </div>
                </div>

                {/* Keypad Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '000'].map((btn) => (
                    <button
                      key={btn}
                      onClick={() => handleKeypadPress(btn)}
                      className={`py-3.5 rounded-xl text-lg font-bold border transition active:scale-95 ${
                        btn === 'C'
                          ? 'bg-red-50 text-red-600 border-red-200'
                          : 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {btn}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleAddCustomKeypadItem}
                  disabled={Number(keypadAmount) <= 0}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-sm disabled:opacity-50"
                >
                  + Tambahkan ke Cart
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Cart Panel (Tablet Landscape permanent, HP bottom sheet) */}
        <div className="w-full lg:w-[380px] xl:w-[420px] bg-white flex flex-col shrink-0 border-l border-gray-200 z-10">
          {/* Cart Customer Header */}
          <div className="p-3.5 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <div className="relative flex-1 mr-2">
              {/* Customer Selector dropdown button */}
              <button
                onClick={() => setIsCustomerDropdownOpen(!isCustomerDropdownOpen)}
                className="w-full py-1.5 px-3 rounded-xl border border-gray-200 bg-white text-left text-xs flex items-center justify-between hover:border-gray-300 transition"
              >
                <span className="font-semibold text-gray-800 truncate">
                  👤 {selectedCustomer ? selectedCustomer.name : 'Walk-in Customer'}
                </span>
                <span className="text-[10px] text-gray-400">▼</span>
              </button>

              {/* Customer Dropdown */}
              {isCustomerDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl z-30 p-2 space-y-2">
                  <input
                    type="text"
                    placeholder="Cari pelanggan..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
                  />
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    <button
                      onClick={() => {
                        setSelectedCustomer(null)
                        setIsCustomerDropdownOpen(false)
                      }}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-gray-100 rounded-lg text-xs font-medium text-gray-700"
                    >
                      Walk-in Customer (Tanpa Nama)
                    </button>
                    {customers
                      .filter((c) => c.name.toLowerCase().includes(customerSearch.toLowerCase()))
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setSelectedCustomer(c)
                            setIsCustomerDropdownOpen(false)
                          }}
                          className="w-full text-left px-2.5 py-1.5 hover:bg-gray-100 rounded-lg text-xs text-gray-800 flex justify-between"
                        >
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-gray-400 font-mono text-[10px]">{c.phone}</span>
                        </button>
                      ))}
                  </div>
                  <button
                    onClick={() => {
                      setIsCustomerDropdownOpen(false)
                      setIsAddCustomerOpen(true)
                    }}
                    className="w-full py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold text-center hover:bg-indigo-100 transition"
                  >
                    + Pelanggan Baru
                  </button>
                </div>
              )}
            </div>

            {/* Clear Cart */}
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition"
              >
                Kosongkan
              </button>
            )}
          </div>

          {/* Cart Item List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {cart.length === 0 ? (
              <div className="py-20 text-center text-gray-400 text-xs">
                <div className="text-4xl mb-2">🛒</div>
                Keranjang belanja kosong.
                <br />Pilih produk dari katalog untuk mulai bertransaksi.
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="p-3 bg-gray-50/80 rounded-xl border border-gray-200 text-xs space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h5 className="font-bold text-gray-900">{item.product.name}</h5>
                      {item.selectedVariant && (
                        <div className="text-[10px] text-indigo-600 font-semibold">• Varian: {item.selectedVariant.name}</div>
                      )}
                      {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                        <div className="text-[10px] text-gray-500">
                          • {item.selectedModifiers.map((m: any) => m.name).join(', ')}
                        </div>
                      )}
                      {item.note && (
                        <div className="text-[10px] text-gray-500 italic">• "{item.note}"</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveItem(idx)}
                      className="text-gray-400 hover:text-red-600 p-1"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-gray-200/60">
                    <span className="font-extrabold text-indigo-950">
                      Rp {(item.finalPrice * item.quantity).toLocaleString('id-ID')}
                    </span>

                    {/* Quantity Stepper */}
                    <div className="flex items-center bg-white border border-gray-300 rounded-lg overflow-hidden shadow-2xs">
                      <button
                        onClick={() => handleUpdateQty(idx, -1)}
                        className="w-7 h-6 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold"
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-bold text-xs">{item.quantity}</span>
                      <button
                        onClick={() => handleUpdateQty(idx, 1)}
                        className="w-7 h-6 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cart Summary & Checkout Footer */}
          <div className="p-4 border-t border-gray-200 bg-white space-y-3 shrink-0 shadow-lg">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>Rp {subtotal.toLocaleString('id-ID')}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Diskon Totals</span>
                  <span>-Rp {discountAmount.toLocaleString('id-ID')}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-gray-200 text-sm font-black text-gray-900">
                <span>GRAND TOTAL</span>
                <span className="text-lg text-indigo-600">
                  Rp {grandTotal.toLocaleString('id-ID')}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveHoldOrder}
                disabled={cart.length === 0}
                className="py-3 px-3 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl text-xs transition disabled:opacity-50"
              >
                Hold
              </button>
              <button
                onClick={() => setIsPaymentModalOpen(true)}
                disabled={cart.length === 0}
                className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition shadow-md text-center"
              >
                Bayar Sekarang (Checkout) →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODALS */}
      <VariantSelectorModal
        isOpen={isVariantModalOpen}
        onClose={() => setIsVariantModalOpen(false)}
        product={selectedProductForVariant}
        onAddToCart={handleAddVariantItem}
      />

      <CashPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        grandTotal={grandTotal}
        onConfirmPayment={handleConfirmCheckout}
      />

      <ReceiptPreviewModal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        receipt={receiptData}
      />

      <ShiftModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        activeShift={activeShift}
        cashierName={userProfile?.full_name || 'Kasir'}
        onOpenShift={handleOpenShift}
        onCloseShift={handleCloseShift}
      />

      <HoldModal
        isOpen={isHoldModalOpen}
        onClose={() => setIsHoldModalOpen(false)}
        heldOrders={heldOrders}
        onResumeCart={handleResumeHoldOrder}
        onDeleteHold={handleDeleteHoldOrder}
      />

      {isAddCustomerOpen && (
        <AddCustomerModal
          isOpen={isAddCustomerOpen}
          onClose={() => setIsAddCustomerOpen(false)}
          businessId={businessId}
          onSave={(c: any) => {
            setCustomers((prev) => [c, ...prev])
            setSelectedCustomer(c)
          }}
        />
      )}

      {isOrderHistoryOpen && (
        <OrderHistoryModal
          isOpen={isOrderHistoryOpen}
          onClose={() => setIsOrderHistoryOpen(false)}
          businessId={businessId}
          onRefundCompleted={() => {
            if (businessId) loadCatalogAndCustomers(businessId)
          }}
        />
      )}
    </div>
  )
}
