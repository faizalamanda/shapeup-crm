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
   - Alur pemulihan kata sandi (`forgotPasswordAction`) wajib mengarahkan `redirectTo` **langsung** ke `${origin}/reset-password` (bukan `/auth/callback`) karena Supabase menyematkan token pemulihan dalam bentuk *hash fragment* (`#access_token=...&type=recovery`) yang hanya dapat dibaca oleh browser klien. Resolusi host/protokol wajib dinamis via request headers (`x-forwarded-host`, `x-forwarded-proto`) dengan fallback `NEXT_PUBLIC_SITE_URL`.
   - Route callback (`app/auth/callback/route.ts`) yang menerima `next.startsWith('/reset-password')` tanpa parameter `code` wajib meneruskan pengalihan (*forward redirect*) ke target destination `${targetOrigin}${next}` agar browser tetap mempertahankan *hash fragment* token.
   - Halaman `/reset-password` wajib langsung mengekstrak token dari `window.location.hash` dan memanggil `supabase.auth.setSession(...)` secara instan.
   - Halaman `/forgot-password` wajib masuk `isAuthRoute` di `middleware.ts`, sedangkan `/reset-password` **DILARANG** dimasukkan ke `isAuthRoute` (agar sesi pemulihan tidak ter-redirect sebelum pengguna sempat mengganti password) dan tidak dimasukkan ke `isProtectedRoute`. Di `UserContext.tsx`, `isPublicRoute` wajib menggunakan `.startsWith()` (`/forgot-password`, `/reset-password`, `/auth`).
   - **Email Mutation Protocol (Zero-Retry & 15s Timeout):** Operasi pengiriman email Supabase (`/recover`, `/signup`, `/otp`, `/invite`, `/resend`, `/magiclink`) wajib memiliki batas waktu yang memadai (**15 detik**) untuk mengakomodasi durasi *synchronous handshake* relay SMTP (~4–5 detik), ekstraksi URL yang tangguh (`getUrlString` dari `Request.url`), dan **DILARANG KERAS** melakukan *auto-retry* (`maxRetries = 0`) agar tidak memicu batas laju Supabase (`over_email_send_rate_limit: 60 seconds`).
   - **Form Locking & Graceful Rate Limit UX:** Input formulir wajib langsung dikunci (`disabled={loading}`) dengan proteksi sinkronus `isSubmittingRef.current = true`. Jika terkena batas frekuensi 60 detik Supabase, tangani secara anggun sebagai konfirmasi sukses (`alreadySent: true`) dengan timer hitung mundur 60 detik sebelum tombol kirim ulang aktif, bukan menampilkan error merah yang membingungkan.

13. **Universal Password Input Visibility Standard (Tombol Mata):**
   - Setiap kolom input kata sandi di seluruh antarmuka aplikasi (Login, Register, Reset Password, Pengaturan Staf) **WAJIB** menyertakan tombol mata (*Show/Hide Password*) dengan state `showPassword` (`type={showPassword ? 'text' : 'password'}`), padding kanan yang proporsional (`pr-12`), dan atribut aksesibilitas (`tabIndex={-1}`, dinamis `aria-label`).
   - Formulir pembuatan/reset kata sandi baru wajib menyertakan validasi real-time (panjang minimal 6 karakter dan indikator kecocokan konfirmasi password).

14. **Tenant Ownership vs Functional RBAC Standard (User Utama vs Staf):**
   - **Pemisahan Hierarki Kepemilikan (*Separation of Concerns*):** Peran fungsional di unit bisnis (`role: 'admin' | 'staff'`) **TIDAK SAMA** dengan kepemilikan akun bisnis (*Tenant Ownership*).
   - **User Utama (Account/Business Owner):** Pengguna yang memiliki minimal 1 bisnis (`businesses.owner_id = user.id`) atau pendaftar baru yang belum memiliki penugasan staf. Hanya User Utama yang memiliki wewenang untuk membuat unit/cabang bisnis baru (`POST /api/business`), mengelola unit, atau menghapus bisnis.
   - **Staf (Delegated Team Member):** Pengguna yang terdaftar di tabel `business_staff` milik orang lain (`businesses.owner_id != user.id`). Meskipun staf tersebut diberikan wewenang `role = 'admin'` di unit bisnis terkait (misal: Admin Cabang/Keuangan), status hierarkisnya tetaplah staf.
   - **Aturan Dropdown & Pembuatan Bisnis:**
     - Seluruh unit bisnis tempat staf ditugaskan **WAJIB** tampil di dropdown bisnis (didukung RLS Policy `"Staff can view assigned businesses"` pada `public.businesses` dan resilient fallback di `userBusinessHelper.ts`).
     - Akun staf **DILARANG KERAS** membuat bisnis baru. Tombol `➕ Buat Bisnis Baru` wajib diproteksi dengan kondisi `isOwner === true` (bukan `role === 'admin'`). Tombol `⚙️ Kelola Bisnis` hanya dapat diakses oleh `isOwner` atau staf berwewenang `currentUserRole === 'admin'` untuk mengelola profil cabang yang aktif tanpa hak membuat cabang baru.
     - Endpoint `POST /api/business` wajib memvalidasi kepemilikan dan mengembalikan `403 Forbidden` jika dipanggil oleh akun staf (`!isOwner && isStaff`).
   - **Hardening RPC `SECURITY DEFINER`:** Setiap fungsi database berstatus `SECURITY DEFINER` yang menerima parameter `p_business_id` (seperti fungsi analitik atau laporan) **WAJIB** menyertakan guard klausul di awal fungsi untuk memverifikasi bahwa pemanggil (`auth.uid()`) adalah pemilik (`owner_id`) atau staf resmi (`business_staff`) dari `p_business_id` tersebut.
   - **Staff Self-Service Settings vs Admin Business Hierarchy:**
     - Staf wajib memiliki akses mandiri ke rute `/settings/staff` untuk mengubah kata sandi akunnya sendiri dan mengatur PIN Otorisasi POS (jika ditunjuk sebagai Approver).
     - Rute `/settings/staff` wajib diizinkan di `canAccessPath()`, namun seluruh rute setting unit/bisnis (`/settings/business`, `/settings/pos`, `/settings/inventory`, `/settings/integrations`) wajib diblokir ketat khusus Owner & Admin (`role === 'admin' || permissions.includes('full_access')`).
     - Layout sidebar utama (`app/layout.tsx`) secara dinamis mengarahkan tombol Settings ke `/settings/business` untuk Owner/Admin dan ke `/settings/staff` untuk Staf.
     - Submenu internal `SettingsLayout.tsx` secara dinamis hanya menampilkan kelompok "Akun & Keamanan" bagi Staf, dan menyembunyikan seluruh submenu bisnis.

15. **Robust Multi-Tenant RLS Policy for Shifts & Accounting Operations:**
   - Kebijakan RLS tabel multi-tenant (`accounts`, `pos_shifts`, `pos_shift_movements`, `order_payments`, `transactions`) **DILARANG KERAS** hanya mengandalkan kolom tunggal `profiles.active_business_id = business_id`.
   - **WAJIB** menyertakan klausul union:
     `business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid() UNION SELECT business_id FROM business_staff WHERE profile_id = auth.uid()) OR business_id = (SELECT active_business_id FROM profiles WHERE id = auth.uid())`
     Hal ini menjamin staf yang ditugaskan di unit bisnis tidak pernah mengalami kegagalan RLS (*403 / zero rows returned*) saat membuka shift kasir atau menjurnal akun operasional meskipun ada latensi sinkronisasi pada profil pengguna.


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

7. **Bulk Product Deletion & Multi-Tenant Ledger Isolation:** Operasi penghapusan produk massal (baik via seleksi maupun *purge all*) **WAJIB** menerapkan isolasi *multi-tenant* yang ketat (`business_id = p_business_id`).
   - **Hirarki Hak Akses (RBAC):**
     - **Hapus Terpilih / Satuan:** Hanya dapat diakses oleh **Owner**, **Admin**, atau staf dengan izin `manage_products` / `full_access`.
     - **Hapus SEMUA Produk (Total Purge):** Wajib dikunci ketat khusus **Owner** dan **Admin**. Staf biasa dilarang keras mereset seluruh katalog produk.
   - **Perlindungan Riwayat Stok:** Produk yang telah memiliki catatan di `stock_moves` dilindungi oleh *foreign key constraint*. Secara default, sistem **WAJIB MENOLAK** penghapusan produk yang memiliki riwayat mutasi stok untuk menjaga keutuhan buku besar gudang.
   - Jika pengguna secara sadar mengaktifkan *forceStockCleanup*, sistem harus menghapus `inventory_stock_summary` dan `stock_moves` milik produk tersebut sebelum menghapus baris di `products`, dalam ruang lingkup unit bisnis aktif saja.
   - Dilarang keras menyentuh tabel `businesses` atau entitas milik bisnis/user lain selama proses pembersihan produk.

8. **Enterprise Bulk Product & Stock Import Standards:**
   - **SKU-First Deduplication:** Jika baris memiliki SKU, pencocokan duplikasi **HANYA** membandingkan `sku`. Dilarang mencocokkan nama agar tidak menggabungkan varian produk yang berbeda (*variant collapse*). Pencocokan nama hanya diperbolehkan sebagai fallback jika SKU tidak diisi.
   - **Default Tracked Physical Stock:** Produk fisik secara baku wajib berstatus `stock_type = 'tracked'` (Lacak Stok) dan jumlah stok fisik awal tidak boleh di-nol-kan.
   - **Event-Sourced Stock Movements on Update & Insert:** Setiap penambahan produk baru dengan stok > 0 wajib mencatat `stock_moves` (`STOK-AWAL-IMPORT`). Setiap update produk yang mengubah saldo stok fisik (`duplicateAction = 'update'`) wajib mencatat `stock_moves` penyesuaian (`PENYESUAIAN-STOK-IMPORT`) dengan penanda `origin_location_id` (null jika penambahan, dummy UUID jika pengurangan) agar trigger database `trg_sync_product_stock_from_moves` tidak membalikkan saldo stok historis.
   - **Bypass 1.000 PostgREST Limit:** Tampilan katalog produk (`/products`) wajib memuat seluruh data secara bertahap menggunakan chunked `.range()` untuk menjamin katalog besar (> 4.000 produk) tampil utuh tanpa terpotong batas bawaan server Supabase.
   - **Fault-Isolated Batch Processing & Audit Trail:** Proses impor wajib memproses chunk terisolasi (100 baris/batch) dan menyediakan fitur unduh data gagal (.xlsx) berisikan nomor baris dan alasan kegagalan spesifik.


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

11. **Isolated & Dual-Mode Thermal Receipt Printing Standard (Zero Screen Clutter & Zero PWA Exit):**
   Pencetakan struk kasir thermal (POS) **DILARANG KERAS** memanggil `window.print()` langsung pada jendela browser utama yang sedang menampilkan modal atau elemen antarmuka layar.
   - **Arsitektur Dual-Mode:** Sistem mendukung dua metode koneksi terpadu melalui `printerAdapter.ts`:
     - **Direct Web Bluetooth (BLE Instan):** Menggunakan Web Bluetooth API (`navigator.bluetooth`) dan generator biner ESC/POS murni untuk mencetak seketika (0.2s) dari dalam PWA tanpa keluar aplikasi dan tanpa memerlukan aplikasi perantara pihak ketiga (seperti RawBT) sehingga 100% bebas watermark. Dilengkapi auto-fallback ke printer sistem jika koneksi gagal/terputus.
     - **Printer Sistem (Desktop USB / Fallback Spooler):** Menggunakan modul cetak terisolasi via *Hidden Iframe* (`printReceiptViaIframe()` dari `@/lib/pos/printerAdapter.ts`) dengan `@page { size: ...; margin: 0; }`. Sangat optimal untuk PC kasir dengan kabel USB (mendukung Kiosk Silent Print `--kiosk-printing`).
   - **Standar Tipografi & Anti-Wrap:**
     - Menggunakan font Clean Modern Sans-Serif (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`) menggantikan font monospace/Courier kaku agar hasil cetak tajam, rapat, dan modern.
     - **Dilarang menyertakan awalan `Rp `** pada baris harga item, subtotal, diskon, grand total, bayar, dan kembalian di kertas 58mm/80mm agar nominal harga tidak pernah patah baris (*wrapping*).
     - **Format Tanggal Ringkas:** Selalu gunakan mode `'receipt'` pada `formatDisplayDate(date, 'receipt', timezone)` yang menghasilkan format kompak `DD-MM-YYYY HH:mm` tanpa imbuhan zona waktu (WIB) agar pas 1 baris utuh.
     - **Universal Normal Weight & Zero-Bold Standard (Anti-Bleed):** Dilarang keras menggunakan teks tebal (*bold* / `font-weight: 600/700`) dan perintah ESC/POS emphasized mode (`0x1B, 0x45, 0x01`) pada template cetak struk untuk mencegah pelebaran tinta (*thermal ink bleeding*) dan teks buram pada roll 58mm/80mm. Komponen pratinjau di layar (`ReceiptPreviewModal.tsx` dan `ReceiptSettingsModal.tsx`) wajib meniadakan kelas `font-bold` dan `font-semibold` agar selalu selaras 100% (*WYSIWYG*) dengan fisik hasil cetak.
   - Area cetak efektif fisik thermal: Roll 58mm $\rightarrow$ `48mm` (384 dots); Roll 80mm $\rightarrow$ `72mm` (576 dots).
   - Seluruh komponen modal kasir wajib diproteksi ganda dengan kelas `.no-print` dan CSS `@media print` fallback agar tidak pernah merender backdrop, header modal, tombol dropdown ukuran kertas, tombol silang, alert status, atau tombol aksi cetak/tutup ke kertas thermal.

12. **PWA Dynamic Auto-Rotate & Landscape Safe-Area Inset Standards (Zero Notch Occlusion):**
   - Web App Manifest (`public/manifest.json`) **WAJIB** menggunakan konfigurasi `"orientation": "any"` (dilarang mengunci dengan `"portrait-primary"`), sehingga aplikasi dapat berputar bebas ke mode lanskap mengikuti sensor akselerometer saat fitur *Auto-Rotate* diaktifkan oleh pengguna pada sistem operasi perangkat (Android / iOS).
   - Dokumen HTML **WAJIB** menyertakan meta viewport `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` terpusat melalui helper `PWAHead` di `app/layout.tsx` pada semua jalur render layout (termasuk halaman non-sidebar).
   - Seluruh kontainer kerja layar penuh (Layout Utama, Register Kasir `POSWorkspace`, dan `POSHub`) **WAJIB** menyertakan padding safe area horizontal:
     `paddingLeft: 'env(safe-area-inset-left, 0px)'` dan `paddingRight: 'env(safe-area-inset-right, 0px)'`
     agar header, tombol aksi, dan elemen navigasi tidak pernah terpotong atau tertutup secara visual oleh poni (*notch*), kamera depan (*punch-hole*), atau *Dynamic Island* saat smartphone ditaruh di *stand* meja dalam orientasi horizontal.

13. **Unified POS Receipt Engine & World-Class Layout Standards (Single Source of Truth):**
   - **Unified Data Normalizer (`buildReceiptDataFromOrder`):** Seluruh pemicu cetak dan pratinjau struk kasir (Checkout POS, Layanan Nota & Piutang `POSOrderDetailModal`, Riwayat Pesanan, Quick Direct Print `POSHub`, dan Cetak Ulang Shift `ShiftDetailModal`) **WAJIB** menggunakan `buildReceiptDataFromOrder()` dari `@/lib/pos/receiptDataBuilder.ts`. Dilarang keras memetakan field `ReceiptData` secara manual atau parsial di komponen UI.
   - **Dukungan Struk Piutang & Cicilan:** Struk pesanan tempo/cicilan wajib mencantumkan status penagihan (`STATUS: BELUM LUNAS`), total dibayar, dan sisa piutang (`SISA PIUTANG: ...`) jika memiliki saldo terutang (`outstandingAmount > 0`), atau `STATUS: LUNAS` jika sudah terbayar penuh.
   - **World-Class Bottom Placement for Order Notes:** Catatan global pesanan (`orderNote`) **WAJIB** diposisikan di bagian bawah struk tepat setelah rincian pembayaran & status piutang (dan sebelum Loyalty Rewards & Footer Kebijakan Toko). Dilarang menempatkan catatan global di bagian header/metadata atas agar tidak mengaburkan daftar barang belanjaan pada kertas roll 58mm/80mm.
   - **Zero-Drift WYSIWYG Previews:** Pratinjau modal (`ReceiptPreviewModal.tsx`) dan live preview pengaturan struk (`ReceiptSettingsModal.tsx`) **WAJIB** merender langsung HTML dari `generateReceiptHtml()` via sandboxed iframe terisolasi. Dilarang menduplikasi markup JSX tersendiri yang memicu deviasi visual antara layar dan hasil cetak fisik.

14. **Universal POS Workspace Layout & Cashier UX Standards (Indonesian Industrial Benchmark):**
   - **Anti-Clipping Minimum Width:** Panel keranjang pada tablet & desktop split-screen (`md:`) minimal `w-[320px] - w-[340px]` dengan `overflow-hidden` dan `min-w-0` pada flex container, untuk menjamin nominal harga IDR 6-7 digit, kuantitas, ikon pensil, dan tombol aksi pas tanpa terpotong (*zero clipping*).
   - **Adaptive Multi-Column Catalog Density:** Katalog produk wajib menggunakan grid adaptif (`grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6`) agar pada monitor widescreen (1080p/1440p) kartu produk tidak melar dan tidak menyisakan ruang kosong yang mubazir.
   - **Lean Receipt Bill Summary:** Baris teks `TOTAL` duplikat dilarang; nominal grand total akhir disatukan langsung ke dalam tombol checkout `[ Bayar • Rp ... → ]`. Baris `Diskon Global` dipisahkan secara murni dari diskon item (`globalDiscountAmount > 0`), dan baris rincian redundan (seperti potongan item per-satuan) ditiadakan dari ringkasan bawah agar kasir memiliki ruang vertikal yang lega.
   - **Cashier Primary Action Color Psychology:** Tombol checkout utama "Bayar" **WAJIB** menggunakan warna solid berbobot tinggi: **Royal Blue (`bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white`)** dengan kontras chip nominal `bg-blue-800/50`. DILARANG KERAS menggunakan warna pink, magenta, atau gradien pastel yang mengurangi keterbacaan kasir.
   - **Item Auto-Wrap & Full-Width Notes:** Nama produk panjang pada struk keranjang wajib menggunakan `line-clamp-2 break-words` agar tidak memotong kolom harga di sebelah kanan. Catatan item wajib berbentuk balok penuh (*full-width block*) di bawah baris harga dengan `break-words whitespace-normal` tanpa terpotong ellipsis (`...`).

15. **Manager Price Guard, Omnichannel Discount Gating & Atomic Commit Standards:**
   - **Zero-Knowledge HPP:** Kasir **DILARANG KERAS** melihat nominal numerik HPP (*cost price*) atau angka harga minimum di antarmuka kasir. Evaluasi batas margin dihitung di memori komponen dan hanya menampilkan notifikasi minimal `⚠️ Harga di bawah batas minimum`.
   - **Otorisasi Personal & Rate-Limited PIN:** Approver PIN (6 digit) disimpan dengan salt kriptografis scrypt di `pos_approver_pins` dan proteksi lockout (5x salah berturut-turut $\rightarrow$ akun terkunci 5 menit).
   - **Atomic Auto-Commit & Auto-Dismiss:** Saat otorisasi berhasil divalidasi, payload otorisasi dan nilai diskon global / harga bersih baru **WAJIB langsung di-commit secara atomik ke state keranjang belanja** di dalam `onSuccessCallback`, dan kedua modal langsung tertutup bersamaan (*auto-dismiss*) tanpa klik ekstra (0 redundant click). Dilarang keras menutup modal tanpa meng-commit nilai diskon.
   - **Re-Authorization on Modification:** Mengubah nilai atau tipe diskon global (`isValueChanged === true`), atau menurunkan harga bersih item lebih rendah daripada harga yang telah disetujui sebelumnya (`netUnitPrice < previousApprovedPrice`), otomatis membatalkan otorisasi lama dan mewajibkan otorisasi ulang dari manajer/approver.
   - **Server-Side Enforcement:** Endpoint `POST /api/pos/order` memvalidasi ulang seluruh baris pesanan terhadap HPP dan status otorisasi di database. Transaksi dengan harga di bawah HPP yang belum diotorisasi ditolak dengan HTTP 422.

16. **POS Held Orders Lifecycle, In-Place Upsert & Auto-Cleanup Standards:**
   - **State Tracking (`activeHoldId`):** Setiap transaksi hold yang di-resume oleh kasir **WAJIB** dilacak dengan state `activeHoldId`. Komponen keranjang kasir wajib menampilkan indikator visual aktif ("Mengedit Draft Hold") serta mengubah label tombol Hold menjadi "Update Hold" dengan aksen amber.
   - **In-Place Upsert (Zero Duplication):** Menyimpan kembali transaksi yang sedang aktif wajib menyertakan `hold_id` dan dieksekusi via `.update(...)` pada baris yang sama di tabel `pos_held_orders` (dilarang melakukan `.insert()` duplikat). Kolom `created_at` diperbarui ke waktu sekarang (`now()`) agar draf terbaru naik ke urutan teratas.
   - **Tenant-Isolated Admin Client (`dbClient = supabaseAdmin || supabase`):** Endpoint `/api/pos/hold` wajib menggunakan fallback `supabaseAdmin` dengan pembatasan ketat `.eq('business_id', businessId)` untuk menjamin integritas transaksi draf tidak pernah gagal akibat latensi sinkronisasi sesi profil pengguna (`profiles.active_business_id`).
   - **Auto-Cleanup on Settlement (Zero Orphan Drafts):** Ketika transaksi kasir berhasil diselesaikan/dibayar hingga cetak struk, sistem wajib secara otomatis menghapus hold terkait dari database via *fire-and-forget background delete* tanpa menambah latensi kasir (0ms latency).
   - **Parallel Initial Loading:** Pengambilan daftar pesanan tertahan (`GET /api/pos/hold`) wajib dimasukkan ke dalam `Promise.all` saat inisialisasi awal kasir (`POSWorkspace.tsx`) agar daftar draf langsung tampil tanpa memperpanjang waktu loading.

17. **POS Dual Split Engine, Split Tender & Accounting Asset Account Binding Standards:**
   - **Direct General Ledger Asset Binding:** Setiap baris tender pembayaran di kasir POS **WAJIB** terikat langsung ke akun Aset Kas & Bank riil dari Bagan Akun (*Chart of Accounts*) bisnis via `payment_method_account_id` (tabel `accounts`, `type = 'ASSET'` kode `101xxx`). Jurnal penerimaan kas mendebit akun yang bersangkutan secara langsung tanpa akun penampung sementara (*clearing accounts*).
   - **Dual Split Separation of Concerns:**
     - **Split Bill (Pecah Tagihan / Orang):** Mendukung *Split by Item* (mencentang menu tertentu untuk Sub-Bill 1) dan *Split Equal* (membagi rata nominal ke $N$ orang). Porsi tagihan yang belum terselesaikan **WAJIB** ditandai tegas dengan status **`BELUM LUNAS`** dan nilai saldo sisa **`SISA PIUTANG`**.
     - **Split Tender (Pecah Metode Bayar):** Menambah baris pembayaran (`+ Tambah Pembayaran`) dalam 1 tagihan atau sub-bill dengan kombinasi akun Kas & Bank berbeda (misal: Kas Tunai + Bank BCA).
   - **Ultra-Minimalist Cashier UX Standard (Zero Clutter):**
     - Seluruh modal pembayaran kasir (`CashPaymentModal.tsx`) **DILARANG KERAS** menyematkan emoji atau ikon dekoratif (`💵`, `📱`, `💳`, `🔀`, `✓`, `⏳`) yang membuat visual sesak.
     - Keterbacaan dan hirarki dibangun murni menggunakan tipografi monokrom tegas (`slate-950`), spasi terukur, dan badge status berbobot semantik (Emerald untuk `LUNAS`, Amber/Rose untuk `BELUM LUNAS` / `SISA PIUTANG`).

18. **Order Export & Attribution Standards (User Input vs Integrasi Sistem):**
   - **Kolom Atribusi Wajib (`Dibuat Oleh`):** Seluruh berkas ekspor pesanan (baik Sheet *Ringkasan Pesanan* maupun Sheet *Rincian Produk*) **WAJIB** menyertakan kolom `Dibuat Oleh` tepat setelah kolom `Platform` untuk transparansi audit transaksi multi-channel.
   - **Hierarki Resolusi Identitas Penginput (Zero-Ambiguity):**
     1. **POS (Kasir):** Menggunakan `pos_shifts.cashier_name` (nama kasir yang bertugas) atau nama staf profil kasir.
     2. **Invoice & Order Manual:** Menggunakan `profiles.full_name` (fallback `profiles.email`) staf/owner yang menginput.
     3. **Integrasi Pihak Ketiga (WooCommerce, Accurate Online, TikTok, Shopee, dll):** Wajib dilabeli dengan format informatif **`Sistem ([Platform])`** (contoh: `Sistem (WooCommerce)`, `Sistem (Accurate Online)`).
     4. **Fallback:** `Sistem` jika tidak teratribusi ke profil pengguna atau integrasi tertentu.
   - **Zero-Tolerance N+1 & Double-Layer Resiliency:**
     - Proyeksi utama dilakukan langsung di SQL RPC `public.get_order_list` via `LEFT JOIN profiles u ON o.user_id = u.id` dan `LEFT JOIN pos_shifts ps ON o.shift_id = ps.id`.
     - Endpoint `/api/orders/export` dan modul `orderExportService.ts` menerapkan fallback bertingkat (*graceful degradation*) agar data atribut pembuat transaksi selalu terisi utuh baik saat diekspor bertahap (*chunked streaming*) maupun dari state halaman aktif (*scope = 'page'*).


