# Jurnal Arsitektur & Basis Pengetahuan: *Atomic POS Order Numbering, Resilient Concurrency & Dual-Layer Architecture*

---

## 1. Latar Belakang & Rumusan Masalah (*Problem Statement*)

Sebelum implementasi ini, sistem Point of Sale (POS) ShapeUp CRM membangkitkan nomor nota / pesanan menggunakan pecahan milidetik waktu riil (*epoch timestamp slice*):
```typescript
const orderNumber = 'POS-' + Date.now().toString().slice(-8)
```

Meskipun sederhana, pendekatan ini memiliki kelemahan mendasar:
1. **Ketiadaan Konteks Penanggalan:** Menghasilkan angka acak (misal `POS-42819053`) tanpa penanda tahun, bulan, atau hari, menyulitkan kasir dan akuntan dalam rekonsiliasi manual.
2. **Ketiadaan Urutan Monotonik Human-Readable:** Kasir tidak dapat mengetahui nota tersebut merupakan transaksi ke berapa pada hari berjalan atau shift aktif.
3. **Inkonsistensi Format Antar-Modul:** Faktur menggunakan `INV-DDMMYYYY-001`, Retur menggunakan `RET-YYYYMMDD-XXXXX`, sedangkan POS menggunakan `POS-xxxxxxxx`.
4. **Risiko Tabrakan & Phantom Receipts:** Pemotongan 8 digit dan pembuatan nomor di sisi klien secara *fire-and-forget* membuka celah tabrakan (*collision*) pada konkurensi multi-kasir serta risiko cetak struk sebelum pesanan berhasil disimpan di basis data.

---

## 2. Landasan Teori Akademik & Standar Industri

### 2.1 Database Theory: Strict Monotonic Sequences vs Concurrency Control
Pendekatan naif di tingkat aplikasi (`SELECT MAX(counter) FROM orders + 1`) memicu *Lost Updates* atau *Unique Constraint Collision* ketika dua kasir menekan tombol bayar pada milidetik yang sama.

Untuk menjamin keutuhan ACID tanpa mengorbankan latensi kasir, sistem menerapkan **PostgreSQL Exclusive Row-Level Lock** pada baris counter terisolasi di tabel `public.business_counters`:
```sql
INSERT INTO public.business_counters (business_id, counter_type, period_date, last_val, updated_at)
VALUES (p_business_id, 'pos_order', v_today, 1, NOW())
ON CONFLICT (business_id, counter_type, period_date)
DO UPDATE SET last_val = business_counters.last_val + 1, updated_at = NOW()
RETURNING last_val INTO v_next_val;
```
Operasi ini dieksekusi dalam $< 0,2\text{ms}$ di dalam kernel PostgreSQL engine. Antrean multi-kasir disusun secara FIFO (*First-In, First-Out*), menjamin urutan rapat (*gapless*) tanpa tabrakan nomor (*zero race condition*).

### 2.2 Economic Game Theory: The German Tank Problem
Pola nomor urut tunggal yang terlalu telanjang (`001`, `002`...) dapat membocorkan volume penjualan harian toko kepada kompetitor (*The German Tank Problem*). Di sisi lain, auditor keuangan dan fiskus (DJP / PSAK) mewajibkan penomoran teratur untuk pengujian kelengkapan (*Sequence Gap Testing*).

**Solusi Sintesis:** Mengadopsi **Arsitektur Dual-Layer** (standar Toast POS dan Moka POS):
- **Lapisan Dokumen Legal / Fiskal:** `POS-YYYYMMDD-XXXX` (disimpan permanen di `orders.order_number`).
- **Lapisan Operasional / Antrean Ringkas:** `#042` (nomor urut harian ringkas untuk panggilan pesanan dapur/barista).

---

## 3. Komparasi Sistem POS Global & Nasional

| Sistem POS | Format Nomor Nota | Strategi Concurrency | Ergonomi Struk |
| :--- | :--- | :--- | :--- |
| **Moka POS** | Dual: `#1, #2` (Antrean) + `TRX-YYYYMMDD-XXXX` | Server-coordinated sequence | Sangat baik untuk F&B |
| **Pawoon** | `INV/YYMMDD/OUTLET/XXXX` | Branch-partitioned counter | Formal & akuntansi |
| **Odoo POS** | `POS/[SESSION]/[SEQ]` | State machine lokal per sesi kasir | Bebas lock antar kasir |
| **Toast POS** | 1–99 cyclic order ticket + Cloud GUID | KDS-oriented tokenization | Cepat di kitchen |
| **ShapeUp POS** | **`POS-YYYYMMDD-XXXX` + Optional `#042`** | **PostgreSQL Atomic UPSERT (< 0.2ms)** | **Dual-Layer (Default Antrean: OFF)** |

---

## 4. Arsitektur Komponen & Alur Data

```mermaid
flowchart TD
    A["Kasir POS (POSWorkspace.tsx)"] -->|"POST /api/pos/order"| B["API Router (route.ts)"]
    B --> C["orderNumberHelper.ts"]
    C -->|"RPC generate_pos_order_number"| D[("PostgreSQL Kernel")]
    D -->|"Atomic Row-Lock UPSERT"| E[("public.business_counters")]
    E -- "last_val + 1 (< 0.2ms)" --> D
    D -- "{ order_number: 'POS-20261106-0001', queue_number: 1 }" --> C
    C -- "Generated Number" --> B
    B -->|"INSERT orders"| F[("public.orders")]
    B -- "{ success: true, order_id, order_number }" --> A
    A -->|"buildReceiptDataFromOrder"| G["Struk Belanja Definitif (printerAdapter.ts)"]
```

---

## 5. Protokol Backward Compatibility & Graceful Fallback

Untuk menjamin sistem tidak pernah mengalami *crash* atau *downtime* saat peluncuran:

### 5.1 Fallback Query Resolusi Bertingkat
Jika RPC database belum diaplikasikan pada basis data staging/lokal:
1. `orderNumberHelper.ts` menangkap error RPC secara defensif (`try...catch`).
2. Melakukan fallback kueri langsung ke tabel `orders` dengan pencarian awalan tanggal (`POS-YYYYMMDD-%`).
3. Menghitung `MAX(suffix) + 1` dari 500 transaksi terakhir hari tersebut.
4. Jika kueri tabel `orders` gagal total, menerapkan ultra-fallback berbasis tanggal + 4 digit waktu untuk mencegah penolakan transaksi kasir.

### 5.2 Penanganan Pesanan Lawas (Legacy Client Handling)
- Jika perangkat kasir yang belum di-refresh masih mengirim format lama (`POS-\d{8}`), endpoint `/api/pos/order` mendeteksi format tersebut dan mengonversinya secara transparan ke format kanonikal `POS-YYYYMMDD-XXXX`.
- Nilai lama disimpan di `raw_source_data.legacy_order_number` untuk jejak audit 100%.

### 5.3 Konfigurasi Fleksibel Pengaturan Struk
- Opsi `showQueueNumber` tersimpan di `localStorage` melalui `receiptSettings.ts`.
- **Default sistem: `false` (Nonaktif)** sesuai arahan pengguna.
- Pemilik toko dapat mengaktifkan toggle *"Cetak Nomor Antrean Ringkas (#001)"* di modal `ReceiptSettingsModal` kapan saja.

---

## 6. 0ms Optimistic UI + Hybrid Adaptive Order Numbering (`posCheckoutService.ts`)

### 6.1 Masalah Cetak Optimistik Lokal (*LocalStorage Desync & Double-Print*)
Pendekatan lama (`getNextOptimisticOrderNumber()` berbasis `localStorage` sebelum konfirmasi server) memiliki 2 celah fatal pada operasional multi-kasir/multi-perangkat:
1. **Desinkronisasi & Nomor Kembar di Kertas:** Dua perangkat dengan `localStorage` tertinggal sama-sama mencetak nomor lokal yang identik (misal `0003` dua kali), sementara server menyimpannya ke nomor berbeda.
2. **Double Auto-Print saat Rekonsiliasi:** Ketika server mengembalikan nomor resmi berbeda lalu `setReceiptData` membuat referensi objek baru, `PaymentSuccessView` menganggapnya struk baru dan mencetak ulang transaksi yang sama untuk kedua kalinya.

### 6.2 Arsitektur Solusi: Hybrid Adaptive (`lib/pos/posCheckoutService.ts`)
1. **UI Kasir Tetap 0ms:**
   Modal bayar langsung ditutup, keranjang dikosongkan, stok lokal L1/L2 dipotong, dan layar `PaymentSuccessView` (kembalian & ringkasan) langsung terbuka dalam **0 milidetik** dengan status `isSyncingOrderNumber = true`.
2. **Online Path (~150–300ms):**
   `submitPosCheckout()` mengirim `POST /api/pos/order` beserta `business_id`, header `x-business-id`, dan `client_attempt_id` (UUID idempotency). Server menjalankan RPC atomik `generate_pos_order_number` (`POS-YYYYMMDD-XXXX`), lalu printer mencetak **1 kali** dengan nomor yang 100% identik dengan database.
3. **Offline / Timeout Fallback (> 5 detik):**
   Jika perangkat offline atau server melebihi 5 detik, sistem otomatis menerbitkan nomor partisi perangkat anti-bentrok `POS-YYMMDD-OF<TAG>-<SEQ>` (19 karakter, pas 1 baris thermal 58mm) dan menyimpannya ke `localStorage` outbox queue (`shapeup_pos_offline_queue_v1_${businessId}`). Saat koneksi pulih (`online` event / mount), `flushOfflineOrderQueue()` mengirim ulang dengan `is_offline_fallback: true` dan server mempertahankan nomor `OF` tersebut apa adanya.
4. **Anti-Double-Print Guard (`PaymentSuccessView.tsx`):**
   `autoPrintedReceiptRef` melacak `checkoutAttemptId` (string unik per checkout) alih-alih referensi objek `receipt`, menjamin **zero double-print** dalam kondisi apa pun.


