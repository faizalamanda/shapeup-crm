# Cash Flow Dashboard & Cash Real Analytics — ShapeUp CRM

Dokumen ini mendefinisikan standar arsitektur, kontrak database RPC, rumus pergerakan kas, dan komponen UI untuk halaman **Cash Flow Dashboard** (`/reports/cash-flow`) sebagai pasangan analitik visual dari **Laporan Arus Kas Formal** (`/accounting/cash-flow`).

---

## 1. Pemisahan Tanggung Jawab (Formal Statement vs Dashboard)

| Modul | Route | Tujuan |
| :--- | :--- | :--- |
| **Laporan Arus Kas** | `/accounting/cash-flow` | Laporan akuntansi formal *Direct Method* (Operasional, Investasi, Pendanaan) siap cetak. Menggunakan RPC `get_cash_flow_summary`. |
| **Cash Flow Dashboard** | `/reports/cash-flow` | Dashboard visualisasi **Cash Real** (saldo kas & bank berjalan per hari/minggu/bulan), perbandingan periode, posisi per rekening, serta sumber/penggunaan kas terbesar. Menggunakan RPC `get_cash_flow_analytics`. |

---

## 2. Standar Identifikasi Akun Kas & Bank (`Cash Real`)

Konsisten dengan `get_cash_flow_summary`, seluruh akun Kas & Bank diidentifikasi dari `public.accounts`:
- `type = 'ASSET'`
- `sub_type = 'bank_cash'` **atau** (jika `sub_type IS NULL`: `code LIKE '101%'`, `code LIKE '1100%'`, atau nama mengandung `kas`, `bank`, `qris`).

---

## 3. Kontrak Database RPC: `get_cash_flow_analytics`

- **Lokasi Migrasi:** [20261118122000_add_cash_flow_analytics_rpc.sql](file:///home/faiz-jazuli/shapeup-crm/supabase/migrations/20261118122000_add_cash_flow_analytics_rpc.sql)
- **Keamanan:** `STABLE SECURITY DEFINER` dengan *Multi-Tenant Security Guard* (`owner_id` & `business_staff`, bypass untuk `service_role`).
- **Parameter:** `(p_business_id uuid, p_start_date timestamptz, p_end_date timestamptz, p_timezone text, p_granularity text, p_account_id uuid DEFAULT NULL)`.
- **Anti Double-Counting Transfer Internal Kas:**
  - Pergerakan kas dihitung per transaksi: `net_amount = SUM(jl.debit - jl.credit)` pada `v_target_account_ids`.
  - Saat menampilkan **Semua Kas & Bank** (`p_account_id IS NULL`), transfer internal antar akun kas/bank menghasilkan `net_amount = 0` sehingga tidak menggembungkan total *Inflow* maupun *Outflow*.
  - Saat memfilter **1 rekening spesifik** (`p_account_id IS NOT NULL`), transfer masuk ke rekening tersebut tercatat sebagai *Inflow* dan transfer keluar tercatat sebagai *Outflow*.
- **Continuous Time-Series (`generate_series`):**
  - Menggunakan `date_trunc` di zona waktu bisnis (`t.date AT TIME ZONE v_tz`) untuk granularitas `'day'`, `'week'`, atau `'month'`.
  - Setiap bucket pada rentang tanggal dijamin muncul (termasuk hari tanpa transaksi) dengan `running_balance = v_starting_cash + SUM(net_change) OVER (ORDER BY bucket_date ASC)`.

---

## 4. API & Client Caching

- **API Endpoint:** `GET /api/accounting/reports?mode=cash-flow-analytics` & `GET /api/accounting/reports?mode=ap-ar-summary` ([app/api/accounting/reports/route.ts](file:///home/faiz-jazuli/shapeup-crm/app/api/accounting/reports/route.ts))
  - Validasi `account_id` wajib menggunakan `isUuid()` (`AGENTS.md` Rule #9).
  - Menggunakan L0 Server Cache (TTL 15 detik) dan *in-flight promise deduplication*.
  - `mode=ap-ar-summary` memanggil RPC `get_ap_ar_summary` ([20261118134000_add_ap_ar_summary_rpc.sql](file:///home/faiz-jazuli/shapeup-crm/supabase/migrations/20261118134000_add_ap_ar_summary_rpc.sql)) dengan fallback kueri paralel jika migrasi belum diterapkan.
- **Client Helper:** `fetchCashFlowAnalytics()` & `fetchApArSummary()` di [app/accounting/utils.ts](file:///home/faiz-jazuli/shapeup-crm/app/accounting/utils.ts) dengan L1 Client Cache (TTL 15 detik) dan fallback RPC langsung.

---

## 5. Standar Visualisasi UI (`/reports/cash-flow`)

- **Header & Kontrol:** Mengikuti standar `page-layout-ux` (2-row header, `usePageBackNavigation`, filter rekening kas/bank, pemilih granularitas `Harian`/`Mingguan`/`Bulanan`, dan `TemporalDateFilter` dengan `showComparison={true}`).
- **4 KPI Cards:** *Cash Real Akhir*, *Total Kas Masuk*, *Total Kas Keluar* (`reversePolarity = true`), dan *Arus Kas Bersih (Net)*.
- **Baris Kedua (Grid 12 Kolom):**
  - **Kiri (`xl:col-span-8`) — Combo Chart SVG:**
    - Sumbu Y kiri: **Saldo Cash Real** (garis & area biru).
    - Sumbu Y kanan: **Kas Masuk** (batang hijau) & **Kas Keluar** (batang merah), dapat di-toggle.
    - Mendukung garis pembanding putus-putus (*comparison period*) dan tooltip `absolute` (*Zero Layout Shift*).
  - **Kanan (`xl:col-span-4`) — Visibilitas Piutang & Hutang (AP/AR):**
    - **Piutang Usaha:** Semua `orders` aktif belum lunas (`status NOT IN ('cancelled', 'pending')`), menampilkan *Belum Lunas (Outstanding)*, *Jatuh Tempo (Overdue)*, dan *Jatuh Tempo ≤ 7 Hari*.
    - **Hutang Usaha:** Gabungan `purchases` dan `expenses` berstatus `unpaid`/`partial`, menampilkan *Belum Lunas (Outstanding)* (beserta rincian Pembelian vs Biaya), *Jatuh Tempo (Overdue)*, dan *Jatuh Tempo ≤ 7 Hari*.
- **Akses Kontrol:** Terdaftar di menu **Reports → Cash Flow Dashboard** ([app/layout.tsx](file:///home/faiz-jazuli/shapeup-crm/app/layout.tsx)) dan dilindungi oleh izin `view_reports` di [lib/permissions.ts](file:///home/faiz-jazuli/shapeup-crm/lib/permissions.ts).

