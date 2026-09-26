# ShapeUp CRM — Development Rules

## API Route Standards

1. **Auth + Business Context:** Selalu gunakan `getApiContext()` dari `@/lib/apiContext.ts`. Jangan pernah duplikasi pola `createClient → getAuthUser → profiles.select` secara manual.

2. **Guest Customer:** Gunakan `resolveGuestCustomerId()` dari `@/lib/guestCustomer.ts`. Jangan buat admin client inline untuk resolve guest customer.

3. **Accounting Ledger:** Untuk order/penjualan gunakan `syncOrderToLedger()`. Untuk expense/purchases gunakan `ensureExpenseAccounts()` + manual journal lines.

4. **Journal Posting:** Gunakan `postJournalTransaction()` dari `@/lib/journalHelper.ts`. Set `skipExistingCheck=true` untuk new records.

5. **HPP Calculation:** Gunakan `calculateProductsHppBatch()` dari `@/lib/recipeHelper.ts`. Hasilnya sudah di-cache 60 detik.

## Performance Rules

1. **No unnecessary DB queries:** Semua config/settings yang jarang berubah harus di-cache (loyalty settings, HPP recipes, accounts, profile).

2. **Parallel when possible:** Gunakan `Promise.all()` untuk DB queries yang tidak saling bergantung.

3. **Auth is JWT-first:** `getAuthUser()` membaca JWT dari cookie langsung (0ms) tanpa network call ke Supabase Auth, kecuali token expired.

4. **Cache invalidation:** Selalu panggil fungsi `invalidateXxxCache()` yang tersedia saat data terkait diupdate.

5. **Batch DB mutations:** Untuk update stok & HPP multi-item (seperti Pembelian/Purchases), agregasikan item berdasarkan `product_id` dan gunakan `.in('id', productIds)` + `Promise.all()` (hindari *N+1 query* sekuensial).

6. **Immediate page fetching:** Di komponen *client-side*, jalankan *fetch API utama* seketika saat *mount* tanpa menunggu `loadProfile()`, karena API route sudah membaca otentikasi via cookie `getApiContext()`.

## Code Style

- Bahasa UI/error messages: **Indonesia**
- Bahasa kode/variabel/comments: **English**  
- Semua monetary values: **IDR (no decimal)**
