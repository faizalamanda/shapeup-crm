// API Route: /api/pos/printers - Manage POS Printer Devices & Station Mapping
import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// GET /api/pos/printers - List all registered printers with mapped production stations
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase, supabaseAdmin } = ctx
    const dbClient = supabaseAdmin || supabase

    // 1. Fetch printers
    const { data: printers, error: pErr } = await dbClient
      .from('pos_printer_devices')
      .select('*')
      .eq('business_id', businessId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true })

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 })
    }

    // 2. Fetch production stations that reference these printers
    const { data: stations } = await dbClient
      .from('pos_production_stations')
      .select('id, name, code, icon, printer_device_id, printer_connection_type')
      .eq('business_id', businessId)

    // Build map of printer_device_id -> station names
    const stationMap: Record<string, Array<{ id: string; name: string; icon: string }>> = {}
    ;(stations || []).forEach((st: any) => {
      if (st.printer_device_id) {
        if (!stationMap[st.printer_device_id]) stationMap[st.printer_device_id] = []
        stationMap[st.printer_device_id].push({
          id: st.id,
          name: st.name,
          icon: st.icon || '🍳'
        })
      }
    })

    const enrichedPrinters = (printers || []).map((p: any) => ({
      ...p,
      mapped_stations: stationMap[p.id] || []
    }))

    return NextResponse.json({
      success: true,
      printers: enrichedPrinters,
      stations: stations || []
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan server' }, { status: 500 })
  }
}

// POST /api/pos/printers - Create, update, delete or batch register printer devices
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase, supabaseAdmin } = ctx
    const dbClient = supabaseAdmin || supabase

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const { action } = body

    // 1. Delete Printer Device
    if (action === 'delete') {
      const printerId = isUuid(body.id) ? body.id : null
      if (!printerId) {
        return NextResponse.json({ error: 'ID printer tidak valid' }, { status: 400 })
      }

      // Decouple production stations first
      await dbClient
        .from('pos_production_stations')
        .update({ printer_device_id: null })
        .eq('printer_device_id', printerId)
        .eq('business_id', businessId)

      const { error: delErr } = await dbClient
        .from('pos_printer_devices')
        .delete()
        .eq('id', printerId)
        .eq('business_id', businessId)

      if (delErr) {
        return NextResponse.json({ error: 'Gagal menghapus printer: ' + delErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, message: 'Printer berhasil dihapus' })
    }

    // 2. Set Default Printer
    if (action === 'set_default') {
      const printerId = isUuid(body.id) ? body.id : null
      if (!printerId) {
        return NextResponse.json({ error: 'ID printer tidak valid' }, { status: 400 })
      }

      // Unset previous defaults
      await dbClient
        .from('pos_printer_devices')
        .update({ is_default: false })
        .eq('business_id', businessId)

      // Set new default
      const { error: setErr } = await dbClient
        .from('pos_printer_devices')
        .update({ is_default: true })
        .eq('id', printerId)
        .eq('business_id', businessId)

      if (setErr) {
        return NextResponse.json({ error: 'Gagal mengubah default printer: ' + setErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    // 3. Batch Register Printers (e.g. from Computer Printers Scan)
    if (action === 'batch_register') {
      const items = Array.isArray(body.printers) ? body.printers : []
      if (items.length === 0) {
        return NextResponse.json({ success: true, count: 0 })
      }

      // Existing printers to avoid duplicates by name & connection_type
      const { data: existing } = await dbClient
        .from('pos_printer_devices')
        .select('name, connection_type')
        .eq('business_id', businessId)

      const existingSet = new Set((existing || []).map((e: any) => `${e.name.toLowerCase()}:::${e.connection_type}`))

      const toInsert: any[] = []
      for (const item of items) {
        const cleanName = String(item.name || '').trim()
        const connType = ['bluetooth', 'lan', 'system', 'pdf'].includes(item.connection_type)
          ? item.connection_type
          : 'system'
        const paperSize = ['58mm', '80mm', 'A4'].includes(item.paper_size) ? item.paper_size : '58mm'

        if (cleanName && !existingSet.has(`${cleanName.toLowerCase()}:::${connType}`)) {
          toInsert.push({
            business_id: businessId,
            name: cleanName,
            connection_type: connType,
            address: item.address ? String(item.address).trim() : null,
            paper_size: paperSize,
            is_default: Boolean(item.is_default)
          })
          existingSet.add(`${cleanName.toLowerCase()}:::${connType}`)
        }
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await dbClient
          .from('pos_printer_devices')
          .insert(toInsert)

        if (insErr) {
          return NextResponse.json({ error: 'Gagal mendaftarkan printer: ' + insErr.message }, { status: 500 })
        }
      }

      return NextResponse.json({ success: true, count: toInsert.length })
    }

    // 4. Save / Upsert Single Printer Device
    const {
      id: rawId,
      name,
      connection_type = 'system',
      address,
      paper_size = '58mm',
      is_default = false,
      map_to_station_id
    } = body

    const cleanName = String(name || '').trim()
    if (!cleanName) {
      return NextResponse.json({ error: 'Nama printer wajib diisi' }, { status: 400 })
    }

    const connType = ['bluetooth', 'lan', 'system', 'pdf'].includes(connection_type)
      ? connection_type
      : 'system'
    const paperSize = ['58mm', '80mm', 'A4'].includes(paper_size) ? paper_size : '58mm'
    const printerId = isUuid(rawId) ? rawId : undefined

    let savedPrinter: any = null

    if (printerId) {
      // Update
      const { data, error: updErr } = await dbClient
        .from('pos_printer_devices')
        .update({
          name: cleanName,
          connection_type: connType,
          address: address ? String(address).trim() : null,
          paper_size: paperSize,
          is_default: Boolean(is_default)
        })
        .eq('id', printerId)
        .eq('business_id', businessId)
        .select()
        .single()

      if (updErr) {
        return NextResponse.json({ error: 'Gagal memperbarui printer: ' + updErr.message }, { status: 500 })
      }
      savedPrinter = data
    } else {
      // Insert
      const { data, error: insErr } = await dbClient
        .from('pos_printer_devices')
        .insert({
          business_id: businessId,
          name: cleanName,
          connection_type: connType,
          address: address ? String(address).trim() : null,
          paper_size: paperSize,
          is_default: Boolean(is_default)
        })
        .select()
        .single()

      if (insErr) {
        return NextResponse.json({ error: 'Gagal menambahkan printer: ' + insErr.message }, { status: 500 })
      }
      savedPrinter = data
    }

    // If map_to_station_id provided, immediately link this station to the printer
    if (savedPrinter && isUuid(map_to_station_id)) {
      await dbClient
        .from('pos_production_stations')
        .update({
          printer_device_id: savedPrinter.id,
          printer_connection_type: savedPrinter.connection_type,
          printer_name: savedPrinter.name,
          paper_size: savedPrinter.paper_size
        })
        .eq('id', map_to_station_id)
        .eq('business_id', businessId)
    }

    return NextResponse.json({ success: true, printer: savedPrinter })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan server' }, { status: 500 })
  }
}

