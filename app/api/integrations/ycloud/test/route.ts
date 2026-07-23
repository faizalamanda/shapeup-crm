import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { api_key } = body

    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      return NextResponse.json({ 
        success: false, 
        error: 'API Key YCloud wajib diisi untuk melakukan pengujian.' 
      }, { status: 400 })
    }

    // Clean up input: remove leading/trailing quotes, spaces, and newlines
    let cleanApiKey = api_key.trim()
    cleanApiKey = cleanApiKey.replace(/^["']|["']$/g, '').trim()

    if (!cleanApiKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'API Key YCloud tidak boleh kosong.' 
      }, { status: 400 })
    }

    // 1. Primary Endpoint Check: YCloud v2 Balance API (official auth test endpoint)
    let ycloudRes = await fetch('https://api.ycloud.com/v2/balance', {
      method: 'GET',
      headers: {
        'X-API-Key': cleanApiKey,
        'Content-Type': 'application/json',
      },
    })

    let json = await ycloudRes.json().catch(() => ({}))

    // 2. If v2/balance returned 404, fallback to v1/whatsapp/phoneNumbers
    if (ycloudRes.status === 404) {
      ycloudRes = await fetch('https://api.ycloud.com/v1/whatsapp/phoneNumbers', {
        method: 'GET',
        headers: {
          'X-API-Key': cleanApiKey,
          'Content-Type': 'application/json',
        },
      })
      json = await ycloudRes.json().catch(() => ({}))
    }

    if (!ycloudRes.ok) {
      let rawError = ''
      let reqId = json?.error?.requestId || ''
      let errCode = json?.error?.code || ''
      
      if (typeof json?.error === 'object' && json?.error !== null) {
        rawError = json.error.message || json.error.code || JSON.stringify(json.error)
      } else if (typeof json?.error === 'string') {
        rawError = json.error
      } else if (json?.message && json.message !== 'No message available') {
        rawError = json.message
      } else {
        rawError = `HTTP ${ycloudRes.status} ${ycloudRes.statusText}`
      }

      let userFriendlyMsg = rawError

      if (rawError.includes('INVALID_API_KEY') || ycloudRes.status === 401) {
        userFriendlyMsg = `API Key tidak terverifikasi oleh YCloud (${errCode || 'UNAUTHORIZED'} - INVALID_API_KEY).`
      } else if (rawError.includes('FORBIDDEN') || ycloudRes.status === 403) {
        userFriendlyMsg = `Akses ditolak oleh YCloud (${errCode || 'FORBIDDEN'}).`
      } else if (rawError === 'No message available' || ycloudRes.status === 404) {
        userFriendlyMsg = `API Key tidak ditemukan atau endpoint YCloud tidak tersedia (${ycloudRes.status}).`
      }

      if (reqId) {
        userFriendlyMsg += ` [Request ID: ${reqId}]`
      }

      return NextResponse.json({
        success: false,
        error: `Gagal terhubung ke YCloud: ${userFriendlyMsg}`
      }, { status: 400 })
    }

    // Attempt optional phoneNumbers check for extra detail if balance check succeeded
    let phoneInfoStr = ''
    try {
      const phoneRes = await fetch('https://api.ycloud.com/v1/whatsapp/phoneNumbers', {
        method: 'GET',
        headers: { 'X-API-Key': cleanApiKey, 'Content-Type': 'application/json' },
      })
      if (phoneRes.ok) {
        const phoneJson = await phoneRes.json()
        const count = Array.isArray(phoneJson.items) ? phoneJson.items.length : 0
        if (count > 0) {
          const numbers = phoneJson.items.map((i: any) => i.displayPhoneNumber || i.phoneNumber).filter(Boolean).join(', ')
          phoneInfoStr = ` (${count} nomor WA: ${numbers})`
        }
      }
    } catch (_) {}

    let successMessage = `✅ Berhasil terhubung ke API YCloud (v2)!`
    if (json.amount !== undefined) {
      successMessage += ` Saldo: ${json.currency || '$'}${json.amount}${phoneInfoStr}`
    } else if (phoneInfoStr) {
      successMessage += phoneInfoStr
    }

    return NextResponse.json({
      success: true,
      message: successMessage,
      data: json
    })

  } catch (err: any) {
    console.error('YCloud Test Connection Exception:', err)
    return NextResponse.json({
      success: false,
      error: 'Terjadi kesalahan jaringan saat menguji koneksi YCloud: ' + (err.message || 'Unknown error')
    }, { status: 500 })
  }
}
