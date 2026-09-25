"use client"
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import VariantSelectorModal from './VariantSelectorModal'
import CashPaymentModal from './CashPaymentModal'
import ReceiptPreviewModal from './ReceiptPreviewModal'
import ShiftModal from './ShiftModal'
import HoldModal from './HoldModal'
import AddCustomerModal from '../../orders/pos/components/AddCustomerModal'
import OrderHistoryModal from '../../orders/pos/components/OrderHistoryModal'
import { ReceiptData } from '@/lib/pos/printerAdapter'

// Pastel badge colors for product cards
const getPastelBadge = (name: string) => {
  const styles = [
    'bg-blue-50 text-blue-700 border-blue-200',
    'bg-emerald-50 text-emerald-700 border-emerald-200',
    'bg-indigo-50 text-indigo-700 border-indigo-200',
    'bg-amber-50 text-amber-800 border-amber-200',
    'bg-purple-50 text-purple-700 border-purple-200',
    'bg-rose-50 text-rose-700 border-rose-200',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return styles[Math.abs(hash) % styles.length]
}

export default function POSWorkspace() {
  // Using singleton supabase client from @/lib/supabase

  // Auth & Profile State
  const [loadingInit, setLoadingInit] = useState(true)
  const [businessId, setBusinessId] = useState('')
  const [userProfile, setUserProfile] = useState<any>(null)
  const [activeShift, setActiveShift] = useState<any | null>(null)

  // Data State
  const [products, setProducts] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [heldOrders, setHeldOrders] = useState<any[]>([])

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState<'catalog' | 'keypad'>('catalog')

  // Debounce Search
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

  // Mobile Bottom Sheet State
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false)

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

  // Initialize POS
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
    // 1. Products
    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', bId)
      .order('name', { ascending: true })

    setProducts(prods || [])

    // 2. Categories
    const { data: cats } = await supabase
      .from('categories')
      .select('*')
      .eq('business_id', bId)
      .order('name', { ascending: true })

    setCategories(cats || [])

    // 3. Customers
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

  // Filtered Products
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
  const totalItemCount = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.quantity, 0)
  }, [cart])

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

  // Product Tap Action
  const handleProductTap = (p: any) => {
    if (p.stock_type === 'unavailable') return
    if (p.has_variants || p.type === 'fnb') {
      setSelectedProductForVariant(p)
      setIsVariantModalOpen(true)
    } else {
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
          name: customItemName.trim() || 'Item Manual / Custom',
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

  // Hold & Resume
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
      setIsMobileCartOpen(false)
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

  // Shift Actions
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
      setIsMobileCartOpen(false)
      setIsReceiptModalOpen(true)

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
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-sm font-semibold tracking-wide">Memuat Workspace ShapeUp POS...</div>
      </div>
    )
  }

  // Render Inner Cart Component (reusable for Desktop sidebar & Mobile bottom sheet)
  const renderCartContent = () => (
    <div className="flex flex-col h-full bg-white">
      {/* Customer Header */}
      <div className="p-3.5 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
        <div className="relative flex-1 mr-2">
          <button
            onClick={() => setIsCustomerDropdownOpen(!isCustomerDropdownOpen)}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-white text-left text-xs flex items-center justify-between hover:border-indigo-300 transition shadow-2xs"
          >
            <span className="font-semibold text-slate-800 truncate">
              👤 {selectedCustomer ? selectedCustomer.name : 'Walk-in Customer'}
            </span>
            <span className="text-[10px] text-slate-400 ml-1">▼</span>
          </button>

          {isCustomerDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-2xl shadow-xl z-30 p-2.5 space-y-2">
              <input
                type="text"
                placeholder="Cari pelanggan..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border text-xs outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="max-h-44 overflow-y-auto space-y-1">
                <button
                  onClick={() => {
                    setSelectedCustomer(null)
                    setIsCustomerDropdownOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-100 rounded-xl text-xs font-medium text-slate-700"
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
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 rounded-xl text-xs text-slate-800 flex justify-between items-center"
                    >
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-slate-400 font-mono text-[10px]">{c.phone}</span>
                    </button>
                  ))}
              </div>
              <button
                onClick={() => {
                  setIsCustomerDropdownOpen(false)
                  setIsAddCustomerOpen(true)
                }}
                className="w-full py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-bold text-center hover:bg-indigo-100 transition"
              >
                + Tambah Pelanggan Baru
              </button>
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <button
            onClick={() => setCart([])}
            className="text-xs text-rose-600 hover:text-rose-800 font-semibold px-2 py-1 rounded-lg hover:bg-rose-50 transition"
          >
            Kosongkan
          </button>
        )}
      </div>

      {/* Cart Item List */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
        {cart.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-3xl mx-auto mb-3">
              🛒
            </div>
            <p className="font-semibold text-slate-700">Keranjang belanja kosong</p>
            <p className="text-[11px] text-slate-400 mt-1">Klik item pada katalog untuk menambahkan ke pesanan.</p>
          </div>
        ) : (
          cart.map((item, idx) => (
            <div key={idx} className="p-3 bg-slate-50/90 rounded-2xl border border-slate-200/80 text-xs space-y-2 hover:border-slate-300 transition">
              <div className="flex justify-between items-start">
                <div>
                  <h5 className="font-bold text-slate-900 leading-snug">{item.product.name}</h5>
                  {item.selectedVariant && (
                    <div className="text-[10px] text-indigo-600 font-semibold mt-0.5">• Varian: {item.selectedVariant.name}</div>
                  )}
                  {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                    <div className="text-[10px] text-slate-500">
                      • {item.selectedModifiers.map((m: any) => m.name).join(', ')}
                    </div>
                  )}
                  {item.note && (
                    <div className="text-[10px] text-slate-500 italic">• "{item.note}"</div>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveItem(idx)}
                  className="text-slate-400 hover:text-rose-600 p-1 text-sm transition"
                >
                  ✕
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                <span className="font-extrabold text-indigo-950 text-sm">
                  Rp {(item.finalPrice * item.quantity).toLocaleString('id-ID')}
                </span>

                <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <button
                    onClick={() => handleUpdateQty(idx, -1)}
                    className="w-8 h-7 text-slate-600 hover:bg-slate-100 flex items-center justify-center font-bold text-sm transition"
                  >
                    -
                  </button>
                  <span className="w-8 text-center font-bold text-xs">{item.quantity}</span>
                  <button
                    onClick={() => handleUpdateQty(idx, 1)}
                    className="w-8 h-7 text-slate-600 hover:bg-slate-100 flex items-center justify-center font-bold text-sm transition"
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
      <div className="p-4 border-t border-slate-200 bg-white space-y-3 shrink-0 shadow-lg">
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>Rp {subtotal.toLocaleString('id-ID')}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-rose-600 font-medium">
              <span>Diskon</span>
              <span>-Rp {discountAmount.toLocaleString('id-ID')}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm font-black text-slate-900">
            <span>GRAND TOTAL</span>
            <span className="text-xl font-black text-indigo-600">
              Rp {grandTotal.toLocaleString('id-ID')}
            </span>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSaveHoldOrder}
            disabled={cart.length === 0}
            className="py-3 px-3.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-2xl text-xs transition disabled:opacity-40"
          >
            Hold
          </button>
          <button
            onClick={() => setIsPaymentModalOpen(true)}
            disabled={cart.length === 0}
            className="flex-1 py-3.5 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 active:scale-[0.99] disabled:opacity-40 text-white font-bold rounded-2xl text-sm transition shadow-md shadow-indigo-500/20 text-center"
          >
            Bayar Sekarang (Checkout) →
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-100 text-slate-900 overflow-hidden font-sans fixed inset-0">
      {/* Top Navbar Header */}
      <header className="h-14 bg-slate-900 text-white px-4 flex items-center justify-between shrink-0 shadow-md z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition"
          >
            <span>←</span> <span className="hidden sm:inline">CRM</span>
          </Link>
          <div className="h-4 w-px bg-slate-700 hidden sm:block"></div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 text-white font-black flex items-center justify-center text-xs shadow-md">
              POS
            </div>
            <div>
              <h1 className="font-bold text-sm leading-tight text-white">{userProfile?.full_name ? `${userProfile.full_name}'s POS` : 'ShapeUp POS'}</h1>
              <p className="text-[10px] text-slate-400 leading-none">Workspace Transaksi Kasir</p>
            </div>
          </div>
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsShiftModalOpen(true)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition ${
              activeShift
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                : 'bg-amber-950/80 text-amber-300 border-amber-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${activeShift ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
            <span className="hidden sm:inline">{activeShift ? `Shift: ${activeShift.cashier_name}` : 'Buka Shift'}</span>
            <span className="sm:hidden">{activeShift ? 'Shift' : 'Buka'}</span>
          </button>

          <button
            onClick={() => setIsHoldModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition relative"
          >
            <span>📥 Draft</span>
            {heldOrders.length > 0 && (
              <span className="w-4.5 h-4.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black flex items-center justify-center">
                {heldOrders.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setIsOrderHistoryOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <span>📋 <span className="hidden sm:inline">Riwayat</span></span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* CATALOG AREA (Full Width on Mobile, Left Panel on Desktop lg:flex-1) */}
        <div className="w-full lg:flex-1 flex flex-col bg-slate-50 overflow-hidden border-r border-slate-200">
          {/* Search & Mode Bar */}
          <div className="p-3 sm:p-4 bg-white border-b border-slate-200 space-y-3 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Cari nama produk, SKU, barcode..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                />
                <span className="absolute left-3 top-3 text-slate-400 text-xs">🔍</span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* View Mode Toggle */}
              <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shrink-0">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2.5 py-1.5 rounded-xl text-xs transition font-semibold ${
                    viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-500'
                  }`}
                  title="Tampilan Grid"
                >
                  ▦ Grid
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-2.5 py-1.5 rounded-xl text-xs transition font-semibold ${
                    viewMode === 'list' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-500'
                  }`}
                  title="Tampilan List"
                >
                  ☰ List
                </button>
              </div>

              {/* Tab Selector */}
              <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shrink-0">
                <button
                  onClick={() => setActiveTab('catalog')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    activeTab === 'catalog' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Katalog
                </button>
                <button
                  onClick={() => setActiveTab('keypad')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    activeTab === 'keypad' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Keypad
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            {activeTab === 'catalog' && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
                <button
                  onClick={() => setSelectedCategoryId(null)}
                  className={`px-3.5 py-1.5 rounded-full font-bold whitespace-nowrap transition ${
                    selectedCategoryId === null
                      ? 'bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Semua Kategori ({products.length})
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCategoryId(c.id)}
                    className={`px-3.5 py-1.5 rounded-full font-bold whitespace-nowrap transition ${
                      selectedCategoryId === c.id
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Items Display Area */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-5 pb-24 lg:pb-5">
            {activeTab === 'catalog' ? (
              filteredProducts.length === 0 ? (
                <div className="py-24 text-center text-slate-400 text-xs">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-3xl mx-auto mb-3">
                    🔎
                  </div>
                  <p className="font-semibold text-slate-700 text-sm">Tidak ada produk ditemukan</p>
                  <p className="text-slate-400 mt-1">Coba sesuaikan kata kunci pencarian atau kategori Anda.</p>
                </div>
              ) : viewMode === 'grid' ? (
                /* GRID VIEW */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
                  {filteredProducts.map((p) => {
                    const isOutOfStock = p.stock_type === 'tracked' && p.stock_quantity <= 0
                    const badgeClass = getPastelBadge(p.name)
                    return (
                      <div
                        key={p.id}
                        onClick={() => !isOutOfStock && handleProductTap(p)}
                        className={`group bg-white rounded-3xl border p-3.5 flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-xs hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] ${
                          isOutOfStock ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200' : 'border-slate-200/90 hover:border-indigo-400'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeClass} truncate max-w-[100px]`}>
                              {p.sku || 'RETAIL'}
                            </span>
                            {isOutOfStock ? (
                              <span className="text-[9px] bg-rose-100 text-rose-700 font-extrabold px-2 py-0.5 rounded-full">Habis</span>
                            ) : p.stock_type === 'tracked' ? (
                              <span className="text-[9px] bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
                                Stok: {p.stock_quantity}
                              </span>
                            ) : null}
                          </div>
                          <h4 className="font-bold text-xs sm:text-sm text-slate-900 line-clamp-2 leading-snug group-hover:text-indigo-600 transition">
                            {p.name}
                          </h4>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-xs sm:text-sm font-black text-slate-950">
                            Rp {p.price.toLocaleString('id-ID')}
                          </span>
                          <span className="w-7 h-7 rounded-xl bg-indigo-50 text-indigo-600 font-black flex items-center justify-center text-xs group-hover:bg-indigo-600 group-hover:text-white transition shadow-2xs">
                            +
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* LIST VIEW */
                <div className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden divide-y divide-slate-100 shadow-2xs">
                  {filteredProducts.map((p) => {
                    const isOutOfStock = p.stock_type === 'tracked' && p.stock_quantity <= 0
                    return (
                      <div
                        key={p.id}
                        onClick={() => !isOutOfStock && handleProductTap(p)}
                        className={`p-3.5 sm:p-4 flex items-center justify-between hover:bg-indigo-50/40 transition cursor-pointer ${
                          isOutOfStock ? 'opacity-50 cursor-not-allowed bg-slate-50' : ''
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="font-bold text-xs sm:text-sm text-slate-900">{p.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">SKU: {p.sku || '-'}</div>
                        </div>

                        <div className="flex items-center gap-3 sm:gap-4 text-right">
                          {p.stock_type === 'tracked' && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              isOutOfStock ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              Stok: {p.stock_quantity}
                            </span>
                          )}
                          <span className="text-xs sm:text-sm font-black text-slate-950">
                            Rp {p.price.toLocaleString('id-ID')}
                          </span>
                          <button 
                            disabled={isOutOfStock}
                            className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-2xs"
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
              <div className="max-w-md mx-auto bg-white rounded-3xl border border-slate-200/90 p-5 shadow-sm space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Nama Item / Layanan Kustom
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Ongkir / Jasa Jahit..."
                    value={customItemName}
                    onChange={(e) => setCustomItemName(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-center">
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Nominal Input (Rp)</div>
                  <div className="text-3xl font-black text-indigo-950 mt-1">
                    Rp {Number(keypadAmount).toLocaleString('id-ID')}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '000'].map((btn) => (
                    <button
                      key={btn}
                      onClick={() => handleKeypadPress(btn)}
                      className={`py-3.5 rounded-2xl text-lg font-bold border transition active:scale-95 ${
                        btn === 'C'
                          ? 'bg-rose-50 text-rose-600 border-rose-200'
                          : 'bg-white text-slate-900 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {btn}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleAddCustomKeypadItem}
                  disabled={Number(keypadAmount) <= 0}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition shadow-md disabled:opacity-40"
                >
                  + Tambahkan ke Cart
                </button>
              </div>
            )}
          </div>
        </div>

        {/* DESKTOP CART PANEL (Right sidebar on screens >= 1024px) */}
        <div className="hidden lg:flex lg:w-[380px] xl:w-[420px] shrink-0 border-l border-slate-200">
          {renderCartContent()}
        </div>

        {/* MOBILE FLOATING CART BAR (Shown on mobile when items in cart) */}
        {cart.length > 0 && (
          <div className="lg:hidden fixed bottom-3 left-3 right-3 z-30 bg-slate-900 text-white p-3.5 rounded-2xl shadow-2xl flex items-center justify-between border border-slate-800 animate-slide-up">
            <div 
              onClick={() => setIsMobileCartOpen(true)}
              className="flex items-center gap-3 cursor-pointer flex-1"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-md">
                {totalItemCount}
              </div>
              <div>
                <div className="text-xs font-bold text-white">Lihat Keranjang</div>
                <div className="text-xs text-indigo-300 font-extrabold">
                  Rp {grandTotal.toLocaleString('id-ID')}
                </div>
              </div>
            </div>

            <button
              onClick={() => setIsMobileCartOpen(true)}
              className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold rounded-xl text-xs shadow-md transition"
            >
              Lanjut Checkout →
            </button>
          </div>
        )}

        {/* MOBILE CART BOTTOM SHEET DRAWER (Slid up from bottom on mobile) */}
        {isMobileCartOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex flex-col justify-end">
            <div className="bg-white rounded-t-3xl shadow-2xl overflow-hidden flex flex-col h-[85vh] w-full animate-slide-up">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-900 text-base">Keranjang Pesanan</span>
                  <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    {totalItemCount} Item
                  </span>
                </div>
                <button
                  onClick={() => setIsMobileCartOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 hover:text-slate-900 flex items-center justify-center font-bold"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {renderCartContent()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ALL MODALS */}
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
