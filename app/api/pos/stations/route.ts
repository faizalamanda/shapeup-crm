// API Route: /api/pos/stations - Manage Custom Production Stations & POS Mode
import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// GET /api/pos/stations - Fetch stations and mapped categories for active business
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase, supabaseAdmin } = ctx
    const dbClient = supabaseAdmin || supabase

    // 1. Fetch stations
    const { data: stations, error: stErr } = await dbClient
      .from('pos_production_stations')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (stErr && !stErr.message?.includes('does not exist')) {
      return NextResponse.json({ error: stErr.message }, { status: 500 })
    }

    // 2. Fetch all categories for this business with mapped station
    let { data: categories, error: catErr } = await dbClient
      .from('categories')
      .select('id, name, production_station_id')
      .eq('business_id', businessId)
      .order('name', { ascending: true })

    // Resilient fallback if production_station_id migration has not been run yet
    if (catErr && (catErr.message?.includes('production_station_id') || catErr.message?.includes('does not exist'))) {
      const { data: fallbackCats } = await dbClient
        .from('categories')
        .select('id, name')
        .eq('business_id', businessId)
        .order('name', { ascending: true })
      categories = (fallbackCats || []).map((c: any) => ({ id: c.id, name: c.name, production_station_id: null }))
      catErr = null
    }

    if (catErr) {
      return NextResponse.json({ error: catErr.message }, { status: 500 })
    }

    // 3. Fetch current business pos_mode
    const { data: biz } = await dbClient
      .from('businesses')
      .select('pos_mode, industry')
      .eq('id', businessId)
      .maybeSingle()

    return NextResponse.json({
      stations: stations || [],
      categories: categories || [],
      posMode: biz?.pos_mode || 'retail',
      industry: biz?.industry || 'retail'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan server' }, { status: 500 })
  }
}

// POST /api/pos/stations - Upsert, delete station or update POS mode
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

    // 1. Update POS Mode on business ('retail' | 'fnb' | 'custom')
    if (action === 'update_pos_mode') {
      const mode = String(body.pos_mode || 'retail').toLowerCase()
      if (!['retail', 'fnb', 'custom'].includes(mode)) {
        return NextResponse.json({ error: 'Mode POS tidak valid' }, { status: 400 })
      }

      const { error: updErr } = await dbClient
        .from('businesses')
        .update({ pos_mode: mode })
        .eq('id', businessId)

      if (updErr) {
        return NextResponse.json({ error: 'Gagal memperbarui mode POS: ' + updErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, posMode: mode })
    }

    // 2. Delete station
    if (action === 'delete') {
      const stationId = body.id
      if (!isUuid(stationId)) {
        return NextResponse.json({ error: 'ID stasiun tidak valid' }, { status: 400 })
      }

      // Decouple categories first defensively
      await dbClient
        .from('categories')
        .update({ production_station_id: null })
        .eq('production_station_id', stationId)
        .eq('business_id', businessId)

      const { error: delErr } = await dbClient
        .from('pos_production_stations')
        .delete()
        .eq('id', stationId)
        .eq('business_id', businessId)

      if (delErr) {
        return NextResponse.json({ error: 'Gagal menghapus stasiun: ' + delErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, message: 'Stasiun berhasil dihapus' })
    }

    // 3. Save / Upsert Station
    const {
      id: rawId,
      name,
      code,
      icon = '🍳',
      paper_size = '58mm',
      is_active = true,
      category_ids = []
    } = body

    const cleanName = String(name || '').trim()
    if (!cleanName) {
      return NextResponse.json({ error: 'Nama stasiun wajib diisi' }, { status: 400 })
    }

    const stationId = isUuid(rawId) ? rawId : undefined
    let savedStation: any = null

    if (stationId) {
      // Update existing station
      const { data, error: updErr } = await dbClient
        .from('pos_production_stations')
        .update({
          name: cleanName,
          code: code ? String(code).trim().toUpperCase() : null,
          icon: String(icon || '🍳'),
          paper_size: paper_size === '80mm' ? '80mm' : '58mm',
          is_active: Boolean(is_active),
          updated_at: new Date().toISOString()
        })
        .eq('id', stationId)
        .eq('business_id', businessId)
        .select()
        .single()

      if (updErr) {
        return NextResponse.json({ error: 'Gagal memperbarui stasiun: ' + updErr.message }, { status: 500 })
      }
      savedStation = data
    } else {
      // Insert new station
      const { data, error: insErr } = await dbClient
        .from('pos_production_stations')
        .insert({
          business_id: businessId,
          name: cleanName,
          code: code ? String(code).trim().toUpperCase() : null,
          icon: String(icon || '🍳'),
          paper_size: paper_size === '80mm' ? '80mm' : '58mm',
          is_active: Boolean(is_active)
        })
        .select()
        .single()

      if (insErr) {
        return NextResponse.json({ error: 'Gagal menambahkan stasiun: ' + insErr.message }, { status: 500 })
      }
      savedStation = data
    }

    // 4. Update Category Mappings atomically
    const targetStationId = savedStation.id
    if (Array.isArray(category_ids)) {
      const validCategoryIds = category_ids.filter((cid: any) => isUuid(cid))

      // Unassign categories previously on this station that are no longer checked
      await dbClient
        .from('categories')
        .update({ production_station_id: null })
        .eq('production_station_id', targetStationId)
        .eq('business_id', businessId)

      // Assign selected categories
      if (validCategoryIds.length > 0) {
        await dbClient
          .from('categories')
          .update({ production_station_id: targetStationId })
          .in('id', validCategoryIds)
          .eq('business_id', businessId)
      }
    }

    return NextResponse.json({ success: true, station: savedStation })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan server' }, { status: 500 })
  }
}

