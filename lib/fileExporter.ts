import * as XLSX from 'xlsx'

export type ExportFileFormat = 'xlsx' | 'csv'

export interface ExportSheetConfig {
  sheetName: string
  rows: Record<string, any>[]
  columnWidths?: { wch: number }[]
}

export interface UniversalDownloadOptions {
  /** Book type ('xlsx' or 'csv'). Inferred from fileName if omitted. */
  bookType?: ExportFileFormat
  /** Force server-side HTTP attachment relay even on desktop */
  forceServerRelay?: boolean
  /** Auto-calculate responsive column widths for all sheets if not already set */
  autoWidth?: boolean
}

const MIME_TYPES: Record<ExportFileFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
}

/**
 * Checks if running inside the custom ShapeUp Android APK (`window.AndroidPrinter` bridge injected).
 */
export function isShapeUpAndroidApk(): boolean {
  if (typeof window === 'undefined') return false
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  return Boolean((window as any).AndroidPrinter) || /ShapeUpNativeApp/i.test(ua)
}

/**
 * Checks if the ShapeUp Android APK has the v1.2+ native file download bridge (`AndroidPrinter.downloadBase64File`).
 */
export function hasNativeApkFileBridge(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as any).AndroidPrinter?.downloadBase64File === 'function'
}

/**
 * Checks if the user is on the legacy ShapeUp Android APK (v1.0/v1.1) where `AndroidPrinter` exists
 * but `downloadBase64File` and `setDownloadListener` were not yet compiled into the APK binary.
 */
export function isLegacyShapeUpApk(): boolean {
  return isShapeUpAndroidApk() && !hasNativeApkFileBridge()
}

/**
 * Detects whether the current runtime is an Android APK WebView, installed Standalone PWA,
 * or Mobile Touch Device where synthetic `blob:` anchor downloads frequently fail or get blocked.
 */
export function isApkOrMobilePwaEnvironment(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false

  if (isShapeUpAndroidApk()) return true

  const ua = navigator.userAgent || ''

  // 1. Android WebView / APK Wrapper detection (`wv` token or `Version/X.X` without standard Chrome browser token)
  const isAndroidWebView =
    /Android/i.test(ua) &&
    (/; wv\)/i.test(ua) || /Version\/\d+\.\d+/i.test(ua) || /WebView/i.test(ua))

  // 2. iOS WebView / Wrapper detection
  const isIosWebView = /(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(ua)

  // 3. Standalone PWA display mode (WebAPK / Add to Home Screen)
  const isStandalonePwa =
    (typeof window.matchMedia === 'function' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches)) ||
    (navigator as any).standalone === true ||
    document.referrer.includes('android-app://')

  // 4. General Android / iOS mobile browser (where real HTTP attachment headers provide much more reliable DownloadManager notifications than blob:)
  const isMobileOs = /Android|iPhone|iPad|iPod/i.test(ua)

  return isAndroidWebView || isIosWebView || isStandalonePwa || isMobileOs
}

/**
 * Checks whether the current device supports sharing physical files via the native OS Share Sheet
 * or Native APK `shareBase64File` bridge.
 */
export function canUseNativeFileShare(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (typeof (window as any).AndroidPrinter?.shareBase64File === 'function') return true
  if (typeof navigator.share !== 'function') return false
  if (typeof navigator.canShare === 'function') {
    try {
      const testFile = new File(['test'], 'test.csv', { type: 'text/csv' })
      if (navigator.canShare({ files: [testFile] })) return true
    } catch {}
  }
  // Even if file sharing isn't supported, URL sharing in legacy APK WebView may be supported
  return isLegacyShapeUpApk()
}

/**
 * Normalizes file name and ensures it ends with the proper extension (`.xlsx` or `.csv`).
 */
export function normalizeExportFileName(fileName: string, format?: ExportFileFormat): {
  finalName: string
  resolvedFormat: ExportFileFormat
} {
  const trimmed = (fileName || 'Laporan_ShapeUp').trim()
  const lower = trimmed.toLowerCase()

  let resolvedFormat: ExportFileFormat = format || 'xlsx'
  if (!format) {
    if (lower.endsWith('.csv')) resolvedFormat = 'csv'
    else resolvedFormat = 'xlsx'
  }

  const baseName = trimmed.replace(/\.(xlsx|csv|xls)$/i, '')
  const safeBase = baseName.replace(/[^a-zA-Z0-9._\- ()]/g, '_').replace(/_{2,}/g, '_') || 'Laporan_ShapeUp'

  return {
    finalName: `${safeBase}.${resolvedFormat}`,
    resolvedFormat,
  }
}

/**
 * Calculates responsive column widths for an array of JSON objects so exported Excel files are immediately readable.
 */
export function calculateAutoColumnWidths(rows: Record<string, any>[]): { wch: number }[] {
  if (!rows || rows.length === 0) return []
  const keys = Object.keys(rows[0])
  const sampleSize = Math.min(rows.length, 300)

  return keys.map(key => {
    let maxLen = key.length
    for (let i = 0; i < sampleSize; i++) {
      const val = rows[i]?.[key]
      if (val === null || val === undefined) continue
      const str = String(val)
      if (str.includes('\n')) {
        for (const line of str.split('\n')) {
          if (line.length > maxLen) maxLen = line.length
        }
      } else if (str.length > maxLen) {
        maxLen = str.length
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, 10), 55) }
  })
}

/**
 * Converts a Uint8Array / ArrayBuffer to a Base64 string safely without call stack overflow.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000 // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, Array.from(sub))
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64')
}

/**
 * Renders a floating 1-click legacy APK download helper banner when running inside
 * the un-updated ShapeUp APK v1.0/v1.1 (which lacked `setDownloadListener` and `downloadBase64File`)
 * AND if `navigator.share` was not handled by the OS WebView.
 */
function showLegacyApkDownloadHelper(fullDownloadUrl: string, fileName: string, bytes: Uint8Array, mimeType: string) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  // Automatically copy the direct download link to clipboard immediately
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(fullDownloadUrl).catch(() => {})
  }

  const existing = document.getElementById('su-legacy-apk-dl-banner')
  if (existing) {
    try {
      existing.remove()
    } catch {}
  }

  const overlay = document.createElement('div')
  overlay.id = 'su-legacy-apk-dl-banner'
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif;'

  const card = document.createElement('div')
  card.style.cssText =
    'background:#ffffff;border-radius:16px;max-width:420px;width:100%;padding:20px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.25);border:1px solid #e2e2dc;color:#1c1c1a;'

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <div style="width:38px;height:38px;border-radius:10px;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;border:1px solid #a7f3d0;flex-shrink:0;">📥</div>
      <div>
        <div style="font-weight:800;font-size:15px;line-height:1.2;">Berkas Siap Diunduh</div>
        <div style="font-size:11px;color:#6b6b63;margin-top:2px;word-break:break-all;">${fileName}</div>
      </div>
    </div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:10px 12px;border-radius:10px;font-size:12px;margin-bottom:14px;line-height:1.4;">
      ✅ <strong>Tautan unduhan telah otomatis disalin!</strong><br/>
      Pilih aksi di bawah untuk menyimpan atau membagikan berkas:
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button id="su-legacy-btn-share" type="button" style="width:100%;padding:11px 14px;border-radius:10px;background:#059669;color:#ffffff;font-weight:700;font-size:12px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
        <span>📲</span> <span>Bagikan / Simpan Berkas (WhatsApp / Drive / Chrome)</span>
      </button>
      <button id="su-legacy-btn-copy" type="button" style="width:100%;padding:10px 14px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-weight:700;font-size:12px;border:1px solid #bfdbfe;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
        <span>📋</span> <span id="su-legacy-copy-label">Salin Ulang Tautan Unduhan (Buka di Chrome / WA)</span>
      </button>
      <button id="su-legacy-btn-close" type="button" style="width:100%;padding:9px 14px;border-radius:10px;background:#f7f7f5;color:#4a4a45;font-weight:700;font-size:12px;border:1px solid #e2e2dc;cursor:pointer;margin-top:4px;">
        Tutup
      </button>
    </div>
  `

  overlay.appendChild(card)
  document.body.appendChild(overlay)

  const btnShare = card.querySelector('#su-legacy-btn-share') as HTMLButtonElement | null
  const btnCopy = card.querySelector('#su-legacy-btn-copy') as HTMLButtonElement | null
  const copyLabel = card.querySelector('#su-legacy-copy-label') as HTMLElement | null
  const btnClose = card.querySelector('#su-legacy-btn-close') as HTMLButtonElement | null

  if (btnShare) {
    btnShare.onclick = async () => {
      try {
        if (typeof navigator.share === 'function') {
          const file = new File([bytes as unknown as BlobPart], fileName, { type: mimeType })
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: fileName, text: `Unduh ${fileName}: ${fullDownloadUrl}` })
            overlay.remove()
            return
          }
          await navigator.share({ title: fileName, text: `Unduh berkas ${fileName}:`, url: fullDownloadUrl })
          overlay.remove()
          return
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
      }
      // Fallback: open WhatsApp share or copy URL
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(fullDownloadUrl).catch(() => {})
      }
      if (copyLabel) copyLabel.textContent = '✓ Tautan Tersalin! Tempel di Chrome atau WhatsApp'
    }
  }

  if (btnCopy) {
    btnCopy.onclick = async () => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(fullDownloadUrl)
        } else {
          const ta = document.createElement('textarea')
          ta.value = fullDownloadUrl
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        if (copyLabel) copyLabel.textContent = '✓ Berhasil Disalin ke Clipboard!'
      } catch {}
    }
  }

  if (btnClose) {
    btnClose.onclick = () => overlay.remove()
  }
  overlay.onclick = e => {
    if (e.target === overlay) overlay.remove()
  }
}

/**
 * Triggers a download across Native APK Bridge (v1.2+), Legacy APK Auto-Share/Ticket Relay (v1.0/v1.1),
 * or Standard Mobile PWA Two-Phase HTTP GET Relay (`/api/export/download?ticket=...`).
 */
function triggerServerRelayDownload(
  base64Payload: string,
  fileName: string,
  mimeType: string,
  rawBytes: Uint8Array
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  // 1. FASTEST PATH: Native Android APK Bridge (v1.2+) -> Direct write to Android Downloads folder!
  const androidBridge = (window as any).AndroidPrinter
  if (typeof androidBridge?.downloadBase64File === 'function') {
    try {
      androidBridge.downloadBase64File(base64Payload, fileName, mimeType)
      return
    } catch (e) {
      console.warn('[fileExporter] Native downloadBase64File failed, falling back to HTTP relay:', e)
    }
  }

  // 2. LEGACY APK PATH (v1.0/v1.1 without native download listener):
  // Immediately attempt 1-click Chromium Web Share API with the physical File object while still inside user gesture!
  const isLegacyApk = isLegacyShapeUpApk()
  if (isLegacyApk && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([rawBytes as unknown as BlobPart], fileName, { type: mimeType })
      if (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })) {
        navigator
          .share({
            files: [file],
            title: fileName,
            text: `Berkas ${fileName}`,
          })
          .catch((err: any) => {
            if (err?.name !== 'AbortError') {
              prepareTicketAndHandleLegacyApk(base64Payload, fileName, mimeType, rawBytes)
            }
          })
        return
      }
    } catch {}
  }

  if (isLegacyApk) {
    prepareTicketAndHandleLegacyApk(base64Payload, fileName, mimeType, rawBytes)
    return
  }

  // 3. STANDARD MOBILE PWA / MOBILE BROWSER / UPDATED WEBVIEW PATH:
  // Two-Phase POST (prepare ticket) -> HTTP GET download (`Content-Disposition: attachment`)
  const fallbackFormPost = () => {
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = '/api/export/download'
    form.style.display = 'none'

    const addField = (name: string, value: string) => {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.appendChild(input)
    }

    addField('payload', base64Payload)
    addField('fileName', fileName)
    addField('mimeType', mimeType)

    document.body.appendChild(form)
    form.submit()

    setTimeout(() => {
      try {
        document.body.removeChild(form)
      } catch {}
    }, 3000)
  }

  fetch('/api/export/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'prepare',
      payload: base64Payload,
      fileName,
      mimeType,
    }),
  })
    .then(res => res.json())
    .then(json => {
      if (json?.success && json?.downloadUrl) {
        const a = document.createElement('a')
        a.href = json.downloadUrl
        a.download = fileName
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          try {
            document.body.removeChild(a)
          } catch {}
        }, 5000)
      } else {
        fallbackFormPost()
      }
    })
    .catch(() => {
      fallbackFormPost()
    })
}

function prepareTicketAndHandleLegacyApk(
  base64Payload: string,
  fileName: string,
  mimeType: string,
  rawBytes: Uint8Array
) {
  fetch('/api/export/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'prepare',
      payload: base64Payload,
      fileName,
      mimeType,
    }),
  })
    .then(res => res.json())
    .then(async json => {
      const relUrl = json?.downloadUrl || '/api/export/download'
      const fullUrl = relUrl.startsWith('http') ? relUrl : `${window.location.origin}${relUrl}`

      // Try URL share sheet first
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: fileName,
            text: `Unduh berkas ${fileName}:`,
            url: fullUrl,
          })
          return
        } catch (err: any) {
          if (err?.name === 'AbortError') return
        }
      }

      // Show 1-click legacy APK download helper modal with auto-copied link
      showLegacyApkDownloadHelper(fullUrl, fileName, rawBytes, mimeType)
    })
    .catch(() => {
      showLegacyApkDownloadHelper(window.location.href, fileName, rawBytes, mimeType)
    })
}

/**
 * Triggers a standard browser Blob download on desktop with proper MIME types.
 */
function triggerDesktopBlobDownload(bytes: Uint8Array, fileName: string, mimeType: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()

  setTimeout(() => {
    try {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {}
  }, 15_000)
}

/**
 * Generates binary Uint8Array content from an XLSX Workbook.
 */
export function workbookToBytes(
  workbook: XLSX.WorkBook,
  format: ExportFileFormat = 'xlsx'
): Uint8Array {
  if (format === 'csv') {
    const firstSheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[firstSheetName]
    const csvContent = worksheet ? XLSX.utils.sheet_to_csv(worksheet) : ''
    // Prepend UTF-8 BOM (\uFEFF) so Microsoft Excel on mobile & desktop opens UTF-8 characters & columns cleanly
    const bomCsv = '\uFEFF' + csvContent
    return new TextEncoder().encode(bomCsv)
  }

  const arrayBuf: ArrayBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  })
  return new Uint8Array(arrayBuf)
}

/**
 * Universal drop-in replacement for `XLSX.writeFile(workbook, fileName, options)`.
 * Works seamlessly across:
 * - Native ShapeUp Android APK (`AndroidPrinter.downloadBase64File` + `DownloadManager`)
 * - Legacy ShapeUp Android APK (Auto-Share Sheet + 1-Click Link Helper)
 * - Standalone Mobile PWAs (Android & iOS)
 * - Desktop Browsers (Instant 0ms Blob download with official MIME types)
 */
export function downloadWorkbook(
  workbook: XLSX.WorkBook,
  fileName: string,
  options?: UniversalDownloadOptions
): void {
  const { finalName, resolvedFormat } = normalizeExportFileName(fileName, options?.bookType)
  const mimeType = MIME_TYPES[resolvedFormat]

  // Apply auto-column width if requested and not already configured on sheets
  if (options?.autoWidth !== false && resolvedFormat === 'xlsx') {
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName]
      if (ws && !ws['!cols'] && ws['!ref']) {
        try {
          const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws)
          if (rows.length > 0) {
            ws['!cols'] = calculateAutoColumnWidths(rows)
          }
        } catch {}
      }
    }
  }

  const bytes = workbookToBytes(workbook, resolvedFormat)
  const useServerRelay = options?.forceServerRelay || isApkOrMobilePwaEnvironment()

  if (useServerRelay) {
    const base64 = uint8ArrayToBase64(bytes)
    triggerServerRelayDownload(base64, finalName, mimeType, bytes)
  } else {
    triggerDesktopBlobDownload(bytes, finalName, mimeType)
  }
}

/**
 * Universal raw CSV downloader (drop-in replacement for custom `downloadCsv(filename, headers, rows)`).
 * Includes UTF-8 BOM and automatic APK/PWA server relay support.
 */
export function downloadCsvFile(
  fileName: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  options?: UniversalDownloadOptions
): void {
  const { finalName } = normalizeExportFileName(fileName, 'csv')
  const mimeType = MIME_TYPES.csv

  const escapeCell = (cell: string | number | null | undefined) => {
    const str = String(cell ?? '')
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str
  }

  const csvBody = [
    headers.map(escapeCell).join(','),
    ...rows.map(r => r.map(escapeCell).join(',')),
  ].join('\n')

  const bytes = new TextEncoder().encode('\uFEFF' + csvBody)
  const useServerRelay = options?.forceServerRelay || isApkOrMobilePwaEnvironment()

  if (useServerRelay) {
    const base64 = uint8ArrayToBase64(bytes)
    triggerServerRelayDownload(base64, finalName, mimeType, bytes)
  } else {
    triggerDesktopBlobDownload(bytes, finalName, mimeType)
  }
}

/**
 * High-level helper: builds an XLSX/CSV workbook from one or more JSON row arrays and downloads it immediately.
 */
export function exportJsonToFile({
  sheets,
  fileName,
  format = 'xlsx',
  forceServerRelay,
}: {
  sheets: ExportSheetConfig[]
  fileName: string
  format?: ExportFileFormat
  forceServerRelay?: boolean
}): void {
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const safeRows = sheet.rows && sheet.rows.length > 0 ? sheet.rows : [{ Info: 'Tidak ada data' }]
    const ws = XLSX.utils.json_to_sheet(safeRows)
    ws['!cols'] = sheet.columnWidths || calculateAutoColumnWidths(safeRows)
    // Excel sheet names max 31 chars and cannot contain : \ / ? * [ ]
    const cleanSheetName = (sheet.sheetName || 'Sheet1').replace(/[:\\/?*\[\]]/g, ' ').trim().slice(0, 31) || 'Sheet1'
    XLSX.utils.book_append_sheet(wb, ws, cleanSheetName)
    // CSV only supports a single sheet
    if (format === 'csv') break
  }

  downloadWorkbook(wb, fileName, {
    bookType: format,
    forceServerRelay,
    autoWidth: false, // already applied above
  })
}

/**
 * Invokes the native OS Share Sheet (`AndroidPrinter.shareBase64File` or `navigator.share`) on Mobile / PWA / APK
 * so users can directly send the generated Excel/CSV file to WhatsApp, Email, Telegram, or Save to Files.
 * Falls back to `downloadWorkbook` if Web Share API is not supported or cancelled.
 */
export async function shareOrDownloadWorkbook(
  workbook: XLSX.WorkBook,
  fileName: string,
  options?: UniversalDownloadOptions & { title?: string; text?: string }
): Promise<{ shared: boolean }> {
  const { finalName, resolvedFormat } = normalizeExportFileName(fileName, options?.bookType)
  const mimeType = MIME_TYPES[resolvedFormat]

  if (options?.autoWidth !== false && resolvedFormat === 'xlsx') {
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName]
      if (ws && !ws['!cols'] && ws['!ref']) {
        try {
          const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws)
          if (rows.length > 0) ws['!cols'] = calculateAutoColumnWidths(rows)
        } catch {}
      }
    }
  }

  const bytes = workbookToBytes(workbook, resolvedFormat)

  // 1. Native Android APK Share Bridge (v1.2+)
  const androidBridge = typeof window !== 'undefined' ? (window as any).AndroidPrinter : null
  if (typeof androidBridge?.shareBase64File === 'function') {
    try {
      const base64 = uint8ArrayToBase64(bytes)
      androidBridge.shareBase64File(base64, finalName, mimeType)
      return { shared: true }
    } catch (e) {
      console.warn('[fileExporter] Native shareBase64File failed, falling back to navigator.share:', e)
    }
  }

  // 2. Standard Web Share API (`navigator.share`)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([bytes as unknown as BlobPart], finalName, { type: mimeType })
      if (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: options?.title || finalName,
          text: options?.text || `Berkas laporan ${finalName}`,
        })
        return { shared: true }
      }
    } catch (err: any) {
      // If user explicitly dismissed the share dialog, don't force download
      if (err?.name === 'AbortError') {
        return { shared: false }
      }
    }
  }

  // Fallback to universal download
  downloadWorkbook(workbook, finalName, options)
  return { shared: false }
}
