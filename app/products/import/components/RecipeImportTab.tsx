"use client"

import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'

interface RecipeImportTabProps {
  activeBizId: string | null
}

const RECIPE_TARGET_FIELDS = [
  {
    key: 'product_ref',
    name: 'Produk Jadi (SKU / Nama)',
    required: true,
    desc: 'Kode SKU atau Nama persis Produk Jadi yang sudah ada di database'
  },
  {
    key: 'ingredient_ref',
    name: 'Bahan Baku / Material (SKU / Nama)',
    required: true,
    desc: 'Kode SKU atau Nama persis Bahan Baku yang sudah ada di database'
  },
  {
    key: 'quantity',
    name: 'Jumlah Takaran (Qty)',
    required: true,
    desc: 'Takaran bahan baku per 1 unit produk jadi (mendukung desimal, misal 18 atau 0.25)'
  },
  {
    key: 'notes',
    name: 'Catatan (Opsional)',
    required: false,
    desc: 'Catatan tambahan komposisi resep'
  }
]

const detectRecipeFieldByHeader = (header: string): string => {
  const h = String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (
    h.includes('bahan') ||
    h.includes('ingredient') ||
    h.includes('material') ||
    h.includes('komponen')
  ) {
    return 'ingredient_ref'
  }
  if (
    h.includes('produk') ||
    h.includes('product') ||
    h.includes('menu') ||
    h.includes('item') ||
    h === 'sku'
  ) {
    return 'product_ref'
  }
  if (
    h.includes('qty') ||
    h.includes('jumlah') ||
    h.includes('takaran') ||
    h.includes('quantity') ||
    h.includes('dosis')
  ) {
    return 'quantity'
  }
  if (h.includes('catatan') || h.includes('notes') || h.includes('keterangan')) {
    return 'notes'
  }
  return ''
}

const parseRecipeNumeric = (val: any): number => {
  if (val === undefined || val === null) return 0
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  const str = String(val).trim().replace(',', '.')
  if (!str) return 0
  const cleanStr = str.replace(/[^0-9.-]/g, '')
  const num = parseFloat(cleanStr)
  return isNaN(num) ? 0 : num
}

export default function RecipeImportTab({ activeBizId }: RecipeImportTabProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'result'>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rawData, setRawData] = useState<any[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [errorMessage, setErrorMessage] = useState('')
  const [resultSummary, setResultSummary] = useState<{
    upsertedCount: number
    affectedProductsCount: number
    failedItems: Array<{
      rowNumber: number
      product_ref: string
      ingredient_ref: string
      quantity: number
      reason: string
    }>
  } | null>(null)

  const handleDownloadTemplate = () => {
    const sampleRows = [
      {
        'Produk (SKU / Nama)': 'KOPI-SUSU-01',
        'Bahan Baku (SKU / Nama)': 'BAHAN-KOPI-GR',
        'Jumlah (Qty)': 18,
        Catatan: 'Espresso 18 gram'
      },
      {
        'Produk (SKU / Nama)': 'KOPI-SUSU-01',
        'Bahan Baku (SKU / Nama)': 'Susu UHT Full Cream',
        'Jumlah (Qty)': 150,
        Catatan: '150 ml susu cair'
      },
      {
        'Produk (SKU / Nama)': 'KOPI-SUSU-01',
        'Bahan Baku (SKU / Nama)': 'Gula Aren Cair',
        'Jumlah (Qty)': 25,
        Catatan: '25 ml gula aren'
      }
    ]
    const ws = XLSX.utils.json_to_sheet(sampleRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Resep_BOM')
    XLSX.writeFile(wb, 'Template_Import_Resep_ShapeUp.xlsx')
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setErrorMessage('')

    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[]

        if (!jsonData || jsonData.length === 0) {
          setErrorMessage('File kosong atau format tidak terbaca.')
          return
        }

        const detectedHeaders = Object.keys(jsonData[0])
        setHeaders(detectedHeaders)
        setRawData(jsonData)

        const autoMap: Record<string, string> = {}
        const usedTargets = new Set<string>()
        detectedHeaders.forEach(h => {
          const detected = detectRecipeFieldByHeader(h)
          if (detected && !usedTargets.has(detected)) {
            autoMap[h] = detected
            usedTargets.add(detected)
          } else {
            autoMap[h] = ''
          }
        })
        setMapping(autoMap)
        setStep('mapping')
      } catch (err: any) {
        setErrorMessage('Gagal membaca file: ' + (err.message || 'Format tidak valid'))
      }
    }
    reader.readAsBinaryString(file)
  }

  const mappedRows = useMemo(() => {
    return rawData.map((row, idx) => {
      let rawProd = ''
      let rawIng = ''
      let rawQty: any = 0
      let rawNotes = ''

      headers.forEach(h => {
        const target = mapping[h]
        if (target === 'product_ref') rawProd = String(row[h] ?? '').trim()
        if (target === 'ingredient_ref') rawIng = String(row[h] ?? '').trim()
        if (target === 'quantity') rawQty = row[h]
        if (target === 'notes') rawNotes = String(row[h] ?? '').trim()
      })

      const quantity = Math.round(parseRecipeNumeric(rawQty) * 10000) / 10000
      const errors: string[] = []
      if (!rawProd) errors.push('Produk wajib diisi')
      if (!rawIng) errors.push('Bahan baku wajib diisi')
      if (!(quantity > 0)) errors.push('Jumlah harus > 0')

      return {
        _rowNumber: idx + 2,
        product_ref: rawProd,
        ingredient_ref: rawIng,
        quantity,
        notes: rawNotes || null,
        _errors: errors
      }
    })
  }, [rawData, headers, mapping])

  const validRows = useMemo(() => mappedRows.filter(r => r._errors.length === 0), [mappedRows])
  const invalidRows = useMemo(() => mappedRows.filter(r => r._errors.length > 0), [mappedRows])

  const hasRequiredMappings = useMemo(() => {
    const vals = new Set(Object.values(mapping).filter(Boolean))
    return vals.has('product_ref') && vals.has('ingredient_ref') && vals.has('quantity')
  }, [mapping])

  const handleImport = async () => {
    if (validRows.length === 0) return
    setStep('importing')
    setErrorMessage('')

    try {
      const response = await fetch('/api/products/bulk/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: activeBizId,
          mode,
          recipes: validRows.map(r => ({
            _rowNumber: r._rowNumber,
            product_ref: r.product_ref,
            ingredient_ref: r.ingredient_ref,
            quantity: r.quantity,
            notes: r.notes
          }))
        })
      })

      const data = await response.json()
      const clientFailures = invalidRows.map(r => ({
        rowNumber: r._rowNumber,
        product_ref: r.product_ref,
        ingredient_ref: r.ingredient_ref,
        quantity: r.quantity,
        reason: r._errors.join('; ')
      }))

      const allFailed = [...clientFailures, ...(Array.isArray(data.failedItems) ? data.failedItems : [])]

      if (!response.ok && allFailed.length === 0) {
        setErrorMessage(data.error || 'Gagal mengimpor resep.')
        setStep('result')
        return
      }

      setResultSummary({
        upsertedCount: data.upsertedCount || 0,
        affectedProductsCount: data.affectedProductsCount || 0,
        failedItems: allFailed
      })
      setStep('result')
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan jaringan saat mengimpor resep.')
      setStep('result')
    }
  }

  const handleDownloadFailed = () => {
    if (!resultSummary || resultSummary.failedItems.length === 0) return
    const exportRows = resultSummary.failedItems.map(f => ({
      'Baris Excel': f.rowNumber,
      'Produk (SKU / Nama)': f.product_ref,
      'Bahan Baku (SKU / Nama)': f.ingredient_ref,
      'Jumlah (Qty)': f.quantity,
      'Alasan Gagal': f.reason
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Resep_Gagal')
    XLSX.writeFile(wb, `Resep_Gagal_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const resetWizard = () => {
    setStep('upload')
    setFileName('')
    setHeaders([])
    setRawData([])
    setMapping({})
    setErrorMessage('')
    setResultSummary(null)
  }

  return (
    <div className="space-y-6">
      {step === 'upload' && (
        <div className="space-y-6">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center text-2xl shadow-inner">
              🧪
            </div>
            <h2 className="text-base font-extrabold text-gray-900 uppercase tracking-wide">
              Import / Update Resep & Bahan Baku (BOM)
            </h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              Hubungkan Produk Jadi dengan Bahan Baku yang sudah ada di sistem. Sistem otomatis mencocokkan berdasarkan{' '}
              <span className="font-semibold text-gray-700">SKU</span> terlebih dahulu, lalu{' '}
              <span className="font-semibold text-gray-700">Nama Produk</span> jika SKU kosong.
            </p>
          </div>

          <div className="max-w-xl mx-auto">
            <label className="border-2 border-dashed border-gray-300 hover:border-indigo-500 bg-gray-50/50 hover:bg-indigo-50/20 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all group">
              <div className="w-12 h-12 rounded-full bg-white shadow-xs border border-gray-200 flex items-center justify-center text-xl text-gray-600 group-hover:scale-110 transition-transform mb-3">
                📤
              </div>
              <span className="text-sm font-bold text-gray-800 group-hover:text-indigo-600">
                Klik untuk memilih file Resep (.xlsx / .csv)
              </span>
              <span className="text-[11px] text-gray-400 mt-1 font-medium">
                Pastikan Produk Jadi dan Bahan Baku sudah diimpor di Tab 1 terlebih dahulu
              </span>
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {errorMessage && (
            <div className="max-w-xl mx-auto bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs font-medium">
              {errorMessage}
            </div>
          )}

          <div className="max-w-xl mx-auto bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-gray-800">Butuh contoh format file Resep?</p>
              <p className="text-[11px] text-gray-500">
                Berisi 4 kolom sederhana: Produk, Bahan Baku, Jumlah, dan Catatan.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-3.5 py-2 bg-white border border-gray-300 hover:border-indigo-500 text-gray-800 rounded-lg text-xs font-bold shadow-2xs shrink-0"
            >
              ⬇️ Unduh Template Resep
            </button>
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-sm font-extrabold text-gray-900">Pemetaan Kolom Resep</h2>
              <p className="text-xs text-gray-500">
                File: <span className="font-semibold text-gray-700">{fileName}</span> ({rawData.length} baris)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">Mode Update:</label>
              <select
                value={mode}
                onChange={e => setMode(e.target.value as 'replace' | 'merge')}
                className="text-xs font-bold border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white text-gray-800"
              >
                <option value="replace">Timpa Resep Produk (Replace)</option>
                <option value="merge">Tambah / Perbarui Bahan (Merge)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {headers.map(h => (
              <div key={h} className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">{h}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    Contoh: {String(rawData[0]?.[h] ?? '-')}
                  </p>
                </div>
                <select
                  value={mapping[h] || ''}
                  onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                  className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white font-semibold text-gray-800 max-w-[200px]"
                >
                  <option value="">-- Abaikan Kolom --</option>
                  {RECIPE_TARGET_FIELDS.map(f => (
                    <option key={f.key} value={f.key}>
                      {f.name} {f.required ? '*' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={resetWizard}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900"
            >
              ← Ganti File
            </button>
            <button
              type="button"
              disabled={!hasRequiredMappings}
              onClick={() => setStep('preview')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-xs font-bold rounded-xl shadow-xs"
            >
              Lanjut Preview →
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
                ✓ {validRows.length} Baris Valid
              </span>
              {invalidRows.length > 0 && (
                <span className="px-3 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-bold">
                  ✕ {invalidRows.length} Baris Bermasalah (Akan Dilewati)
                </span>
              )}
            </div>
            <span className="text-xs font-semibold text-gray-600">
              Mode: {mode === 'replace' ? 'Timpa Resep Produk' : 'Tambah / Perbarui Bahan'}
            </span>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-[360px]">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-600 font-bold sticky top-0 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2.5">Baris</th>
                  <th className="px-3 py-2.5">Produk Jadi</th>
                  <th className="px-3 py-2.5">Bahan Baku</th>
                  <th className="px-3 py-2.5 text-right">Jumlah</th>
                  <th className="px-3 py-2.5">Catatan</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappedRows.slice(0, 100).map(r => (
                  <tr key={r._rowNumber} className={r._errors.length > 0 ? 'bg-rose-50/50' : ''}>
                    <td className="px-3 py-2 text-gray-400">{r._rowNumber}</td>
                    <td className="px-3 py-2 font-semibold text-gray-900">{r.product_ref || '-'}</td>
                    <td className="px-3 py-2 text-gray-800">{r.ingredient_ref || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.quantity}</td>
                    <td className="px-3 py-2 text-gray-500">{r.notes || '-'}</td>
                    <td className="px-3 py-2">
                      {r._errors.length === 0 ? (
                        <span className="text-emerald-600 font-bold">Siap</span>
                      ) : (
                        <span className="text-rose-600 font-semibold">{r._errors.join(', ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setStep('mapping')}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900"
            >
              ← Kembali ke Mapping
            </button>
            <button
              type="button"
              disabled={validRows.length === 0}
              onClick={handleImport}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-xs font-bold rounded-xl shadow-xs"
            >
              Simpan {validRows.length} Baris Resep
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="py-16 text-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-bold text-gray-800">Menyimpan komposisi resep secara atomik...</p>
          <p className="text-xs text-gray-500">Memvalidasi SKU/Nama bahan baku dan mencegah siklus resep.</p>
        </div>
      )}

      {step === 'result' && (
        <div className="space-y-5 max-w-xl mx-auto py-4">
          {errorMessage ? (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 text-center space-y-2">
              <p className="text-sm font-bold text-rose-700">Import Resep Gagal</p>
              <p className="text-xs text-rose-600">{errorMessage}</p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center space-y-2">
              <p className="text-base font-extrabold text-emerald-800">Import Resep Selesai</p>
              <p className="text-xs text-emerald-700">
                <span className="font-bold">{resultSummary?.upsertedCount || 0}</span> baris resep disimpan untuk{' '}
                <span className="font-bold">{resultSummary?.affectedProductsCount || 0}</span> produk (otomatis diset ke HPP Resep / Variable).
              </p>
            </div>
          )}

          {resultSummary && resultSummary.failedItems.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-amber-900">
                  ⚠️ {resultSummary.failedItems.length} Baris Gagal / Dilewati
                </p>
                <button
                  type="button"
                  onClick={handleDownloadFailed}
                  className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 rounded-lg text-xs font-bold hover:bg-amber-100"
                >
                  ⬇️ Unduh Baris Gagal (.xlsx)
                </button>
              </div>
              <ul className="text-[11px] text-amber-800 space-y-1 max-h-40 overflow-y-auto">
                {resultSummary.failedItems.slice(0, 10).map((f, idx) => (
                  <li key={idx}>
                    Baris {f.rowNumber} ({f.product_ref} → {f.ingredient_ref}): {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={resetWizard}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl"
            >
              Upload File Resep Lain
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

