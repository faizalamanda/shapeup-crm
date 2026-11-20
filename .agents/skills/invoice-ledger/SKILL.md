---
name: invoice-ledger
description: "Arsitektur Faktur/Invoice, Two-Dimensional Lifecycle, Decoupled Status, Down Payment & Installments, Atribusi Omnichannel (Channel, PO Ref, UTM), dan Rekonsiliasi Buku Besar Akuntansi. Gunakan skill ini saat mengembangkan atau memodifikasi modul invoice dan pelaporan penjualan."
---

# Invoice Lifecycle, Decoupled Status, Down Payment & Omnichannel Attribution Ledger

Dokumen skill ini menetapkan standar arsitektur kelas dunia untuk modul **Faktur Penjualan (Invoicing)** di ShapeUp CRM. Modul ini terintegrasi penuh secara harmonis dengan Kasir POS, Webhook E-Commerce (WooCommerce), Buku Besar Akuntansi Double-Entry (General Ledger), dan Kartu Stok Fisik Gudang (Stock Moves).

---

## 1. Prinsip Utama (Core Principles)

### 1.1 Two-Dimensional Lifecycle (Separation of Concerns)
Status faktur dipisahkan secara tegas menjadi **2 dimensi independen**:

1. **Status Operasional / Logistik Dokumen (`orders.status`):**
   - `'pending'` = **Draft**: Faktur tersimpan sebagai konsep. Belum memotong stok dan belum mencatat jurnal penjualan.
   - `'processing'` = **Terbit / Belum Selesai**: Faktur telah resmi diterbitkan ke pelanggan. Mengakui penjualan dan piutang.
   - `'shipped'` = **Dikirim**: Barang telah dikirim ke pelanggan (via kurir/ekspedisi). Memicu pemotongan stok fisik gudang (`stock_moves`) dan penjurnalan HPP (`501000` / `102000`) sesuai pengaturan default bisnis (`['shipped', 'completed']`).
   - `'completed'` = **Selesai**: Pesanan/pekerjaan telah diselesaikan dan barang telah diterima pelanggan.
   - `'cancelled'` = **Dibatalkan**: Faktur dibatalkan. Mengembalikan stok fisik dan menerbitkan jurnal pembalikan.

2. **Status Keuangan / Piutang Usaha (`orders.payment_status`):**
   - `'unpaid'` = **Belum Lunas**: Pelanggan belum melakukan pembayaran sama sekali (`amount_paid == 0`).
   - `'partial'` = **Sebagian / DP**: Pelanggan telah membayar uang muka (DP) atau termin sebagian ($0 < \text{amount\_paid} < \text{grand\_total}$).
   - `'paid'` = **Lunas**: Tagihan telah terbayar penuh ($\text{amount\_paid} \ge \text{grand\_total} - 0.01$).

> [!IMPORTANT]
> **Anti-Pola yang Dilarang:** Dilarang keras mengasumsikan bahwa faktur yang berstatus `status === 'completed'` pasti berstatus lunas. Faktur dapat berstatus `completed` (barang/jasa sudah diserahkan) namun pembayarannya masih `unpaid` (tempo piutang 30 hari). Begitu pula faktur bisa berstatus `processing` namun pembayarannya sudah `paid` (pelanggan bayar lunas di muka).

---

## 2. Struktur Data & Atribusi Sumber Pesanan (Omnichannel Attribution)

### 2.1 Atribusi Omnichannel pada Header Pesanan
Untuk mendukung pelaporan performa penjualan multi-channel dan atribusi pemasaran jangka panjang, setiap faktur mencatat metadata sumber secara terstruktur:

```typescript
// Disimpan pada tabel public.orders:
{
  source_platform: 'Shopee', // Channel utama: 'Invoice', 'WhatsApp', 'Instagram', 'Shopee', 'Tokopedia', 'TikTok', 'Manual'
  raw_source_data: {
    is_invoice: true,
    due_date: '2026-11-30',
    payment_terms: 'net-30',
    source_order: {
      channel: 'Shopee',
      reference_no: 'PO-2026-X89', // Nomor PO klien atau nomor pesanan eksternal
      utm_source: 'google_ads',     // Sumber kampanye (kompatibel format WooCommerce)
      utm_campaign: 'promo_q4'      // Nama kampanye
    },
    meta_data: [
      { key: 'shapeup_kurir_awb', value: 'JNE' },
      { key: 'shapeup_resi_awb', value: 'JNE123456789' }
    ]
  }
}
```

### 2.2 Kompatibilitas dengan Ekspor & Laporan Omnichannel
Format `source_order` ini dirancang 100% kompatibel dengan:
- Ekspor order multi-sheet (`/app/orders/services/orderExportService.ts`).
- Analitik sumber penjualan per-platform.
- Webhook WooCommerce yang menyertakan data UTM dari plugin pixel/tracking.

### 2.3 Resolusi Pelanggan Marketplace Tanpa Nomor HP (Buyer PII Masking & Marketplace Profiles)
Marketplace (Shopee, TikTok Shop, Tokopedia, Lazada, Amazon, dll.) menerapkan sensor nomor HP (*PII Masking*). Standar modul invoice dalam menangani ini:
1. **Nomor HP Opsional:** Validasi pelanggan baru di Invoice **HANYA** mewajibkan Nama Pelanggan (`name`). Dilarang memblokir faktur hanya karena nomor HP tidak tersedia.
2. **Dynamic JSONB Profiles:** Identitas pembeli disimpan dalam `metadata.marketplace_profiles` (misal: `{ "shopee": "budi_olshop", "tiktok": "anita_store" }`). Wajib berupa **plain username tanpa simbol `@`** agar sesuai dengan Seller Center dan resi pengiriman.
3. **Smart 3-Tier Customer Matching:**
   - **Tier 1:** Jika ada nomor HP $\rightarrow$ Cocokkan simetris E.164 (`08` $\leftrightarrow$ `628`).
   - **Tier 2:** Jika nomor HP kosong $\rightarrow$ Cocokkan username marketplace pembeli di tabel `customers` pada unit bisnis terkait. Jika cocok, sambungkan ke pelanggan existing (*repeat buyer attribution*).
   - **Tier 3:** Jika tidak ditemukan $\rightarrow$ Terbitkan pelanggan baru dengan metadata marketplace.
4. **Visual Badge Gudang & Resolusi `other_platform`:** Tampilan rincian invoice (`/orders/invoices/[id]`) dan `CustomerSelectCombobox` wajib merender badge platform (`Shopee: budi_olshop`, `TikTok: anita_store`). Untuk platform kustom (`other_handle`), label platform **WAJIB** menggunakan nilai `marketplace_profiles.other_platform` (misal: `🏷️ Lazada: budi_collection`), dilarang menampilkan key mentah `Other_handle`.

### 2.4 Auto-Discovery & Persistensi Kanal / Kurir / UTM Kustom Milik Bisnis (Adaptive Taxonomy)
Untuk mencegah *folksonomy drift* (variasi ketik/typo yang memecah laporan analitik) dan menghilangkan friksi UX mengetik ulang kanal kustom:
1. **Server-Side Hybrid Auto-Discovery (`getBusinessCustomInvoiceOptions`):**
   - Endpoint `GET /api/orders/invoices?only_accounts=true` dan `GET /api/orders/invoices/[id]` mengekstrak daftar unik **`custom_channels`**, **`custom_couriers`**, **`custom_utm_sources`**, dan **`custom_utm_campaigns`** milik `business_id` aktif (di-cache 30 detik di memori server dan di-invalidate otomatis saat mutasi invoice).
   - `custom_channels` dikumpulkan dari `orders.source_platform`, `orders.raw_source_data.source_order.channel`, serta `customers.metadata.marketplace_profiles.other_platform` (dan `lead_source` / `custom_channel`), dide-duplikasi secara *case-insensitive* terhadap kanal standar (`STANDARD_INVOICE_CHANNELS`).
2. **Case-Insensitive Canonicalization (`canonicalizeOption`):**
   - Pada `POST /api/orders/invoices` dan `PUT /api/orders/invoices/[id]`, nilai `source_platform` dan `courier` dinormalisasi terhadap daftar standar dan daftar kustom bisnis yang sudah ada (misal input `"lazada"` otomatis disatukan ke `"Lazada"` jika bisnis sudah memiliki kanal `"Lazada"`).
3. **L2 Client Storage & First-Class Dropdown Options:**
   - Di halaman Buat Baru (`/orders/invoices/new`) dan Edit (`/orders/invoices/[id]/edit`), opsi kustom disimpan juga pada `localStorage` ber-namespace `su_invoice_custom_opts_${businessId}` untuk ketersediaan instan `0ms`.
   - Kanal dan kurir kustom milik bisnis ditampilkan langsung sebagai `<optgroup label="Kanal Kustom Bisnis Anda">` (`🏷️`) dan `<optgroup label="Kurir Kustom Bisnis Anda">` (`🚚`), dilengkapi tombol `+ Simpan Kanal` / `+ Simpan Kurir`, *quick-select chips*, serta tombol 1-klik `Kanal Akun Customer` saat pelanggan pemilik akun marketplace dipilih.

---

## 3. Integrasi Arsitektur Modul Reusable

Semua API route invoice **WAJIB** menggunakan modul terpadu yang telah disediakan:

| Kebutuhan | Modul Standar | Fungsi Utama |
|---|---|---|
| **Auth & Multi-Tenant** | `@/lib/apiContext.ts` | `getApiContext()` (0ms JWT fast-path, profile cache, admin client) |
| **Direktori & Resolusi Customer** | `@/lib/customerHelper.ts` & `@/lib/customerDirectoryStore.ts` | `queryBusinessCustomers()`, `resolveOrCreateCustomer()`, `useCustomerDirectory()`, `notifyCustomerDirectoryUpdate()` |
| **Pencatatan Pembayaran / DP** | `@/lib/paymentLedger.ts` | `recordOrderPayment()` & `recalculateOrderPaymentStatus()` |
| **Buku Besar Penjualan & Stok** | `@/lib/orderLedger.ts` | `syncOrderToLedger()` |
| **Posting Jurnal Anti-Duplikasi** | `@/lib/journalHelper.ts` | `postJournalTransaction()` |
| **Bagan Akun (COA)** | `@/lib/accountHelper.ts` | `getOrCreateDefaultAccounts()` |
| **Sanitasi UUID** | `@/lib/utils.ts` | `isUuid()` (anti-crash PostgreSQL string kosong `""`) |

---

## 4. Alur Akuntansi Keuangan Double-Entry

### 4.1 Saat Faktur Diterbitkan (`processing`, `shipped`, atau `completed`)
`syncOrderToLedger()` mendukung alur **Two-Stage Ledger Trigger**:
- Saat faktur diterbitkan (`status === 'processing'`), jurnal pengakuan penjualan & piutang (`salesTx`) langsung diterbitkan:
  - **Debit:** `103000 Piutang Usaha` (sebesar `grand_total`)
  - **Debit:** `401100 Potongan & Diskon Penjualan` (jika ada diskon)
  - **Kredit:** `401000 Pendapatan Penjualan` (sebesar `subtotal`)
  - **Kredit:** `402000 Pendapatan Ongkos Kirim` (jika ada biaya kirim)
  - **Kredit/Debit:** `403000 Biaya Lain-Lain / Admin` (jika ada)
- Saat status faktur mencapai status pemicu gudang & HPP (`stockReductionStatuses` dan `journalHppStatuses`, default bisnis: `['shipped', 'completed']`):
  - Memotong stok fisik gudang (`stock_moves` via `applyStockMovement()`).
  - Menambahkan baris jurnal HPP ke `salesTx`:
    - **Debit:** `501000 Beban Pokok Penjualan (HPP)`
    - **Kredit:** `102000 Persediaan Barang Dagang`

### 4.2 Saat Uang Muka (DP) atau Pembayaran Termin Diterima (Integrasi Dinamis COA Aktif)
Setiap pembayaran pada halaman Buat Baru (`/orders/invoices/new`), Edit (`/orders/invoices/[id]/edit`), dan Detail/Catat Pembayaran (`/orders/invoices/[id]`) memuat daftar akun **langsung dari COA aktif milik bisnis tersebut** (`getActivePaymentAccounts()` & `isCashBankAccount()` dari `@/lib/accountHelper.ts` / `@/lib/coa.ts`), sehingga mendukung penuh akun Kas/Bank kustom yang berbeda-beda di setiap bisnis (misal: Bank BCA, Bank Mandiri, BRI, Kas Toko, QRIS Midtrans, E-Wallet, dll.):
- Pembayaran dicatat ke tabel **`order_payments`** dengan menyimpan **`payment_method_account_id`** (UUID akun COA aktif) dan **`payment_method`** (nama akun COA aktif) sebagai *Single Source of Truth* melalui `recordOrderPayment()` atau `syncOrderToLedger()`:
  - **Debit:** Akun Kas/Bank COA aktif terpilih (`payment_method_account_id`) sebesar uang yang diterima
  - **Kredit:** `103000 Piutang Usaha` (sebesar uang yang diterima)
- Tanggal pembayaran (`payment_date`) yang diinput pengguna dipertahankan secara utuh pada `order_payments.date`, `order_payments.created_at`, dan `transactions.date`.

### 4.3 Normalisasi & Kompatibilitas Data Historis (Dynamic COA Matching)
Untuk menjamin 0 error pada data faktur lama (sebelum pemisahan `payment_status` atau sebelum kolom `payment_method_account_id`):
1. **Normalisasi Status & Nominal Terbayar:** Jika faktur historis memiliki `status === 'completed'` namun `payment_status` bernilai `null` dan `amount_paid == 0` (tanpa baris aktif di `order_payments`), API (`GET /api/orders/invoices` & `GET /api/orders/invoices/[id]`) menormalisasi `payment_status = 'paid'` dan `amount_paid = grand_total`.
2. **Resolusi Dinamis ke COA Aktif (`resolvePaymentAccountFromCOA`):** Jika baris `order_payments` atau order historis memiliki `payment_method_account_id = null` dan hanya menyimpan string nama metode bayar, sistem mencocokkannya secara dinamis terhadap daftar akun Kas/Bank yang aktif di COA bisnis saat ini (pencocokan nama/kode persis, pencocokan substring seperti `"BCA"` $\leftrightarrow$ `"Bank BCA"`, hingga pencocokan kategori Kas/QRIS/Bank di COA aktif) tanpa melakukan *hardcode* ke kode akun statis.
3. **Sinkronisasi Edit Pembayaran & Status (Pure Append-Only Void & Replacement — PSAK 225 / IAS 8 & PSAK 109 / IFRS 9):**
   - **Zero DELETE Policy:** Dilarang keras melakukan `DELETE` fisik pada tabel `order_payments` maupun `transactions` untuk pembayaran yang telah masuk ke Buku Besar.
   - **Void & Ganti Pembayaran Invoice (`POST /api/orders/invoices/[id]/payment` dengan `action: 'void' | 'replace'`):**
     - **Mode `void`**: Membatalkan baris pembayaran spesifik melalui `voidOrderPayment()` (`lib/paymentLedger.ts`). Menyisipkan baris baru `payment_kind = 'void'` yang merujuk pada `voided_payment_id`, memposting jurnal pembalik (`Debit 103000 Piutang Usaha`, `Kredit Akun Kas/Bank COA asal`) tepat pada tanggal pembayaran asal (*Same-Date Reversal Principle* guna mencegah distorsi *cut-off* rekonsiliasi bank lintas periode), serta menghitung ulang `orders.amount_paid`, `orders.payment_status`, dan `orders.payment_method`.
     - **Mode `replace` (1-Click Remove & Redo)**: Melakukan `voidOrderPayment()` atas pembayaran lama dan langsung memanggil `recordOrderPayment()` dengan akun Kas/Bank COA, nominal, atau tanggal pembayaran yang baru secara atomik.
     - **Isolasi Dimensi Operasional (PSAK 115 vs PSAK 109):** Pembatalan atau penggantian pembayaran hanya mengubah dimensi keuangan (`payment_status` & `amount_paid`) tanpa memundurkan status operasional/logistik (`orders.status`) dan tanpa memicu mutasi ulang kartu stok gudang (`stock_moves`) atau jurnal HPP.
     - **Audit Trail Wajib:** Setiap aksi void/ganti pembayaran wajib menyertakan alasan (`void_reason` min. 5 karakter) dan menampilkan riwayat pembayaran yang telah di-void (`payment_history`) secara transparan di halaman detail invoice (`/orders/invoices/[id]`).

### 4.3 Dampak pada Neraca Keuangan:
$$\text{Sisa Piutang (Outstanding)} = \text{Grand Total} - \sum(\text{order\_payments.amount})$$
- Jika faktur lunas penuh di awal: Piutang langsung menjadi 0, kas/bank terisi penuh.
- Jika ada DP 50%: Piutang Usaha tersisa 50%, kas/bank bertambah 50%.
- Saat pelunasan kedua: Piutang Usaha berkurang menjadi 0, kas/bank bertambah 50% sisanya.

---

## 5. Standar Antarmuka Pengguna (UI/UX)

1. **Ringkasan Keuangan Wave Apps Style:**
   - Panel metrik di halaman utama (`/orders/invoices`) menghitung total faktur terbit, total pembayaran/DP diterima, dan total piutang yang belum terbayar (*net outstanding balance*).
2. **Watermark Dokumen Otomatis:**
   - Halaman cetak/tampil invoice (`/orders/invoices/[id]`) menampilkan stempel visual dinamis:
     - 🟢 **LUNAS**: Jika `payment_status === 'paid'`
     - 🔵 **DP DITERIMA**: Jika `payment_status === 'partial'`
     - ⚪ **DRAFT**: Jika `status === 'pending'`
     - 🔴 **BATAL**: Jika `status === 'cancelled'`
3. **Modal Pembayaran Fleksibel:**
   - Menyediakan pilihan cepat antara **Pelunasan Penuh** (mengisi otomatis sisa tagihan) atau **Sebagian / DP** (input manual dengan validasi anti-melebihi batas).
4. **Linimasa Riwayat Pembayaran:**
   - Memuat data langsung dari tabel `order_payments` sehingga staf dapat melihat kronologi pembayaran bertahap secara transparan.
5. **Flat Discrete Variant Selection & Variant-Aware Stock/HPP Ledger:**
   - Pada formulir Buat Invoice Baru (`/orders/invoices/new`) dan Edit Invoice (`/orders/invoices/[id]/edit`), kueri produk **WAJIB** memuat relasi `product_variants(id, name, sku, price, cost_price, stock_quantity)` (dengan fallback jika gagal).
   - Produk yang memiliki variasi di-*unfold* (diratakan) menjadi opsi mandiri pada `ProductSelectCombobox` dengan format **`${product.name} - ${variant.name}`**, menampilkan `sku`, `price`, dan `stock_quantity` milik masing-masing variasi.
   - Setiap baris item di `orders.items_json` menyimpan `product_id`, `variant_id` (tersanitasi via `isUuid()`), dan `cost_price` varian.
   - Saat faktur memicu pemotongan stok & HPP (`syncOrderToLedger()` $\rightarrow$ `applyStockMovement()` & `generateItemizedHppJournalLines()`), mutasi kartu stok dicatat tepat pada partisi `variant_id` terkait di `v_stock_moves_ledger`, dan jurnal HPP (`501000`) menggunakan `cost_price` serta label nama/SKU spesifik variasi tersebut.
   - Tab **History Perpindahan Stok** pada halaman detail invoice (`/orders/invoices/[id]`) melakukan join ke `products(..., product_variants(id, name, sku))` dan `variant_id` untuk menampilkan nama serta SKU variasi yang akurat.
