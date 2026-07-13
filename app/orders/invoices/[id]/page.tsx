"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type Customer = {
  id: string
  name: string
  phone: string
  email: string | null
  address_data?: any
}

type InvoiceItem = {
  id: string | number
  name: string
  price: number
  quantity: number
  sku?: string
  description?: string
  subtotal: string
  total: string
  product_id?: string | null
  discount?: number
}

type Invoice = {
  id: string
  order_number: string
  order_date: string
  grand_total: number
  subtotal: number
  discount_amount: number
  shipping_cost: number
  other_fees: number
  status: 'pending' | 'processing' | 'completed' | 'cancelled'
  payment_method: string | null
  items_json: InvoiceItem[] | null
  raw_source_data: {
    due_date: string | null
    payment_terms: string
    notes: string
    custom_title?: string
    custom_subtitle?: string
    custom_notes?: string
    accent_color?: string
    layout_style?: string
    show_sku?: boolean
    show_description?: boolean
    show_notes?: boolean
    show_address?: boolean
    show_shipping?: boolean
    meta_data?: Array<{ key: string; value: any }>
  } | null
  customers: Customer | null
  user_id?: string | null
  creator?: {
    id: string
    full_name: string
    email: string
  } | null
}

type JournalLine = {
  id: string
  debit: number
  credit: number
  accounts: {
    code: string
    name: string
  } | null
}

type Transaction = {
  id: string
  date: string
  description: string
  journal_lines: JournalLine[]
}

const formatIDR = (value: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value)
}


const parseAddressLines = (invoice: Invoice | null) => {
  if (!invoice) return ''
  const lines: string[] = []
  
  if (invoice.customers) {
    lines.push(invoice.customers.name)
  } else {
    lines.push('Customer Umum')
  }

  if (invoice.customers?.address_data) {
    const addr = invoice.customers.address_data
    if (addr.address_line1) lines.push(addr.address_line1)
    if (addr.address_line2) lines.push(addr.address_line2)
    
    const line3Parts = []
    if (addr.subdistrict) line3Parts.push(`Kel. / Kec. ${addr.subdistrict}`)
    if (addr.city) line3Parts.push(addr.city)
    if (line3Parts.length > 0) lines.push(line3Parts.join(', '))

    const line4Parts = []
    if (addr.state) line4Parts.push(addr.state)
    if (addr.postcode) line4Parts.push(addr.postcode)
    if (line4Parts.length > 0) lines.push(line4Parts.join(' '))
  } else {
    const raw = (invoice.raw_source_data || {}) as any
    const s = raw.shipping || raw.billing || {}
    const m = raw.meta_data || []
    const kecamatan = m.find((i: any) => i.key === 'shipping_kecamatan')?.value || 
                      m.find((i: any) => i.key === 'billing_kecamatan')?.value || ""

    if (s.address_1) {
      lines.push(s.address_1)
      if (s.address_2) lines.push(s.address_2)
      
      const line3Parts = []
      if (kecamatan) line3Parts.push(`Kec. ${kecamatan}`)
      if (s.city) line3Parts.push(s.city)
      if (line3Parts.length > 0) lines.push(line3Parts.join(', '))

      const line4Parts = []
      if (s.state) line4Parts.push(s.state)
      if (s.postcode) line4Parts.push(s.postcode)
      if (line4Parts.length > 0) lines.push(line4Parts.join(' '))
    }
  }

  if (invoice.customers?.phone) {
    lines.push(`HP: ${invoice.customers.phone}`)
  } else {
    const raw = (invoice.raw_source_data || {}) as any
    const phone = raw.billing?.phone || raw.shipping?.phone || ''
    if (phone) lines.push(`HP: ${phone}`)
  }

  return lines.join('\n')
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

export default function InvoiceDetailPage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string

  // State
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [businessName, setBusinessName] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'actions' | 'design' | 'ledger'>('actions')
  const [currentUserProfile, setCurrentUserProfile] = useState<{ id: string; role: string } | null>(null)

  const canEdit = useMemo(() => {
    if (!currentUserProfile || !invoice) return false
    if (currentUserProfile.role === 'admin') return true
    if (!invoice.user_id) return true // Legacy invoice has no creator, so anyone can edit/claim it
    return invoice.user_id === currentUserProfile.id
  }, [currentUserProfile, invoice])

  // Payment Record Modal
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false)
  const [paymentMethod, setPaymentMethod] = useState<string>('Bank Transfer')
  const [paymentDate, setPaymentDate] = useState<string>('')

  // Customize inputs (starts from invoice details)
  const [customTitle, setCustomTitle] = useState<string>('INVOICE')
  const [customSubtitle, setCustomSubtitle] = useState<string>('')
  const [customNotes, setCustomNotes] = useState<string>('')
  const [accentColor, setAccentColor] = useState<string>('slate')
  const [layoutStyle, setLayoutStyle] = useState<string>('modern')
  const [showSku, setShowSku] = useState<boolean>(true)
  const [showDescription, setShowDescription] = useState<boolean>(true)
  const [showNotes, setShowNotes] = useState<boolean>(true)
  const [showAddress, setShowAddress] = useState<boolean>(true)
  const [showShipping, setShowShipping] = useState<boolean>(true)

  const [courier, setCourier] = useState<string>('')
  const [customCourier, setCustomCourier] = useState<string>('')
  const [trackingNumber, setTrackingNumber] = useState<string>('')

  // Ledger Journal Lines State
  const [ledgerTransactions, setLedgerTransactions] = useState<Transaction[]>([])
  const [loadingLedger, setLoadingLedger] = useState<boolean>(false)

  // Shipping Label print state
  const [labelShopName, setLabelShopName] = useState<string>('')
  const [labelSenderCity, setLabelSenderCity] = useState<string>('')
  const [labelSenderPhone, setLabelSenderPhone] = useState<string>('')
  const [labelRecipientAddress, setLabelRecipientAddress] = useState<string>('')
  const [labelFooterBody, setLabelFooterBody] = useState<string>('')
  const [isPrintingLabel, setIsPrintingLabel] = useState<boolean>(false)

  // Fetch Invoice Details
  const fetchInvoiceDetails = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, active_business_id, businesses!active_business_id(name)')
        .eq('id', user.id)
        .single()

      if (!profile?.active_business_id) return
      setBusinessName((profile.businesses as { name?: string } | null)?.name || 'Bisnis Saya')
      setCurrentUserProfile({ id: profile.id, role: profile.role || 'staff' })

      const response = await fetch(`/api/orders/invoices/${invoiceId}`)
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Gagal memuat invoice')
      }

      const invData = result.invoice as Invoice
      setInvoice(invData)

      // Initialize Customization State
      const raw = invData.raw_source_data
      setCustomTitle(raw?.custom_title || 'INVOICE')
      setCustomSubtitle(raw?.custom_subtitle || '')
      setCustomNotes(raw?.custom_notes || raw?.notes || '')
      setAccentColor(raw?.accent_color || 'slate')
      setLayoutStyle(raw?.layout_style || 'modern')
      setShowSku(raw?.show_sku !== undefined ? raw.show_sku : true)
      setShowDescription(raw?.show_description !== undefined ? raw.show_description : true)
      setShowNotes(raw?.show_notes !== undefined ? raw.show_notes : true)
      setShowAddress(raw?.show_address !== undefined ? raw.show_address : true)
      setShowShipping(raw?.show_shipping !== undefined ? raw.show_shipping : true)

      const meta = raw?.meta_data || []
      const foundCourier = meta.find((m: any) => m.key === 'shapeup_kurir_awb')?.value || 
                           meta.find((m: any) => m.key === '_kurir_awb')?.value || ''
      const foundTracking = meta.find((m: any) => m.key === 'shapeup_resi_awb')?.value || 
                            meta.find((m: any) => m.key === '_resi_awb')?.value || ''

      const standardCouriers = ['JNE', 'J&T', 'Sicepat', 'POS', 'Tiki', 'Anteraja', 'Wahana']
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

    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memuat detail invoice')
    } finally {
      setLoading(false)
    }
  }, [invoiceId, supabase])

  // Fetch Ledger Transactions
  const fetchLedger = useCallback(async () => {
    setLoadingLedger(true)
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          id,
          date,
          description,
          journal_lines (
            id,
            debit,
            credit,
            accounts (
              code,
              name
            )
          )
        `)
        .eq('order_id', invoiceId)
        .order('date', { ascending: true })

      if (error) throw error
      setLedgerTransactions((data || []) as unknown as Transaction[])
    } catch (e) {
      console.error('Error fetching ledger journals:', e)
    } finally {
      setLoadingLedger(false)
    }
  }, [invoiceId, supabase])

  useEffect(() => {
    fetchInvoiceDetails()
  }, [fetchInvoiceDetails])

  // Fetch ledger when ledger tab opens
  useEffect(() => {
    if (activeTab === 'ledger') {
      fetchLedger()
    }
  }, [activeTab, fetchLedger])

  // Set default payment date on mount/modal open
  useEffect(() => {
    const today = new Date()
    setPaymentDate(today.toISOString().split('T')[0])
  }, [showPaymentModal])

  // Load persistent fields from localStorage on mount/when invoice changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedShop = localStorage.getItem('shapeup_label_shop_name')
      const storedCity = localStorage.getItem('shapeup_label_sender_city')
      const storedPhone = localStorage.getItem('shapeup_label_sender_phone')
      const storedFooterBody = localStorage.getItem('shapeup_label_footer_body')
      
      setLabelShopName(storedShop || businessName || "Tan'eem")
      setLabelSenderCity(storedCity || 'Kudus')
      setLabelSenderPhone(storedPhone || '0812-2500-1717')
      setLabelFooterBody(storedFooterBody || `@taneem_official  •  taneem_id\ntaneemlive  •  taneem_official\n0821-1545-4543 / 0812-3755-7090`)
    }
  }, [businessName])

  // Update recipient address automatically when invoice loads
  useEffect(() => {
    if (invoice) {
      const parsedAddr = parseAddressLines(invoice)
      setLabelRecipientAddress(parsedAddr)
    }
  }, [invoice])

  const handleLabelShopNameChange = (val: string) => {
    setLabelShopName(val)
    localStorage.setItem('shapeup_label_shop_name', val)
  }
  const handleLabelSenderCityChange = (val: string) => {
    setLabelSenderCity(val)
    localStorage.setItem('shapeup_label_sender_city', val)
  }
  const handleLabelSenderPhoneChange = (val: string) => {
    setLabelSenderPhone(val)
    localStorage.setItem('shapeup_label_sender_phone', val)
  }
  const handleLabelFooterBodyChange = (val: string) => {
    setLabelFooterBody(val)
    localStorage.setItem('shapeup_label_footer_body', val)
  }

  const handlePrintLabelDirectly = () => {
    if (!invoice) return

    const iframe = document.getElementById('print-label-iframe') as HTMLIFrameElement
    if (!iframe) return

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) return

    const courierResiInfo = getLabelShippingInfo()
    const itemsHtml = (invoice.items_json || []).map((item: any) => `
      <tr style="border-top: 0.2mm dashed rgba(0,0,0,0.3);">
        <td style="padding: 1mm 1mm 1mm 0; text-align: left; vertical-align: top;">
          <div style="font-weight: bold; font-size: 8pt; color: black; font-family: monospace;">${item.name || '-'}</div>
          ${showDescription && item.description ? `<div style="font-size: 6.5pt; color: #4b5563; margin-top: 0.5mm; line-height: 1.2; font-family: monospace; text-transform: none;">${item.description}</div>` : ''}
        </td>
        ${showSku ? `<td style="padding: 1mm 0; font-family: monospace; font-size: 7pt; color: #374151; vertical-align: top;">${item.sku || '-'}</td>` : ''}
        <td style="padding: 1mm 0; text-align: center; font-weight: bold; font-family: monospace; font-size: 8pt; vertical-align: top; width: 18mm;">${item.quantity}</td>
      </tr>
    `).join('')

    const notesHtml = showNotes && customNotes ? `
      <div style="margin: 2mm 0; font-size: 6.5pt; font-family: monospace; color: black; line-height: 1.2; text-align: left;">
        <div style="font-weight: bold; text-transform: uppercase; margin-bottom: 0.5mm;">Catatan Pembayaran & Informasi Tambahan:</div>
        <div style="white-space: pre-wrap; padding: 1mm; border: 0.2mm dashed rgba(0,0,0,0.3); border-radius: 2px; text-transform: none;">${customNotes}</div>
      </div>
    ` : ''

    const courierHtml = courierResiInfo ? `
      <div style="font-size: 11pt; font-weight: 900; font-family: monospace; margin-top: 3mm; border-top: 0.3mm dashed rgba(0,0,0,0.4); padding-top: 2mm; text-transform: uppercase; text-align: left;">
        ${courierResiInfo}
      </div>
    ` : ''

    const recipientLines = labelRecipientAddress.split('\n').map(line => line.trim())
    const recipientName = recipientLines[0] || ''
    const recipientAddressDetails = recipientLines.slice(1).join('\n')

    const htmlContent = `
      <html>
        <head>
          <title>Cetak Label Pengiriman - ${invoice.order_number}</title>
          <style>
            @page {
              size: 100mm 150mm;
              margin: 0 !important;
            }
            html, body {
              background-color: white !important;
              color: black !important;
              margin: 0 !important;
              padding: 0 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              width: 100mm;
              height: 150mm;
              box-sizing: border-box;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .wrapper {
              width: 100%;
              padding-top: 20pt;
              padding-left: 4mm;
              padding-right: 4mm;
            }
            .text-center { text-align: center; }
            .font-bold { font-weight: bold; }
            .font-mono { font-family: monospace; }
            .uppercase { text-transform: uppercase; }
            .w-full { width: 100%; }
            .flex { display: flex; }
            .justify-between { justify-content: space-between; }
            .items-center { align-items: center; }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <!-- Header (Shop Name & Sender) -->
            <div class="text-center">
              <div style="font-size: 18pt; font-weight: 900; text-transform: uppercase; margin: 0; padding: 0; line-height: 1;">
                ${labelShopName}
              </div>
              <div style="border-top: 0.6mm solid black; width: 100%; margin-top: 1mm; margin-bottom: 1.5mm;"></div>
              <div style="font-size: 8.5pt; font-weight: bold; font-family: monospace; text-transform: uppercase; letter-spacing: -0.2px;">
                PENGIRIM: ${labelShopName}, ${labelSenderCity} • ${labelSenderPhone}
              </div>
              <div style="border-bottom: 0.4mm solid black; width: 100%; margin-top: 1.5mm; margin-bottom: 2mm;"></div>
            </div>

            <!-- Tanggal & No Invoice -->
            <div class="flex justify-between items-center" style="font-size: 8pt; font-family: monospace; border-bottom: 0.2mm dashed rgba(0,0,0,0.4); padding-bottom: 1.5mm; margin-bottom: 2mm;">
              <div>${new Date(invoice.order_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div class="font-bold">#${invoice.order_number}</div>
            </div>

            <!-- Recipient details -->
            <div class="font-mono" style="line-height: 1.4; margin: 1.5mm 0; text-align: left;">
              <div style="font-weight: bold; font-size: 7.5pt; letter-spacing: 1px; color: #70706e; margin-bottom: 1mm; text-transform: uppercase;">
                KEPADA:
              </div>
              <div>
                <!-- Name -->
                <div style="font-weight: 900; font-size: 8pt; color: black;">${recipientName}</div>
                <!-- Address details -->
                <div style="white-space: pre-wrap; font-weight: normal; font-size: 6.5pt; color: black; margin-top: 0.5mm;">${recipientAddressDetails}</div>
              </div>
              ${courierHtml}
            </div>

            <!-- Product Table -->
            <div style="margin: 2mm 0; font-size: 8pt; font-family: monospace;">
              <div style="border-top: 0.3mm solid black; margin-bottom: 1mm;"></div>
              <table class="w-full" style="text-align: left; border-collapse: collapse; text-transform: uppercase;">
                <thead>
                  <tr style="font-weight: bold; font-size: 7.5pt; border-bottom: 0.3mm solid black;">
                    <th style="padding-bottom: 1mm; padding-top: 0.5mm; text-align: left;">Item / Deskripsi</th>
                    ${showSku ? `<th style="padding-bottom: 1mm; padding-top: 0.5mm; width: 25mm; text-align: left;">SKU</th>` : ''}
                    <th style="padding-bottom: 1mm; padding-top: 0.5mm; width: 18mm; text-align: center;">Kuantitas</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
              <div style="border-bottom: 0.3mm solid black; margin-top: 1mm;"></div>
            </div>

            <!-- Payment Notes & Additional Info -->
            ${notesHtml}

            <!-- Footer -->
            <div style="margin-top: 8mm; font-size: 8pt; font-family: monospace; line-height: 1.4; white-space: pre-wrap; text-align: center;">${labelFooterBody.replace(/\n/g, '<br>')}</div>
          </div>
        </body>
      </html>
    `

    iframeDoc.open()
    iframeDoc.write(htmlContent)
    iframeDoc.close()

    setTimeout(() => {
      if (iframe.contentWindow) {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
      }
    }, 100)
  }

  // Save customization changes to server
  const handleSaveCustomization = async () => {
    setSubmitting(true)
    setErrorMessage('')
    try {
      const response = await fetch(`/api/orders/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_title: customTitle,
          custom_subtitle: customSubtitle,
          custom_notes: customNotes,
          accent_color: accentColor,
          layout_style: layoutStyle,
          show_sku: showSku,
          show_description: showDescription,
          show_notes: showNotes,
          show_address: showAddress,
          show_shipping: showShipping
        })
      })

      if (!response.ok) {
        const resJson = await response.json()
        throw new Error(resJson.error || 'Gagal menyimpan kustomisasi')
      }

      // Reload
      fetchInvoiceDetails()
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Record Payment
  const handleRecordPayment = async () => {
    setSubmitting(true)
    setErrorMessage('')
    try {
      const response = await fetch(`/api/orders/invoices/${invoiceId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: paymentMethod,
          payment_date: paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString()
        })
      })

      if (!response.ok) {
        const resJson = await response.json()
        throw new Error(resJson.error || 'Gagal mencatat pembayaran')
      }

      setShowPaymentModal(false)
      fetchInvoiceDetails()
      fetchLedger()
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Approve & Publish Invoice (Draft -> Processing)
  const handleApproveInvoice = async () => {
    setSubmitting(true)
    setErrorMessage('')
    try {
      const response = await fetch(`/api/orders/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'processing' })
      })

      if (!response.ok) {
        const resJson = await response.json()
        throw new Error(resJson.error || 'Gagal menerbitkan invoice')
      }

      fetchInvoiceDetails()
      fetchLedger()
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Cancel Invoice
  const handleCancelInvoice = async () => {
    if (!confirm('Apakah Anda yakin ingin membatalkan invoice ini? Status pembatalan bersifat permanen dan jurnal pembalikan akan otomatis dibuat.')) {
      return
    }

    setSubmitting(true)
    setErrorMessage('')
    try {
      const response = await fetch(`/api/orders/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' })
      })

      if (!response.ok) {
        const resJson = await response.json()
        throw new Error(resJson.error || 'Gagal membatalkan invoice')
      }

      fetchInvoiceDetails()
      fetchLedger()
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Delete Invoice (Draft only)
  const handleDeleteInvoice = async () => {
    if (!confirm('Apakah Anda yakin ingin menghapus invoice Draft ini secara permanen dari database?')) {
      return
    }

    setSubmitting(true)
    setErrorMessage('')
    try {
      const response = await fetch(`/api/orders/invoices/${invoiceId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const resJson = await response.json()
        throw new Error(resJson.error || 'Gagal menghapus invoice')
      }

      router.push('/orders/invoices')
      router.refresh()
    } catch (err: any) {
      setErrorMessage(err.message)
      setSubmitting(false)
    }
  }

  // Accent Colors Mapping
  const colorThemes: Record<string, { primary: string; text: string; bg: string; border: string }> = {
    slate: { primary: 'bg-slate-700', text: 'text-slate-800', bg: 'bg-slate-50', border: 'border-slate-300' },
    blue: { primary: 'bg-blue-600', text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-300' },
    emerald: { primary: 'bg-emerald-600', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300' },
    amber: { primary: 'bg-amber-600', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300' },
    indigo: { primary: 'bg-indigo-600', text: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-300' },
    rose: { primary: 'bg-rose-600', text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-300' }
  }

  const activeTheme = colorThemes[accentColor] || colorThemes.slate

  // Layout-based Table style
  const getTableStyle = () => {
    switch (layoutStyle) {
      case 'classic':
        return 'w-full text-left border-collapse border border-gray-300'
      case 'minimal':
        return 'w-full text-left border-collapse'
      case 'modern':
      default:
        return 'w-full text-left border-collapse border-b border-gray-200'
    }
  }

  const getThStyle = () => {
    switch (layoutStyle) {
      case 'classic':
        return 'p-3 text-xs font-bold uppercase tracking-wider text-slate-800 border border-gray-300 bg-gray-50'
      case 'minimal':
        return 'py-3 text-xs font-bold uppercase tracking-wider text-[#70706E] border-b border-gray-100'
      case 'modern':
      default:
        return `p-3.5 text-xs font-black uppercase tracking-wider text-white ${activeTheme.primary} rounded-t-sm`
    }
  }

  const getTdStyle = () => {
    switch (layoutStyle) {
      case 'classic':
        return 'p-3 text-sm text-slate-800 border border-gray-300'
      case 'minimal':
        return 'py-3 text-sm text-[#1C1C1A] border-b border-gray-100'
      case 'modern':
      default:
        return 'p-3 text-sm text-[#1C1C1A] border-b border-gray-100'
    }
  }

  const getInvoiceAddress = () => {
    if (invoice?.customers?.address_data) {
      return formatAddress(invoice.customers.address_data)
    }
    
    const raw = (invoice?.raw_source_data || {}) as any
    const s = raw.shipping || raw.billing || {}
    const m = raw.meta_data || []

    const kecamatan = m.find((i: any) => i.key === 'shipping_kecamatan')?.value || 
                      m.find((i: any) => i.key === 'billing_kecamatan')?.value || ""

    if (s.address_1) {
      const parts = [
        s.address_1,
        s.address_2,
        kecamatan,
        s.city,
        s.state,
        s.postcode
      ].filter(Boolean)
      return parts.join(', ')
    }
    
    return null
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-3">
        <div className="w-10 h-10 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin"></div>
        <p className="text-sm font-bold text-[#70706E]">Memuat data invoice...</p>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="text-center py-20">
        <p className="text-5xl mb-4">⚠️</p>
        <p className="text-base font-bold text-[#1C1C1A]">Invoice Tidak Ditemukan</p>
        <p className="text-xs text-[#70706E] mt-1">Invoice tidak tersedia atau Anda tidak memiliki izin akses.</p>
        <Link href="/orders/invoices" className="inline-block mt-4 text-xs font-bold text-[#1E40AF] hover:underline"> Kembali ke daftar </Link>
      </div>
    )
  }

  const getLabelShippingInfo = () => {
    if (!invoice) return ''
    const raw = (invoice.raw_source_data || {}) as any
    const meta = raw.meta_data || []
    
    // Courier
    let activeCourier = courier === 'Lainnya' ? customCourier : courier
    if (!activeCourier) {
      activeCourier = meta.find((m: any) => m.key === 'shapeup_kurir_awb')?.value || 
                      meta.find((m: any) => m.key === '_kurir_awb')?.value || ''
    }
    if (!activeCourier && Array.isArray(raw.shipping_lines) && raw.shipping_lines.length > 0) {
      activeCourier = raw.shipping_lines[0].method_title || ''
    }

    // Resi / Tracking
    let activeResi = trackingNumber
    if (!activeResi) {
      activeResi = meta.find((m: any) => m.key === 'shapeup_resi_awb')?.value || 
                   meta.find((m: any) => m.key === '_resi_awb')?.value || ''
    }

    if (activeCourier && activeResi) {
      return `${activeCourier} - ${activeResi}`
    }
    return activeCourier || activeResi || ''
  }

  const invItems = invoice.items_json || []

  return (
    <div className="space-y-6 text-[#1C1C1A] px-2 py-4">
      {/* Print Specific Styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden;
          }
          #print-invoice-area, #print-invoice-area * {
            visibility: visible;
          }
          #print-invoice-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 0;
            border: none;
            box-shadow: none;
          }
          .no-print {
            display: none !important;
          }
        }
      `}} />

      {/* Breadcrumb & Navigation */}
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-2 text-xs font-bold text-[#70706E]">
          <Link href="/orders/invoices" className="hover:text-[#1C1C1A]">Tagihan</Link>
          <span>/</span>
          <span className="text-[#1C1C1A]">{invoice.order_number}</span>
        </div>

        <Link
          href="/orders/invoices"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-all"
        >
          ⬅️ Kembali ke Daftar
        </Link>
      </div>

      {errorMessage && (
        <div className="p-3 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl no-print">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Grid: Preview (Left) & Controls (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* INVOICE PREVIEW (Left Side) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Invoice Document Box */}
          <div
            id="print-invoice-area"
            className="p-8 sm:p-12 bg-white rounded-2xl border border-[#EBEBEA] shadow-md space-y-8 min-h-[842px] transition-all"
          >
            {/* Top Bar: Company Name & Logo, Invoice Title */}
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-6 border-b border-gray-100">
              <div className="space-y-1">
                <div className="text-xl font-black text-[#1C1C1A] tracking-tight">{businessName}</div>
                <div className="text-xs text-[#70706E]">Penerbit Faktur Resmi</div>
                {invoice.creator && (
                  <div className="text-[10px] text-[#70706E]">
                    Dibuat oleh: <span className="font-bold text-slate-800">{invoice.creator.full_name}</span>
                  </div>
                )}
              </div>

              <div className="text-right sm:text-right space-y-1">
                <h1 className={`text-2xl font-black tracking-wider uppercase ${activeTheme.text}`}>
                  {customTitle}
                </h1>
                {customSubtitle && (
                  <p className="text-xs text-[#70706E] font-medium max-w-xs">{customSubtitle}</p>
                )}
                <div className="text-xs text-[#70706E] mt-2 font-mono">
                  # {invoice.order_number}
                </div>
              </div>
            </div>

            {/* Billing Details: Bill From & Bill To */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs">
              <div className="space-y-2">
                <div className="font-bold text-[#70706E] uppercase tracking-wider">Penerima Tagihan (Bill To)</div>
                {invoice.customers ? (
                  <div className="space-y-1 text-sm">
                    <p className="font-black text-[#1C1C1A]">{invoice.customers.name}</p>
                    <p className="text-xs text-[#70706E] font-mono">{invoice.customers.phone}</p>
                    {invoice.customers.email && (
                      <p className="text-xs text-[#70706E]">{invoice.customers.email}</p>
                    )}
                    {showAddress && getInvoiceAddress() && (
                      <p className="text-xs text-[#70706E] pt-1 border-t border-dashed border-gray-100">
                        📍 {getInvoiceAddress()}
                      </p>
                    )}
                    {showShipping && (courier || trackingNumber) && (
                      <div className="text-xs text-slate-700 bg-slate-50 border border-slate-100 p-2.5 rounded-xl space-y-1 mt-2.5">
                        {courier && (
                          <div>
                            <span className="text-[#70706E] font-bold">Kurir:</span>{' '}
                            <span className="font-black text-[#1C1C1A]">{courier === 'Lainnya' ? customCourier : courier}</span>
                          </div>
                        )}
                        {trackingNumber && (
                          <div>
                            <span className="text-[#70706E] font-bold">No. Resi:</span>{' '}
                            <span className="font-mono font-black text-[#1C1C1A]">{trackingNumber}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <p className="text-slate-500 font-semibold italic">Customer Umum</p>
                    {showAddress && getInvoiceAddress() && (
                      <p className="text-xs text-[#70706E] pt-1 border-t border-dashed border-gray-100">
                        📍 {getInvoiceAddress()}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5 sm:text-right font-medium">
                <div className="flex justify-between sm:justify-end gap-4 text-[#70706E]">
                  <span>Tanggal Faktur:</span>
                  <span className="text-[#1C1C1A] font-bold">
                    {new Date(invoice.order_date).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                {invoice.raw_source_data?.due_date && (
                  <div className="flex justify-between sm:justify-end gap-4 text-[#70706E]">
                    <span>Tanggal Jatuh Tempo:</span>
                    <span className="text-[#1C1C1A] font-bold">
                      {new Date(invoice.raw_source_data.due_date).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </span>
                  </div>
                )}
                {invoice.status === 'completed' && (
                  <div className="flex justify-between sm:justify-end gap-4 text-emerald-700">
                    <span>Metode Pelunasan:</span>
                    <span className="font-extrabold">{invoice.payment_method || 'Lunas'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line Items Table */}
            <div className="overflow-x-auto pt-4">
              <table className={getTableStyle()}>
                <thead>
                  <tr>
                    <th className={getThStyle()}>Item / Deskripsi</th>
                    {showSku && <th className={getThStyle()}>SKU</th>}
                    <th className={`${getThStyle()} text-center`}>Kuantitas</th>
                    <th className={`${getThStyle()} text-right`}>Harga Satuan</th>
                    <th className={`${getThStyle()} text-right rounded-tr-sm`}>Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invItems.map((item, idx) => {
                    const price = Number(item.price || 0)
                    const qty = Number(item.quantity || 1)
                    const discount = Number(item.discount || 0)
                    const hasDiscount = discount > 0
                    const discountedPrice = Math.max(0, price - discount)
                    const lineOriginalTotal = price * qty
                    const lineFinalTotal = discountedPrice * qty

                    return (
                      <tr key={idx}>
                        <td className={getTdStyle()}>
                          <div className="font-bold text-[#1C1C1A]">{item.name}</div>
                          {showDescription && item.description && (
                            <div className="text-xs text-[#70706E] mt-0.5 whitespace-pre-wrap">{item.description}</div>
                          )}
                        </td>
                        {showSku && (
                          <td className={`${getTdStyle()} font-mono text-xs text-[#70706E]`}>
                            {item.sku || '-'}
                          </td>
                        )}
                        <td className={`${getTdStyle()} text-center font-bold text-slate-700`}>
                          {qty}
                        </td>
                        <td className={`${getTdStyle()} text-right text-slate-600`}>
                          {hasDiscount && (
                            <div className="text-[10px] text-gray-400 line-through">
                              {formatIDR(price)}
                            </div>
                          )}
                          <div>
                            {formatIDR(discountedPrice)}
                          </div>
                          {hasDiscount && (
                            <div className="text-[9px] text-rose-600 font-bold">
                              (Potongan {formatIDR(discount)})
                            </div>
                          )}
                        </td>
                        <td className={`${getTdStyle()} text-right font-black text-slate-800`}>
                          {hasDiscount && (
                            <div className="text-[10px] text-gray-400 line-through">
                              {formatIDR(lineOriginalTotal)}
                            </div>
                          )}
                          <div className={hasDiscount ? 'text-rose-700' : ''}>
                            {formatIDR(lineFinalTotal)}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-end pt-4">
              <div className="w-full sm:w-80 text-xs font-semibold text-[#70706E] divide-y divide-gray-100">
                <div className="py-2.5 flex justify-between">
                  <span>Subtotal</span>
                  <span className="text-[#1C1C1A] font-bold">{formatIDR(invoice.subtotal)}</span>
                </div>

                {Number(invoice.discount_amount) > 0 && (
                  <div className="py-2.5 flex justify-between text-rose-600">
                    <span>Diskon</span>
                    <span className="font-bold">-{formatIDR(invoice.discount_amount)}</span>
                  </div>
                )}

                {Number(invoice.shipping_cost) > 0 && (
                  <div className="py-2.5 flex justify-between">
                    <span>Biaya Pengiriman</span>
                    <span className="text-[#1C1C1A] font-bold">+{formatIDR(invoice.shipping_cost)}</span>
                  </div>
                )}

                {Number(invoice.other_fees) > 0 && (
                  <div className="py-2.5 flex justify-between">
                    <span>Biaya Lainnya</span>
                    <span className="text-[#1C1C1A] font-bold">+{formatIDR(invoice.other_fees)}</span>
                  </div>
                )}

                <div className="py-3 flex justify-between text-base font-black text-[#1C1C1A] border-t-2 border-slate-800">
                  <span>Total Tagihan</span>
                  <span className={`${activeTheme.text}`}>{formatIDR(invoice.grand_total)}</span>
                </div>
              </div>
            </div>

            {/* Notes / Footer */}
            {showNotes && customNotes && (
              <div className="pt-8 border-t border-gray-100 text-xs space-y-2">
                <div className="font-bold text-[#70706E] uppercase tracking-wider">Catatan Pembayaran & Informasi Tambahan</div>
                <p className="text-[#1C1C1A] whitespace-pre-wrap leading-relaxed bg-gray-50 p-4 rounded-xl border border-gray-100">
                  {customNotes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* SIDE ACTIONS PANEL (Right Side) */}
        <div className="space-y-6 no-print">
          {/* Status Badge header */}
          <div className="p-5 bg-white rounded-2xl border border-[#EBEBEA] shadow-sm space-y-4">
            <div>
              <span className="text-xs font-bold text-[#70706E] uppercase tracking-wider">Status Invoice</span>
              <div className="flex items-center gap-3 mt-2">
                {invoice.status === 'pending' && (
                  <span className="px-3 py-1.5 text-xs font-black rounded-xl bg-amber-50 text-amber-700 border border-amber-200 shadow-sm">DRAFT (Pending)</span>
                )}
                {invoice.status === 'processing' && (
                  <span className="px-3 py-1.5 text-xs font-black rounded-xl bg-blue-50 text-blue-700 border border-blue-200 shadow-sm">BELUM BAYAR (Processing)</span>
                )}
                {invoice.status === 'completed' && (
                  <span className="px-3 py-1.5 text-xs font-black rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm">LUNAS (Completed)</span>
                )}
                {invoice.status === 'cancelled' && (
                  <span className="px-3 py-1.5 text-xs font-black rounded-xl bg-rose-50 text-rose-700 border border-rose-200 shadow-sm">BATAL (Cancelled)</span>
                )}
              </div>
            </div>

            <div className="flex border-b border-[#EBEBEA] text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('actions')}
                className={`flex-1 pb-2 border-b-2 text-center transition-all ${
                  activeTab === 'actions' ? 'border-[#1E40AF] text-[#1E40AF]' : 'border-transparent text-[#70706E]'
                }`}
              >
                Aksi & Status
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('design')}
                className={`flex-1 pb-2 border-b-2 text-center transition-all ${
                  activeTab === 'design' ? 'border-[#1E40AF] text-[#1E40AF]' : 'border-transparent text-[#70706E]'
                }`}
              >
                Desain
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ledger')}
                className={`flex-1 pb-2 border-b-2 text-center transition-all ${
                  activeTab === 'ledger' ? 'border-[#1E40AF] text-[#1E40AF]' : 'border-transparent text-[#70706E]'
                }`}
              >
                Jurnal Ledger
              </button>
            </div>

            {/* TAB CONTENT: ACTIONS */}
            {activeTab === 'actions' && (
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full py-2.5 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl shadow-sm transition-all"
                >
                  🖨️ Cetak / Simpan PDF
                </button>

                <button
                  type="button"
                  onClick={handlePrintLabelDirectly}
                  className="w-full py-2.5 text-xs font-bold text-[#1E40AF] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl shadow-sm transition-all"
                >
                  📦 Cetak Label Pengiriman (A6)
                </button>

                {!canEdit && (
                  <div className="p-3 bg-amber-50 border border-amber-250 rounded-xl text-[11px] text-amber-800 font-semibold leading-relaxed">
                    ℹ️ Anda memiliki hak akses baca-saja. Tombol edit, terbitkan, batalkan, dan hapus dinonaktifkan karena Anda bukan pembuat invoice ini atau Admin.
                  </div>
                )}

                {invoice.status === 'pending' && (
                  <>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleApproveInvoice}
                        className="w-full py-2.5 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-xl transition-all"
                      >
                        🚀 Kirim & Terbitkan (Outstanding)
                      </button>
                    )}

                    {canEdit && (
                      <Link
                        href={`/orders/invoices/${invoiceId}/edit`}
                        className="block w-full py-2.5 text-xs text-center font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                      >
                        ✏️ Edit Invoice
                      </Link>
                    )}

                    {canEdit && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleDeleteInvoice}
                        className="w-full py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                      >
                        🗑️ Hapus Invoice Draft
                      </button>
                    )}
                  </>
                )}

                {invoice.status === 'processing' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowPaymentModal(true)}
                      className="w-full py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all"
                    >
                      💰 Catat Pelunasan Pembayaran
                    </button>

                    {canEdit && (
                      <Link
                        href={`/orders/invoices/${invoiceId}/edit`}
                        className="block w-full py-2.5 text-xs text-center font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                      >
                        ✏️ Edit Invoice
                      </Link>
                    )}

                    {canEdit && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleCancelInvoice}
                        className="w-full py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                      >
                        🚫 Batalkan / Void Invoice
                      </button>
                    )}
                  </>
                )}

                {invoice.status === 'completed' && (
                  <>
                    <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-[11px] text-emerald-800 font-semibold leading-relaxed">
                      Lunas: Pembayaran telah dicatat dan kas/bank serta piutang telah disesuaikan secara otomatis di ledger akuntansi.
                    </div>

                    {canEdit && (
                      <Link
                        href={`/orders/invoices/${invoiceId}/edit`}
                        className="block w-full py-2.5 text-xs text-center font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                      >
                        ✏️ Edit Desain / Tampilan
                      </Link>
                    )}

                    {canEdit && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleCancelInvoice}
                        className="w-full py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                      >
                        🚫 Batalkan & Balik Jurnal (Refund)
                      </button>
                    )}
                  </>
                )}

                {invoice.status === 'cancelled' && (
                  <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-[11px] text-rose-800 font-semibold leading-relaxed">
                    Invoice ini dibatalkan secara resmi. Jurnal penyesuaian/pembalikan telah dicatat untuk meniadakan piutang & pendapatan.
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: DESIGN */}
            {activeTab === 'design' && (
              <div className="space-y-4 pt-2 text-xs">
                {!canEdit ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 font-semibold leading-relaxed">
                    Hanya Pembuat Invoice atau Admin yang dapat mengubah kustomisasi tampilan invoice.
                  </div>
                ) : (
                  <>
                    {/* Custom Title */}
                    <div className="space-y-1">
                      <label className="font-bold text-[#70706E]">Judul Dokumen</label>
                      <input
                        type="text"
                        value={customTitle}
                        onChange={e => setCustomTitle(e.target.value)}
                        placeholder="INVOICE"
                        className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>

                    {/* Custom Subtitle */}
                    <div className="space-y-1">
                      <label className="font-bold text-[#70706E]">Subjudul Dokumen</label>
                      <input
                        type="text"
                        value={customSubtitle}
                        onChange={e => setCustomSubtitle(e.target.value)}
                        placeholder="Keterangan tambahan"
                        className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>

                    {/* Custom Footer Notes */}
                    <div className="space-y-1">
                      <label className="font-bold text-[#70706E]">Teks Catatan Kaki</label>
                      <textarea
                        rows={4}
                        value={customNotes}
                        onChange={e => setCustomNotes(e.target.value)}
                        placeholder="Detail bank transfer..."
                        className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                          />
                        ))}
                      </div>
                    </div>

                    {/* Layout templates */}
                    <div className="space-y-1">
                      <label className="font-bold text-[#70706E]">Gaya Template Layout</label>
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
                          className="rounded border-[#EBEBEA] text-[#1E40AF]"
                        />
                        <span>Tampilkan SKU</span>
                      </label>

                      <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                        <input
                          type="checkbox"
                          checked={showDescription}
                          onChange={e => setShowDescription(e.target.checked)}
                          className="rounded border-[#EBEBEA] text-[#1E40AF]"
                        />
                        <span>Tampilkan Detail Item</span>
                      </label>

                      <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                        <input
                          type="checkbox"
                          checked={showNotes}
                          onChange={e => setShowNotes(e.target.checked)}
                          className="rounded border-[#EBEBEA] text-[#1E40AF]"
                        />
                        <span>Tampilkan Catatan Kaki</span>
                      </label>

                      <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                        <input
                          type="checkbox"
                          checked={showAddress}
                          onChange={e => setShowAddress(e.target.checked)}
                          className="rounded border-[#EBEBEA] text-[#1E40AF]"
                        />
                        <span>Tampilkan Alamat Customer</span>
                      </label>

                      <label className="flex items-center gap-2 font-semibold text-[#1C1C1A]">
                        <input
                          type="checkbox"
                          checked={showShipping}
                          onChange={e => setShowShipping(e.target.checked)}
                          className="rounded border-[#EBEBEA] text-[#1E40AF]"
                        />
                        <span>Tampilkan Kurir & Resi</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleSaveCustomization}
                      className="w-full py-2 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all"
                    >
                      {submitting ? 'Menyimpan...' : '💾 Simpan Kustomisasi'}
                    </button>

                    {/* Pengaturan Label Pengiriman */}
                    <div className="pt-4 mt-2 border-t border-[#EBEBEA] space-y-3">
                      <span className="font-black text-[#1C1C1A] text-xs block">📦 PENGATURAN LABEL PENGIRIMAN (A6)</span>
                      
                      <div className="space-y-1">
                        <label className="font-bold text-[#70706E]">Nama Toko/Pengirim</label>
                        <input
                          type="text"
                          value={labelShopName}
                          onChange={e => handleLabelShopNameChange(e.target.value)}
                          placeholder="Contoh: Tan'eem"
                          className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="font-bold text-[#70706E]">Kota Asal</label>
                          <input
                            type="text"
                            value={labelSenderCity}
                            onChange={e => handleLabelSenderCityChange(e.target.value)}
                            placeholder="Contoh: Kudus"
                            className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] bg-white focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="font-bold text-[#70706E]">No. HP Pengirim</label>
                          <input
                            type="text"
                            value={labelSenderPhone}
                            onChange={e => handleLabelSenderPhoneChange(e.target.value)}
                            placeholder="Contoh: 0812-2500-1717"
                            className="w-full p-2 text-xs rounded-xl border border-[#EBEBEA] bg-white focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-[#70706E]">Footer Label (Bisa Ganti Baris)</label>
                        <textarea
                          rows={4}
                          value={labelFooterBody}
                          onChange={e => handleLabelFooterBodyChange(e.target.value)}
                          placeholder="Detail IG / TikTok / WA..."
                          className="w-full p-2 text-xs font-mono rounded-xl border border-[#EBEBEA] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <p className="text-[10px] text-[#70706E] italic leading-tight">Catatan: Baris pertama (Kurir & Tanggal) diisi otomatis ketika mencetak.</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB CONTENT: LEDGER JOURNALS */}
            {activeTab === 'ledger' && (
              <div className="space-y-4 pt-2 text-xs">
                <h3 className="font-bold text-[#1C1C1A]">Catatan Jurnal Ledger</h3>
                {loadingLedger ? (
                  <p className="text-slate-500 font-medium italic animate-pulse">Memuat jurnal akuntansi...</p>
                ) : ledgerTransactions.length === 0 ? (
                  <p className="text-slate-400 font-semibold italic text-[11px]">Belum ada jurnal ledger untuk transaksi ini (Invoice Draft).</p>
                ) : (
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                    {ledgerTransactions.map((tx, txIdx) => (
                      <div key={tx.id} className="p-3 bg-gray-50 border border-gray-150 rounded-xl space-y-2">
                        <div className="flex justify-between items-start">
                          <span className="font-black text-[#1C1C1A] text-[11px]">{tx.description}</span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {new Date(tx.date).toLocaleDateString('id-ID')}
                          </span>
                        </div>

                        <table className="w-full text-left font-medium text-[10px]">
                          <thead>
                            <tr className="border-b border-gray-200 text-gray-400 uppercase">
                              <th className="pb-1 font-bold">Akun</th>
                              <th className="pb-1 text-right font-bold">Debit</th>
                              <th className="pb-1 text-right font-bold">Kredit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {tx.journal_lines?.map(jl => (
                              <tr key={jl.id} className="text-slate-700">
                                <td className="py-1">
                                  <div className="font-bold">{jl.accounts?.code}</div>
                                  <div className="text-[9px] text-gray-400">{jl.accounts?.name}</div>
                                </td>
                                <td className="py-1 text-right font-semibold text-emerald-700">
                                  {jl.debit > 0 ? formatIDR(jl.debit) : '-'}
                                </td>
                                <td className="py-1 text-right font-semibold text-rose-700">
                                  {jl.credit > 0 ? formatIDR(jl.credit) : '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Record Payment popup */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-[#1C1C1A]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#EBEBEA] shadow-xl p-6 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-sm font-black text-[#1C1C1A]">Catat Pelunasan Invoice</h3>
              <p className="text-xs text-[#70706E] mt-1">Gunakan formulir ini jika Anda sudah menerima pembayaran dari pelanggan.</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#70706E]">Metode Pembayaran</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  className="w-full p-2.5 text-xs font-bold rounded-xl border border-[#EBEBEA] bg-white focus:outline-none"
                >
                  <option value="Bank Transfer">Bank Transfer / QRIS (Default)</option>
                  <option value="Cash">Cash (Tunai)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-[#70706E]">Tanggal Pembayaran</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-xl border border-[#EBEBEA] focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>

              <div className="pt-2 flex justify-between text-xs font-bold border-t border-gray-150">
                <span className="text-[#70706E]">Jumlah Pelunasan</span>
                <span className="text-blue-700 font-extrabold">{formatIDR(invoice.grand_total)}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 py-2 font-bold text-[#70706E] hover:text-[#1C1C1A] transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleRecordPayment}
                disabled={submitting}
                className="flex-1 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
              >
                {submitting ? 'Proses...' : 'Catat Lunas'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden iframe for shipping label printing context */}
      <iframe
        id="print-label-iframe"
        style={{ display: 'none', width: 0, height: 0, border: 'none' }}
      />
    </div>
  )
}
