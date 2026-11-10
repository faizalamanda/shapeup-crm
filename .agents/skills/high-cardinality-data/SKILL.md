---
name: high-cardinality-data
description: "Skill Utama Arsitektur Data Skala Besar (> 1.000 Baris), Bypass Batas PostgREST (db-max-rows = 1000), Chunked Range Fetching, DOM Windowing (0ms Dropdown), Normalisasi Pencarian Simetris (08 <-> 628), dan Protokol Koherensi Cache Reaktif Lintas Modul (L1 RAM + L2 SessionStorage + BroadcastChannel). WAJIB digunakan setiap kali mengambil atau menampilkan data pelanggan, produk, pesanan, atau entitas lain yang dapat melampaui 1.000 baris."
---

# High-Cardinality Dataset (> 1,000 Rows) & Reactive Directory Architecture

Dokumen skill utama ini menetapkan standar arsitektur **Wajib & Tanpa Kompromi** di ShapeUp CRM untuk menangani entitas berpopulasi besar ($N > 1.000$ baris, seperti daftar Pelanggan, Katalog Produk & Variasi, Riwayat Pesanan, dan Stok Gudang) agar **100% bebas pemotongan data (*Zero Silent Truncation*)**, **berkecepatan akses $0\text{ms}$**, dan **tersinkronisasi otomatis di seluruh halaman (*Write Once, Update Propagates Globally*)**.

---

## 1. Teorema Pemotongan PostgREST (`db-max-rows = 1000`) & Larangan `.select()` Polos

### 1.1 Akar Masalah (*Lexicographical Starvation*)
Gateway PostgREST pada Supabase menerapkan batas keras server `db-max-rows = 1000` pada setiap kueri `SELECT` yang tidak menggunakan paginasi server atau chunking.
$$\text{Query Tanpa Chunking: } \sigma_{\text{business\_id}=b}(E) \xrightarrow{\text{ORDER BY name ASC}} \text{TOP } 1000$$
Akibatnya, jika suatu unit bisnis memiliki $N > 1.000$ baris (contoh: **Bisnis Tanem** dengan $> 2.500$ pelanggan atau $> 4.000$ produk):
- Seluruh baris pada urutan $1.001 \dots N$ (misal huruf abjad **M s/d Z**) **hilang secara diam-diam (*silent truncation*)** tanpa pesan error.
- Pengguna melihat data tersebut ada di halaman tabel berpaginasi server (`/customers` atau `/products`), tetapi tidak muncul di dropdown pemilih (`CustomerSelectCombobox`, `ProductSelectCombobox`, atau Kasir POS).

### 1.2 Solusi Wajib: *Deterministic Chunked Range Fetching* (`lib/chunkedQueryHelper.ts`)
Setiap pengambilan populasi penuh di sisi server maupun klien **WAJIB** menggunakan fungsi `fetchAllSupabaseRows()` atau helper spesifik dari `@/lib/chunkedQueryHelper.ts` dan `@/lib/customerHelper.ts`:

```typescript
import { fetchAllSupabaseRows, fetchAllBusinessProducts } from '@/lib/chunkedQueryHelper'
import { fetchAllBusinessCustomers, queryBusinessCustomers } from '@/lib/customerHelper'

// 1. Untuk Katalog Produk (> 1.000 produk + variasi):
const products = await fetchAllBusinessProducts(supabase, businessId)

// 2. Untuk Direktori Pelanggan (> 1.000 pelanggan + cache server 60s):
const { customers, total } = await queryBusinessCustomers(businessId, supabaseAdmin, {
  search,
  limit,
  includeId
})

// 3. Untuk Tabel Kustom Lainnya yang Berpotensi > 1.000 Baris:
const allRows = await fetchAllSupabaseRows((from, to) =>
  supabase
    .from('table_name')
    .select('*')
    .eq('business_id', businessId)
    .order('name', { ascending: true })
    .order('id', { ascending: true }) // Tie-breaker wajib agar urutan deterministik antar-chunk!
    .range(from, to)
)
```

> [!IMPORTANT]
> **Aturan Tie-Breaker (`ORDER BY primary_sort, id ASC`):**
> Saat melakukan *Chunked Range Fetching* dengan `.range(from, to)`, **WAJIB** menyertakan `.order('id', { ascending: true })` sebagai pengurut sekunder (*deterministic tie-breaker*). Tanpa tie-breaker unik, baris dengan nama yang sama pada perbatasan chunk (baris ke-999 dan ke-1.000) dapat melompat atau terduplikasi antar-chunk di PostgreSQL.

---

## 2. Arsitektur 3-Lapis Direktori Reaktif (*Write Once, Update Everywhere*)

Untuk menjamin kecepatan akses **$0\text{ms}$** sekaligus konsistensi instan ketika ada penambahan/perubahan data di halaman manapun, gunakan arsitektur **3-Tier Reactive Store**:

| Lapisan | Modul / Media Penyimpanan | Peran & Karakteristik Kecepatan |
| :--- | :--- | :--- |
| **Server L0 Cache** | `globalThis.__suCustomerDirCache` di `lib/customerHelper.ts` | Menyimpan hasil chunked fetch per `businessId` (TTL 60s + *Single-Flight Deduplication*). Di-update secara *in-place* via `upsertCustomerInServerCache()` saat ada `POST`/`PATCH`. |
| **Client L1 Cache** | `l1Store` (RAM Map per `businessId`) di `lib/customerDirectoryStore.ts` | Memberikan kecepatan **$0\text{ms}$** saat pengguna berpindah halaman (Invoice $\leftrightarrow$ POS $\leftrightarrow$ Order Manual $\leftrightarrow$ Customer) tanpa loading ulang. |
| **Client L2 Cache** | `sessionStorage` (`su_cust_dir_v1_${bid}`) dengan *Quota Guard* | Memberikan kecepatan **$0\text{ms}$** saat refresh browser. Untuk data $> 500$ baris, atribut berat (`metadata`) otomatis dipangkas di L2 agar tidak pernah melanggar kuota 5MB `sessionStorage`. |
| **Cross-Tab Sync** | `BroadcastChannel` + `CustomEvent('shapeup:customer_updated')` | Saat `notifyCustomerDirectoryUpdate()` dipanggil di satu komponen/tab, seluruh komponen dan tab lain yang terbuka otomatis memperbarui state-nya seketika ($0\text{ms}$). |

### Cara Penggunaan Standar di Komponen UI:
```typescript
import { useCustomerDirectory, notifyCustomerDirectoryUpdate } from '@/lib/customerDirectoryStore'

// 1. Membaca daftar pelanggan secara reaktif (otomatis 0ms dari cache & sinkron):
const { customers, loading, searchServer } = useCustomerDirectory({
  businessId: activeBusiness?.id,
  includeCustomerId: selectedCustomerId // Menjamin ID terpilih pada mode Edit selalu ter-hydrate
})

// 2. Menyiarkan perubahan setelah tambah / edit pelanggan di form atau modal manapun:
notifyCustomerDirectoryUpdate(savedCustomer, 'upsert', businessId)
```

---

## 3. Standar Komponen Pemilih Skala Besar (*Combobox & Picker UX*)

Setiap komponen dropdown/combobox yang menerima ribuan item (`CustomerSelectCombobox.tsx`, `ProductSelectCombobox.tsx`, dan picker di `POSWorkspace.tsx`) **WAJIB** menerapkan 4 aturan berikut:

1. **DOM Windowing (`MAX_VISIBLE_ITEMS = 50`):**
   - **DILARANG KERAS** melakukan `.map()` langsung pada seluruh array ribuan item ke dalam DOM JSX, karena me-mount $> 1.000$ node DOM sekaligus akan membekukan *main thread* browser (*Interaction to Next Paint* $> 300\text{ms}$).
   - Selalu potong array yang di-render dengan `.slice(0, 50)` setelah pemfilteran memori, dan tampilkan footer informatif:
     `Menampilkan 50 dari X pelanggan/item — ketik nama / No. HP / SKU untuk memfilter`.

2. **Pencarian Nomor Telepon Simetris (`08` $\leftrightarrow$ `628`):**
   - Database menyimpan nomor telepon dalam bentuk kanonik `628...` (`normalizePhoneCanonical`), namun pengguna di Indonesia sering mengetik `08...` saat mencari.
   - Selalu gunakan `matchesCustomerQuery(customer, query)` dan `buildPhoneSearchVariants(query)` dari `@/lib/customerHelper.ts` sehingga pencarian `081234`, `+62 812-34`, maupun `6281234` semuanya cocok 100%.

3. **Hybrid Server Search Fallback (Debounced 250ms):**
   - Jika pengguna mengetik minimal 2 karakter dan hasil kecocokan lokal di memori $< 5$ baris, jalankan pencarian fallback ke server (`/api/customers?search=...`) secara *debounced* (250ms) dan gabungkan hasilnya ke L1/L2 store.

4. **Null-Safety Mutlak pada Filter String:**
   - Selalu gunakan `(item.name || '').toLowerCase()` dan `(item.phone || '').toLowerCase()`. Dilarang memanggil `item.name.toLowerCase()` secara langsung karena data hasil impor eksternal dapat bernilai `null`.

---

## 4. Koherensi Konteks Multi-Bisnis (`PATCH /api/business` & `invalidateProfileCache`)

Ketika pengguna berpindah unit bisnis melalui dropdown sidebar (`handleSwitchBusiness` di `UserContext.tsx`):
- Klien **WAJIB** memanggil `PATCH /api/business` yang memperbarui `profiles.active_business_id` sekaligus mengeksekusi `invalidateProfileCache(user.id)` di `lib/apiContext.ts`.
- Selain itu, panggilan ke `/api/customers` menyertakan `?business_id=${activeBusiness.id}` yang diverifikasi terhadap kepemilikan/penugasan staf (`resolveTargetBusinessId`), sehingga tidak pernah terjadi *30-second profile cache drift* saat pengguna baru saja beralih ke unit bisnis lain (seperti beralih ke **Bisnis Tanem**).

---

## 5. Protokol Anti-Data-Kosong & Self-Healing Variant Hydration (`fetchAllBusinessProducts`)

Penambahan kolom baru (seperti `price_tiers`, `min_stock_alert`, `external_id`) atau relasi baru (`product_variants`, `product_modifiers`) sering kali memicu error PostgREST schema cache (`PGRST200` / `PGRST204` / `42703`) jika embedded join ditulis kaku tanpa fallback. Untuk menjamin katalog produk di `/products`, `/pos`, `/purchases`, `/orders/invoices`, dan `/stock-opname` **tidak pernah kosong (*zero empty data*)** dan **tidak pernah kehilangan varian**:

1. **Multi-Stage Select Fallback:**
   - Tahap 1: `'*, product_variants(*), product_modifiers(*)'`
   - Tahap 2: `'*, product_variants(*)'`
   - Tahap 3 (Fallback Dasar): Kolom inti `products` **tanpa** embedded join sama sekali (sehingga dijamin 100% berhasil dieksekusi oleh PostgreSQL dalam kondisi apa pun).
2. **Direct Table Hydration (`product_variants`):**
   - Di dalam `fetchAllBusinessProducts()` (`lib/chunkedQueryHelper.ts`), `/products/page.tsx`, dan `/stock-opname/page.tsx`, apabila hasil kueri jatuh ke Tahap 3 sehingga `rows[0]?.product_variants === undefined`, sistem **WAJIB** menjalankan kueri tabel langsung:
     ```typescript
     const { data: directVars } = await supabaseClient
       .from('product_variants')
       .select('*')
       .eq('business_id', businessId)
     ```
     lalu memetakan varian ke masing-masing produk di memori (`O(N)` Map lookup).
3. **Cross-Module POS Catalog Cache Invalidation (`invalidatePosCatalogCache`):**
   - Setiap kali produk ditambah, diedit (`ProductModal.tsx`), dihapus (`/products/page.tsx`), atau diimpor massal (`/products/import/page.tsx`), klien **WAJIB** memanggil `invalidatePosCatalogCache(businessId, true)` dari `@/lib/posCatalogStore.ts` selain membersihkan `su_products_data_${businessId}`.
   - Jika cache lama di `sessionStorage` terdeteksi belum memiliki properti `product_variants` (`cached.products[0]?.product_variants === undefined`), halaman wajib langsung memicu revalidasi latar belakang (*background revalidation*).


