"use client"

import { useState, useEffect, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Category = {
  id: string
  name: string
}

const TARGET_FIELDS = [
  { key: 'name', name: 'Nama Produk / Barang', required: true, desc: 'Nama lengkap item atau jasa' },
  { key: 'sku', name: 'Kode SKU / Barcode', required: false, desc: 'Kode identifikasi unik atau barcode produk' },
  { key: 'price', name: 'Harga Jual', required: false, desc: 'Harga jual satuan (default: Rp 0)' },
  { key: 'cost_price', name: 'HPP / Harga Modal Beli', required: false, desc: 'Harga modal perolehan barang (default: Rp 0)' },
  { key: 'category', name: 'Kategori Produk', required: false, desc: 'Kategori barang (otomatis dibuat jika belum ada)' },
  { key: 'stock_quantity', name: 'Stok Awal Fisik', required: false, desc: 'Jumlah fisik stok awal (contoh: 10, 50, 100)' },
  { key: 'unit', name: 'Satuan Unit', required: false, desc: 'Satuan barang (pcs, box, kg, botol, pack, dll)' },
  { key: 'type', name: 'Tipe Produk', required: false, desc: 'Barang Fisik (physical) atau Layanan Jasa (service)' },
  { key: 'stock_type', name: 'Status Pelacakan Stok', required: false, desc: 'Isi: "lacak" / "tracked" (hitung saldo rak), "tersedia" / "available" (selalu ada/bebas), atau kosongkan (otomatis di-set ke Lacak Stok)' },
  { key: 'description', name: 'Deskripsi / Detail', required: false, desc: 'Catatan detail spesifikasi produk' }
]

const detectProductFieldByHeader = (header: string): string => {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '')

  if (h.includes('sku') || h.includes('barcode') || h.includes('kode') || h.includes('itemcode') || h.includes('upc')) {
    return 'sku'
  }
  if (h.includes('hpp') || h.includes('modal') || h.includes('hargabeli') || h.includes('cost') || h.includes('buyprice') || h.includes('hargamodal')) {
    return 'cost_price'
  }
  if (h.includes('hargajual') || h.includes('harga') || h.includes('price') || h.includes('jual') || h.includes('tarif') || h.includes('retail')) {
    return 'price'
  }
  if (h.includes('kategori') || h.includes('category') || h.includes('jenis') || h.includes('golongan') || h.includes('kelompok') || h.includes('katalog')) {
    return 'category'
  }
  if (h.includes('statusstok') || h.includes('tipestok') || h.includes('stocktype') || h.includes('lacakstok') || h.includes('lacak') || h.includes('tracking')) {
    return 'stock_type'
  }
  if (h.includes('stokawal') || h.includes('openingstock') || h.includes('stok') || h.includes('stock') || h.includes('qty') || h.includes('quantity') || h.includes('jumlah') || h.includes('saldo')) {
    return 'stock_quantity'
  }
  if (h.includes('satuan') || h.includes('unit') || h.includes('uom')) {
    return 'unit'
  }
  if (h.includes('deskripsi') || h.includes('keterangan') || h.includes('desc') || h.includes('detail') || h.includes('catatan') || h.includes('notes')) {
    return 'description'
  }
  if (h.includes('tipe') || h.includes('type') || h.includes('jenisproduk')) {
    return 'type'
  }
  if (h.includes('namaproduk') || h.includes('namabarang') || h.includes('nama') || h.includes('product') || h.includes('title') || h.includes('item')) {
    return 'name'
  }

  return ''
}

const parseNumeric = (val: any): number => {
  if (val === undefined || val === null) return 0
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  const str = String(val).trim()
  if (!str) return 0
  const cleanStr = str.replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleanStr)
  return isNaN(num) ? 0 : num
}

export default function ProductImportPage() {
  const router = useRouter()

  // State Context
  const [categories, setCategories] = useState<Category[]>([])
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Wizard Steps
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'result'>('upload')
  const [fileName, setFileName] = useState<string>('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rawData, setRawData] = useState<any[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})

  // Default configuration options
  const [defaultCategory, setDefaultCategory] = useState<string>('')
  const [defaultUnit, setDefaultUnit] = useState<string>('pcs')
  const [defaultType, setDefaultType] = useState<'physical' | 'service'>('physical')
  // Default stock is STRICTLY tracked
  const [defaultStockType, setDefaultStockType] = useState<'tracked' | 'available'>('tracked')
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update'>('skip')

  // Streaming Import Progress & Results
  const [importProgress, setImportProgress] = useState(0) // 0 to 100
  const [processedCount, setProcessedCount] = useState(0)
  const [totalToImport, setTotalToImport] = useState(0)
  const [insertedTotal, setInsertedTotal] = useState(0)
  const [updatedTotal, setUpdatedTotal] = useState(0)
  const [skippedTotal, setSkippedTotal] = useState(0)
  const [failedRows, setFailedRows] = useState<Array<{
    rowNumber: number
    name: string
    sku: string | null
    price: number
    cost_price: number
    category: string | null
    stock_quantity: number
    unit: string
    reason: string
  }>>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCancelled, setIsCancelled] = useState(false)
  const isCancelledRef = useRef(false)

  // Load business context and categories
  useEffect(() => {
    async function loadContext() {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

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

          const { data: catData } = await supabase
            .from('categories')
            .select('id, name')
            .eq('business_id', businessId)
            .order('name', { ascending: true })

          setCategories(catData || [])
        }
      } catch (err) {
        console.error('Error loading product import context:', err)
      } finally {
        setLoading(false)
      }
    }
    loadContext()
  }, [router])

  // File Upload Handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const selectedFile = files[0]
    setFileName(selectedFile.name)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]

        const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
        if (data.length === 0) {
          alert('File kosong! Silakan pilih file yang berisi data produk.')
          return
        }

        const fileHeaders = (data[0] as any[])
          .map(h => String(h || '').trim())
          .filter(Boolean)

        const fileRows = data.slice(1)

        setHeaders(fileHeaders)

        const formattedRows = fileRows
          .map(row => {
            const rowObj: Record<string, any> = {}
            fileHeaders.forEach((h, idx) => {
              rowObj[h] = (row as any[])[idx]
            })
            return rowObj
          })
          .filter(r => Object.values(r).some(v => v !== undefined && v !== null && v !== ''))

        setRawData(formattedRows)

        // Read mapping presets from LocalStorage
        const presets = JSON.parse(localStorage.getItem('product_import_mapping_presets') || '{}')
        const initialMapping: Record<string, string> = {}

        fileHeaders.forEach(h => {
          if (presets[h]) {
            initialMapping[h] = presets[h]
          } else {
            initialMapping[h] = detectProductFieldByHeader(h)
          }
        })

        setMapping(initialMapping)
        setStep('mapping')
      } catch (err) {
        console.error('Failed to parse excel file:', err)
        alert('Gagal membaca file. Pastikan format file Excel (.xlsx/.xls) atau CSV valid.')
      }
    }
    reader.readAsBinaryString(selectedFile)
  }

  // Handle Mapping change
  const handleMapChange = (header: string, targetField: string) => {
    setMapping(prev => ({ ...prev, [header]: targetField }))

    const presets = JSON.parse(localStorage.getItem('product_import_mapping_presets') || '{}')
    if (targetField === '') {
      delete presets[header]
    } else {
      presets[header] = targetField
    }
    localStorage.setItem('product_import_mapping_presets', JSON.stringify(presets))
  }

  // Download Sample Template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Nama Produk': 'Kemeja Flannel Pria',
        'SKU': 'KFL-001',
        'Harga Jual': 175000,
        'HPP Modal': 95000,
        'Kategori': 'Pakaian Pria',
        'Stok Awal': 25,
        'Satuan': 'pcs',
        'Deskripsi': 'Bahan katun flannel premium tebal dan adem'
      },
      {
        'Nama Produk': 'Celana Chino Slim Fit',
        'SKU': 'CCN-002',
        'Harga Jual': 195000,
        'HPP Modal': 110000,
        'Kategori': 'Pakaian Pria',
        'Stok Awal': 40,
        'Satuan': 'pcs',
        'Deskripsi': 'Celana chino stretch katun twill'
      },
      {
        'Nama Produk': 'Jasa Jahit & Vermak',
        'SKU': 'SRV-001',
        'Harga Jual': 35000,
        'HPP Modal': 10000,
        'Kategori': 'Jasa',
        'Stok Awal': 0,
        'Satuan': 'pcs',
        'Deskripsi': 'Jasa potong dan vermak pakaian'
      }
    ]

    const ws = XLSX.utils.json_to_sheet(templateData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Template Produk')
    XLSX.writeFile(wb, 'template_import_produk_shapeup.xlsx')
  }

  // Parsed and Validated Data
  const parsedData = useMemo(() => {
    return rawData.map((row, idx) => {
      const result: any = {
        _index: idx + 1,
        _errors: [] as string[],
        _warnings: [] as string[]
      }

      let rawName: any = null
      let rawSku: any = null
      let rawPrice: any = null
      let rawCost: any = null
      let rawCat: any = null
      let rawStock: any = null
      let rawUnit: any = null
      let rawType: any = null
      let rawStockType: any = null
      let rawDesc: any = null

      headers.forEach(h => {
        const target = mapping[h]
        if (target === 'name') rawName = row[h]
        if (target === 'sku') rawSku = row[h]
        if (target === 'price') rawPrice = row[h]
        if (target === 'cost_price') rawCost = row[h]
        if (target === 'category') rawCat = row[h]
        if (target === 'stock_quantity') rawStock = row[h]
        if (target === 'unit') rawUnit = row[h]
        if (target === 'type') rawType = row[h]
        if (target === 'stock_type') rawStockType = row[h]
        if (target === 'description') rawDesc = row[h]
      })

      // Validation: Name is the only strictly required field
      const cleanName = rawName !== undefined && rawName !== null ? String(rawName).trim() : ''
      if (!cleanName) {
        result._errors.push('Nama produk wajib diisi')
        result.name = '-'
      } else {
        result.name = cleanName
      }

      result.sku = rawSku !== undefined && rawSku !== null ? String(rawSku).trim() : null
      result.price = parseNumeric(rawPrice)
      result.cost_price = parseNumeric(rawCost)
      result.stock_quantity = parseNumeric(rawStock)
      result.unit = rawUnit !== undefined && rawUnit !== null && String(rawUnit).trim() ? String(rawUnit).trim() : defaultUnit
      result.description = rawDesc !== undefined && rawDesc !== null ? String(rawDesc).trim() : null

      // Category
      const cleanCat = rawCat !== undefined && rawCat !== null ? String(rawCat).trim() : ''
      if (cleanCat) {
        result.category = cleanCat
      } else if (defaultCategory) {
        const found = categories.find(c => c.id === defaultCategory)
        result.category = found ? found.name : null
      } else {
        result.category = null
      }

      // Type & Stock Type
      const typeStr = String(rawType || '').toLowerCase()
      result.type = typeStr.includes('jasa') || typeStr.includes('service') ? 'service' : defaultType

      const stockTypeStr = String(rawStockType || '').toLowerCase()
      if (stockTypeStr.includes('tersedia') || stockTypeStr.includes('available') || stockTypeStr.includes('bebas')) {
        result.stock_type = 'available'
      } else if (stockTypeStr.includes('tidak') || stockTypeStr.includes('unavailable')) {
        result.stock_type = 'unavailable'
      } else {
        // Strict default: Physical products are ALWAYS tracked (lacak stok)
        result.stock_type = result.type === 'service' ? 'available' : 'tracked'
      }

      result._valid = result._errors.length === 0
      return result
    })
  }, [rawData, headers, mapping, defaultCategory, defaultUnit, defaultType, defaultStockType, categories])

  const stats = useMemo(() => {
    const total = parsedData.length
    const valid = parsedData.filter(d => d._valid).length
    const errors = total - valid
    return { total, valid, errors }
  }, [parsedData])

  // Download Failed Rows as Excel (.xlsx)
  const handleDownloadFailedRows = () => {
    if (failedRows.length === 0) return

    const exportData = failedRows.map(r => ({
      'Baris ke- (File Asli)': r.rowNumber,
      'Nama Produk': r.name,
      'SKU / Barcode': r.sku || '',
      'Kategori': r.category || '',
      'Harga Jual': r.price,
      'HPP Modal': r.cost_price,
      'Stok Awal': r.stock_quantity,
      'Satuan': r.unit,
      'Alasan Kegagalan': r.reason
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Baris Gagal')

    // Column widths for neat formatting
    ws['!cols'] = [
      { wch: 22 },
      { wch: 32 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 10 },
      { wch: 45 }
    ]

    const cleanBaseName = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'produk'
    XLSX.writeFile(wb, `gagal_import_${cleanBaseName}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // Streaming Batch Import (Zero-Timeout Engine) with Resilient Failure Isolation
  const handleStartImport = async () => {
    // 1. Collect pre-validation errors (e.g. empty name)
    const currentFailedRows: typeof failedRows = []

    parsedData.forEach((d, idx) => {
      if (!d._valid) {
        currentFailedRows.push({
          rowNumber: idx + 2, // 1-based, considering header is row 1
          name: d.name || '-',
          sku: d.sku || null,
          price: d.price || 0,
          cost_price: d.cost_price || 0,
          category: d.category || null,
          stock_quantity: d.stock_quantity || 0,
          unit: d.unit || defaultUnit,
          reason: d._errors.join(', ') || 'Nama produk wajib diisi'
        })
      }
    })

    const validRowsWithMeta = parsedData
      .map((d, idx) => ({ ...d, _rowNumber: idx + 2 }))
      .filter(d => d._valid)

    if (validRowsWithMeta.length === 0) {
      if (currentFailedRows.length > 0) {
        setFailedRows(currentFailedRows)
        setStep('result')
      } else {
        alert('Tidak ada data produk yang valid untuk diimpor!')
      }
      return
    }

    setStep('importing')
    setErrorMessage(null)
    setIsCancelled(false)
    isCancelledRef.current = false
    setFailedRows([])

    const BATCH_SIZE = 100 // 100 rows per HTTP batch
    const totalRows = validRowsWithMeta.length
    setTotalToImport(totalRows)
    setProcessedCount(0)
    setImportProgress(0)

    let cumInserted = 0
    let cumUpdated = 0
    let cumSkipped = 0

    for (let i = 0; i < totalRows; i += BATCH_SIZE) {
      if (isCancelledRef.current) {
        break
      }

      const chunkMeta = validRowsWithMeta.slice(i, i + BATCH_SIZE)
      const chunkPayload = chunkMeta.map(d => ({
        name: d.name,
        sku: d.sku,
        price: d.price,
        cost_price: d.cost_price,
        category: d.category,
        stock_quantity: d.stock_quantity,
        unit: d.unit,
        type: d.type,
        stock_type: d.stock_type,
        description: d.description,
        hpp_type: 'fixed'
      }))

      try {
        const response = await fetch('/api/products/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            products: chunkPayload,
            duplicateAction,
            defaultCategoryId: defaultCategory || null
          })
        })

        const data = await response.json()
        if (!response.ok) {
          // If this batch failed, isolate it and record all items as failed, but CONTINUE loop
          const errMsg = data.error || `HTTP ${response.status}: Gagal memproses batch`
          chunkMeta.forEach(item => {
            currentFailedRows.push({
              rowNumber: item._rowNumber,
              name: item.name,
              sku: item.sku,
              price: item.price,
              cost_price: item.cost_price,
              category: item.category,
              stock_quantity: item.stock_quantity,
              unit: item.unit,
              reason: errMsg
            })
          })
        } else {
          cumInserted += data.insertedCount || 0
          cumUpdated += data.updatedCount || 0
          cumSkipped += data.skippedCount || 0

          // If API returned individual row failures
          if (Array.isArray(data.failedItems) && data.failedItems.length > 0) {
            data.failedItems.forEach((f: any) => {
              const matched = chunkMeta[f.index]
              if (matched) {
                currentFailedRows.push({
                  rowNumber: matched._rowNumber,
                  name: f.name || matched.name,
                  sku: f.sku || matched.sku,
                  price: matched.price,
                  cost_price: matched.cost_price,
                  category: matched.category,
                  stock_quantity: matched.stock_quantity,
                  unit: matched.unit,
                  reason: f.reason || 'Gagal disimpan'
                })
              }
            })
          }
        }
      } catch (err: any) {
        // Network or connection timeout failure for this chunk
        const errMsg = err.message || 'Koneksi jaringan terputus saat memproses batch'
        chunkMeta.forEach(item => {
          currentFailedRows.push({
            rowNumber: item._rowNumber,
            name: item.name,
            sku: item.sku,
            price: item.price,
            cost_price: item.cost_price,
            category: item.category,
            stock_quantity: item.stock_quantity,
            unit: item.unit,
            reason: errMsg
          })
        })
      }

      const currentProcessed = Math.min(i + BATCH_SIZE, totalRows)
      setProcessedCount(currentProcessed)
      setInsertedTotal(cumInserted)
      setUpdatedTotal(cumUpdated)
      setSkippedTotal(cumSkipped)
      setImportProgress(Math.round((currentProcessed / totalRows) * 100))
    }

    setFailedRows(currentFailedRows)

    // Invalidate products cache in sessionStorage so /products displays fresh data immediately
    if (activeBizId) {
      sessionStorage.removeItem(`su_products_data_${activeBizId}`)
    }

    setStep('result')
  }

  const formatPrice = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val)
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Memuat Konfigurasi Bisnis...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <Link
            href="/products"
            className="inline-flex items-center gap-1.5 text-xs font-extrabold text-indigo-600 hover:text-indigo-700 uppercase tracking-wider mb-2 transition-colors"
          >
            ← Kembali ke Kelola Produk
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black tracking-widest text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100 uppercase">
              📤 Import Wizard
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100 uppercase">
                🏢 {activeBizName}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight mt-1">
            Import Produk & Jasa Massal
          </h1>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            Unggah file Excel atau CSV produk Anda dengan sistem pemetaan kolom otomatis dan engine anti-timeout.
          </p>
        </div>

        {/* Wizard Steps indicator */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider shadow-2xs">
          <div className={`flex items-center gap-1.5 ${step === 'upload' ? 'text-indigo-600' : 'text-emerald-600'}`}>
            <span>{step === 'upload' ? '⚪' : '🟢'}</span> Upload
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1.5 ${step === 'mapping' ? 'text-indigo-600' : step !== 'upload' ? 'text-emerald-600' : ''}`}>
            <span>{step === 'mapping' ? '⚪' : step !== 'upload' ? '🟢' : '⚫'}</span> Mapping
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1.5 ${step === 'preview' ? 'text-indigo-600' : step === 'result' ? 'text-emerald-600' : ''}`}>
            <span>{step === 'preview' ? '⚪' : step === 'result' ? '🟢' : '⚫'}</span> Preview
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1.5 ${step === 'importing' || (step === 'result' && !errorMessage) ? 'text-indigo-600' : ''}`}>
            <span>{step === 'importing' ? '⌛' : step === 'result' && !errorMessage ? '🟢' : '⚫'}</span> Selesai
          </div>
        </div>
      </div>

      {/* Main Container Card */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden flex flex-col min-h-[420px]">
        
        {/* Content Area */}
        <div className="flex-1 p-6 sm:p-8">

          {/* STEP 1: UPLOAD FILE */}
          {step === 'upload' && (
            <div className="space-y-6">
              <div className="text-center max-w-lg mx-auto space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center text-2xl shadow-inner">
                  📁
                </div>
                <h2 className="text-base font-extrabold text-gray-900 uppercase tracking-wide">
                  Pilih File Excel atau CSV
                </h2>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Unggah file katalog produk dari software lama, supplier, atau marketplace. Format yang didukung: <span className="font-semibold text-gray-700">.xlsx, .xls, .csv</span>
                </p>
              </div>

              {/* Dropzone */}
              <div className="max-w-xl mx-auto">
                <label className="border-2 border-dashed border-gray-300 hover:border-indigo-500 bg-gray-50/50 hover:bg-indigo-50/20 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all group">
                  <div className="w-12 h-12 rounded-full bg-white shadow-xs border border-gray-200 flex items-center justify-center text-xl text-gray-600 group-hover:scale-110 transition-transform mb-3">
                    📤
                  </div>
                  <span className="text-sm font-bold text-gray-800 group-hover:text-indigo-600">
                    Klik untuk memilih file produk
                  </span>
                  <span className="text-[11px] text-gray-400 mt-1 font-medium">
                    Atau seret dan lepas file Anda ke kotak ini
                  </span>
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
              </div>

              {/* Template Helper Card */}
              <div className="max-w-xl mx-auto bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                    📊
                  </div>
                  <div>
                    <span className="font-bold text-gray-800 block">Belum punya format file?</span>
                    <span className="text-gray-500 text-[11px]">Gunakan template Excel standar kami untuk mengisi data dengan mudah.</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="px-3.5 py-2 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 font-bold rounded-lg text-[11px] uppercase tracking-wider shadow-2xs transition-all whitespace-nowrap cursor-pointer"
                >
                  📥 Unduh Template (.xlsx)
                </button>
              </div>

              {/* Information Notice */}
              <div className="max-w-xl mx-auto bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5 text-[11px] text-amber-900">
                <span className="text-amber-600 font-bold mt-0.5">💡</span>
                <p>
                  <strong>Tips Praktis:</strong> Kolom yang <strong>mutlak wajib</strong> hanya <strong>Nama Produk</strong>. Kolom lain seperti Harga, SKU, Kategori, dan Stok Awal bersifat opsional dan dapat diisi kemudian.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPING & DEFAULT CONFIG */}
          {step === 'mapping' && (
            <div className="space-y-6">
              <div className="border-b border-gray-100 pb-4 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                <div>
                  <h2 className="text-base font-extrabold text-gray-900 uppercase tracking-wide">
                    Pemetaan Kolom & Pengaturan Default
                  </h2>
                  <p className="text-xs text-gray-500">
                    File: <span className="font-bold text-gray-800">{fileName}</span> ({rawData.length} baris data ditemukan)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
                >
                  Ganti File ↺
                </button>
              </div>

              {/* Global Defaults Section */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                  ⚙️ Pengaturan Default (Jika Kolom di File Kosong)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  
                  {/* Default Category */}
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                      Kategori Default
                    </label>
                    <select
                      value={defaultCategory}
                      onChange={e => setDefaultCategory(e.target.value)}
                      className="w-full text-xs font-semibold p-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-indigo-600"
                    >
                      <option value="">-- Tanpa Kategori --</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Default Unit */}
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                      Satuan Default
                    </label>
                    <input
                      type="text"
                      value={defaultUnit}
                      onChange={e => setDefaultUnit(e.target.value)}
                      placeholder="pcs"
                      className="w-full text-xs font-semibold p-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-indigo-600"
                    />
                  </div>

                  {/* Default Type */}
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                      Tipe Produk Default
                    </label>
                    <select
                      value={defaultType}
                      onChange={e => setDefaultType(e.target.value as 'physical' | 'service')}
                      className="w-full text-xs font-semibold p-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-indigo-600"
                    >
                      <option value="physical">Barang Fisik</option>
                      <option value="service">Jasa / Service</option>
                    </select>
                  </div>

                  {/* Duplicate Strategy */}
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">
                      Jika SKU/Nama Sudah Ada
                    </label>
                    <select
                      value={duplicateAction}
                      onChange={e => setDuplicateAction(e.target.value as 'skip' | 'update')}
                      className="w-full text-xs font-semibold p-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-indigo-600"
                    >
                      <option value="skip">Lewati (Abaikan)</option>
                      <option value="update">Perbarui Data Lama</option>
                    </select>
                  </div>

                </div>
              </div>

              {/* Mapping Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-600 font-extrabold text-[10px] uppercase tracking-wider">
                      <th className="py-2.5 px-4 w-1/3">Header Kolom di File Excel</th>
                      <th className="py-2.5 px-4 w-1/12 text-center">➔</th>
                      <th className="py-2.5 px-4 w-7/12">Target Field di CRM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {headers.map(header => {
                      const selectedField = mapping[header] || ''
                      const targetObj = TARGET_FIELDS.find(f => f.key === selectedField)

                      return (
                        <tr key={header} className="hover:bg-indigo-50/30 transition-colors">
                          <td className="py-3 px-4 font-bold text-gray-800">
                            {header}
                            {rawData[0] && rawData[0][header] !== undefined && (
                              <span className="block text-[10px] text-gray-400 font-normal truncate max-w-xs mt-0.5">
                                Contoh: {String(rawData[0][header])}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center text-gray-300 font-bold">
                            ➔
                          </td>
                          <td className="py-3 px-4">
                            <select
                              value={selectedField}
                              onChange={e => handleMapChange(header, e.target.value)}
                              className={`w-full text-xs font-semibold p-2 border rounded-lg bg-white outline-none transition-all ${
                                selectedField ? 'border-indigo-500 ring-1 ring-indigo-500/20 text-gray-900' : 'border-gray-300 text-gray-400'
                              }`}
                            >
                              <option value="">-- Jangan Impor Kolom Ini (Abaikan) --</option>
                              {TARGET_FIELDS.map(f => (
                                <option key={f.key} value={f.key}>
                                  {f.name} {f.required ? '*(Wajib)' : ''}
                                </option>
                              ))}
                            </select>
                            {targetObj && (
                              <span className="block text-[10px] text-indigo-600 font-medium mt-1">
                                {targetObj.desc}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & VERIFICATION */}
          {step === 'preview' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-gray-100 pb-4">
                <div>
                  <h2 className="text-base font-extrabold text-gray-900 uppercase tracking-wide">
                    Pratinjau & Validasi Data
                  </h2>
                  <p className="text-xs text-gray-500">
                    Memeriksa integritas {stats.total} baris produk sebelum dimasukkan ke database.
                  </p>
                </div>
                
                {/* Stats Badges */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-slate-100 text-slate-800 font-bold px-3 py-1 rounded-lg border border-slate-200">
                    Total: {stats.total}
                  </span>
                  <span className="bg-emerald-50 text-emerald-700 font-bold px-3 py-1 rounded-lg border border-emerald-200">
                    ✓ Valid: {stats.valid}
                  </span>
                  {stats.errors > 0 && (
                    <span className="bg-rose-50 text-rose-700 font-bold px-3 py-1 rounded-lg border border-rose-200">
                      ✕ Error: {stats.errors}
                    </span>
                  )}
                </div>
              </div>

              {/* Preview Table */}
              <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-2xs">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-100/80 border-b border-gray-200 text-gray-600 font-extrabold text-[10px] uppercase tracking-wider">
                      <th className="py-2.5 px-3">No</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Nama Produk</th>
                      <th className="py-2.5 px-3">SKU</th>
                      <th className="py-2.5 px-3">Harga Jual</th>
                      <th className="py-2.5 px-3">HPP Modal</th>
                      <th className="py-2.5 px-3">Kategori</th>
                      <th className="py-2.5 px-3">Stok Awal</th>
                      <th className="py-2.5 px-3">Satuan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedData.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className={row._valid ? 'hover:bg-gray-50' : 'bg-rose-50/40 hover:bg-rose-50/60'}>
                        <td className="py-2.5 px-3 text-gray-400 font-bold">{row._index}</td>
                        <td className="py-2.5 px-3">
                          {row._valid ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                              Siap
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full" title={row._errors.join(', ')}>
                              Error
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-gray-900">
                          {row.name}
                          {row._errors.length > 0 && (
                            <span className="block text-[10px] text-rose-600 font-medium">
                              {row._errors.join(', ')}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-500 font-mono text-[11px]">{row.sku || '-'}</td>
                        <td className="py-2.5 px-3 font-semibold text-gray-800">{formatPrice(row.price)}</td>
                        <td className="py-2.5 px-3 text-gray-600">{formatPrice(row.cost_price)}</td>
                        <td className="py-2.5 px-3">
                          <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-medium">
                            {row.category || 'Umum'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-gray-800">{row.stock_quantity}</td>
                        <td className="py-2.5 px-3 text-gray-500">{row.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsedData.length > 10 && (
                <p className="text-[11px] text-center text-gray-400 font-medium italic">
                  Menampilkan 10 dari total {parsedData.length} baris produk. Semua {stats.valid} baris valid akan diproses saat impor.
                </p>
              )}
            </div>
          )}

          {/* STEP 4: STREAMING IMPORTING (ZERO TIMEOUT ENGINE) */}
          {step === 'importing' && (
            <div className="py-12 px-4 max-w-lg mx-auto text-center space-y-6">
              <div className="w-16 h-16 rounded-3xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center text-3xl shadow-inner animate-pulse">
                ⚡
              </div>
              <div>
                <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                  Memproses Import Produk...
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Mengirimkan data dalam chunk mikro untuk menjamin kebebasan dari batas waktu serverless (Zero-Timeout).
                </p>
              </div>

              {/* Progress Bar Container */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-indigo-600">{importProgress}% Selesai</span>
                  <span className="text-gray-500">{processedCount} / {totalToImport} Produk</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden p-0.5 border border-gray-200">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${importProgress}%` }}
                  ></div>
                </div>
              </div>

              {/* Live Mini Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase block">Ditambahkan</span>
                  <span className="text-base font-black text-emerald-800">{insertedTotal}</span>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-2.5">
                  <span className="text-[10px] font-bold text-blue-600 uppercase block">Diperbarui</span>
                  <span className="text-base font-black text-blue-800">{updatedTotal}</span>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase block">Dilewati</span>
                  <span className="text-base font-black text-gray-700">{skippedTotal}</span>
                </div>
                <div className={`border rounded-xl p-2.5 ${
                  failedRows.length > 0 ? 'bg-rose-50 border-rose-200' : 'bg-gray-50 border-gray-200 opacity-60'
                }`}>
                  <span className={`text-[10px] font-bold uppercase block ${
                    failedRows.length > 0 ? 'text-rose-600' : 'text-gray-400'
                  }`}>
                    Gagal
                  </span>
                  <span className={`text-base font-black ${
                    failedRows.length > 0 ? 'text-rose-800' : 'text-gray-400'
                  }`}>
                    {failedRows.length}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: RESULT & AUDIT */}
          {step === 'result' && (
            <div className="py-8 px-4 max-w-xl mx-auto text-center space-y-6">
              {failedRows.length > 0 && insertedTotal === 0 && updatedTotal === 0 ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center text-2xl">
                    ✕
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                      Seluruh Baris Gagal Diimpor
                    </h2>
                    <p className="text-xs text-rose-600 font-medium mt-1">
                      {errorMessage || `Terdapat ${failedRows.length} baris produk yang bermasalah.`}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center text-2xl">
                    ✓
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                      Proses Impor Selesai!
                    </h2>
                    <p className="text-xs text-gray-500 font-medium mt-1">
                      Data produk telah selesai diproses ke database master Anda.
                    </p>
                  </div>
                </>
              )}

              {/* Summary Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <span className="text-[10px] font-black uppercase text-emerald-600 tracking-wider block">
                    Ditambahkan
                  </span>
                  <span className="text-xl font-black text-emerald-900 mt-0.5 block">
                    {insertedTotal}
                  </span>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <span className="text-[10px] font-black uppercase text-blue-600 tracking-wider block">
                    Diperbarui
                  </span>
                  <span className="text-xl font-black text-blue-900 mt-0.5 block">
                    {updatedTotal}
                  </span>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider block">
                    Dilewati
                  </span>
                  <span className="text-xl font-black text-gray-800 mt-0.5 block">
                    {skippedTotal}
                  </span>
                </div>
                <div className={`border rounded-xl p-3 ${
                  failedRows.length > 0 ? 'bg-rose-50 border-rose-200' : 'bg-gray-50 border-gray-200 opacity-60'
                }`}>
                  <span className={`text-[10px] font-black uppercase tracking-wider block ${
                    failedRows.length > 0 ? 'text-rose-600' : 'text-gray-400'
                  }`}>
                    Gagal
                  </span>
                  <span className={`text-xl font-black mt-0.5 block ${
                    failedRows.length > 0 ? 'text-rose-900' : 'text-gray-400'
                  }`}>
                    {failedRows.length}
                  </span>
                </div>
              </div>

              {/* FAILED ROWS ACTION & DOWNLOAD BANNER */}
              {failedRows.length > 0 && (
                <div className="bg-rose-50/90 border border-rose-200 rounded-2xl p-4 text-left space-y-3 shadow-xs">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="text-xl leading-none mt-0.5">⚠️</span>
                      <div>
                        <h4 className="text-xs font-black text-rose-900 uppercase tracking-tight">
                          Terdapat {failedRows.length} baris produk yang gagal
                        </h4>
                        <p className="text-[11px] text-rose-700 font-medium">
                          Unduh file Excel berisi baris gagal beserta alasan kegagalannya untuk diperbaiki.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadFailedRows}
                      className="w-full sm:w-auto px-4 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      📥 Download Baris Gagal ({failedRows.length}) (.xlsx)
                    </button>
                  </div>

                  {/* Quick table preview of failed rows */}
                  <div className="max-h-40 overflow-y-auto border border-rose-200/80 rounded-lg bg-white">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-rose-100/50 text-rose-900 font-bold uppercase sticky top-0 text-[10px]">
                        <tr>
                          <th className="py-1.5 px-2.5">Baris</th>
                          <th className="py-1.5 px-2.5">Nama Produk</th>
                          <th className="py-1.5 px-2.5">Keterangan Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-100 font-medium text-gray-700">
                        {failedRows.slice(0, 15).map((r, i) => (
                          <tr key={i} className="hover:bg-rose-50/50">
                            <td className="py-1.5 px-2.5 font-bold text-gray-500">{r.rowNumber}</td>
                            <td className="py-1.5 px-2.5 font-bold text-gray-900">{r.name}</td>
                            <td className="py-1.5 px-2.5 text-rose-700">{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {failedRows.length > 15 && (
                    <p className="text-[10px] text-gray-400 italic text-center">
                      Menampilkan 15 dari total {failedRows.length} baris gagal. Silakan klik tombol di atas untuk mengunduh data lengkap.
                    </p>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                <Link
                  href="/products"
                  className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-sm transition-all text-center"
                >
                  Lihat Katalog Produk ➔
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setStep('upload')
                    setRawData([])
                    setHeaders([])
                    setFileName('')
                  }}
                  className="w-full sm:w-auto px-5 py-2.5 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-xl transition-all"
                >
                  Impor File Lain
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer Navigation Bar for Wizard */}
        {step !== 'upload' && step !== 'importing' && step !== 'result' && (
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (step === 'mapping') setStep('upload')
                if (step === 'preview') setStep('mapping')
              }}
              className="px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-xl transition-all"
            >
              ← Kembali
            </button>

            {step === 'mapping' && (
              <button
                type="button"
                onClick={() => setStep('preview')}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-sm transition-all"
              >
                Lanjut ke Pratinjau ➔
              </button>
            )}

            {step === 'preview' && (
              <button
                type="button"
                onClick={handleStartImport}
                disabled={stats.valid === 0}
                className={`px-6 py-2 font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-sm transition-all ${
                  stats.valid > 0
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-98'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                Mulai Impor ({stats.valid} Produk) 🚀
              </button>
            )}
          </div>
        )}

      </div>

    </div>
  )
}
