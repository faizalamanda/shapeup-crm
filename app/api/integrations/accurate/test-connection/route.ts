import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { renewAccurateWebhookForToken } from '@/lib/integrations/accurate/syncService'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const { access_token, db_id } = body || {}

    if (!access_token) {
      return NextResponse.json({ error: 'Access token wajib diisi.' }, { status: 400 })
    }

    const cleanToken = access_token.trim()
    const cleanDbId = db_id?.trim() || ''
    // Use the Signature Secret from .env
    const cleanSecret = process.env.ACCURATE_CLIENT_SECRET?.trim() || ''

    const accurateHost = 'https://account.accurate.id' 
    
    // --- 1. Try API Token Method ---
    if (cleanSecret) {
      // Try API Token Method
      const pad = (n: number) => n.toString().padStart(2, '0')
      // Ensure we get the time in Jakarta timezone (UTC+7) since Vercel runs in UTC
      const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}))
      const tsStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      
      const signature = crypto.createHmac('sha256', cleanSecret).update(tsStr).digest('base64')

      const tokenRes = await fetch(`${accurateHost}/api/api-token.do`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'X-Api-Timestamp': tsStr,
          'X-Api-Signature': signature
        }
      })

      const tokenData = await tokenRes.json()
      if (tokenRes.ok && tokenData.s) {
        const dbData = tokenData.d?.database || tokenData.d?.["data usaha"]
        const dbAlias = dbData?.alias || "Unknown"
        const dbIntegerId = dbData?.id // the 2871875 number

        // Automatically activate/renew Accurate webhook upon test/save
        const renewRes = await renewAccurateWebhookForToken(cleanToken, cleanSecret, cleanDbId)
        
        return NextResponse.json({ 
          success: true, 
          message: `Koneksi berhasil! (Metode API Token) Terhubung dengan database: ${dbAlias}`,
          db_integer_id: dbIntegerId,
          webhook_expiry: renewRes.expiryDate || null,
          last_webhook_renew_at: renewRes.success ? new Date().toISOString() : null
        })
      } else {
        return NextResponse.json({ error: `Koneksi API Token gagal: ${JSON.stringify(tokenData.d || tokenData)}` }, { status: 400 })
      }
    }

    // --- 2. Fallback to OAuth Method ---
    if (!cleanDbId) {
      return NextResponse.json({ error: 'Database ID wajib diisi untuk metode OAuth.' }, { status: 400 })
    }

    const testUrl = `${accurateHost}/api/db-list.do`
    
    const testRes = await fetch(testUrl, {
      headers: {
        'Authorization': `Bearer ${cleanToken}`
      }
    })

    if (!testRes.ok) {
      const errText = await testRes.text()
      console.error('Accurate API Error (db-list):', errText)
      return NextResponse.json({ error: `Gagal terhubung ke Accurate: ${testRes.status}. Pastikan Access Token valid.` }, { status: testRes.status })
    }

    const data = await testRes.json()
    
    if (!data.s) {
      return NextResponse.json({ error: `Koneksi OAuth gagal: ${JSON.stringify(data.d || data)}` }, { status: 400 })
    }

    // data.d is usually an array of databases
    const dbList = Array.isArray(data.d) ? data.d : []
    const dbFound = dbList.find((db: any) => String(db.id) === cleanDbId)

    if (!dbFound) {
      return NextResponse.json({ error: `Koneksi token berhasil, namun Database ID ${cleanDbId} tidak ditemukan di akun ini. Cek kembali Database ID.` }, { status: 400 })
    }

    const renewRes = await renewAccurateWebhookForToken(cleanToken, undefined, cleanDbId)

    return NextResponse.json({ 
      success: true, 
      message: `Koneksi berhasil! Terhubung dengan database: ${dbFound.alias}`,
      db_integer_id: dbFound.id,
      webhook_expiry: renewRes.expiryDate || null,
      last_webhook_renew_at: renewRes.success ? new Date().toISOString() : null
    })

  } catch (err: any) {
    console.error('Accurate Test Connection Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
