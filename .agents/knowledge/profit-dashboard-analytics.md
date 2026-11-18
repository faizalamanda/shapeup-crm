# Profit Dashboard Analytics — ShapeUp CRM

Dokumen ini mendefinisikan standar arsitektur, rumus metrik, sumber data buku besar (COA), dan kontrak database untuk laporan **Profit Dashboard** (`/reports/profit`).

---

## 1. Prinsip & Ruang Lingkup Data

- **Cakupan Bisnis Aktif:** Seluruh agregasi hanya mengevaluasi **unit bisnis yang sedang aktif** (`p_business_id`) dengan filter channel opsional (`p_platform`) dan toggle pelanggan tamu (`p_exclude_guest`, default `false`).
- **Status Order Valid:** `shipped`, `processing`, `complete`, `completed`, `refunded`, `returned`, `returnrequest` (diselaraskan dengan `get_orders_report_metrics`).
- **Zona Waktu Dinamis:** Pengelompokan waktu (`day`, `week`, `month`) pada `orders` (`order_ts`) maupun `transactions` (`t.date`) **WAJIB** menggunakan `AT TIME ZONE p_timezone` yang bersumber dari `activeBusiness?.timezone` (default `'Asia/Jakarta'`).
- **Tanpa Metrik Ad Spend Terpisah:** Seluruh biaya diambil langsung dari mutasi jurnal akun `EXPENSE` pada Bagan Akun (COA) tanpa asumsi atau estimasi Ad Spend eksternal.

---

## 2. Seksi Analitik & Rumus Metrik

### A. Pendapatan, Biaya & Profitabilitas — 100% Single Source of Truth (`journal_lines` + `transactions` + `accounts`)
Angka finansial utama (`net_revenue`, `total_costs`, `cogs`, `gross_profit`, `net_profit`, `net_profit_margin`) bersumber **100% dari Jurnal Ledger Akuntansi** (basis akrual berdasarkan `transactions.date`), sehingga identik dan rekonsiliatif dengan [Laporan Laba Rugi](../../app/accounting/profit-loss/page.tsx):
- **Net Revenue (`net_revenue`):** `SUM(credit - debit)` untuk seluruh baris jurnal pada akun bertipe `REVENUE` (`401000`, `401100`, `402000`, `403000`, dll.).
- **Total Costs (`total_costs`):** `SUM(debit - credit)` untuk seluruh baris jurnal pada akun bertipe `EXPENSE`, dikelompokkan berdasarkan kode/sub-tipe COA:
  - **COGS / HPP (`cogs`):** `sub_type = 'cogs'` atau `code = '501000'`.
  - **Gaji & Upah (`payroll`):** `code = '503300'` atau nama mengandung `gaji` / `upah`.
  - **Transportasi & Kirim (`shipping`):** `code = '503500'` atau nama mengandung `transport` / `pengiriman` / `ongkir`.
  - **Biaya Bank & Transaksi (`transaction_fees`):** `code = '504000'` atau nama mengandung `administrasi bank` / `bunga`.
  - **Operasional & Lainnya (`operational`):** Seluruh akun `EXPENSE` lainnya (`502000`, `503000–503200`, `503400`, `503600–503900`, `505000`, dll.).
- **Net Profit:** $\text{Net Revenue} - \text{Total Costs}$.
- **Net Profit Margin:** $\frac{\text{Net Profit}}{\text{Net Revenue}} \times 100\%$.
- **Gross Profit & Margin:** $\text{Net Revenue} - \text{COGS}$ dan $\frac{\text{Gross Profit}}{\text{Net Revenue}} \times 100\%$.

### B. Metrik Operasional, Channel & Atribusi (`orders` + `order_payments`)
Tabel `orders` dan `order_payments` digunakan khusus untuk metrik operasional dan atribusi yang tidak tersimpan di jurnal per-item/per-pelanggan:
- **Gross Sales & Net Sales per Channel/UTM:** `gross_sales` (`grand_total` atau `subtotal - discount + shipping + fees + taxes`), `refunds`, `net_sales`, serta atribusi `source_platform` / `utm_source`.
- **Order Summary:** `Orders`, `Avg. Order Value (AOV)`, `Avg. Order Profit`, `Avg. Order Cost`, `Avg. Items per Order`, dan `Purchase Frequency` ($\frac{\text{Orders}}{\text{Total Customers}}$).
- **Customer Summary:** `Total Customers`, `New Customers` (berdasarkan `MIN(order_ts)` sepanjang masa), `Returning Customers`, dan `Repurchase Rate (%)`.
- **Others:** `Shipping Charged`, `Taxes Collected`, `Order Fees`, `Discounts`, dan `Refunds`.

---

## 3. Kontrak Teknis & Performa

- **Database RPC:** `public.get_profit_dashboard_metrics(p_business_id uuid, p_start_date timestamptz, p_end_date timestamptz, p_timezone text DEFAULT 'Asia/Jakarta', p_granularity text DEFAULT 'day', p_exclude_guest boolean DEFAULT false, p_platform text DEFAULT 'all')`
- **File Migrasi:** `supabase/migrations/20261118113000_create_profit_dashboard_rpc.sql`
- **Halaman UI:** `app/reports/profit/page.tsx` (terdaftar di sub-menu `Reports` pada `app/layout.tsx`)
- **Keamanan:** `STABLE SECURITY DEFINER` dengan guard `businesses.owner_id = auth.uid()` / `business_staff.profile_id = auth.uid()` (plus bypass `service_role`).
- **Frontend Cache & Komparasi:** Pemanggilan paralel `Promise.all` (dilindungi `requestIdRef`) + L1 RAM Cache (TTL 60 detik).

