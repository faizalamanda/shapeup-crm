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
   - `'completed'` = **Selesai**: Pesanan/pekerjaan telah diselesaikan dan barang telah terkirim ke pelanggan.
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

---

## 3. Integrasi Arsitektur Modul Reusable

Semua API route invoice **WAJIB** menggunakan modul terpadu yang telah disediakan:

| Kebutuhan | Modul Standar | Fungsi Utama |
|---|---|---|
| **Auth & Multi-Tenant** | `@/lib/apiContext.ts` | `getApiContext()` (0ms JWT fast-path, profile cache, admin client) |
| **Pencatatan Pembayaran / DP** | `@/lib/paymentLedger.ts` | `recordOrderPayment()` & `recalculateOrderPaymentStatus()` |
| **Buku Besar Penjualan & Stok** | `@/lib/orderLedger.ts` | `syncOrderToLedger()` |
| **Posting Jurnal Anti-Duplikasi** | `@/lib/journalHelper.ts` | `postJournalTransaction()` |
| **Bagan Akun (COA)** | `@/lib/accountHelper.ts` | `getOrCreateDefaultAccounts()` |
| **Sanitasi UUID** | `@/lib/utils.ts` | `isUuid()` (anti-crash PostgreSQL string kosong `""`) |

---

## 4. Alur Akuntansi Keuangan Double-Entry

### 4.1 Saat Faktur Diterbitkan (`processing` atau `completed`)
`syncOrderToLedger()` menerbitkan jurnal pengakuan penjualan (`salesTx`):
- **Debit:** `103000 Piutang Usaha` (sebesar `grand_total`)
- **Debit:** `401100 Potongan & Diskon Penjualan` (jika ada diskon)
- **Kredit:** `401000 Pendapatan Penjualan` (sebesar `subtotal`)
- **Kredit:** `402000 Pendapatan Ongkos Kirim` (jika ada biaya kirim)
- **Kredit/Debit:** `403000 Biaya Lain-Lain / Admin` (jika ada)

Jika status faktur memenuhi `journalHppStatuses` (contoh: `processing` / `completed`):
- **Debit:** `501000 Beban Pokok Penjualan (HPP)`
- **Kredit:** `104000 Persediaan Barang Dagang`

### 4.2 Saat Uang Muka (DP) atau Pembayaran Termin Diterima
Setiap pembayaran dicatat ke tabel **`order_payments`** sebagai *Single Source of Truth* melalui `recordOrderPayment()`:
- **Debit:** `101000 Kas POS` atau `101200 Bank / QRIS` (sebesar uang yang diterima)
- **Kredit:** `103000 Piutang Usaha` (sebesar uang yang diterima)

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
