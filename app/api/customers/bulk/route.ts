import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import {
  fetchAllBusinessCustomers,
  invalidateCustomerCache,
  normalizePhoneCanonical
} from '@/lib/customerHelper'

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Payload JSON tidak valid' }, { status: 400 })
    }

    const { customers, duplicateAction = 'skip' } = body || {}

    if (!Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json({ error: 'Data customer tidak boleh kosong' }, { status: 400 })
    }

    // Fetch ALL existing customers for this business (chunked, bypasses 1,000 PostgREST limit)
    const existingCustomers = await fetchAllBusinessCustomers(businessId, supabaseAdmin, true)

    const existingPhoneMap = new Map<string, string>() // canonical phone -> id
    existingCustomers.forEach(c => {
      if (c.phone) {
        existingPhoneMap.set(normalizePhoneCanonical(c.phone), c.id)
        existingPhoneMap.set(c.phone, c.id)
      }
    })

    let insertedCount = 0
    let updatedCount = 0
    let skippedCount = 0

    const newRecordsToInsert: any[] = []
    const recordsToUpdate: { id: string; payload: any }[] = []

    for (let i = 0; i < customers.length; i++) {
      const item = customers[i]
      const rawName = item.name ? String(item.name).trim() : ''
      const rawPhone = item.phone ? String(item.phone).trim() : ''

      if (!rawName || !rawPhone) {
        skippedCount++
        continue
      }

      const cleanPhone = normalizePhoneCanonical(rawPhone)
      if (!cleanPhone) {
        skippedCount++
        continue
      }

      const existingId = existingPhoneMap.get(cleanPhone)

      const recordPayload = {
        business_id: businessId,
        name: rawName,
        phone: cleanPhone,
        email: item.email ? String(item.email).trim() : null,
        category: item.category || 'General',
        address_data: item.address_data || null,
        metadata: item.metadata || null
      }

      if (existingId) {
        if (duplicateAction === 'update' && existingId !== 'pending_insert') {
          recordsToUpdate.push({
            id: existingId,
            payload: recordPayload
          })
        } else {
          skippedCount++
        }
      } else {
        newRecordsToInsert.push(recordPayload)
        existingPhoneMap.set(cleanPhone, 'pending_insert')
      }
    }

    // Execute bulk inserts in chunks of 500
    if (newRecordsToInsert.length > 0) {
      const CHUNK_SIZE = 500
      for (let i = 0; i < newRecordsToInsert.length; i += CHUNK_SIZE) {
        const chunk = newRecordsToInsert.slice(i, i + CHUNK_SIZE)
        const { error: insErr } = await supabaseAdmin
          .from('customers')
          .insert(chunk)

        if (insErr) throw insErr
        insertedCount += chunk.length
      }
    }

    // Execute updates
    if (recordsToUpdate.length > 0) {
      for (const item of recordsToUpdate) {
        const { error: updErr } = await supabaseAdmin
          .from('customers')
          .update(item.payload)
          .eq('id', item.id)
          .eq('business_id', businessId)

        if (updErr) {
          console.error(`Failed to update customer ${item.id}:`, updErr)
          skippedCount++
        } else {
          updatedCount++
        }
      }
    }

    // Invalidate server-side customer directory cache so all pages get fresh data
    invalidateCustomerCache(businessId)

    return NextResponse.json({
      success: true,
      count: insertedCount,
      insertedCount,
      updatedCount,
      skippedCount,
      message: `Berhasil mengimpor customer! (Ditambahkan: ${insertedCount}, Diperbarui: ${updatedCount}, Diabaikan: ${skippedCount})`
    })
  } catch (err: any) {
    console.error('[ShapeUp] Customer bulk import error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
