# Customer Retention Analytics — ShapeUp CRM

Dokumen ini mendefinisikan standar arsitektur, rumus metrik, dan kontrak database untuk laporan **Retensi Pelanggan** (`/reports/customer-retention`).

---

## 1. Definisi Kohort (*First Ordered*)

- Laporan mengevaluasi pelanggan berdasarkan **tanggal pesanan pertamanya (`MIN(order_ts)`)** yang jatuh di dalam rentang `p_start_date` s.d. `p_end_date` (dalam zona waktu bisnis).
- Setelah pelanggan masuk ke kohort periode tersebut, **seluruh pesanan valid sepanjang masa (*lifetime*)** milik pelanggan tersebut ikut dihitung—termasuk pesanan ulang yang terjadi setelah `p_end_date`.
- Status pesanan yang dihitung: `shipped`, `processing`, `complete`, `completed`.
- **Isolasi Pelanggan Tamu (`p_exclude_guest`):** Secara default `true`, mengecualikan transaksi tanpa `customer_id` atau yang tertaut ke akun tamu (`phone = '0'` atau `email = 'guest@business.com'`).

---

## 2. Empat Seksi Analitik & Rumus Metrik

### A. Distribusi Pesanan Sepanjang Masa (*Orders Over Customer Lifetime*)
- **Bucket Jumlah Pesanan (`order_buckets`):** `1`, `2`, `3`, `4`, `5-9`, `10+`.
- Setiap bucket mengembalikan:
  - `customers`: jumlah pelanggan unik pada bucket tersebut (Sumbu Y kiri, biru).
  - `avg_order_spend`: `SUM(lifetime_spend) / SUM(lifetime_orders)` (Sumbu Y kanan, amber).
- **Tingkat Retensi (*Retention Rate*):**
  $$\text{Retention Rate} = \frac{\text{returning\_customers (2+ pesanan)}}{\text{total\_customers}} \times 100\%$$
- **Kelipatan LTV (*LTV Multiplier*):**
  $$\text{Multiplier} = \frac{\text{returning\_avg\_ltv}}{\text{onetime\_avg\_ltv}}$$

### B. Pelanggan Sekali Beli vs Pelanggan Repeat
- **Pelanggan Sekali Beli (`lifetime_orders = 1`):** menampilkan persentase terhadap total pelanggan, `Jumlah`, `Pesanan`, `Total Belanja`, dan `Rata-rata Pesanan`.
- **Pelanggan Repeat (`lifetime_orders >= 2`):** menampilkan metrik yang sama untuk pelanggan yang kembali berbelanja.

### C. Jeda Waktu Repeat Order (*Time Between Repeat Orders*)
- Dihitung menggunakan *window function* `LAG(order_ts) OVER (PARTITION BY customer_key ORDER BY order_ts ASC)` untuk seluruh pelanggan dengan `lifetime_orders >= 2`.
- Selisih tiap pasangan pesanan berurutan dikonversi ke hari (`gap_days = EXTRACT(EPOCH FROM (order_ts - prev_order_ts)) / 86400.0`).
- Dikelompokkan ke 13 bucket (`0`–`11`, `12+`) sesuai satuan `p_time_unit`:
  - `day`: pembagi `1.0`
  - `week`: pembagi `7.0`
  - `month`: pembagi `30.0`
- Ringkasan sisi kanan menampilkan `repeat_avg_days`, `repeat_min_days` (Tercepat), dan `repeat_max_days` (Terlama) yang dibagi dengan pembagi satuan aktif.

### D. Total Item Dibeli Sepanjang Masa (*Items Bought Over Customer Lifetime*)
- Total kuantitas item per pelanggan diekstrak dari `items_json` (`quantity` / `qty`).
- Dikelompokkan ke bucket (`item_buckets`): `1`, `2`, `3`, `4`, `5`, `6`, `7-9`, `10-19`, `20+`.
- Ringkasan sisi kanan menampilkan rata-rata, minimum, dan maksimum item sepanjang masa.

---

## 3. Kontrak Teknis & Performa

- **Database RPC:** `public.get_customer_retention_metrics(p_business_id uuid, p_start_date timestamptz, p_end_date timestamptz, p_time_unit text DEFAULT 'week', p_exclude_guest boolean DEFAULT true)`
- **File Migrasi:** `supabase/migrations/20261117123000_create_customer_retention_report_rpc.sql`
- **Halaman UI:** `app/reports/customer-retention/page.tsx`
- **Keamanan:** `STABLE SECURITY DEFINER` dengan guard `businesses.owner_id = auth.uid()` / `business_staff.profile_id = auth.uid()` (plus bypass `service_role`).
- **Frontend Cache:** L1 RAM Cache (TTL 60 detik) + `requestIdRef` untuk mencegah *race condition* saat pergantian filter cepat.

