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

## 2. Multi-Tender & Split Payment Architecture

### 2.1 Hubungan 1:N Antara Order dan Pembayaran
- Tabel `order_payments` bertindak sebagai *Single Source of Truth* untuk semua arus kas/tender:
  - Kolom `payment_kind`: `'payment'` (penerimaan), `'refund'` (pengembalian), `'void'` (pembatalan).
  - Kolom `status`: `'confirmed'`, `'voided'`, `'refunded'`.
  - Kolom `voided_payment_id`: Foreign key ke ID baris pembayaran yang dibatalkan.
- Satu pesanan (`orders`) dapat dibayar menggunakan kombinasi metode:
  - Misal: Tunai Rp 50.000 + QRIS Rp 50.000 untuk total belanja Rp 100.000.
  - Masing-masing disimpan sebagai baris terpisah di `order_payments`.

### 2.2 Cicilan & Uang Muka (Partial Payment / DP)
- Jika pelanggan membayar kurang dari tagihan (`amount_paid < grand_total`):
  - Kolom `orders.payment_status` diset menjadi `'partial'`.
  - Sisa tagihan diakui sebagai **Piutang Usaha** (`103000`):
    - Jurnal Penjualan: Debit Piutang `103000` = Grand Total, Credit Pendapatan `401000`.
    - Jurnal Pembayaran: Debit Kas/Bank = DP yang dibayar, Credit Piutang `103000` = DP yang dibayar.
  - Sisa saldo piutang dapat dilunasi kapan saja melalui tombol **Bayar Sisa Tagihan** di `POSOrderDetailModal` yang memanggil `POST /api/pos/order/pay`.

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


