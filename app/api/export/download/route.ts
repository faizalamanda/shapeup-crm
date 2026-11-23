import { NextResponse } from 'next/server'

const MIME_MAP: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  xls: 'application/vnd.ms-excel',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
}

interface CachedDownloadEntry {
  buffer: Buffer
  fileName: string
  mimeType: string
  expiresAt: number
}

// Short-lived in-memory ticket store (TTL 2 minutes) for two-phase POST -> GET download
// AND fallback DB/cookie-less stateless replay if needed.
const downloadTicketCache = new Map<string, CachedDownloadEntry>()
const TICKET_TTL_MS = 2 * 60 * 1000

function cleanupExpiredTickets() {
  const now = Date.now()
  for (const [key, entry] of downloadTicketCache.entries()) {
    if (entry.expiresAt <= now) {
      downloadTicketCache.delete(key)
    }
  }
}

function sanitizeFileName(rawName: string, defaultExt = 'xlsx'): { cleanName: string; ext: string } {
  const trimmed = (rawName || `Export_${new Date().toISOString().slice(0, 10)}.${defaultExt}`).trim()
  const lastDotIdx = trimmed.lastIndexOf('.')
  let base = trimmed
  let ext = defaultExt.toLowerCase()

  if (lastDotIdx > 0 && lastDotIdx < trimmed.length - 1) {
    base = trimmed.slice(0, lastDotIdx)
    ext = trimmed.slice(lastDotIdx + 1).toLowerCase()
  }

  if (!MIME_MAP[ext]) {
    ext = defaultExt.toLowerCase()
  }

  const safeBase = base.replace(/[^a-zA-Z0-9._\- ()]/g, '_').replace(/_{2,}/g, '_').slice(0, 120) || 'Export_Data'
  return {
    cleanName: `${safeBase}.${ext}`,
    ext,
  }
}

function buildBinaryDownloadResponse(fileBuffer: Buffer, cleanName: string, resolvedMime: string) {
  const encodedName = encodeURIComponent(cleanName)
  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': resolvedMime,
      'Content-Disposition': `attachment; filename="${cleanName}"; filename*=UTF-8''${encodedName}`,
      'Content-Length': String(fileBuffer.byteLength),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  })
}

/**
 * GET /api/export/download?ticket=... (or ?payload=...&fileName=...)
 *
 * CRITICAL FOR ANDROID APK WEBVIEW:
 * Android's native `DownloadManager.Request(Uri)` inside a WebView `DownloadListener` ONLY executes HTTP `GET` requests!
 * If a download is triggered by a `POST` form submission, WebView intercepts the response headers and hands the URL to
 * `DownloadManager`, which then makes a `GET` request to `/api/export/download`.
 *
 * Supporting `GET` via a prepared `ticket` (or query payload) guarantees 100% download success in:
 * - Android APK WebViews (`DownloadManager` GET handoff)
 * - Standalone Mobile PWAs (Android WebAPK & iOS Home Screen WebApp)
 * - Chrome Custom Tabs & In-App Browsers
 */
export async function GET(req: Request) {
  try {
    cleanupExpiredTickets()
    const url = new URL(req.url)
    const ticket = url.searchParams.get('ticket') || ''

    if (ticket && downloadTicketCache.has(ticket)) {
      const entry = downloadTicketCache.get(ticket)!
      // Keep ticket alive for 30s after first read in case Android WebView probes headers first and DownloadManager fetches second
      entry.expiresAt = Math.min(entry.expiresAt, Date.now() + 30_000)
      return buildBinaryDownloadResponse(entry.buffer, entry.fileName, entry.mimeType)
    }

    // Fallback: direct query payload for small files or stateless serverless edge instances
    const queryPayload = url.searchParams.get('payload') || ''
    const rawFileName = url.searchParams.get('fileName') || 'Export.xlsx'
    const explicitMime = url.searchParams.get('mimeType') || ''

    if (queryPayload) {
      const fileBuffer = Buffer.from(queryPayload, 'base64')
      const { cleanName, ext } = sanitizeFileName(rawFileName)
      const resolvedMime = explicitMime || MIME_MAP[ext] || 'application/octet-stream'
      return buildBinaryDownloadResponse(fileBuffer, cleanName, resolvedMime)
    }

    return NextResponse.json(
      { error: 'Tautan unduhan telah kedaluwarsa atau tidak ditemukan. Silakan ulangi klik tombol Export.' },
      { status: 404 }
    )
  } catch (err: any) {
    console.error('[GET /api/export/download] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Gagal mengunduh berkas.' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/export/download
 *
 * Mode 1 (`mode: 'prepare'` in JSON body):
 *   Stores the file buffer in a short-lived ticket cache and returns `{ success: true, ticket, downloadUrl }`
 *   so the client can trigger a pure HTTP `GET` download (`window.location.assign(downloadUrl)` or `<iframe/a>`).
 *
 * Mode 2 (Direct Form POST or JSON without `mode: 'prepare'`):
 *   Streams the binary attachment directly in the POST response.
 */
export async function POST(req: Request) {
  try {
    cleanupExpiredTickets()
    const contentType = req.headers.get('content-type') || ''
    let base64Payload = ''
    let rawFileName = ''
    let explicitMime = ''
    let mode = 'direct'

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => null)
      if (!body || typeof body.payload !== 'string') {
        return NextResponse.json({ error: 'Payload berkas tidak valid.' }, { status: 400 })
      }
      base64Payload = body.payload
      rawFileName = body.fileName || 'Export.xlsx'
      explicitMime = body.mimeType || ''
      mode = body.mode || 'direct'
    } else {
      const formData = await req.formData().catch(() => null)
      if (!formData) {
        return NextResponse.json({ error: 'Form data unduhan tidak valid.' }, { status: 400 })
      }
      base64Payload = String(formData.get('payload') || '')
      rawFileName = String(formData.get('fileName') || 'Export.xlsx')
      explicitMime = String(formData.get('mimeType') || '')
      mode = String(formData.get('mode') || 'direct')
    }

    if (!base64Payload) {
      return NextResponse.json({ error: 'Konten berkas kosong.' }, { status: 400 })
    }

    const commaIdx = base64Payload.indexOf(',')
    const pureBase64 = commaIdx !== -1 && base64Payload.startsWith('data:')
      ? base64Payload.slice(commaIdx + 1)
      : base64Payload

    const fileBuffer = Buffer.from(pureBase64, 'base64')
    const { cleanName, ext } = sanitizeFileName(rawFileName)
    const resolvedMime = explicitMime || MIME_MAP[ext] || 'application/octet-stream'

    if (mode === 'prepare') {
      const ticket = `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
      downloadTicketCache.set(ticket, {
        buffer: fileBuffer,
        fileName: cleanName,
        mimeType: resolvedMime,
        expiresAt: Date.now() + TICKET_TTL_MS,
      })

      // For small files (< 12KB base64), also embed stateless fallback parameter in case serverless lambdas route GET to another instance
      const downloadUrl =
        pureBase64.length <= 12_000
          ? `/api/export/download?ticket=${encodeURIComponent(ticket)}&fileName=${encodeURIComponent(cleanName)}&payload=${encodeURIComponent(pureBase64)}`
          : `/api/export/download?ticket=${encodeURIComponent(ticket)}&fileName=${encodeURIComponent(cleanName)}`

      return NextResponse.json({
        success: true,
        ticket,
        fileName: cleanName,
        downloadUrl,
      })
    }

    return buildBinaryDownloadResponse(fileBuffer, cleanName, resolvedMime)
  } catch (err: any) {
    console.error('[POST /api/export/download] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Gagal memproses unduhan berkas.' },
      { status: 500 }
    )
  }
}

