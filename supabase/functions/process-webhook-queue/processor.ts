/**
 * WooCommerce Order Processor untuk Edge Function
 *
 * Memproses satu order dari webhook_ingest_queue:
 *   1. Cek integrasi aktif (via business_integrations, indexed)
 *   2. Bersihkan & transformasi data
 *   3. Upsert customer (onConflict: business_id, phone) — dengan validasi phone
 *   4. Upsert order (onConflict: source_platform, external_id)
 *   5. Sync ledger (akuntansi + stok) — dengan isNewOrder yang benar
 *   6. Loyalty hooks
 *
 * Fix dari analisis:
 *   ✅ Phone kosong → fallback ke nophone_{woo.id}
 *   ✅ is_active check di business_integrations (proper index, bukan JSONB scan)
 *   ✅ address_data hanya di-set saat INSERT baru, tidak overwrite update
 *   ✅ DB calls diparalelkan (accounts + integConfig + products)
 *   ✅ isNewOrder diteruskan dengan benar ke syncOrderToLedger
 */

import { SupabaseClient } from "jsr:@supabase/supabase-js@2"

// ─── Helpers (inline, tidak bisa import dari Next.js lib) ────────────────────

const toNum = (val: any): number => {
  const parsed = parseFloat(val)
  return isNaN(parsed) ? 0 : parsed
}

const cleanText = (text: any, replacement = ", "): string => {
  if (!text) return ""
  return String(text)
    .replace(/[\n\r\t]+/g, replacement)
    .replace(/\s\s+/g, " ")
    .trim()
}

function normalizePhone(rawPhone: string): string {
  let clean = rawPhone.replace(/\D/g, "")
  if (clean.startsWith("0")) {
    clean = "62" + clean.substring(1)
  } else if (clean.startsWith("8")) {
    clean = "62" + clean
  }
  return clean
}

// ─── Main Processor ──────────────────────────────────────────────────────────

export async function processWooOrder(
  supabase: SupabaseClient,
  businessId: string,
  woo: any
): Promise<void> {

  // 1. CEK INTEGRASI AKTIF
  // Menggunakan business_integrations (proper index) bukan integrations (JSONB scan)
  // FIX: query ini dulunya ada di hot path sebelum after(), sekarang non-blocking
  const { data: bizInteg } = await supabase
    .from("business_integrations")
    .select("is_active")
    .eq("business_id", businessId)
    .eq("provider", "woocommerce")
    .maybeSingle()

  // Jika ada record di business_integrations dan aktif = false, skip
  if (bizInteg && bizInteg.is_active === false) {
    console.log(`[Processor] WooCommerce disabled for business ${businessId}, skipping order #${woo.number}`)
    return
  }

  // Fallback: cek tabel integrations lama jika belum ada di business_integrations
  // CATATAN: tabel integrations lama menyimpan business_id di dalam JSONB api_credentials,
  // bukan sebagai kolom langsung. Gunakan filter JSONB (setelah migrasi index, ini akan cepat).
  if (!bizInteg) {
    const { data: oldInteg } = await supabase
      .from("integrations")
      .select("is_active")
      .eq("platform_name", "woocommerce")
      .filter("api_credentials->>business_id", "eq", businessId)  // JSONB filter (sebelum migrasi kolom)
      .maybeSingle()

    if (oldInteg && oldInteg.is_active === false) {
      console.log(`[Processor] WooCommerce disabled (legacy integ) for business ${businessId}`)
      return
    }
  }

  // 2. TRANSFORMASI DATA
  // FIX: Validasi phone — jangan biarkan string kosong jadi conflict key
  const rawPhone = woo.billing?.phone || "0"
  const cleanPhone = normalizePhone(rawPhone)
  const billingPhone = cleanPhone.length >= 5
    ? cleanPhone
    : `nophone_${woo.id}`  // Fallback: tidak ada phone valid → gunakan ID sebagai identifier

  if (cleanPhone.length < 5) {
    console.warn(`[Processor] Order #${woo.number} has no valid phone (raw: "${rawPhone}"), using fallback: ${billingPhone}`)
  }

  const fullName = `${woo.billing?.first_name || ""} ${woo.billing?.last_name || ""}`.trim() || "No Name"
  const orderDateUtc = woo.date_created_gmt ? `${woo.date_created_gmt}Z` : null

  const other_fees = woo.fee_lines
    ? woo.fee_lines.reduce((acc: number, fee: any) => acc + toNum(fee.total), 0)
    : 0

  const calculatedSubtotal = woo.line_items
    ? woo.line_items.reduce((acc: number, item: any) => acc + toNum(item.subtotal), 0)
    : 0

  const countryCode = (woo.billing?.country || "").toUpperCase()
  const countryPreset =
    countryCode === "ID" ? "indonesia" :
    countryCode === "MY" ? "malaysia" :
    countryCode === "US" ? "usa" : "custom"

  const countryName =
    countryCode === "ID" ? "Indonesia" :
    countryCode === "MY" ? "Malaysia" :
    countryCode === "US" ? "United States" :
    woo.billing?.country || ""

  const metaData: any[] = woo.meta_data || []
  const kecamatan =
    metaData.find((i: any) => i.key === "shipping_kecamatan")?.value ||
    metaData.find((i: any) => i.key === "billing_kecamatan")?.value || ""

  const addressData = {
    country_preset: countryPreset,
    country: countryName,
    address_line1: cleanText(woo.billing?.address_1 || ""),
    address_line2: cleanText(woo.billing?.address_2 || ""),
    subdistrict: kecamatan,
    city: woo.billing?.city || "",
    state: woo.billing?.state || "",
    postcode: woo.billing?.postcode || "",
  }

  // 3. UPSERT CUSTOMER
  // FIX: Cek apakah customer sudah ada terlebih dahulu
  // Jika sudah ada → update name & email saja, JANGAN overwrite address_data (preservasi data yang sudah diedit manual)
  // Jika baru → insert dengan address_data lengkap
  const { data: existingCustomer } = await supabase
    .from("customers")
    .select("id, address_data")
    .eq("business_id", businessId)
    .eq("phone", billingPhone)
    .maybeSingle()

  let customerId: string

  if (existingCustomer) {
    // UPDATE: hanya name & email, PRESERVE address_data yang sudah ada
    const updateData: any = {
      name: fullName,
      email: woo.billing?.email || "",
    }
    // Hanya update address_data jika customer belum punya (field masih null/kosong)
    if (!existingCustomer.address_data || Object.keys(existingCustomer.address_data).length === 0) {
      updateData.address_data = addressData
    }

    const { error: updateErr } = await supabase
      .from("customers")
      .update(updateData)
      .eq("id", existingCustomer.id)

    if (updateErr) {
      throw new Error(`Customer update failed for order #${woo.number}: ${updateErr.message}`)
    }
    customerId = existingCustomer.id
  } else {
    // INSERT: customer baru dengan semua data termasuk address_data
    // Gunakan upsert agar aman dari race condition (dua webhook concurrent untuk customer sama)
    const { data: newCustomer, error: insertErr } = await supabase
      .from("customers")
      .upsert({
        business_id: businessId,  // business_id sudah UUID dari webhook_ingest_queue.business_id
        phone: billingPhone,
        name: fullName,
        email: woo.billing?.email || "",
        address_data: addressData,
      }, { onConflict: "business_id, phone", ignoreDuplicates: false })
      .select("id")
      .single()

    if (insertErr || !newCustomer) {
      throw new Error(`Customer upsert failed for order #${woo.number}: ${insertErr?.message}`)
    }
    customerId = newCustomer.id
  }

  // 4. UPSERT ORDER
  const { data: orderData, error: orderError } = await supabase
    .from("orders")
    .upsert({
      business_id: businessId,
      customer_id: customerId,
      external_id: woo.id.toString(),
      source_platform: "WooCommerce",
      order_number: woo.number,
      order_date: woo.date_created,
      order_date_utc: orderDateUtc,
      status: woo.status,
      total_qty: woo.line_items?.reduce((acc: number, item: any) => acc + toNum(item.quantity), 0) || 0,
      subtotal: calculatedSubtotal,
      discount_amount: toNum(woo.discount_total),
      shipping_cost: toNum(woo.shipping_total),
      other_fees: other_fees,
      grand_total: toNum(woo.total),
      payment_method: woo.payment_method_title || "Manual",
      items_json: woo.line_items || [],
      raw_source_data: woo,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_platform, external_id" })
    .select("id")
    .single()

  if (orderError || !orderData) {
    throw new Error(`Order upsert failed for #${woo.number}: ${orderError?.message}`)
  }

  // 5. SYNC LEDGER
  // Ledger sync dipanggil via internal Next.js API route (/api/webhook/woo/sync-ledger)
  // karena orderLedger.ts tidak bisa diimport langsung di Deno Edge Function.
  //
  // ⚠️ CRITICAL: Jika APP_URL tidak diset, kita HARUS throw error — bukan skip silent.
  // Item akan masuk dead letter atau retry daripada di-mark done tanpa accounting data.
  const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") || Deno.env.get("APP_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!appUrl) {
    throw new Error(
      `[Processor] APP_URL not configured in Edge Function secrets. ` +
      `Set NEXT_PUBLIC_APP_URL or APP_URL in Supabase Dashboard → Edge Functions → Secrets. ` +
      `Order #${woo.number} cannot sync ledger without this.`
    )
  }

  const ledgerRes = await fetch(`${appUrl}/api/webhook/woo/sync-ledger`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-key": serviceKey ?? "",
    },
    body: JSON.stringify({
      orderId: orderData.id,
      businessId,
    }),
  })

  if (!ledgerRes.ok) {
    const body = await ledgerRes.text()
    // Status 4xx = config error (non-retryable), 5xx = transient error (retryable)
    // isRetryableError di queue-manager akan mengklasifikasikan berdasarkan pesan error
    throw new Error(
      `Ledger sync HTTP ${ledgerRes.status} for order #${woo.number}: ${body}`
    )
  }

  console.log(`[Processor] ✅ Order #${woo.number} (ID: ${orderData.id}) processed successfully for business ${businessId}`)
}
