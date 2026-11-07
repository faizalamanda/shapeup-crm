---
name: pos-session-ledger
description: Arsitektur Sesi Kasir POS, Rekonsiliasi Kas Laci (Floating Drawer), Multi-Tender Split Payment, Cicilan/DP, dan Append-Only Void/Refund Ledger. Gunakan skill ini saat mengembangkan atau memodifikasi modul kasir POS dan tabel order_payments.
---

# POS Session & Financial Ledger Architecture (World-Class Standard)

Dokumen skill ini menetapkan arsitektur standar untuk sistem Kasir / Point of Sale (POS), kontrol sesi (*session gating*), rekonsiliasi kas laci fisik (*cash drawer reconciliation*), pembayaran split/cicilan (*multi-tender*), dan audit trail pembayaran *append-only* di ShapeUp CRM.

---

## 1. Prinsip Utama (Core Principles)

### 1.1 Strict Session Gating (Zero-Bypass Policy)
- **Aturan:** Transaksi kasir (checkout, pembayaran cicilan, atau void pembayaran) **DILARANG KERAS** diproses tanpa sesi kasir aktif (`pos_shifts.status = 'open'`).
- **Implementasi:** 
  - API endpoint (`/api/pos/order`, `/api/pos/order/pay`, `/api/pos/order/payment-void`) wajib memeriksa keberadaan shift aktif pemanggil (`user_id` + `business_id`) dan mengembalikan HTTP `403 Forbidden` jika shift belum dibuka.
  - Komponen antarmuka (UI) memeriksa status shift sebelum membuka modal pembayaran.

### 1.2 Dynamic Floating Drawer (Laci Kas Dinamis)
- Daripada mengikat kasir ke nomor register hardware yang kaku atau memperbanyak akun buku besar di Bagan Akun (COA), sistem menggunakan konsep **Floating Cashier Drawer**:
  - Semua laci kasir berinduk pada akun GL Control `101000` (*Kas POS Berjalan*), dengan sub-ledger relasional pada tabel `pos_shifts`.
  - Kasir membawa modal awal (`initial_cash`) saat shift dibuka dan bertanggung jawab penuh atas uang tunai di lacinya sampai shift ditutup.
  - Jika kasir ditugaskan pada mesin/meja kasir spesifik (`register_id`), akun laci mesin tersebut (`pos_registers.account_id`) yang digunakan.

### 1.3 Strict Drawer Reconciliation & Selisih Kas (*Over/Short*)
- Saat shift ditutup, sistem menghitung saldo kas yang diharapkan (*Expected Drawer Cash*):
  $$\text{Expected Cash} = \text{Initial Cash} + \text{Cash Sales} + \text{Cash In} - \text{Cash Out} - \text{Cash Refunds}$$
- Kasir memasukkan hitungan fisik kas aktual (`actual_cash`).
- Selisih kas ($\Delta = \text{Actual Cash} - \text{Expected Cash}$) diperlakukan secara akuntansi:
  - **Selisih Kurang ($\Delta < 0$):** Diposting ke akun `503000` (*Beban Selisih Kas / Operasional Lainnya*).
  - **Selisih Lebih ($\Delta > 0$):** Diposting ke akun `403000` (*Pendapatan Operasional Lainnya*).
  - Kas aktual disetorkan ke rekening tujuan (`target_account_code` / Bank/Brankas).

---

## 2. Multi-Tender Split Payment & Dual Split Bill Architecture

### 2.1 Hubungan 1:N Antara Order dan Pembayaran
- Tabel `order_payments` bertindak sebagai *Single Source of Truth* untuk semua arus kas/tender:
  - Kolom `payment_kind`: `'payment'` (penerimaan), `'refund'` (pengembalian), `'void'` (pembatalan).
  - Kolom `status`: `'confirmed'`, `'voided'`, `'refunded'`.
  - Kolom `payment_method_account_id`: Foreign key ke ID akun kas/bank di tabel `accounts`.
  - Kolom `voided_payment_id`: Foreign key ke ID baris pembayaran yang dibatalkan.
- Satu pesanan (`orders`) dapat dibayar menggunakan kombinasi metode:
  - Misal: Tunai Rp 50.000 + QRIS Rp 50.000 untuk total belanja Rp 100.000.
  - Masing-masing disimpan sebagai baris terpisah di `order_payments`.

### 2.2 Integrasi Akuntansi Kas & Bank & Hybrid Tender Engine (Multi-QRIS & Laci Kas Fisik)
- Sesuai standar POS kelas ERP (Odoo, NetSuite, SAP), setiap metode pembayaran di antarmuka kasir terikat langsung ke akun Aset Kas & Bank riil dari Bagan Akun (*Chart of Accounts*):
  - Akun Kas POS: `101000 Kas POS (Tunai)` / register laci shift aktif
  - Akun Rekening Bank / QRIS: `101200 Bank / QRIS POS`, `101201 QRIS BCA`, `101202 QRIS Mandiri`, `101101 Bank BCA`, dsb.
  - Akun Kas Utama: `101100 Kas Utama`
- **1-Click Cashier Ergonomics vs Chart of Accounts Abstraction:**
  - Kasir memilih metode melalui tombol-tombol cepat (`💵 Tunai (Laci Kasir)`, `📱 QRIS BCA`, `📱 QRIS Mandiri`, `💳 EDC BCA`), bukan dropdown buku besar akuntansi mentah.
  - Pemilihan tombol `Tunai` otomatis mengikat penerimaan kas ke laci fisik shift kasir yang aktif (`expected_cash`).
  - Pemilihan tombol `QRIS` atau `Bank` otomatis mendebit rekening bank penerbit tanpa mencemari uang fisik di laci kasir.
- **Konfigurasi Dedicated Tender di `/settings/pos`:**
  - Pemilik toko dapat mengatur nama tombol, mengaktifkan/menonaktifkan tender, serta menambah multi-QRIS & multi-bank yang dipetakan ke akun Aset COA.
  - Jika belum dikonfigurasi, sistem menerapkan *Smart Auto-Classification Fallback* dari COA secara otomatis.
- Ketika transaksi dibayar:
  - Jurnal penerimaan kas mendebit langsung ke `payment_method_account_id` yang dipilih kasir tanpa perantara *clearing account* yang menggantung.
  - Saldo kas laci kasir dan saldo rekening bank di buku besar langsung bertambah secara presisi dan siap direkonsiliasi.

### 2.3 Dual Split Engine: Split Bill vs Split Tender
Sistem memisahkan dua konsep pemecahan secara tegas dan mendukung keduanya secara sinergis:
1. **Split Bill (Pecah Tagihan / Orang):**
   - **Mode A: Split by Item (Pecah per Menu):** Kasir mencentang menu tertentu untuk diselesaikan pada Sub-Bill 1. Sisa item yang belum dibayar otomatis diberi label penegasan **`SISA ITEM (BELUM LUNAS)`**.
   - **Mode B: Split Equal (Bagi Rata):** Tagihan dibagi rata ke $N$ orang (@ `grandTotal / N`). Porsi orang pertama dibayar, porsi sisanya ditandai **`BELUM LUNAS`**.
2. **Split Tender (Pecah Metode Bayar):**
   - Kasir menekan tombol `+ Tambah Pembayaran (Split)` untuk menambah baris pembayaran baru dalam 1 tagihan atau sub-bill.
   - Sistem secara otomatis menghitung sisa nominal yang belum tertutup (`remaining = target - sum(lines)`).
   - Setiap baris memiliki tombol tender masing-masing (misal: Baris 1 Tunai Rp 50.000 + Baris 2 QRIS Mandiri Rp 50.000).

### 2.4 Cicilan & Uang Muka (Partial Payment / DP)
- Jika pelanggan membayar kurang dari tagihan (`amount_paid < grand_total`):
  - Kolom `orders.payment_status` diset menjadi `'partial'`.
  - Sisa tagihan diakui sebagai **Piutang Usaha** (`103000`):
    - Jurnal Penjualan: Debit Piutang `103000` = Grand Total, Credit Pendapatan `401000`.
    - Jurnal Pembayaran: Debit Kas/Bank (`payment_method_account_id`) = DP yang dibayar, Credit Piutang `103000` = DP yang dibayar.
  - Sisa saldo piutang dapat dilunasi kapan saja melalui tombol **Bayar Sisa Tagihan** di `POSOrderDetailModal` yang memanggil `POST /api/pos/order/pay`.

### 2.5 Standar Antarmuka Kasir Ultra-Minimalis (Zero-Clutter)
- Mengacu pada hukum **Hick-Hyman**, beban kognitif kasir dioptimalkan dengan:
  - **Glif Fungsional vs Ikon Dekoratif:** Simbol kategori pembayaran (`💵`, `📱`, `💳`, `🏦`) diizinkan murni sebagai penanda fungsional cepat (*glanceable tender category glyphs*) pada tombol kasir, namun dilarang menumpuk emoji kartun dekoratif non-fungsional (`✓`, `⏳`, `🎉`, dll) yang membuat antarmuka sesak.
  - **Hirarki Tipografi Monokrom:** Penegasan informasi menggunakan ketebalan teks (`slate-950`), kontras angka nominal, dan badge status fungsional (Emerald untuk `LUNAS`, Amber/Rose untuk `BELUM LUNAS` / `SISA PIUTANG`).

### 2.6 Standar Arsitektur Pemilih Varian & Modifier POS (`VariantSelectorModal`)
Ketika kasir memilih produk yang memiliki varian atau modifier, antarmuka membuka modal pemilih varian berstandar ERP:
1. **Intelligent Multi-Attribute Dimensional Breakdown:**
   - Varian dengan format hyphen multi-dimensi (contoh: `"Hitam - XL"`, `"Merah - M"`, `"Matcha - Less Ice"`) secara otomatis didekonstruksi menjadi pil pemilih terpisah (Dimensi 1: *Warna*, Dimensi 2: *Ukuran*, Dimensi 3: *Suhu/Es*).
   - Seluruh operasi string wajib menerapkan pengamanan kenihilan (`v?.name && typeof v.name === 'string'`) sebelum melakukan `split(' - ')` atau `.trim()` guna mencegah error runtime tipe data.
2. **Aturan Mutlak React Hooks (Zero Early Return Crash):**
   - **DILARANG KERAS** meletakkan `if (!isOpen || !product) return null` sebelum hooks (`useMemo`, `useState`, `useEffect`). Guard return wajib diletakkan di baris paling bawah tepat sebelum me-return JSX.
   - Semua memoization wajib dirancang *defensive* terhadap kondisi `product === null` (fallback ke array kosong `[]`).
3. **On-The-Fly DB Variant Fetching Fallback:**
   - Jika suatu produk memiliki flag `has_variants = true` namun array relasi varian lokal belum lengkap di cache/katalog POS, modal wajib secara otomatis menjalankan kueri asinkronus ke tabel `product_variants` dengan indikator loading (`isLoadingVariants`) sehingga kasir tidak pernah mengalami dialog kosong atau macet.
4. **Flat Cart & Thermal Receipt Presentation:**
   - Nama produk bervarian disimpan secara linier sebaris (`${rawName} - ${variantName}`) tanpa bullet list bertingkat untuk menghemat kertas struk kasir 30%–50% dan mempercepat pembacaan staf barista/dapur.

---

## 3. Pure Append-Only Void & Refund (Zero DELETE Policy)

Dilarang keras melakukan `DELETE` atau menghapus rekaman pembayaran historis.

### 3.1 Void Per Baris Tender (Payment Line Void)
- Kasir dapat membatalkan baris tender tertentu jika salah memasukkan nominal atau salah memilih metode (misal terlanjur klik Tunai padahal pelanggan bayar QRIS).
- Alur:
  1. Panggil `POST /api/pos/order/payment-void` dengan `payment_id` dan `void_reason`.
  2. Sistem memasukkan baris baru ke `order_payments` dengan:
     - `payment_kind = 'void'`
     - `voided_payment_id = original_payment.id`
     - `shift_id = active_shift.id` (mengurangi kas fisik di laci kasir saat ini jika tunai).
  3. Memposting jurnal pembalik (Debit Piutang `103000`, Credit Kas/Bank).
  4. Menghitung ulang saldo terbayar (`orders.amount_paid`) dan status pembayaran (`orders.payment_status`).

### 3.2 Pembatalan & Refund Pesanan Penuh (Full Order Refund)
- Saat pesanan dibatalkan/direfund:
  1. Status pesanan diubah menjadi `'cancelled'`.
  2. `syncOrderToLedger()` membalikkan stok secara massal ke gudang dan menjurnal balik penjualan.
  3. Semua baris pembayaran aktif di-insert baris penyeimbang `payment_kind = 'refund'` dengan `shift_id = current_shift_id` (agar laci kasir yang mengeluarkan uang tunai fisik berkurang secara tepat).

### 3.3 Arsitektur Ketahanan Buku Besar Refund & Pencegahan Duplikasi (Ledger Resilience & Anti-Duplication)
Untuk menjamin integritas buku besar dan laci kasir saat terjadi pembatalan pesanan:
1. **Service Role / Admin DB Client on Refund:**
   - Endpoint `/api/pos/refund` dan background execution hook `after()` pada checkout wajib menggunakan `dbClient = supabaseAdmin || supabase`. Hal ini mencegah kegagalan RLS parsial (*partial commit*) di mana status pesanan berubah menjadi `cancelled`, namun penulisan `order_payments` bertipe `payment_kind = 'refund'` terblokir oleh RLS sesi kasir.
2. **Fatal Error on Payment Ledger Refund (`throw refErr`):**
   - Operasi insert `order_payments` penyeimbang refund **DILARANG KERAS** dibungkus hanya dengan `console.warn`. Jika penulisan refund gagal, operasi wajib melempar exception (`throw refErr`) agar pembatalan gagal secara atomik dan tidak menghasilkan desinkronisasi kas laci.
3. **Resilient Fallback for Missing Initial Payment Transaction:**
   - Di `syncOrderToLedger()`, jika transaksi header pembayaran awal (`paymentTx`) belum terbentuk di `transactions` (akibat kegagalan background sync saat checkout), sistem secara otomatis membaca baris aktif di `order_payments` (`payment_kind = 'payment'`) untuk menyusun jurnal pembalikan kas/bank secara akurat (Debit Piutang `103000`, Credit Kas/Bank sesuai tender masing-masing).
4. **Defensive PostgREST Self-Healing in `postJournalTransaction()`:**
   - Pada pengecekan transaksi eksisting (`select('id, journal_lines(id)')`), jika relasi nested `journal_lines` mengembalikan array kosong akibat batasan seleksi RLS, fungsi wajib melakukan verifikasi kedua secara langsung:
     ```typescript
     const { count, error } = await supabase
       .from('journal_lines')
       .select('id', { count: 'exact', head: true })
       .eq('transaction_id', tx.id)
     if (!error && (count ?? 0) > 0) hasLines = true
     ```
     Hal ini mencegah self-healing salah mengira transaksi belum memiliki baris jurnal, yang sebelumnya memicu duplikasi baris jurnal (2x, 3x, 9x) saat retry refund.
5. **Direct Shelf Restock untuk Nota POS:**
   - Mutasi pengembalian barang atas pembatalan/refund nota POS langsung mengembalikan stok barang ke rak display kasir (`bucket: 'main'` dengan `status: 'done'`), bukan ke karantina.
   - Catatan: mutasi stok fisik hanya terjadi pada produk bertipe `stock_type = 'tracked'`.

---

## 4. Standar Kode & Endpoint Terkait

| Endpoint / Komponen | Peran Arsitektur |
| :--- | :--- |
| `POST /api/pos/shifts` (`action: open`) | Buka shift kasir, catat modal awal dan akun sumber |
| `POST /api/pos/shifts` (`action: close`) | Rekonsiliasi expected vs actual, jurnal selisih kas, transfer setoran |
| `GET /api/pos/shifts?mode=monitoring` | Data real-time saldo laci seluruh kasir aktif untuk dashboard manajer |
| `POST /api/pos/order` | Checkout pesanan POS, validasi stok, insert multi-tender `order_payments` |
| `POST /api/pos/order/pay` | Penerimaan cicilan/pelunasan sisa piutang pesanan |
| `POST /api/pos/order/payment-void` | Void baris pembayaran spesifik secara *append-only* |
| `POST /api/pos/refund` | Batalkan & refund seluruh pesanan dengan atribusi laci aktif |
| `lib/paymentLedger.ts` | Universal backend payment engine (record, void, refund, recalculate) |
| `app/pos/components/CashPaymentModal.tsx` | Universal frontend payment modal (full, partial, split tender) |
| `app/pos/components/POSOrderDetailModal.tsx` | UI detail pesanan dengan riwayat payment ledger & aksi pay/void |
| `app/pos/components/ShiftModal.tsx` | UI buka/tutup shift dengan live reconciliation sheet |

---

## 5. Optimistic Action-First Checkout & Modul Universal

### 5.1 Real Action First (0ms Latency di Kasir)
- Di kasir fisik (retail/F&B), aksi nyata kasir dan pelanggan adalah prioritas utama: uang diserahkan, struk dicetak/ditampilkan, dan keranjang belanja langsung bersih seketika (0ms) agar kasir siap melayani antrian berikutnya.
- Pengiriman data transaksi ke server dilakukan melalui **Optimistic Background Sync** (fire-and-forget dengan error logging/alert), sehingga pelanggan tidak perlu menunggu latensi jaringan database.

### 5.2 Universal Reusable Payment Module ("Sekali Edit, Berubah Semua")
- **Backend (`lib/paymentLedger.ts`):** Seluruh logika validasi saldo, posting jurnal akuntansi, penambahan baris `order_payments`, dan sinkronisasi `orders.amount_paid` serta `orders.payment_status` dipusatkan dalam satu modul backend reusable. Endpoint `/api/pos/order/pay`, `/api/pos/order/payment-void`, dan checkout hanya bertindak sebagai *controller* tipis yang memanggil modul ini.
- **Frontend (`CashPaymentModal.tsx`):** Komponen modal pembayaran reusable yang mendukung mode Bayar Penuh, Cicilan/DP, dan Split Payment. Digunakan langsung oleh:
  1. Halaman Kasir POS (`POSWorkspace.tsx`) saat checkout baru.
  2. Modal Detail Pesanan (`POSOrderDetailModal.tsx`) saat pelunasan sisa tagihan.
  3. Halaman invoice atau penagihan piutang di masa mendatang.
- Penambahan metode tender baru (misal QRIS dinamis atau EDC Bluetooth) cukup dilakukan satu kali di `CashPaymentModal.tsx` dan otomatis aktif di seluruh sistem.

### 5.3 Sinergi Antara syncOrderToLedger() dan lib/paymentLedger.ts
- **`syncOrderToLedger()` (Master Order Orchestrator):**
  Mengelola siklus pesanan utuh: Mutasi Stok Fisik (`stock_moves`) + Kalkulasi HPP + Pengakuan Pendapatan + Jurnal Kas Pembayaran Awal + Pencatatan Baris `order_payments` + Loyalty Points. Digunakan saat order dibuat atau diubah statusnya di seluruh saluran (POS, WooCommerce Webhook, Invoice, Accurate ERP, Order Manual).
- **`lib/paymentLedger.ts` (Payment Lifecycle Specialist):**
  Mengelola transaksi pembayaran susulan: Pembayaran Cicilan Tahap 2 dst, Pelunasan Sisa Piutang, dan Pembatalan (Void) Baris Tender. Bekerja murni pada mutasi Kas/Bank dan Piutang Usaha (`103000`) tanpa memicu mutasi stok ulang.

---

## 6. Omnichannel & Two-Dimensional Order Payment Lifecycle

### 6.1 State Machine Pemisahan Dua Dimensi (Separation of Concerns)
Dalam siklus hidup pesanan modern omnichannel (POS, Online Store/WooCommerce, Invoice Penjualan, Accurate ERP), status pesanan dipecah menjadi dua mesin status (*state machines*) independen:
1. **Fulfillment / Operational Status (`orders.status`):**
   - Menggambarkan pergerakan fisik barang atau tahapan logistik: `pending` $\rightarrow$ `processing` $\rightarrow$ `shipped` $\rightarrow$ `completed` (atau `cancelled`).
2. **Financial / Settlement Status (`orders.payment_status`):**
   - Menggambarkan penyelesaian transaksi finansial kas/piutang: `unpaid` $\rightarrow$ `partial` $\rightarrow$ `paid`.
   - Dilengkapi nominal terbayar `orders.amount_paid` dan saldo piutang $\text{Piutang} = \max(0, \text{grand\_total} - \text{amount\_paid})$.

**Dilarang Keras:** Menjadikan `orders.status === 'completed'` sebagai satu-satunya indikator pesanan lunas. Pesanan online transfer berstatus `shipped` atau `processing` uangnya telah masuk ke rekening bank sejak awal, sehingga berstatus `paid`.

### 6.2 Aturan Settlement Non-COD vs COD (World-Class E-Commerce Standard)
| Metode Pembayaran | Fulfillment Status | Settlement Status (`payment_status`) | Waktu Pengakuan Kas di Jurnal Akuntansi & `order_payments` |
| :--- | :--- | :--- | :--- |
| **Non-COD** (Transfer Bank, Gateway, QRIS, CC) | `processing` / `shipped` / `completed` | **`paid` (Lunas)** | Seketika saat pesanan dibuat / diproses (pelanggan bayar di muka). `amount_paid = grand_total`. |
| **COD** (Cash on Delivery) | `processing` / `shipped` | **`unpaid` (Belum Bayar)** | Kas belum diterima (barang masih di kurir). `amount_paid = 0`. Jurnal mencatat piutang COD (`103000`). |
| **COD** (Cash on Delivery) | `completed` | **`paid` (Lunas)** | Diakui saat kurir menyetorkan uang remitansi kas/bank. `amount_paid = grand_total`. |

### 6.3 Single Source of Truth & Zero-Orphan Payment Records
- Setiap pesanan yang berstatus lunas (`paid`) atau cicilan (`partial`) **WAJIB** memiliki baris rekaman di tabel `order_payments`.
- Pada sinkronisasi pesanan (`syncOrderToLedger`), sistem melakukan *idempotent check*: jika pesanan non-COD berstatus dibayar namun belum ada baris di `order_payments`, sistem otomatis meng-insert baris pembayaran penyeimbang yang berelasi ke akun Bank/Kas tujuan.
- Riwayat pembayaran di Modal Detail Pesanan (`OrderDetailModal.tsx` & `POSOrderDetailModal.tsx`) membaca langsung dari `order_payments` dengan relasi ke akun buku besar, nama kasir/shift, referensi dokumen, dan status *append-only*.

### 6.4 Standar Kecepatan Akses Database (High-Performance Zero N+1)
- Untuk menyajikan status pembayaran dan ringkasan finansial di tabel pesanan (`OrderTable.tsx`), **DILARANG KERAS** melakukan query terpisah atau perhitungan loop di sisi JavaScript / client.
- Status pembayaran (`payment_status`) dan total terbayar (`amount_paid`) diagregasikan langsung pada tingkat PostgreSQL RPC (`get_order_list` dan `get_order_analytics_metrics`).
- Database PostgreSQL dioptimalkan dengan indeks komposit:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_orders_business_payment_status 
  ON public.orders (business_id, payment_status, created_at DESC);
  ```
- Pemfilteran multi-status (`unpaid`, `partial`, `paid`) dieksekusi di database server menggunakan klausa `AND (filter_payment_status IS NULL OR o.payment_status = ANY(filter_payment_status))`.

---

## 7. Unified Post-Purchase Service Hub (World-Class POS Standard)

Sesuai standar POS modern kelas dunia (Shopify POS & Lightspeed Retail), layanan purna jual kasir disatukan ke dalam **Pusat Layanan Nota & Transaksi POS**:
1. **Pelunasan Piutang / Cicilan (AR Collections)**
2. **Tukar Barang (Exchanges / Return & Replace)**
3. **Pengembalian Dana (Refunds)**

### 7.1 Pertukaran Barang Atomik (Atomic Exchange)
Transaksi tukar barang diproses secara atomik via `POST /api/pos/order/exchange`:
- **Isolasi Mutasi Stok Event-Sourced:**
  - Setiap sesi penukaran menggunakan ID dokumen unik (`exchangeId = crypto.randomUUID()`) dan `sourceType: 'order_exchange'`.
  - Ini mencegah tabrakan pada PostgreSQL unique constraint `uq_stock_moves_document_product_type (business_id, source_type, source_id, product_id, type)` meskipun pelanggan menukar barang dengan varian/produk yang sama dengan saat checkout awal.
- **Multi-Bucket Condition Routing:**
  - Barang retur kondisi layak jual (`condition: 'good'`) langsung masuk ke `bucket: 'main'` (+stok rak gudang aktif).
  - Barang retur cacat/rusak/kotor (`condition: 'damaged'`) masuk ke `bucket: 'quarantine'` tanpa mencemari stok siap jual.
  - Barang pengganti baru keluar dari `bucket: 'main'` (-stok rak gudang aktif).
- **Penyeimbangan Jurnal HPP & Persediaan:**
  - Sistem menghitung dampak selisih harga pokok: $\text{netCogs} = \text{newItemsCost} - \text{returnGoodCost}$.
  - Jika $\text{netCogs} > 0$: Debit `501000 HPP`, Credit `102000 Persediaan Barang`.
  - Jika $\text{netCogs} < 0$: Debit `102000 Persediaan Barang`, Credit `501000 HPP`.

### 7.2 Logika Matematika Penukaran pada Pesanan Piutang / Cicilan (Partial Debt)
Jika pesanan yang ditukar belum lunas (`amount_paid < grand_total`):
- $\Delta = \text{Nilai Barang Baru} - \text{Nilai Kredit Barang Retur}$.
- $\text{Total Baru} = \text{Grand Total Lama} + \Delta$.
- **Kasus A: Tukar Tambah ($\Delta > 0$):**
  Pelanggan membayar selisih $\Delta$ di kasir saat itu juga (`Debit Kas/Bank`, `Credit Penjualan`). Sisa pokok piutang pesanan tetap terjaga utuh.
- **Kasus B: Tukar Turun ($\Delta < 0$):**
  - **Jika Pembayaran Awal $\le$ Total Baru:**
    Pelanggan masih berhutang pada toko, sehingga **DILARANG KERAS** mengeluarkan uang tunai dari laci kasir! Selisih harga $\Delta$ otomatis memotong sisa piutang (`Debit Penjualan 401000`, `Credit Piutang Usaha 103000`).
  - **Jika Pembayaran Awal $>$ Total Baru:**
    Kasir hanya mengembalikan kelebihan uang fisik riil ($\text{Cash Refund} = \text{Paid} - \text{Total Baru}$) melalui `order_payments` bertipe `refund`, dan sisa tagihan dinyatakan lunas.

---

## 8. Cross-Shift Reconciliation & Audited Tender Breakdown

### 8.1 Atribusi Kas Fisik Lintas Shift
Ketika kasir pada Shift B menerima pelunasan tagihan piutang atau mengeluarkan refund kasir atas pesanan yang dibuat pada Shift A:
- Arus kas masuk/keluar dicatat ke `order_payments` dengan `shift_id = Shift B.id`.
- Uang fisik di laci Shift B bertambah (pelunasan) atau berkurang (refund).
- Endpoint `GET /api/pos/shifts?mode=shift_details` otomatis menarik nota-nota lintas shift tersebut (`is_cross_shift = true`) via query `order_payments.order_id`.

### 8.2 Pemisahan Rincian Tender Z-Report (Tender Breakdown Separation)
Pada Z-Report penutupan kasir, saldo kas dipisahkan secara teraudit:
- **`cash_sales`:** Penjualan tunai langsung atas pesanan shift ini.
- **`cash_ar_collections`:** Penerimaan pelunasan piutang atas pesanan masa lalu / shift lain.
- **`cash_refunds`:** Pengeluaran kasir untuk refund tunai.
- Saldo laci kasir riil:
  $$\text{Drawer Cash} = \text{Initial Cash} + \text{cash\_sales} + \text{cash\_ar\_collections} - \text{cash\_refunds} + \text{cash\_in} - \text{cash\_out}$$

---

## 9. Thermal Receipt Printing & Device Spooling Architecture (World-Class POS Standard)

Sistem pencetakan struk kasir thermal (POS) menggunakan arsitektur **Dual-Mode Hybrid Printing Engine** yang menggabungkan transmisi langsung biner perangkat (**Direct Web Bluetooth**) dan isolasi dokumen (**Isolated DOM via Hidden Iframe**) untuk menjamin hasil cetak struk 100% bersih, cepat, tanpa artefak antarmuka layar (*zero screen clutter*), dan tanpa keluar dari PWA (*zero PWA exit*).

### 9.1 Analisis Masalah Spooler Pihak Ketiga (The RawBT / OS Spooler Paradox)
1. **Penyebab Watermark Pihak Ketiga:**
   - Pada perangkat Android, printer thermal Bluetooth portable umumnya tidak memiliki driver resmi dari Google Mopria. Pengguna mengandalkan aplikasi perantara seperti **RawBT**.
   - Aplikasi RawBT versi gratis (*free-tier*) secara otomatis menyuntikkan teks *disclaimer* komersial di akhir kertas struk. Teks ini murni disisipkan oleh RawBT, bukan dari kode aplikasi ShapeUp CRM.
2. **Penyebab PWA Tertutup Saat Cetak:**
   - Memanggil `iframe.print()` atau `window.print()` pada Android PWA memicu *intent* peluncuran **Android System Print Spooler**.
   - Ini menyebabkan aplikasi PWA kehilangan fokus (*minimized/interrupted*), membuka antarmuka sistem Android atau jendela RawBT, dan kasir harus menekan tombol cetak ulang sebelum kembali ke kasir.
3. **Penyebab Teks Patah & Font Kasar:**
   - Penggunaan font monospace `Courier New` dengan kait tebal (*slab serif*) boros ruang horizontal.
   - Penyematan awalan `Rp ` pada kertas 58mm (lebar efektif 48mm / 32 kolom) menyebabkan kolom harga satuan dan total melebihi batas baris sehingga teks harga patah canggung menjadi dua baris (`1 x Rp ... Rp ...`).
   - Format tanggal yang menyertakan teks bulan dan zona waktu (`20 Okt 2026, 12.26 WIB`) terlalu panjang dan membuat kata `WIB` terdorong patah ke baris bawah.

### 9.2 Arsitektur Dual-Mode Mesin Cetak ShapeUp POS (`printerAdapter.ts`)
ShapeUp POS mengimplementasikan dua jalur transmisi yang saling melengkapi dengan mekanisme *auto-fallback*:

1. **Jalur 1: Direct Web Bluetooth ESC/POS (Mode Instan untuk Tablet / HP):**
   - Menggunakan **Web Bluetooth API** (`navigator.bluetooth`) yang didukung natively di Google Chrome (Android & Desktop).
   - Menghubungkan langsung ke karakteristik GATT write printer Bluetooth (mencakup UUID standar `000018f0`, `49535343`, `e7810a71`, dll).
   - Mengubah objek `ReceiptData` menjadi *raw byte sequence* ESC/POS biner (`encodeReceiptToEscPos`) dengan font hardware internal (Font A 12x24 dots).
   - Mentransmisikan paket data secara *chunked* (64 bytes) untuk mencegah *buffer overflow* pada mikrokontroler printer thermal.
   - **Keunggulan:** 
     - Kecepatan cetak 0.2 detik (instan).
     - **100% berada di dalam PWA** (tanpa keluar aplikasi).
     - **Bebas dari aplikasi RawBT** dan 100% bebas watermark.
   - **Safe Fallback:** Jika perangkat tidak mendukung Web Bluetooth (misal di iOS Safari) atau koneksi Bluetooth terputus, sistem secara otomatis beralih ke *Hidden Iframe System Print* tanpa memunculkan error fatal.

2. **Jalur 2: Printer Sistem via Hidden Iframe (Mode Desktop PC / Kabel USB):**
   - Untuk komputer/laptop kasir dengan printer kabel USB atau LAN, sistem merender struk ke dalam `pos-thermal-print-iframe`.
   - Komputer Windows/macOS mengenali printer lewat driver OS tanpa membutuhkan RawBT sama sekali (bebas watermark).
   - Mendukung **Chrome Kiosk Silent Printing** (`--kiosk-printing`), memungkinkan cetak 1-klik tanpa menampilkan popup konfirmasi print browser.

### 9.3 Standar Tipografi & Anti-Wrap Layout Struk
1. **Clean Modern Sans-Serif:**
   - Template struk menggunakan font sistem modern:
     ```css
     font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
     ```
   - Karakter huruf proporsional dan bersih, meningkatkan daya tampung teks per baris dan menghasilkan struk yang rapi setara standar retail modern (seperti Pawoon POS / Starbucks).
2. **Zero Currency Prefix ("Rp" Removal):**
   - Seluruh nominal harga ditampilkan sebagai angka murni dengan pemisah ribuan titik (contoh: `265.000`), tanpa awalan `Rp `.
   - Tata letak item produk: Nama produk di baris 1; Kuantitas x Harga Satuan di kolom kiri baris 2; Subtotal di kolom kanan baris 2 (*right-aligned*).
3. **Kompak Single-Line Date (`mode: 'receipt'`):**
   - Tanggal struk diformat via `formatDisplayDate(date, 'receipt', timezone)` menghasilkan string numerik ringkas: **`DD-MM-YYYY HH:mm`** (contoh: `20-10-2026 12:26`).
   - Tanpa imbuhan zona waktu (`WIB`) agar pas 1 baris utuh dan tidak terdorong ke baris baru.
4. **Universal Normal Weight & Zero-Bold Standard (Anti-Bleed):**
   - **Larangan Teks Bold:** Head printer thermal bekerja dengan memanaskan jarum pin. Penggunaan teks tebal (**Bold** / `font-weight: 600/700` pada HTML atau `ESC E 1` / `0x1B, 0x45, 0x01` pada ESC/POS) memicu *double-strike pulse* yang menyebabkan panas merambat ke serat kertas sekitar titik dot. Ini membuat huruf kecil, rincian produk, dan nominal harga meleber (*bleeding*), dempet, buram, serta mempercepat ausnya print-head.
   - **Universal Monoline / Normal Weight:** Seluruh template struk wajib menggunakan font weight normal (`font-weight: 400` / regular) tanpa perintah emphasized mode ESC/POS. Penekanan hierarki visual dilakukan murni melalui *font-size*, garis putus-putus pembatas (`divider`), dan huruf kapital (*uppercase*).
   - **Konsistensi WYSIWYG Live Previews:** Komponen pratinjau struk modal (`ReceiptPreviewModal.tsx`) dan live preview pengaturan struk (`ReceiptSettingsModal.tsx`) wajib meniadakan kelas `font-bold` dan `font-semibold` agar tampilan digital di layar 100% konsisten (*What You See Is What You Get*) dengan fisik kertas hasil cetak.

### 9.4 Kompensasi Lebar Efektif Kertas Thermal Fisik
| Ukuran Kertas | Lebar Fisik Roll | Area Cetak Efektif (*Printable Width*) | Karakteristik Head Thermal | CSS Aturan |
| :--- | :--- | :--- | :--- | :--- |
| **58mm** | 58 mm | **48 mm** | 384 dots (~32 karakter/baris) | `@page { size: 58mm auto; margin: 0; }` width: `48mm` |
| **80mm** | 80 mm | **72 mm** | 576 dots (~48 karakter/baris) | `@page { size: 80mm auto; margin: 0; }` width: `72mm` |
| **A4** | 210 mm | **180 mm** | Lembar standar printer desktop | `@page { size: A4 portrait; margin: 15mm; }` width: `180mm` |

### 9.5 Defense-in-Depth (@media print Fallback)
Pada komponen modal pratinjau (`ReceiptPreviewModal.tsx`), ditambahkan perlindungan lapis ganda:
- Tag `.no-print` disematkan pada backdrop, modal header, dan footer kontrol.
- Blok `<style>` `@media print` menyembunyikan semua elemen selain `#thermal-receipt-container` (`body * { visibility: hidden !important; }`).
- Hal ini menjamin jika kasir tidak sengaja menekan tombol shortcut cetak browser (`Ctrl+P` / `Cmd+P`), struk tetap tercetak bersih tanpa elemen modal di kertas.

---

## 10. Smartphone & Tablet Landscape Ergonomics (Countertop POS Stand Standard)

Pada operasional ritel & toko fisik kasir sering menempatkan smartphone atau tablet di atas meja counter kasir menggunakan *stand* dudukan secara horizontal (lanskap) untuk mempercepat entri transaksi dan memindai barcode pakaian.

### 10.1 Konfigurasi Manifest Bebas Rotasi (`orientation: any`)
- Berkas `public/manifest.json` wajib menyetel `"orientation": "any"` agar WebAPK Android dan iOS WebClip tidak mengunci orientasi ke potret.
- Transisi antara potret dan lanskap terjadi secara otomatis mengikuti sensor giroskop perangkat jika pengguna mengaktifkan fitur *Auto-Rotate* di pengaturan cepat sistem operasi ponsel.

### 10.2 Safe Area Horizontal Insets (`Zero Notch Collision`)
- Saat ponsel pintar dalam posisi lanskap, kamera depan (*punch-hole*), poni (*notch*), atau *Dynamic Island* berpindah ke sisi **kiri** atau **kanan** layar.
- Dokumen HTML root menyertakan `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` via `PWAHead` di `app/layout.tsx`.
- Kontainer luar `POSWorkspace.tsx` dan `POSHub.tsx` menerapkan padding safe-area:
  ```tsx
  style={{
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
  }}
  ```
  Ini mencegah tombol navigasi kembali, nama kasir, status shift, dan tombol aksi terpotong oleh lubang kamera ponsel.

### 10.3 Adaptasi Grid Katalog pada Orientasi Lanskap
- Lebar layar ponsel lanskap ($\sim 844\text{px} - 932\text{px}$) berada di atas breakpoint `sm:` (640px) dan `md:` (768px), sehingga grid produk otomatis melebar menjadi 3 hingga 4 kolom (`sm:grid-cols-3 md:grid-cols-4`).
- Area daftar produk dan keranjang belanja mempertahankan kontainer `overflow-y-auto` mandiri untuk mengakomodasi keterbatasan ruang vertikal ponsel lanskap ($\sim 350\text{px} - 400\text{px}$) dengan lancar.

---

## 11. Touch-First POS Order & Item Notes Architecture

Pencatatan instruksi khusus pesanan pada kasir POS dirancang berdasarkan prinsip Human-Computer Interaction (HCI), ergonomi layar sentuh, dan teori persistensi data transaksional.

### 11.1 Ergonomi Layar Sentuh & Direct Input (HCI Standard)
1. **Pencegahan Distraksi & Entri Catatan Bebas:**
   - Antarmuka difokuskan pada input textarea langsung yang bersih tanpa tombol chip preset yang memadati layar, memberikan keleluasaan penuh bagi kasir untuk mengetik instruksi pesanan yang relevan sesuai kebutuhan toko.
2. **Pencegahan Virtual Keyboard Viewport Occlusion & Auto-Zoom:**
   - Input textarea diformat dengan ukuran font $16\text{px}$ pada mobile (`text-base sm:text-xs`) untuk mencegah safari iOS melakukan *auto-zoom* viewport yang merusak tata letak.
   - Komponen modal menggunakan outer shell `FullScreenModal` terpusat (`desktopSize="sm"`), menjamin tombol aksi ("Batal", "Hapus", "Simpan Catatan") tetap berlabuh di atas keyboard virtual dengan target sentuh $\ge 44\text{px}$.

### 11.2 In-Memory Zero-Latency State & Safeguarded Persistence
1. **Zero-Latency Reactive State:**
   - Penambahan dan perubahan catatan dikelola $100\%$ di memori RAM browser (`useState` pada `POSWorkspace`).
   - Tidak ada network roundtrip atau debounce lag saat kasir menyunting catatan di keranjang.
2. **Hold & Resume Order Synchronization:**
   - Catatan global disimpan ke kolom `pos_held_orders.note`, dan catatan item tersimpan dalam `pos_held_orders.cart_json`.
   - Pembersihan cart (`setCart([])`, `setOrderNote('')`) hanya dieksekusi jika server mengonfirmasi keberhasilan simpan (`res.ok`), melindungi kasir dari kehilangan data draft jika koneksi jaringan terganggu.
3. **Optimistic Checkout with Local Variable Capture:**
   - Sebelum state lokal dibersihkan, nilai catatan diekstrak ke variabel lokal konstan (`const effectiveOrderNote = orderNote.trim() || undefined`).
   - Catatan langsung dipaketkan ke dalam struk instan (0ms) untuk dicetak, sekaligus disinkronkan ke endpoint `/api/pos/order`.

### 11.3 Database Theory & Event-Sourced Storage (Zero Migration)
1. **Item-Level Notes:**
   - Disimpan secara atomik di dalam objek baris produk pada kolom JSONB `orders.items_json[i].note` dan `line_items[i].meta_data[{ key: 'Note', value: '...' }]`.
2. **Global Order Notes:**
   - Disimpan pada kolom JSONB `orders.raw_source_data.notes` dan `orders.raw_source_data.customer_note`.
   - Pola ini menjamin **Zero Schema Migration**, bebas downtime, dan kompatibel 100% dengan ekosistem omnichannel (seperti sinkronisasi WooCommerce dan Accurate ERP).

### 11.4 Standar Cetak Thermal ESC/POS (Anti-Bleed Normal Weight & World-Class Bottom Placement)
- **Catatan Item (Line-Item Note):** Dicetak tepat di bawah baris nama produk dengan indentasi (`• Less ice, gula 50%`) menggunakan font reguler/normal (tanpa emphasized mode `0x1B, 0x45, 0x01`).
- **Catatan Global Pesanan (Order-Level Note):** Dicetak pada **bagian bawah struk** setelah rincian pembayaran & status piutang (dan sebelum Loyalty Rewards / Catatan Kaki Toko) dalam blok bergaris putus-putus (`Catatan Pesanan: Meja 04 - Bawa pulang, titip kasir sampai jam 17:00`). Penempatan ini menjamin alur membaca cepat (*F-Pattern reading*) pelanggan tidak terganggu oleh instruksi panjang sebelum melihat daftar barang belanjaan.

---

## 12. Unified POS Receipt Engine Architecture (Single Source of Truth)

Untuk mencegah fragmentasi antarmuka dan deviasi visual antara pratinjau di layar dengan fisik kertas printer thermal, sistem menerapkan arsitektur terpadu 3 lapis (*Unified Engine*):

### 12.1 Normalisasi Data Terpusat (`lib/pos/receiptDataBuilder.ts`)
Seluruh jalur transaksi (POS Checkout, Layanan Nota & Piutang `POSOrderDetailModal`, Riwayat Pesanan, POSHub Quick Print, dan Z-Report Reprint) **WAJIB** menggunakan `buildReceiptDataFromOrder(order, options)`.
- Mengonsolidasikan pembacaan konfigurasi toko dari `receiptSettings.ts` (nama toko, alamat, telepon, nomor urut item, catatan kaki).
- Memetakan varian, catatan item, kuantitas, harga, diskon, dan subtotal secara seragam.
- **Dukungan Penuh Layanan Nota & Piutang:** Otomatis menghitung `amountPaid`, `outstandingAmount`, dan status penagihan (`STATUS: BELUM LUNAS` beserta `SISA PIUTANG` jika transaksi bertipe tempo/cicilan, atau `STATUS: LUNAS`).
- Mengekstrak catatan global dari berbagai fallback (`order.order_note`, `order.notes`, `raw_source_data.customer_note`, `raw_source_data.notes`).

### 12.2 Single Visual Representation & 100% WYSIWYG
- Fungsi `generateReceiptHtml(receipt, paperSize)` dalam `lib/pos/printerAdapter.ts` bertindak sebagai satu-satunya *template engine* untuk representasi visual HTML.
- **Zero JSX Duplication:** Komponen pratinjau modal (`ReceiptPreviewModal.tsx`) dan live preview pengaturan (`ReceiptSettingsModal.tsx`) merender langsung HTML hasil `generateReceiptHtml` ke dalam *sandboxed iframe*.
- Mengubah format, padding, garis pembatas, atau penempatan blok di `generateReceiptHtml` otomatis memperbarui tampilan pratinjau di modal, live preview di pengaturan, dan cetakan printer sistem via iframe seketika (*zero-drift*).

### 12.3 Dual-Mode Mirroring (ESC/POS Bluetooth & System Printer)
- Generator biner ESC/POS `encodeReceiptToEscPos(receipt, paperSize)` di-mirror 1-to-1 dengan urutan HTML:
  1. Header Toko (Nama, Alamat, Telp)
  2. Metadata (Invoice, Tanggal, Kasir, Pelanggan)
  3. Daftar Item (Nama, Varian, Catatan Item, Qty x Harga, Diskon, Subtotal)
  4. Perhitungan Total (Subtotal, Diskon Promo, Pajak, TOTAL)
  5. Rincian Pembayaran & Piutang (Metode, Tunai, Kembalian, Status Lunas/Belum Lunas, Sisa Piutang)
  6. **Catatan Global Pesanan** (Di bawah pembayaran, sebelum loyalty)
  7. Loyalty Rewards (Tier, Poin Transaksi, Total Saldo Poin)
  8. Catatan Kaki Toko & Branding ("Powered by ShapeUp POS")

---

## 13. POS Workspace Responsive Architecture & Cashier UX Standards (Indonesian Retail Benchmark)

Modul register transaksi kasir (`POSWorkspace.tsx`) dirancang untuk operasional toko retail & F&B intensitas tinggi dengan standar benchmarking POS Indonesia (Moka POS, Pawoon, Majoo, Square).

### 13.1 Split-Screen Layout & Anti-Clipping Minimum Widths
- **Breakpoint Split-Screen:** Diaktifkan mulai layar medium/tablet (`md:` $\ge 768\text{px}$). Katalog produk di sisi kiri (`flex-1 min-w-0`), keranjang struk di sisi kanan.
- **Lebar Panel Keranjang:** Ditetapkan minimal `w-[320px] - w-[340px]` pada breakpoint `md:` (skala `md:w-[330px] lg:w-[360px] xl:w-[390px] 2xl:w-[420px]`) dipadukan dengan `overflow-hidden` dan `min-w-0`.
- **Rasional Anti-Clipping:** Mata uang Rupiah umumnya berjumlah 6–7 digit (`Rp 993.000` / `Rp 1.500.000`). Lebar di bawah 320px berisiko terpotong (*clipped*) ketika kasir memiliki item dengan kuantitas multi-digit, tombol `Hold`, dan tombol checkout berbobot penuh.

### 13.2 Adaptive Multi-Column Catalog Density (Zero Wasted Screen Space)
- Grid kartu produk wajib adaptif mengikuti lebar viewport:
  `grid grid-cols-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-3 sm:gap-3.5`
- **Mencegah Masalah "Layar Penuh Sisa Ruang":** Pada monitor widescreen desktop/PC kasir (1080p/1440p), grid 5–6 kolom memastikan kartu produk berukuran rapat, proporsional, dan tidak melar berlebihan, sehingga kasir dapat memindai 15–24 produk sekaligus tanpa scroll berlebih.

### 13.3 Lean Bill Summary & Separation of Concerns (Diskon Item vs Diskon Global)
- **Baris TOTAL Duplikat Dihapus:** Menghilangkan baris teks `TOTAL` statis. Grand total diintegrasikan langsung ke dalam tombol checkout: `[ Bayar • Rp 993.000 → ]`.
- **Pemisahan Mutlak Diskon Global:**
  - `🏷️ Diskon Global` murni membaca `globalDiscountAmount > 0` (input dari modal diskon pesanan), bukan total akumulasi item discount. Jika belum ada diskon global, tombol hijau `[+ Diskon Global]` tetap tersedia.
  - Potongan diskon per-item tidak dimunculkan sebagai baris tersendiri di ringkasan footer agar tidak memenuhi ruang vertikal; cukup ditampilkan pada baris item dengan tanda harga coret (*strikethrough*).

### 13.4 Primary Action UX Psychology (High-Contrast Royal Blue)
- **Tombol Bayar Utama:** Menggunakan **Solid Royal Blue (`bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white`)** dengan kontras chip nominal `bg-blue-800/50`.
- **Psikologi UX Kasir:** Warna biru tegas adalah standar industri (Moka POS `#2B6CB0` & Square POS) yang melambangkan transaksi finansial resmi, dapat dibaca jelas dari sudut pandang kasir miring (*glanceable*), dan tidak membuat mata lelah dibandingkan warna pink/magenta/pastel informal.
- **Indikator Shift Belum Buka:** Jika shift belum dibuka, tombol otomatis berubah menjadi kuning/amber peringatan (`bg-amber-600`) dengan teks `Buka Shift Dulu 🔑`.

### 13.5 Item Auto-Wrap & Full-Width Multiline Notes
- Nama produk yang panjang menggunakan `line-clamp-2 break-words` agar varian dan harga kanan tidak pernah terdorong keluar layar.
- Catatan khusus item (`item.note`) dipajang sebagai balok terpisah full-width di bawah harga dengan `break-words whitespace-normal` agar instruksi dapur/gudang panjang tidak terpotong elipsis (`...`).

---

## 14. POS Price Floor Guard & Manager Override Architecture (World-Class Retail Benchmark)

Modul proteksi batas harga (*Price Floor Guard*) dirancang mengacu pada standar POS kelas dunia (Odoo POS, Microsoft Dynamics 365 Commerce, Oracle Micros Simphony, SAP Point of Sale) untuk melindungi margin bisnis dan mencegah penjualan di bawah modal (HPP) tanpa persetujuan berwenang.

### 14.1 Zero-Knowledge Cashier Principle (Kerahasiaan Angka HPP)
- **Aturan Kerahasiaan:** Kasir **DILARANG KERAS** melihat nominal angka HPP (*cost price*) atau angka harga minimum di antarmuka kasir.
- **Implementasi UX:**
  - Evaluasi $P_{\text{net}} < \text{HPP}$ dihitung secara boolean di memori komponen kasir.
  - Saat pelanggaran terjadi, antarmuka hanya menampilkan indikator minimal:
    `⚠️ Harga di bawah batas minimum`
  - Tombol simpan dinonaktifkan atau digantikan tombol `🔐 Minta Otorisasi`.
  - Nominal HPP tetap tersembunyi dari pandangan kasir maupun pelanggan di meja kasir.

### 14.2 Dual-Tier Hierarchy: Global Enforcement vs Per-Product
- **Global Toggle (`global_enabled`):**
  - Jika aktif: seluruh katalog produk otomatis terkunci batas HPP-nya tanpa pengecualian.
  - Pada modal edit produk, saklar `prevent_below_hpp` terkunci aktif (*disabled with notice*).
- **Per-Product Toggle (`products.prevent_below_hpp`):**
  - Jika pengaturan global nonaktif: proteksi hanya berlaku untuk produk-produk yang saklarnya diaktifkan secara manual.
- **Dual-Write Resilience:**
  - Konfigurasi disimpan ke tabel `price_guard_settings` dan di-mirror ke tabel `integrations` (`platform_name = 'pos_price_guard'`) dengan *in-memory cache* (TTL 60 detik) untuk menjamin operasional kasir tetap berjalan instan (0ms).

### 14.3 Flexible Authorization Checklist Matrix
Bentuk otorisasi ditentukan oleh checklist mandiri di Pengaturan POS (`/settings/pos`):

| `require_approver_pin` | `require_reason` | Perilaku Antarmuka Kasir | Status Sistem |
| :---: | :---: | :--- | :--- |
| **OFF** | **OFF** | **Hard Block:** Tombol Simpan disabled. Kasir mutlak dilarang menjual di bawah HPP. | Blokir Total |
| **ON** | **OFF** | **PIN Only:** Kasir memilih nama Approver dan memasukkan 6 digit PIN. | Otorisasi Cepat |
| **OFF** | **ON** | **Reason Only:** Kasir memasukkan alasan teks bebas (tersimpan ke audit trail). | Self-Attestation |
| **ON** | **ON** | **Dual Factor:** Kasir wajib memilih Approver, memasukkan PIN, dan mengisi alasan. | Proteksi Maksimal |

### 14.4 Personal 6-Digit Approver PIN & Rate-Limited Lockout
- **Model PIN Personal:** PIN bersifat pribadi per approver (Owner selalu berstatus approver; staf dapat ditunjuk sebagai approver melalui Pengaturan POS atau izin `can_approve_pos`).
- **Kriptografi:** PIN 6 digit di-hash menggunakan algoritma `scrypt` berkekuatan tinggi dengan garam kriptografis (*salt*) unik per baris di tabel `pos_approver_pins`.
- **Proteksi Brute-Force (Lockout):** Jika PIN salah 5 kali berturut-turut, akun approver terkunci selama 5 menit (`locked_until`).
- **Self-Service PIN:** Approver mengatur/memperbarui PIN-nya sendiri melalui menu **PIN Otorisasi POS Saya** di Pengaturan Staf (`/settings/staff`) dengan verifikasi kata sandi akun untuk mencegah pembajakan sesi. Owner/Admin memiliki wewenang untuk me-reset PIN staf jika lupa.

### 14.5 Omnichannel Global Discount Gating
- Diskon global keranjang belanja memiliki saklar independen (`require_global_discount_auth`, default OFF).
- Jika diaktifkan, penerapan diskon global keranjang (persen maupun nominal) wajib melewati alur otorisasi manajer sebelum diterapkan dan sebelum pesanan dapat dibayar.

### 14.6 Pure Append-Only Audit Trail (`price_override_logs`)
Setiap kali otorisasi disetujui (baik item harga satuan maupun diskon global):
- Dicatat permanen ke tabel `public.price_override_logs` mencakup:
  - `business_id`, `shift_id`, `requested_by` (kasir), `approved_by` (approver)
  - `trigger` (`'line_price'` / `'global_discount'`), `product_id`, `qty`, `requested_net_price`, `cost_snapshot`
  - `reason` (alasan teks bebas) dan `created_at`
- **Keamanan RLS:** Tabel ini dilindungi RLS ketat; hanya Owner dan Admin yang dapat melihat riwayat log untuk audit internal, sedangkan kasir hanya dapat meng-insert rekaman log saat otorisasi berhasil.

### 14.7 Server-Side Enforcement (HTTP 422 Unprocessable Entity)
- Validasi tidak hanya mengandalkan JavaScript di browser klien kasir.
- Endpoint `POST /api/pos/order` memvalidasi ulang seluruh baris pesanan terhadap HPP dan status otorisasi di database. Jika terdapat item di bawah HPP yang belum diotorisasi atau token otorisasi tidak valid, transaksi ditolak dengan HTTP 422.

### 14.8 Atomic Auto-Apply & Auto-Dismiss UX Standard (Zero Drop State)
- **Komitmen Atomik Instan (Atomic Auto-Commit):**
  Saat otorisasi manajer/approver berhasil divalidasi (PIN valid):
  1. Payload otorisasi (`authRecord`) didaftarkan ke state otorisasi (`authorizations.set(...)`).
  2. Nilai diskon baru (`discountType` & `discountValue` atau harga bersih item) **wajib langsung di-commit secara atomik ke state keranjang belanja** di dalam `onSuccessCallback`.
  3. Modal otorisasi DAN modal pengeditan langsung tertutup bersamaan (*auto-dismiss*), mengembalikan kasir langsung ke layar kasir utama dengan nilai diskon yang sudah terpasang rapi di keranjang (0 redundant click). Dilarang keras menutup modal tanpa meng-commit state nilai diskon.
- **Wajib Otorisasi Ulang Saat Nilai Diubah (Re-Authorization on Modification):**
  - **Diskon Global:** Jika kasir membuka kembali modal diskon global dan mengubah nilai atau tipe potongan (`isValueChanged === true`), status otorisasi lama otomatis menjadi tidak valid (`isApproved = false`). Tombol berubah menjadi `🔐 Minta Otorisasi Diskon` dan manajer wajib mengotorisasi ulang nilai diskon yang baru.
  - **Item Keranjang:** Jika kasir membuka kembali modal edit item dan menurunkan harga bersih lebih rendah daripada harga yang diotorisasi sebelumnya (`netUnitPrice < previousApprovedPrice`), status otorisasi otomatis batal dan wajib meminta otorisasi baru.
  - **Penghapusan Diskon:** Jika kasir menghapus diskon (nilai = 0 atau tombol Hapus), diskon dibatalkan dan rekaman otorisasi terkait dihapus dari memori keranjang tanpa memerlukan PIN.

---

## 15. POS Held Orders Lifecycle, Anti-Duplication Upsert & Auto-Cleanup Standard

Dalam operasional ritel & kasir yang sibuk, pelanggan sering kali menunda pembayaran sementara untuk mengambil barang tambahan (*Hold Order*). Sistem POS ShapeUp CRM menerapkan standar baku untuk mengelola siklus hidup pesanan tertahan (*Held Orders*) agar tercegah dari duplikasi dan data yatim (*orphan drafts*):

### 15.1 In-Place Upsert Anti-Duplikasi (Zero Duplication)
- **Pelacakan Status Aktif (`activeHoldId`):**
  - Ketika kasir me-resume pesanan tertahan dari modal draf via `handleResumeHoldOrder(h)`, sistem wajib menyimpan `h.id` ke dalam React state `activeHoldId`.
  - Di atas keranjang belanja ditampilkan indikator visual yang jelas (`📥 Mengedit Draft Hold`) dan tombol aksi utama berubah label menjadi **"Update Hold"** (dengan aksen warna amber).
- **In-Place Update di Database (`pos_held_orders`):**
  - Saat kasir menekan tombol "Update Hold", endpoint `POST /api/pos/hold` memeriksa keberadaan parameter `hold_id`.
  - Jika `hold_id` valid, endpoint mengeksekusi perintah SQL `.update(...)` pada baris yang sama (bukan membuat baris baru).
  - Kolom timestamp `created_at` diperbarui ke waktu sekarang (`now()`) agar draf yang baru saja diupdate otomatis naik ke urutan teratas pada daftar draf kasir.
  - Di sisi antarmuka, state lokal `heldOrders` menggantikan entri lama secara *in-place*, sehingga jumlah transaksi tertahan tetap konsisten (1 draf) tanpa duplikasi ganda.

### 15.2 Auto-Cleanup Saat Transaksi Selesai (Zero Orphan Records)
- Ketika kasir menyelesaikan pembayaran atas keranjang yang berasal dari draf hold (`activeHoldId !== null`):
  - Sistem langsung mengosongkan keranjang dan menampilkan struk pembayaran (0ms latency bagi kasir & pembeli).
  - Secara bersamaan, sistem memicu pembersihan draf di latar belakang (*Optimistic Fire-and-Forget*):
    `POST /api/pos/hold` dengan body `{ action: 'delete', hold_id: completedHoldId }`.
  - Draf tersebut otomatis terhapus dari tabel `pos_held_orders` dan hilang dari modal draf kasir, mencegah draf basi yang sudah lunas dibuka kembali secara tidak sengaja.

### 15.3 Isolasi Multi-Tenant Kebal RLS (`dbClient = supabaseAdmin || supabase`)
- Untuk mencegah draf gagal tersimpan/ter-update akibat latensi sinkronisasi kolom `profiles.active_business_id` pada akun staf kasir, endpoint `/api/pos/hold` menggunakan `dbClient = supabaseAdmin || supabase`.
- Operasi database selalu diproteksi secara ketat dengan filter ganda `.eq('id', hold_id).eq('business_id', businessId)`. Integritas *multi-tenant* tetap terisolasi 100% dan proses *upsert* dijamin kebal kegagalan otentikasi sesi.

### 15.4 Parallel Initial Loading (0ms Latency Overhead)
- Saat antarmuka POS pertama kali dimuat (`POSWorkspace.tsx`), pemanggilan `GET /api/pos/hold` disatukan ke dalam `Promise.all` bersama katalog produk, kategori, dan bagan akun.
- Kasir yang melakukan *refresh browser* atau membuka sesi kasir baru akan langsung melihat jumlah draf aktif tanpa latensi jaringan tambahan.

---

## 16. Odoo-Style High-Throughput Cashier Payment Screen & Ergonomic Keypad Engine

Untuk mentransformasi antarmuka pembayaran kasir dari form input statis menjadi mesin transaksi berkecepatan tinggi (*high-throughput terminal*) dengan target waktu penyelesaian (*Average Handling Time* / AHT) $< 4$ detik, sistem menerapkan arsitektur Odoo-style payment engine terpadu:

### 16.1 Left Keypad & Right Canvas Layout (Odoo Terminal Architecture)
- **Rasio Layar 38% Kiri : 62% Kanan:**
  - **Panel Kiri (38% - Action & Control Pad):**
    - Baris Saklar Toggle Metode Pembayaran (`handleToggleTender`).
    - Kartu info pelanggan riil (`customerName`, `customerPhone`).
    - Tombol cepat Split Bill (`[ ✂ Split Tagihan ]`).
    - Keypad numerik sentuh 4-kolom berukuran besar ($\ge 54\text{px}$) dengan digit `1–9`, tombol cepat pecahan uang `+10k`, `+20k`, `+50k`, tombol `0`, `000`, dan `⌫ Backspace`.
    - Footer aksi: Tombol `Batal (Esc)` dan tombol utama `Validate (Enter / Spasi)` berlatar ungu khas Odoo (`#714B67`).
  - **Kolom Kanan (62% - Display Canvas):**
    - Display Grand Total Tagihan raksasa berwarna hijau emerald kontras tinggi di bagian paling atas.
    - Banner mode Split Bill aktif (dengan tombol Ubah & Reset jika aktif).
    - Status Dua Arah (Sisa Tagihan vs Kembalian).
    - Daftar Baris Pembayaran Aktif Datar (*Flat Seamless List*) tanpa kotak berlapis.
    - Footer rincian: Total Terbayar dan Status Pelunasan (`LUNAS`, `BELUM LUNAS`, `LEBIH`).
- **100dvh Zero-Scroll:** Seluruh antarmuka terkunci pada tinggi viewport perangkat tanpa scrollbar halaman luar.

### 16.2 Toggle On/Off Tender Switch (Panel Kiri) vs Right-Canvas Focus Activation
- **Panel Kiri (Saklar Switch On/Off):**
  - Mengklik chip metode pembayaran di panel kiri berfungsi murni sebagai **Toggle Saklar**:
    - **Saat MATI (Belum dipilih):** Tombol berlatar putih dengan badge `+ Nyalakan`. Mengkliknya akan **MENYALAKAN** metode tersebut (menambahkan baris baru ke daftar pembayaran dan mengalokasikan sisa tagihan).
    - **Saat NYALA (Sudah ada):** Tombol berlatar hijau emerald dengan badge `● Nyala` dan nominalnya. Mengklik kembali tombol ini akan **MEMATIKAN / MENGHAPUS** baris pembayaran tersebut dari daftar pembayaran.
- **Kolom Kanan (Aktivasi Fokus Edit Numpad):**
  - Pemilihan baris yang sedang diedit angkanya oleh numpad dilakukan dengan **mengklik baris pembayaran di kolom kanan** (`onClick={() => { setActiveLineId(line.id); setIsFirstTouch(true); }}`).
  - Baris yang sedang terfokus memiliki badge emerald `● Diedit` dan efek highlight visual (`ring-2 ring-emerald-500/20`) sehingga kasir tahu persis pengetikan numpad akan mengubah baris mana.

### 16.3 Numpad Cash Input & Overpayment Retention (Anti-Reset Standard)
- **Pertahankan Nominal Riil Input Kasir (`cashReceived`):**
  - Ketika kasir menginput nominal uang tunai yang melebihi tagihan (misal: sisa tagihan Rp 184.390, kasir mengetik lembaran uang Rp 200.000 atau Rp 9.000.000):
    - Pada baris Tunai di kolom kanan dan badge panel kiri, angka yang ditampilkan **TETAP NOMINAL RIIL** yang diinput kasir (`formatIDR(line.cashReceived)`), **DILARANG KERAS** di-clamp/reset ke total tagihan di UI agar kasir tidak bingung.
    - Porsi penutupan tagihan dicatat di `line.amount` (Rp 184.390), dan kelebihan pembayaran otomatis dialirkan ke kartu **Kembalian (Change)**.
- **Perlindungan Multi-Tender (Zero Unintentional Zeroing):**
  - Pada transaksi split 2 metode (misal: Transfer Rp 50.000 + Tunai sisa Rp 50.000), jika kasir mengetik uang tunai melebihi sisa tagihan (misal Rp 100.000):
    - Metode Transfer yang Rp 50.000 **TIDAK BOLEH di-nol-kan**.
    - Baris Tunai mengalokasikan Rp 50.000 untuk menutup sisa tagihan, menerima uang tunai Rp 100.000, dan menghasilkan kembalian Rp 50.000.

### 16.4 Flat Seamless List & Zero-Scrollbox Architecture
- **Eliminasi "Box di Dalam Box":**
  - Menghapus pembungkus border 2px tebal per baris (`rounded-2xl border-2`).
  - Baris pembayaran disusun dalam format list datar (*flat list*) dengan pembatas halus (`divide-y divide-slate-100`) yang menyatu elegan dengan canvas box utama.
- **Zero-Scrollbox Utility:**
  - Mengganti `max-h-72` kaku dengan `flex-1` agar memanfaatkan tinggi penuh viewport.
  - Menerapkan utilitas peredam scrollbar lintas-browser: `[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`.
  - Bilah abu-abu vertikal (scroll box) hilang 100%, namun kasir tetap dapat men-scroll dengan mulus jika baris transaksi sangat banyak.

### 16.5 First-Touch Auto-Replace & Auto-Redistribution
- **Auto-Replace on First Touch (`paymentKeypadCalculator.ts`):** Saat kasir memilih atau berpindah ke suatu baris pembayaran yang sudah memiliki nilai prefilled, sentuhan pertama pada tombol angka numpad langsung **menimpa (*overwrite*)** nilai lama. Sentuhan berikutnya beralih ke mode *append*.
- **Auto-Redistribution on Delete:** Ketika kasir mematikan/menghapus baris tender:
  - Jika tersisa 1 baris, baris tersebut otomatis memperluas alokasinya kembali ke nilai tagihan penuh.
  - Jika tersisa beberapa baris, sisa nominal yang bebas otomatis didistribusikan ke baris aktif.

### 16.6 Dedicated Receipt Modal (`isReceiptDetailsOpen`)
- Tombol `🧾 Rincian Pesanan (X)` diletakkan di navbar atas.
- Mengklik tombol ini membuka modal pop-up dialog berlatar blur yang menampilkan seluruh menu, varian, dan harga secara terpisah. Jika daftar belanjaan sangat panjang, daftar dapat di-scroll di dalam pop-up tanpa merusak tata letak layar utama pembayaran kasir.

### 16.7 Headless Global Keyboard Shortcuts
- Numpad 0–9 memasukkan digit angka.
- Backspace menghapus digit terakhir; Delete / C mereset ke 0; Escape menutup modal (jika nilai 0).
- Enter atau Spasi mengeksekusi validasi transaksi.
- Pintasan `Alt + 1..n` mengoperasikan saklar Toggle metode pembayaran secara instan tanpa menggunakan mouse.

---

## 17. Enterprise POS Returns, Granular Exchanges & Contra-Revenue Accounting Engine

Untuk menghadirkan alur retur, tukar guling (exchange), dan penerbitan nota kredit (*Credit Note*) kelas enterprise setara Square, Shopify POS, dan Lightspeed Retail, sistem menerapkan mesin retur terdesentralisasi berbasis event sourcing dengan integritas akuntansi *contra-revenue*:

```
                               ┌─────────────────────────────────────────────────────────────┐
                               │                    PELANGGAN RETUR / TUKAR                  │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                                            [ Validasi Kebijakan Toko & Sisa Qty ]
                                            [ Manager PIN Gate jika Melebihi Batas ]
                                                              ▼
                               ┌─────────────────────────────────────────────────────────────┐
                               │       Kalkulasi Kuotasi Retur Adil (Prorated Discount)      │
                               │           Gross Price - Line Discount - Order Prorated      │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                    ┌─────────────────────────────────────────┴─────────────────────────────────────────┐
                    ▼                                                                                   ▼
      [ DISPOSISI BARANG FISIK ]                                                          [ SETTLEMENT RESOLUTION ]
  ┌───────────────────────────────────┐                                               ┌───────────────────────────────────┐
  │ • Restock (Rak Display / Main)    │                                               │ • Refund Kas (Laci / Bank)        │
  │ • Karantina (Inspeksi Mutu)       │                                               │ • Store Credit (Buku Besar Saldo) │
  │ • Buang / Rusak (Beban Kerugian)  │                                               │ • Tukar Barang (Exchange Catalog) │
  └─────────────────┬─────────────────┘                                               └─────────────────┬─────────────────┘
                    │                                                                                   │
                    ▼                                                                                   ▼
      [ Mutasi Stok (stock_moves) ]                                                       [ Journal Entries (Contra-Rev) ]
      - status: done, bucket sesuai                                                       - Dr. 401100 Potongan & Retur
      - trigger perbarui rak/varian                                                       - Cr. 101xxx / 203xxx (Refund)
                                                                                          - Dr. 104000 Persediaan / Cr. HPP
```

### 17.1 Granular Partial Returns & Single Source of Truth (`pos_returns`, `pos_return_items`)
- **Pemisahan dari Void Nota Penuh:**
  - Pembatalan nota penuh (*order void/refund*) membatalkan seluruh pesanan sekaligus.
  - Retur granular memungkinkan pengembalian **sebagian item** ($1$ dari $5$ item), kuantitas parsial ($2$ dari $10$ pcs), serta alasan retur independen per baris.
- **Append-Only Event Sourcing:**
  - Setiap transaksi retur menghasilkan header `pos_returns` baru dengan penomoran unik format `RET-YYMMDD-XXXX` (atau Credit Note `CN-YYMMDD-XXXX`).
  - Rincian item yang diretur dicatat dalam `pos_return_items` yang mengunci harga satuan asli, diskon prorata, nominal bersih yang dikembalikan, kuantitas retur, kondisi barang (*disposition*), dan alasan retur.
  - Sisa kuantitas barang yang dapat diretur (`returnable_qty`) dihitung dinamis melalui view `v_pos_returnable_items` (`original_qty - SUM(returned_qty)`). Item yang kuantitas retur kumulatifnya sudah mencapai kuantitas beli awal otomatis terkunci (*disabled*).

### 17.2 Triad Disposisi Fisik Barang (`restock`, `quarantine`, `discard`)
Setiap baris barang yang diretur wajib ditentukan disposisi fisiknya:
1. **Restock (`restock` $\rightarrow$ Rak Toko / Gudang Utama):**
   - Barang dalam kondisi prima dan layak jual kembali.
   - Menginsert mutasi `stock_moves` dengan `bucket = 'main'`, `type = 'receipt'`, `status = 'done'`.
   - Trigger database `sync_product_stock_from_moves` otomatis menambah stok fisik rak pajangan (`products.stock_quantity` dan `product_variants.stock_quantity`).
2. **Karantina (`quarantine` $\rightarrow$ Gudang Karantina & Mutu):**
   - Barang membutuhkan inspeksi mutu lebih lanjut atau klaim garansi vendor.
   - Menginsert mutasi `stock_moves` dengan `bucket = 'quarantine'`, `type = 'receipt'`, `status = 'done'`.
   - Stok karantina dicatat terisolasi tanpa mencemari stok siap jual di rak toko utama.
3. **Pemusnahan / Rusak Total (`discard` $\rightarrow$ Beban Kerusakan):**
   - Barang rusak parah, kedaluwarsa, atau pecah dan tidak dapat dijual lagi.
   - Tidak menambah stok rak display. Nilai HPP barang langsung diakui sebagai beban kerugian barang rusak/kedaluwarsa.

### 17.3 Matematika Diskon Prorata Adil (*Fair Prorated Refund Mathematics*)
Untuk mencegah pengembalian dana yang melebihi jumlah uang yang dibayarkan pelanggan saat pembelian awal dengan diskon global/kupon, harga bersih pengembalian per unit dihitung secara matematis via `lib/pos/returns/engine.ts`:

$$\text{Line Gross} = \text{Unit Price} \times \text{Item Qty}$$
$$\text{Line Discount} = \text{Item Discount}$$
$$\text{Order Prorated Discount} = \text{Global Discount} \times \left( \frac{\text{Line Gross} - \text{Line Discount}}{\sum (\text{Line Gross} - \text{Line Discount})} \right)$$
$$\text{Net Return Per Unit} = \frac{(\text{Line Gross} - \text{Line Discount}) - \text{Order Prorated Discount}}{\text{Item Qty}}$$

Kasir dan pelanggan dijamin menerima nominal pengembalian yang 100% adil dan presisi hingga pembulatan rupiah terdekat tanpa risiko kebocoran kas toko.

### 17.4 Biaya Restocking & Pengecualian Cacat (*Restocking Fee & Defective Waiver*)
- Kebijakan toko (`pos_return_policies`) dapat menerapkan biaya penanganan (*restocking fee*) berupa persentase (misal $10\%$) atau nominal tetap.
- **Defective Waiver:** Jika alasan retur pelanggan adalah barang rusak/cacat pabrik (`reason === 'defective'`), sistem secara otomatis **menghapuskan biaya restocking ($0\%$)** sebagai bentuk perlindungan hak konsumen.
- Biaya restocking diakui sebagai pendapatan lain-lain toko (`403000 Pendapatan Lain-lain` atau `401100 Potongan Retur`).

### 17.5 Tukar Guling (Granular Exchanges) & Anti-Unsecured Debt Standard
- Pelanggan dapat menukar barang lama dengan barang pengganti dari katalog toko secara langsung dalam 1 sesi modal.
- **Net Balance Formulation:**
  $$\text{Net Balance} = \text{Total Replacement Items Value} - \text{Total Refund Value}$$
- **Aturan Selisih:**
  1. **Tukar Tambah / Nilai Naik ($\text{Net Balance} > 0$):**
     Pelanggan wajib membayar selisih kekurangan di kasir saat itu juga. Transaksi mewajibkan input baris tender pembayaran tunai/non-tunai yang valid. **DILARANG KERAS** membiarkan nota tertutup dalam status piutang tanpa jaminan (*unsecured debt*).
  2. **Tukar Turun / Nilai Turun ($\text{Net Balance} < 0$):**
     Sisa kelebihan dana dikembalikan kepada pelanggan melalui pengembalian kas (Laci/Bank) atau diterbitkan sebagai Saldo Kredit Toko (*Store Credit*).
  3. **Tukar Pas ($\text{Net Balance} = 0$):**
     Transaksi selesai tanpa pertukaran dana. Mutasi stok barang lama masuk dan barang baru keluar dicatat secara berpasangan.

### 17.6 Buku Besar Saldo Kredit Toko (*Store Credit Ledger*)
- Jika pelanggan memilih pengembalian dana berupa Saldo Kredit Toko (*Store Credit* / Nota Kredit Gantung):
  - Sistem membuatkan atau mengaitkan ke akun saldo pelanggan di `customer_store_credits` (`customer_id`, `balance`).
  - Mutasi penambahan saldo dicatat di `store_credit_ledger` (`entry_type = 'credit'`, `amount`, `source_type = 'pos_return'`).
  - Secara akuntansi, dicatat sebagai Liabilitas Deposit Pelanggan (`203000 Uang Muka / Deposit Pelanggan` Cr).
- **Penebusan Saldo Aman:** Saat saldo kredit digunakan kembali pada transaksi belanja berikutnya, fungsi penebusan mengunci baris pelanggan dengan PostgreSQL `FOR UPDATE` untuk mencegah *race condition* dan pembelanjaan ganda (*double spending*).

### 17.7 Standar Jurnal Akuntansi Kontra-Pendapatan (*Contra-Revenue Accounting Identity*)
Pengembalian barang retur **DILARANG KERAS** membalikkan (*overwrite*) atau mengedit transaksi penjualan awal `401000`. Sesuai Standar Akuntansi Keuangan (SAK/GAAP):
- **Jurnal Retur Penjualan (Header Retur):**
  - **Debit:** `401100 Potongan & Retur Penjualan` (Akun Kontra-Pendapatan) $\rightarrow$ Sebesar nilai bersih barang yang diretur.
  - **Debit/Kredit:** `103000 Piutang Usaha` $\rightarrow$ Menyeimbangkan pembalikan piutang jika pesanan awal belum lunas.
  - **Kredit:** `101000 Kas Laci` / `101200 Bank` (jika refund kas) ATAU `203000 Deposit Pelanggan` (jika Store Credit).
  - **Kredit:** `403000 Pendapatan Restocking Fee` (jika ada potongan biaya penanganan).
- **Jurnal Pemulihan Persediaan & HPP (Stok Layak Jual):**
  - Untuk barang yang direstock ke rak toko (`bucket = 'main'`):
    - **Debit:** `104000 Persediaan Barang Dagang` $\rightarrow$ Sebesar HPP asli barang.
    - **Kredit:** `500000 Beban Pokok Penjualan (HPP)` $\rightarrow$ Sebesar HPP asli barang.

### 17.8 Otorisasi Manager PIN Gate (`pos_approver_pins`) & Policy Engine
- Konfigurasi kebijakan toko (`pos_return_policies`) tersimpan per unit bisnis (`window_days`, `require_receipt`, `manager_pin_required_for_defective`, `restocking_fee_percent`, dll).
- Jika transaksi retur melanggar batas (misal: melewati batas hari retur, retur item non-returnable, atau retur bernilai di atas plafon kasir), sistem memunculkan pop-up otorisasi manajer secara modular (`ManagerPinModal.tsx`).
- Otorisasi divalidasi ke tabel `pos_approver_pins` yang terenkripsi dan terlindung dari serangan *brute force* (lockout otomatis setelah 5 kegagalan).

### 17.9 Skema Varian PostgreSQL: Standar Kolom `name` (Anti-Crash 42703)
- Pada tabel `product_variants` di Supabase/PostgreSQL, kolom nama varian adalah **`name`** (bukan `title`).
- Memanggil `select('..., product_variants(id, title, ...)')` menyebabkan *fatal database error* `PostgreSQL 42703 (column product_variants_1.title does not exist)`.
- **Standar Wajib:** Kueri relasi varian wajib memanggil `product_variants(id, name, price, stock_quantity)` dengan fallback JavaScript `v.name || v.title`.

### 17.10 Zero-Latency UI Extraction & Seamless Stepper Experience
- **Instant Client-Side Extraction:**
  Saat modal retur dibuka (`POSReturnModal.tsx`), komponen **TIDAK MENUNGGU** roundtrip server untuk menampilkan daftar produk. Sistem mengekstrak `order.items_json` secara sinkronus pada saat *mount* (`computeReturnableLines`), sehingga antarmuka kasir terbuka dalam **0ms** tanpa blank screen.
- **Whole-Row Click Target & Checkbox Integration:**
  Setiap baris barang belanjaan dapat diklik di seluruh area baris untuk mengaktifkan/menonaktifkan seleksi retur, dilengkapi tombol stepper kuantitas yang intuitif.
- **Thermal Credit Note Auto-Print:**
  Setelah retur disetujui, kasir dapat langsung mencetak Nota Kredit (Credit Note) berformat ESC/POS atau HTML via printer thermal Bluetooth / Desktop.

---

## 18. POS Hub to Workspace Instant Transition & Speculative Prefetching Architecture

Untuk mengeliminasi latensi perpindahan dari halaman manajemen sesi kasir (`POSHub.tsx`) menuju ruang kerja kasir (`POSWorkspace.tsx`) dari $1.200\text{ms} - 3.500\text{ms}$ menjadi $< 16\text{ms}$ (instant 1-frame), sistem menerapkan arsitektur **5-Pillar Zero-Latency POS Transition** yang setara standar **Square POS, Shopify POS, Toast, dan Odoo 17/18**:

### 18.1 Shared Session State Handoff (`POSContainer.tsx`)
- Objek sesi kasir (`activeShift`), Bagan Akun Kas & Bank (`accounts`), nomor laci register (`posRegisters`), serta nama kasir (`cashierName`) diangkat (*lifted state*) pada `POSContainer.tsx`.
- Saat tombol **"Buka Register Kasir"** ditekan, state tersebut diteruskan langsung ke `POSWorkspace.tsx` melalui `preloadedSession`.
- **Dilarang Keras:** Memaksa `POSWorkspace` melakukan *cold-mount fetch* ulang terhadap data shift dan akun yang sudah dimuat oleh `POSHub`.
- Ketika kasir menekan tombol kembali ke Hub, state sesi kasir mutakhir dikembalikan secara simetris sehingga `POSHub` tidak kehilangan konteks sesi.

### 18.2 3-Tier Reactive POS Catalog Store (`lib/posCatalogStore.ts`)
Mengadopsi pola sukses direktori pelanggan dengan 3 tingkatan penyimpanan:
1. **L1 RAM Cache:** Memori volatile JavaScript per `businessId` untuk akses $0\text{ms}$ saat kasir berpindah layar atau bolak-balik antara kasir dan hub.
2. **L2 `sessionStorage`:** Persistensi instan saat browser di-refresh (`su_pos_cat_v1_${businessId}`) dengan mekanisme *quota guard* (stripping deskripsi panjang untuk dataset $> 500$ baris).
3. **BroadcastChannel Cross-Tab Sync:** Sinkronisasi mutasi katalog dan pengurangan stok fisik (`shapeup_pos_catalog_sync_v1`) lintas tab browser.

### 18.3 Speculative Idle Prefetching di `POSHub.tsx`
- Memanfaatkan *think-time* kasir saat berada di Hub (misal: melihat saldo kas laci, mengecek Z-report, atau membuka shift baru) untuk menjalankan `prefetchPosCatalog(supabase, businessId)` di latar belakang.
- Saat kasir menekan tombol menuju transaksi, seluruh data produk dan kategori telah selesai diunduh dan ter-hydrate $100\%$ di RAM L1.

### 18.4 Instant App-Shell & Zero Black-Screen Standard
- **Larangan Full-Screen Blocking Spinner:** Dilarang menggunakan pola `if (loadingInit) return <FullScreenSpinner />` yang menampilkan layar hitam penuh dan merusak memori kerja (*working memory*) kasir.
- Seluruh antarmuka kasir (Navbar atas, Input pencarian, Tab Kategori, Panel Keranjang, dan Keypad) wajib tampil instan dalam $< 16\text{ms}$ (1 frame @ 60Hz).
- Jika katalog sedang dimuat pada kunjungan perdana (*cold boot*), sistem merender *skeleton grid* beranimasi halus murni di area kartu produk tanpa memblokir interaksi keranjang dan kontrol lainnya.
- **Deferred Secondary Hydration:** Fitur sekunder (`unpaidOrdersCount`, `heldOrders`, `loyaltySettings`, `priceGuardSettings`, `customer_metrics`) dijalankan di latar belakang secara *non-blocking*.

### 18.5 DOM Windowing pada Grid & List Produk (`VISIBLE_BATCH = 60`)
- Berdasarkan prinsip efisiensi `high-cardinality-data`: pencarian teks dan filter kategori tetap memindai $100\%$ populasi produk di memori RAM, namun elemen JSX yang di-mount ke DOM dibatasi pada **60 item pertama** (`visibleProducts`).
- Guliran kasir (*scrolling*) memicu penambahan batch secara otomatis (`visibleProductCount += 60`), mencegah pembekuan *main thread* (*Long Animation Frame*) pada katalog dengan ribuan produk.

### 18.6 Optimistic Local Stock Mutation & Self-Healing Fallback
- **Optimistic Local Stock:** Sesaat setelah checkout kasir sukses, sistem langsung mengurangi saldo fisik produk dan varian terkait di `posCatalogStore` secara lokal ($0\text{ms}$), sehingga kartu produk langsung menampilkan sisa stok terbaru tanpa menunggu respon server.
- **Self-Healing Fallback:** Jika kueri *chunked range* mengalami kendala jaringan atau kegagalan skema, sistem secara otomatis mengeksekusi *emergency legacy fallback* (kueri langsung tanpa varian) dan menyajikan tombol **"🔄 Muat Ulang Katalog"** pada antarmuka kasir jika katalog kosong.

---

## 19. POS Payment Settlement, Full-Screen Completion Stage & Mobile Kiosk Armor

Sesuai standar operasional industri (Square POS, Toast, Shopify POS) dan teori rekayasa perangkat lunak *Finite State Machine* (David Harel, 1987), fase akhir checkout kasir di ShapeUp CRM mengadopsi arsitektur **Dedicated Full-Screen Completion Stage** yang menggantikan *modal dialog ephemeral*:

### 19.1 FSM Lifecycle: Transisi State Deterministik
Alur checkout kasir berpindah secara deterministik antar *Stage View*:
$$\text{CATALOG / CART} \longrightarrow \text{PAYMENT TENDER} \longrightarrow \text{SETTLEMENT / CHANGE DUE} \longrightarrow \text{NEW SALE}$$
- Mengeliminasi *context leak* dan *z-index stacking issues* yang sering terjadi saat modal pop-up mengapung di atas halaman keranjang yang sudah di-reset.
- Menjamin kepemilikan konteks visual 100%: seluruh fokus layar dialokasikan untuk verifikasi uang kembalian dan pencetakan struk.

### 19.2 Dedicated Full-Screen Completion View (`PaymentSuccessView.tsx`) & Color Harmony
- **Harmonisasi Warna POS Workspace:** Tampilan layar sukses menggunakan latar belakang `bg-slate-100`, navbar atas `bg-slate-900 text-white`, kartu rincian putih solid `bg-white border border-slate-200`, dan footer aksi bawah `bg-white border-t border-slate-200`, selaras 100% dengan antarmuka kerja kasir [`POSWorkspace.tsx`](file:///home/faiz-jazuli/shapeup-crm/app/pos/components/POSWorkspace.tsx) dan modal pembayaran [`CashPaymentModal.tsx`](file:///home/faiz-jazuli/shapeup-crm/app/pos/components/CashPaymentModal.tsx).
- **Hero Centerpiece:** Menampilkan nominal **Uang Kembalian (*Change Due*)** dalam ukuran ekstra besar (`text-6xl` hingga `text-7xl font-mono font-black text-slate-950`) di tengah kartu putih untuk meminimalkan potensi kasir salah menyerahkan uang fisik.
- **Badge Uang Pas:** Menampilkan badge solid `✓ Uang Pas / Tidak Ada Kembalian` berwarna hijau (`bg-emerald-100 text-emerald-800 border-emerald-300`) jika nominal kembalian bernilai 0.
- **Rincian Finansial Bersih:** Kartu ringkasan terpusat menampilkan Total Tagihan, Uang Diterima, Metode Pembayaran, dan Nama Pelanggan dengan tipografi solid tanpa efek transparansi yang mengaburkan.

### 19.3 Mobile Kiosk Armor (`overscroll-behavior: none`)
- **Masalah Asal:** Pada perangkat mobile/tablet (Chrome, Safari, WebView), gestur mengusap ke bawah saat berada di posisi paling atas (`scrollTop === 0`) memicu fitur bawaan *Pull-To-Refresh*, me-reload halaman `/pos`, dan menghancurkan seluruh state in-memory kasir.
- **Solusi Standar:** Kontainer kerja kasir (`POSWorkspace.tsx`) dan layar sukses (`PaymentSuccessView.tsx`) **WAJIB** dikunci dengan properti CSS:
  ```css
  overscroll-behavior: none;
  touch-action: pan-y;
  ```
  Gestur usap ke bawah tidak akan pernah memicu *reload* browser sehingga data kembalian dan transaksi aman dari kehilangan state.

### 19.4 Smart Back Interceptor (Anti-Onboarding Redirection)
- **Masalah Asal:** Root layout `app/layout.tsx` menggunakan `useMobileBackToHome()` yang secara default me-redirect event `popstate` ke `/onboarding`. Jika modal sukses tidak terdaftar di stack, menekan tombol *Back* ponsel atau gestur *swipe-back* melempar kasir keluar dari POS ke onboarding.
- **Solusi Standar:** Komponen `PaymentSuccessView` **WAJIB** mendaftarkan diri ke `useModalBackHandler(isOpen, onClose)`.
  - Ketika kasir menekan tombol *Back* fisik perangkat, swipe-back, atau tombol kembali di browser, sinyal `popstate` dicegat secara lokal.
  - Event langsung mengeksekusi `onClose()` (membuka kasir bersih untuk transaksi baru).
  - Kasir tidak pernah terlempar keluar dari sistem kasir.

### 19.5 Dynamic Action State Machine (Hick-Hyman Law)
Mengatasi paradoks tombol dan meminimalkan beban kognitif kasir (*Hick-Hyman Law*):
1. **Fase 1: Belum Dicetak (`hasPrinted = false`)**
   - Kiri: `[ Void ]` (pembatalan darurat jika salah ketik).
   - Tengah: `[ Lewati Struk ]` (untuk pelanggan yang tidak membutuhkan struk fisik).
   - Kanan: `[ 🖨️ Cetak Struk (Enter) ]` (tombol primer biru menyala).
2. **Fase 2: Selesai Dicetak (`hasPrinted = true`)**
   - Kiri: `[ Void ]`.
   - Tengah: `[ 🖨️ Cetak Ulang ]` (mencetak ulang salinan struk).
   - Kanan: **`[ + Transaksi Baru (Enter ↵) ]`** (tombol primer hijau emerald raksasa, mengarahkan kasir langsung ke antrean berikutnya).
3. **Pintasan Keyboard Terpadu:**
   - Tombol `Enter`: otomatis mencetak struk jika belum dicetak; otomatis membuka transaksi baru jika struk sudah dicetak.
   - Tombol `Escape`: langsung membuka transaksi baru.
4. **Stabilitas State `hasPrinted` (Anti-Reset):**
   - `useEffect` inisialisasi layar sukses (baca setting, reset `hasPrinted`, Auto-Print) **WAJIB** hanya bergantung pada `[isOpen, receipt]`. **DILARANG** memasukkan `handlePrint` (atau state yang berubah saat mencetak seperti `isPrinting`) ke dependency, karena setiap selesai cetak identitas `handlePrint` berubah → effect jalan ulang → `hasPrinted` ter-reset ke `false` (tombol kembali menjadi "Cetak Struk") dan Auto-Print tercetak berulang.
   - Panggil `handlePrint` via `handlePrintRef.current`, gunakan `isPrintingRef` sebagai guard sinkronus, dan `autoPrintedReceiptRef` agar Auto-Print hanya terjadi **sekali per struk**.
   - Jika `print()` mengembalikan `needsBluetoothReconnect: true`, tampilkan tombol **"🔄 Sambungkan Ulang Printer & Cetak"** (gesture eksplisit kasir → `requestAndConnectBluetoothPrinter()` → cetak).

### 19.6 Session Storage Snapshot & Transient State Recovery
- Setiap kali transaksi berhasil diselesaikan, ringkasan transaksi disimpan ke `sessionStorage`:
  ```typescript
  sessionStorage.setItem('su_last_pos_completed_order', JSON.stringify({
    orderNumber: receipt.orderNumber,
    grandTotal: receipt.grandTotal,
    changeAmount: receipt.changeAmount,
    customerName: receipt.customerName,
    paymentMethod: receipt.paymentMethod,
    timestamp: Date.now()
  }))
  ```
- Melindungi data jika browser kasir tertutup secara tidak sengaja oleh pengguna atau sistem operasi Android.

### 19.7 Legacy Device Compatibility Standard (Zero-Gradient & Solid Opaque Colors)
Untuk menjamin aplikasi POS berjalan mulus tanpa lag di perangkat keras berspesifikasi rendah (tablet Android 7–9, peramban WebView lawas, mesin POS berbasis Android entry-level):
1. **Dilarang Menggunakan Linear / Radial Gradients (`bg-gradient-to-*`):**
   - GPU lawas (Mali-400/450, Adreno 300/400/500 series) sering mengalami cacat visual (*color banding*), lag *compositing*, atau bahkan menghasilkan layar hitam saat merender gradien kompleks.
   - Diganti dengan warna latar belakang solid murni (`bg-white` untuk kartu dan `bg-slate-100` untuk kontainer layar penuh).
2. **Dilarang Menggunakan `backdrop-blur-*` (`backdrop-filter`):**
   - Efek blur latar belakang tidak didukung pada peramban Chromium sebelum versi 76 dan mengonsumsi daya komputasi GPU yang sangat masif, memicu pembekuan antarmuka (*UI freeze*).
   - Diganti dengan elemen solid 100% *opaque* (`bg-slate-900` untuk navbar, `bg-white` untuk footer).
3. **Dilarang Menggunakan Overlay Transparan Kompleks & Filter `drop-shadow-*`:**
   - Menghindari tumpukan lapisan transparan (`via-transparent`, `bg-emerald-500/5`) dan filter drop-shadow yang membebani memori render.
   - Menggunakan bayangan ringan standar (`shadow-xs`) dan border CSS murni (`border border-slate-200`) yang diakselerasi secara universal oleh seluruh peramban modern maupun warisan.

---

## 20. Atomic POS Order Numbering & Dual-Layer Architecture Standard

### 20.1 Format Kanonikal Nomor Nota POS
Dilarang keras menggunakan epoch timestamp terpotong (`Date.now().slice(-8)`) yang menghasilkan nomor acak tak terbaca. Format baku nomor nota kasir POS adalah:
$$\text{POS}-\text{YYYYMMDD}-\text{XXXX}$$
- **`POS`:** Prefiks dokumen penjualan kasir.
- **`YYYYMMDD`:** Tanggal kalender sipil lokal unit bisnis (misal `20261106` untuk 6 November 2026).
- **`XXXX`:** Nomor urut harian atomik yang ter-reset otomatis setiap hari (dimulai dari `0001` hingga `9999` atau lebih).

### 20.2 Pencegahan Race Condition Multi-Kasir (Zero-Tolerance Collision)
- **Tabel Counter Terisolasi (`public.business_counters`):**
  Menggunakan skema partisi komposit `(business_id, counter_type, period_date)`.
- **Atomic UPSERT Row Lock (< 0.2ms):**
  Nomor urut dihasilkan via kernel PostgreSQL menggunakan statement:
  ```sql
  INSERT INTO public.business_counters (business_id, counter_type, period_date, last_val)
  VALUES (p_business_id, 'pos_order', v_today, 1)
  ON CONFLICT (business_id, counter_type, period_date)
  DO UPDATE SET last_val = business_counters.last_val + 1, updated_at = NOW()
  RETURNING last_val;
  ```
  Kernel PostgreSQL otomatis mengunci baris counter secara eksklusif. Transaksi paralel dari kasir lain akan mengantre di tingkat memori engine dan dijamin mendapatkan nomor urut monotonik yang presisi tanpa bentrok.

### 20.3 Arsitektur Dual-Layer (Nomor Antrean Ringkas vs Nomor Nota Dokumen)
- **Nomor Nota Dokumen (`orders.order_number`):** `POS-YYYYMMDD-0001` (Kunci hukum, audit fiskal perpajakan DJP, dan referensi Buku Besar Akuntansi).
- **Nomor Antrean Ringkas (`queue_number`):** Angka urut harian ringkas (`#1`, `#2`, `#42...`) yang mudah dipanggil kasir, barista, atau staf dapur.
- **Konfigurasi Default:**
  - Nomor antrean harian ringkas **NONAKTIF (OFF)** secara default.
  - Pemilik toko / manajer dapat mengaktifkannya kapan saja melalui modal **Pengaturan Struk Kasir** (`ReceiptSettingsModal` toggle: `Cetak Nomor Antrean Ringkas (#001)`).
- **Keterangan Kasir & Register di Struk:**
  Nama kasir (`cashierName`) dan register laci kasir dicetak jelas di blok metadata struk belanja tepat di bawah nomor nota dan tanggal transaksi.

### 20.4 0ms Instant Optimistic Action with Background Reconciliation (Zero Checkout Delay)
- **Zero-Blocking Policy:** Kasir **DILARANG KERAS** diblokir oleh `await fetch('/api/pos/order')` saat menekan tombol *"Bayar"* yang menimbulkan jeda (*processing delay* 300–800ms).
- **Client-Side Optimistic Date-Based Generator (0ms):**
  - Klien menghasilkan nomor nota optimistik tanggal hari ini (`POS-YYYYMMDD-XXXX`) seketika di memori via `getNextOptimisticOrderNumber()`.
  - Keranjang kasir langsung di-reset, modal pembayaran ditutup, dan struk belanja langsung ditampilkan seketika dalam **0 milidetik**.
- **Background Sync & In-Place Seamless Reconciliation:**
  - Permintaan ke server dieksekusi di latar belakang (*fire-and-forget*).
  - Ketika response server tiba, `setLastCreatedOrderId` dan `setReceiptData` merekonsiliasi nomor nota secara mulus *in-place* tanpa kedipan (*zero flicker*).
- **Speculative Counter Pre-Warming:** Saat `POSWorkspace` dimuat, sistem secara otomatis mem-prewarm nilai counter tertinggi hari ini dari Supabase ke `localStorage` di latar belakang secara *non-blocking*.

---

## 21. POS Modal Architecture & Sub-Modal LIFO Back Navigation Standards

Setiap dialog, drawer, atau pop-up di dalam antarmuka POS (baik pada `POSHub`, `POSWorkspace`, maupun `CashPaymentModal`) **WAJIB** mematuhi protokol LIFO (*Last-In, First-Out*) navigasi tombol Back perangkat / browser.

### 21.1 Aturan Penutupan Berjenjang (Strict LIFO Hierarchy)
- **Tingkat 1 (Layar Induk):** Tekan Back di `POSWorkspace` kembali ke `POSHub`. Tekan Back di `POSHub` (pada tablet/ponsel layar sentuh) kembali ke `/onboarding`.
- **Tingkat 2 (Modal Utama):** Modal utama (`CashPaymentModal`, `ShiftModal`, `HoldModal`, `ReceiptPreviewModal`, `POSOrderDetailModal`, `AddCustomerModal`, dsb.) **WAJIB** menggunakan `FullScreenModal` atau mendaftarkan `useModalBackHandler(isOpen, onClose)`.
- **Tingkat 3 (Sub-Modal / Inner Dialog Pop-Up):**
  Setiap pop-up sekunder di dalam modal utama (seperti: Keypad Numpad *New amount* di pembayaran, pop-up *Split Bill*, pop-up *Rincian Pesanan*, *Drawer Keranjang Mobile*, atau *Dropdown Pemilih Pelanggan*):
  - **WAJIB** mendaftarkan `useModalBackHandler(isSubModalOpen, () => setIsSubModalOpen(false))` pada level komponen terkait.
  - **DILARANG KERAS** membiarkan dialog anak hanya berupa markup conditional `isOpen && <div className="fixed inset-0...">` tanpa listener back handler!
  - **Perilaku Tombol Back:** Saat sub-modal aktif dan kasir menekan Back di Android / tablet / browser, sistem **HANYA** menutup sub-modal tersebut. Modal utama di bawahnya **WAJIB TETAP TERBUKA** dan tidak boleh tertutup atau melompat rute ke onboarding.

### 21.2 Checklist Audit Modal POS Baru
Sebelum menyelesaikan pembuatan fitur baru di modul POS, jalankan checklist:
1. Apakah ada komponen yang me-render overlay dialog (`fixed inset-0` atau drawer mengambang)?
2. Apakah modal tersebut dibungkus `FullScreenModal`? Jika tidak (komponen kustom), apakah sudah ada baris `useModalBackHandler(isOpen, onClose)`?
3. Apakah modal tersebut memiliki dialog anak / sub-modal (seperti konfirmasi void, PIN authorizer, keypad amount)? Jika ya, apakah dialog anak tersebut sudah memiliki `useModalBackHandler(isSubOpen, closeSub)` masing-masing?
4. Uji simulasi: Buka Layar Kasir $\rightarrow$ Buka Pembayaran $\rightarrow$ Buka Edit Nominal $\rightarrow$ Tekan Back $\rightarrow$ *Hasil:* Hanya Edit Nominal yang tutup, Pembayaran tetap aktif. Tekan Back lagi $\rightarrow$ *Hasil:* Pembayaran tutup, Kasir tetap aktif. Tekan Back lagi $\rightarrow$ *Hasil:* Kembali ke POS Hub.

---

## 22. Kitchen Production Ticket (Nota Dapur & Bar) Architecture Standards

Fitur cetak nota dapur (*Kitchen Bill / Production Chit*) dirancang mengikuti kaidah rekayasa perangkat lunak kelas dunia (Toast POS, Square for Restaurants, Lightspeed Restaurant, Odoo Restaurant):

### 22.1 Pemisahan Bounded Context (DDD: Evans, 2003)
- **Financial Context (`ReceiptData`):** Menyimpan faktur, pajak, diskon, metode tender, kembalian, dan jejak buku besar untuk konsumen.
- **Production Context (`KitchenTicketData`):** Perintah kerja fisik untuk stasiun juru masak dan barista. **WAJIB** menerapkan prinsip **Zero Financial Clutter** (tanpa harga satuan, subtotal, diskon, pajak, atau total tagihan) guna memangkas beban kognitif visual koki hingga 60%.

### 22.2 Ergonomi Visual & Poka-Yoke (Pencegahan Kesalahan Masak)
1. **Nomor Meja & Antrean Raksasa:** Menampilkan nomor meja (`MEJA 08`, `TABLE 3`) dan nomor antrean (`#042`) dalam ukuran font *Double-Height & Double-Width* agar terbaca jelas dari jarak 1,5–2 meter di stasiun kompor/bar.
2. **Kuantitas & Modifikasi Tebal:** Kuantitas pesanan dicetak tebal (` 2x AYAM BAKAR TALIWANG`). Seluruh opsi pengubah (*modifiers*) dicetak berindentasi dengan penanda penegas tebal (` * PEDAS LEVEL 5 (EXTRA)`).
3. **Catatan Meja Eksplisit:** Catatan global meja/pesanan dibungkus dalam blok pemisah bertanda khusus `>> ... <<`.

### 22.3 Multi-Station Routing Otomatis (Dapur Makanan vs Bar Minuman)
- Sistem memisahkan item ke stasiun produksi yang relevan secara otomatis:
  - Stasiun `'bar'` (*Bar & Minuman*): Kategori/produk minuman, kopi, teh, jus, dessert es.
  - Stasiun `'kitchen'` (*Dapur Utama*): Kategori/produk makanan, lauk, nasi, snack panas.
- Pengguna dapat menyesuaikan pemetaan stasiun untuk setiap kategori menu di menu pengaturan struk POS.
- Pada format gabungan (*single station*), sistem menyatukan seluruh item dalam satu nota dapur komprehensif.

### 22.4 Alur Operasional Hibrida (Hybrid Execution)
1. **Model Makan Dulu, Bayar Nanti (Table Service / Held Orders):**
   - Kasir/waiter dapat mencetak nota dapur langsung dari keranjang sebelum membayar (`🍳 Dapur`).
   - Kasir dapat mencetak ulang nota dapur untuk pesanan meja yang sedang ditahan (`HoldModal.tsx`).
   - **Auto-Print on Hold:** Jika diaktifkan di pengaturan, nota dapur otomatis terkirim dan dicetak seketika saat kasir menekan tombol *Hold* tanpa perlu menekan tombol cetak dapur lagi.
2. **Model Bayar Dulu, Baru Masak (Fast Food / Upfront Cashier):**
   - Pada layar sukses pembayaran (`PaymentSuccessView.tsx`), tersedia tombol cetak nota dapur terpisah.
   - **Auto-Print on Payment:** Jika diaktifkan di pengaturan, nota dapur langsung dicetak otomatis ke printer dapur seketika setelah kasir menyelesaikan transaksi pembayaran tanpa perlu sentuhan tombol tambahan.
3. **Riwayat Detail Pesanan:** Staf dapat mencetak ulang nota dapur untuk pesanan lampau dari modal detail pesanan (`POSOrderDetailModal.tsx`).

### 22.5 Sinyal Perangkat Keras Printer (Buzzer & Auto-Cut)
- Pada transmisi printer ESC/POS fisik:
  - **Hardware Buzzer / Beeper:** Mengirimkan sinyal alarm akustik (`0x1B, 0x42, 0x02, 0x02`) agar koki langsung waspada saat pesanan baru keluar dari printer.
  - **Auto-Cut Paper:** Mengirimkan komando pemotong kertas otomatis (`0x1D, 0x56, 0x41, 0x03`) dengan feed 3 baris.

### 22.6 Zero-Clutter Retail Fashion Mode & Existing Customer Defaults
- **Isolasi Alur Retail Fashion (Zero Visual Clutter):**
  Untuk mencegah kebingungan kasir toko baju/retail, sistem menerapkan resolver mode POS (`resolvePosMode(activeBusiness)`).
  Jika `pos_mode === 'retail'` (atau industri retail/fashion), seluruh tombol nota dapur (`enableProductionTickets = false`) disembunyikan 100% dari:
  1. Header Keranjang Kasir (`POSWorkspace.tsx`)
  2. Dialog Tahan Pesanan (`HoldModal.tsx`)
  3. Layar Sukses Pembayaran (`PaymentSuccessView.tsx`)
  4. Rincian Detail Transaksi (`POSOrderDetailModal.tsx`)
- **Nilai Baku Pelanggan Existing (Default):**
  - Seluruh toko/bisnis yang sudah terdaftar diatur ke mode **`'retail'`** secara baku.
  - Daftar stasiun kustom di database **dibiarkan kosong (*empty list*)** secara baku.
  - Toko kuliner (F&B) dapat beralih ke mode F&B kapan saja melalui menu pengaturan struk POS atau dialog stasiun produksi.

---

## 23. Database-Driven Custom Production Stations & Relational Category Routing (Open-Closed Principle)

Untuk mendukung fleksibilitas operasional bisnis skala besar tanpa mengubah (*hardcode*) modul kasir utama setiap kali ada stasiun baru, sistem menerapkan arsitektur *Headless Category Routing*:

### 23.1 Skema Basis Data 3NF (`pos_production_stations` & `categories`)
1. **Tabel Stasiun Produksi (`pos_production_stations`):**
   - Menyimpan entitas stasiun fisik/logis per unit bisnis: `id`, `business_id`, `name`, `code`, `icon`, `paper_size` (`'58mm'` | `'80mm'`), `is_active`, `sort_order`.
   - Terisolasi dengan kebijakan RLS multi-tenant union (`owner_id UNION business_staff OR active_business_id`).
2. **Relasi Kategori ke Stasiun (`categories.production_station_id`):**
   - Kolom foreign key `categories.production_station_id REFERENCES pos_production_stations(id) ON DELETE SET NULL`.
   - Mengadopsi prinsip normalisasi 3NF: Produk tidak perlu menyimpan stasiun secara berulang; cukup kategori produk yang mengindikasikan stasiun tujuan.

### 23.2 Headless Routing Service (`productionRoutingService.ts`)
- Fungsi terisolasi `routeItemsToProductionStations(items, stations, categories)` memproses item pesanan:
  - Mengelompokkan item ke `station_id` yang sesuai.
  - Item tanpa pemetaan stasiun (seperti produk pakaian, tas, aksesoris) otomatis diabaikan (*excluded*) dari pencetakan tiket masak sehingga tidak memboroskan kertas printer.
- Modul ini berdiri sendiri (*decoupled*) dan dapat dikonsumsi oleh POS Worker, UI kasir, KDS (*Kitchen Display System*), maupun API background job tanpa merusak modul existing.









