"use client"

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useUserContext } from '@/components/UserContext'
import { isCashBankAccount, resolvePaymentAccountFromCOA } from '@/lib/coa'
import QuickAddProductModal from '@/components/QuickAddProductModal'
import { QuickAddCustomerForm, NewCustomerFormData, EMPTY_CUSTOMER_FORM } from '@/components/QuickAddCustomerForm'
import { CustomerSelectCombobox } from '@/components/CustomerSelectCombobox'
import { ProductSelectCombobox, ProductComboboxItem } from '@/components/ProductSelectCombobox'
import { useCustomerDirectory, notifyCustomerDirectoryUpdate } from '@/lib/customerDirectoryStore'
import { fetchAllBusinessProducts } from '@/lib/chunkedQueryHelper'

type Customer = {
  id: string
  name: string
  phone: string
  email: string | null
  address_data?: any
}

type ProductVariant = {
  id: string
  name: string
  sku: string | null
  price: number
  cost_price?: number | null
  stock_quantity?: number | null
}

type Product = {
  id: string
  name: string
  price: number
  sku: string | null
  cost_price: number | null
  stock_quantity?: number | null
  stock_type?: string | null
  product_variants?: ProductVariant[]
}

type COAAccount = {
  id: string
  code: string
  name: string
  type: string
  sub_type?: string | null
}

type InvoiceItemInput = {
  product_id: string | null
  variant_id?: string | null
  cost_price?: number | null
  name: string
  sku: string
  description?: string
  price: number
  quantity: number
  discount?: number
}

const formatIDR = (value: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value)
}

const formatAddress = (addr: any) => {
  if (!addr) return 'Alamat belum diatur'
  const parts = [
    addr.address_line1,
    addr.address_line2,
    addr.subdistrict,
    addr.city,
    addr.state,
    addr.postcode,
    addr.country
  ].filter(Boolean)
  return parts.join(', ') || 'Alamat belum diatur'
}

export default function EditInvoicePage() {
  // Using singleton supabase client from @/lib/supabase
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string

  // Master Data States
  const [products, setProducts] = useState<Product[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<COAAccount[]>([])
  const [businessName, setBusinessName] = useState<string>('')
  const [businessId, setBusinessId] = useState<string>('')
  const [loadingData, setLoadingData] = useState<boolean>(true)
  const [loadingInvoice, setLoadingInvoice] = useState<boolean>(true)

  // Creator & User Profile Permissions
  const [currentUserProfile, setCurrentUserProfile] = useState<{ id: string; role: string } | null>(null)
  const [creatorName, setCreatorName] = useState<string>('')
  const [creatorUserId, setCreatorUserId] = useState<string | null>(null)

  const canEdit = useMemo(() => {
    if (!currentUserProfile) return true
    if (currentUserProfile.role === 'admin') return true
    if (!creatorUserId) return true
    return creatorUserId === currentUserProfile.id
  }, [currentUserProfile, creatorUserId])

  // Decoupled Invoice status & Payment settlement
  const [invoiceStatus, setInvoiceStatus] = useState<string>('pending')
  const [initialPaymentStatus, setInitialPaymentStatus] = useState<'unpaid' | 'partial' | 'paid'>('unpaid')
  const [invoiceDocStatus, setInvoiceDocStatus] = useState<'pending' | 'processing' | 'shipped' | 'completed' | 'cancelled'>('pending')
  const [paymentSettlementStatus, setPaymentSettlementStatus] = useState<'unpaid' | 'partial' | 'paid'>('unpaid')
  const [inputAmountPaid, setInputAmountPaid] = useState<number>(0)
  const [paymentAccountId, setPaymentAccountId] = useState<string>('')
  const [paymentDate, setPaymentDate] = useState<string>(() => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  })

  // Advanced Source Attribution
  const [sourcePlatform, setSourcePlatform] = useState<string>('Invoice')
  const [customSourcePlatform, setCustomSourcePlatform] = useState<string>('')
  const [sourceOrderRef, setSourceOrderRef] = useState<string>('')
  const [utmSource, setUtmSource] = useState<string>('')
  const [utmCampaign, setUtmCampaign] = useState<string>('')
  const [showAdvancedSource, setShowAdvancedSource] = useState<boolean>(false)

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [isNewCustomer, setIsNewCustomer] = useState<boolean>(false)
  const [newCustForm, setNewCustForm] = useState<NewCustomerFormData>(EMPTY_CUSTOMER_FORM)
  const [loadedCustomerAddress, setLoadedCustomerAddress] = useState<any>(null)

  // Invoice Fields
  const [invoiceNumber, setInvoiceNumber] = useState<string>('')
  const [invoiceDate, setInvoiceDate] = useState<string>('')
  const [paymentTerms, setPaymentTerms] = useState<string>('due-on-receipt')
  const [dueDate, setDueDate] = useState<string>('')

  // Invoice Items
  const [items, setItems] = useState<InvoiceItemInput[]>([
    { product_id: null, variant_id: null, cost_price: null, name: '', sku: '', description: '', price: 0, quantity: 1, discount: 0 }
  ])

  // Visibility toggles for additional fields
  const [showShippingInput, setShowShippingInput] = useState<boolean>(false)
  const [showOtherFeesInput, setShowOtherFeesInput] = useState<boolean>(false)
  const [showItemDiscount, setShowItemDiscount] = useState<Record<number, boolean>>({})

  // Financial summary
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
  const [showAddress, setShowAddress] = useState<boolean>(true)
  const [showShipping, setShowShipping] = useState<boolean>(true)

  // Shipping details
  const [courier, setCourier] = useState<string>('')
  const [customCourier, setCustomCourier] = useState<string>('')
  const [trackingNumber, setTrackingNumber] = useState<string>('')

  // Quick Add Product Modal States
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false)
  const [quickAddName, setQuickAddName] = useState('')
  const [quickAddRowIndex, setQuickAddRowIndex] = useState<number | null>(null)

  // Payment popup
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false)
  const [paymentMethod, setPaymentMethod] = useState<string>('Bank Transfer')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [submittingType, setSubmittingType] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')

  // Check if financials (line items/totals) are locked (only when both completed AND already paid)
  const isFinancialsLocked = useMemo(
    () => invoiceStatus === 'completed' && initialPaymentStatus === 'paid',
    [invoiceStatus, initialPaymentStatus]
  )

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

  // Lock body scroll when payment modal is open
  useEffect(() => {
    if (showPaymentModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showPaymentModal])

  const { activeBusiness, userProfile: ctxProfile, currentUserRole } = useUserContext()
  const { customers, upsertCustomer } = useCustomerDirectory({
    businessId: businessId || activeBusiness?.id,
    includeCustomerId: selectedCustomerId || null
  })

  // Load Initial Data (Products & Business Context)
  useEffect(() => {
    const loadMasterData = async () => {
      setLoadingData(true)
      try {
        let targetBizId = activeBusiness?.id || ''
        let targetBizName = activeBusiness?.name || 'Bisnis Saya'

        if (ctxProfile?.id) {
          setCurrentUserProfile({ id: ctxProfile.id, role: currentUserRole || ctxProfile.role || 'staff' })
        }

        if (!targetBizId) {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) return

          const { data: profile } = await supabase
            .from('profiles')
            .select('id, role, active_business_id, businesses!active_business_id(name)')
            .eq('id', user.id)
            .single()

          if (!profile?.active_business_id) return
          targetBizId = profile.active_business_id
          targetBizName = (profile.businesses as { name?: string } | null)?.name || 'Bisnis Saya'
          setCurrentUserProfile({ id: profile.id, role: profile.role || 'staff' })
        }

        setBusinessId(targetBizId)
        setBusinessName(targetBizName)

        // Fetch all products with variants (Chunked to bypass 1,000 PostgREST limit)
        const prodData = await fetchAllBusinessProducts<Product>(supabase, targetBizId)
        if (prodData) setProducts(prodData)
      } catch (err) {
        console.error('Error loading master data:', err)
      } finally {
        setLoadingData(false)
      }
    }

    loadMasterData()
  }, [supabase, activeBusiness?.id, activeBusiness?.name, ctxProfile?.id, ctxProfile?.role, currentUserRole])

  // Unfold products into flat discrete items (Variants as individual rows, or parent product if no variants)
  const comboboxProducts = useMemo<ProductComboboxItem[]>(() => {
    const list: ProductComboboxItem[] = []
    for (const p of products) {
      if (Array.isArray(p.product_variants) && p.product_variants.length > 0) {
        for (const v of p.product_variants) {
          list.push({
            id: p.id,
            variant_id: v.id,
            name: `${p.name} - ${v.name}`,
            price: Number(v.price || p.price || 0),
            sku: v.sku || p.sku || null,
            cost_price: v.cost_price ?? p.cost_price ?? null,
            stock_quantity: v.stock_quantity ?? null,
            stock_type: p.stock_type || 'tracked',
            is_variant: true
          })
        }
      } else {
        list.push({
          id: p.id,
          variant_id: null,
          name: p.name,
          price: Number(p.price || 0),
          sku: p.sku || null,
          cost_price: p.cost_price ?? null,
          stock_quantity: p.stock_quantity ?? null,
          stock_type: p.stock_type || 'tracked',
          is_variant: false
        })
      }
    }
    return list
  }, [products])

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
          setInvoiceDocStatus(inv.status || 'pending')

          const raw = inv.raw_source_data || {}

          // Payment Settlement Status & COA Account
          const payStatus = (inv.payment_status || (inv.status === 'completed' ? 'paid' : 'unpaid')) as 'unpaid' | 'partial' | 'paid'
          setInitialPaymentStatus(payStatus)
          setPaymentSettlementStatus(payStatus)
          const paidNum = Number(inv.amount_paid || (payStatus === 'paid' ? inv.grand_total : 0))
          setInputAmountPaid(paidNum)
          if (inv.payment_method) setPaymentMethod(inv.payment_method)

          const accList: COAAccount[] = Array.isArray(json.payment_accounts) ? json.payment_accounts : []
          setPaymentAccounts(accList)

          const firstPay = Array.isArray(inv.payments) && inv.payments.length > 0 ? inv.payments[0] : null
          if (firstPay?.date) {
            setPaymentDate(String(firstPay.date).split('T')[0])
          }

          if (accList.length > 0) {
            const matchedAcc = resolvePaymentAccountFromCOA(
              accList,
              firstPay?.payment_method || inv.payment_method,
              firstPay?.payment_method_account_id
            ) || accList[0]
            if (matchedAcc) {
              setPaymentAccountId(matchedAcc.id)
              setPaymentMethod(matchedAcc.name)
            }
          } else if (firstPay?.payment_method_account_id) {
            setPaymentAccountId(firstPay.payment_method_account_id)
          }

          // Source Attribution
          const srcChannel = raw.source_order?.channel || inv.source_platform || 'Invoice'
          const standardChannels = ['Invoice', 'WhatsApp', 'Instagram', 'Manual', 'Shopee', 'Tokopedia', 'TikTok', 'WooCommerce']
          if (standardChannels.includes(srcChannel)) {
            setSourcePlatform(srcChannel)
            setCustomSourcePlatform('')
          } else {
            setSourcePlatform('Lainnya')
            setCustomSourcePlatform(srcChannel)
          }

          const refNo = raw.source_order?.reference_no || ''
          const uSource = raw.source_order?.utm_source || ''
          const uCampaign = raw.source_order?.utm_campaign || ''
          setSourceOrderRef(refNo)
          setUtmSource(uSource)
          setUtmCampaign(uCampaign)
          if (refNo || uSource || uCampaign || (srcChannel !== 'Invoice')) {
            setShowAdvancedSource(true)
          }

          setSelectedCustomerId(inv.customer_id || '')
          setLoadedCustomerAddress(inv.customers?.address_data || null)
          if (inv.customers && inv.customer_id) {
            upsertCustomer({
              ...inv.customers,
              id: inv.customer_id,
              business_id: inv.business_id || businessId
            })
          }
          setInvoiceNumber(inv.order_number || '')
          setCreatorUserId(inv.user_id || null)
          setCreatorName(inv.creator?.full_name || 'Tidak diketahui')
          
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
          setPaymentTerms(raw.payment_terms || 'custom')
          setNotes(raw.notes || '')
          setCustomTitle(raw.custom_title || 'INVOICE')
          setCustomSubtitle(raw.custom_subtitle || '')
          setAccentColor(raw.accent_color || 'slate')
          setLayoutStyle(raw.layout_style || 'modern')
          setShowSku(raw.show_sku !== undefined ? raw.show_sku : true)
          setShowDescription(raw.show_description !== undefined ? raw.show_description : true)
          setShowNotes(raw.show_notes !== undefined ? raw.show_notes : true)
          setShowAddress(raw.show_address !== undefined ? raw.show_address : true)
          setShowShipping(raw.show_shipping !== undefined ? raw.show_shipping : true)

          // Shipping details extraction
          const meta = raw.meta_data || []
          const foundCourier = meta.find((m: any) => m.key === 'shapeup_kurir_awb')?.value || 
                               meta.find((m: any) => m.key === '_kurir_awb')?.value || ''
          const foundTracking = meta.find((m: any) => m.key === 'shapeup_resi_awb')?.value || 
                                meta.find((m: any) => m.key === '_resi_awb')?.value || ''

          const standardCouriers = ['JNE', 'J&T', 'Sicepat', 'POS', 'Tiki', 'Anteraja', 'Wahana', 'SPX']
          if (foundCourier) {
            if (standardCouriers.includes(foundCourier)) {
              setCourier(foundCourier)
              setCustomCourier('')
            } else {
              setCourier('Lainnya')
              setCustomCourier(foundCourier)
            }
          } else {
            setCourier('')
            setCustomCourier('')
          }
          setTrackingNumber(foundTracking)

          // Items mapping
          if (Array.isArray(inv.items_json)) {
            const mappedItems = inv.items_json.map((item: any) => ({
              product_id: item.product_id || null,
              variant_id: item.variant_id || item.variation_id || null,
              cost_price: item.cost_price !== undefined ? Number(item.cost_price) : null,
              name: item.name || '',
              sku: item.sku || '',
              description: item.description || '',
              price: Number(item.price || 0),
              quantity: Number(item.quantity || 1),
              discount: Number(item.discount || 0)
            }))
            setItems(mappedItems)

            // Auto-expand discount input field if item has discount
            const initialShowDiscount: Record<number, boolean> = {}
            mappedItems.forEach((item: InvoiceItemInput, index: number) => {
              if (item.discount && item.discount > 0) {
                initialShowDiscount[index] = true
              }
            })
            setShowItemDiscount(initialShowDiscount)
          }

          const shipCost = Number(inv.shipping_cost || 0)
          const othFees = Number(inv.other_fees || 0)
          setShippingCost(shipCost)
          setOtherFees(othFees)
          if (shipCost > 0) setShowShippingInput(true)
          if (othFees > 0) setShowOtherFeesInput(true)
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
    setItems([...items, { product_id: null, variant_id: null, cost_price: null, name: '', sku: '', description: '', price: 0, quantity: 1, discount: 0 }])
  }

  const handleRemoveItemRow = (index: number) => {
    if (isFinancialsLocked) return
    if (items.length === 1) {
      setItems([{ product_id: null, variant_id: null, cost_price: null, name: '', sku: '', description: '', price: 0, quantity: 1, discount: 0 }])
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
      if (field === 'price' || field === 'quantity' || field === 'discount') {
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
        variant_id: null,
        cost_price: newProduct.cost_price ?? null,
        name: newProduct.name,
        price: newProduct.price,
        sku: newProduct.sku || ''
      })
    }
  }

  // Financial Calculations
  const subtotal = useMemo(() => {
    return items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 1)), 0)
  }, [items])

  const discountAmount = useMemo(() => {
    return items.reduce((sum, item) => sum + (Number(item.discount || 0) * Number(item.quantity || 1)), 0)
  }, [items])

  const grandTotal = useMemo(() => {
    const total = subtotal - discountAmount + Number(shippingCost || 0) + Number(otherFees || 0)
    return Math.max(0, total)
  }, [subtotal, discountAmount, shippingCost, otherFees])

  // Submit Handler
  const handleSubmit = async (
    submitStatus?: 'pending' | 'processing' | 'shipped' | 'completed' | 'cancelled',
    submitPayStatus?: 'unpaid' | 'partial' | 'paid',
    submitAmountPaid?: number
  ) => {
    const finalDocStatus = submitStatus || invoiceDocStatus
    const finalPayStatus = submitPayStatus || paymentSettlementStatus

    if (!isFinancialsLocked) {
      if (isNewCustomer && (!newCustForm.name || !newCustForm.phone)) {
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

    let finalAmountPaid = 0
    if (finalPayStatus === 'paid') {
      finalAmountPaid = grandTotal
    } else if (finalPayStatus === 'partial') {
      const rawPartial = submitAmountPaid !== undefined ? submitAmountPaid : inputAmountPaid
      finalAmountPaid = Math.min(grandTotal, Math.max(0, Number(rawPartial) || 0))
      if (finalAmountPaid <= 0) {
        setErrorMessage('Nominal pembayaran sebagian (DP) harus lebih besar dari Rp 0.')
        return
      }
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const resolvedSourcePlatform = sourcePlatform === 'Lainnya' ? (customSourcePlatform.trim() || 'Lainnya') : sourcePlatform

      const payload: Record<string, any> = {
        customer_id: isNewCustomer ? null : selectedCustomerId,
        customer_name: isNewCustomer ? newCustForm.name : null,
        customer_phone: isNewCustomer ? newCustForm.phone : null,
        customer_email: isNewCustomer ? newCustForm.email : null,
        customer_address: isNewCustomer ? newCustForm.address : null,
        order_number: invoiceNumber || null,
        order_date: invoiceDate,
        due_date: dueDate,
        payment_terms: paymentTerms,
        items: items,
        discount_amount: Number(discountAmount),
        shipping_cost: Number(shippingCost),
        other_fees: Number(otherFees),
        grand_total: grandTotal,
        status: finalDocStatus,
        payment_status: finalPayStatus,
        amount_paid: finalAmountPaid,
        payment_method: finalPayStatus !== 'unpaid' ? paymentMethod : null,
        payment_method_account_id: finalPayStatus !== 'unpaid' ? (paymentAccountId || null) : null,
        payment_date: finalPayStatus !== 'unpaid' ? paymentDate : null,
        source_platform: resolvedSourcePlatform,
        source_order_ref: sourceOrderRef.trim() || null,
        utm_source: utmSource.trim() || null,
        utm_campaign: utmCampaign.trim() || null,
        notes: notes,
        custom_title: customTitle,
        custom_subtitle: customSubtitle,
        accent_color: accentColor,
        layout_style: layoutStyle,
        show_sku: showSku,
        show_description: showDescription,
        show_notes: showNotes,
        show_address: showAddress,
        show_shipping: showShipping,
        courier: courier === 'Lainnya' ? customCourier : courier,
        tracking_number: trackingNumber
      }

      const res = await fetch(`/api/orders/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || 'Gagal menyimpan perubahan invoice.')
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('shapeup_invoices_cache')
      }

      if (isNewCustomer && json.order?.customer_id) {
        notifyCustomerDirectoryUpdate(
          {
            id: json.order.customer_id,
            business_id: businessId || activeBusiness?.id,
            name: newCustForm.name,
            phone: newCustForm.phone,
            email: newCustForm.email || null,
            address_data: newCustForm.address || null
          },
          'upsert',
          businessId || activeBusiness?.id
        )
      }

      router.push(`/orders/invoices/${invoiceId}?saved=1&pay=${finalPayStatus}`)
      router.refresh()
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan sistem.')
    } finally {
      setSubmitting(false)
      setSubmittingType(null)
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

  if (!canEdit) {
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
          <h2 className="text-sm font-black text-rose-700">Akses Ditolak</h2>
          <p className="text-xs text-[#70706E]">
            Anda tidak memiliki akses untuk mengubah invoice ini karena invoice ini dibuat oleh staff lain dan Anda bukan Admin.
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
          <p className="text-xs text-[#70706E]">
            Penerbit: <span className="font-bold text-[#1C1C1A]">{businessName}</span>
            <span className="mx-2">•</span>
            Dibuat oleh: <span className="font-bold text-[#1C1C1A]">{creatorName || 'Tidak diketahui'}</span>
          </p>
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
                    if (!isNewCustomer) setNewCustForm(EMPTY_CUSTOMER_FORM)
                  }}
                  className="text-xs font-black text-[#1E40AF] hover:underline"
                >
                  {isNewCustomer ? 'Select Existing Customer' : '➕ Tambah Customer Baru'}
                </button>
              )}
            </div>

            {!isNewCustomer ? (
              <div className="space-y-1">
                <CustomerSelectCombobox
                  customers={customers}
                  selectedCustomerId={selectedCustomerId}
                  disabled={isFinancialsLocked}
                  onSelectCustomer={setSelectedCustomerId}
                  onAddNewCustomer={query => {
                    if (isFinancialsLocked) return
                    setIsNewCustomer(true)
                    setSelectedCustomerId('')
                    setNewCustForm(prev => ({
                      ...prev,
                      name: query || prev.name
                    }))
                  }}
                />
                {(selectedCustomerId || loadedCustomerAddress) && (
                  <div className="mt-2 p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-semibold text-slate-700">
                    📍 <span className="font-bold">Alamat:</span> {
                      formatAddress(customers.find(c => c.id === selectedCustomerId)?.address_data || loadedCustomerAddress)
                    }
                  </div>
                )}
              </div>
            ) : (
              <div className="border-t border-slate-100 pt-3">
                <QuickAddCustomerForm
                  value={newCustForm}
                  onChange={setNewCustForm}
                  compact
                />
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

          {/* Section 2.2: Status Faktur & Pembayaran (Decoupled Flow) */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">
                Status Faktur & Pembayaran
              </h2>
              <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                Decoupled Lifecycle
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Status Dokumen Invoice */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#70706E]">Status Dokumen Invoice</label>
                <select
                  value={invoiceDocStatus}
                  onChange={e => setInvoiceDocStatus(e.target.value as any)}
                  className="w-full p-2.5 text-xs font-bold rounded-xl border border-[#EBEBEA] bg-white focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                >
                  <option value="pending">📝 DRAFT (Rancangan Internal)</option>
                  <option value="processing">🚀 DITERBITKAN (Resmi / Open)</option>
                  <option value="shipped">📦 DIKIRIM (Dalam Pengiriman)</option>
                  <option value="completed">✅ SELESAI (Pesanan Ditutup)</option>
                  <option value="cancelled">❌ DIBATALKAN (Void)</option>
                </select>
                <p className="text-[10px] text-[#70706E]">
                  {invoiceDocStatus === 'pending' && 'Faktur belum mengikat piutang atau mutasi stok.'}
                  {invoiceDocStatus === 'processing' && 'Faktur resmi diterbitkan, piutang dicatat di buku besar.'}
                  {invoiceDocStatus === 'shipped' && 'Barang dikirim ke pelanggan, stok fisik & HPP dipotong.'}
                  {invoiceDocStatus === 'completed' && 'Faktur dan penyerahan barang/layanan tuntas penuh.'}
                  {invoiceDocStatus === 'cancelled' && 'Faktur dibatalkan dan jurnal pembalikan diposting.'}
                </p>
              </div>

              {/* Status Pembayaran */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#70706E]">Status Pembayaran</label>
                <select
                  value={paymentSettlementStatus}
                  onChange={e => {
                    const val = e.target.value as any
                    setPaymentSettlementStatus(val)
                    if (val === 'paid') {
                      setInputAmountPaid(grandTotal)
                    } else if (val === 'unpaid') {
                      setInputAmountPaid(0)
                    } else if (val === 'partial' && inputAmountPaid === 0) {
                      setInputAmountPaid(Math.round(grandTotal / 2))
                    }
                  }}
                  className="w-full p-2.5 text-xs font-bold rounded-xl border border-[#EBEBEA] bg-white focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                >
                  <option value="unpaid">🔴 Belum Bayar (Unpaid)</option>
                  <option value="partial">🟡 Bayar Sebagian / DP (Partial)</option>
                  <option value="paid">🟢 Lunas (Paid)</option>
                </select>
                <p className="text-[10px] text-[#70706E]">
                  {paymentSettlementStatus === 'unpaid' && 'Pelanggan belum membayar (Piutang 100%).'}
                  {paymentSettlementStatus === 'partial' && 'Pelanggan membayar uang muka / sebagian tagihan.'}
                  {paymentSettlementStatus === 'paid' && 'Tagihan dibayar lunas seketika.'}
                </p>
              </div>
            </div>

            {/* Conditional Sub-panel if partial or paid */}
            {paymentSettlementStatus !== 'unpaid' && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in duration-200">
                {paymentSettlementStatus === 'partial' ? (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Nominal DP / Uang Muka (Rp)</label>
                    <input
                      type="number"
                      min={1}
                      max={grandTotal}
                      value={inputAmountPaid || ''}
                      onChange={e => setInputAmountPaid(Math.min(grandTotal, Math.max(0, Number(e.target.value))))}
                      placeholder="Masukkan nominal DP..."
                      className="w-full p-2 text-xs font-bold rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-200 focus:outline-none"
                    />
                    <p className="text-[10px] text-blue-700 font-bold">
                      Sisa Tagihan: {formatIDR(Math.max(0, grandTotal - inputAmountPaid))}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Total Dibayar (Lunas)</label>
                    <div className="p-2 text-xs font-extrabold text-emerald-700 bg-white border border-emerald-200 rounded-lg">
                      {formatIDR(grandTotal)}
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Metode Pembayaran (Akun COA)</label>
                  <select
                    value={paymentAccountId}
                    onChange={e => {
                      const accId = e.target.value
                      setPaymentAccountId(accId)
                      const matched = paymentAccounts.find(a => a.id === accId)
                      if (matched) setPaymentMethod(matched.name)
                    }}
                    className="w-full p-2 text-xs font-bold rounded-lg border border-slate-200 bg-white focus:outline-none"
                  >
                    {paymentAccounts.length > 0 ? (
                      paymentAccounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          [{acc.code}] {acc.name}
                        </option>
                      ))
                    ) : (
                      <option value="">{paymentMethod || 'Bank Transfer (Default)'}</option>
                    )}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Tanggal Bayar</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)}
                    className="w-full p-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 2.5: Shipping Details (Courier & Resi) */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#70706E]">Kurir Pengiriman (Opsional)</label>
              <select
                value={courier}
                onChange={e => setCourier(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] bg-white focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
              >
                <option value="">-- Pilih Kurir --</option>
                <option value="JNE">JNE</option>
                <option value="J&T">J&T</option>
                <option value="Sicepat">Sicepat</option>
                <option value="POS">POS Indonesia</option>
                <option value="Tiki">TIKI</option>
                <option value="Anteraja">Anteraja</option>
                <option value="Wahana">Wahana</option>
                <option value="SPX">SPX (Shopee Xpress)</option>
                <option value="Lainnya">Lainnya / Custom</option>
              </select>
              {courier === 'Lainnya' && (
                <input
                  type="text"
                  placeholder="Masukkan nama kurir custom..."
                  value={customCourier}
                  onChange={e => setCustomCourier(e.target.value)}
                  className="w-full mt-2 p-2.5 text-xs rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                />
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#70706E]">Nomor Resi (Opsional)</label>
              <input
                type="text"
                placeholder="Masukkan nomor resi pengiriman..."
                value={trackingNumber}
                onChange={e => setTrackingNumber(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all uppercase font-mono"
              />
            </div>
          </div>

          {/* Section 2.7: Opsi Lanjutan & Sumber Pesanan (Attribution) */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setShowAdvancedSource(!showAdvancedSource)}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🎯</span>
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">
                    Sumber Pesanan & Opsi Lanjutan (Attribution)
                  </h2>
                  <p className="text-[10px] text-[#70706E]">
                    Kanal penjualan: <span className="font-bold text-[#1C1C1A]">{sourcePlatform}</span> {sourceOrderRef && `• Ref: ${sourceOrderRef}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-xs font-bold text-[#1E40AF] hover:underline"
              >
                {showAdvancedSource ? 'Sembunyikan ▲' : 'Buka Opsi Lanjutan ▼'}
              </button>
            </div>

            {showAdvancedSource && (
              <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-200">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#70706E]">Kanal Sumber Pesanan (Sales Channel)</label>
                  <select
                    value={sourcePlatform}
                    onChange={e => setSourcePlatform(e.target.value)}
                    className="w-full p-2.5 text-xs font-bold rounded-xl border border-[#EBEBEA] bg-white focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                  >
                    <option value="Invoice">📄 Invoice (Faktur Langsung - Default)</option>
                    <option value="WhatsApp">📱 WhatsApp / Chat CS</option>
                    <option value="Instagram">📸 Instagram Direct Message</option>
                    <option value="Manual">💼 Manual (Sales Lapangan / B2B)</option>
                    <option value="Shopee">🛍️ Shopee</option>
                    <option value="Tokopedia">🟢 Tokopedia</option>
                    <option value="TikTok">🎵 TikTok Shop</option>
                    <option value="WooCommerce">🌐 WooCommerce / Website</option>
                    <option value="Lainnya">✏️ Lainnya (Kustom)</option>
                  </select>
                  {sourcePlatform === 'Lainnya' && (
                    <input
                      type="text"
                      placeholder="Masukkan nama kanal kustom..."
                      value={customSourcePlatform}
                      onChange={e => setCustomSourcePlatform(e.target.value)}
                      className="w-full mt-2 p-2.5 text-xs rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                    />
                  )}
                  <p className="text-[10px] text-[#70706E]">Data ini akan diagregasi pada Laporan Sumber Penjualan.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#70706E]">No. Referensi / PO Asal (Opsional)</label>
                  <input
                    type="text"
                    placeholder="Misal: PO-CLIENT-001, ID Order Marketplace..."
                    value={sourceOrderRef}
                    onChange={e => setSourceOrderRef(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all font-mono"
                  />
                  <p className="text-[10px] text-[#70706E]">Nomor referensi ini dicantumkan pada dokumen cetak faktur.</p>
                </div>

                {/* UTM Source */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#70706E]">Sumber Iklan / Traffic (UTM Source - Opsional)</label>
                  <input
                    type="text"
                    placeholder="Misal: meta_ads, google, tiktok_ads, influencer..."
                    value={utmSource}
                    onChange={e => setUtmSource(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                  />
                </div>

                {/* UTM Campaign */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#70706E]">Nama Kampanye (UTM Campaign - Opsional)</label>
                  <input
                    type="text"
                    placeholder="Misal: promo_11_11, launching_b2b..."
                    value={utmCampaign}
                    onChange={e => setUtmCampaign(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Line Items */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">Detail Item Tagihan</h2>

            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="flex flex-col md:flex-row gap-3 items-start md:items-start border-b border-gray-100 pb-3 md:pb-0 md:border-none pt-4 md:pt-0">

                  {/* Item name input with product search */}
                  <div className="w-full md:flex-1 relative">
                    <ProductSelectCombobox
                      products={comboboxProducts}
                      selectedProductId={item.product_id}
                      selectedVariantId={item.variant_id}
                      selectedProductName={item.name}
                      disabled={isFinancialsLocked}
                      onSelectProduct={p => {
                        if (isFinancialsLocked) return
                        handleItemFieldsChange(idx, {
                          product_id: p.id,
                          variant_id: p.variant_id || null,
                          cost_price: p.cost_price ?? null,
                          name: p.name,
                          price: p.price,
                          sku: p.sku || '',
                          discount: 0
                        })
                      }}
                      onClearProduct={() => {
                        if (isFinancialsLocked) return
                        handleItemFieldsChange(idx, {
                          product_id: null,
                          variant_id: null,
                          cost_price: null,
                          name: '',
                          price: 0,
                          sku: '',
                          discount: 0
                        })
                      }}
                      onAddNewProduct={query => {
                        if (isFinancialsLocked) return
                        setQuickAddRowIndex(idx)
                        setQuickAddName(query)
                        setIsQuickAddModalOpen(true)
                      }}
                      placeholder="Nama Produk"
                    />

                    {/* Indented description field to show it is a sub-part of the item */}
                    <div className="pl-3 border-l-2 border-slate-200 mt-1.5 ml-2">
                      <input
                        type="text"
                        disabled={isFinancialsLocked}
                        placeholder="Deskripsi / Detail Item"
                        value={item.description || ''}
                        onChange={e => handleItemFieldChange(idx, 'description', e.target.value)}
                        className="w-full p-1.5 text-xs rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none text-[#70706E]"
                      />
                    </div>
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

                  <div className="flex gap-2 w-full md:w-64 items-start">
                    <div className="w-16">
                      <input
                        type="number"
                        min="1"
                        disabled={isFinancialsLocked}
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={e => handleItemFieldChange(idx, 'quantity', e.target.value)}
                        onWheel={e => e.currentTarget.blur()}
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
                        onWheel={e => e.currentTarget.blur()}
                        className="w-full p-2 text-sm text-right rounded-xl border border-[#EBEBEA] disabled:bg-gray-50 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                      />
                      
                      {!showItemDiscount[idx] && !isFinancialsLocked && (
                        <div className="mt-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setShowItemDiscount(prev => ({ ...prev, [idx]: true }))}
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1"
                            title="Tambah Diskon/Potongan"
                          >
                            🏷️ + Diskon
                          </button>
                        </div>
                      )}

                      {showItemDiscount[idx] && (
                        <div className="mt-1.5 flex flex-col items-end gap-1">
                          <span className="text-[10px] text-rose-600 font-bold">Potongan / Diskon (Rp):</span>
                          <div className="flex items-center gap-1.5 w-full">
                            <input
                              type="number"
                              min="0"
                              disabled={isFinancialsLocked}
                              placeholder="0"
                              value={item.discount || ''}
                              onChange={e => handleItemFieldChange(idx, 'discount', e.target.value)}
                              onWheel={e => e.currentTarget.blur()}
                              className="w-full p-1.5 text-right text-xs rounded-xl border border-rose-200 disabled:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-rose-400 text-rose-700 bg-rose-50/50"
                            />
                            {!isFinancialsLocked && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleItemFieldChange(idx, 'discount', 0)
                                  setShowItemDiscount(prev => ({ ...prev, [idx]: false }))
                                }}
                                className="text-gray-400 hover:text-rose-500 text-sm p-1 font-bold"
                                title="Hapus diskon"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-right w-full md:w-28 font-bold text-slate-700 hidden md:block md:pt-2">
                    {Number(item.discount || 0) > 0 && (
                      <div className="text-[10px] text-gray-400 line-through">
                        {formatIDR(item.price * item.quantity)}
                      </div>
                    )}
                    <div className={Number(item.discount || 0) > 0 ? 'text-rose-700' : ''}>
                      {formatIDR((Number(item.price || 0) - Number(item.discount || 0)) * Number(item.quantity || 1))}
                    </div>
                  </div>

                  {!isFinancialsLocked && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItemRow(idx)}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg self-end md:self-start md:mt-0.5 transition-colors"
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

            {/* Billing Summary Block below line items */}
            <div className="border-t border-[#EBEBEA] pt-4 mt-6">
              <div className="flex flex-col items-end">
                <div className="w-full md:w-96 space-y-3">
                  <div className="flex justify-between items-center border-b border-[#EBEBEA] pb-2 mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">Ringkasan Tagihan</h3>
                    {!isFinancialsLocked && (
                      <div className="flex gap-1.5">
                        {!showShippingInput && (
                          <button
                            type="button"
                            onClick={() => setShowShippingInput(true)}
                            className="px-2 py-1 text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
                          >
                            ➕ Biaya Pengiriman
                          </button>
                        )}
                        {!showOtherFeesInput && (
                          <button
                            type="button"
                            onClick={() => setShowOtherFeesInput(true)}
                            className="px-2 py-1 text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
                          >
                            ➕ Biaya Lainnya
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="divide-y divide-[#EBEBEA] text-xs font-semibold text-[#70706E]">
                    <div className="py-2 flex justify-between">
                      <span>Subtotal</span>
                      <span className="text-[#1C1C1A] font-bold">{formatIDR(subtotal)}</span>
                    </div>

                    {discountAmount > 0 && (
                      <div className="py-2 flex justify-between text-rose-600">
                        <span>Total Potongan / Diskon</span>
                        <span className="font-bold">-{formatIDR(discountAmount)}</span>
                      </div>
                    )}

                    {(showShippingInput || (isFinancialsLocked && shippingCost > 0)) && (
                      <div className="py-2 flex justify-between items-center gap-3">
                        <span>Biaya Pengiriman (Rp)</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            disabled={isFinancialsLocked}
                            value={shippingCost || ''}
                            onChange={e => setShippingCost(Math.max(0, Number(e.target.value)))}
                            onWheel={e => e.currentTarget.blur()}
                            className="w-28 p-1 text-right text-xs rounded-lg border border-[#EBEBEA] disabled:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          {!isFinancialsLocked && (
                            <button
                              type="button"
                              onClick={() => {
                                setShippingCost(0)
                                setShowShippingInput(false)
                              }}
                              className="text-gray-400 hover:text-rose-500 text-xs font-bold"
                              title="Hapus biaya pengiriman"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {(showOtherFeesInput || (isFinancialsLocked && otherFees > 0)) && (
                      <div className="py-2 flex justify-between items-center gap-3">
                        <span>Biaya Lainnya (Rp)</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            disabled={isFinancialsLocked}
                            value={otherFees || ''}
                            onChange={e => setOtherFees(Math.max(0, Number(e.target.value)))}
                            onWheel={e => e.currentTarget.blur()}
                            className="w-28 p-1 text-right text-xs rounded-lg border border-[#EBEBEA] disabled:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          {!isFinancialsLocked && (
                            <button
                              type="button"
                              onClick={() => {
                                setOtherFees(0)
                                setShowOtherFeesInput(false)
                              }}
                              className="text-gray-400 hover:text-rose-500 text-xs font-bold"
                              title="Hapus biaya lainnya"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="py-2.5 flex justify-between text-sm font-black text-[#1C1C1A] border-t-2 border-slate-800">
                      <span>Total Akhir</span>
                      <span className="text-[#1E40AF]">{formatIDR(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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

        {/* Actions & Customization (Right) */}
        <div className="space-y-6">
          {/* Action Panel */}
          <div className="p-4 bg-slate-50 border border-[#EBEBEA] rounded-2xl space-y-2.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setSubmittingType('save')
                handleSubmit()
              }}
              className="w-full flex justify-center items-center gap-2 py-3 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 rounded-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && submittingType === 'save' ? (
                <><svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Menyimpan...</>
              ) : (
                <>💾 Simpan Perubahan Faktur</>
              )}
            </button>

            {!isCancelled && (
              <div className="pt-2 border-t border-slate-200/80 space-y-2">
                {!isFinancialsLocked && (
                  <>
                    <p className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Aksi Cepat Status:</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          setInvoiceDocStatus('processing')
                          setSubmittingType('processing')
                          handleSubmit('processing')
                        }}
                        className="py-2 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-all cursor-pointer"
                      >
                        🚀 Terbitkan
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          setInvoiceDocStatus('shipped')
                          setSubmittingType('shipped')
                          handleSubmit('shipped')
                        }}
                        className="py-2 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-all cursor-pointer"
                      >
                        📦 Dikirim
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          setInvoiceDocStatus('pending')
                          setSubmittingType('pending')
                          handleSubmit('pending')
                        }}
                        className="py-2 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-all cursor-pointer"
                      >
                        📝 Draft
                      </button>
                    </div>
                  </>
                )}
                {paymentSettlementStatus !== 'paid' && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setInvoiceDocStatus('completed')
                      setPaymentSettlementStatus('paid')
                      setInputAmountPaid(grandTotal)
                      setSubmittingType('paid')
                      handleSubmit('completed', 'paid', grandTotal)
                    }}
                    className="w-full flex justify-center items-center gap-2 py-2 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                  >
                    {submitting && submittingType === 'paid' ? (
                      <><svg className="animate-spin h-3.5 w-3.5 text-emerald-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Memproses Pelunasan...</>
                    ) : (
                      <>💰 Tandai Lunas Seketika</>
                    )}
                  </button>
                )}
              </div>
            )}

            <Link
              href={`/orders/invoices/${invoiceId}`}
              className="block w-full py-2 text-xs text-center font-bold text-[#70706E] hover:text-[#1C1C1A] transition-colors"
            >
              Batal
            </Link>
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

                <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                  <input
                    type="checkbox"
                    checked={showAddress}
                    onChange={e => setShowAddress(e.target.checked)}
                    className="rounded border-[#EBEBEA] text-[#1E40AF] focus:ring-[#1E40AF]"
                  />
                  <span>Tampilkan Alamat Customer</span>
                </label>

                <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                  <input
                    type="checkbox"
                    checked={showShipping}
                    onChange={e => setShowShipping(e.target.checked)}
                    className="rounded border-[#EBEBEA] text-[#1E40AF] focus:ring-[#1E40AF]"
                  />
                  <span>Tampilkan Kurir & Resi</span>
                </label>
              </div>
            </div>
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
                <label className="text-xs font-bold text-[#70706E]">Metode Pembayaran (Akun Kas/Bank COA)</label>
                <select
                  value={paymentAccountId}
                  onChange={e => {
                    const accId = e.target.value
                    setPaymentAccountId(accId)
                    const matched = paymentAccounts.find(a => a.id === accId)
                    if (matched) setPaymentMethod(matched.name)
                  }}
                  className="w-full p-2.5 text-xs font-bold rounded-xl border border-[#EBEBEA] bg-white focus:outline-none"
                >
                  {paymentAccounts.length > 0 ? (
                    paymentAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        [{acc.code}] {acc.name}
                      </option>
                    ))
                  ) : (
                    <option value="">{paymentMethod || 'Bank Transfer (Default)'}</option>
                  )}
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
                onClick={() => {
                  setSubmittingType('completed');
                  handleSubmit('completed');
                }}
                disabled={submitting}
                className="flex-1 flex justify-center items-center gap-2 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && submittingType === 'completed' ? (
                  <><svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Memproses...</>
                ) : (
                  <>Konfirmasi Lunas</>
                )}
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
