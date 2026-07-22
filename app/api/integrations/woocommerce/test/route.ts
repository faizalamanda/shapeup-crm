import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Sesi login telah habis. Silakan login kembali.' }, { status: 401 })
    }

    const body = await req.json()
    const { store_url, consumer_key, consumer_secret } = body

    if (!store_url || !consumer_key || !consumer_secret) {
      return NextResponse.json({ error: 'URL Toko, Consumer Key, dan Consumer Secret wajib diisi.' }, { status: 400 })
    }

    // Clean store URL
    let cleanUrl = store_url.trim().replace(/\/+$/, '')
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl
    }

    // Construct Basic Auth Header
    const credentials = Buffer.from(`${consumer_key.trim()}:${consumer_secret.trim()}`).toString('base64')

    // Test API call to WooCommerce /wp-json/wc/v3/orders?per_page=1
    const targetEndpoint = `${cleanUrl}/wp-json/wc/v3/orders?per_page=1`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 seconds timeout

    const res = await fetch(targetEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'ShapeUp-CRM/1.0',
        'Accept': 'application/json'
      },
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (res.ok) {
      return NextResponse.json({
        success: true,
        message: 'Koneksi ke REST API WooCommerce berhasil!',
        status: res.status
      })
    }

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        success: false,
        error: 'Otentikasi gagal. Pastikan Consumer Key dan Consumer Secret Anda benar dan memiliki izin Read.'
      }, { status: 400 })
    }

    if (res.status === 404) {
      return NextResponse.json({
        success: false,
        error: 'Endpoint WooCommerce REST API tidak ditemukan. Pastikan WooCommerce dan Permalink WordPress telah diaktifkan.'
      }, { status: 400 })
    }

    const errText = await res.text()
    return NextResponse.json({
      success: false,
      error: `WooCommerce merespons dengan HTTP ${res.status}: ${errText.substring(0, 150)}`
    }, { status: 400 })

  } catch (err: any) {
    console.error('WooCommerce Test Connection Error:', err)
    if (err.name === 'AbortError') {
      return NextResponse.json({ error: 'Koneksi ke toko WooCommerce timeout (lebih dari 10 detik).' }, { status: 504 })
    }
    return NextResponse.json({ error: err.message || 'Gagal terhubung ke toko WooCommerce' }, { status: 500 })
  }
}
