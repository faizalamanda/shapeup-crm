---
name: "page-layout-ux"
description: "Create or update ShapeUp CRM feature pages with the shared PageLayout, responsive content widths, and Back navigation that yields to active modals."
---

# Page Layout UX — ShapeUp CRM

Gunakan `PageLayout` dari `@/components/ui/PageLayout` sebagai shell halaman fitur baru. Berikan `title`; gunakan `description`, `actions`, dan `footer` hanya ketika membantu alur utama. Pilih `width` berdasarkan kepadatan konten: `md` untuk form, `xl` untuk halaman data, dan `full` hanya untuk workspace/tabel yang membutuhkan lebar penuh.

Jangan membuat listener `popstate`, `history.pushState`, atau logika Back sendiri pada halaman. `useMobileBackToHome` menangani Back perangkat/browser sekali pada application layout: desktop mengikuti history normal, sedangkan mobile/PWA kembali ke `/onboarding`. Tombol Back `PageLayout` menggunakan aturan yang sama.

Modal standar selalu memiliki prioritas Back. Saat sebuah modal aktif, Back wajib menutup modal teratas sebelum halaman berpindah. Gunakan `FullScreenModal` untuk alur modal mobile/PWA dan jangan menambahkan penanganan Back kedua di halaman.

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
