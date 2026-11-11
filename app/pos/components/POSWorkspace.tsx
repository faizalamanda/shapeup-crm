"use client"
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import VariantSelectorModal from './VariantSelectorModal'
import CashPaymentModal, { type PaymentResult } from './CashPaymentModal'
import ReceiptPreviewModal from './ReceiptPreviewModal'
import PaymentSuccessView from './PaymentSuccessView'
import ShiftModal from './ShiftModal'
import HoldModal from './HoldModal'
import KitchenTicketPreviewModal from './KitchenTicketPreviewModal'
import { getStoredKitchenSettings } from '@/lib/pos/kitchenSettings'
import { buildKitchenTicketsFromItems, KitchenTicketData } from '@/lib/pos/kitchenTicketBuilder'
import { dispatchAllKitchenTickets } from '@/lib/pos/kitchenPrinterDispatcher'
import { resolvePosMode } from '@/lib/pos/posMode'
import AddCustomerModal from '../../orders/pos/components/AddCustomerModal'
import OrderHistoryModal from '../../orders/pos/components/OrderHistoryModal'
import POSOrderDetailModal from './POSOrderDetailModal'
import POSBluetoothStatusBar from './POSBluetoothStatusBar'
import POSBluetoothQuickReconnectModal from './POSBluetoothQuickReconnectModal'
import ItemNoteModal from './ItemNoteModal'
import OrderNoteModal from './OrderNoteModal'
import GlobalDiscountModal from './GlobalDiscountModal'
import CartItemEditModal from './CartItemEditModal'
import PrintingDimensionModal from './PrintingDimensionModal'
import PriceAuthorizationModal, { AuthorizationRecord } from './PriceAuthorizationModal'
import { PriceGuardSettings, DEFAULT_PRICE_GUARD_SETTINGS } from '@/lib/priceGuard/types'
import { ReceiptData, warmUpBluetoothPrinter } from '@/lib/pos/printerAdapter'
import { getStoredReceiptSettings } from './ReceiptSettingsModal'
import { 
  buildReceiptDataFromOrder, 
  buildHoldOrderReceiptData, 
  buildHeldOrdersSummaryReceiptData 
} from '@/lib/pos/receiptDataBuilder'
import { useUserContext } from '@/components/UserContext'
import { formatDisplayDate } from '@/lib/timeUtils'
import { getBusinessTimezone } from '@/lib/localzone'
import { fetchLoyaltySettings } from '@/plugins/loyalty/helpers/loyaltyApi'
import { LoyaltySettings, LoyaltyTier, DEFAULT_LOYALTY_SETTINGS, resolveTier, calculateEarnedPoints } from '@/plugins/loyalty/types'
import { useCustomerDirectory, matchesCustomerQuery, notifyCustomerDirectoryUpdate } from '@/lib/customerDirectoryStore'
import { usePosCatalog, PosSalesType, resolvePosItemPrice } from '@/lib/posCatalogStore'
import { useModalBackHandler } from '@/hooks/useModalBackHandler'

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

export default function POSWorkspace({
  onBackToHub,
  preloadedSession
}: {
  onBackToHub?: (updatedSession?: any) => void
  preloadedSession?: {
    activeShift?: any | null
    cashierName?: string
    accounts?: any[]
    posRegisters?: any[]
  }
} = {}) {
  // Using singleton supabase client from @/lib/supabase
  const { activeBusiness, userProfile: ctxProfile, bizLoading } = useUserContext()

  // Auth & Profile State
  const [businessId, setBusinessId] = useState(activeBusiness?.id || '')
  const [userProfile, setUserProfile] = useState<any>(ctxProfile || null)
  const [activeShift, setActiveShift] = useState<any | null>(preloadedSession?.activeShift ?? null)
  const posMode = useMemo(() => resolvePosMode(activeBusiness), [activeBusiness])

  // Reactive POS Catalog Store (0ms instant access from L1 RAM / L2 sessionStorage + SWR)
  const {
    products,
    categories,
    loading: catalogLoading,
    isSyncing: catalogSyncing,
    refresh: refreshCatalog,
    updateLocalStock,
    searchServer: searchProductsServer
  } = usePosCatalog(supabase, activeBusiness?.id)

  // Data State (Hydrated from session handoff if available)
  const [customers, setCustomers] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>(preloadedSession?.accounts ?? [])
  const [posRegisters, setPosRegisters] = useState<any[]>(preloadedSession?.posRegisters ?? [])
  const [heldOrders, setHeldOrders] = useState<any[]>([])
  const [activeHoldId, setActiveHoldId] = useState<string | null>(null)

  // Search, Filter & Windowing State
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [isSearchingServer, setIsSearchingServer] = useState(false)
  const [showAllSimilarMatches, setShowAllSimilarMatches] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState<'catalog' | 'keypad'>('catalog')
  const [visibleProductCount, setVisibleProductCount] = useState<number>(60)

  // Reset expansion when search query changes
  useEffect(() => {
    setShowAllSimilarMatches(false)
  }, [debouncedSearch])

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

  // Cart, Sales Type & Customer State
  const [cart, setCart] = useState<any[]>([])
  const [salesType, setSalesType] = useState<PosSalesType>(() => (posMode.mode === 'fnb' ? 'dine_in' : 'basic'))
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)

  // Sync default salesType when business posMode changes (F&B -> dine_in, Retail/Print -> basic)
  useEffect(() => {
    setSalesType(posMode.mode === 'fnb' ? 'dine_in' : 'basic')
  }, [posMode.mode])

  // Sales Type Switcher in POS Cashier is strictly shown ONLY for F&B POS mode
  const showSalesTypeSwitcher = posMode.mode === 'fnb'

  // Switch Sales Type and dynamically recalculate non-overridden item prices in cart
  const handleSalesTypeChange = useCallback((nextType: PosSalesType) => {
    setSalesType(nextType)
    setCart((prev) =>
      prev.map((item) => {
        if (item.dimension_spec || item.authorization || String(item.product?.id || '').startsWith('custom-')) {
          return item
        }
        const modExtra = Array.isArray(item.selectedModifiers)
          ? item.selectedModifiers.reduce((sum: number, m: any) => sum + Number(m?.priceExtra || 0), 0)
          : 0
        const parentResolved = resolvePosItemPrice(item.product, nextType, Number(item.product?.price || 0))
        const unitBase = item.selectedVariant
          ? resolvePosItemPrice(item.selectedVariant, nextType, parentResolved)
          : parentResolved
        return {
          ...item,
          finalPrice: unitBase + modExtra
        }
      })
    )
  }, [])
  
  // Discount states
  const [globalDiscountType, setGlobalDiscountType] = useState<'nominal' | 'percent'>('nominal')
  const [globalDiscountInput, setGlobalDiscountInput] = useState<string>('')
  
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false)
  useModalBackHandler(isCustomerDropdownOpen, () => setIsCustomerDropdownOpen(false))
  const [customerSearch, setCustomerSearch] = useState('')

  // Item edit modal state
  const [editingCartItemIndex, setEditingCartItemIndex] = useState<number | null>(null)

  // Notes & Discount Modals State
  const [orderNote, setOrderNote] = useState<string>('')
  const [itemNoteModalIndex, setItemNoteModalIndex] = useState<number | null>(null)
  const [isOrderNoteModalOpen, setIsOrderNoteModalOpen] = useState<boolean>(false)
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState<boolean>(false)

  // Price Guard & Authorization State
  const [priceGuardSettings, setPriceGuardSettings] = useState<PriceGuardSettings>(DEFAULT_PRICE_GUARD_SETTINGS)
  const [authorizations, setAuthorizations] = useState<Map<string, AuthorizationRecord>>(new Map())
  const [authModalState, setAuthModalState] = useState<{
    isOpen: boolean
    type: 'line_item_price' | 'global_discount'
    title?: string
    targetDescription: string
    productId?: string | null
    proposedPrice?: number
    currentPrice?: number
    discountApplied?: number
    itemIndex?: number | null
    onSuccessCallback?: (record: AuthorizationRecord) => void
  }>({
    isOpen: false,
    type: 'line_item_price',
    targetDescription: '',
  })

  // Mobile Drawer State
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false)
  useModalBackHandler(isMobileCartOpen, () => setIsMobileCartOpen(false))

  // Modals
  const [selectedProductForVariant, setSelectedProductForVariant] = useState<any | null>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)
  const [selectedProductForDimension, setSelectedProductForDimension] = useState<any | null>(null)
  const [editingDimensionItemIndex, setEditingDimensionItemIndex] = useState<number | null>(null)
  const [isDimensionModalOpen, setIsDimensionModalOpen] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false)
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false)
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false)
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false)
  const [selectedOrderForDetail, setSelectedOrderForDetail] = useState<any | null>(null)
  const [isBtQuickModalOpen, setIsBtQuickModalOpen] = useState(false)
  const [unpaidOrdersCount, setUnpaidOrdersCount] = useState<number>(0)

  // Receipt & Payment Data
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptData | null>(null)
  const [isPreviewReceiptOpen, setIsPreviewReceiptOpen] = useState(false)
  const [kitchenPreviewTickets, setKitchenPreviewTickets] = useState<KitchenTicketData[]>([])
  const [isKitchenPreviewOpen, setIsKitchenPreviewOpen] = useState(false)
  const [lastCreatedOrderId, setLastCreatedOrderId] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null)

  const { customers: dirCustomers, searchServer: searchCustomersServer } = useCustomerDirectory({
    businessId: activeBusiness?.id
  })

  // Merge full customer directory with loyalty points from customer_metrics
  const mergedPosCustomers = useMemo(() => {
    if (dirCustomers.length === 0) return customers
    const loyaltyMap = new Map<string, { loyalty_points: number; loyalty_tier: string }>()
    for (const c of customers) {
      if (c.id) {
        loyaltyMap.set(c.id, {
          loyalty_points: Number(c.loyalty_points || 0),
          loyalty_tier: c.loyalty_tier || 'Bronze'
        })
      }
    }
    return dirCustomers.map(dc => {
      const loy = loyaltyMap.get(dc.id)
      return {
        ...dc,
        loyalty_points: loy?.loyalty_points ?? Number(dc.loyalty_points || 0),
        loyalty_tier: loy?.loyalty_tier ?? dc.loyalty_tier ?? 'Bronze'
      }
    })
  }, [dirCustomers, customers])

  const filteredPosCustomers = useMemo(() => {
    const q = customerSearch.trim()
    const list = q
      ? mergedPosCustomers.filter(c => matchesCustomerQuery(c, q))
      : mergedPosCustomers
    return list.slice(0, 50)
  }, [mergedPosCustomers, customerSearch])

  useEffect(() => {
    const q = customerSearch.trim()
    if (!isCustomerDropdownOpen || q.length < 2 || filteredPosCustomers.length >= 5) return
    const timer = setTimeout(() => {
      searchCustomersServer(q)
    }, 250)
    return () => clearTimeout(timer)
  }, [customerSearch, isCustomerDropdownOpen, filteredPosCustomers.length, searchCustomersServer])

  // Proactive Bluetooth Warm-up & Screen Wake Lock for POS counter resilience
  useEffect(() => {
    void warmUpBluetoothPrinter()

    let wakeLockSentinel: any = null
    const acquireWakeLock = async () => {
      if (typeof window !== 'undefined' && 'wakeLock' in navigator && typeof (navigator as any).wakeLock?.request === 'function') {
        try {
          if (document.visibilityState === 'visible') {
            wakeLockSentinel = await (navigator as any).wakeLock.request('screen')
          }
        } catch {
          // Ignored if user OS or battery saver policy rejects
        }
      }
    }

    void acquireWakeLock()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void acquireWakeLock()
        void warmUpBluetoothPrinter()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (wakeLockSentinel) {
        try {
          wakeLockSentinel.release()
        } catch {}
      }
    }
  }, [])

  // Non-blocking deferred loading of secondary POS features (PriceGuard, Hold, Loyalty, Metrics)
  const loadSecondaryData = useCallback(async (bId: string) => {
    try {
      const promises: any[] = [
        supabase.from('customer_metrics').select('customer_id, name, phone, loyalty_points, loyalty_tier').eq('business_id', bId).limit(100),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', bId).eq('source_platform', 'POS').in('payment_status', ['partial', 'unpaid']).neq('status', 'cancelled'),
        fetchLoyaltySettings(supabase, bId).catch(() => null),
        fetch('/api/settings/pos').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/pos/hold').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]

      const needAccounts = accounts.length === 0
      const needRegisters = posRegisters.length === 0
      const needShift = activeShift === null && !preloadedSession?.activeShift

      if (needAccounts) {
        promises.push(
          supabase.from('accounts').select('id, code, name, type').eq('business_id', bId).in('type', ['ASSET', 'EQUITY']).order('code', { ascending: true })
        )
      }
      if (needRegisters) {
        promises.push(
          supabase.from('pos_registers').select('id, name, account_id').eq('business_id', bId).eq('status', 'active').order('name', { ascending: true })
        )
      }
      if (needShift) {
        promises.push(
          fetch('/api/pos/shifts').then((r) => (r.ok ? r.json() : null)).catch(() => null)
        )
      }

      const results = await Promise.all(promises)
      let idx = 0
      const custs = results[idx++]?.data
      const unpCount = results[idx++]?.count
      const lSettings = results[idx++]
      const posSettingsRes = results[idx++]
      const holdRes = results[idx++]

      if (custs) {
        setCustomers(custs.map((c: any) => ({
          id: c.customer_id,
          name: c.name,
          phone: c.phone,
          loyalty_points: Number(c.loyalty_points || 0),
          loyalty_tier: c.loyalty_tier || 'Bronze'
        })))
      }
      if (unpCount !== undefined) setUnpaidOrdersCount(unpCount || 0)
      if (lSettings) setLoyaltySettings(lSettings)
      if (posSettingsRes?.settings) setPriceGuardSettings(posSettingsRes.settings)
      if (holdRes?.heldOrders) setHeldOrders(holdRes.heldOrders)

      if (needAccounts) {
        const accs = results[idx++]?.data
        if (accs) setAccounts(accs)
      }
      if (needRegisters) {
        const regs = results[idx++]?.data
        if (regs) setPosRegisters(regs)
      }
      if (needShift) {
        const shiftData = results[idx++]
        if (shiftData?.activeShift) setActiveShift(shiftData.activeShift)
      }

      // Pre-warm daily POS counter for 0ms optimistic order generation
      try {
        const now = new Date()
        const tz = getBusinessTimezone(activeBusiness?.timezone)
        let dStr = ''
        try {
          const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
          dStr = formatter.format(now).replace(/-/g, '')
        } catch {
          dStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
        }
        const cKey = `shapeup_pos_counter_${bId}_${dStr}`
        supabase
          .from('orders')
          .select('order_number')
          .eq('business_id', bId)
          .like('order_number', `POS-${dStr}-%`)
          .order('order_number', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.order_number) {
              const suffix = data.order_number.replace(`POS-${dStr}-`, '')
              const num = parseInt(suffix, 10)
              if (!isNaN(num)) {
                const cur = parseInt(localStorage.getItem(cKey) || '0', 10)
                if (num > cur) {
                  localStorage.setItem(cKey, String(num))
                }
              }
            }
          }, () => null)
      } catch {}
    } catch (err) {
      console.warn('[POSWorkspace] Secondary data load warning:', err)
    }
  }, [accounts.length, posRegisters.length, activeShift, preloadedSession])

  useEffect(() => {
    if (!bizLoading && activeBusiness?.id) {
      setBusinessId(activeBusiness.id)
      if (ctxProfile) setUserProfile(ctxProfile)
      loadSecondaryData(activeBusiness.id)
    }
  }, [bizLoading, activeBusiness?.id, ctxProfile, loadSecondaryData])

  const checkActiveShift = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/shifts')
      if (res.ok) {
        const data = await res.json()
        setActiveShift(data.activeShift)
      }
    } catch (e) {
      console.warn('Could not fetch active shift:', e)
    }
  }, [])

  const refreshAllPOSData = useCallback(async () => {
    if (!businessId) return
    await Promise.all([
      refreshCatalog(),
      loadSecondaryData(businessId)
    ])
  }, [businessId, refreshCatalog, loadSecondaryData])

  // Smart Exact-Match vs Tokenized Matches Separation (Option B: Smart Focus with Expansion)
  const { exactMatches, otherMatches, hasExactMatch } = useMemo(() => {
    const list = Array.isArray(products) ? products : []
    const rawQ = (debouncedSearch || '').trim()
    const cleanQ = rawQ.toLowerCase().replace(/\s+/g, ' ')

    if (!cleanQ) {
      const baseList = selectedCategoryId
        ? list.filter((p) => p && p.category_id === selectedCategoryId)
        : list
      return { exactMatches: [], otherMatches: baseList, hasExactMatch: false }
    }

    const tokens = cleanQ.split(/\s+/).filter(Boolean)
    const exactList: any[] = []
    const otherList: any[] = []

    for (const p of list) {
      if (!p) continue
      if (selectedCategoryId && p.category_id !== selectedCategoryId) continue

      const pName = (p.name || '').trim().toLowerCase().replace(/\s+/g, ' ')
      const pSku = (p.sku || '').trim().toLowerCase()
      const variants = Array.isArray(p.product_variants) ? p.product_variants : []

      // Check Exact SKU Match (Case A) or Exact Name Match (Case B - min 2 chars)
      const isExactSku = pSku === cleanQ || variants.some((v: any) => (v?.sku || '').trim().toLowerCase() === cleanQ)
      const isExactName = cleanQ.length >= 2 && pName === cleanQ

      if (isExactSku || isExactName) {
        exactList.push({ ...p, _isExactMatch: true })
        continue
      }

      // Check Tokenized Substring Match
      const variantTexts = variants.map((v: any) => `${(v?.name || '').toLowerCase()} ${(v?.sku || '').toLowerCase()}`)
      const isTokenMatch = tokens.every((t) =>
        pName.includes(t) ||
        pSku.includes(t) ||
        variantTexts.some((vt) => vt.includes(t))
      )

      if (isTokenMatch) {
        otherList.push({ ...p, _isExactMatch: false })
      }
    }

    return {
      exactMatches: exactList,
      otherMatches: otherList,
      hasExactMatch: exactList.length > 0
    }
  }, [products, debouncedSearch, selectedCategoryId])

  // Filtered Products: Collapsed to Exact Matches if present, unless user toggled expansion
  const filteredProducts = useMemo(() => {
    if (hasExactMatch && !showAllSimilarMatches) {
      return exactMatches
    }
    if (hasExactMatch && showAllSimilarMatches) {
      return [...exactMatches, ...otherMatches]
    }
    return otherMatches
  }, [hasExactMatch, showAllSimilarMatches, exactMatches, otherMatches])

  // Hybrid Server Search Fallback (Debounced 250ms jika hasil lokal < 5 dan belum ada exact match)
  useEffect(() => {
    const q = (debouncedSearch || '').trim()
    if (!q || q.length < 2) return

    // Jika sudah ada exact match, tidak perlu search server lagi
    if (hasExactMatch) return

    if (filteredProducts.length < 5) {
      setIsSearchingServer(true)
      searchProductsServer(q).finally(() => {
        setIsSearchingServer(false)
      })
    }
  }, [debouncedSearch, filteredProducts.length, hasExactMatch, searchProductsServer])

  // Windowed Products for DOM Performance (Pilar 4: DOM Windowing)
  useEffect(() => {
    setVisibleProductCount(60)
  }, [debouncedSearch, selectedCategoryId])

  const visibleProducts = useMemo(() => {
    return filteredProducts.slice(0, visibleProductCount)
  }, [filteredProducts, visibleProductCount])

  const handleCatalogScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 350) {
      setVisibleProductCount((prev) => {
        if (prev >= filteredProducts.length) return prev
        return Math.min(prev + 60, filteredProducts.length)
      })
    }
  }, [filteredProducts.length])

  // Cart Calculations
  const totalItemCount = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.quantity, 0)
  }, [cart])

  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.finalPrice * item.quantity, 0)
  }, [cart])

  const itemDiscountTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + (item.discount || 0) * item.quantity, 0)
  }, [cart])

  const globalDiscountAmount = useMemo(() => {
    const globalInputNumber = Number(globalDiscountInput) || 0
    if (globalInputNumber <= 0) return 0
    if (globalDiscountType === 'percent') {
      return Math.round((subtotal * Math.min(100, Math.max(0, globalInputNumber))) / 100)
    }
    return Math.min(subtotal, Math.max(0, globalInputNumber))
  }, [subtotal, globalDiscountType, globalDiscountInput])

  const discountAmount = useMemo(() => {
    return itemDiscountTotal + globalDiscountAmount
  }, [itemDiscountTotal, globalDiscountAmount])

  const grandTotal = useMemo(() => {
    return Math.max(0, subtotal - discountAmount)
  }, [subtotal, discountAmount])

  // Price Guard evaluation helpers
  const isItemGuarded = (item: any) => {
    if (!item?.product) return false
    if (priceGuardSettings.global_enabled) return true
    return Boolean(item.product.prevent_below_hpp)
  }

  const getItemCostPrice = (item: any) => {
    const varCost = Number(item?.selectedVariant?.cost_price || item?.selectedVariant?.costPrice || 0)
    const parentCost = Number(item?.product?.cost_price || item?.product?.costPrice || 0)
    const baseCost = varCost > 0 ? varCost : parentCost
    const modCost = Array.isArray(item?.selectedModifiers)
      ? item.selectedModifiers.reduce((sum: number, m: any) => sum + Number(m?.costPrice || m?.cost_price || 0), 0)
      : 0
    return baseCost + modCost
  }

  const isItemPriceViolation = (item: any) => {
    if (!isItemGuarded(item)) return false
    const cost = getItemCostPrice(item)
    if (cost <= 0) return false
    const netPrice = Math.max(0, Number(item.finalPrice || 0) - Number(item.discount || 0))
    return netPrice < cost
  }

  const validateCartGuards = (): { ok: boolean; reason?: string } => {
    // 1. Cek setiap item yang melanggar HPP
    for (let i = 0; i < cart.length; i++) {
      const item = cart[i]
      if (isItemPriceViolation(item)) {
        const hasAuth = authorizations.has(`item_${i}`) || Boolean(item.authorization)
        if (!hasAuth) {
          return {
            ok: false,
            reason: `Item "${item.product.name}" memiliki harga di bawah batas minimum dan memerlukan otorisasi.`,
          }
        }
      }
    }

    // 2. Cek diskon global jika diwajibkan otorisasi
    if (priceGuardSettings.require_global_discount_auth && globalDiscountAmount > 0) {
      const hasAuth = authorizations.has('global_discount')
      if (!hasAuth) {
        return {
          ok: false,
          reason: 'Penerapan diskon global keranjang memerlukan otorisasi persetujuan.',
        }
      }
    }

    return { ok: true }
  }

  // Product Tap Action
  const handleProductTap = (p: any) => {
    if (p.stock_type === 'unavailable') return

    // Printing / Area-based Dimension Products (Meter / CM persegi)
    const isDimensionProduct = p.pricing_type === 'area' || p.unit === 'm2' || p.unit === 'cm2'
    if (isDimensionProduct) {
      setSelectedProductForDimension(p)
      setEditingDimensionItemIndex(null)
      setIsDimensionModalOpen(true)
      return
    }

    const hasVariants = (Array.isArray(p.product_variants) && p.product_variants.length > 0) || p.has_variants
    const hasModifiers = (Array.isArray(p.product_modifiers) && p.product_modifiers.length > 0) || p.type === 'fnb'
    if (hasVariants || hasModifiers) {
      setSelectedProductForVariant(p)
      setIsVariantModalOpen(true)
    } else {
      const effectivePrice = resolvePosItemPrice(p, salesType, Number(p.price || 0))
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
          finalPrice: effectivePrice,
          discount: 0
        }]
      })
    }
  }

  const handleAddVariantItem = (itemData: any) => {
    const rawName = itemData.product.name
    const variantName = itemData.selectedVariant?.name
    const displayName = (variantName && !rawName.toLowerCase().includes(variantName.toLowerCase()))
      ? `${rawName} - ${variantName}`
      : rawName

    setCart((prev) => {
      const existingIdx = prev.findIndex((item) =>
        item.product.id === itemData.product.id &&
        item.selectedVariant?.id === itemData.selectedVariant?.id &&
        (item.note || '') === (itemData.note || '') &&
        JSON.stringify(item.selectedModifiers || []) === JSON.stringify(itemData.selectedModifiers || [])
      )

      if (existingIdx > -1) {
        const copy = [...prev]
        copy[existingIdx].quantity += 1
        return copy
      }

      return [
        ...prev,
        {
          product: {
            ...itemData.product,
            name: displayName,
            baseName: rawName
          },
          selectedVariant: itemData.selectedVariant,
          selectedModifiers: itemData.selectedModifiers,
          note: itemData.note,
          quantity: 1,
          finalPrice: itemData.finalPrice,
          discount: 0
        }
      ]
    })
  }

  const handleAddDimensionItem = (itemData: any) => {
    setCart((prev) => {
      // If editing an existing item in cart
      if (
        editingDimensionItemIndex !== null &&
        editingDimensionItemIndex >= 0 &&
        editingDimensionItemIndex < prev.length
      ) {
        const copy = [...prev]
        copy[editingDimensionItemIndex] = {
          ...copy[editingDimensionItemIndex],
          product: itemData.product,
          selectedVariant: itemData.selectedVariant,
          quantity: itemData.quantity,
          finalPrice: itemData.finalPrice,
          note: itemData.note,
          dimension_spec: itemData.dimension_spec,
          selectedModifiers: itemData.selectedModifiers
        }
        return copy
      }

      // Check if identical dimension item already exists
      const existingIdx = prev.findIndex((item) =>
        item.product.id === itemData.product.id &&
        item.selectedVariant?.id === itemData.selectedVariant?.id &&
        item.dimension_spec?.length === itemData.dimension_spec?.length &&
        item.dimension_spec?.width === itemData.dimension_spec?.width &&
        item.dimension_spec?.input_unit === itemData.dimension_spec?.input_unit &&
        (item.note || '') === (itemData.note || '') &&
        JSON.stringify(item.selectedModifiers || []) === JSON.stringify(itemData.selectedModifiers || [])
      )

      if (existingIdx > -1) {
        const copy = [...prev]
        copy[existingIdx].quantity += itemData.quantity
        return copy
      }

      return [
        ...prev,
        {
          product: itemData.product,
          selectedVariant: itemData.selectedVariant,
          quantity: itemData.quantity,
          finalPrice: itemData.finalPrice,
          discount: 0,
          note: itemData.note,
          dimension_spec: itemData.dimension_spec,
          selectedModifiers: itemData.selectedModifiers
        }
      ]
    })
    setEditingDimensionItemIndex(null)
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
    if (editingCartItemIndex === index) setEditingCartItemIndex(null)
  }

  const handleUpdateItemPriceDiscount = (index: number, newPrice: number, newDiscount: number) => {
    setCart((prev) => {
      const copy = [...prev]
      copy[index] = {
        ...copy[index],
        finalPrice: newPrice,
        discount: newDiscount
      }
      return copy
    })
  }

  const handleSaveItemNote = (index: number, newNote: string) => {
    setCart((prev) => {
      const copy = [...prev]
      if (copy[index]) {
        copy[index] = {
          ...copy[index],
          note: newNote
        }
      }
      return copy
    })
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
  const handleSaveHoldOrder = async (shouldPrint = false) => {
    if (cart.length === 0) return
    const currentTargetHoldId = activeHoldId
    try {
      const effectiveOrderNote = orderNote.trim() || undefined
      const res = await fetch('/api/pos/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          hold_id: currentTargetHoldId || null,
          customer_id: selectedCustomer?.id || null,
          customer_name: selectedCustomer?.name || 'Walk-in',
          cart_json: cart,
          total_items: cart.length,
          grand_total: grandTotal,
          note: effectiveOrderNote
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal menahan transaksi.')
      }
      if (data?.heldOrder) {
        setHeldOrders((prev) => {
          if (currentTargetHoldId && prev.some((h) => h.id === currentTargetHoldId)) {
            return prev.map((h) => (h.id === currentTargetHoldId ? data.heldOrder : h))
          }
          return [data.heldOrder, ...prev]
        })

        if (shouldPrint) {
          handlePrintHoldOrder(data.heldOrder)
        }

        // Auto-print kitchen ticket if enabled in settings and POS is in F&B mode
        if (posMode.enableProductionTickets) {
          const rSettings = getStoredReceiptSettings(activeBusiness?.name)
          const kSettings = getStoredKitchenSettings(rSettings.paperSize)
          if (kSettings.enabled && kSettings.autoPrintOnHold) {
            handlePrintKitchenFromHeldOrder(data.heldOrder, true)
          }
        }
      }
      setActiveHoldId(null)
      setCart([])
      setSelectedCustomer(null)
      setOrderNote('')
      setIsMobileCartOpen(false)
    } catch (e: any) {
      console.error('Failed to hold order:', e)
      alert(e.message || 'Gagal menahan transaksi.')
    }
  }

  const handlePrintHoldOrder = useCallback((heldOrder: any) => {
    const rData = buildHoldOrderReceiptData(heldOrder, {
      businessName: activeBusiness?.name,
      cashierName: activeShift?.cashier_name || userProfile?.full_name || 'Kasir',
      timezone: activeBusiness?.timezone
    })
    setPreviewReceipt(rData)
    setIsPreviewReceiptOpen(true)
  }, [activeBusiness, activeShift, userProfile])

  const handlePrintHeldOrdersSummary = useCallback((orders: any[]) => {
    const rData = buildHeldOrdersSummaryReceiptData(orders, {
      businessName: activeBusiness?.name,
      cashierName: activeShift?.cashier_name || userProfile?.full_name || 'Kasir',
      timezone: activeBusiness?.timezone
    })
    setPreviewReceipt(rData)
    setIsPreviewReceiptOpen(true)
  }, [activeBusiness, activeShift, userProfile])

  // Kitchen Production Printing (from Cart directly)
  const handlePrintKitchenFromCart = useCallback(() => {
    if (!cart || cart.length === 0) return

    const rSettings = getStoredReceiptSettings(activeBusiness?.name)
    const kSettings = getStoredKitchenSettings(rSettings.paperSize)
    const effectiveNote = orderNote.trim() || undefined

    const tickets = buildKitchenTicketsFromItems(
      cart,
      {
        orderNumber: activeHoldId ? `#HLD-${activeHoldId.slice(0, 6).toUpperCase()}` : 'POS-DRAFT',
        customerName: selectedCustomer?.name || 'Walk-in',
        orderNote: effectiveNote,
        createdAt: new Date(),
        orderType: 'DINE-IN'
      },
      {
        businessName: activeBusiness?.name,
        settings: kSettings,
        fallbackPaperSize: rSettings.paperSize,
        cashierName: activeShift?.cashier_name || userProfile?.full_name || 'Kasir',
        ticketKind: activeHoldId ? 'HOLD' : 'NEW'
      }
    )

    if (tickets.length === 0) {
      alert('Tidak ada item menu untuk dicetak ke dapur.')
      return
    }

    setKitchenPreviewTickets(tickets)
    setIsKitchenPreviewOpen(true)
  }, [cart, orderNote, activeHoldId, selectedCustomer, activeBusiness, activeShift, userProfile])

  // Kitchen Production Printing (from Held Order)
  const handlePrintKitchenFromHeldOrder = useCallback(async (heldOrder: any, isAuto = false) => {
    if (!heldOrder) return

    let rawItems: any[] = []
    if (Array.isArray(heldOrder.cart_json)) {
      rawItems = heldOrder.cart_json
    } else if (typeof heldOrder.cart_json === 'string') {
      try {
        const parsed = JSON.parse(heldOrder.cart_json)
        if (Array.isArray(parsed)) rawItems = parsed
      } catch {
        rawItems = []
      }
    }

    if (rawItems.length === 0) return

    const rSettings = getStoredReceiptSettings(activeBusiness?.name)
    const kSettings = getStoredKitchenSettings(rSettings.paperSize)
    const effectiveNote = (heldOrder.note || '').trim() || undefined

    const tickets = buildKitchenTicketsFromItems(
      rawItems,
      {
        orderNumber: `#HLD-${(heldOrder.id || '').slice(0, 6).toUpperCase()}`,
        customerName: heldOrder.customer_name || 'Walk-in',
        orderNote: effectiveNote,
        createdAt: heldOrder.created_at || new Date(),
        orderType: 'DINE-IN'
      },
      {
        businessName: activeBusiness?.name,
        settings: kSettings,
        fallbackPaperSize: rSettings.paperSize,
        cashierName: activeShift?.cashier_name || userProfile?.full_name || 'Kasir',
        ticketKind: 'HOLD'
      }
    )

    if (tickets.length === 0) return

    if (isAuto) {
      void dispatchAllKitchenTickets(tickets, rSettings.connectionType, kSettings)
    } else {
      setKitchenPreviewTickets(tickets)
      setIsKitchenPreviewOpen(true)
    }
  }, [activeBusiness, activeShift, userProfile])

  const handleResumeHoldOrder = (h: any) => {
    if (h.cart_json && Array.isArray(h.cart_json)) {
      setCart(h.cart_json)
    }
    if (h.customer_id) {
      setSelectedCustomer({ id: h.customer_id, name: h.customer_name })
    } else {
      setSelectedCustomer(null)
    }
    if (h.note) {
      setOrderNote(h.note)
    } else {
      setOrderNote('')
    }
    setActiveHoldId(h.id)
  }

  const handleDeleteHoldOrder = async (holdId: string) => {
    try {
      setHeldOrders((prev) => prev.filter((h) => h.id !== holdId))
      if (activeHoldId === holdId) {
        setActiveHoldId(null)
      }
      await fetch('/api/pos/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', hold_id: holdId })
      })
    } catch (e) {
      console.error('Failed to delete held order:', e)
    }
  }

  // Shift Actions
  const handleOpenShift = async (initialCash: number, note: string, sourceAccountCode: string, registerId?: string | null) => {
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', initial_cash: initialCash, note, source_account_code: sourceAccountCode, register_id: registerId || null })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Gagal membuka shift')
    setActiveShift(data.shift)
  }

  const handleCloseShift = async (shiftId: string, actualCash: number, note: string, targetAccountCode: string) => {
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', shift_id: shiftId, actual_cash: actualCash, note, target_account_code: targetAccountCode })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Gagal menutup shift')
    setActiveShift(null)
  }

  // Synchronous Optimistic Counter Generator (0ms)
  const getNextOptimisticOrderNumber = (bId: string, tz?: string) => {
    const timezone = getBusinessTimezone(tz)
    const now = new Date()
    let dStr = ''
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      dStr = formatter.format(now).replace(/-/g, '')
    } catch {
      dStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    }

    const counterKey = `shapeup_pos_counter_${bId}_${dStr}`
    let nextVal = 1
    try {
      const cur = parseInt(localStorage.getItem(counterKey) || '0', 10)
      nextVal = cur + 1
      localStorage.setItem(counterKey, String(nextVal))
    } catch {
      nextVal = 1
    }

    const orderNumber = `POS-${dStr}-${String(nextVal).padStart(4, '0')}`
    return { orderNumber, queueNumber: nextVal, counterKey }
  }

  // Checkout Execution (0ms Instant Optimistic Action)
  const handleConfirmCheckout = (paymentInfo: PaymentResult) => {
    try {
      const itemsPayload = cart.map((item) => ({
        id: item.product.id,
        name: item.product.name,
        price: item.finalPrice,
        quantity: item.quantity,
        discount: item.discount || 0,
        variantId: item.selectedVariant?.id,
        variantName: item.selectedVariant?.name,
        costPrice: Number(
          item.selectedVariant?.cost_price ??
          item.selectedVariant?.costPrice ??
          item.product?.cost_price ??
          0
        ),
        modifiers: item.selectedModifiers,
        note: item.note,
        dimension_spec: item.dimension_spec
      }))

      const effectiveOrderNote = orderNote.trim() || undefined
      const effectiveCustomerId = selectedCustomer?.id || 'guest'

      // 1. Instant Optimistic Order Number & Queue Number Generation (0ms)
      const { orderNumber: optimisticOrderNumber, queueNumber: optimisticQueueNumber, counterKey } =
        getNextOptimisticOrderNumber(activeBusiness?.id || 'default', activeBusiness?.timezone)

      const paymentTitle = paymentInfo.isPartial 
        ? `Sebagian / Sisa Piutang (Rp ${paymentInfo.amountPaid.toLocaleString('id-ID')})`
        : (paymentInfo.method === 'split' 
            ? 'Split Kas & Bank' 
            : (paymentInfo.payments[0]?.account_name || (paymentInfo.method === 'cash' ? 'Tunai (Cash)' : paymentInfo.method === 'qris' ? 'QRIS' : 'Transfer/Kartu')))

      // Read stored receipt settings synchronously (0ms)
      const defaultStoreTitle = activeBusiness?.name || (userProfile?.full_name ? `${userProfile.full_name}'s Store` : 'ShapeUp POS')
      const rSettings = getStoredReceiptSettings(defaultStoreTitle)

      // Calculate loyalty points synchronously in memory (0ms)
      let loyaltyInfo = undefined
      if (
        rSettings.showLoyaltyPoints &&
        loyaltySettings?.is_enabled &&
        selectedCustomer &&
        selectedCustomer.id &&
        selectedCustomer.id !== 'guest'
      ) {
        const tiers = (loyaltySettings.tiers as LoyaltyTier[]) || DEFAULT_LOYALTY_SETTINGS.tiers
        const currentPoints = Number(selectedCustomer.loyalty_points || 0)
        const currentTier = resolveTier(currentPoints, tiers)
        const pointsEarned = calculateEarnedPoints(grandTotal, loyaltySettings, currentTier.multiplier || 1.0)
        const newBalance = currentPoints + pointsEarned
        loyaltyInfo = {
          tierName: currentTier.name,
          tierBadge: currentTier.badge_icon,
          pointsEarned: pointsEarned > 0 ? pointsEarned : undefined,
          currentBalance: newBalance
        }
      }

      // 2. Build Receipt immediately (Reality First: 0ms Latency via SSOT Builder)
      const receipt = buildReceiptDataFromOrder({
        order_number: optimisticOrderNumber,
        queue_number: optimisticQueueNumber,
        created_at: new Date().toISOString(),
        items: cart.map((i) => ({
          name: i.product.name,
          variant: i.selectedVariant?.name,
          quantity: i.quantity,
          price: i.finalPrice,
          subtotal: i.finalPrice * i.quantity,
          discount: i.discount,
          note: i.note,
          dimension_spec: i.dimension_spec
        })),
        customer: selectedCustomer,
        subtotal: subtotal,
        discount_amount: discountAmount,
        grand_total: grandTotal,
        payment_method: paymentTitle,
        amount_paid: paymentInfo.amountPaid,
        payments: paymentInfo.payments,
        order_note: effectiveOrderNote
      }, {
        businessName: defaultStoreTitle,
        settings: rSettings,
        cashierName: userProfile?.full_name || 'Kasir',
        timezone: activeBusiness?.timezone,
        loyaltyInfo: loyaltyInfo,
        cashReceived: paymentInfo.cashReceived,
        changeAmount: paymentInfo.changeAmount
      })

      // 3. Instant Optimistic Action (0ms Latency for Customer & Cashier)
      setLastCreatedOrderId(null)
      setReceiptData(receipt)
      setIsPaymentModalOpen(false)
      setIsMobileCartOpen(false)
      setIsReceiptModalOpen(true)
      
      // Optimistic local stock mutation in L1/L2 cache (Pilar 2 & 5)
      if (typeof updateLocalStock === 'function') {
        updateLocalStock(
          itemsPayload.map((it: any) => ({
            productId: it.id,
            variantId: it.variantId,
            quantity: it.quantity
          }))
        )
      }

      setCart([])
      setSelectedCustomer(null)
      setGlobalDiscountInput('')
      setOrderNote('')
      setAuthorizations(new Map())
      setCheckingOut(false)

      // Auto-cleanup held draft if order completed from a resumed hold
      if (activeHoldId) {
        const completedHoldId = activeHoldId
        setActiveHoldId(null)
        setHeldOrders((prev) => prev.filter((h) => h.id !== completedHoldId))
        fetch('/api/pos/hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', hold_id: completedHoldId })
        }).catch((err) => console.error('[POS] Failed to cleanup completed hold:', err))
      }

      // 4. Background Sync (Fire-and-Forget without delaying the user)
      fetch('/api/pos/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: effectiveCustomerId,
          items: itemsPayload,
          payment_method: paymentInfo.method,
          payments: paymentInfo.payments,
          amount_paid: paymentInfo.amountPaid,
          subtotal: subtotal,
          discount_amount: discountAmount,
          grand_total: grandTotal,
          order_number: optimisticOrderNumber,
          cash_received: paymentInfo.cashReceived,
          change_amount: paymentInfo.changeAmount,
          shift_id: activeShift?.id || null,
          register_id: activeShift?.register_id || null,
          order_note: effectiveOrderNote,
          authorizations: Array.from(authorizations.values())
        })
      })
      .then(async (res) => {
        const result = await res.json().catch(() => null)
        if (!res.ok) {
          console.error(`[POS Sync Error] Pesanan #${optimisticOrderNumber} gagal tersimpan:`, result?.error)
          alert(`⚠️ Peringatan: Pesanan #${optimisticOrderNumber} gagal disimpan ke server.\nPesan: ${result?.error || 'Server error'}`)
        } else if (result?.order_id) {
          setLastCreatedOrderId(result.order_id)
          // Seamless in-place reconciliation if server adjusted the order number
          if (result.order_number && result.order_number !== optimisticOrderNumber) {
            setReceiptData((prev) => prev ? {
              ...prev,
              orderNumber: result.order_number,
              queueNumber: result.queue_number || prev.queueNumber
            } : null)
          }
          if (result.queue_number) {
            const cur = parseInt(localStorage.getItem(counterKey) || '0', 10)
            if (result.queue_number > cur) {
              localStorage.setItem(counterKey, String(result.queue_number))
            }
          }
        }
      })
      .catch((err) => {
        console.error(`[POS Sync Error] Koneksi terputus untuk pesanan #${optimisticOrderNumber}:`, err)
        alert(`⚠️ Peringatan: Koneksi terputus. Pesanan #${optimisticOrderNumber} gagal dikirim ke server.`)
      })
    } catch (err: any) {
      alert(err.message || 'Terjadi kesalahan pada aplikasi kasir.')
      setCheckingOut(false)
    }
  }

  // Render Inner Cart Component (reusable for Desktop sidebar & Mobile bottom sheet)
  const renderCartContent = () => (
    <div className="flex flex-col h-full w-full bg-white">
      {/* Customer Header */}
      <div className="p-3 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-2 min-w-0">
        <div className="relative flex-1 min-w-0">
          <button
            onClick={() => setIsCustomerDropdownOpen(!isCustomerDropdownOpen)}
            className="w-full py-2 px-2.5 rounded-xl border border-slate-200 bg-white text-left text-xs flex items-center justify-between hover:border-indigo-300 transition shadow-2xs min-w-0"
          >
            <span className="font-semibold text-slate-800 truncate">
              👤 {selectedCustomer ? selectedCustomer.name : 'Walk-in Customer'}
            </span>
            <span className="text-[10px] text-slate-400 ml-1 shrink-0">▼</span>
          </button>

          {isCustomerDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-2xl shadow-xl z-30 p-2.5 space-y-2">
              <input
                type="text"
                placeholder="Cari nama atau No. HP (08... / 628...)..."
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
                {filteredPosCustomers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer(c)
                      setIsCustomerDropdownOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-100 rounded-xl text-xs text-slate-800 flex justify-between items-center gap-2"
                  >
                    <span className="font-semibold truncate">{c.name}</span>
                    <span className="text-slate-400 font-mono text-[10px] shrink-0">{c.phone}</span>
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
            onClick={() => {
              setCart([])
              setActiveHoldId(null)
              setSelectedCustomer(null)
              setOrderNote('')
            }}
            className="text-xs text-rose-600 hover:text-rose-800 font-semibold px-2 py-1 rounded-lg hover:bg-rose-50 transition shrink-0 whitespace-nowrap"
          >
            Kosongkan
          </button>
        )}
      </div>

      {/* Sales Type Switcher (Dine In / Take Away / Basic) — Shown strictly in F&B POS mode */}
      {showSalesTypeSwitcher && (
        <div className="px-2.5 py-1.5 border-b border-slate-100 bg-white flex items-center gap-1 shrink-0">
          <div className="grid grid-cols-3 gap-1 w-full bg-slate-100 p-0.5 rounded-xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => handleSalesTypeChange('dine_in')}
              className={`py-1 px-2 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                salesType === 'dine_in'
                  ? 'bg-white text-indigo-700 shadow-2xs ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>🍽️</span>
              <span>Dine In</span>
            </button>
            <button
              type="button"
              onClick={() => handleSalesTypeChange('take_away')}
              className={`py-1 px-2 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                salesType === 'take_away'
                  ? 'bg-white text-emerald-700 shadow-2xs ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>🛍️</span>
              <span>Take Away</span>
            </button>
            <button
              type="button"
              onClick={() => handleSalesTypeChange('basic')}
              className={`py-1 px-2 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                salesType === 'basic'
                  ? 'bg-white text-slate-800 shadow-2xs ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>📌</span>
              <span>Umum</span>
            </button>
          </div>
        </div>
      )}

      {activeHoldId && (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200/70 flex items-center justify-between text-xs text-amber-900 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">📥</span>
            <span className="font-semibold text-[11px]">Mengedit Draft Hold</span>
          </div>
          <button
            type="button"
            onClick={() => setActiveHoldId(null)}
            className="text-[10px] text-amber-700 hover:text-amber-950 font-bold underline cursor-pointer"
            title="Lepas tautan draft agar disimpan sebagai transaksi hold baru"
          >
            Lepas Tautan
          </button>
        </div>
      )}

      {/* Cart Item List (Moka-style Clean Receipt Rows) */}
      <div className="flex-1 overflow-y-auto p-1 divide-y divide-slate-100">
        {cart.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-3xl mx-auto mb-3">
              🛒
            </div>
            <p className="font-semibold text-slate-700">Keranjang belanja kosong</p>
            <p className="text-[11px] text-slate-400 mt-1">Klik item pada katalog untuk menambahkan ke pesanan.</p>
          </div>
        ) : (
          cart.map((item, idx) => {
            const originalUnitPrice = Number(
              item.selectedVariant?.price ?? item.product?.price ?? item.finalPrice
            )
            const originalTotal = originalUnitPrice * item.quantity
            const netItemPrice = Math.max(0, item.finalPrice - (item.discount || 0))
            const itemTotal = netItemPrice * item.quantity
            const isPriceChanged = originalTotal > itemTotal

            return (
              <div 
                key={idx} 
                onClick={() => setEditingCartItemIndex(idx)}
                className="py-2.5 px-2.5 sm:px-3 hover:bg-slate-50/80 transition cursor-pointer flex flex-col gap-1.5 group text-xs select-none"
                title="Ketuk baris untuk ubah kuantitas, harga, diskon, atau catatan"
              >
                {/* Top Row: Product Info on Left, Qty + Price + Pencil on Right */}
                <div className="flex items-start justify-between gap-1.5 min-w-0">
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <h5 className="font-semibold text-slate-800 text-xs line-clamp-2 leading-tight group-hover:text-blue-600 transition break-words">
                        {item.product.name}
                      </h5>
                      {item.selectedVariant && (
                        <span className="text-[10px] text-blue-700 bg-blue-50 font-bold px-1.5 py-0.2 rounded shrink-0">
                          {item.selectedVariant.name}
                        </span>
                      )}
                      {Array.isArray(item.selectedModifiers) && item.selectedModifiers.map((mod: any, mIdx: number) => (
                        <span key={mIdx} className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200/80 font-bold px-1.5 py-0.2 rounded shrink-0">
                          ✨ {mod.name}{mod.priceExtra > 0 ? ` (+${mod.priceExtra.toLocaleString('id-ID')})` : ''}
                        </span>
                      ))}
                      {item.dimension_spec && (
                        <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 font-bold px-1.5 py-0.2 rounded shrink-0">
                          📐 {item.dimension_spec.length}×{item.dimension_spec.width} {item.dimension_spec.input_unit} ({item.dimension_spec.billable_area} {item.dimension_spec.area_unit})
                        </span>
                      )}
                      {isItemPriceViolation(item) && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          authorizations.has(`item_${idx}`) || item.authorization
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                            : 'bg-amber-50 text-amber-800 border border-amber-300 animate-pulse'
                        }`}>
                          {authorizations.has(`item_${idx}`) || item.authorization ? '✅ Diotorisasi' : '⚠️ Batas Harga'}
                        </span>
                      )}
                    </div>

                    {/* Sub-line: Unit Price & Discount */}
                    {(item.quantity > 1 || item.discount > 0 || item.dimension_spec) && (
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                        {item.dimension_spec ? (
                          <span className="font-semibold text-indigo-700">
                            @Rp {netItemPrice.toLocaleString('id-ID')} / lembar ({item.dimension_spec.billable_area} {item.dimension_spec.area_unit})
                          </span>
                        ) : (
                          item.quantity > 1 && (
                            <span className="font-medium text-slate-600">@Rp {netItemPrice.toLocaleString('id-ID')}</span>
                          )
                        )}
                        {item.discount > 0 && (
                          <span className="text-rose-600 font-semibold">
                            Disc -Rp {item.discount.toLocaleString('id-ID')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Quantity (x N), Subtotal (dengan harga coret jika berubah) & Pencil Indicator */}
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    <span className="text-xs font-semibold text-slate-500 min-w-[20px] text-right">
                      x{item.quantity}
                    </span>
                    <div className="flex flex-col items-end min-w-[62px]">
                      {isPriceChanged && (
                        <span className="text-[10px] text-slate-400 line-through leading-tight">
                          Rp {originalTotal.toLocaleString('id-ID')}
                        </span>
                      )}
                      <span className={`font-bold text-xs ${isPriceChanged ? 'text-rose-600' : 'text-slate-900'} whitespace-nowrap leading-tight`}>
                        Rp {itemTotal.toLocaleString('id-ID')}
                      </span>
                    </div>
                    <span className="text-slate-300 group-hover:text-blue-600 transition text-xs shrink-0" title="Edit Item">
                      ✏️
                    </span>
                  </div>
                </div>

                {/* Bottom Row: Full-width Item Note (Never Truncated, Auto-Wrap) */}
                {item.note && (
                  <div className="w-full bg-amber-50/90 border border-amber-200/80 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-900 leading-relaxed break-words whitespace-normal flex items-start gap-1.5 shadow-2xs">
                    <span className="text-xs shrink-0 mt-0.5">💬</span>
                    <span className="italic flex-1 break-words">{item.note}</span>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Cart Summary & Checkout Footer (Moka-style Clean Receipt Bill) */}
      <div className="p-2.5 sm:p-3 border-t border-slate-200 bg-white space-y-2 shrink-0 shadow-lg min-w-0">
        {/* Bill Summary Rows */}
        <div className="space-y-1.5 sm:space-y-2 text-xs">
          {/* Order Note (Shopee / Meja / Dapur) */}
          <div className="flex justify-between items-center text-slate-600 gap-1.5 min-w-0">
            <span className="font-medium text-slate-600 flex items-center gap-1.5 shrink-0">
              <span>📝</span>
              <span>Catatan</span>
            </span>
            {orderNote ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setIsOrderNoteModalOpen(true)}
                  className="font-semibold text-amber-900 bg-amber-50 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border border-amber-200 text-xs hover:bg-amber-100 transition truncate max-w-[130px] cursor-pointer"
                  title="Klik untuk ubah catatan pesanan"
                >
                  "{orderNote}"
                </button>
                <button
                  type="button"
                  onClick={() => setOrderNote('')}
                  className="text-amber-600 hover:text-rose-600 font-bold text-xs p-1 cursor-pointer"
                  title="Hapus Catatan"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsOrderNoteModalOpen(true)}
                className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 font-semibold rounded-lg text-xs transition flex items-center gap-1 cursor-pointer shrink-0"
              >
                <span>+ Catatan</span>
              </button>
            )}
          </div>

          {/* Global Discount */}
          <div className="flex justify-between items-center text-slate-600 gap-1.5 min-w-0">
            <span className="font-medium text-slate-600 flex items-center gap-1.5 shrink-0">
              <span>🏷️</span>
              <span>Diskon</span>
            </span>
            {globalDiscountAmount > 0 ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setIsDiscountModalOpen(true)}
                  className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border border-emerald-200 text-xs hover:bg-emerald-100 transition cursor-pointer truncate max-w-[130px]"
                  title="Klik untuk ubah diskon global"
                >
                  -Rp {globalDiscountAmount.toLocaleString('id-ID')} {globalDiscountType === 'percent' && `(${globalDiscountInput}%)`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGlobalDiscountInput('')
                    setAuthorizations((prev) => {
                      const copy = new Map(prev)
                      copy.delete('global_discount')
                      return copy
                    })
                  }}
                  className="text-emerald-600 hover:text-rose-600 font-bold text-xs p-1 cursor-pointer shrink-0"
                  title="Hapus Diskon Global"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsDiscountModalOpen(true)}
                className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold rounded-lg text-xs transition flex items-center gap-1 cursor-pointer shadow-2xs shrink-0"
              >
                <span>+ Diskon</span>
              </button>
            )}
          </div>

          {/* Subtotal */}
          <div className="flex justify-between items-center text-slate-600 pt-1 border-t border-slate-100">
            <span>Sub-Total ({totalItemCount} item)</span>
            <span className="font-bold text-slate-800">Rp {subtotal.toLocaleString('id-ID')}</span>
          </div>
        </div>

        {/* Action Buttons: Hold + Pay with Total */}
        <div className="flex items-center gap-1.5 sm:gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => {
              const check = validateCartGuards()
              if (!check.ok) {
                alert(`⚠️ ${check.reason}`)
                return
              }
              handleSaveHoldOrder()
            }}
            disabled={cart.length === 0}
            className={`py-2 sm:py-2.5 px-2.5 sm:px-3 border font-bold rounded-xl text-xs transition disabled:opacity-40 active:scale-95 shrink-0 flex items-center gap-1 cursor-pointer ${
              activeHoldId
                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 shadow-2xs'
                : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
            }`}
            title={activeHoldId ? 'Perbarui Transaksi Ditahan (Update Hold)' : 'Simpan Pesanan Sementara (Hold)'}
          >
            <span>⏸️</span>
            <span>{activeHoldId ? 'Update' : 'Hold'}</span>
          </button>
          {posMode.enableProductionTickets && (
            <button
              type="button"
              onClick={handlePrintKitchenFromCart}
              disabled={cart.length === 0}
              className="py-2 sm:py-2.5 px-2.5 sm:px-3 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold rounded-xl text-xs transition disabled:opacity-40 active:scale-95 shrink-0 flex items-center gap-1 cursor-pointer shadow-2xs"
              title="Kirim Instruksi &amp; Cetak Nota Dapur / Bar"
            >
              <span>🍳</span>
              <span>Dapur</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!activeShift) {
                setIsShiftModalOpen(true)
                return
              }
              const check = validateCartGuards()
              if (!check.ok) {
                alert(`⚠️ ${check.reason}`)
                return
              }
              setIsPaymentModalOpen(true)
            }}
            disabled={cart.length === 0}
            className={`flex-1 min-w-0 py-2.5 sm:py-3 px-3 sm:px-3.5 font-extrabold rounded-xl text-xs sm:text-sm transition shadow-md active:scale-[0.99] disabled:opacity-40 disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none flex items-center justify-between gap-1 text-white cursor-pointer ${
              !activeShift
                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-500/20'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-blue-500/25'
            }`}
          >
            <span className="truncate">{!activeShift ? 'Buka Shift Dulu 🔑' : 'Bayar'}</span>
            <span className="font-black bg-blue-800/50 text-white px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-xs sm:text-sm tracking-tight shrink-0 whitespace-nowrap">
              Rp {grandTotal.toLocaleString('id-ID')} →
            </span>
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div
      className="h-[100dvh] max-h-[100dvh] w-full max-w-full flex flex-col bg-slate-100 text-slate-900 overflow-hidden font-sans fixed inset-0 overscroll-none"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        overscrollBehavior: 'none'
      }}
    >
      {/* Top Navbar Header */}
      <header className="h-14 bg-slate-900 text-white px-3 sm:px-4 flex items-center justify-between shrink-0 shadow-md z-20 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 truncate">
          {onBackToHub ? (
            <button
              onClick={() =>
                onBackToHub({
                  activeShift,
                  cashierName: userProfile?.full_name || 'Kasir',
                  accounts,
                  posRegisters
                })
              }
              className="px-2.5 py-1 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 hover:text-white border border-indigo-700/60 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm shrink-0"
              title="Kembali ke Hub Kasir"
            >
              <span>←</span> <span>Hub Kasir</span>
            </button>
          ) : (
            <Link
              href="/dashboard"
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition shrink-0"
            >
              <span>←</span> <span className="hidden sm:inline">CRM</span>
            </Link>
          )}
          <div className="h-4 w-px bg-slate-700 hidden sm:block shrink-0"></div>
          <div className="flex items-center gap-2 min-w-0 truncate">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 text-white font-black flex items-center justify-center text-xs shadow-md shrink-0">
              POS
            </div>
            <div className="min-w-0 truncate">
              <h1 className="font-bold text-sm leading-tight text-white truncate">{userProfile?.full_name ? `${userProfile.full_name}'s POS` : 'ShapeUp POS'}</h1>
              <p className="text-[10px] text-slate-400 leading-none truncate">Workspace Transaksi Kasir</p>
            </div>
          </div>
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setIsShiftModalOpen(true)}
            className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition shrink-0 ${
              activeShift
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                : 'bg-amber-950/80 text-amber-300 border-amber-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${activeShift ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
            <span className="hidden md:inline">{activeShift ? `Shift: ${activeShift.cashier_name}` : 'Buka Shift'}</span>
            <span className="md:hidden">{activeShift ? 'Shift' : 'Buka'}</span>
          </button>

          <button
            onClick={() => setIsHoldModalOpen(true)}
            className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition relative shrink-0"
          >
            <span>📥</span>
            <span className="hidden sm:inline">Draft</span>
            {heldOrders.length > 0 && (
              <span className="w-4.5 h-4.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black flex items-center justify-center">
                {heldOrders.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setIsOrderHistoryOpen(true)}
            className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition relative shrink-0"
            title="Pusat Layanan Nota: Pelunasan Piutang, Tukar Ukuran, dan Refund"
          >
            <span>📋</span>
            <span className="hidden xl:inline">Layanan Nota</span>
            <span className="hidden sm:inline xl:hidden">Nota</span>
            {unpaidOrdersCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black flex items-center justify-center animate-pulse">
                {unpaidOrdersCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative min-w-0 w-full">
        {/* CATALOG AREA (Full Width on Mobile, Left Panel on Tablet/Desktop md:flex-1) */}
        <div className="w-full md:w-auto md:flex-1 min-w-0 flex flex-col bg-slate-50 overflow-hidden border-r border-slate-200">
          {/* Search & Mode Bar */}
          <div className="p-2.5 sm:p-4 bg-white border-b border-slate-200 space-y-2.5 shadow-2xs">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="relative flex-1 min-w-[120px]">
                <input
                  type="text"
                  placeholder="Cari produk / SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                />
                <span className={`absolute left-2.5 top-2.5 text-xs ${isSearchingServer ? 'animate-spin text-indigo-500' : 'text-slate-400'}`}>
                  {isSearchingServer ? '🔄' : '🔍'}
                </span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* View Mode Toggle */}
              <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 shrink-0">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2 py-1.5 rounded-lg text-xs transition font-semibold ${
                    viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-500'
                  }`}
                  title="Tampilan Grid"
                >
                  ▦<span className="hidden xl:inline ml-1">Grid</span>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-2 py-1.5 rounded-lg text-xs transition font-semibold ${
                    viewMode === 'list' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-500'
                  }`}
                  title="Tampilan List"
                >
                  ☰<span className="hidden xl:inline ml-1">List</span>
                </button>
              </div>

              {/* Tab Selector */}
              <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 shrink-0">
                <button
                  onClick={() => setActiveTab('catalog')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'catalog' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Katalog
                </button>
                <button
                  onClick={() => setActiveTab('keypad')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                    activeTab === 'keypad' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Keypad
                </button>
              </div>
            </div>

            {/* Quick helper when cashier searches for receipt number */}
            {searchQuery && (searchQuery.toLowerCase().includes('pos-') || searchQuery.toLowerCase().startsWith('pos') || /^#?\d{4,}$/.test(searchQuery)) && (
              <div className="p-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-between text-xs animate-in fade-in">
                <span className="text-indigo-950 font-bold">
                  Nota <strong>#{searchQuery}</strong> terdeteksi! Mau proses pelunasan, tukar, atau refund?
                </span>
                <button
                  type="button"
                  onClick={() => setIsOrderHistoryOpen(true)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-[11px] transition shadow-xs shrink-0"
                >
                  Buka Layanan Nota →
                </button>
              </div>
            )}

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
                  Semua Kategori ({(products || []).length})
                </button>
                {(categories || []).map((c) => (
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
          <div
            className="flex-1 overflow-y-auto p-3 sm:p-5 pb-24 md:pb-5"
            onScroll={handleCatalogScroll}
          >
            {activeTab === 'catalog' ? (
              catalogLoading && (products || []).length === 0 ? (
                /* Instant App-Shell Skeleton Grid (Zero Black-Screen) */
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-3 sm:gap-3.5">
                  {Array.from({ length: 12 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-3xl border border-slate-200/80 p-3.5 flex flex-col justify-between animate-pulse h-36"
                    >
                      <div>
                        <div className="w-14 h-4 bg-slate-100 rounded-full mb-2"></div>
                        <div className="w-3/4 h-4 bg-slate-100 rounded-lg mb-1.5"></div>
                        <div className="w-1/2 h-3 bg-slate-100 rounded-lg"></div>
                      </div>
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="w-16 h-4 bg-slate-100 rounded-md"></div>
                        <div className="w-7 h-7 bg-slate-100 rounded-xl"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="py-24 text-center text-slate-400 text-xs">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-3xl mx-auto mb-3">
                    {debouncedSearch ? '🔎' : '📦'}
                  </div>
                  <p className="font-semibold text-slate-700 text-sm">
                    {debouncedSearch ? 'Tidak ada produk ditemukan' : 'Katalog Produk Kosong'}
                  </p>
                  <p className="text-slate-400 mt-1 max-w-sm mx-auto">
                    {debouncedSearch
                      ? 'Coba sesuaikan kata kunci pencarian atau kategori Anda.'
                      : 'Belum ada produk aktif di unit bisnis ini, atau koneksi terputus.'}
                  </p>
                  {(products || []).length === 0 && (
                    <button
                      type="button"
                      onClick={() => refreshCatalog()}
                      disabled={catalogLoading}
                      className="mt-4 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold text-xs transition inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <span className={catalogLoading ? 'animate-spin inline-block' : ''}>🔄</span>
                      <span>Muat Ulang Katalog</span>
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Smart Exact Match Collapse Banner (Option B: Smart Focus with Expansion) */}
                  {hasExactMatch && otherMatches.length > 0 && (
                    !showAllSimilarMatches ? (
                      <div className="mb-3.5 p-3 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-indigo-50 border border-emerald-200/90 flex items-center justify-between gap-3 text-xs shadow-2xs animate-in fade-in">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 h-6 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-xs font-black shadow-2xs shrink-0">
                            ✓
                          </span>
                          <div className="min-w-0">
                            <span className="font-bold text-emerald-950">
                              {exactMatches.length === 1 ? '1 Produk Cocok Persis' : `${exactMatches.length} Produk Cocok Persis`}
                            </span>
                            <span className="text-emerald-700 block text-[11px] truncate">
                              Menyembunyikan {otherMatches.length} produk serupa lainnya agar layar kasir tetap bersih.
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAllSimilarMatches(true)}
                          className="px-3 py-1.5 bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-xl font-bold text-xs transition shadow-2xs shrink-0 cursor-pointer flex items-center gap-1"
                        >
                          <span>Tampilkan Semua ({exactMatches.length + otherMatches.length})</span>
                          <span>▾</span>
                        </button>
                      </div>
                    ) : (
                      <div className="mb-3.5 p-2.5 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-between gap-3 text-xs animate-in fade-in">
                        <span className="text-slate-600 text-[11px] font-medium">
                          Menampilkan semua ({exactMatches.length} cocok persis + {otherMatches.length} produk serupa).
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAllSimilarMatches(false)}
                          className="px-2.5 py-1 bg-white hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-lg font-bold text-[11px] transition shrink-0 cursor-pointer"
                        >
                          Fokus Cocok Persis Saja ▴
                        </button>
                      </div>
                    )
                  )}

                  {viewMode === 'grid' ? (
                    /* GRID VIEW */
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-3 sm:gap-3.5">
                        {visibleProducts.map((p) => {
                          const isOutOfStock = p.stock_type === 'tracked' && p.stock_quantity <= 0
                          const badgeClass = getPastelBadge(p.name)
                          const isExact = Boolean(p._isExactMatch)
                          return (
                            <div
                              key={p.id}
                              onClick={() => !isOutOfStock && handleProductTap(p)}
                              className={`group bg-white rounded-3xl border p-3.5 flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-xs hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] ${
                                isOutOfStock
                                  ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200'
                                  : isExact
                                  ? 'border-emerald-400 ring-2 ring-emerald-500/30 shadow-md bg-gradient-to-b from-emerald-50/20 to-white'
                                  : 'border-slate-200/90 hover:border-indigo-400'
                              }`}
                            >
                              <div>
                                <div className="flex items-center justify-between gap-1 mb-2 flex-wrap">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeClass} truncate max-w-[100px]`}>
                                    {p.sku || 'RETAIL'}
                                  </span>
                                  {isExact && (
                                    <span className="text-[9px] bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded-full border border-emerald-300 shadow-2xs">
                                      🎯 Sama Persis
                                    </span>
                                  )}
                                  {Array.isArray(p.product_variants) && p.product_variants.length > 0 && (
                                    <span className="text-[9px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-200/60">
                                      {p.product_variants.length} Varian
                                    </span>
                                  )}
                                  {p.pricing_type === 'area' && (
                                    <span className="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                                      📐 P × L
                                    </span>
                                  )}
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
                                <div className="flex flex-col">
                                  <span className="text-xs sm:text-sm font-black text-slate-950">
                                    Rp {resolvePosItemPrice(p, salesType, Number(p.price || 0)).toLocaleString('id-ID')}
                                  </span>
                                  {p.pricing_type === 'area' && (
                                    <span className="text-[10px] text-indigo-600 font-bold">
                                      / {p.unit || 'm²'}
                                    </span>
                                  )}
                                </div>
                                <span className="w-7 h-7 rounded-xl bg-indigo-50 text-indigo-600 font-black flex items-center justify-center text-xs group-hover:bg-indigo-600 group-hover:text-white transition shadow-2xs">
                                  +
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {visibleProductCount < filteredProducts.length && (
                        <div className="py-6 text-center">
                          <button
                            type="button"
                            onClick={() => setVisibleProductCount((prev) => Math.min(prev + 60, filteredProducts.length))}
                            className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition shadow-2xs hover:shadow-xs"
                          >
                            Menampilkan {visibleProducts.length} dari {filteredProducts.length} produk (Gulir ke bawah untuk memuat lebih banyak)
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    /* LIST VIEW */
                    <>
                      <div className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden divide-y divide-slate-100 shadow-2xs">
                        {visibleProducts.map((p) => {
                          const isOutOfStock = p.stock_type === 'tracked' && p.stock_quantity <= 0
                          const isExact = Boolean(p._isExactMatch)
                          return (
                            <div
                              key={p.id}
                              onClick={() => !isOutOfStock && handleProductTap(p)}
                              className={`p-3.5 sm:p-4 flex items-center justify-between hover:bg-indigo-50/40 transition cursor-pointer ${
                                isOutOfStock
                                  ? 'opacity-50 cursor-not-allowed bg-slate-50'
                                  : isExact
                                  ? 'bg-emerald-50/30 border-l-4 border-l-emerald-500'
                                  : ''
                              }`}
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-xs sm:text-sm text-slate-900">{p.name}</span>
                                  {isExact && (
                                    <span className="text-[9px] bg-emerald-100 text-emerald-800 font-black px-1.5 py-0.5 rounded-full border border-emerald-300">
                                      🎯 Sama Persis
                                    </span>
                                  )}
                                  {p.pricing_type === 'area' && (
                                    <span className="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.5 rounded-full border border-indigo-200">
                                      📐 P × L
                                    </span>
                                  )}
                                </div>
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
                                <div className="flex flex-col items-end">
                                  <span className="text-xs sm:text-sm font-black text-slate-950">
                                    Rp {p.price.toLocaleString('id-ID')}
                                  </span>
                                  {p.pricing_type === 'area' && (
                                    <span className="text-[10px] text-indigo-600 font-bold">
                                      / {p.unit || 'm²'}
                                    </span>
                                  )}
                                </div>
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
                      {visibleProductCount < filteredProducts.length && (
                        <div className="py-6 text-center">
                          <button
                            type="button"
                            onClick={() => setVisibleProductCount((prev) => Math.min(prev + 60, filteredProducts.length))}
                            className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition shadow-2xs hover:shadow-xs"
                          >
                            Menampilkan {visibleProducts.length} dari {filteredProducts.length} produk (Gulir ke bawah untuk memuat lebih banyak)
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
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

        {/* DESKTOP & TABLET CART PANEL (Responsive scaling: 280px on tablet up to 420px on 2xl screens) */}
        <div className="hidden md:flex flex-col md:w-[280px] lg:w-[320px] xl:w-[360px] 2xl:w-[420px] shrink-0 border-l border-slate-200 min-w-0 overflow-hidden">
          {renderCartContent()}
        </div>

        {/* MOBILE FLOATING CART BAR (Shown on small mobile when items in cart) */}
        {cart.length > 0 && (
          <div className="md:hidden fixed bottom-3 left-3 right-3 z-30 bg-slate-900 text-white p-3.5 rounded-2xl shadow-2xl flex items-center justify-between border border-slate-800 animate-slide-up">
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

        {/* MOBILE CART DRAWER (Slid up from bottom on Portrait, Right Side-Drawer on Landscape) */}
        {isMobileCartOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex flex-col justify-end landscape:flex-row landscape:justify-end">
            <div className="bg-white rounded-t-3xl landscape:rounded-t-none landscape:rounded-l-3xl shadow-2xl overflow-hidden flex flex-col h-[85vh] landscape:h-full w-full landscape:w-[400px] landscape:max-w-full animate-slide-up">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
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
              <div className="flex-1 w-full overflow-hidden">
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
        salesType={salesType}
        product={selectedProductForVariant}
        onAddToCart={handleAddVariantItem}
      />

      <PrintingDimensionModal
        isOpen={isDimensionModalOpen}
        onClose={() => {
          setIsDimensionModalOpen(false)
          setEditingDimensionItemIndex(null)
        }}
        product={selectedProductForDimension}
        salesType={salesType}
        initialValues={
          editingDimensionItemIndex !== null && cart[editingDimensionItemIndex]?.dimension_spec
            ? {
                length: cart[editingDimensionItemIndex].dimension_spec.length,
                width: cart[editingDimensionItemIndex].dimension_spec.width,
                input_unit: cart[editingDimensionItemIndex].dimension_spec.input_unit,
                quantity: cart[editingDimensionItemIndex].quantity,
                note: cart[editingDimensionItemIndex].note,
                selectedVariant: cart[editingDimensionItemIndex].selectedVariant,
                selectedModifiers: cart[editingDimensionItemIndex].selectedModifiers
              }
            : null
        }
        onAddToCart={handleAddDimensionItem}
      />

      <CashPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        grandTotal={grandTotal}
        cartItems={cart.map((c) => ({
          id: c.product.id,
          name: c.product.name,
          price: c.finalPrice,
          quantity: c.quantity,
          variantName: c.selectedVariant?.name
        }))}
        customerName={selectedCustomer?.name || 'Walk-in Customer'}
        customerPhone={selectedCustomer?.phone || ''}
        accounts={accounts}
        activeShift={activeShift}
        activeRegisterAccountId={activeShift?.register_id ? posRegisters.find((r) => r.id === activeShift.register_id)?.account_id : null}
        businessId={activeBusiness?.id}
        onConfirmPayment={handleConfirmCheckout}
      />

      <PaymentSuccessView
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        receipt={receiptData}
        orderId={lastCreatedOrderId}
      />

      <ShiftModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        activeShift={activeShift}
        cashierName={userProfile?.full_name || 'Kasir'}
        accounts={accounts}
        posRegisters={posRegisters}
        onOpenShift={handleOpenShift}
        onCloseShift={handleCloseShift}
        timezone={activeBusiness?.timezone}
      />

      <HoldModal
        isOpen={isHoldModalOpen}
        onClose={() => setIsHoldModalOpen(false)}
        heldOrders={heldOrders}
        onResumeCart={handleResumeHoldOrder}
        onDeleteHold={handleDeleteHoldOrder}
        timezone={activeBusiness?.timezone}
        onPrintHoldOrder={handlePrintHoldOrder}
        onPrintHeldOrdersSummary={handlePrintHeldOrdersSummary}
        onPrintKitchenTicket={posMode.enableProductionTickets ? (h) => handlePrintKitchenFromHeldOrder(h, false) : undefined}
      />

      <ReceiptPreviewModal
        isOpen={isPreviewReceiptOpen}
        onClose={() => {
          setIsPreviewReceiptOpen(false)
          setPreviewReceipt(null)
        }}
        receipt={previewReceipt}
      />

      <KitchenTicketPreviewModal
        isOpen={isKitchenPreviewOpen}
        onClose={() => {
          setIsKitchenPreviewOpen(false)
          setKitchenPreviewTickets([])
        }}
        tickets={kitchenPreviewTickets}
      />

      {/* Item Note Modal */}
      <ItemNoteModal
        isOpen={itemNoteModalIndex !== null}
        onClose={() => setItemNoteModalIndex(null)}
        item={
          itemNoteModalIndex !== null && cart[itemNoteModalIndex]
            ? {
                name: cart[itemNoteModalIndex].product?.name || 'Produk',
                variantName: cart[itemNoteModalIndex].selectedVariant?.name,
                note: cart[itemNoteModalIndex].note
              }
            : null
        }
        onSave={(newNote) => {
          if (itemNoteModalIndex !== null) {
            handleSaveItemNote(itemNoteModalIndex, newNote)
          }
        }}
      />

      {/* Global Order Note Modal */}
      <OrderNoteModal
        isOpen={isOrderNoteModalOpen}
        onClose={() => setIsOrderNoteModalOpen(false)}
        currentNote={orderNote}
        onSave={(newNote) => setOrderNote(newNote)}
      />

      {/* Global Discount Modal */}
      <GlobalDiscountModal
        isOpen={isDiscountModalOpen}
        onClose={() => setIsDiscountModalOpen(false)}
        currentDiscountType={globalDiscountType}
        currentDiscountValue={globalDiscountInput}
        subtotal={subtotal}
        requireAuth={Boolean(priceGuardSettings.require_global_discount_auth)}
        existingAuthorization={authorizations.get('global_discount')}
        onRequestAuthorization={(data) => {
          setAuthModalState({
            isOpen: true,
            type: 'global_discount',
            title: 'Otorisasi Diskon Global',
            targetDescription: `Diskon Global Keranjang (Rp ${data.calculatedDiscount.toLocaleString('id-ID')})`,
            discountApplied: data.calculatedDiscount,
            onSuccessCallback: (authRecord) => {
              setAuthorizations((prev) => {
                const next = new Map(prev)
                next.set('global_discount', authRecord)
                return next
              })
              setGlobalDiscountType(data.discountType)
              setGlobalDiscountInput(data.discountValue)
              setIsDiscountModalOpen(false)
            },
          })
        }}
        onApply={(type, val) => {
          setGlobalDiscountType(type)
          setGlobalDiscountInput(val)
          if (!val || Number(val) <= 0) {
            setAuthorizations((prev) => {
              const next = new Map(prev)
              next.delete('global_discount')
              return next
            })
          }
        }}
      />

      {/* Cart Item Edit Modal */}
      <CartItemEditModal
        isOpen={editingCartItemIndex !== null}
        onClose={() => setEditingCartItemIndex(null)}
        item={editingCartItemIndex !== null ? cart[editingCartItemIndex] : null}
        onEditDimensions={() => {
          if (editingCartItemIndex !== null) {
            const currentItem = cart[editingCartItemIndex]
            setSelectedProductForDimension(currentItem.product)
            setEditingDimensionItemIndex(editingCartItemIndex)
            setEditingCartItemIndex(null)
            setIsDimensionModalOpen(true)
          }
        }}
        isGuarded={editingCartItemIndex !== null ? isItemGuarded(cart[editingCartItemIndex]) : false}
        costPrice={editingCartItemIndex !== null ? getItemCostPrice(cart[editingCartItemIndex]) : 0}
        allowOverride={Boolean(priceGuardSettings.require_approver_pin || priceGuardSettings.require_reason)}
        existingAuthorization={
          editingCartItemIndex !== null
            ? (authorizations.get(`item_${editingCartItemIndex}`) || cart[editingCartItemIndex]?.authorization)
            : undefined
        }
        onRequestAuthorization={(data) => {
          if (editingCartItemIndex === null) return
          const currentItem = cart[editingCartItemIndex]
          setAuthModalState({
            isOpen: true,
            type: 'line_item_price',
            title: 'Otorisasi Batas Harga',
            targetDescription: `${currentItem.product.name} (Harga Diminta: Rp ${data.proposedPrice.toLocaleString('id-ID')})`,
            productId: currentItem.product.id || null,
            proposedPrice: data.proposedPrice,
            currentPrice: data.currentPrice,
            discountApplied: data.discountApplied,
            itemIndex: editingCartItemIndex,
            onSuccessCallback: (authRecord) => {
              setAuthorizations((prev) => {
                const next = new Map(prev)
                next.set(`item_${editingCartItemIndex}`, authRecord)
                return next
              })
              setCart((prev) => {
                const copy = [...prev]
                if (copy[editingCartItemIndex]) {
                  copy[editingCartItemIndex] = {
                    ...copy[editingCartItemIndex],
                    finalPrice: data.proposedPrice + (data.discountApplied || 0),
                    discount: data.discountApplied || 0,
                    authorization: authRecord,
                  }
                }
                return copy
              })
              setEditingCartItemIndex(null)
            },
          })
        }}
        onSave={(updates) => {
          if (editingCartItemIndex !== null) {
            setCart((prev) => {
              const copy = [...prev]
              if (copy[editingCartItemIndex]) {
                copy[editingCartItemIndex] = {
                  ...copy[editingCartItemIndex],
                  ...updates
                }
              }
              return copy
            })
          }
        }}
        onRemove={() => {
          if (editingCartItemIndex !== null) {
            const removedIdx = editingCartItemIndex
            setAuthorizations((prev) => {
              const copy = new Map(prev)
              copy.delete(`item_${removedIdx}`)
              return copy
            })
            handleRemoveItem(removedIdx)
          }
        }}
      />

      {/* Price Guard Authorization Modal */}
      <PriceAuthorizationModal
        isOpen={authModalState.isOpen}
        onClose={() => setAuthModalState((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={(authRecord) => {
          if (authModalState.onSuccessCallback) {
            authModalState.onSuccessCallback(authRecord)
          }
        }}
        authorizationType={authModalState.type}
        title={authModalState.title}
        targetDescription={authModalState.targetDescription}
        productId={authModalState.productId}
        proposedPrice={authModalState.proposedPrice}
        currentPrice={authModalState.currentPrice}
        discountApplied={authModalState.discountApplied}
        requirePin={Boolean(priceGuardSettings.require_approver_pin)}
        requireReason={Boolean(priceGuardSettings.require_reason)}
      />

      {isAddCustomerOpen && (
        <AddCustomerModal
          isOpen={isAddCustomerOpen}
          onClose={() => setIsAddCustomerOpen(false)}
          businessId={businessId}
          onSave={(c: any) => {
            const newCust = {
              id: c.id || c.customer_id,
              name: c.name,
              phone: c.phone,
              loyalty_points: Number(c.loyalty_points || 0),
              loyalty_tier: c.loyalty_tier || 'Bronze'
            }
            notifyCustomerDirectoryUpdate(newCust, 'upsert', businessId)
            setCustomers((prev) => [newCust, ...prev.filter(item => item.id !== newCust.id)])
            setSelectedCustomer(newCust)
          }}
        />
      )}

      {isOrderHistoryOpen && (
        <OrderHistoryModal
          isOpen={isOrderHistoryOpen}
          onClose={() => setIsOrderHistoryOpen(false)}
          businessId={businessId}
          timezone={activeBusiness?.timezone}
          onSelectOrder={(order) => {
            setIsOrderHistoryOpen(false)
            setSelectedOrderForDetail(order)
          }}
          onRefundCompleted={() => {
            refreshAllPOSData()
          }}
        />
      )}

      {selectedOrderForDetail && (
        <POSOrderDetailModal
          isOpen={Boolean(selectedOrderForDetail)}
          onClose={() => setSelectedOrderForDetail(null)}
          order={selectedOrderForDetail}
          businessId={activeBusiness?.id}
          timezone={activeBusiness?.timezone}
          businessName={activeBusiness?.name || 'ShapeUp Store'}
          cashierName={activeShift?.cashier_name || userProfile?.full_name || 'Kasir'}
          onRefundSuccess={() => {
            refreshAllPOSData()
          }}
          onOrderUpdated={() => {
            refreshAllPOSData()
          }}
        />
      )}

      {/* Floating Proactive Bluetooth Printer Status Bar */}
      <POSBluetoothStatusBar
        onOpenQuickModal={() => setIsBtQuickModalOpen(true)}
        defaultBusinessName={activeBusiness?.name}
      />

      {/* Quick Bluetooth Reconnect & Pairing Modal */}
      <POSBluetoothQuickReconnectModal
        isOpen={isBtQuickModalOpen}
        onClose={() => setIsBtQuickModalOpen(false)}
        defaultBusinessName={activeBusiness?.name}
      />
    </div>
  )
}
