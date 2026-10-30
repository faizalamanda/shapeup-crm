"use client"

import { useState, useEffect, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ORDER_TARGET_FIELDS,
  ORDER_IMPORT_PRESETS,
  detectOrderFieldByHeader,
  downloadPresetSampleExcel
} from '@/lib/orderImportPresets'

interface GroupedOrderForImport {
  order_number: string
  order_date: string | null
  source_platform: string
  status: string
  payment_status: string
  payment_method: string
  discount_amount: number
  shipping_cost: number
  grand_total: number
  created_by: string | null
  customer: {
    name: string | null
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
  }
  items: Array<{
    name: string
    sku: string | null
    variant_name: string | null
    quantity: number
    price: number
    total: number
  }>
  _sourceRowNumbers: number[]
}

interface FailedOrderReport {
  rowNumbers: string
  order_number: string
  customer_name: string
  customer_phone: string
  items_summary: string
  grand_total: number
  reason: string
}

export default function OrderImportPage() {
  const router = useRouter()

  // Business Context State
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string>('Bisnis Saya')
  const [loadingContext, setLoadingContext] = useState(true)

  // Wizard Steps
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'result'>('upload')
  const [fileName, setFileName] = useState<string>('')
  const [fileSizeMb, setFileSizeMb] = useState<number>(0)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<any[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')

  // Configurations (Step 3)
  const [defaultPlatform, setDefaultPlatform] = useState<string>('Manual')
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update'>('skip')
  const [autoJournal, setAutoJournal] = useState<boolean>(true)
  const [customerWithoutPhone, setCustomerWithoutPhone] = useState<'guest' | 'create'>('guest')

  // Streaming Import Progress & Metrics (Step 4)
  const [importProgress, setImportProgress] = useState(0) // 0 to 100
  const [processedCount, setProcessedCount] = useState(0)
  const [totalOrdersToImport, setTotalOrdersToImport] = useState(0)
  const [insertedTotal, setInsertedTotal] = useState(0)
  const [updatedTotal, setUpdatedTotal] = useState(0)
  const [skippedTotal, setSkippedTotal] = useState(0)
  const [failedOrders, setFailedOrders] = useState<FailedOrderReport[]>([])
  const [activityLogs, setActivityLogs] = useState<string[]>([])

  // Throughput & ETA
  const [speedPerSecond, setSpeedPerSecond] = useState(0)
  const [estimatedRemainingSeconds, setEstimatedRemainingSeconds] = useState<number | null>(null)

  // Flow Control
  const [isPaused, setIsPaused] = useState(false)
  const isPausedRef = useRef(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const isCancelledRef = useRef(false)

  // ── Load Active Business Context ─────────────────────────────────────────
  useEffect(() => {
    async function loadBiz() {
      try {
        setLoadingContext(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id, businesses!active_business_id(name)')
          .eq('id', user.id)
          .single()

        if (profile?.active_business_id) {
          setActiveBizId(profile.active_business_id)
          const b = Array.isArray(profile.businesses) ? profile.businesses[0] : profile.businesses
          setActiveBizName(b?.name || 'Bisnis Saya')
        }
      } catch (err) {
        console.error('Failed to load profile for order import:', err)
      } finally {
        setLoadingContext(false)
      }
    }
    loadBiz()
  }, [router])

  // ── 1. File Upload Handler with Instant Guardrails (30MB / 100k rows) ────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const selectedFile = files[0]
    const sizeMb = selectedFile.size / (1024 * 1024)
    setFileSizeMb(Math.round(sizeMb * 10) / 10)

    // 30MB Guardrail Check
    if (sizeMb > 30) {
      alert(`Ukuran berkas (${sizeMb.toFixed(1)} MB) melebihi batas maksimal 30 MB. Untuk menjaga performa browser Anda tetap lancar, silakan gunakan format CSV atau bagi berkas per periode/semester.`)
      e.target.value = ''
      return
    }

    setFileName(selectedFile.name)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]

        const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
        if (data.length === 0) {
          alert('Berkas kosong! Silakan pilih berkas yang memuat data pesanan.')
          return
        }

        // 100,000 Rows Guardrail Check
        if (data.length > 100001) {
          alert(`Berkas memuat ${data.length.toLocaleString('id-ID')} baris, melebihi batas maksimal 100.000 baris. Silakan bagi berkas menjadi beberapa periode untuk mencegah memori browser crash.`)
          e.target.value = ''
          return
        }

        const fileHeaders = (data[0] as any[])
          .map(h => String(h || '').trim())
          .filter(Boolean)

        const fileDataRows = data.slice(1)

        setHeaders(fileHeaders)

        const formattedRows = fileDataRows
          .map((row, rIdx) => {
            const rowObj: Record<string, any> = { _originalRowNumber: rIdx + 2 } // Row 1 is header
            fileHeaders.forEach((h, idx) => {
              rowObj[h] = row[idx]
            })
            return rowObj
          })
          .filter(r => Object.keys(r).some(k => k !== '_originalRowNumber' && r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== ''))

        setRawRows(formattedRows)

        // Initial Smart Mapping with Auto-Detection & LocalStorage presets
        const savedPresets = JSON.parse(localStorage.getItem('order_import_mapping_presets') || '{}')
        const initialMapping: Record<string, string> = {}

        fileHeaders.forEach(h => {
          if (savedPresets[h]) {
            initialMapping[h] = savedPresets[h]
          } else {
            initialMapping[h] = detectOrderFieldByHeader(h)
          }
        })

        // Auto-detect if file belongs to Moka, Pawoon, Majoo, Shopee, etc.
        const headerStr = fileHeaders.join(' ').toLowerCase()
        if (headerStr.includes('receipt number') || (headerStr.includes('receipt') && headerStr.includes('served by'))) {
          setSelectedPresetId('moka_pos')
          setDefaultPlatform('Moka POS')
        } else if (headerStr.includes('id struk') || headerStr.includes('pawoon')) {
          setSelectedPresetId('pawoon_pos')
          setDefaultPlatform('Pawoon')
        } else if (headerStr.includes('nomor invoice') && headerStr.includes('nama barang') && headerStr.includes('kasir')) {
          setSelectedPresetId('majoo_pos')
          setDefaultPlatform('Majoo')
        } else if (headerStr.includes('no. pesanan') && headerStr.includes('waktu pesanan dibuat')) {
          setSelectedPresetId('shopee')
          setDefaultPlatform('Shopee')
        } else if (headerStr.includes('nomor invoice') && headerStr.includes('nama pembeli')) {
          setSelectedPresetId('tokopedia')
          setDefaultPlatform('Tokopedia')
        } else if (headerStr.includes('order id') && headerStr.includes('seller sku')) {
          setSelectedPresetId('tiktok_shop')
          setDefaultPlatform('TikTok')
        }

        setMapping(initialMapping)
        setStep('mapping')
      } catch (err) {
        console.error('Failed to parse excel file:', err)
        alert('Gagal membaca berkas Excel. Pastikan format berkas valid (.xlsx, .xls, atau .csv).')
      }
    }
    reader.readAsBinaryString(selectedFile)
  }

  // ── 2. Handle Mapping Changes & Apply Preset ─────────────────────────────
  const handleMapField = (header: string, targetKey: string) => {
    setMapping(prev => ({ ...prev, [header]: targetKey }))

    // Persist to localStorage presets
    const savedPresets = JSON.parse(localStorage.getItem('order_import_mapping_presets') || '{}')
    if (targetKey === '') {
      delete savedPresets[header]
    } else {
      savedPresets[header] = targetKey
    }
    localStorage.setItem('order_import_mapping_presets', JSON.stringify(savedPresets))
  }

  const handleApplyPreset = (presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = ORDER_IMPORT_PRESETS.find(p => p.id === presetId)
    if (!preset) return

    setDefaultPlatform(preset.sourcePlatformDefault)

    const newMap: Record<string, string> = { ...mapping }
    headers.forEach(h => {
      // Find matching preset key
      const matchedField = Object.entries(preset.mapping).find(([pHeader]) => {
        return pHeader.trim().toLowerCase() === h.trim().toLowerCase()
      })
      if (matchedField) {
        newMap[h] = matchedField[1]
      } else {
        // Fallback to auto detect
        newMap[h] = detectOrderFieldByHeader(h)
      }
    })
    setMapping(newMap)
  }

  // ── Inverted Mapping Map: targetFieldKey -> sourceHeaderName ──────────────
  const invertedMapping = useMemo(() => {
    const inv: Record<string, string> = {}
    Object.entries(mapping).forEach(([h, targetKey]) => {
      if (targetKey) inv[targetKey] = h
    })
    return inv
  }, [mapping])

  // ── 3. Multi-Item Grouping Engine (Reduces Flat 2D rows into Grouped Orders)
  const groupedOrders: GroupedOrderForImport[] = useMemo(() => {
    if (rawRows.length === 0) return []

    const orderNumCol = invertedMapping['order_number']
    const prodNameCol = invertedMapping['product_name']

    if (!orderNumCol || !prodNameCol) return []

    const map = new Map<string, GroupedOrderForImport>()

    rawRows.forEach(row => {
      const rawOrderNum = row[orderNumCol]
      if (rawOrderNum === undefined || rawOrderNum === null || String(rawOrderNum).trim() === '') {
        return
      }

      const orderNumber = String(rawOrderNum).trim()
      const rawProdName = row[prodNameCol]
      const productName = rawProdName ? String(rawProdName).trim() : 'Item Tanpa Nama'

      const rawSku = invertedMapping['sku'] ? row[invertedMapping['sku']] : null
      const sku = rawSku ? String(rawSku).trim() : null

      const rawVariant = invertedMapping['variant_name'] ? row[invertedMapping['variant_name']] : null
      const variantName = rawVariant ? String(rawVariant).trim() : null

      const rawQty = invertedMapping['quantity'] ? Number(row[invertedMapping['quantity']]) : 1
      const quantity = (!isNaN(rawQty) && rawQty > 0) ? rawQty : 1

      const rawPrice = invertedMapping['item_price'] ? Number(row[invertedMapping['item_price']]) : 0
      const price = (!isNaN(rawPrice) && rawPrice >= 0) ? rawPrice : 0

      const rawItemTotal = invertedMapping['item_total'] ? Number(row[invertedMapping['item_total']]) : (quantity * price)
      const itemTotal = (!isNaN(rawItemTotal) && rawItemTotal >= 0) ? rawItemTotal : (quantity * price)

      const lineItem = {
        name: productName,
        sku,
        variant_name: variantName,
        quantity,
        price,
        total: itemTotal
      }

      if (!map.has(orderNumber)) {
        // First occurrence of this orderNumber
        const rawDate = invertedMapping['order_date'] ? row[invertedMapping['order_date']] : null
        let orderDateStr: string | null = null
        if (rawDate instanceof Date) {
          orderDateStr = rawDate.toISOString()
        } else if (rawDate) {
          orderDateStr = String(rawDate).trim()
        }

        const rawPlatform = invertedMapping['source_platform'] ? row[invertedMapping['source_platform']] : null
        const platform = rawPlatform ? String(rawPlatform).trim() : defaultPlatform

        const rawStatus = invertedMapping['status'] ? row[invertedMapping['status']] : 'completed'
        const rawPayStatus = invertedMapping['payment_status'] ? row[invertedMapping['payment_status']] : 'paid'
        const rawPayMethod = invertedMapping['payment_method'] ? row[invertedMapping['payment_method']] : 'Cash'

        const rawDiscount = invertedMapping['discount_amount'] ? Number(row[invertedMapping['discount_amount']]) : 0
        const discountAmount = (!isNaN(rawDiscount) && rawDiscount >= 0) ? rawDiscount : 0

        const rawShipping = invertedMapping['shipping_cost'] ? Number(row[invertedMapping['shipping_cost']]) : 0
        const shippingCost = (!isNaN(rawShipping) && rawShipping >= 0) ? rawShipping : 0

        const rawGrand = invertedMapping['grand_total'] ? Number(row[invertedMapping['grand_total']]) : null
        const grandTotal = (rawGrand !== null && !isNaN(rawGrand) && rawGrand >= 0) ? rawGrand : 0

        const rawCreatedBy = invertedMapping['created_by'] ? row[invertedMapping['created_by']] : null
        const createdBy = rawCreatedBy ? String(rawCreatedBy).trim() : null

        const rawCustName = invertedMapping['customer_name'] ? row[invertedMapping['customer_name']] : null
        const rawCustPhone = invertedMapping['customer_phone'] ? row[invertedMapping['customer_phone']] : null
        const rawCustEmail = invertedMapping['customer_email'] ? row[invertedMapping['customer_email']] : null
        const rawCustAddress = invertedMapping['shipping_address'] ? row[invertedMapping['shipping_address']] : null
        const rawCustCity = invertedMapping['shipping_city'] ? row[invertedMapping['shipping_city']] : null

        map.set(orderNumber, {
          order_number: orderNumber,
          order_date: orderDateStr,
          source_platform: platform,
          status: String(rawStatus || 'completed'),
          payment_status: String(rawPayStatus || 'paid'),
          payment_method: String(rawPayMethod || 'Cash'),
          discount_amount: discountAmount,
          shipping_cost: shippingCost,
          grand_total: grandTotal,
          created_by: createdBy,
          customer: {
            name: rawCustName ? String(rawCustName).trim() : null,
            phone: rawCustPhone ? String(rawCustPhone).trim() : null,
            email: rawCustEmail ? String(rawCustEmail).trim() : null,
            address: rawCustAddress ? String(rawCustAddress).trim() : null,
            city: rawCustCity ? String(rawCustCity).trim() : null
          },
          items: [lineItem],
          _sourceRowNumbers: [row._originalRowNumber]
        })
      } else {
        // Additional items for the same orderNumber (Parent-Child multi-item)
        const existing = map.get(orderNumber)!
        existing.items.push(lineItem)
        existing._sourceRowNumbers.push(row._originalRowNumber)
      }
    })

    // If grand_total was 0, calculate as sum of items + shipping - discount
    return Array.from(map.values()).map(o => {
      if (o.grand_total === 0) {
        const itemSum = o.items.reduce((s, it) => s + it.total, 0)
        o.grand_total = Math.max(0, itemSum - o.discount_amount + o.shipping_cost)
      }
      return o
    })
  }, [rawRows, invertedMapping, defaultPlatform])

  // ── 4. Streaming Batch Ingestion Engine (Zero-Timeout, Real-time Speed) ───
  const handleStartImport = async () => {
    if (groupedOrders.length === 0) {
      alert('Tidak ada data pesanan yang valid untuk diimpor. Pastikan kolom No. Pesanan dan Nama Produk terhubung.')
      return
    }

    setStep('importing')
    setImportProgress(0)
    setProcessedCount(0)
    setInsertedTotal(0)
    setUpdatedTotal(0)
    setSkippedTotal(0)
    setFailedOrders([])
    setActivityLogs([])
    setIsPaused(false)
    isPausedRef.current = false
    setIsCancelled(false)
    isCancelledRef.current = false

    const totalOrders = groupedOrders.length
    setTotalOrdersToImport(totalOrders)

    // Tuning Batch Size: 60 orders per batch for optimal throughput + safety
    const BATCH_SIZE = 60
    let cumInserted = 0
    let cumUpdated = 0
    let cumSkipped = 0
    const accumulatedFailed: FailedOrderReport[] = []

    const startTime = Date.now()

    for (let i = 0; i < totalOrders; i += BATCH_SIZE) {
      if (isCancelledRef.current) {
        setActivityLogs(prev => [`[${new Date().toLocaleTimeString('id-ID')}] ⏹️ Proses dibatalkan oleh pengguna. Data yang sudah masuk tetap tersimpan.`, ...prev])
        break
      }

      // Pause loop check
      while (isPausedRef.current) {
        await new Promise(r => setTimeout(r, 500))
        if (isCancelledRef.current) break
      }
      if (isCancelledRef.current) break

      const chunk = groupedOrders.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(totalOrders / BATCH_SIZE)

      setActivityLogs(prev => [
        `[${new Date().toLocaleTimeString('id-ID')}] Mengirim Batch ${batchNumber}/${totalBatches} (${chunk.length} pesanan)...`,
        ...prev.slice(0, 40)
      ])

      try {
        const res = await fetch('/api/orders/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orders: chunk,
            duplicateAction,
            autoJournal,
            customerWithoutPhone
          })
        })

        const data = await res.json().catch(() => null)

        if (!res.ok || !data) {
          const errMsg = data?.error || `HTTP ${res.status}: Gagal memproses batch`
          chunk.forEach(o => {
            accumulatedFailed.push({
              rowNumbers: o._sourceRowNumbers.join(', '),
              order_number: o.order_number,
              customer_name: o.customer.name || '-',
              customer_phone: o.customer.phone || '-',
              items_summary: o.items.map(it => `${it.quantity}x ${it.name}`).join(' | '),
              grand_total: o.grand_total,
              reason: errMsg
            })
          })
        } else {
          cumInserted += data.insertedCount || 0
          cumUpdated += data.updatedCount || 0
          cumSkipped += data.skippedCount || 0

          // Check individual failed orders in this batch
          if (Array.isArray(data.failedItems) && data.failedItems.length > 0) {
            data.failedItems.forEach((f: any) => {
              const matchedOrder = chunk.find(c => c.order_number === f.order_number)
              accumulatedFailed.push({
                rowNumbers: matchedOrder ? matchedOrder._sourceRowNumbers.join(', ') : '-',
                order_number: f.order_number,
                customer_name: matchedOrder?.customer.name || '-',
                customer_phone: matchedOrder?.customer.phone || '-',
                items_summary: matchedOrder ? matchedOrder.items.map(it => `${it.quantity}x ${it.name}`).join(' | ') : '-',
                grand_total: matchedOrder?.grand_total || 0,
                reason: f.reason || 'Gagal disimpan'
              })
            })
          }
        }
      } catch (networkErr: any) {
        const errMsg = networkErr.message || 'Koneksi jaringan terputus saat mengirim batch'
        chunk.forEach(o => {
          accumulatedFailed.push({
            rowNumbers: o._sourceRowNumbers.join(', '),
            order_number: o.order_number,
            customer_name: o.customer.name || '-',
            customer_phone: o.customer.phone || '-',
            items_summary: o.items.map(it => `${it.quantity}x ${it.name}`).join(' | '),
            grand_total: o.grand_total,
            reason: errMsg
          })
        })
      }

      const currentDone = Math.min(i + BATCH_SIZE, totalOrders)
      setProcessedCount(currentDone)
      setInsertedTotal(cumInserted)
      setUpdatedTotal(cumUpdated)
      setSkippedTotal(cumSkipped)

      const pct = Math.round((currentDone / totalOrders) * 100)
      setImportProgress(pct)

      // Calculate Speed & ETA
      const elapsedSec = Math.max((Date.now() - startTime) / 1000, 0.5)
      const currentSpeed = Math.round(currentDone / elapsedSec)
      setSpeedPerSecond(currentSpeed)

      const remainingOrders = totalOrders - currentDone
      if (currentSpeed > 0) {
        setEstimatedRemainingSeconds(Math.ceil(remainingOrders / currentSpeed))
      }
    }

    setFailedOrders(accumulatedFailed)

    // Invalidate client-side order list cache
    if (activeBizId) {
      try {
        localStorage.removeItem(`su_orders_${activeBizId}`)
      } catch {}
    }

    setStep('result')
  }

  // ── 5. Download Failed Rows Excel Report ─────────────────────────────────
  const handleDownloadFailedExcel = () => {
    if (failedOrders.length === 0) return

    const exportRows = failedOrders.map(f => ({
      'Baris Excel Asli': f.rowNumbers,
      'No. Pesanan': f.order_number,
      'Nama Pelanggan': f.customer_name,
      'No. WhatsApp / HP': f.customer_phone,
      'Rincian Produk': f.items_summary,
      'Total Transaksi': f.grand_total,
      'ALASAN KEGAGALAN': f.reason
    }))

    const ws = XLSX.utils.json_to_sheet(exportRows)
    ws['!cols'] = [
      { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 20 },
      { wch: 40 }, { wch: 18 }, { wch: 45 }
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Baris Gagal')
    XLSX.writeFile(wb, `Laporan_Gagal_Import_Pesanan_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // Helper time formatter
  const formatSeconds = (sec: number | null) => {
    if (sec === null || isNaN(sec)) return '-'
    if (sec < 60) return `${sec} detik`
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}m ${s}s`
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-20">
      {/* ── Top Navigation Header ────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/orders"
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 transition-colors"
              title="Kembali ke Pesanan"
            >
              ←
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Import Wizard
                </span>
                <span className="text-xs text-slate-400 font-medium">📍 {activeBizName}</span>
              </div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">
                Import Pesanan & Transaksi Massal
              </h1>
            </div>
          </div>

          {/* Stepper Indicator */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-semibold">
            <span className={`px-2.5 py-1 rounded-md ${step === 'upload' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              1. Berkas
            </span>
            <span className="text-slate-300">→</span>
            <span className={`px-2.5 py-1 rounded-md ${step === 'mapping' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              2. Kolom
            </span>
            <span className="text-slate-300">→</span>
            <span className={`px-2.5 py-1 rounded-md ${step === 'preview' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              3. Opsi
            </span>
            <span className="text-slate-300">→</span>
            <span className={`px-2.5 py-1 rounded-md ${step === 'importing' || step === 'result' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              4. Proses
            </span>
          </div>
        </div>
      </header>

      {/* ── Main Wizard Container ────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 mt-6">
        {/* STEP 1: UPLOAD FILE ────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm">
            <div className="text-center max-w-xl mx-auto mb-8">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center text-3xl mx-auto mb-3 shadow-inner">
                📥
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                Pilih Berkas Laporan Pesanan Anda
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Mendukung ekspor langsung dari <strong>Moka POS, Pawoon, Majoo, Shopee, Tokopedia, TikTok Shop, WooCommerce</strong>, atau Excel kustom.
              </p>
            </div>

            {/* Dropzone */}
            <div className="border-2 border-dashed border-indigo-200 hover:border-indigo-500 rounded-2xl p-8 text-center transition-colors bg-indigo-50/20 max-w-2xl mx-auto cursor-pointer relative group">
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div className="text-4xl mb-2 group-hover:scale-110 transition-transform">📄</div>
              <div className="text-sm font-semibold text-indigo-900">
                Klik atau seret berkas Excel / CSV ke sini
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Format yang didukung: <strong>.xlsx, .xls, .csv</strong> (Maksimal 30 MB / 100.000 baris)
              </div>
            </div>

            {/* Ready-to-use Sample Templates */}
            <div className="mt-10 pt-6 border-t border-slate-100">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 text-center sm:text-left">
                📥 Butuh Format Sampel? Unduh Template Bawaan Siap Pakai:
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadPresetSampleExcel('moka_pos')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Moka POS (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadPresetSampleExcel('pawoon_pos')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Pawoon POS (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadPresetSampleExcel('majoo_pos')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Majoo POS (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadPresetSampleExcel('shopee')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  Shopee (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadPresetSampleExcel('tokopedia')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  Tokopedia (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadPresetSampleExcel('tiktok_shop')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-900" />
                  TikTok Shop (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadPresetSampleExcel('shapeup_standard')}
                  className="px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 text-xs font-medium text-indigo-700 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-indigo-600" />
                  ShapeUp Standard (.xlsx)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: COLUMN MAPPING ─────────────────────────────────────────── */}
        {step === 'mapping' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Pemetaan Kolom Berkas ({fileName})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Terdeteksi <strong>{headers.length} kolom</strong> dan <strong>{rawRows.length.toLocaleString('id-ID')} baris data</strong>.
                </p>
              </div>

              {/* 1-Click Preset Dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">Pilih Template Cepat:</span>
                <select
                  value={selectedPresetId}
                  onChange={(e) => handleApplyPreset(e.target.value)}
                  className="text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Deteksi Otomatis --</option>
                  {ORDER_IMPORT_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} [{p.badge}]
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Validation Notice if required columns are missing */}
            {(!invertedMapping['order_number'] || !invertedMapping['product_name']) && (
              <div className="mt-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>
                  Kolom wajib <strong>Nomor Pesanan</strong> dan <strong>Nama Produk</strong> harus terhubung agar sistem dapat mengelompokkan produk multi-item.
                </span>
              </div>
            )}

            {/* Mapping Grid Table */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                    <th className="py-2.5 px-3">Kolom di File Anda</th>
                    <th className="py-2.5 px-3">Contoh Baris Pertama</th>
                    <th className="py-2.5 px-3 w-72">Hubungkan ke Field ShapeUp CRM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {headers.map(header => {
                    const sampleValue = rawRows[0] ? String(rawRows[0][header] || '-') : '-'
                    const currentTargetKey = mapping[header] || ''
                    const isMapped = Boolean(currentTargetKey)

                    return (
                      <tr key={header} className={isMapped ? 'bg-indigo-50/10' : 'hover:bg-slate-50'}>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {header}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate" title={sampleValue}>
                          {sampleValue}
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            value={currentTargetKey}
                            onChange={(e) => handleMapField(header, e.target.value)}
                            className={`w-full text-xs rounded-lg border px-3 py-1.5 font-medium transition-colors ${
                              isMapped
                                ? 'border-indigo-400 bg-indigo-50/40 text-indigo-900 font-semibold'
                                : 'border-slate-300 text-slate-500'
                            }`}
                          >
                            <option value="">-- Abaikan Kolom Ini --</option>
                            <optgroup label="Informasi Pesanan">
                              {ORDER_TARGET_FIELDS.filter(f => f.group === 'order').map(f => (
                                <option key={f.key} value={f.key}>
                                  {f.label} {f.required ? '*' : ''}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Data Pelanggan">
                              {ORDER_TARGET_FIELDS.filter(f => f.group === 'customer').map(f => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Rincian Produk (Items)">
                              {ORDER_TARGET_FIELDS.filter(f => f.group === 'item').map(f => (
                                <option key={f.key} value={f.key}>
                                  {f.label} {f.required ? '*' : ''}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                ← Ganti Berkas
              </button>

              <button
                type="button"
                disabled={!invertedMapping['order_number'] || !invertedMapping['product_name']}
                onClick={() => setStep('preview')}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-xs font-bold text-white shadow-sm transition-colors flex items-center gap-1.5"
              >
                Lanjut ke Pratinjau & Opsi →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: PREVIEW & CONFIGURATION ───────────────────────────────── */}
        {step === 'preview' && (
          <div className="space-y-6">
            {/* Grouping Metrics Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Hasil Pengelompokan Multi-Item
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Dari <strong>{rawRows.length.toLocaleString('id-ID')} baris data mentah</strong>, berhasil dikelompokkan menjadi:
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-indigo-600">
                    {groupedOrders.length.toLocaleString('id-ID')} Pesanan
                  </div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">
                    Total Transaksi Siap Diimpor
                  </div>
                </div>
              </div>
            </div>

            {/* Configuration Options */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">
                ⚙️ Opsi Konfigurasi Import
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Auto Journal & Stock Toggle */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoJournal}
                      onChange={(e) => setAutoJournal(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        Otomatis Terbitkan Jurnal Akuntansi & Mutasi Stok (Rekomendasi: Aktif)
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Sistem mencatat transaksi penjualan, kas/piutang, HPP, serta mutasi stok barang sesuai tanggal asli masing-masing pesanan.
                        <em> (Hilangkan centang jika Anda hanya mengimpor riwayat pesanan lampau untuk arsip CRM tanpa ingin memotong saldo fisik stok gudang saat ini).</em>
                      </p>
                    </div>
                  </label>
                </div>

                {/* Duplicate Action */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                  <div className="text-xs font-bold text-slate-900 mb-1.5">
                    Jika Nomor Pesanan Sudah Ada di Database:
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="duplicateAction"
                        value="skip"
                        checked={duplicateAction === 'skip'}
                        onChange={() => setDuplicateAction('skip')}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span><strong>Lewati (Skip)</strong> — Tidak menyimpan ulang (Aman dari duplikasi)</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="duplicateAction"
                        value="update"
                        checked={duplicateAction === 'update'}
                        onChange={() => setDuplicateAction('update')}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span><strong>Perbarui (Update)</strong> — Perbarui status pesanan & pembayaran</span>
                    </label>
                  </div>
                </div>

                {/* Customer Without Phone Handling */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                  <div className="text-xs font-bold text-slate-900 mb-1.5">
                    Penanganan Pelanggan Tanpa Nomor WhatsApp / HP:
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="customerWithoutPhone"
                        value="guest"
                        checked={customerWithoutPhone === 'guest'}
                        onChange={() => setCustomerWithoutPhone('guest')}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span><strong>Hubungkan ke Customer Tamu</strong> — Data alamat & nama tetap tersimpan di pesanan</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="customerWithoutPhone"
                        value="create"
                        checked={customerWithoutPhone === 'create'}
                        onChange={() => setCustomerWithoutPhone('create')}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span><strong>Buat Profil Kontak Baru</strong> berdasarkan Nama / Username</span>
                    </label>
                  </div>
                </div>

                {/* Default Source Platform */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                  <div className="text-xs font-bold text-slate-900 mb-1.5">
                    Sumber Platform Default (Jika kolom platform kosong):
                  </div>
                  <select
                    value={defaultPlatform}
                    onChange={(e) => setDefaultPlatform(e.target.value)}
                    className="w-full text-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 font-semibold"
                  >
                    <option value="Moka POS">Moka POS</option>
                    <option value="Pawoon">Pawoon</option>
                    <option value="Majoo">Majoo</option>
                    <option value="Shopee">Shopee</option>
                    <option value="Tokopedia">Tokopedia</option>
                    <option value="TikTok">TikTok Shop</option>
                    <option value="WooCommerce">WooCommerce</option>
                    <option value="Manual">Manual</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Sample Grouped Orders Preview Table */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm overflow-hidden">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                👀 Pratinjau 5 Pesanan Pertama:
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold">
                      <th className="py-2 px-3">No. Pesanan</th>
                      <th className="py-2 px-3">Pelanggan</th>
                      <th className="py-2 px-3">Rincian Item Produk</th>
                      <th className="py-2 px-3 text-right">Total Qty</th>
                      <th className="py-2 px-3 text-right">Grand Total</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupedOrders.slice(0, 5).map((o, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {o.order_number}
                          <div className="text-[10px] text-slate-400 font-normal">
                            Baris #{o._sourceRowNumbers.join(', ')}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-800">{o.customer.name || 'Tamu / Umum'}</div>
                          <div className="text-[10px] text-slate-400">{o.customer.phone || '-'}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="space-y-0.5">
                            {o.items.map((it, iIdx) => (
                              <div key={iIdx} className="text-slate-700">
                                <span className="font-semibold text-indigo-600">{it.quantity}x</span> {it.name}
                                {it.variant_name && <span className="text-[10px] text-slate-400"> [{it.variant_name}]</span>}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-700">
                          {o.items.reduce((s, it) => s + it.quantity, 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                          Rp {o.grand_total.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {o.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Navigation Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep('mapping')}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                ← Kembali ke Pemetaan Kolom
              </button>

              <button
                type="button"
                onClick={handleStartImport}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white shadow-md transition-colors flex items-center gap-2"
              >
                🚀 Mulai Streaming Import Sekarang ({groupedOrders.length.toLocaleString('id-ID')} Pesanan)
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: STREAMING INGESTION (REAL-TIME LOADING & SPEEDOMETER) ──── */}
        {step === 'importing' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm">
            <div className="text-center max-w-lg mx-auto mb-6">
              <div className="inline-block animate-spin text-3xl mb-2">⏳</div>
              <h2 className="text-lg font-bold text-slate-900">
                Sedang Memproses Import Pesanan...
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Data dikirim dalam micro-batches agar kebal dari timeout server. Jangan menutup tab browser ini.
              </p>
            </div>

            {/* Main Animated Progress Bar */}
            <div className="max-w-2xl mx-auto mb-6">
              <div className="flex justify-between items-center text-xs font-bold mb-2">
                <span className="text-indigo-600 text-base">{importProgress}% Selesai</span>
                <span className="text-slate-500">
                  {processedCount.toLocaleString('id-ID')} / {totalOrdersToImport.toLocaleString('id-ID')} Pesanan
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-3.5 overflow-hidden p-0.5 border border-slate-200">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>

            {/* Live Metrics Dashboard */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto mb-6">
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-center">
                <div className="text-lg font-bold text-emerald-600">{insertedTotal.toLocaleString('id-ID')}</div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase">Berhasil Masuk</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-center">
                <div className="text-lg font-bold text-blue-600">{updatedTotal.toLocaleString('id-ID')}</div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase">Diperbarui</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-center">
                <div className="text-lg font-bold text-amber-600">{skippedTotal.toLocaleString('id-ID')}</div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase">Dilewati (Duplikat)</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-center">
                <div className="text-lg font-bold text-rose-600">{failedOrders.length.toLocaleString('id-ID')}</div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase">Gagal Diproses</div>
              </div>
            </div>

            {/* Speedometer & Rolling ETA */}
            <div className="max-w-2xl mx-auto flex items-center justify-between p-3 rounded-xl bg-indigo-50/50 border border-indigo-100 text-xs mb-6">
              <div className="flex items-center gap-1.5 text-indigo-900 font-semibold">
                <span>⚡ Kecepatan:</span>
                <span className="font-extrabold">{speedPerSecond} pesanan / detik</span>
              </div>
              <div className="flex items-center gap-1.5 text-indigo-900 font-semibold">
                <span>⏱️ Estimasi Sisa Waktu:</span>
                <span className="font-extrabold">{formatSeconds(estimatedRemainingSeconds)}</span>
              </div>
            </div>

            {/* Flow Controls (Pause / Resume / Cancel) */}
            <div className="max-w-md mx-auto flex items-center justify-center gap-3 mb-6">
              {!isPaused ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(true)
                    isPausedRef.current = true
                  }}
                  className="px-4 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold transition-colors"
                >
                  ⏸️ Jeda (Pause)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(false)
                    isPausedRef.current = false
                  }}
                  className="px-4 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition-colors animate-pulse"
                >
                  ▶️ Lanjutkan (Resume)
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (confirm('Apakah Anda yakin ingin membatalkan proses import? Pesanan yang sudah tersimpan akan tetap berada di database.')) {
                    setIsCancelled(true)
                    isCancelledRef.current = true
                  }
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold transition-colors"
              >
                ⏹️ Batalkan & Selesai
              </button>
            </div>

            {/* Real-time Activity Log Ticker */}
            <div className="max-w-2xl mx-auto bg-slate-900 text-slate-200 rounded-xl p-3 font-mono text-[11px] h-36 overflow-y-auto space-y-1">
              {activityLogs.map((log, idx) => (
                <div key={idx} className="truncate">{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 5: RESULT & FAILED ROWS REPORT ────────────────────────────── */}
        {step === 'result' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm">
            <div className="text-center max-w-lg mx-auto mb-8">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mx-auto mb-3">
                🎉
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                Proses Import Selesai!
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Seluruh batch telah selesai diproses oleh mesin ingest ShapeUp CRM.
              </p>
            </div>

            {/* Summary Statistics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto mb-8">
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 text-center">
                <div className="text-2xl font-black text-emerald-600">{insertedTotal.toLocaleString('id-ID')}</div>
                <div className="text-xs font-bold text-emerald-800">Berhasil Disimpan</div>
              </div>
              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 text-center">
                <div className="text-2xl font-black text-blue-600">{updatedTotal.toLocaleString('id-ID')}</div>
                <div className="text-xs font-bold text-blue-800">Diperbarui</div>
              </div>
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 text-center">
                <div className="text-2xl font-black text-amber-600">{skippedTotal.toLocaleString('id-ID')}</div>
                <div className="text-xs font-bold text-amber-800">Dilewati (Duplikat)</div>
              </div>
              <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 text-center">
                <div className="text-2xl font-black text-rose-600">{failedOrders.length.toLocaleString('id-ID')}</div>
                <div className="text-xs font-bold text-rose-800">Gagal Diproses</div>
              </div>
            </div>

            {/* Failed Rows Section if any */}
            {failedOrders.length > 0 && (
              <div className="max-w-4xl mx-auto mb-8 p-5 rounded-2xl border border-rose-200 bg-rose-50/30">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-rose-900 flex items-center gap-1.5">
                      <span>⚠️</span> Terdapat {failedOrders.length} Pesanan yang Gagal Diproses
                    </h3>
                    <p className="text-xs text-rose-700 mt-0.5">
                      Unduh berkas laporan gagal untuk memperbaiki datanya di Excel tanpa perlu mengimpor ulang pesanan yang sudah berhasil.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadFailedExcel}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5 self-start sm:self-auto"
                  >
                    📥 Download Baris Gagal (.xlsx)
                  </button>
                </div>

                {/* Mini Preview of Failed Rows */}
                <div className="overflow-x-auto bg-white rounded-xl border border-rose-200 max-h-56">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-rose-100/50 text-rose-900 font-bold border-b border-rose-200">
                        <th className="py-2 px-3">Baris Asli</th>
                        <th className="py-2 px-3">No. Pesanan</th>
                        <th className="py-2 px-3">Pelanggan</th>
                        <th className="py-2 px-3">Alasan Kegagalan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-100">
                      {failedOrders.slice(0, 10).map((f, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-mono text-slate-500">#{f.rowNumbers}</td>
                          <td className="py-2 px-3 font-semibold text-slate-800">{f.order_number}</td>
                          <td className="py-2 px-3 text-slate-600">{f.customer_name}</td>
                          <td className="py-2 px-3 text-rose-600 font-medium">{f.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Final CTA Buttons */}
            <div className="flex items-center justify-center gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setStep('upload')
                  setRawRows([])
                  setHeaders([])
                  setFileName('')
                }}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Import Berkas Lainnya
              </button>

              <Link
                href="/orders"
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white shadow-sm transition-colors"
              >
                Lihat Daftar Pesanan →
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
