---
name: "page-layout-ux"
description: "Create or update ShapeUp CRM feature pages with the shared PageLayout, responsive content widths, and Back navigation that yields to active modals."
---

# Page Layout UX — ShapeUp CRM

Gunakan `PageLayout` dari `@/components/ui/PageLayout` sebagai shell halaman fitur baru. Berikan `title`; gunakan `description`, `actions`, dan `footer` hanya ketika membantu alur utama. Pilih `width` berdasarkan kepadatan konten: `md` untuk form, `xl` untuk halaman data, dan `full` hanya untuk workspace/tabel yang membutuhkan lebar penuh.

Jangan membuat listener `popstate`, `history.pushState`, atau logika Back sendiri pada halaman. Sistem menggunakan `useMobileBackToHome` dan `isTouchOrStandaloneApp` berbasis kapabilitas sentuhan W3C (`pointer: coarse`, `ontouchstart`, `maxTouchPoints`):
- **Perangkat Sentuh (Mobile & Tablet) serta PWA Standalone:** Saat tidak ada modal aktif, tombol Back perangkat/browser maupun tombol UI `PageLayout` selalu keluar ke Halaman Utama (`/onboarding`) untuk menjamin pengalaman konsisten layaknya aplikasi native tanpa membuat pengguna tersesat.
- **Desktop PC (Mouse):** Mengikuti riwayat browser linear standar (`router.back()`).

Modal standar selalu memiliki prioritas Back tertinggi di semua perangkat. Saat sebuah modal aktif, Back wajib menutup modal teratas satu per satu (LIFO) sebelum halaman berpindah. Gunakan `FullScreenModal` untuk alur modal mobile/PWA dan jangan menambahkan penanganan Back kedua di halaman. Seluruh modal dialog kustom wajib memanggil `useModalBackHandler(isOpen, onClose)`.

Untuk API, contoh, dan rekomendasi UX terkait loading, empty state, error recovery, serta preservation state, baca [knowledge page layout UX](../../knowledge/page-layout-ux.md).

## Standar UX Formulir & Entri Data (Data Entry UX)

1. **Modal Konfirmasi Sukses (Success Modal):**
   - Saat pengguna berhasil men-submit data baru (misal: Transaksi Baru, Pengeluaran), **jangan langsung melakukan `router.push()`** ke halaman daftar. Redirect instan sering memicu *Change Blindness*.
   - Tahan state di halaman form, dan tampilkan *Success Modal* berukuran kecil dengan 2 opsi CTA (Call to Action):
     - **Primary:** "Buat Data Lagi" (Mereset state form sehingga siap untuk entri berkelanjutan).
     - **Secondary:** "Selesai & Kembali" (Menjalankan router push kembali ke tabel/daftar).
   - Pola ini mendukung *Continuous Data Entry* (Flow State) untuk pengguna yang memasukkan tumpukan dokumen sekaligus.

2. **Fitur Duplikat (Duplicate Action):**
   - Untuk meminimalisir *Cognitive Load* dan *Fat-finger errors*, tambahkan aksi "Duplikat" pada tabel data atau modal detail.
   - Gunakan pendekatan asinkron berkecepatan tinggi: Simpan payload data di `localStorage` (contoh: `localStorage.setItem('duplicateData', JSON.stringify(...))`), lalu rute ke halaman `new`.
   - Di halaman form `new`, gunakan `useEffect` untuk membaca `localStorage`, memasukkan data duplikat ke *state*, dan menghapus kuncinya. Kosongkan *field* spesifik seperti Tanggal dan Lampiran agar valid secara audit.

3. **Optimistic Cache pada List View (Write Speed Optimization):**
   - Setelah API merespons sukses saat penambahan data, langsung prepends/tambahkan respons data (`createdData`) ke dalam *client-side cache* (`localStorage` tabel terkait) sebelum memunculkan modal sukses. 
   - Ini memastikan saat pengguna kembali ke tabel, data baru sudah ada seketika (0ms) tanpa menunggu *background refresh*.

---

## Standar Layout, Padding, Margin & Anti-Overflow pada Halaman Laporan / Analitik (`Reports` & `Dashboard`)

Karena `<main>` di `app/layout.tsx` telah membungkus seluruh halaman dengan `padding: '28px 28px 48px'` dan `<div style={{ maxWidth: '1600px', margin: '0 auto' }}>`, setiap halaman fitur/laporan **WAJIB** mematuhi aturan geometri dan *spacing* berikut agar tidak pernah mengalami *double-padding*, *horizontal clipping* (terpotong di sisi kanan layar), atau elemen kartu yang berdesakan:

1. **Larangan Double Outer Padding & Background Wrapper:**
   - Root container halaman laporan (seperti `/reports/revenue`, `/reports/product-performance`, dll.) **DILARANG KERAS** menambahkan `min-h-screen bg-[#F8FAFC] p-4 sm:p-6 lg:p-7` lagi di elemen terluar.
   - Gunakan wrapper bersih yang menyatu langsung dengan `<main>`:
     ```tsx
     <div className="w-full max-w-full min-w-0 space-y-5 text-slate-800 su-fade-in">
     ```

2. **Pencegahan Horizontal Overflow / Terpotong di Sisi Kanan (`min-w-0` & `flex-wrap` Invariant):**
   - Karena `body` memiliki `overflow-x: hidden`, baris Flexbox atau CSS Grid yang memiliki `min-content` lebih lebar dari layar laptop (`1280px–1440px` dikurangi sidebar `240px`) akan memaksa halaman melebar dan **memotong sisi kanan kartu/filter**.
   - **Aturan Wajib:**
     - Setiap baris header/toolbar/banner yang menyandingkan judul di kiri dan filter di kanan (termasuk `TemporalDateFilter` atau deretan filter tab) **WAJIB** menggunakan `flex flex-wrap items-center justify-between gap-3` (jangan gunakan `lg:flex-row` tanpa `flex-wrap` jika isi kiri + kanan lebar).
     - Setiap kontainer Grid (`grid-cols-1 lg:grid-cols-12 gap-5`) dan setiap kolom anaknya (`lg:col-span-8 min-w-0`, `lg:col-span-4 min-w-0`) **WAJIB** menyertakan kelas `min-w-0` agar elemen anak (seperti tabel `overflow-x-auto` atau nama produk panjang `truncate`) tidak memaksa kolom grid melebar melampaui proporsi 8:4.

3. **Standar Baku Padding & Margin Internal Kartu (Metorik / Lifetimely Spacing Tokens):**
   - **Jarak Antar-Seksi Halaman:** `space-y-5` (`20px`)
   - **Jarak Antar-Kartu Grid:** `gap-5` (`20px`) untuk grid utama, `gap-4` (`16px`) untuk sub-grid di dalam kartu.
   - **Card Container:** `bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden min-w-0`
   - **Card Header:** `px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3`
   - **Card Body Utama:** `p-5` (`20px`)
   - **Sub-Card / Quadrant Card Header:** `px-4 py-3 border-b`
   - **Baris Item di Dalam Sub-Card / List:** `px-4 py-3 flex items-center justify-between gap-3` (dengan `min-w-0 flex-1` pada sisi teks dan `shrink-0 text-right` pada sisi nominal).
   - **Baris Tabel Data (`th` & `td`):** `py-3.5 px-4` (atau `px-5` untuk kolom pertama dan terakhir) dengan jarak vertikal sub-teks `mt-1` (`4px`).
   - **Larangan Kelas Arbitrer Non-Standar:** Gunakan hanya skala spacing Tailwind yang valid (`py-0.5`, `py-1`, `px-2`, `px-3`, `px-4`, `p-4`, `p-5`). Dilarang menulis kelas tidak valid seperti `py-0.2` atau `py-0.1` karena akan diabaikan oleh compiler CSS (menghasilkan padding `0px`).

4. **Header Laporan 2-Baris & Invarian Kestabilan Grafik (*Zero Layout Shift*):**
   - **Posisi Filter Tanggal:** Baris teratas (`flex flex-col lg:flex-row lg:items-center justify-between gap-4`) memuat tombol kembali + judul + filter inline di kiri, dan `TemporalDateFilter` sejajar di kanan atas. Subjudul deskripsi dan tautan aksi (mis. *Lihat daftar pelanggan ›*) ditempatkan di baris kedua (`border-b border-slate-200/80 pb-3`).
   - **Tooltip Hover Grafik (`absolute`):** Dilarang merender tooltip hover secara *inline* di dalam baris legenda karena mengubah tinggi baris dan membuat grafik naik-turun saat disorot. Gunakan tooltip mengambang `absolute top-4 right-5 pointer-events-none` dengan tinggi legenda tetap (`min-h-[24px]`).
   - **Tinggi Area Plot Grafik:** Pada grid `items-stretch` (`lg:col-span-8` vs `lg:col-span-4`), area plot grafik **wajib** menggunakan `flex-1 min-h-[260px]` (bukan tinggi kaku seperti `h-[220px]`) serta skala sumbu Y 4-interval yang rapi (*nice-step*) agar grafik mengisi penuh tinggi kartu sejajar dengan panel KPI kanan.

