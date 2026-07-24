"use client"
import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const TARGET_FIELDS = [
  { key: 'name', name: 'Nama Customer / Pelanggan', required: true, desc: 'Nama lengkap pelanggan' },
  { key: 'phone', name: 'Nomor HP / WhatsApp', required: true, desc: 'Nomor telepon/ponsel (08xxx / 628xxx)' },
  { key: 'email', name: 'Email', required: false, desc: 'Alamat surel customer' },
  { key: 'category', name: 'Kategori / Segmen', required: false, desc: 'Klasifikasi/kategori (default: General)' },
  { key: 'address_line1', name: 'Alamat Lengkap / Jalan', required: false, desc: 'Alamat baris 1 (jalan/nomor rumah)' },
  { key: 'address_line2', name: 'Detail Alamat / Patokan', required: false, desc: 'Alamat baris 2 (RT/RW, gedung, unit)' },
  { key: 'subdistrict', name: 'Kecamatan', required: false, desc: 'Nama kecamatan' },
  { key: 'city', name: 'Kota / Kabupaten', required: false, desc: 'Nama kota atau kabupaten' },
  { key: 'state', name: 'Provinsi', required: false, desc: 'Nama provinsi' },
  { key: 'postcode', name: 'Kode Pos', required: false, desc: 'Kode pos alamat' },
  { key: 'country', name: 'Negara', required: false, desc: 'Nama/kode negara (default: ID)' },
  { key: 'notes', name: 'Catatan / Notes', required: false, desc: 'Catatan internal atau deskripsi' },
  { key: 'company', name: 'Perusahaan / PT / CV', required: false, desc: 'Nama instansi atau perusahaan' },
  { key: 'job_title', name: 'Jabatan / Posisi', required: false, desc: 'Jabatan pekerjaan' },
  { key: 'instagram', name: 'Akun Instagram', required: false, desc: 'Username atau link Instagram' },
  { key: 'alt_phone', name: 'Telepon Kedua / Alternatif', required: false, desc: 'Nomor telepon cadangan' },
  { key: 'lead_source', name: 'Sumber Lead / Channel', required: false, desc: 'Asal customer (Website, IG, Referral, dll)' },
  { key: 'tags', name: 'Tag / Label', required: false, desc: 'Tag dipisah koma (e.g. RESELLER, VIP)' }
]

export default function CustomerImportPage() {
  const router = useRouter()
  
  // Supabase & Context State
  const [supabase] = useState(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ))
  const [activeBizName, setActiveBizName] = useState<string | null>(null)
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Wizard Steps State
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'result'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawData, setRawData] = useState<any[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  
  // Settings & Defaults
  const [defaultCategory, setDefaultCategory] = useState('General')
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update'>('skip')

  // Import Execution Status
  const [importLoading, setImportLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<{
    insertedCount: number
    updatedCount: number
    skippedCount: number
    message: string
  } | null>(null)

  // Load User Profile & Business Context
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
        }
      } catch (err) {
        console.error('Error loading import page context:', err)
      } finally {
        setLoading(false)
      }
    }
    loadContext()
  }, [supabase, router])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const selectedFile = files[0]
    setFile(selectedFile)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
        if (data.length === 0) {
          alert('File kosong!')
          return
        }

        const fileHeaders = (data[0] as any[]).map(h => String(h || '').trim()).filter(Boolean)
        const fileRows = data.slice(1)

        setHeaders(fileHeaders)
        
        const formattedRows = fileRows.map(row => {
          const rowObj: Record<string, any> = {}
          fileHeaders.forEach((h, idx) => {
            rowObj[h] = (row as any[])[idx]
          })
          return rowObj
        }).filter(r => Object.values(r).some(v => v !== undefined && v !== null && v !== ''))

        setRawData(formattedRows)

        // Read stored presets from localStorage
        const presets = JSON.parse(localStorage.getItem('customer_import_mapping_presets') || '{}')
        const initialMapping: Record<string, string> = {}
        
        fileHeaders.forEach(h => {
          // If mapping was saved previously for this exact header name, auto-plot it!
          if (presets[h]) {
            initialMapping[h] = presets[h]
          } else {
            // First time / unmapped header: leave blank
            initialMapping[h] = ''
          }
        })

        setMapping(initialMapping)
        setStep('mapping')
      } catch (err) {
        console.error('Failed to parse file:', err)
        alert('Gagal membaca file. Pastikan format file Excel atau CSV valid.')
      }
    }
    reader.readAsBinaryString(selectedFile)
  }

  const handleMapChange = (header: string, targetField: string) => {
    setMapping(prev => ({ ...prev, [header]: targetField }))
    
    // Save or update mapping preset in localStorage
    const presets = JSON.parse(localStorage.getItem('customer_import_mapping_presets') || '{}')
    if (targetField === '') {
      delete presets[header]
    } else {
      presets[header] = targetField
    }
    localStorage.setItem('customer_import_mapping_presets', JSON.stringify(presets))
  }

  const parsedData = useMemo(() => {
    const phoneCountMap = new Map<string, number>()

    // First pass to count phone occurrences in current file
    rawData.forEach(row => {
      headers.forEach(h => {
        const target = mapping[h]
        if (target === 'phone') {
          const rawVal = row[h]
          if (rawVal) {
            let clean = String(rawVal).replace(/\D/g, '')
            if (clean.startsWith('0')) clean = '62' + clean.substring(1)
            else if (clean.startsWith('8')) clean = '62' + clean
            if (clean) {
              phoneCountMap.set(clean, (phoneCountMap.get(clean) || 0) + 1)
            }
          }
        }
      })
    })

    return rawData.map((row, idx) => {
      const result: any = {
        _index: idx + 1,
        _errors: [] as string[],
        _warnings: [] as string[]
      }

      let rawName: any = null
      let rawPhone: any = null
      let rawEmail: any = null
      let rawCategory: any = null
      let rawAddr1: any = null
      let rawAddr2: any = null
      let rawSubdistrict: any = null
      let rawCity: any = null
      let rawState: any = null
      let rawPostcode: any = null
      let rawCountry: any = null
      let rawNotes: any = null
      let rawCompany: any = null
      let rawJobTitle: any = null
      let rawInstagram: any = null
      let rawAltPhone: any = null
      let rawLeadSource: any = null
      let rawTags: any = null

      headers.forEach(h => {
        const target = mapping[h]
        if (target === 'name') rawName = row[h]
        if (target === 'phone') rawPhone = row[h]
        if (target === 'email') rawEmail = row[h]
        if (target === 'category') rawCategory = row[h]
        if (target === 'address_line1') rawAddr1 = row[h]
        if (target === 'address_line2') rawAddr2 = row[h]
        if (target === 'subdistrict') rawSubdistrict = row[h]
        if (target === 'city') rawCity = row[h]
        if (target === 'state') rawState = row[h]
        if (target === 'postcode') rawPostcode = row[h]
        if (target === 'country') rawCountry = row[h]
        if (target === 'notes') rawNotes = row[h]
        if (target === 'company') rawCompany = row[h]
        if (target === 'job_title') rawJobTitle = row[h]
        if (target === 'instagram') rawInstagram = row[h]
        if (target === 'alt_phone') rawAltPhone = row[h]
        if (target === 'lead_source') rawLeadSource = row[h]
        if (target === 'tags') rawTags = row[h]
      })

      // 1. Validate Name
      const cleanName = rawName ? String(rawName).trim() : ''
      if (!cleanName) {
        result._errors.push('Nama Customer wajib diisi')
        result.name = '-'
      } else {
        result.name = cleanName
      }

      // 2. Validate Phone
      const strPhone = rawPhone ? String(rawPhone).trim() : ''
      let cleanPhone = strPhone.replace(/\D/g, '')
      if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1)
      else if (cleanPhone.startsWith('8')) cleanPhone = '62' + cleanPhone

      if (!cleanPhone || cleanPhone.length < 7) {
        result._errors.push('Nomor HP wajib diisi & harus valid (min 7 digit)')
        result.phone = strPhone || '-'
      } else {
        result.phone = cleanPhone
        if (phoneCountMap.get(cleanPhone)! > 1) {
          result._warnings.push('Nomor HP ganda ditemukan dalam file ini')
        }
      }

      // 3. Email & Category
      result.email = rawEmail ? String(rawEmail).trim() : null
      result.category = rawCategory ? String(rawCategory).trim() : defaultCategory

      // 4. Address Data
      const addr1 = rawAddr1 ? String(rawAddr1).trim() : ''
      const addr2 = rawAddr2 ? String(rawAddr2).trim() : ''
      const subdis = rawSubdistrict ? String(rawSubdistrict).trim() : ''
      const cityVal = rawCity ? String(rawCity).trim() : ''
      const stateVal = rawState ? String(rawState).trim() : ''
      const postc = rawPostcode ? String(rawPostcode).trim() : ''
      const countryVal = rawCountry ? String(rawCountry).trim() : 'ID'

      if (addr1 || addr2 || subdis || cityVal || stateVal || postc) {
        result.address_data = {
          country_preset: countryVal.toLowerCase() === 'id' || countryVal.toLowerCase() === 'indonesia' ? 'indonesia' : 'custom',
          country: countryVal || 'ID',
          address_line1: addr1,
          address_line2: addr2,
          subdistrict: subdis,
          city: cityVal,
          state: stateVal,
          postcode: postc
        }
      } else {
        result.address_data = null
      }

      // 5. Metadata (Notes, Company, Tags, etc.)
      const notesVal = rawNotes ? String(rawNotes).trim() : ''
      const compVal = rawCompany ? String(rawCompany).trim() : ''
      const jobVal = rawJobTitle ? String(rawJobTitle).trim() : ''
      const igVal = rawInstagram ? String(rawInstagram).trim() : ''
      const altPhoneVal = rawAltPhone ? String(rawAltPhone).trim() : ''
      const leadSourceVal = rawLeadSource ? String(rawLeadSource).trim() : ''

      let parsedTags: string[] = []
      if (rawTags) {
        parsedTags = String(rawTags)
          .split(/[,;]/)
          .map(t => t.trim().toUpperCase())
          .filter(Boolean)
      }

      if (notesVal || compVal || jobVal || igVal || altPhoneVal || leadSourceVal || parsedTags.length > 0) {
        result.metadata = {
          notes: notesVal,
          company: compVal,
          job_title: jobVal,
          instagram: igVal,
          alt_phone: altPhoneVal,
          lead_source: leadSourceVal,
          tags: parsedTags
        }
      } else {
        result.metadata = null
      }

      result._valid = result._errors.length === 0
      return result
    })
  }, [rawData, headers, mapping, defaultCategory])

  const stats = useMemo(() => {
    const total = parsedData.length
    const valid = parsedData.filter(d => d._valid).length
    const errors = total - valid
    return { total, valid, errors }
  }, [parsedData])

  const handleImportSubmit = async () => {
    const validPayload = parsedData.filter(d => d._valid).map(d => ({
      name: d.name,
      phone: d.phone,
      email: d.email,
      category: d.category,
      address_data: d.address_data,
      metadata: d.metadata
    }))

    if (validPayload.length === 0) {
      alert('Tidak ada data valid untuk diimpor!')
      return
    }

    setImportLoading(true)
    setStep('importing')
    setErrorMessage(null)

    try {
      const response = await fetch('/api/customers/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customers: validPayload,
          duplicateAction
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Terjadi kesalahan saat mengimpor data customer.')
      }

      setSuccessResult({
        insertedCount: data.insertedCount || 0,
        updatedCount: data.updatedCount || 0,
        skippedCount: data.skippedCount || 0,
        message: data.message || 'Impor customer berhasil!'
      })
      setStep('result')
    } catch (err: any) {
      console.error('Customer import error:', err)
      setErrorMessage(err.message || 'Gagal mengunggah data impor.')
      setStep('result')
    } finally {
      setImportLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Memuat Konfigurasi Bisnis...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 animate-in fade-in duration-200">
      
      {/* Page Navigation & Title */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <Link href="/customers" className="inline-flex items-center gap-1 text-xs font-extrabold text-blue-600 hover:text-blue-700 uppercase tracking-wider mb-2">
            ⬅ Kembali ke Customer
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">
              📤 Import Customer Wizard
            </span>
            {activeBizName && (
              <span className="text-[9px] font-black tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase">
                🏢 {activeBizName}
              </span>
            )}
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 uppercase tracking-wide mt-1">
            Import Data Customer (Odoo-Style)
          </h1>
        </div>

        {/* Wizard Steps indicator */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-4 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
          <div className={`flex items-center gap-1 ${step === 'upload' ? 'text-blue-600' : 'text-emerald-600'}`}>
            <span>{step === 'upload' ? '⚪' : '🟢'}</span> Upload
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1 ${step === 'mapping' ? 'text-blue-600' : step !== 'upload' ? 'text-emerald-600' : ''}`}>
            <span>{step === 'mapping' ? '⚪' : step !== 'upload' ? '🟢' : '⚫'}</span> Mapping
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1 ${step === 'preview' ? 'text-blue-600' : step === 'result' ? 'text-emerald-600' : ''}`}>
            <span>{step === 'preview' ? '⚪' : step === 'result' ? '🟢' : '⚫'}</span> Preview
          </div>
          <div className="text-gray-300">➔</div>
          <div className={`flex items-center gap-1 ${step === 'importing' || (step === 'result' && !errorMessage) ? 'text-blue-600' : ''}`}>
            <span>{step === 'importing' ? '⌛' : step === 'result' && !errorMessage ? '🟢' : '⚫'}</span> Selesai
          </div>
        </div>
      </div>

      {/* Main Card Container */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden flex flex-col min-h-[400px]">
        
        {/* Content Area */}
        <div className="flex-1 p-6">
          
          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div className="space-y-6 py-12">
              <div className="max-w-md mx-auto text-center">
                <div className="border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50/10 transition-all rounded-xl p-10 cursor-pointer relative group">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                    onChange={handleFileChange}
                  />
                  <div className="pointer-events-none select-none">
                    <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">👥</div>
                    <h4 className="text-xs font-black uppercase text-gray-700 tracking-wider">
                      Pilih File Excel / CSV Customer
                    </h4>
                    <p className="text-[10px] text-gray-400 mt-1.5 font-medium">
                      Drag & drop atau klik untuk menelusuri file (.xlsx, .xls, .csv)
                    </p>
                  </div>
                </div>
                <div className="mt-6 text-[10px] text-gray-500 font-semibold leading-relaxed">
                  💡 <span className="text-gray-700">Fitur Memori Mapping:</span> Saat mengunggah file dengan format kolom yang sama seperti sebelumnya, sistem akan secara otomatis mengingat dan mem-plot pemetaan kolom Anda!
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: MAPPING */}
          {step === 'mapping' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="text-xs font-semibold text-blue-800 space-y-1">
                  <div className="font-extrabold uppercase text-[9px] tracking-wider text-blue-600">Pengaturan Impor</div>
                  <div>Penanganan Duplikat Nomor HP:</div>
                  <select
                    className="mt-1 p-2 border border-blue-200 rounded-md bg-white text-xs font-bold text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={duplicateAction}
                    onChange={e => setDuplicateAction(e.target.value as 'skip' | 'update')}
                  >
                    <option value="skip">🛑 Abaikan (Skip duplikat jika No. HP sudah terdaftar)</option>
                    <option value="update">🔄 Perbarui (Update data customer jika No. HP sudah terdaftar)</option>
                  </select>
                </div>

                <div className="text-xs font-semibold text-gray-700">
                  <label className="block text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                    Kategori Default Customer
                  </label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-md bg-white text-xs font-bold text-gray-800 outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="General / Retail / Reseller"
                    value={defaultCategory}
                    onChange={e => setDefaultCategory(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-xs font-black uppercase text-gray-700 tracking-wider mb-3">
                  Pemetaan Kolom (Column Mapping)
                </h3>
                <p className="text-[10px] text-gray-400 font-medium mb-3">
                  Pilih target kolom untuk setiap header di file Anda. Pemetaan ini akan otomatis tersimpan untuk file berikutnya.
                </p>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold tracking-widest uppercase">
                        <th className="p-3">Kolom di File Anda</th>
                        <th className="p-3">Hubungkan ke Kolom Customer</th>
                        <th className="p-3">Contoh Baris Pertama</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                      {headers.map(header => {
                        const sampleVal = rawData[0] ? rawData[0][header] : '-';
                        const sampleString = sampleVal instanceof Date 
                          ? sampleVal.toLocaleDateString('id-ID')
                          : (sampleVal !== undefined && sampleVal !== null ? String(sampleVal) : '-');

                        return (
                          <tr key={header} className="hover:bg-gray-50/50">
                            <td className="p-3 font-bold text-gray-900">{header}</td>
                            <td className="p-3">
                              <select
                                className={`p-2 border rounded-md text-xs font-bold bg-white focus:outline-none w-72 ${
                                  mapping[header]
                                    ? 'border-blue-300 text-blue-800 bg-blue-50/20'
                                    : 'border-gray-300 text-gray-500'
                                }`}
                                value={mapping[header] || ''}
                                onChange={e => handleMapChange(header, e.target.value)}
                              >
                                <option value="">❌ Abaikan Kolom Ini</option>
                                {TARGET_FIELDS.map(f => (
                                  <option key={f.key} value={f.key}>
                                    {f.required ? '★ ' : ''}{f.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-3 text-gray-500 italic max-w-xs truncate" title={sampleString}>
                              {sampleString}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & VALIDATION */}
          {step === 'preview' && (
            <div className="space-y-6">
              
              {/* Summary Stats Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Total Baris</div>
                  <div className="text-2xl font-black text-blue-800 mt-1">{stats.total}</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Siap Diimpor (Valid)</div>
                  <div className="text-2xl font-black text-emerald-800 mt-1">{stats.valid}</div>
                </div>
                <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Ada Masalah (Error)</div>
                  <div className="text-2xl font-black text-rose-800 mt-1">{stats.errors}</div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-black uppercase text-gray-700 tracking-wider mb-3">
                  Preview Hasil Validasi (Menampilkan 10 Baris Pertama)
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-bold tracking-widest uppercase">
                          <th className="p-3 w-12 text-center">No</th>
                          <th className="p-3 w-28">Status</th>
                          <th className="p-3">Nama & Phone</th>
                          <th className="p-3">Email & Kategori</th>
                          <th className="p-3">Alamat / Kota</th>
                          <th className="p-3">Metadata</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs font-semibold text-gray-700">
                        {parsedData.slice(0, 10).map((row, idx) => (
                          <tr key={idx} className={`hover:bg-gray-50/30 ${!row._valid ? 'bg-red-50/20' : ''}`}>
                            <td className="p-3 text-center text-gray-400 font-bold">{row._index}</td>
                            <td className="p-3">
                              {row._valid ? (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 uppercase">
                                  ✓ Valid
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 uppercase">
                                    ✗ Error
                                  </span>
                                  {row._errors.map((err: string, eIdx: number) => (
                                    <div key={eIdx} className="text-[8px] text-rose-600 font-black tracking-tight leading-none uppercase">
                                      ⚠️ {err}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {row._warnings.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {row._warnings.map((warn: string, wIdx: number) => (
                                    <div key={wIdx} className="text-[8px] text-amber-600 font-semibold leading-none">
                                      🛈 {warn}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="p-3 space-y-0.5">
                              <div className={row._valid ? 'text-gray-900 font-bold' : 'text-rose-700 font-bold'}>
                                {row.name}
                              </div>
                              <div className="text-[10px] text-gray-500 font-mono">
                                📞 {row.phone}
                              </div>
                            </td>
                            <td className="p-3 space-y-0.5">
                              <div className="text-[11px] text-gray-700 font-medium">
                                {row.email || '-'}
                              </div>
                              <span className="inline-flex text-[9px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 uppercase">
                                {row.category}
                              </span>
                            </td>
                            <td className="p-3 text-[11px] text-gray-600">
                              {row.address_data ? (
                                <div>
                                  {row.address_data.address_line1 && <div>{row.address_data.address_line1}</div>}
                                  <div className="text-[9px] text-gray-400">
                                    {[row.address_data.subdistrict, row.address_data.city, row.address_data.state].filter(Boolean).join(', ')}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-400 italic">-</span>
                              )}
                            </td>
                            <td className="p-3 text-[10px] text-gray-500 space-y-0.5">
                              {row.metadata?.company && <div>🏢 {row.metadata.company}</div>}
                              {row.metadata?.instagram && <div>📸 @{row.metadata.instagram}</div>}
                              {row.metadata?.tags && row.metadata.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {row.metadata.tags.map((t: string) => (
                                    <span key={t} className="bg-gray-100 text-gray-600 px-1 py-0.2 text-[8px] font-bold rounded">
                                      #{t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: IMPORTING */}
          {step === 'importing' && (
            <div className="py-16 text-center space-y-4">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <h3 className="text-sm font-extrabold text-gray-800 uppercase tracking-wider">
                Mengimpor Data Customer...
              </h3>
              <p className="text-xs text-gray-400 font-medium">
                Mohon tunggu sejenak, sistem sedang menyimpan data ke database.
              </p>
            </div>
          )}

          {/* STEP 5: RESULT */}
          {step === 'result' && (
            <div className="space-y-6 py-6">
              {errorMessage ? (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center space-y-3">
                  <div className="text-4xl">⚠️</div>
                  <h3 className="text-sm font-extrabold text-rose-800 uppercase tracking-wider">
                    Gagal Mengimpor Data
                  </h3>
                  <p className="text-xs text-rose-600 max-w-md mx-auto font-medium">
                    {errorMessage}
                  </p>
                </div>
              ) : successResult && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center space-y-4">
                  <div className="text-5xl">🎉</div>
                  <h3 className="text-base font-black text-emerald-900 uppercase tracking-wider">
                    Impor Data Customer Selesai!
                  </h3>
                  <p className="text-xs text-emerald-700 font-semibold max-w-md mx-auto">
                    {successResult.message}
                  </p>

                  <div className="grid grid-cols-3 gap-3 max-w-md mx-auto pt-2">
                    <div className="bg-white/80 p-3 rounded-lg border border-emerald-100">
                      <div className="text-[9px] font-bold text-gray-500 uppercase">Ditambahkan</div>
                      <div className="text-xl font-black text-emerald-700">{successResult.insertedCount}</div>
                    </div>
                    <div className="bg-white/80 p-3 rounded-lg border border-emerald-100">
                      <div className="text-[9px] font-bold text-gray-500 uppercase">Diperbarui</div>
                      <div className="text-xl font-black text-blue-700">{successResult.updatedCount}</div>
                    </div>
                    <div className="bg-white/80 p-3 rounded-lg border border-emerald-100">
                      <div className="text-[9px] font-bold text-gray-500 uppercase">Diabaikan</div>
                      <div className="text-xl font-black text-gray-500">{successResult.skippedCount}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Bar Action Buttons */}
        <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between items-center">
          {step === 'upload' && (
            <Link
              href="/customers"
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 uppercase tracking-wider"
            >
              Batal
            </Link>
          )}

          {step === 'mapping' && (
            <>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 shadow-xs"
              >
                ⬅ Kembali (Ganti File)
              </button>

              <button
                type="button"
                onClick={() => {
                  const hasName = Object.values(mapping).includes('name')
                  const hasPhone = Object.values(mapping).includes('phone')
                  if (!hasName || !hasPhone) {
                    alert('Kolom "Nama Customer" dan "Nomor HP / WhatsApp" wajib dihubungkan ke kolom file Anda!')
                    return
                  }
                  setStep('preview')
                }}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-extrabold hover:bg-blue-700 shadow-xs"
              >
                Lanjut Ke Preview ➔
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setStep('mapping')}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 shadow-xs"
              >
                ⬅ Edit Pemetaan Kolom
              </button>

              <button
                type="button"
                onClick={handleImportSubmit}
                disabled={stats.valid === 0 || importLoading}
                className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-wider text-white shadow-xs transition-all ${
                  stats.valid > 0 && !importLoading
                    ? 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer'
                    : 'bg-gray-300 cursor-not-allowed'
                }`}
              >
                🚀 Mulai Impor ({stats.valid} Data)
              </button>
            </>
          )}

          {step === 'result' && (
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  setHeaders([])
                  setRawData([])
                  setStep('upload')
                }}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                📁 Import File Lain
              </button>

              <Link
                href="/customers"
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-extrabold hover:bg-blue-700"
              >
                Lihat Data Customer ➔
              </Link>
            </div>
          )}
        </div>

      </div>

    </div>
  )
}
