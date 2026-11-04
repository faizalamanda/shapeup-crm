# Accurate Online Webhook Auto-Renewal & Unified Queue Processing Architecture

## 1. Ringkasan Eksekutif & Konteks Masalah

Pada integrasi **Accurate Online** (`provider = 'accurate'`), terdapat dua faktor arsitektural kritis yang menentukan keberlangsungan sinkronisasi pesanan secara *real-time*:

1. **Kebijakan Masa Aktif Webhook Accurate Online (7-Day Lease Expiration):**
   Berdasarkan spesifikasi OpenAPI Accurate Online (`https://account.accurate.id/open-api/json.do`), langganan pengiriman webhook ke server pihak ketiga hanya aktif selama **7 hari** sejak diaktifkan atau diperpanjang. Jika masa aktif ini habis tanpa pemanggilan endpoint `/api/webhook-renew.do`, server Accurate Online berhenti mengirim HTTP POST ke aplikasi dan menandai seluruh event di `/api/webhook-history.do` dengan `status: "Skip"` (`skipped: true`).

2. **Polimorfisme Payload pada Tabel Antrean Terpadu (`webhook_ingest_queue`):**
   Tabel `public.webhook_ingest_queue` menampung antrean webhook lintas platform (`source = 'woocommerce'` dan `source = 'accurate'`). Fungsi PostgreSQL RPC `fetch_webhook_queue_batch` mengklaim baris berstatus `'pending'` secara atomik (`FOR UPDATE SKIP LOCKED`) tanpa memfilter kolom `source`. Oleh karena itu, worker utama yang dipanggil oleh `pg_cron` setiap 1 menit (`POST /api/webhook/woo/process-queue`) **wajib** memiliki *multi-source dispatcher* berdasarkan `item.source`.

---

## 2. Arsitektur Solusi

### 2.1 Mekanisme Auto-Renew Berlapis (Zero Manual Activation)

Modul [`lib/integrations/accurate/syncService.ts`](../../lib/integrations/accurate/syncService.ts) menyediakan fungsi terpusat:
- **`buildAccurateAuthHeaders(accessToken, clientSecret, dbId)`**: Menghasilkan header otentikasi Accurate dengan waktu zona `Asia/Jakarta` (`UTC+7`) dan tanda tangan `HMAC-SHA256` (`X-Api-Timestamp` & `X-Api-Signature`) untuk metode API Token, atau `X-Session-ID` untuk fallback OAuth.
- **`renewAccurateWebhookForToken(accessToken, clientSecret, dbId)`**: Memanggil `GET https://account.accurate.id/api/webhook-renew.do` yang memperpanjang masa aktif webhook selama 7 hari ke depan dan mengembalikan tanggal kedaluwarsa baru (contoh: `{"s": true, "d": "11/11/2026"}`).
- **`autoRenewAllAccurateWebhooks(supabaseAdmin, force = false)`**:
  - Memeriksa seluruh baris aktif di `business_integrations` (`provider = 'accurate'`, `is_active = true`).
  - Mengevaluasi properti `config.last_webhook_renew_at`. Jika belum pernah tercatat atau sudah berusia **$\ge 3$ hari (72 jam)**, sistem otomatis memanggil `renewAccurateWebhookForToken()` dan menyimpan `webhook_expiry` serta `last_webhook_renew_at` ke dalam `business_integrations.config`.
  - Karena threshold evaluasi adalah **3 hari** sementara masa berlaku di Accurate adalah **7 hari**, terdapat *safety buffer* selama 4 hari penuh sehingga webhook tidak pernah kedaluwarsa.

**Titik Pemicu Auto-Renew (4 Lapis Pertahanan):**
1. **Background Cron Worker (`/api/webhook/woo/process-queue`):** Dipanggil setiap menit oleh `pg_cron`. Di awal eksekusi, memanggil `autoRenewAllAccurateWebhooks(supabaseAdmin)` (operasi di memori/DB ringan < 10ms jika belum 3 hari; hanya memanggil API Accurate sekali setiap 3 hari).
2. **Saat Test Koneksi (`/api/integrations/accurate/test-connection`):** Otomatis memperbarui masa aktif webhook saat kredensial diuji.
3. **Saat Simpan Pengaturan (`AccurateSettingsModal.tsx`):** Menyimpan `webhook_expiry` dan `last_webhook_renew_at` langsung ke database dan menampilkan indikator visual **Webhook Real-Time Aktif (Auto-Renew)**.
4. **Saat Sinkronisasi Manual Selesai (`executeAccurateSync`):** Memeriksa dan memperbarui masa aktif webhook pada halaman terakhir sinkronisasi.

---

### 2.2 Multi-Source Queue Worker Dispatching

Di dalam [`app/api/webhook/woo/process-queue/route.ts`](../../app/api/webhook/woo/process-queue/route.ts):

```typescript
for (const item of batch) {
  try {
    const { id, business_id, payload, source } = item

    // ─── BRANCH A: ACCURATE ONLINE WEBHOOK ───
    if (source === 'accurate') {
      const accRes = await processAccurateWebhookPayload(business_id, payload)
      if (!accRes.success) {
        throw new Error(`Accurate webhook sync failed: ${accRes.error}`)
      }
      await markDone(supabaseAdmin, id)
      processedCount++
      continue
    }

    // ─── BRANCH B: WOOCOMMERCE WEBHOOK (DEFAULT) ───
    const woo = payload
    // ...
```

Fungsi `processAccurateWebhookPayload(businessId, payload)` mengekstrak seluruh `salesInvoiceId` dan `salesReceiptId` dari array event webhook Accurate, menduplikasinya dengan `Set`, lalu memanggil `executeAccurateSync(businessId, 1, { invoiceIds, receiptIds })` yang menarik detail faktur, meng-upsert pelanggan, produk baru, pesanan (`orders`), dan menjalankan `syncOrderToLedger()`.

---

## 3. Kompatibilitas Data Lama (Legacy Fallback Standards)

1. **Resolusi `databaseId` dengan Fallback Dekode JWT (`aat.`):**
   - Payload webhook Accurate mengirimkan `databaseId` berupa angka integer (contoh: `2559718`), sedangkan input pengguna di form lama terkadang berisi UUID `db_id`.
   - Di [`app/api/webhook/accurate/route.ts`](../../app/api/webhook/accurate/route.ts) dan `autoRenewAllAccurateWebhooks()`, jika `conf.db_integer_id` belum tersedia pada data lama, sistem secara otomatis mendekode segmen payload Base64 dari token `aat.<ver>.<base64_payload>.<sig>` untuk mengekstrak properti `d` (ID integer database Accurate) dan mem-backfill `db_integer_id` ke database.

2. **Preservasi Metadata Konfigurasi Saat Simpan Ulang:**
   - Pada [`AccurateSettingsModal.tsx`](../../lib/integrations/accurate/AccurateSettingsModal.tsx), penyimpanan konfigurasi wajib mempertahankan seluruh properti yang sudah ada (`...(accurateSaved?.config || {})`) agar `last_sync_date`, `last_sync_time_str`, `db_integer_id`, dan `webhook_expiry` tidak hilang ketika pengguna memperbarui token.

