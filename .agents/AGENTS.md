# ShapeUp CRM — Development Rules

## API Route Standards

1. **Auth + Business Context:** Selalu gunakan `getApiContext()` dari `@/lib/apiContext.ts`. Jangan pernah duplikasi pola `createClient → getAuthUser → profiles.select` secara manual.

2. **Guest Customer:** Gunakan `resolveGuestCustomerId()` dari `@/lib/guestCustomer.ts`. Jangan buat admin client inline untuk resolve guest customer.

3. **Accounting Ledger:** Untuk order/penjualan gunakan `syncOrderToLedger()`. Untuk expense/purchases gunakan `ensureExpenseAccounts()` + manual journal lines.

4. **Journal Posting:** Gunakan `postJournalTransaction()` dari `@/lib/journalHelper.ts`. Set `skipExistingCheck=true` untuk new records.

5. **HPP Calculation:** Gunakan `calculateProductsHppBatch()` dari `@/lib/recipeHelper.ts`. Hasilnya sudah di-cache 60 detik.

6. **Unified User & Business Fetching:** Gunakan `fetchUserBusinessContext()` dari `@/lib/userBusinessHelper.ts` untuk memuat data profil user, daftar bisnis (assigned + owned), active business, serta role & permissions secara terpadu. Jangan buat kueri custom terpisah di komponen atau modul.

7. **Stock Movement Ledger:** Setiap kali ada transaksi mutasi stok (Pembelian, POS Orders, Stock Opname, Refund, Transfer), gunakan `recordStockMovements()` dari `@/lib/stockLedger.ts`. **KECUALI** untuk operasi masif yang rentan *timeout* (seperti Pembelian Besar), gunakan arsitektur *Semi-Modular RPC* (lihat skill `semi-modular-rpc`).

8. **Transactional ACID (Zero Tolerance):** Untuk operasi mutasi finansial lintas tabel (Jurnal + Stok + Transaksi) yang berjumlah masif, **WAJIB** menggunakan pola *Semi-Modular RPC*. Logika perhitungan disiapkan di Node.js dalam bentuk JSON *Payload*, lalu dikirim ke Supabase via RPC tunggal untuk dieksekusi dalam 1 blok `BEGIN...COMMIT`.

## Performance Rules

1. **No unnecessary DB queries:** Semua config/settings yang jarang berubah harus di-cache (loyalty settings, HPP recipes, accounts, profile).

2. **Parallel when possible:** Gunakan `Promise.all()` untuk DB queries yang tidak saling bergantung.

3. **Auth is JWT-first:** `getAuthUser()` membaca JWT dari cookie langsung (0ms) tanpa network call ke Supabase Auth, kecuali token expired.

4. **Cache invalidation:** Selalu panggil fungsi `invalidateXxxCache()` yang tersedia saat data terkait diupdate.

5. **Batch DB mutations:** Hindari *N+1 query*. Untuk update/insert data dalam jumlah kecil, gunakan `.in()` atau `upsert` bawaan Supabase. **DILARANG KERAS** menggunakan `Promise.all()` untuk mutasi masif lintas tabel (seperti update ratusan Stok & HPP sekaligus) karena ini memicu *Connection Pool Exhaustion* dan kegagalan sebagian (*Partial Failure*). Gunakan *Semi-Modular RPC* (skill `semi-modular-rpc`) untuk transaksi berat semacam ini.

6. **Immediate page fetching:** Di komponen *client-side*, jalankan *fetch API utama* seketika saat *mount* tanpa menunggu `loadProfile()`, karena API route sudah membaca otentikasi via cookie `getApiContext()`.

7. **Avoid N+1 in Cancellations (Order/Invoice):** Saat membatalkan (cancel) transaksi, **DILARANG KERAS** menggunakan perulangan manual (`for...of`) untuk mengembalikan stok di tabel `products` atau menyisipkan jurnal pembalikan secara serial di *API Route*. Cukup ubah status menjadi `cancelled`, lalu delegasikan kepada fungsi terpusat `syncOrderToLedger()` yang akan membalikkan stok secara massal (melalui `stock_moves` + *trigger*) dan menjurnal pembalikan secara efisien.

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

2. **Analysis vs Execution (Wait for Final Decision):** When the user asks to "analyze", "explore", or discuss a concept, DO NOT immediately modify the codebase or implement the feature. Present the analysis, document it in the relevant skills/knowledge files if requested, and wait for the user's explicit confirmation or "final decision" before writing or altering any operational code.

## React & TypeScript Standards

1. **TypeScript Strict-Null in Async Closures:** Saat menggunakan `useEffect` atau fungsi asynchronous untuk me-*load* data, pastikan keamanan tipe (Type-Safety) terkait objek yang bisa bernilai `null` (seperti *props* dokumen opsional). 
   - **JANGAN** mengakses properti objek secara langsung di dalam closure `async` (contoh: `document.id`), karena TypeScript akan gagal memvalidasi kenihilan (*nullness*) objek tersebut pada saat eksekusi asinkronus (menghasilkan *error*: *Object is possibly 'null'*).
   - **WAJIB** mengekstrak properti yang diperlukan ke dalam variabel konstan secara sinkronus *sebelum* memanggil/mendeklarasikan fungsi asinkronusnya. 
   - Contoh:
     ```tsx
     const docId = document?.id;
     if (docId) {
       async function fetchLedger() {
         const { data } = await supabase.from('...').eq('source_id', docId) // TS Lulus
       }
     }
     ```

## Localization & Date Formatting

1. **Database-Driven Timezone (Strict):** **DILARANG KERAS** menggunakan metode format tanggal bawaan JavaScript secara mentah (seperti `.toLocaleString()`, `.toLocaleDateString()`, `.toLocaleTimeString()`) pada komponen UI, karena ini mengacu pada waktu lokal browser perangkat pengguna.
   - **WAJIB** menggunakan fungsi `formatDisplayDate(date, mode, businessTimezone)` dari `@/lib/timeUtils.ts`.
   - *Timezone* wajib di-resolve berdasarkan settingan bisnis di tabel database (contoh: `activeBusiness.timezone` dari `useUserContext()`, atau di-fetch via relasi `businesses!active_business_id(timezone)`). Ini menjamin waktu transaksi selalu konsisten bagi manajer meskipun diakses dari perangkat di zona waktu berbeda.
