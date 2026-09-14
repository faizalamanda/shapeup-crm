import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { access_token, db_id } = body

    if (!access_token || !db_id) {
      return NextResponse.json({ error: 'Access token dan Database ID (X-Session-ID) wajib diisi.' }, { status: 400 })
    }

    const accurateHost = 'https://account.accurate.id' 
    const testUrl = `${accurateHost}/api/sales-order/list.do?sp.page=1&sp.pageSize=1`
    
    const testRes = await fetch(testUrl, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'X-Session-ID': db_id
      }
    })

    if (!testRes.ok) {
      const errText = await testRes.text()
      console.error('Accurate API Error:', errText)
      return NextResponse.json({ error: `Gagal terhubung ke Accurate: ${testRes.status}. Cek kembali kredensial Anda.` }, { status: testRes.status })
    }

    return NextResponse.json({ 
      success: true, 
      message: `Koneksi berhasil!` 
    })

  } catch (err: any) {
    console.error('Accurate Test Connection Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
