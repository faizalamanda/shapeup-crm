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
   - **Unconfirmed Email Disambiguation & Obfuscated SignUp Detection:**
     - Pada `loginAction`, jika Supabase mengembalikan pesan error `Invalid login credentials`, sistem **WAJIB** memverifikasi status konfirmasi email pengguna (via fallback auth admin `!existingUser.email_confirmed_at`). Jika email belum diverifikasi, tampilkan pesan informatif spesifik: *"Akun belum dikonfirmasi. Silakan buka kotak masuk atau folder spam email Anda dan klik tautan verifikasi sebelum masuk"*, **DILARANG** menutupinya dengan error ambigu *"Email atau password salah"*.
     - Pada `registerAction`, sistem wajib memeriksa `data.user?.identities?.length === 0`. Jika kosong (karena Supabase tidak melempar error saat email sudah ada untuk mencegah *email enumeration*), sistem wajib mengembalikan error eksplisit bahwa email sudah terdaftar agar password pengguna tidak gagal sinkron tanpa pemberitahuan.

13. **Universal Password Input Visibility & Mobile Sanitization Standard (Tombol Mata):**
   - Setiap kolom input kata sandi di seluruh antarmuka aplikasi (Login, Register, Reset Password, Pengaturan Staf) **WAJIB** menyertakan tombol mata (*Show/Hide Password*) dengan state `showPassword` (`type={showPassword ? 'text' : 'password'}`), padding kanan yang proporsional (`pr-12`), dan atribut aksesibilitas (`tabIndex={-1}`, dinamis `aria-label`).
   - **Mobile Keyboard Sanitization:** Kolom password dan email di formulir otentikasi wajib menyertakan atribut `autoCapitalize="none"`, `autoCorrect="off"`, dan `spellCheck={false}` guna mencegah keyboard ponsel otomatis mengkapitalisasi huruf pertama atau menambahkan spasi saat tombol mata aktif.
   - **Real-Time Match Indicator & Confirm Password:** Formulir pembuatan/pendaftaran akun baru (`/register`) dan reset password (`/reset-password`) **WAJIB** menyertakan input Konfirmasi Password dengan indikator kecocokan real-time (panjang minimal 8 karakter untuk register dan indikator visual hijau/merah kecocokan).

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

9. **UUID-Safe Product Resolution & POS Shelf Restock vs Quarantine Returns:**
   - **UUID-Safe Resolution:** ID baris item pesanan (*line item IDs*) pada platform integrasi (WooCommerce, POS cart counters) seringkali berupa nomor urut integer (`1, 2, 3...`) atau string kustom (`custom-...`), bukan UUID produk. Sistem **WAJIB** menyaring dengan `isUuid(item.product_id) ? item.product_id : (isUuid(item.id) ? item.id : '')` sebelum dimasukkan ke klausa `.in('id', unCachedIds)` pada tabel `products` di Supabase untuk mencegah crash fatal PostgreSQL `invalid input syntax for type uuid: "1"`.
   - **POS Shelf Restock vs Quarantine:** Mutasi pengembalian barang atas pesanan POS yang dibatalkan/direfund langsung di meja kasir (`reference.includes('POS')` atau berasal dari kasir) secara semantik langsung kembali ke rak pajangan fisik toko. Mutasi pengembalian stoknya **WAJIB** dialokasikan ke `bucket: 'main'` dengan `status: 'done'`, sehingga trigger basis data `trg_sync_product_stock_from_moves` langsung memperbarui `products.stock_quantity`. Retur pesanan online/ekspedisi tetap dialokasikan ke `bucket: 'quarantine'` untuk proses karantina & inspeksi mutu.
   - **Lacak Stok vs Non-Lacak Stok:** Mutasi stok fisik di buku besar gudang hanya dieksekusi untuk produk bertipe `stock_type = 'tracked'`. Produk dengan `stock_type = 'available'` adalah produk non-lacak stok sehingga tidak memicu pemotongan/penambahan kuantitas fisik.

10. **Multi-Variant Stock Ledger, Flat Discrete Presentation & Discrete Stock Opname Standard:**
   - **SPU vs SKU Decoupled Architecture:** Produk induk tersimpan di `products`, sedangkan variasi fisik diskret tersimpan di `product_variants`.
   - **Variant-Aware Stock Ledger:** Mutasi `stock_moves` menyertakan `variant_id UUID REFERENCES product_variants(id)`. Saldo berjalan dihitung via PostgreSQL View `v_stock_moves_ledger` dengan partisi komposit `PARTITION BY sm.product_id, COALESCE(sm.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)`. Hal ini menjamin bahwa kartu stok setiap varian (misal: Kaos Ukuran S vs XL) terisolasi 100%, sementara produk non-varian tetap berjalan normal dengan fallback komposit identik.
   - **Intelligently Synchronized Trigger:** Trigger `sync_product_stock_from_moves` memperbarui saldo varian `product_variants.stock_quantity` DAN mengakumulasi total saldo varian ke produk induk `products.stock_quantity`.
   - **Flat Inline POS Presentation:** Nama item variasi ditampilkan secara linier sebaris (`${rawName} - ${variantStr}`) di keranjang belanja kasir dan struk termal (tanpa bullet bertingkat) guna memaksimalkan keterbacaan cepat dan menghemat kertas termal kasir 30%–50%.
   - **Flat Discrete SKU Listing in Inventory Reports (`/inventory/reports`):** Mengadopsi standar Shopify Admin & Odoo ERP. Seluruh varian fisik ditampilkan langsung sebagai baris mandiri tanpa tombol accordion/expand yang memperlambat audit visual staf.
   - **Mandatory SKU-Level Counting in Stock Opname (`/stock-opname`):** Penghitungan fisik opname **WAJIB** dilakukan per-SKU varian (bukan tingkat induk) untuk mencegah hilangnya selisih susut/lebih akibat saling meniadakan menjadi 0. Mutasi penyesuaian dicatat dengan `variant_id` dan HPP varian spesifik.
   - **Modernized Multi-Tenant RLS for Variants, Ledger & Opname:** RLS pada `product_variants`, `product_modifiers`, `stock_moves`, dan `stock_opname` wajib menggunakan klausul union (`businesses.owner_id UNION business_staff.profile_id OR profiles.active_business_id`) untuk mencegah kegagalan akses kasir dan staf.


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
     - **Direct Web Bluetooth (BLE Instan):** Menggunakan Web Bluetooth API (`navigator.bluetooth`) dan generator biner ESC/POS murni untuk mencetak seketika (0.2s) dari dalam PWA tanpa keluar aplikasi dan tanpa memerlukan aplikasi perantara pihak ketiga (seperti RawBT) sehingga 100% bebas watermark.
       - **Silent Background Auto-Reconnect (Zero Prompt):** Printer yang sudah pernah dihubungkan **DILARANG KERAS** memunculkan dialog pemilih perangkat (`navigator.bluetooth.requestDevice()`) saat mencetak struk pasca pembayaran. Sistem **WAJIB** menyimpan `device.id` (`shapeup_pos_bt_id`) ke `localStorage` dan menyambungkan kembali secara senyap via `navigator.bluetooth.getDevices()`. Dialog `requestDevice()` hanya boleh dibuka jika printer belum pernah dipasangkan sama sekali atau koneksi senyap gagal.
       - **Zero Silent Fallback ke Dialog OS:** Jika koneksi Bluetooth gagal (printer mati/baterai habis), sistem **DILARANG KERAS** melempar secara diam-diam ke dialog cetak OS/browser (`window.print()`). Sistem wajib menampilkan pesan error informatif di layar (*"Printer Bluetooth tidak terhubung..."*).
       - **GATT Sleep Wakeup Handler:** Menyertakan penanganan rekoneksi otomatis dengan jeda singkat (~400ms) untuk mengantisipasi printer thermal mini yang masuk ke mode hemat daya (*idle sleep*).
     - **Printer Sistem (Desktop USB / Fallback Spooler):** Menggunakan modul cetak terisolasi via *Hidden Iframe* (`printReceiptViaIframe()` dari `@/lib/pos/printerAdapter.ts`) dengan `@page { size: ...; margin: 0; }`. Sangat optimal untuk PC kasir dengan kabel USB (mendukung Kiosk Silent Print `--kiosk-printing`).
   - **Synchronous Connection State Initialization:** Komponen modal cetak kasir (`PaymentSuccessModal.tsx` dan `ReceiptPreviewModal.tsx`) **WAJIB** menginisialisasi state `connectionType` secara sinkronus dari `getStoredReceiptSettings()`. Dilarang menggunakan default hardcoded `'system'` yang memicu *race condition* pada fitur *Auto-Print Setelah Pembayaran*.
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

19. **POS Order Cancellation, Full Refund & Ledger Resilience Standards (Zero Silent Drop & Fallback Reversal):**
   - **Service Role / Admin DB Client on Refund & Background Hooks:** Endpoint pembatalan pesanan (`/api/pos/refund`) dan background hooks (`after()`) pada checkout **WAJIB** menggunakan `dbClient = supabaseAdmin || supabase` saat memanggil `syncOrderToLedger()` dan saat mencatat mutasi pengembalian dana kasir. Hal ini mencegah kegagalan RLS parsial (*partial commit*) di mana status pesanan berubah menjadi `cancelled`, namun penulisan `order_payments` bertipe `payment_kind = 'refund'` terblokir.
   - **Fatal Error on Payment Ledger Refund (`throw refErr`):** Operasi pencatatan baris refund di `order_payments` **DILARANG KERAS** diperlakukan sebagai kegagalan non-fatal (`console.warn`). Jika penulisan baris refund gagal, sistem **WAJIB MENOLAK / MELEMPAR EXCEPTION** agar kas laci dan buku besar tidak mengalami desinkronisasi.
   - **Resilient Fallback for Missing Initial Payment Transaction:** Pada pembatalan/refund (`syncOrderToLedger`), jika transaksi header pembayaran awal (`paymentTx`) tidak ditemukan di tabel `transactions` (akibat kegagalan background checkout sebelumnya), sistem **WAJIB** memiliki fallback otomatis membaca baris pembayaran aktif dari `order_payments` bertipe `payment_kind = 'payment'` untuk menerbitkan jurnal pembalikan kas/bank secara akurat.
   - **Defensive PostgREST Self-Healing in `postJournalTransaction()`:** Saat memeriksa apakah suatu transaksi sudah memiliki baris jurnal atau mengalami *partial commit* (`select('id, journal_lines(id)')`), jika relasi nested `journal_lines` menghasilkan array kosong (yang bisa terjadi karena izin seleksi view/RLS), fungsi **WAJIB** memvalidasi ulang dengan query hitungan langsung `supabase.from('journal_lines').select('id', { count: 'exact', head: true }).eq('transaction_id', tx.id)` sebelum menyisipkan ulang baris jurnal baru. Hal ini mencegah baris jurnal menduplikasi (2x, 3x, 9x) pada setiap percobaan ulang (*retry*).

20. **Enterprise POS Returns, Granular Exchanges & Contra-Revenue Accounting Standards:**
   - **Granular Partial Returns & Single Source of Truth (`pos_returns`, `pos_return_items`):** Retur barang belanjaan kasir POS **WAJIB** mendukung pengembalian per-baris item (*line-item level*) dan kuantitas parsial secara independen tanpa membatalkan (*void*) nota secara keseluruhan. Transaksi dicatat append-only di `pos_returns` dan `pos_return_items`. Sisa kuantitas retur (`returnable_qty`) wajib dibatasi oleh view `v_pos_returnable_items` (`original_qty - returned_qty`).
   - **Physical Goods Disposition Triad:** Setiap barang yang diretur wajib ditentukan disposisi fisiknya:
     - `restock`: Dicatat ke `bucket: 'main'` dengan `status: 'done'` sehingga trigger basis data `sync_product_stock_from_moves` otomatis menambah stok fisik rak display toko (`products` dan `product_variants`).
     - `quarantine`: Dicatat ke `bucket: 'quarantine'` untuk inspeksi mutu atau klaim vendor tanpa mencemari stok siap jual di rak toko.
     - `discard`: Barang rusak/pecah/kedaluwarsa langsung diakui sebagai kerugian tanpa menambah stok fisik.
   - **Fair Prorated Discount Mathematics:** Nominal pengembalian per unit **WAJIB** memperhitungkan diskon baris dan diskon global/kupon secara proporsional:
     $$\text{Net Return Per Unit} = \frac{(\text{Line Gross} - \text{Line Discount}) - \text{Order Prorated Discount}}{\text{Item Qty}}$$
     Dilarang mengembalikan dana melebihi nilai bersih yang dibayarkan pelanggan saat transaksi awal.
   - **Defective Restocking Fee Waiver:** Jika kebijakan toko mengenakan biaya *restocking*, sistem **WAJIB** membebaskan biaya penanganan tersebut ($0\%$) jika alasan pengembalian adalah produk cacat/rusak pabrik (`reason === 'defective'`).
   - **Exchange Upcharge & Anti-Unsecured Debt Rule:** Tukar barang dengan nilai lebih tinggi ($\Delta > 0$) **WAJIB** diselesaikan dengan pembayaran tunai/non-tunai di kasir saat itu juga. Dilarang menutup nota penukaran dengan meninggalkan piutang tanpa jaminan (*unsecured debt*).
   - **Store Credit Ledger & Row-Locked Redemption:** Pengembalian via Saldo Toko dicatat di `customer_store_credits` dan `store_credit_ledger`. Penebusan saldo wajib menggunakan penguncian baris PostgreSQL `FOR UPDATE` untuk mencegah *race condition* dan pembelanjaan ganda (*double spending*).
   - **Contra-Revenue Accounting Identity:** Retur penjualan **DILARANG KERAS** membalikkan atau menimpa baris penjualan `401000`. Sistem **WAJIB** mendebit akun Kontra-Pendapatan `401100 Potongan & Retur Penjualan`, mengkredit kas/bank/store credit, menyeimbangkan piutang `103000` (jika nota awal cicilan/belum lunas), serta mendebit `104000 Persediaan` dan mengkredit `500000 HPP` untuk barang layak restock.
   - **PostgreSQL Variant Schema Standard:** Relasi tabel `product_variants` menggunakan kolom **`name`** (bukan `title`). Dilarang memanggil `product_variants(..., title, ...)` guna mencegah crash fatal `PostgreSQL 42703 (column product_variants_1.title does not exist)`.
   - **Zero-Latency UI Extraction:** Antarmuka modal retur (`POSReturnModal.tsx`) **WAJIB** mengekstrak daftar item belanjaan secara sinkronus dari `order.items_json` pada saat *mount* (`computeReturnableLines`) untuk menjamin transisi 0ms tanpa menunggu panggilan server.

21. **Enterprise Invoice Lifecycle, Decoupled Status, COA Payment Binding & Omnichannel Attribution Standards:**
   - **Pemisahan Dimensi Siklus Hidup 5-Tahap (Decoupled Two-Dimensional Lifecycle):**
     - Status dokumen logistik/operasional (`orders.status`: `pending` [Draft], `processing` [Terbit/Belum Selesai], `shipped` [Dikirim], `completed` [Selesai], `cancelled` [Batal]) **TIDAK SAMA** dan terpisah secara ortogonal dari status keuangan piutang (`orders.payment_status`: `unpaid`, `partial`, `paid`).
     - **Two-Stage Ledger Trigger:** Saat faktur diterbitkan (`status === 'processing'`), `syncOrderToLedger()` mengakui penjualan & piutang (`salesTx`: Debit `103000`, Kredit `401000`). Pemotongan stok fisik gudang (`stock_moves`) dan penjurnalan HPP (`501000` / `102000`) terpicu saat status memasuki `stockReductionStatuses` / `journalHppStatuses` (default: `['shipped', 'completed']`).
     - Dilarang keras mengasumsikan faktur yang berstatus `status === 'completed'` pasti berstatus lunas (`paid`), atau sebaliknya. Faktur tempo 30 hari dapat berstatus `shipped` atau `completed` namun tetap berstatus `unpaid`.
   - **Direct Active COA Cash/Bank Account Binding & Dynamic Legacy Resolution:**
     - Seluruh pilihan Metode Pembayaran pada Buat Invoice (`/orders/invoices/new`), Edit Invoice (`/orders/invoices/[id]/edit`), dan Catat Pembayaran (`/orders/invoices/[id]`) **WAJIB** memuat daftar akun Kas/Bank secara dinamis dari COA aktif milik bisnis (`getActivePaymentAccounts()` & `isCashBankAccount()` dari `@/lib/accountHelper.ts` / `@/lib/coa.ts`) tanpa meng-hardcode akun statis, serta menyimpan `payment_method_account_id` (disanitasi via `isUuid()`) dan `payment_method` (nama akun COA aktif) ke tabel `order_payments`.
     - Uang muka (DP) dan termin pelunasan didelegasikan ke `recordOrderPayment()` dari `@/lib/paymentLedger.ts` dan `syncOrderToLedger()` dari `@/lib/orderLedger.ts` dengan mempertahankan tanggal pembayaran (`payment_date`) pilihan pengguna.
     - **Kompatibilitas Data Lama (`resolvePaymentAccountFromCOA`):** Untuk faktur historis yang belum memiliki `payment_status` (bernilai `null` saat `status === 'completed'`) atau baris pembayaran lama tanpa `payment_method_account_id`, API dan `syncOrderToLedger()` wajib menormalisasi status lunas secara otomatis serta mencocokkan string metode bayar secara dinamis terhadap daftar akun Kas/Bank yang aktif di COA bisnis tersebut.
   - **Atribusi Omnichannel & UTM Attribution:**
     - Metadata sumber penjualan disimpan dalam format terpadu di `orders.source_platform` dan `raw_source_data.source_order` (`channel`, `reference_no`, `utm_source`, `utm_campaign`).
     - Format ini wajib kompatibel dengan modul ekspor multi-sheet (`/app/orders/services/orderExportService.ts`), webhooks e-commerce (WooCommerce), dan laporan penjualan per saluran.
   - **Penerapan Penuh Modul Reusable CRM:**
     - Seluruh endpoint API faktur (`/api/orders/invoices`, `/api/orders/invoices/[id]`, `/api/orders/invoices/[id]/payment`) wajib menggunakan `getApiContext()` dari `@/lib/apiContext.ts` (Rule 1) dan sanitasi UUID `isUuid()` dari `@/lib/utils.ts` (Rule 9).
   - **Flat Discrete Product Variants in Invoices (`ProductSelectCombobox` & `items_json`):**
     - Halaman pembuatan (`/orders/invoices/new`) dan pengeditan (`/orders/invoices/[id]/edit`) faktur **WAJIB** mengambil relasi `product_variants(id, name, sku, price, cost_price, stock_quantity)` dan meratakan (*unfold*) variasi menjadi baris pilihan mandiri (`${product.name} - ${variant.name}`) pada `ProductSelectCombobox`.
     - State baris item dan payload API (`POST` & `PUT` invoice) wajib menyertakan `variant_id` (disanitasi dengan `isUuid()`) dan `cost_price` varian ke dalam `orders.items_json`, sehingga pemotongan stok (`applyStockMovement`), pencatatan HPP (`generateItemizedHppJournalLines`), serta tab **History Perpindahan Stok** di `/orders/invoices/[id]` terisolasi secara akurat per-SKU variasi.

22. **High-Cardinality Datasets (> 1,000 Rows), Universal Customer/Product Directory & Reactive Cache Coherence Standards (Skill Utama `high-cardinality-data`):**
    - **Bypass 1.000 PostgREST Limit (`fetchAllSupabaseRows`, `fetchAllBusinessCustomers`, `fetchAllBusinessProducts`):** Pengambilan daftar pelanggan maupun produk di server/client (`@/lib/customerHelper.ts`, `@/lib/chunkedQueryHelper.ts`, `GET /api/customers`, Invoice, dan POS) **DILARANG KERAS** melakukan `.select()` polos tanpa `.range()`, karena PostgREST memotong hasil di baris ke-1.000 (*Lexicographical Starvation* pada bisnis besar seperti Bisnis Tanem). Wajib menggunakan *Deterministic Chunked Range Fetching* (`.range(offset, offset + 999)` dengan tie-breaker `.order('id', { ascending: true })`) yang dipadukan dengan *In-Memory Server Cache* per `businessId` (TTL 60 detik + *Single-Flight Deduplication*).
    - **Symmetric Phone Canonicalization (`08` $\leftrightarrow$ `628`):** Penyimpanan nomor telepon menggunakan format kanonik `628...` (`normalizePhoneCanonical`), sedangkan pencarian di klien & server wajib menggunakan `matchesCustomerQuery()` dan `buildPhoneSearchVariants()` agar pencarian dengan awalan lokal `08...`, `+62 8...`, maupun `628...` selalu cocok 100%.
    - **DOM Windowing (`MAX_VISIBLE_ITEMS = 50`) & Hybrid Server Fallback:** Komponen `CustomerSelectCombobox` dan `ProductSelectCombobox` wajib membatasi render elemen DOM maksimal 50 baris teratas saat dibuka (0ms render latency) dan menjalankan *debounced server search fallback* (`/api/customers?search=...`) jika hasil lokal $< 5$.
    - **Strict Multi-Tier Cache Coherence ("Satu Update, Semua Terupdate"):** Seluruh pemilihan dan mutasi pelanggan di Buat Invoice, Edit Invoice, Kasir POS, Order Manual, dan Halaman Customer (`/customers`) wajib terhubung ke `useCustomerDirectory()` dan memanggil `notifyCustomerDirectoryUpdate()` dari `@/lib/customerDirectoryStore.ts`. Setiap mutasi langsung memperbarui L1 RAM, L2 `sessionStorage` (dengan *Quota Guard* untuk $> 500$ baris), meng-invalidate cache tabel `/customers` (`su_customers_v2_${bid}`), dan menyiarkan pembaruan lintas tab via `BroadcastChannel`.
    - **Server Profile Cache Invalidation on Business Switch (`PATCH /api/business`):** Saat berpindah unit bisnis di `UserContext.tsx` (`handleSwitchBusiness`), sistem wajib memanggil `PATCH /api/business` yang mengeksekusi `invalidateProfileCache(user.id)` di server agar perpindahan ke bisnis lain (seperti Bisnis Tanem) berlaku instan 0ms tanpa *30-second cache drift*. (Lihat skill `high-cardinality-data` dan knowledge `high-cardinality-directory-and-cache-coherence.md`).

23. **Accurate Online Webhook Auto-Renewal & Multi-Source Queue Worker Standards:**
    - **Automatic 3-Day Webhook Renewal (`webhook-renew.do`):** Masa aktif pengiriman webhook di Accurate Online hanya berlaku **7 hari** sejak diaktifkan/diperpanjang (jika kedaluwarsa, event dilewati oleh Accurate dengan `status: "Skip"`). Sistem **WAJIB** memperpanjang masa aktif secara otomatis setiap **3 hari sekali** melalui `autoRenewAllAccurateWebhooks()` dan `renewAccurateWebhookForToken()` (`@/lib/integrations/accurate/syncService.ts`) yang memanggil `GET https://account.accurate.id/api/webhook-renew.do` (dengan header HMAC-SHA256 `X-Api-Timestamp` & `X-Api-Signature`) dan menyimpan `webhook_expiry` serta `last_webhook_renew_at` ke dalam `business_integrations.config`.
    - **Multi-Source Queue Dispatching in `/api/webhook/woo/process-queue`:** Karena fungsi RPC `fetch_webhook_queue_batch` mengklaim seluruh baris `pending` dari tabel `webhook_ingest_queue` lintas sumber (`woocommerce` dan `accurate`), worker `/api/webhook/woo/process-queue` **WAJIB** memeriksa `item.source` di awal iterasi:
      - Jika `item.source === 'accurate'`, delegasikan ke `processAccurateWebhookPayload(business_id, payload)` yang memanggil `executeAccurateSync()`.
      - Dilarang keras mengasumsikan semua item antrean adalah objek order WooCommerce (`payload.id.toString()`), karena payload Accurate berbentuk Array event.
    - **Legacy Data Fallback (`db_integer_id` JWT Decode & Config Preservation):**
      - Pada endpoint penerima `/api/webhook/accurate` dan saat auto-renew, jika konfigurasi lama belum menyimpan `db_integer_id`, sistem wajib memiliki fallback mendekode payload Base64 dari token `aat.<ver>.<base64_payload>.<sig>` (membaca properti `d` sebagai integer ID database Accurate).
      - Saat menyimpan pengaturan di `AccurateSettingsModal.tsx`, sistem wajib melakukan spread `...(accurateSaved?.config || {})` agar metadata historis (`last_sync_date`, `db_integer_id`, `webhook_expiry`) tidak pernah tertimpa. (Lihat knowledge `accurate-webhook-auto-renewal-and-queue.md`).

24. **Zero-Latency POS Hub to Workspace Instant Transition & Reactive Catalog Store Standards (Skill `pos-session-ledger` & Knowledge `pos-hub-to-workspace-instant-transition.md`):**
    - **Shared Session State Handoff (`POSContainer.tsx`):**
      - Objek sesi kasir (`activeShift`), akun kas/bank (`accounts`), nomor laci register (`posRegisters`), serta nama kasir diangkat (*lifted state*) pada `POSContainer.tsx`.
      - Saat berpindah dari `POSHub` ke `POSWorkspace`, data sesi diteruskan langsung melalui `preloadedSession`.
      - **DILARANG KERAS** membiarkan `POSWorkspace` melakukan *cold fetch* redundan atau membuat *two-stage sequential waterfall* (`await checkActiveShift()`) yang memblokir antarmuka kasir. Saat kembali ke Hub, state sesi kasir mutakhir dikembalikan secara simetris.
    - **3-Tier Reactive POS Catalog Store (`lib/posCatalogStore.ts`):**
      - Seluruh pembacaan katalog produk kasir POS **WAJIB** menggunakan `usePosCatalog()` dari `@/lib/posCatalogStore.ts`.
      - Menggabungkan **L1 RAM Cache** ($0\text{ms}$ instan per `businessId`), **L2 `sessionStorage` Cache** (`su_pos_cat_v1_${bid}` dengan *quota guard*), dan sinkronisasi lintas tab via `BroadcastChannel` (`shapeup_pos_catalog_sync_v1`).
      - Menggunakan *Slim Column Projection* (`POS_SLIM_PRODUCT_SELECT_VARIANTS`) yang memangkas ukuran payload JSON $45\% - 65\%$ tanpa mengangkut deskripsi artikel panjang yang tidak diperlukan di meja kasir.
    - **Speculative Idle Prefetching di `POSHub.tsx` (`prefetchPosCatalog`):**
      - Memanfaatkan *think-time* kasir saat berada di Hub untuk mem-prefetch katalog produk dan kategori di latar belakang. Saat tombol **"Buka Register Kasir"** ditekan, data produk sudah $100\%$ siap di RAM L1.
    - **Instant App-Shell & Zero Black-Screen Standard:**
      - **DILARANG KERAS** menggunakan full-screen blocking spinner (`if (loadingInit) return <FullScreenSpinner />`). Seluruh kerangka kerja kasir (Navbar atas, Input pencarian, Tab Kategori, Keranjang, dan Keypad) wajib tampil instan dalam $< 16\text{ms}$ (1 frame @ 60Hz).
      - Jika data katalog masih dalam proses pengambilan pada *cold boot* awal, hanya area kartu produk yang menampilkan *skeleton pulse grid* tanpa mengunci navigasi kasir. Data sekunder (`unpaidOrdersCount`, `heldOrders`, `loyaltySettings`, `priceGuardSettings`, `customer_metrics`) dimuat di latar belakang secara *non-blocking*.
    - **DOM Windowing pada Grid & List Produk (`VISIBLE_BATCH = 60`):**
      - Pencarian dan filter kategori tetap memindai $100\%$ populasi produk di memori RAM (bahkan untuk $> 4.000$ SKU), namun elemen JSX yang di-render ke DOM dibatasi pada **60 item pertama** (`visibleProducts`). Guliran kasir (*scrolling*) memicu penambahan batch secara otomatis (`visibleProductCount += 60`), mencegah pembekuan *main thread* (*Long Animation Frame* $> 800\text{ms}$).
    - **Optimistic Local Stock Mutation & Self-Healing Fallback:**
      - Saat transaksi selesai dibayar, `updateLocalStock` langsung memotong stok fisik produk dan varian di memori lokal ($0\text{ms}$) agar kartu produk langsung terbarui seketika.
      - Jika kueri *chunked range* mengalami kendala jaringan atau kegagalan skema, sistem otomatis jatuh kembali (*graceful fallback*) ke kueri langsung standar (`limit 1000`).
      - Antarmuka kasir menyediakan tombol pemulihan mandiri **"🔄 Muat Ulang Katalog"** pada keadaan kosong jika terjadi *network drop*.
      - Seluruh pemfilteran string produk wajib menerapkan null-safety ketat: `(p.name || '').toLowerCase()`.

25. **POS Payment Settlement, Full-Screen Completion Stage & Mobile Kiosk Armor Standards:**
    - **Peralihan dari Modal Ephemeral ke Dedicated Full-Screen Completion Stage (`PaymentSuccessView.tsx`):**
      Layar sukses pembayaran kasir wajib berupa tampilan *Full-Screen Stage* yang menutup seluruh viewport (`fixed inset-0 z-[1200] bg-slate-100 text-slate-900 font-sans`), bukan sekadar kotak dialog modal pop-up melayang di atas keranjang lama. Ini mengeliminasi *context leak*, *z-index stacking*, dan penutupan tidak sengaja.
    - **Harmonisasi Desain & Kompatibilitas Perangkat Lawas (Zero-Gradient & Zero-Backdrop-Filter Standard):**
      - Seluruh elemen visual layar sukses wajib selaras dengan tema utama POS Workspace: latar belakang luar `bg-slate-100`, navbar atas `bg-slate-900 text-white`, kartu kembalian & rincian pesanan berupa kartu putih solid `bg-white border border-slate-200 shadow-xs`, dan footer aksi bawah `bg-white border-t border-slate-200`.
      - **DILARANG KERAS** menggunakan CSS modern berat yang tidak didukung atau menyebabkan rendering glitch / lag pada tablet kasir murah & Android lawas (Android 7–9 / WebView lama):
        - Dilarang menggunakan `bg-gradient-to-*` (gradien linear/radial memicu *color banding* dan layar hitam pada GPU lawas).
        - Dilarang menggunakan `backdrop-blur-*` (`backdrop-filter: blur(...)` memicu freeze UI dan tampilan kotak abu-abu kusam).
        - Dilarang menggunakan overlay transparan bertingkat (`via-transparent`, `bg-emerald-500/5`) dan filter `drop-shadow-*`.
      - Wajib menggunakan warna solid 100% *opaque*, box-shadow ringan (`shadow-xs`), dan border CSS standar yang didukung secara universal sejak Android 4.4+.
    - **Kiosk Armor Gestur Mobile (`overscroll-behavior: none`):**
      Seluruh container kerja kasir (`POSWorkspace.tsx` dan `PaymentSuccessView.tsx`) **WAJIB** menyertakan CSS `overscroll-behavior: none` dan `touch-action: pan-y`. Dilarang membiarkan gestur tarik ke bawah (*pull-down*) memicu *pull-to-refresh* bawaan browser Android/iOS yang menghancurkan in-memory state kasir.
    - **Intersep Tombol Back Mobile (Anti-Onboarding Redirection):**
      Komponen `PaymentSuccessView` **WAJIB** mendaftarkan diri ke `useModalBackHandler(isOpen, onClose)`. Ketika kasir menekan tombol *Back* fisik perangkat, swipe-back, atau tombol kembali browser, sistem wajib mencegat event tersebut agar kasir menutup layar sukses dan kembali ke kasir bersih (transaksi baru), **DILARANG KERAS** membiarkan sinyal lolos ke `useMobileBackToHome()` yang melempar kasir keluar ke `/onboarding`.
    - **Dynamic Post-Print Action Switcher (Hick-Hyman Law Ergonomics):**
      - Sebelum struk dicetak: Tombol aksi menampilkan `[ Void ]`, `[ Lewati Struk ]`, dan `[ 🖨️ Cetak Struk (Enter) ]` (warna solid Royal Blue `bg-blue-600 hover:bg-blue-700`).
      - Segera setelah struk sukses dicetak (`hasPrinted = true`): Tombol aksi bertransformasi menjadi `[ Void ]`, `[ 🖨️ Cetak Ulang ]`, dan tombol dominan utama **`[ + Transaksi Baru (Enter ↵) ]`** (warna solid Emerald Green `bg-emerald-600 hover:bg-emerald-700` dengan ukuran paling besar).
      - Dilarang mempertahankan label ambigu `"Tanpa Struk"` setelah struk fisik tercetak.
    - **Pintasan Keyboard Ergonomis:**
      - Tekan `Enter` sebelum cetak: Memanggil fungsi cetak struk.
      - Tekan `Enter` setelah cetak: Membuka transaksi baru.
      - Tekan `Escape`: Membuka transaksi baru.
    - **Session Storage Snapshot Resilience:**
      Data ringkasan transaksi terakhir (`orderNumber`, `grandTotal`, `changeAmount`, `customerName`, `paymentMethod`) disimpan ke `sessionStorage.setItem('su_last_pos_completed_order', ...)` untuk perlindungan state jika browser kasir tertutup secara paksa.

26. **Atomic POS Order Numbering, Resilient Fallback & Dual-Layer Architecture Standards (Skill `pos-session-ledger`):**
    - **Format Kanonikal Dokumen Kasir:** Format baku nomor nota kasir POS adalah `POS-YYYYMMDD-XXXX` (contoh: `POS-20261106-0001`). Dilarang keras menggunakan epoch timestamp terpotong (`Date.now().slice(-8)`) yang menghasilkan nomor acak tanpa tanggal kalender dan melanggar standar audit akuntansi/fiskal.
    - **Concurrency Safety (Zero Collision / Anti-Race Condition):** Nomor nota kasir **WAJIB** dihasilkan di basis data menggunakan PostgreSQL Row-Level Exclusive Lock via tabel `public.business_counters` dan RPC `generate_pos_order_number()` (< 0.2ms). Dilarang menghitung `MAX(counter) + 1` naif di Node.js saat melayani banyak kasir bersamaan.
    - **Arsitektur Dual-Layer (Nomor Dokumen vs Nomor Antrean):**
      - *Nomor Dokumen Resmi* (`orders.order_number`): Kunci legal untuk audit pajak DJP, pencarian pesanan, dan Buku Besar Akuntansi.
      - *Nomor Antrean Ringkas* (`queue_number`): Angka harian ringkas (`#1`, `#2`, `#42...`) untuk kenyamanan panggilan kasir, barista, atau dapur. Default sistem: **NONAKTIF (OFF)**, dapat diaktifkan kapan saja melalui modal Pengaturan Struk Kasir (`ReceiptSettingsModal`).
    - **Resilient Fallback & Backward Compatibility:**
      - Endpoint API POS (`/api/pos/order`) secara otomatis mendeteksi dan mengonversi format acak lawas (`POS-\d{8}`) ke nomor urut terpadu, serta menyimpan referensi asli di `raw_source_data.legacy_order_number`.
      - Modul `orderNumberHelper.ts` menyertakan *resilient query fallback* otomatis jika database remote belum mengaplikasikan migrasi RPC, sehingga sistem bebas dari risiko *crash* (Zero Downtime).
    - **0ms Instant Optimistic Action (Zero Checkout Delay):**
      - Kasir **DILARANG KERAS** diblokir oleh `await fetch('/api/pos/order')` yang menimbulkan jeda pemrosesan 300–800ms.
      - Antarmuka kasir `POSWorkspace.tsx` menghasilkan nomor optimistik tanggal hari ini (`POS-YYYYMMDD-XXXX`) seketika di memori melalui `getNextOptimisticOrderNumber()`.
      - Modal pembayaran langsung ditutup dan struk belanja langsung ditampilkan dalam **0 milidetik** (*Reality First*).
      - Sinkronisasi server berjalan di latar belakang (*fire-and-forget*); response server merekonsiliasi nomor nota secara mulus *in-place* tanpa kedipan (*zero flicker*).








