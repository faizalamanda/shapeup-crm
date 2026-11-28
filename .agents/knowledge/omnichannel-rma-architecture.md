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

3. **Lapis 3 — Plug-and-Play UI Components (`@/components/rma/*` & `/products/rma`):**
   - Halaman terpadu **Pusat Retur & RMA** berada di `/products/rma` ([page.tsx](file:///home/faiz-jazuli/shapeup-crm/app/products/rma/page.tsx)) di bawah menu **Products**, dengan hak akses gabungan untuk Staf Gudang (`manage_products`) maupun Admin Penjualan/Invoice (`manage_invoices`).
   - `<RmaActionTrigger order={order} onCompleted={...} />` ([RmaActionTrigger.tsx](file:///home/faiz-jazuli/shapeup-crm/components/rma/RmaActionTrigger.tsx)): Komponen tombol + modal 1 baris yang dapat dipasang di halaman mana pun (Order, Invoice, Profil Customer, Sidebar Chat WABA, atau Kanban Pipeline).
   - `<CreateRmaModal />` & `<RmaDetailModal />`: Berada di `components/rma/`, patuh penuh pada `FullScreenModal`, *Unconditional Hooks*, dan `prevIsOpenRef` *One-Time Transition Guard*.

---

## 2. Proteksi Kompatibilitas Data Lama (Zero Breaking Change)

1. **Graceful COA Fallback (`lib/accountHelper.ts`):** Akun baru `102100` dan `502100` di-seed otomatis namun tidak bersifat fatal; jika bisnis lama belum memilikinya pada sesi terbatas, sistem fallback secara aman ke `102000` dan `502000`/`503000`.
2. **Isolasi Sumber Karantina Historis (`source_type = 'order'` vs `'rma_receipt'`):**
   - Mutasi karantina dari pembatalan order biasa (`orderLedger.ts`, `source_type = 'order'`) tetap mengkredit `102000` saat dihapusbukukan (`hilang`) dan tidak menjurnal ganda saat diterima (`terima`).
   - Mutasi karantina baru dari RMA/POS (`rma_receipt`, `pos_return`, `order_return`) direklasifikasi secara presisi dari `102100` ke `102000` saat diterima ke rak utama.
3. **Kompatibilitas Laporan *Cash Basis* & *AP/AR Summary* (2-Journal Bridge untuk Saldo Kredit & Potong Piutang Lintas Invoice):**
   - Seluruh deskripsi jurnal RMA mempertahankan kata kunci `'Retur'` agar `get_ledger_balances` (*Cash Basis*) tidak pernah salah mengenali Nota Kredit piutang belum lunas sebagai penerimaan kas.
   - Ketika pesanan/invoice yang **sudah lunas** diretur ke **Saldo Kredit Pelanggan (`202000`)** atau langsung **Dipotongkan ke Piutang Nota Lain (`apply_other_invoice`)**, sistem membuat **2-Journal Bridge**:
     1. `settlement_journal` (berkata `'Retur'`): `Dr 401100 Retur Penjualan / Cr 103000 Piutang Usaha`
     2. `deposit_transfer_journal` (deskripsi `'Alokasi Deposit Saldo Kredit ...'`, tanpa kata `'Retur'` atau `'Pembayaran'`): `Dr 103000 Piutang Usaha / Cr 202000 Saldo Kredit Pelanggan`
     3. Saat Saldo Kredit dipakai memotong Nota Lain (`#INV-B`), `recordOrderPayment` atau `process_rma_transition_v1` memposting: `Dr 202000 Saldo Kredit Pelanggan / Cr 103000 Piutang Usaha` pada `#INV-B`.
   - Jembatan 2 jurnal ini menjamin akun `103000` pada `#INV-A` bersaldo bersih `0` di *Accrual Basis*, membalik pendapatan kas pada `#INV-A` di *Cash Basis*, dan mengakui pelunasan kas pada `#INV-B` tanpa *double-counting*.

---

## 3. Dual-Layer Store Credit Sub-Ledger & Cross-Invoice AR Allocation (Zoho Books + Odoo ERP Hybrid)

1. **Lapis 1 — Customer Sub-Ledger (`customer_store_credits` & `store_credit_ledger`):**
   - `public.customer_store_credits`: Menyimpan saldo kredit aktif per pelanggan (`balance`, `lifetime_issued`, `lifetime_redeemed`, `UNIQUE(business_id, customer_id)`, diperkuat di [20261128120000_fix_rma_express_and_store_credit_schema.sql](file:///home/faiz-jazuli/shapeup-crm/supabase/migrations/20261128120000_fix_rma_express_and_store_credit_schema.sql)).
   - `public.store_credit_ledger`: Buku besar pembantu *append-only* per pelanggan (`entry_type IN ('issued', 'redeemed', 'reversed', 'adjusted')`, `amount`, `balance_after`, `return_id`, `rma_id`, `order_id`).
2. **Lapis 2 — General Ledger COA (`202000 Saldo Kredit Pelanggan`):**
   - Total `SUM(balance)` seluruh pelanggan di `customer_store_credits` wajib selalu 1:1 dengan saldo kredit akun `[202000] Saldo Kredit Pelanggan` (`LIABILITY`) di Neraca Akuntansi.
3. **2 Jalur Pemotongan Piutang Lintas Invoice (`0ms` Extra Latency + 1-Roundtrip ACID RPC):**
   - **Jalur A (Saat Retur — Ala Zoho Books):** Jika pelanggan memiliki nota lain yang belum lunas (`otherUnpaidOrders` dari `getOrderRmaPreview`), pengguna dapat memilih **`📄 Potongkan Langsung ke Piutang Nota Lain`** (`settlement_method = 'apply_other_invoice'`, `target_order_id`). RPC `process_rma_transition_v1` menerbitkan saldo kredit dari nota asal dan langsung memotong piutang nota tujuan dalam 1 transaksi database atomik.
   - **Jalur B (Saat Buka Nota Belum Lunas — Ala Odoo ERP):** Endpoint `GET /api/orders/invoices/[id]` memuat `customer_store_credit_balance` di dalam `Promise.all` utama (`0ms` extra latency). Jika saldo $> 0$, halaman detail invoice menampilkan banner hijau **`🪙 Saldo Kredit Pelanggan Tersedia`** dengan tombol 1-klik **`⚡ Gunakan Saldo Kredit (Potong Tagihan Ini)`** yang memanggil `recordOrderPayment()` $\rightarrow$ `redeem_store_credit_v1` (meneruskan `actorId` pengguna agar row-lock `FOR UPDATE` sukses dalam 1 RTT). Jika pembayaran ini di-*Void*, `voidOrderPayment()` otomatis mengembalikan saldo ke `customer_store_credits` dan mencatat `entry_type = 'reversed'` di `store_credit_ledger`.

---

## 4. Standar Keamanan PL/pgSQL, RBAC & Multi-Tenant RLS untuk RMA

1. **PL/pgSQL `%ROWTYPE` & Nested `IF` Guard (`process_rma_transition_v1`):**
   - Variabel header RMA wajib dideklarasikan sebagai `v_rma public.rma_requests%ROWTYPE` (bukan `record` tak bertipe) dan pengecekan `v_rma.settlement_stage = 'settled'` wajib berada di dalam *nested* `IF v_mode = 'settle' THEN` agar evaluasi parameter PL/pgSQL tidak pernah melempar `SQLSTATE 55000: record "v_rma" is not assigned yet` pada `mode = 'express'`.
   - Cabang `mode = 'express'` mendukung kelima disposisi fisik (`restock`, `quarantine`, `writeoff`, `rtv_vendor`, `lost_in_transit`) secara identik dengan `mode = 'inspect'`.
2. **In-Memory RBAC Guard (`verifyRmaAccess`) & Strict Client `business_id` Scoping:**
   - Mutasi pada `POST /api/rma` dan `POST /api/inventory/returns` dilindungi oleh `verifyRmaAccess()` (di-cache 60 detik di memori, `0ms` overhead) yang selaras dengan `canAccessPath('/products/rma')`.
   - Seluruh query client langsung ke `v_stock_moves_ledger` dan `rma_requests` wajib menyertakan `.eq('business_id', businessId)` untuk mengisolasi cabang multi-bisnis milik satu Owner dan memaksimalkan *B-Tree Index Scan*.



