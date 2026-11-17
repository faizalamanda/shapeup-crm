# Shared Page Layout and Back Navigation

Gunakan `PageLayout` dari `@/components/ui/PageLayout` untuk halaman fitur baru. Shell ini menyediakan header konsisten, judul, deskripsi, aksi, tombol Back, lebar konten, dan footer opsional.

```tsx
<PageLayout
  title="Pembelian"
  description="Kelola tagihan dan pembayaran pemasok"
  width="xl"
  actions={<Button>Tambah pembelian</Button>}
>
  <PurchaseTable />
</PageLayout>
```

Lebar yang tersedia: `sm`, `md`, `lg`, `xl` (default), dan `full`. Pilih berdasarkan kepadatan konten; tabel atau workspace besar biasanya `xl`/`full`, sedangkan form tunggal biasanya `md`.

Back perangkat/browser di desktop (mouse) tetap mengikuti linear URL history (`router.back()`). Pada perangkat sentuh (Mobile, iPad, Tablet Android) serta PWA standalone yang terdeteksi via W3C interaction queries (`isTouchOrStandaloneApp`), Back membawa pengguna kembali ke Halaman Utama (`/onboarding`). Jika modal aktif (baik 1 atau bertumpuk), registry modal (`useModalBackHandler`) selalu menangani Back lebih dulu dan menutup modal teratas satu per satu (LIFO); halaman tidak boleh mendaftarkan listener `popstate` sendiri. Tombol Back di header (`PageLayout`) mengikuti aturan yang sama. Ubah fallback dengan `mobileBackFallback` hanya bila onboarding tidak sesuai dengan alur fitur.

Saat halaman membuka modal dialog apapun, gunakan `FullScreenModal` atau daftarkan `useModalBackHandler(isOpen, onClose)`; jangan menambahkan kondisi modal ke halaman. Registry modal dan `useMobileBackToHome` sudah mengoordinasikan urutan Back untuk menghasilkan perilaku aplikasi native yang tangguh di semua ukuran perangkat.

## Rekomendasi world-class

- Gunakan satu tujuan utama per halaman dan tampilkan aksi primer di header; untuk form panjang, letakkan aksi simpan juga pada footer yang mudah dijangkau.
- Tampilkan loading skeleton, empty state yang menjelaskan aksi berikutnya, dan error state yang dapat dipulihkan—bukan area kosong atau hanya `console.error`.
- Pertahankan konteks saat kembali: filter, pencarian, tab, dan posisi scroll sebaiknya tersimpan pada URL atau state yang tahan navigasi.
- Hindari lebar konten yang terlalu besar untuk form. Gunakan `md`/`lg`; `full` hanya untuk data yang memang membutuhkan ruang horizontal.
- Pastikan target sentuh minimal 44px, fokus keyboard terlihat, dan status proses/sukses dapat dibaca screen reader.

## Standar Geometri, Padding, Margin & Anti-Overflow Halaman Analitik (`Reports`)

1. **Integrasi dengan `<main>` di `app/layout.tsx` (Zero Double-Padding):**
   - Elemen `<main>` pada `app/layout.tsx` sudah memberikan `padding: '28px 28px 48px'`, latar belakang `var(--su-bg)`, dan pembatas `<div style={{ maxWidth: '1600px', margin: '0 auto' }}>`.
   - Halaman di bawah `/reports/*` atau `/dashboard` harus langsung merender `<div className="w-full max-w-full min-w-0 space-y-5 text-slate-800 su-fade-in">` tanpa membungkus ulang dengan `min-h-screen bg-... p-6`.

2. **Kewajiban `min-w-0` dan `flex-wrap` untuk Mencegah Sisi Kanan Terpotong:**
   - Pada CSS Grid (`grid-cols-12`) dan Flexbox, elemen anak secara default memiliki `min-width: auto` (`min-content`). Jika sebuah baris header (`Judul + Filter Segmen + TemporalDateFilter`) atau toolbar tabel (`Judul + 6 Filter Pills + Search + Export`) menggunakan `lg:flex-row` tanpa `flex-wrap`, lebar minimum baris tersebut dapat menembus `> 1.300px`.
   - Pada layar laptop standar (`1280px–1440px` dikurangi sidebar `240px`), hal ini membuat seluruh kontainer halaman melebar keluar batas layar kanan dan terpotong oleh `body { overflow-x: hidden }`.
   - **Solusi Permanen:**
     - Selalu gunakan `flex flex-wrap items-center justify-between gap-3` pada setiap baris header, banner informasi, dan toolbar tabel.
     - Selalu tambahkan `min-w-0` pada setiap kolom grid (`lg:col-span-8 min-w-0`, `lg:col-span-4 min-w-0`) dan sub-kartu di dalamnya.
     - Untuk toolbar tabel yang memiliki banyak tab filter (seperti filter kuadran BCG), pisahkan baris **Judul + Kontrol Search/Export** di baris atas dan **Filter Tab Pills** di baris bawah (`space-y-3`) agar tidak pernah bertabrakan secara horizontal.

3. **Token Spacing Internal Kartu & Tabel:**
   - **Card Header:** `px-5 py-4`
   - **Card Body:** `p-5`
   - **Sub-Card (misal Papan 4 Kuadran):** Header `px-4 py-3`, setiap baris item `px-4 py-3` dengan badge nomor urut bulat (`w-5 h-5 rounded-full`) berjarak `gap-2.5` dari nama produk, serta jarak `mt-1` antara nama produk dan sub-info kuantitas/margin.
   - **KPI Grid Summary (`lg:col-span-4`):** Setiap sel kuadran/metrik menggunakan `p-4 sm:p-5` dengan jarak antar-baris teks `space-y-1.5` agar angka utama, badge SKU, dan sub-teks memiliki ruang napas visual yang lega.

4. **Posisi Header `TemporalDateFilter` & Kestabilan Grafik Analitik:**
   - **Header 2-Baris Konsisten:** Gunakan struktur yang seragam di seluruh `/reports/*` (`/reports/revenue`, `/reports/product-performance`, `/reports/customers`): baris 1 (`flex-col lg:flex-row lg:items-center justify-between gap-4`) untuk judul + kontrol segmen di kiri dan `TemporalDateFilter` di kanan; baris 2 untuk subjudul deskripsi + tautan aksi kanan.
   - **Pencegahan Grafik Bergerak Saat Hover (*Zero Layout Shift*):** Tooltip hover tidak boleh disisipkan di aliran flex/legenda normal karena menyebabkan tinggi kontainer berubah saat kursor masuk/keluar. Selalu gunakan `absolute` floating tooltip dengan `pointer-events-none`.
   - **Proporsi Tinggi Plot Area & Skala Y-Axis Rapat:** Jangan mengunci area plot dengan tinggi tetap kecil (mis. `h-[220px]`) di dalam kartu `flex-1` karena meninggalkan ruang kosong besar di bawah sumbu X ketika kartu KPI kanan lebih tinggi. Gunakan `flex-1 min-h-[260px]` dengan skala sumbu Y 4-interval menggunakan tangga pembulatan rapat `[1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]` (`headroom 1.08×`) agar puncak data selalu berada di kisaran 80–90% tinggi plot tanpa ruang kosong berlebih di atas.

