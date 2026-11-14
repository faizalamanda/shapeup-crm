---
name: "temporal-analytics-filter"
description: "Standar modul pemilihan tanggal dan perbandingan analitik waktu (Lifetimely-grade) di ShapeUp CRM: kalender dua bulan, perbandingan periode sebelumnya/YoY/kustom, zona waktu global dinamis, dan comparative statements."
---

# Temporal Analytics & Date Range Comparison — ShapeUp CRM

Panduan arsitektur dan standar implementasi modul pemilihan tanggal serta perbandingan analitik temporal di seluruh ekosistem ShapeUp CRM (Dashboard, Akuntansi, POS, Inventori, dan CRM).

---

## 1. Filosofi & Standar Arsitektur (Lifetimely-Grade)

ShapeUp CRM mengadopsi standar **Lifetimely + GA4** untuk seluruh antarmuka temporal:

1. **Explicit Comparison Feedback (Bebas Split-Attention):**
   * Tanggal pembanding **WAJIB** ditampilkan secara nyata dalam bentuk teks/badge (`[📅 01/01/2025 – 31/01/2025]`) di samping pemilih mode, sehingga pengguna tidak perlu menghitung tanggal mundur di kepala.
2. **Dual-Month Calendar & 1-Click Presets:**
   * Di desktop, pemilih kalender menampilkan 2 bulan berdampingan dan bilah jalan pintas (*Hari Ini, Kemarin, 7 Hari, 30 Hari, Bulan Ini, Bulan Lalu, Kuartal Ini/Lalu, Tahun Ini/Lalu*).
3. **Adaptive Mobile UX (`mobile-modal-ux` Standard):**
   * Pada layar $< 640\text{px}$, filter berubah menjadi bilah ringkas ramah sentuh. Ketika ditekan, membuka **`FullScreenModal`** dengan navigasi Tab (*Periode Utama* dan *Perbandingan*) yang otomatis terdaftar ke `useModalBackHandler` (LIFO back navigation).

---

## 2. Reusable Component: `TemporalDateFilter`

Selalu gunakan komponen terpadu dari `@/components/ui/TemporalDateFilter`:

```tsx
import { TemporalDateFilter, TemporalFilterValue } from '@/components/ui/TemporalDateFilter'
import { getLocalDateRangeLimits, resolveComparisonRange } from '@/lib/localzone'

// Inisialisasi State Baku:
const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
  const limits = getLocalDateRangeLimits('this-month', activeBizTimezone)
  const comp = resolveComparisonRange('previous_period', limits.start, limits.end)
  return {
    startDate: limits.start,
    endDate: limits.end,
    preset: 'this-month',
    comparisonMode: 'previous_period',
    comparisonStartDate: comp.start,
    comparisonEndDate: comp.end,
    comparisonLabel: comp.label,
  }
})

// Penggunaan di JSX:
<TemporalDateFilter
  value={temporalFilter}
  onChange={setTemporalFilter}
  timezone={activeBusiness?.timezone}
  showComparison={true}      // true untuk Dashboard & P&L; false untuk Arus Kas / form sederhana
  allowAllTime={true}        // true jika mendukung query tanpa batas waktu
/>
```

---

## 3. Aturan Zona Waktu Global & Calendar Math (`lib/localzone.ts`)

1. **Dynamic Business Timezone (Dilarang Hardcoded Jakarta):**
   * Unit bisnis dapat berada di **WIB (`Asia/Jakarta`)**, **WITA (`Asia/Makassar`)**, **WIT (`Asia/Jayapura`)**, maupun luar negeri (**Singapura, Tokyo, London, New York**).
   * Selalu ambil `activeBusiness?.timezone` dan bersihkan via `getBusinessTimezone(tz)`.
   * **DILARANG KERAS** mengasumsikan offset angka mentah seperti `+07:00` atau mengandalkan jam lokal perangkat staf (`new Date().getDate()`).
2. **Calendar-Space Manipulation (Kebal DST & Leap Year):**
   * Pergeseran hari menggunakan `shiftLocalCalendarDate(dateStr, deltaDays)` yang beroperasi murni pada *UTC-calendar components* `(YYYY, MM, DD)`. Dilarang menambah/mengurangi `86.400.000 ms` secara mentah karena rentan bergeser pada hari transisi *Daylight Saving Time (DST)* di negara barat.
   * Pergeseran tahun pembanding (*Year-over-Year / YoY*) menggunakan `getPreviousYearDateRangeLimits()` yang otomatis menormalisasi tanggal 29 Februari menjadi 28 Februari pada tahun non-kabisat via `isLeapYear()`.
3. **Konversi Batas Waktu Database (ISO UTC):**
   * Gunakan `getPeriodComparisonBounds()` atau `localDateToUtcBounds()` untuk menghasilkan `startOfDayISO` (00:00:00.000) dan `endOfDayISO` (23:59:59.999) dalam UTC untuk kueri Supabase/PostgreSQL.

---

## 4. Standar Laporan Keuangan Komparatif & Optimasi RPC Buku Besar (Comparative P&L, Arus Kas & Neraca)

Ketika mengimplementasikan perbandingan atau pelaporan pada modul akuntansi (`app/accounting/profit-loss/page.tsx`, `app/accounting/cash-flow/page.tsx`, `app/accounting/balance-sheet/page.tsx`, `app/accounting/coa/page.tsx`):

1. **Parallel Round-Trip Query & Single-Flight Caching (`app/accounting/utils.ts` & `/api/accounting/reports`):**
   * Gunakan selalu `fetchLedgerBalances()` dan `fetchCashFlowSummary()` dari `app/accounting/utils.ts` yang memanggil endpoint server `/api/accounting/reports` (`supabaseAdmin` + `getApiContext({ req })`).
   * Jalur ini melewati evaluasi RLS berulang per-baris pada jutaan baris `journal_lines`, melakukan *Single-Flight Promise Deduplication*, dan menyimpan cache L0 Server / L1 Client (`accounts` TTL 30s, hasil laporan TTL 15s).
   * Jika `comparisonMode !== 'none'`, muat data saldo berjalan dan saldo pembanding secara paralel menggunakan `Promise.all` yang dilindungi oleh `requestIdRef` untuk mencegah *race condition* saat filter berubah cepat:
   ```typescript
   const [currData, prevData] = await Promise.all([
     fetchLedgerBalances(supabase, businessId, endD, startD, timezone, basis),
     fetchLedgerBalances(supabase, businessId, compEnd, compStart, timezone, basis),
   ])
   ```
2. **Standar Database RPC (`get_cash_flow_summary` & `get_ledger_balances`):**
   * Wajib berstatus `STABLE SECURITY DEFINER` dengan **Multi-Tenant Security Guard** (`businesses.owner_id = auth.uid() UNION business_staff.profile_id = auth.uid()`, dengan bypass untuk `service_role`).
   * `get_cash_flow_summary` menggunakan **Single-Pass CTE Materialization** (`period_cash_txs` & `counter_lines`) serta **Single-Pass `FILTER (WHERE t.date < p_start_date)`** untuk menghitung saldo kas awal dan akhir dalam 1 kali scan tabel, sekaligus mengecualikan pembayaran gaji yang di-void (`sp.status = 'active'` & `sp.reversal_transaction_id`).
   * `get_ledger_balances` (`p_basis = 'cash'`) wajib mendorong filter tanggal (`p_start_date` & `p_end_date`) langsung ke dalam setiap cabang `UNION ALL` (*Date Predicate Pushdown*) agar memanfaatkan indeks `idx_transactions_biz_date`.
3. **Multi-Column Presentation:**
   * Jika perbandingan aktif, tampilkan 4 kolom: `Kategori Akun`, `Periode Berjalan`, `Pembanding`, dan `Δ% (Varians)`.
   * Jika perbandingan dinonaktifkan (`compMode === 'none'`), kembalikan tabel ke format 2 kolom sederhana (`Kategori Akun` dan `Jumlah`).
4. **Polaritas Cerdas Indikator Pertumbuhan:**
   * **Pendapatan & Laba Bersih:** Kenaikan bernilai positif $\rightarrow$ **Hijau (🟢)**.
   * **Beban Operasional & HPP:** Kenaikan bernilai penambahan biaya $\rightarrow$ **Merah (🔴)** (`reversePolarity = true`).
5. **Print Safety (`no-print`):**
   * Seluruh bilah filter wajib dibungkus kelas CSS `no-print`.
   * Sediakan header cetak khusus (`print:block`) yang mencantumkan rentang tanggal berjalan dan tanggal pembanding secara formal.

