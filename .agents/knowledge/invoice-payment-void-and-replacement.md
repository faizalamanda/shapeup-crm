# Invoice Payment Void & Replacement Ledger (PSAK 225, PSAK 109, & PSAK 115)

Dokumen knowledge ini menetapkan standar arsitektur akuntansi dan teknis untuk pembatalan (**Void**) serta penggantian (**Replace / Remove & Redo**) pembayaran pada modul **Faktur Penjualan (Invoice)** di ShapeUp CRM.

---

## 1. Landasan Standar Akuntansi & ERP

1. **PSAK 225 / IAS 8 (*Koreksi Kesalahan & Same-Date Reversal Principle*):**
   - Kesalahan pencatatan metode/akun Kas & Bank COA (misal: uang masuk ke Bank Mandiri tetapi tercatat ke Bank BCA) atau kesalahan nominal pembayaran dikoreksi menggunakan **Jurnal Pembalik (*Reversing Entry*)**.
   - **Tanggal Efektif Jurnal Pembalik:** Jurnal pembalik (`void`) wajib diposting pada **tanggal efektif pembayaran asal** (`targetPay.date` / `targetPay.created_at`) agar mutasi Buku Besar Bank dan Laporan Arus Kas pada tanggal terjadinya kesalahan langsung saling meniadakan (*net zero* = Rp 0) dan tidak menimbulkan distorsi saldo akhir (*cut-off mismatch*) lintas bulan.
   - **Timestamp Audit Riil:** Waktu eksekusi pembatalan yang sebenarnya tetap dicatat pada kolom `created_at` di baris `order_payments` bertipe `payment_kind = 'void'` untuk keperluan audit IT (ISO 27001 / SOX 404).

2. **PSAK 109 / IFRS 9 (*Derecognition & Restoration of Accounts Receivable*):**
   - Ketika pembayaran dibatalkan (di-void), penghentian pengakuan piutang batal dan saldo **Piutang Usaha (`103000`)** wajib direstorasi di sisi **Debit**, sementara akun **Kas/Bank COA asal** dikurangi di sisi **Kredit**.

3. **PSAK 115 / IFRS 15 (*Two-Dimensional Separation of Concerns*):**
   - Pengakuan pendapatan dan penyerahan barang/jasa (`orders.status`: `processing`, `shipped`, `completed`) terpisah secara independen dari penyelesaian kas (`orders.payment_status`: `unpaid`, `partial`, `paid`).
   - Me-void atau mengganti pembayaran **hanya** memutasi dimensi keuangan (`payment_status`, `amount_paid`, `payment_method`), tanpa memundurkan `orders.status` dan tanpa memicu mutasi ulang kartu stok gudang (`stock_moves`) atau jurnal HPP (`501000`).

4. **Pure Append-Only & Zero DELETE Policy:**
   - Dilarang keras melakukan `DELETE` fisik pada tabel `order_payments` maupun `transactions` untuk pembayaran yang telah terjurnal. Seluruh koreksi (baik melalui tombol **Void / Ganti Pembayaran** di Detail Invoice maupun melalui halaman **Edit Invoice**) wajib menggunakan mekanisme *append-only* via `voidOrderPayment()` dan `recordOrderPayment()`.

---

## 2. Alur Jurnal Double-Entry

Misalkan Faktur `#INV-02072026-001` senilai **Rp 1.500.000** awalnya dicatat lunas ke `[101201] Bank BCA` pada `2026-11-10`, lalu diganti ke `[101202] Bank Mandiri`:

1. **Jurnal Pembayaran Awal (`2026-11-10`):**
   - **Debit:** `[101201] Bank BCA` = Rp 1.500.000
   - **Kredit:** `[103000] Piutang Usaha` = Rp 1.500.000
2. **Jurnal Pembalik / Void (`2026-11-10` — `Void Pembayaran Invoice #INV-02072026-001`):**
   - **Debit:** `[103000] Piutang Usaha` = Rp 1.500.000
   - **Kredit:** `[101201] Bank BCA` = Rp 1.500.000
3. **Jurnal Pembayaran Pengganti (`2026-11-10` — `Pengganti Pembayaran Invoice #INV-02072026-001`):**
   - **Debit:** `[101202] Bank Mandiri` = Rp 1.500.000
   - **Kredit:** `[103000] Piutang Usaha` = Rp 1.500.000

### Kompatibilitas dengan RPC Laporan Akuntansi:
- **Laporan Laba Rugi (*Accrual & Cash Basis* — `get_ledger_balances`):**
  Pada *Cash Basis*, jurnal Void (`Debit 103000 Piutang Usaha`) otomatis menghasilkan pengurang proporsional (`-jl_sales.credit`), sehingga ketika pembayaran pengganti (`Credit 103000 Piutang Usaha`) masuk, pendapatan *Cash Basis* tetap akurat 1x (bebas *double-counting*).
- **Laporan Arus Kas (`get_cash_flow_summary` & `get_cash_flow_analytics`):**
  Debit dan Kredit pada akun Bank BCA yang salah pilih menghasilkan `SUM(jl.debit - jl.credit) = 0` pada tanggal tersebut.

---

## 3. Arsitektur Endpoint & Komponen Terkait

| File | Peran & Tanggung Jawab |
| :--- | :--- |
| [lib/paymentLedger.ts](file:///home/faiz-jazuli/shapeup-crm/lib/paymentLedger.ts) | Menyediakan `voidOrderPayment()`, `recordOrderPayment()`, dan `recalculateOrderPaymentStatus()` (termasuk sinkronisasi `orders.payment_method`). |
| [lib/orderLedger.ts](file:///home/faiz-jazuli/shapeup-crm/lib/orderLedger.ts) | `syncOrderToLedger()` memfilter `activePaymentTxs` (mengabaikan transaksi pembayaran yang sudah di-void) dan hanya membalik pembayaran yang masih aktif saat faktur berstatus `cancelled`, `refunded`, atau `returned`. |
| [app/api/orders/invoices/[id]/payment/route.ts](file:///home/faiz-jazuli/shapeup-crm/app/api/orders/invoices/%5Bid%5D/payment/route.ts) | Menangani `action: 'record'`, `action: 'void'`, dan `action: 'replace'` (dilengkapi *legacy baseline backfill* untuk faktur lama yang belum memiliki baris di `order_payments`). |
| [app/api/orders/invoices/[id]/route.ts](file:///home/faiz-jazuli/shapeup-crm/app/api/orders/invoices/%5Bid%5D/route.ts) | `GET` mengembalikan `payments` (aktif) dan `payment_history` (termasuk yang telah di-void beserta `void_entry`). `PUT` menyinkronkan perubahan pembayaran di halaman Edit Invoice secara *append-only*. |
| [app/orders/invoices/[id]/page.tsx](file:///home/faiz-jazuli/shapeup-crm/app/orders/invoices/%5Bid%5D/page.tsx) | Menampilkan tombol **`🔄 Ganti Pembayaran`** dan **`🚫 Void`** pada setiap baris pembayaran aktif, toggle **`Lihat X Void`**, serta modal terpadu untuk Void/Ganti Pembayaran dengan validasi `void_reason` minimal 5 karakter. |

