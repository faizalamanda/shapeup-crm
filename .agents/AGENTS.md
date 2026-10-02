# ShapeUp CRM — Development Rules

## API Route Standards

1. **Auth + Business Context:** Selalu gunakan `getApiContext()` dari `@/lib/apiContext.ts`. Jangan pernah duplikasi pola `createClient → getAuthUser → profiles.select` secara manual.

2. **Guest Customer:** Gunakan `resolveGuestCustomerId()` dari `@/lib/guestCustomer.ts`. Jangan buat admin client inline untuk resolve guest customer.

3. **Accounting Ledger:** Untuk order/penjualan gunakan `syncOrderToLedger()`. Untuk expense/purchases gunakan `ensureExpenseAccounts()` + manual journal lines.

4. **Journal Posting:** Gunakan `postJournalTransaction()` dari `@/lib/journalHelper.ts`. Set `skipExistingCheck=true` untuk new records.

5. **HPP Calculation:** Gunakan `calculateProductsHppBatch()` dari `@/lib/recipeHelper.ts`. Hasilnya sudah di-cache 60 detik.

6. **Unified User & Business Fetching:** Gunakan `fetchUserBusinessContext()` dari `@/lib/userBusinessHelper.ts` untuk memuat data profil user, daftar bisnis (assigned + owned), active business, serta role & permissions secara terpadu. Jangan buat kueri custom terpisah di komponen atau modul.

7. **Stock Movement Ledger:** Setiap kali ada transaksi mutasi stok (Pembelian, POS Orders, Stock Opname, Refund, Transfer), gunakan `recordStockMovements()` dari `@/lib/stockLedger.ts` untuk mencatat log mutasi secara permanen ke tabel `stock_moves`.

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

## Pagination & Table Data Standards

1. **Server-Side Sorting for Paginated Data:** Ketika mengimplementasikan fitur sorting pada semua tabel yang datanya dimuat secara bertahap (*paginated* dari server), pastikan sorting diaplikasikan di API / server (menggunakan `sortField` & `sortOrder`), bukan mengurutkan array pada komponen *client*. 
   - Gunakan `.order()` Supabase untuk kolom dasar (seperti *name*, *price*, *stock*).
   - Jika harus mengurutkan berdasarkan field kalkulasi (*computed fields*, contoh: Total Nilai) atau *foreign table* yang rumit, dan dataset per-bisnis diasumsikan wajar (beberapa ribu baris), *bypass* `.range()` di Supabase, tarik semua row hasil filter, lakukan *sorting array* di Node.js/Edge, lalu gunakan `.slice()` sebelum *return* response.

## Inventory & Reporting Standards

1. **Running Stock Balance (Stok Sistem):** **JANGAN PERNAH** menghitung running balance (`system_stock`) secara manual (forward/backward) menggunakan iterasi array di JavaScript. Gunakan selalu PostgreSQL View `v_stock_moves_ledger` yang telah menggunakan *Window Functions* untuk menjamin akurasi 100% dan performa maksimal, bahkan jika ada transaksi *backdate*. (Lihat skill `inventory-ledger` untuk panduan lengkapnya).

2. **Default Business Inventory Settings:** Saat bisnis baru dibuat atau belum memiliki konfigurasi integrasi custom, default sistem adalah:
   - **Trigger Pengurangan Stok Produk Physical**: `['shipped', 'completed']` (Dikirim & Selesai).
   - **Trigger Pembaruan Jurnal Item (HPP & Persediaan)**: `['shipped', 'completed']` (Dikirim & Selesai).
   - **Persentase Default HPP / HAP Produk Baru**: `0%`.

3. **Strict Setting-Driven Triggers:** Pengurangan stok dan jurnal HPP **WAJIB HANYA** terpicu berdasarkan status yang terdaftar di `stockReductionStatuses` dan `journalHppStatuses` hasil konfigurasi bisnis dari database/settings. **Dilarang keras** menumpuk *hardcoded fallback* (seperti `status === 'completed'`) secara manual di kode logika.


## Research & Planning

1. **Academic & Journal Approach:** Before proposing or executing major architectural changes or complex logic, ALWAYS conduct research and write planning artifacts using a rigorous academic/journal approach (Database Theory, Software Engineering Principles, CQRS, Normalization, etc.). Base your reasoning on established computer science concepts rather than purely practical hacks.
