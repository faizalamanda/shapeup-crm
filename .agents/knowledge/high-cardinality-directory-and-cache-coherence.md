# Jurnal Arsitektur & Basis Pengetahuan: *High-Cardinality Datasets (> 1,000 Rows), PostgREST Ceiling Bypass, & Multi-Tier Reactive Cache Coherence*

---

## 1. Latar Belakang & Rumusan Masalah (*Problem Statement*)

Pada sistem ERP & CRM multi-tenant modern berbasis Supabase (PostgreSQL + PostgREST) dan Next.js, pertumbuhan transaksi bisnis menyebabkan kardinalitas tabel master (`public.customers`, `public.products`, `public.product_variants`) melampaui ambang batas **1.000 baris** per unit bisnis (studi kasus nyata: **Bisnis Tanem**).

Tanpa rekayasa khusus untuk data berpopulasi besar (*high-cardinality datasets*), muncul empat kegagalan sistemik:

1. **Fenomena *Lexicographical Starvation* (Pemotongan Diam-Diam pada Baris ke-1.000):**
   PostgREST membatasi setiap respons `SELECT` tunggal maksimal `1.000` baris (`db-max-rows = 1000`). Jika endpoint `/api/customers` atau kueri produk memanggil `.select('*').eq('business_id', bid).order('name', { ascending: true })` tanpa `.range()`, maka seluruh pelanggan atau produk dengan urutan abjad di atas indeks ke-1.000 (misalnya berawalan huruf **M hingga Z**) terpotong di tingkat gateway database.
2. **Paradoks Visibilitas Antarmuka (`/customers` vs `/orders/invoices/new`):**
   Halaman tabel manajemen (`/customers`) menggunakan *Server-Side Predicate Pushdown* (`.or('name.ilike.%q%,phone.ilike.%q%').range(0, 24)`), sehingga pelanggan dari huruf A–Z selalu ditemukan saat dicari di `/customers`. Sebaliknya, form pembuatan Invoice dan POS melakukan pemfilteran di memori klien atas daftar yang sudah terpotong 1.000 baris, menciptakan anomali di mana pelanggan yang sah tidak pernah muncul di Invoice maupun POS.
3. **Ketidakcocokan Kanonik Nomor Telepon (`08...` vs `628...`):**
   Normalisasi satu arah saat penyimpanan (`0812...` $\to$ `62812...`) menyebabkan pencarian substring naif `"62812345".includes("0812345")` selalu bernilai `false`.
4. **Latensi Konteks Multi-Tenant (*30-Second Profile Cache Drift*) & *Stale Cache* Lintas Modul:**
   Ketika pengguna berpindah unit bisnis atau mengedit data pelanggan di satu halaman, cache di halaman lain atau cache `profileCache` di `lib/apiContext.ts` masih memegang referensi lama jika tidak ada mekanisme invalidasi dan *pub/sub broadcast*.

---

## 2. Landasan Teori Ilmu Komputer (*Theoretical Foundations*)

### 2.1 *Deterministic Keyset/Range Pagination* atas Batas Gateway
Untuk mengambil himpunan relasi $R$ dengan kardinalitas $|R| = N > M_{\text{max}}$ (di mana $M_{\text{max}} = 1000$), kueri didekomposisi menjadi barisan partisi terurut penuh (*total ordering*) dengan menambahkan kunci unik (`id`) sebagai *tie-breaker*:
$$R = \bigcup_{k=0}^{\lceil N / M_{\text{max}} \rceil - 1} \pi \left( \sigma_{\text{business\_id}=b}(T) \xrightarrow{\text{ORDER BY name ASC, id ASC}} \text{OFFSET } (k \cdot M_{\text{max}}) \text{ LIMIT } M_{\text{max}} \right)$$
Penambahan `id ASC` menjamin sifat **deterministik bebas duplikasi/lompatan** (*zero phantom/skipped rows*) pada batas partisi ketika terdapat dua entitas dengan nilai atribut `name` yang identik.

### 2.2 *Symmetric Token Normalization* pada Pencarian Nomor Telepon
Misalkan fungsi normalisasi penyimpanan adalah $\Phi(x): \Sigma^* \to \text{E.164}_{\text{plain}}$. Agar relasi pencocokan substring bersifat simetris terhadap kebiasaan input lokal Indonesia (`08...`, `8...`, `+628...`, `628...`), fungsi ekspansi kueri $\Psi(q)$ menghasilkan himpunan ekuivalensi morfologis:
$$\Psi(q) = \{ d, \text{"62"} \parallel d_{1..}, \text{"0"} \parallel d_{2..} \}$$
di mana $d = \text{digits}(q)$. Suatu rekaman pelanggan $c$ dinyatakan cocok jika dan hanya jika:
$$\exists v \in \Psi(q) \text{ sedemikian sehingga } v \sqsubseteq \text{digits}(c.\text{phone})$$

### 2.3 *DOM Windowing* & Kompleksitas Render $O(1)$
Waktu *commit* dan *layout* pada mesin perender browser (Blink/WebKit) berbanding lurus dengan jumlah node DOM yang dipasang: $T_{\text{render}} = O(|V_{\text{DOM}}|)$. Dengan memisahkan himpunan hasil filter di memori ($|F| \le N$, waktu komputasi JS $< 1\text{ms}$ untuk $N = 10.000$) dari himpunan node yang di-render ke layar ($|V_{\text{DOM}}| = \min(|F|, 50)$), kompleksitas pemasangan DOM saat membuka dropdown direduksi dari $O(N)$ menjadi konstanta **$O(1)$ ($< 2\text{ms}$)**.

### 2.4 *MESI-Inspired Multi-Tier Cache Coherence*
Mengadopsi konsep koherensi cache prosesor (Invalidation & Write-Update Broadcast):
- Setiap operasi tulis (`POST`, `PATCH`, `DELETE`, `Bulk Import`) bertindak sebagai *Write-Update / Write-Invalidate* yang langsung memperbarui:
  1. **L0 Server Memory Cache** (`lib/customerHelper.ts`)
  2. **L1 Client Memory Store** (`lib/customerDirectoryStore.ts`)
  3. **L2 SessionStorage Cache** (`su_cust_dir_v1_${bid}`) dan menghapus cache analitik (`su_customers_v2_${bid}`)
  4. **L3 Cross-Tab Bus** (`BroadcastChannel('shapeup_customer_sync_v1')` & `window.dispatchEvent`)

---

## 3. Peta Implementasi di ShapeUp CRM

1. **`lib/chunkedQueryHelper.ts`:**
   - `fetchAllSupabaseRows()`: Eksekutor generik `.range(from, to)` untuk tabel apapun yang berpotensi $> 1.000$ baris.
   - `fetchAllBusinessProducts()`: Pengambil seluruh produk + varian bisnis secara utuh (dipakai di Buat Invoice, Edit Invoice, dan Kasir POS).
2. **`lib/customerHelper.ts`:**
   - `fetchAllBusinessCustomers()` & `queryBusinessCustomers()`: Memuat seluruh pelanggan bisnis tanpa batas 1.000 baris, dilengkapi *L0 Server Cache* (TTL 60s), *Single-Flight Deduplication*, dan *Selected-ID Hydration* (`includeId`).
   - `normalizePhoneCanonical()`, `buildPhoneSearchVariants()`, `matchesCustomerQuery()`: Mesin pencocokan telepon simetris `08` $\leftrightarrow$ `628`.
   - `resolveOrCreateCustomer()`: Fungsi tunggal pembuatan/resolusi pelanggan lintas endpoint (`/api/customers`, `/api/pos/customer`, `/api/orders/invoices`, `/api/orders/manual`).
3. **`lib/customerDirectoryStore.ts`:**
   - `useCustomerDirectory()`: Hook React reaktif dengan L1 RAM + L2 `sessionStorage` SWR + *Server Search Fallback*.
   - `notifyCustomerDirectoryUpdate()`: Pemancar perubahan instan lintas komponen & tab browser.
4. **`components/CustomerSelectCombobox.tsx` & `components/ProductSelectCombobox.tsx`:**
   - Keduanya dilengkapi *DOM Windowing* (`MAX_VISIBLE_ITEMS = 50`), *null-safe filtering*, dan *hybrid search*.
5. **`app/api/business/route.ts` (`PATCH`) & `components/UserContext.tsx` (`handleSwitchBusiness`):**
   - Menjamin saat pengguna berpindah bisnis di sidebar, `invalidateProfileCache(user.id)` langsung dieksekusi di server sehingga tidak ada *stale business context*.

