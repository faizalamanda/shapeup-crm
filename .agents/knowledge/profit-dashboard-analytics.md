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

### A. Pendapatan & Order (`orders` + `order_payments`)
- **Gross Sales:** `grand_total` (jika `> 0`), atau `GREATEST(0, subtotal - discount + shipping + fees + taxes)`.
- **Refunds:** `LEAST(gross_sales, GREATEST(raw_refunds, ledger_refund, status_implied_refund))`.
- **Net Revenue (Net Sales):** `GREATEST(0, gross_sales - taxes - shipping - fees - refunds)`.
- **Channel & UTM Attribution:** Mengelompokkan `source_platform` / `raw_source_data->'source_order'->>'channel'` dan `raw_source_data->'source_order'->>'utm_source'`.

### B. Biaya & Profitabilitas (`journal_lines` + `transactions` + `accounts`)
Semua baris jurnal bertipe `EXPENSE` (`SUM(debit - credit)`) dalam rentang `p_start_date` s.d. `p_end_date` dikelompokkan berdasarkan kode/sub-tipe COA:
- **COGS / HPP (`cogs`):** `sub_type = 'cogs'` atau `code = '501000'`.
- **Gaji & Upah (`payroll`):** `code = '503300'` atau nama mengandung `gaji` / `upah`.
- **Transportasi & Kirim (`shipping`):** `code = '503500'` atau nama mengandung `transport` / `pengiriman` / `ongkir`.
- **Biaya Bank & Transaksi (`transaction_fees`):** `code = '504000'` (ditambah `orders.other_fees`).
- **Operasional & Lainnya (`operational`):** Seluruh akun `EXPENSE` lainnya (`502000`, `503000–503200`, `503400`, `503600–503900`, `505000`, dll.).
- **Total Costs:** $\text{COGS} + \text{Payroll} + \text{Shipping Cost} + \text{Transaction Fees} + \text{Operational Cost}$.
- **Net Profit:** $\text{Net Revenue} - \text{Total Costs}$.
- **Net Profit Margin:** $\frac{\text{Net Profit}}{\text{Net Revenue}} \times 100\%$.
- **Gross Profit & Margin:** $\text{Net Revenue} - \text{COGS}$ dan $\frac{\text{Gross Profit}}{\text{Net Revenue}} \times 100\%$.

### C. Ringkasan Order, Pelanggan & Lainnya
- **Order Summary:** `Avg. Order Value (AOV)`, `Avg. Order Profit`, `Avg. Order Cost`, `Avg. Items per Order`, dan `Purchase Frequency` ($\frac{\text{Orders}}{\text{Total Customers}}$).
- **Customer Summary:** `Total Customers`, `New Customers` (berdasarkan `MIN(order_ts)` sepanjang masa), `Returning Customers`, dan `Repurchase Rate (%)`.
- **Others:** `Shipping Charged`, `Taxes Collected`, `Fees`, `Discounts`, dan `Refunds`.

---

## 3. Kontrak Teknis & Performa

- **Database RPC:** `public.get_profit_dashboard_metrics(p_business_id uuid, p_start_date timestamptz, p_end_date timestamptz, p_timezone text DEFAULT 'Asia/Jakarta', p_granularity text DEFAULT 'day', p_exclude_guest boolean DEFAULT false, p_platform text DEFAULT 'all')`
- **File Migrasi:** `supabase/migrations/20261118113000_create_profit_dashboard_rpc.sql`
- **Halaman UI:** `app/reports/profit/page.tsx` (terdaftar di sub-menu `Reports` pada `app/layout.tsx`)
- **Keamanan:** `STABLE SECURITY DEFINER` dengan guard `businesses.owner_id = auth.uid()` / `business_staff.profile_id = auth.uid()` (plus bypass `service_role`).
- **Frontend Cache & Komparasi:** Pemanggilan paralel `Promise.all` (dilindungi `requestIdRef`) + L1 RAM Cache (TTL 60 detik).

