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
