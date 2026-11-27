# Unified Omnichannel RMA, Credit Memo & Quarantine Architecture

Dokumen ini mendefinisikan arsitektur modular **"Sekali Edit, Berubah Semua"** untuk seluruh alur Retur, Tukar Barang, Nota Kredit (*Credit Memo*), dan Karantina Gudang lintas modul di ShapeUp CRM.

---

## 1. Arsitektur 3-Lapis Lintas Fitur (*Single Source of Truth*)

Seluruh saluran penjualan (POS Kasir, Faktur B2B `/orders/invoices`, Pesanan Omnichannel `/orders`, Inbox WABA, Pipeline, hingga Webhook WooCommerce/Accurate) berbagi **satu inti matematika & jurnal yang sama**:

1. **Lapis 1 — Pure Calculation & Accounting Core ([engine.ts](file:///home/faiz-jazuli/shapeup-crm/lib/pos/returns/engine.ts)):**
   - Bebas I/O database (berjalan `< 1 ms` baik di browser klien maupun di server Node.js).
   - `computeReturnableLines()` & `quoteReturn()`: Prorata diskon global, sisa kuota item yang bisa diretur, dan *restocking fee*.
   - `buildDispositionInventoryLines()`: Satu-satunya fungsi penyusun jurnal persediaan & kerugian kualitas (PSAK 115 & PSAK 202 Par. 34) yang dipakai bersama oleh **POS Return/Exchange** maupun **Omnichannel RMA**:
     - `restock` $\rightarrow$ `Dr 102000 Persediaan Barang Dagangan` / `Cr 501000 HPP`
     - `quarantine` $\rightarrow$ `Dr 102100 Persediaan Karantina & Retur` / `Cr 501000 HPP`
     - `writeoff` / `lost_in_transit` $\rightarrow$ `Dr 502100 Beban Kerusakan & Penyusutan Retur` / `Cr 501000 HPP`
     - `rtv_vendor` $\rightarrow$ `Dr 201000 Hutang Usaha` / `Cr 501000 HPP`

2. **Lapis 2 — Unified Server Orchestrator ([index.ts](file:///home/faiz-jazuli/shapeup-crm/lib/rma/index.ts) & [rmaService.ts](file:///home/faiz-jazuli/shapeup-crm/lib/rma/rmaService.ts)):**
   - Mengecek kuota retur gabungan lintas `pos_return_items` DAN `rma_items` dalam 1 `Promise.all` paralel sehingga item yang sudah diajukan RMA tidak pernah bisa diretur ganda di kasir POS (dan sebaliknya).
   - Mengeksekusi mutasi database melalui 1-roundtrip Semi-Modular ACID RPC (`process_rma_transition_v1` & `process_quarantine_batch_v1` pada [20261127093000_create_omnichannel_rma_engine.sql](file:///home/faiz-jazuli/shapeup-crm/supabase/migrations/20261127093000_create_omnichannel_rma_engine.sql)).

3. **Lapis 3 — Plug-and-Play UI Components:**
   - `<RmaActionTrigger order={order} onCompleted={...} />` ([RmaActionTrigger.tsx](file:///home/faiz-jazuli/shapeup-crm/components/rma/RmaActionTrigger.tsx)): Komponen tombol + modal 1 baris yang dapat dipasang di halaman mana pun (Order, Invoice, Profil Customer, Sidebar Chat WABA, atau Kanban Pipeline).
   - `<CreateRmaModal />` & `<RmaDetailModal />`: Patuh penuh pada `FullScreenModal`, *Unconditional Hooks*, dan `prevIsOpenRef` *One-Time Transition Guard*.

---

## 2. Proteksi Kompatibilitas Data Lama (Zero Breaking Change)

1. **Graceful COA Fallback (`lib/accountHelper.ts`):** Akun baru `102100` dan `502100` di-seed otomatis namun tidak bersifat fatal; jika bisnis lama belum memilikinya pada sesi terbatas, sistem fallback secara aman ke `102000` dan `502000`/`503000`.
2. **Isolasi Sumber Karantina Historis (`source_type = 'order'` vs `'rma_receipt'`):**
   - Mutasi karantina dari pembatalan order biasa (`orderLedger.ts`, `source_type = 'order'`) tetap mengkredit `102000` saat dihapusbukukan (`hilang`) dan tidak menjurnal ganda saat diterima (`terima`).
   - Mutasi karantina baru dari RMA/POS (`rma_receipt`, `pos_return`, `order_return`) direklasifikasi secara presisi dari `102100` ke `102000` saat diterima ke rak utama.
3. **Kompatibilitas Laporan *Cash Basis* & *AP/AR Summary*:**
   - Seluruh deskripsi jurnal RMA mempertahankan kata kunci `'Retur'` agar `get_ledger_balances` (*Cash Basis*) tidak pernah salah mengenali Nota Kredit piutang belum lunas sebagai penerimaan kas.

