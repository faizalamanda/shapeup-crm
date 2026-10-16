# ShapeUp CRM — Development Rules

## API Route Standards

1. **Auth + Business Context:** Selalu gunakan `getApiContext()` dari `@/lib/apiContext.ts`. Jangan pernah duplikasi pola `createClient → getAuthUser → profiles.select` secara manual.

2. **Guest Customer:** Gunakan `resolveGuestCustomerId()` dari `@/lib/guestCustomer.ts`. Jangan buat admin client inline untuk resolve guest customer.

3. **Accounting Ledger:** Untuk order/penjualan gunakan `syncOrderToLedger()`. Untuk expense/purchases gunakan `ensureExpenseAccounts()` + manual journal lines.
4. **Journal Posting & Anti-Duplikasi:** Gunakan `postJournalTransaction()` dari `@/lib/journalHelper.ts`. Dilarang mengasumsikan keberadaan `preloadedOrder` sebagai pesanan baru (`isNewOrder`). Selalu periksa existing transactions (`salesTx`, `paymentTx`) dari database dan set `skipExistingCheck=false` di `orderLedger.ts` agar transaksi Penjualan tidak pernah terduplikasi.

5. **HPP Calculation:** Gunakan `calculateProductsHppBatch()` dari `@/lib/recipeHelper.ts`. Hasilnya sudah di-cache 60 detik.

6. **Unified User & Business Fetching:** Gunakan `fetchUserBusinessContext()` dari `@/lib/userBusinessHelper.ts` untuk memuat data profil user, daftar bisnis (assigned + owned), active business, serta role & permissions secara terpadu. Jangan buat kueri custom terpisah di komponen atau modul.

7. **Stock Movement Ledger:** Setiap kali ada transaksi mutasi stok (Pembelian, POS Orders, Stock Opname, Refund, Transfer), gunakan `recordStockMovements()` dari `@/lib/stockLedger.ts`. **KECUALI** untuk operasi masif yang rentan *timeout* (seperti Pembelian Besar), gunakan arsitektur *Semi-Modular RPC* (lihat skill `semi-modular-rpc`).

8. **Transactional ACID (Zero Tolerance):** Untuk operasi mutasi finansial lintas tabel (Jurnal + Stok + Transaksi) yang berjumlah masif, **WAJIB** menggunakan pola *Semi-Modular RPC*. Logika perhitungan disiapkan di Node.js dalam bentuk JSON *Payload*, lalu dikirim ke Supabase via RPC tunggal untuk dieksekusi dalam 1 blok `BEGIN...COMMIT`.

9. **UUID Input Sanitization (PostgreSQL Zero-Tolerance):** Kolom bertipe PostgreSQL `UUID` (seperti `register_id`, `shift_id`, `customer_id`) akan mengalami *fatal crash* (`invalid input syntax for type uuid: ""`) jika menerima string kosong `""`. Destructuring ES6 `const { register_id = null } = body` **tidak akan memfilter** `""` karena string kosong adalah nilai yang *defined*.
   - **WAJIB (Backend):** Selalu gunakan helper `isUuid(val) ? val : null` sebelum memasukkan foreign key UUID ke kueri Supabase/PostgreSQL.
   - **WAJIB (Frontend):** Jangan kirim string kosong `""` untuk field ID/UUID opsional ke endpoint API; selalu kirim `val || null`.

10. **Vercel Safe JSON & Number Parsing:**
   - Selalu bungkus `await request.json()` dalam `try...catch` atau `.catch(() => null)` untuk mencegah unhandled `SyntaxError` di Vercel saat body kosong/rusak.
   - Parameter query numerik (`page`, `limit`) wajib divalidasi dengan `Number.isFinite(parseInt(...))` untuk mencegah nilai `NaN` merusak rentang `.range()` di Supabase.
   - String pencarian di PostgREST `.or(...)` wajib membersihkan karakter delimiter sintaks `,` dan `()`.

11. **PostgreSQL Views RLS (`security_invoker = true`):**
   - Setiap PostgreSQL View yang dibuat di Supabase wajib menyertakan `WITH (security_invoker = true)` agar aturan RLS tabel asal ditegakkan otomatis berdasarkan identitas pemanggil (`auth.uid()`), dipadukan dengan filter `.eq('business_id', businessId)` di API Route.

12. **Authentication & Password Recovery Standards:**
   - Alur pemulihan kata sandi (`forgotPasswordAction`) wajib mendeteksi host/protokol secara dinamis via request headers (`x-forwarded-host`, `x-forwarded-proto`) dengan fallback `NEXT_PUBLIC_SITE_URL` agar tautan reset password selalu valid di semua domain/environment.
   - Route callback PKCE (`app/auth/callback/route.ts`) yang menerima `next.startsWith('/reset-password')` wajib mengalihkan kegagalan kode ke `/forgot-password?error=...` dengan pesan ramah bahasa Indonesia.
   - Halaman `/forgot-password` wajib masuk `isAuthRoute` di `middleware.ts`, sedangkan `/reset-password` **DILARANG** dimasukkan ke `isAuthRoute` (agar sesi pemulihan tidak ter-redirect sebelum pengguna sempat mengganti password) dan tidak dimasukkan ke `isProtectedRoute`.

13. **Universal Password Input Visibility Standard (Tombol Mata):**
   - Setiap kolom input kata sandi di seluruh antarmuka aplikasi (Login, Register, Reset Password, Pengaturan Staf) **WAJIB** menyertakan tombol mata (*Show/Hide Password*) dengan state `showPassword` (`type={showPassword ? 'text' : 'password'}`), padding kanan yang proporsional (`pr-12`), dan atribut aksesibilitas (`tabIndex={-1}`, dinamis `aria-label`).
   - Formulir pembuatan/reset kata sandi baru wajib menyertakan validasi real-time (panjang minimal 6 karakter dan indikator kecocokan konfirmasi password).


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

4. **Database-Driven Multi-Bucket & Isolation:** Stok barang wajib dipisahkan via kolom relasional `bucket` di tabel `stock_moves` (`'main'`, `'quarantine'`, `'in_transit'`). Hanya mutasi dengan `status === 'done' AND bucket === 'main'` yang boleh mempengaruhi saldo on-hand fisik rak gudang (`system_stock` dan `products.stock_quantity`). Barang retur dicatat ke `bucket === 'quarantine'` dengan `status === 'done'` tanpa mencemari stok siap jual rak gudang.

5. **Pure Append-Only (Zero UPDATE on Historical Moves):** Dilarang keras melakukan `UPDATE` pada baris pergerakan stok historis (Event Sourcing). Ketika barang di karantina diproses:
   - **Aksi Terima:** Insert mutasi penyeimbang keluar karantina (`bucket: 'quarantine'`, `type: 'transfer'`, `-qty`) DAN insert mutasi penerimaan ke gudang utama (`bucket: 'main'`, `type: 'receipt'`, `+qty`) pada timestamp riil saat ini.
   - **Aksi Hilang:** Insert mutasi penyeimbang penghapusan karantina (`bucket: 'quarantine'`, `type: 'adjustment'`, `-qty`) pada timestamp riil saat ini dan posting jurnal beban kerugian.
   - Baris asal kedatangan karantina tetap 100% utuh selamanya sebagai jejak audit permanen.

6. **Semantic Location for Order Returns:** Mutasi pengembalian barang pesanan batal/retur (`source_type === 'order'`) **DILARANG KERAS** dilabeli sebagai penerimaan dari Pemasok/Vendor. Secara semantik, asal barang adalah `Transit Pelanggan (Retur)` menuju `Karantina Retur` sampai barang resmi diterima fisik di gudang aktif.


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

2. **Strict UTC Ingestion for Webhooks & Third-Party Integrations:**
   Setiap data waktu dari webhook pihak ketiga (seperti WooCommerce `date_created`, `date_paid`) yang berupa string waktu lokal tanpa penanda zona waktu (`+07:00` atau `Z`), **WAJIB** dikonversi atau disematkan offset zona waktu sebelum disimpan ke kolom PostgreSQL bertipe `TIMESTAMPTZ` (seperti `orders.order_date`, `transactions.date`). Lebih diutamakan selalu menggunakan field GMT/UTC murni (contoh: `woo.date_created_gmt + 'Z'`) agar tersimpan sebagai UTC sejati di basis data dan terhindar dari pergeseran ganda (*Double Timezone Shift* +7 jam) saat diformat ke zona waktu bisnis di antarmuka.

3. **Unified Sales & HPP Journal Trigger & Date Basis (`journalHppStatuses`):**
   Tanggal pencatatan dan penerbitan transaksi jurnal penjualan & HPP di buku besar akuntansi dikendalikan secara tunggal (*Single Source of Truth*) melalui **Setting No. 2 (`global_journal_hpp_status` / `journal_hpp_status`)**:
   - Jika konfigurasi mencakup status proses operasional/lanjutan (`'processing'`, `'shipped'`, `'completed'`), jurnal diterbitkan dan diberi penanggalan sesuai waktu aktual kejadian operasional (waktu verifikasi pembayaran / `date_paid` atau mutasi gudang / `updated_at`).
   - Jika konfigurasi hanya mencakup status awal (`'pending'`), jurnal diterbitkan dan diberi penanggalan sesuai waktu checkout pemesanan awal (`order_date_utc` / `order_date`).
   Fungsi orkestrasi `syncOrderToLedger()` wajib menggunakan `journalHppStatuses` sebagai acuan tunggal terpadu tanpa memerlukan pengaturan redundan terpisah.

## POS & Payment Ledger Standards

1. **Strict POS Session Gating:** Setiap transaksi kasir (checkout POS, pembayaran cicilan, dan void pembayaran) **WAJIB** memvalidasi keberadaan shift kasir aktif (`pos_shifts.status = 'open'`) milik pengguna. Jika shift belum dibuka, API wajib mengembalikan HTTP 403 Forbidden.

2. **Single Source of Truth (`order_payments`):** Riwayat transaksi pembayaran pesanan **WAJIB** dibaca dan disimpan melalui tabel `order_payments`, bukan mengandalkan string `payment_method` atau `raw_source_data` semata.

3. **Pure Append-Only Payment Ledger (Zero DELETE):** Dilarang keras melakukan `DELETE` atau menghapus baris di `order_payments`. Untuk pembatalan pembayaran (void), insert baris kompensasi dengan `payment_kind = 'void'` dan hubungkan ke `voided_payment_id`. Untuk refund pesanan, insert baris dengan `payment_kind = 'refund'` dan atribusikan ke shift kasir yang mengeluarkan kas aktual (`current_shift_id`).

4. **Floating Cashier Reconciliation & Over/Short Posting:** Saat kasir menutup shift, sistem wajib menghitung `expected_cash` secara dinamis. Jika ada selisih kas fisik vs sistem, wajib memposting jurnal selisih kas otomatis ke akun `503000 Beban Selisih Kas` atau `403000 Pendapatan Selisih Kas`.

5. **Orchestrator vs Payment Engine Synergy:**
   - Untuk siklus hidup pesanan utuh (pesanan baru atau perubahan status pesanan di POS, Invoice, WooCommerce Webhook, Accurate ERP, dan Order Manual), **WAJIB** mendelegasikan ke `syncOrderToLedger()` dari `@/lib/orderLedger.ts` (mengurus mutasi stok + HPP + pengakuan penjualan + pencatatan kas pembayaran awal).
   - Untuk pembayaran susulan (pelunasan cicilan / DP sisa tagihan) dan pembatalan baris bayar (void), **WAJIB** menggunakan `recordOrderPayment()` / `voidOrderPayment()` dari `@/lib/paymentLedger.ts` (murni mutasi kas & piutang tanpa menyentuh stok/penjualan ulang).

6. **Two-Dimensional Order Lifecycle (Separation of Concerns):**
   Status pesanan memiliki 2 dimensi independen yang terpisah:
   - *Fulfillment / Operational Status* (`orders.status`): `pending`, `processing`, `shipped`, `completed`, `cancelled`.
   - *Financial / Settlement Status* (`orders.payment_status`): `unpaid`, `partial`, `paid`.
   **DILARANG KERAS** menyamakan `status === 'completed'` sebagai satu-satunya indikator pesanan lunas.

7. **Omnichannel Payment Settlement Rule (Online Non-COD vs COD):**
   - **Pesanan Non-COD (Transfer Bank, Gateway, QRIS, Kartu Kredit):** Pelanggan membayar di muka (*upfront payment*). Ketika pesanan berstatus `processing`, `shipped`, atau `completed`, atau memiliki timestamp `raw_source_data.date_paid`, status pembayaran **WAJIB** diakui sebagai **`paid` (Lunas)** dan saldo piutang lunas (`amount_paid = grand_total`), serta dicatatkan baris kas masuk di `order_payments`.
   - **Pesanan COD (Bayar di Tempat):** Saat pesanan berstatus `processing` atau `shipped`, status pembayaran adalah **`unpaid` (Belum Bayar)**. Pembayaran baru diakui sebagai **`paid`** setelah pesanan resmi berstatus **`completed`** (kurir menyerahkan uang kas/remitansi).

8. **Automatic Payment Status Synchronization in `syncOrderToLedger()`:**
   Setiap kali `syncOrderToLedger()` memproses pembayaran pesanan, sistem **WAJIB** menyelaraskan kolom `orders.payment_status` dan `orders.amount_paid` serta menjamin baris pembayaran tersimpan di `order_payments` agar tab Riwayat Pembayaran pada antarmuka pengguna tidak pernah kosong atau terputus dari jurnal akuntansi.

9. **Cross-Shift Tender Separation & Cash Attribution:**
   Uang masuk (Pelunasan Piutang) dan uang keluar (Refund Kasir) atas pesanan historis **WAJIB** diatribusikan ke shift kasir aktif saat ini (`shift_id: activeShift.id`). Dalam pelaporan rincian shift (Z-Report), penerimaan kas **WAJIB** dipisahkan secara teraudit antara `cash_sales` (penjualan shift ini), `cash_ar_collections` (pelunasan piutang), dan `cash_refunds`.

10. **Unified Post-Purchase Exchange & Partial Debt Settlement:**
   Penukaran barang (Exchange) menggunakan event sourcing independen (`sourceType: 'order_exchange'`, `sourceId: exchangeId`) untuk menghindari tabrakan PostgreSQL unique constraint. Jika pesanan bertipe cicilan/DP (`amount_paid < grand_total`) dan nilai tukar turun ($\Delta < 0$), kasir dilarang mengeluarkan uang tunai jika saldo terbayar $\le$ total baru; selisih harga wajib memotong sisa piutang secara otomatis.




