import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { access_token, db_id, client_secret } = body

    if (!access_token) {
      return NextResponse.json({ error: 'Access token wajib diisi.' }, { status: 400 })
    }

    const cleanToken = access_token.trim()
    const cleanDbId = db_id?.trim() || ''
    const cleanSecret = client_secret?.trim() || ''

    const accurateHost = 'https://account.accurate.id' 
    
    // --- 1. Try API Token Method ---
    if (cleanSecret) {
      const pad = (n: number) => n.toString().padStart(2, '0')
      const now = new Date()
      // format: dd/MM/yyyy HH:mm:ss
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
        const dbData = tokenData.d?.["data usaha"]
        const dbAlias = dbData?.alias || "Unknown"
        return NextResponse.json({ 
          success: true, 
          message: `Koneksi berhasil! (Metode API Token) Terhubung dengan database: ${dbAlias}` 
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

    return NextResponse.json({ 
      success: true, 
      message: `Koneksi berhasil! Terhubung dengan database: ${dbFound.alias}` 
    })

  } catch (err: any) {
    console.error('Accurate Test Connection Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
