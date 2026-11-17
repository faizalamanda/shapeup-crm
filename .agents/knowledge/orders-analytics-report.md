# Orders Analytics Report — ShapeUp CRM

Dokumen ini mendefinisikan standar arsitektur, rumus metrik, filter analitik, dan kontrak database untuk laporan **Orders** (`/reports/orders`).

---

## 1. Prinsip & Isolasi Data

- **Status Order Valid:** `shipped`, `processing`, `complete`, `completed`, `refunded`, `returned`, `returnrequest` (diselaraskan dengan `get_revenue_report_orders`).
- **Zona Waktu Dinamis:** Seluruh pengelompokan waktu (`date_trunc`, `ISODOW`, `HOUR`, dan matriks Heatmap 7×24) **WAJIB** menggunakan `(order_ts AT TIME ZONE p_timezone)` yang bersumber dari `activeBusiness?.timezone` (default `'Asia/Jakarta'`).
- **Toggle Pelanggan Tamu (`p_exclude_guest`):** Default `false` agar total `Net Sales` & `Gross Sales` selaras 100% dengan ringkasan KPI Revenue. Pengguna dapat mengaktifkan toggle *Kecualikan Tamu POS* (`true`) di UI untuk mengisolasi transaksi pelanggan terdaftar.
- **Filter Segment Channel (`p_platform`):** Memfilter metrik berdasarkan `source_platform` / `raw_source_data->'source_order'->>'channel'`.

---

## 2. Seksi Analitik & Rumus Metrik

### A. Tren Orders & Ringkasan KPI
- **Gross Sales:** `grand_total` (jika `> 0`), atau `GREATEST(0, subtotal - discount + shipping + fees + taxes)`.
- **Refunds:** `LEAST(gross_sales, GREATEST(raw_refunds, ledger_refund, status_implied_refund))` (menggabungkan `order_payments` `payment_kind = 'refund'` dan `raw_source_data->'refunds'` tanpa *double-counting*).
- **Net Sales:** `GREATEST(0, gross_sales - taxes - shipping - fees - refunds)`.
- **Granularitas Tren:** `day`, `week`, atau `month`, dilengkapi mode komparasi (`TemporalDateFilter` `showComparison={true}`) via pemanggilan paralel `Promise.all`.

### B. New vs. Returning Customers (Berbasis Order di Periode)
- Berbeda dari `/reports/customer-retention` (yang memakai kohort *first ordered*), laporan Orders mengevaluasi **seluruh order pada periode terpilih**:
  - **New:** Order yang `order_ts <= MIN(order_ts) OVER (PARTITION BY customer_key)` sepanjang masa.
  - **Returning:** Order lanjutan oleh pelanggan yang sudah memiliki order valid sebelum `order_ts` tersebut.

### C. Distribusi & Tren Rata-Rata
- **Item Count Distribution:** Bucket `1`, `2`, `3`, `4`, `5+` item per order.
- **Order Value Distribution:** Bucket IDR `Rp0 - Rp100rb`, `Rp100rb - Rp300rb`, `Rp300rb - Rp500rb`, `Rp500rb - Rp1jt`, `Rp1jt+`.
- **Average Order Gross & Items:** Tren rata-rata per granularitas dengan penanda `Highest` dan `Lowest`.

### D. Pola Waktu & Heatmap 7×24
- **Orders by Day (`ISODOW` 1–7)** & **Orders by Hour (`0–23`)** menyoroti hari dan jam tersibuk (*busiest day/hour*).
- **Heatmap:** Matriks 7 hari × 24 jam dengan pemilih metrik (`orders`, `gross_sales`, `net_sales`) dan ekspor CSV.

### E. Time to Complete Orders (Dengan Filter Cakupan)
- Mengevaluasi order berstatus `complete` / `completed` menggunakan resolusi waktu selesai: `date_completed_gmt` $\rightarrow$ `date_completed` $\rightarrow$ `updated_at` $\rightarrow$ `order_ts`.
- **Filter Cakupan (`p_completion_scope`):**
  - `'all'`: Semua order selesai.
  - `'non_pos'`: Mengecualikan transaksi POS/Kasir instan agar SLA pengiriman tidak terdistorsi oleh checkout kasir 0 detik.
  - `'has_date_completed'`: Hanya order yang memiliki timestamp `date_completed` / `date_completed_gmt` eksplisit.
- **Statistik:** Rata-rata (`AVG`), Median (`PERCENTILE_CONT(0.5)`), Terlama (`MAX`), serta persentase selesai $\le 1$ hari dan $\le 3$ hari dalam satuan `day` atau `hour`.

---

## 3. Kontrak Teknis & Performa

- **Database RPC:** `public.get_orders_report_metrics(p_business_id uuid, p_start_date timestamptz, p_end_date timestamptz, p_timezone text DEFAULT 'Asia/Jakarta', p_granularity text DEFAULT 'month', p_time_unit text DEFAULT 'day', p_exclude_guest boolean DEFAULT false, p_completion_scope text DEFAULT 'all', p_platform text DEFAULT 'all')`
- **File Migrasi:** `supabase/migrations/20261117133000_create_orders_report_rpc.sql`
- **Halaman UI:** `app/reports/orders/page.tsx`
- **Keamanan:** `STABLE SECURITY DEFINER` dengan guard `businesses.owner_id = auth.uid()` / `business_staff.profile_id = auth.uid()` (plus bypass `service_role`).
- **Frontend Cache:** L1 RAM Cache (TTL 60 detik) + `requestIdRef` untuk mencegah *race condition* saat pergantian filter cepat.

