import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    // 1. Get logged-in user and active business ID
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found for user profile' }, { status: 400 })
    }

    const businessId = profile.active_business_id

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ 
        error: 'SUPABASE_SERVICE_ROLE_KEY is not defined in env' 
      }, { status: 500 })
    }

    // 2. Parse request body
    const body = await req.json()
    const { customers, duplicateAction = 'skip' } = body

    if (!Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json({ error: 'Data customer tidak boleh kosong' }, { status: 400 })
    }

    // 3. Initialize Admin Client to bypass RLS
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // 4. Fetch existing customers for this business to check duplicates by phone
    const { data: existingCustomers, error: fetchErr } = await supabaseAdmin
      .from('customers')
      .select('id, phone')
      .eq('business_id', businessId)

    if (fetchErr) throw fetchErr

    const existingPhoneMap = new Map<string, string>() // phone -> id
    existingCustomers?.forEach(c => {
      if (c.phone) existingPhoneMap.set(c.phone, c.id)
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

      // Clean phone number
      let cleanPhone = rawPhone.replace(/\D/g, '')
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.substring(1)
      } else if (cleanPhone.startsWith('8')) {
        cleanPhone = '62' + cleanPhone
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
        if (duplicateAction === 'update') {
          recordsToUpdate.push({
            id: existingId,
            payload: recordPayload
          })
        } else {
          skippedCount++
        }
      } else {
        newRecordsToInsert.push(recordPayload)
        // Mark as added in local map in case duplicate phone occurs multiple times in same file
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

    // Execute updates individually or in parallel batch
    if (recordsToUpdate.length > 0) {
      for (const item of recordsToUpdate) {
        const { error: updErr } = await supabaseAdmin
          .from('customers')
          .update(item.payload)
          .eq('id', item.id)

        if (updErr) {
          console.error(`Failed to update customer ${item.id}:`, updErr)
          skippedCount++
        } else {
          updatedCount++
        }
      }
    }

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
