---
name: "mobile-modal-ux"
description: "Create or update full-screen mobile/PWA modal flows using the shared ShapeUp CRM shell and its Back-button behavior. Use for feature dialogs that require a dedicated mobile screen."
---

# Mobile Modal UX — ShapeUp CRM

Panduan standar pembuatan dan pembaruan modal fitur pada ShapeUp CRM untuk menjamin pengalaman optimal di mobile/PWA dan desktop.

## 1. Outer Shell Terpusat (`FullScreenModal`)

Semua modal fitur yang berfungsi sebagai layar kerja/detail (misal: Detail Pesanan, Tagihan Pembelian, Detail Shift, Form Entri Data) **WAJIB** menggunakan `FullScreenModal` dari `@/components/ui/FullScreenModal` sebagai outer shell.

- **Mobile / PWA:** Otomatis 100% full-screen (`h-[100dvh] w-screen`) dengan safe-area insets (`env(safe-area-inset-top)` & `env(safe-area-inset-bottom)`).
- **Desktop:** Tampil sebagai card terpusat dengan proporsi `desktopSize`:
  - `sm` (`max-w-md`): Konfirmasi singkat atau formulir mini.
  - `md` (`max-w-2xl`, default): Formulir entri standar (tambah pelanggan, petty cash).
  - `lg` (`max-w-4xl`): Detail pesanan POS, ringkasan transaksi, laporan kasir.
  - `xl` (`max-w-6xl`): Detail pesanan omnichannel, tagihan pembelian (multi-kolom & multi-tab).
  - `fullscreen`: Workspace penuh desktop (misal: kanban, canvas perancang).

## 2. Enam Aturan Emas Mobile Modal UX

1. **Zero Manual Portals & Scroll Locks:**
   `FullScreenModal` sudah menangani portal ke `document.body`, `aria-modal`, fokus awal, Escape key desktop, serta body-scroll lock terpusat via *reference counting*. **DILARANG KERAS** memanggil `createPortal` atau memanipulasi `document.body.style.overflow` manual di pemakai.

2. **LIFO Hardware Back Navigation Integration:**
   Tombol Back perangkat / browser ditangani otomatis melalui `useModalBackHandler` dalam `FullScreenModal`. Menekan Back pada mobile selalu menutup modal aktif teratas lebih dahulu sebelum navigasi halaman berjalan. **DILARANG** menambahkan listener `popstate`, `history.pushState`, atau memanggil `window.history.back()` secara manual.

3. **Thumb-Zone Sticky Footer (Aksi Utama):**
   Tombol aksi utama (seperti *Chat WhatsApp*, *Bayar Tagihan*, *Refund*, *Cetak Struk*, dan *Tutup*) **WAJIB** ditempatkan pada prop `footer`. Ini menjamin tombol aksi selalu lengket (*sticky*) di bawah layar mobile tepat di atas home bar, tanpa terkubur oleh scroll konten.

4. **Single Scroll Viewport (Anti-Pattern Nested Scroll):**
   Kontainer `children` dalam `FullScreenModal` sudah memiliki `overflow-y-auto overscroll-contain`. **DILARANG** menumpuk kontainer `overflow-y-auto` dengan ketinggian kaku (`h-[...]`, `max-h-[...]`) di dalam `children` pada tampilan mobile karena memicu *Scroll-Chaining* (jebakan scroll bertingkat).

5. **Responsive Layout Stacking & Prioritas Informasi:**
   Pada modal kompleks 2-kolom (seperti Detail Order/Pembelian):
   - **Desktop (`lg:`):** Tampilkan 2 kolom berdampingan (kiri: Tab Konten/Item, kanan: Sidebar Ringkasan Finansial & Logistik).
   - **Mobile:** Tumpuk secara vertikal. Gunakan utilitas urutan CSS (`order-1 lg:order-2` untuk ringkasan/status dan `order-2 lg:order-1` untuk tabs) agar pengguna mobile langsung melihat angka krusial (Grand Total, Status Bayar, Kurir/Alamat) di bagian atas tanpa harus menggulir puluhan baris item produk.

6. **Touch-Friendly Tab Pills & Responsive Tables:**
   - Tab navigasi internal wajib berbentuk pil yang ramah sentuhan jempol (*touch target* min. 40px) dan dibungkus `overflow-x-auto no-scrollbar`.
   - Tabel dalam tab (seperti Riwayat Pembayaran dan Jurnal Akuntansi) wajib dibungkus `<div className="overflow-x-auto">` dengan batas lebar minimum (`min-w-[...]`) agar tidak terpotong pada layar ponsel 360px.

7. **Action Column UX & Hybrid Table-Card Responsiveness:**
   Pada modal yang menampilkan daftar/tabel data transaksi (seperti Riwayat Transaksi POS, Daftar Nota, atau Pelunasan):
   - **Desktop (`hidden md:table`):** Gunakan tombol aksi bersegmentasi dengan hierarki visual yang jelas (Action Capsule), bukan tombol teks panjang yang monoton. Berikan pembeda warna tajam antara tagihan berpiutang (gradient amber dengan nominal sisa) dan layanan purna jual (dark/slate untuk tukar barang, soft rose untuk refund).
   - **Mobile (`block md:hidden`):** DILARANG memaksa tabel horizontal 8 kolom yang membuat kasir harus menggeser layar 500px ke kanan hanya untuk mencari tombol bayar. Tampilkan sebagai **Kartu Transaksi Interaktif (Mobile Cards)** dengan tombol aksi berukuran penuh ($\ge 42\text{px}$) di strip bawah kartu yang ramah jempol (*anti fat-finger*).

---

Untuk contoh implementasi lengkap, batasan, dan studi kasus, baca [knowledge mobile modal UX](../../knowledge/mobile-modal-ux.md).
