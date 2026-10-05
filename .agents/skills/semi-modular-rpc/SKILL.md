---
name: semi-modular-rpc
description: Panduan arsitektur Semi-Modular RPC untuk transaksi ACID (Zero Tolerance) di Supabase. Gunakan skill ini jika Anda perlu membuat API yang memutasi banyak data finansial/stok agar kebal timeout.
---

# Semi-Modular RPC Architecture for Zero-Tolerance ACID Transactions

## The Problem
Dalam ekosistem Supabase (REST API/PostgREST), klien JS (`@supabase/supabase-js`) bersifat *stateless* dan tidak memiliki kemampuan membuka blokir transaksi interaktif (seperti `BEGIN`...`COMMIT`).
Mengeksekusi banyak panggilan API secara berurutan menggunakan `Promise.all` (seperti saat *insert* 200 produk ke `stock_moves` dan menghitung WAC/HPP) rentan menyebabkan:
1. **Connection Pool Exhaustion / Timeout:** Server lambat atau terputus.
2. **Partial Failure:** Sebagian data tersimpan (Jurnal masuk), sebagian lagi gagal (Stok kosong). Ini berakibat fatal pada sistem Akuntansi & ERP.

## The Solution: "Semi-Modular RPC"
Untuk mencapai **Zero Tolerance (100% ACID)** tanpa kehilangan fleksibilitas modularitas TypeScript, ShapeUp CRM mengadopsi pola "Semi-Modular RPC". 
Inti dari pola ini adalah **Pemisahan Peran (Separation of Concerns)**:
1. **Node.js (TypeScript) = Otak Logika / Aturan Bisnis.**
   Menghitung rasio diskon, memutuskan akun Ledger mana yang didebet/kredit, dan menghitung total (*aggregator*). Hasilnya dibungkus menjadi sebuah JSON Payload raksasa yang sudah siap telan.
2. **Supabase RPC (PL/pgSQL) = Eksekutor Bisu.**
   Murni bertugas membedah JSON Payload tersebut, membuka pintu transaksi (`BEGIN`), meng-insert data ke berbagai tabel (Jurnal, Stok, Transaksi), menghitung *Running Balance* / WAC, lalu menutup pintu (`COMMIT`). Jika gagal satu baris saja, seluruh operasi otomatis di-`ROLLBACK` oleh PostgreSQL.

---

## Aturan Implementasi

### 1. Pembentukan JSON Payload di Vercel/Node.js
Dilarang memanggil `supabase.from().insert()` berulang kali. Kumpulkan semua hasil dari berbagai modul bisnis Anda menjadi 1 objek Payload.

```typescript
// Contoh di app/api/purchases/route.ts
const journalLines = [] // Dihitung di Node.js
const physicalItemsAggregated = [] // Diagregasi di Node.js

const payload = {
  business_id: businessId,
  purchase_number: "PO-123",
  date: "2023-10-01",
  journal_lines: journalLines, // Array siap insert
  physical_items_aggregated: physicalItemsAggregated
}

// 1 Panggilan Tunggal
const { data, error } = await supabase.rpc('create_purchase_transaction_v1', { payload })
```

### 2. Pembuatan Fungsi Eksekutor di SQL (RPC)
Buat file migrasi di `supabase/migrations/` yang berisi logika PL/pgSQL dengan parameter tipe `jsonb`.

```sql
CREATE OR REPLACE FUNCTION public.create_purchase_transaction_v1(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_tx_id UUID;
  v_jl jsonb;
BEGIN
  -- 1. Insert Utama
  INSERT INTO public.transactions (business_id, date) 
  VALUES ((payload->>'business_id')::UUID, (payload->>'date')::DATE)
  RETURNING id INTO v_tx_id;

  -- 2. Looping Insert Jurnal (Membaca JSON dari Payload)
  FOR v_jl IN SELECT * FROM jsonb_array_elements(payload->'journal_lines') LOOP
    INSERT INTO public.journal_lines (transaction_id, account_id, debit)
    VALUES (v_tx_id, (v_jl->>'account_id')::UUID, (v_jl->>'debit')::NUMERIC);
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3. Modifikasi Modul Lapisan Luar (Hooks / Webhooks)
Jika ada fitur yang TIDAK krusial untuk integritas database (seperti mengirim notifikasi WA, mencatat analitik, dll), **JANGAN DIMASUKKAN KE RPC**.
Letakkan fitur tersebut di Node.js setelah panggilan RPC sukses. Ini menjaga agar RPC tidak bengkak dan kode tetap modular (mudah dirawat).

```typescript
const { data, error } = await supabase.rpc('create_purchase_transaction_v1', { payload })
if (error) throw error;

// Lapisan Luar (Non-ACID, tapi aman karena transaksi inti sudah selesai)
await sendTelegramNotification(data);
await pushWebhookToAccurate(data);
```

Dengan mematuhi pola ini, ShapeUp CRM mendapatkan **Performa In-Memory (Anti-Timeout)**, **Keamanan Transaksi (ACID)**, dan **Kemudahan Maintenance (Modular)** secara bersamaan.
