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

2. **LIFO Hardware Back Navigation Integration (Universal Mobile, Tablet & Desktop):**
   Tombol Back perangkat / browser ditangani otomatis melalui `useModalBackHandler` dalam `FullScreenModal` (dan modal kustom manapun). Ketika tombol Back ditekan pada perangkat apa pun (Mobile, Tablet, maupun Desktop), sistem selalu menutup modal aktif teratas terlebih dahulu (**satu per satu secara berjenjang / LIFO**) sebelum navigasi halaman berjalan. Jika terdapat dua modal bertumpuk (Modal A -> Modal B), Back pertama menutup Modal B, Back kedua menutup Modal A. **DILARANG** menambahkan listener `popstate`, `history.pushState`, atau memanggil `window.history.back()` secara manual. Modal mandiri (seperti pemilih varian, hold cart, struk preview) **WAJIB** mendaftarkan diri ke `useModalBackHandler(isOpen, onClose)`.

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

8. **Landscape Auto-Rotate & Vertical Compression Graceful Adaptability:**
   Ketika smartphone dimiringkan secara horizontal (Lanskap), lebar layar melewati breakpoint `sm:` (>640px) sementara tinggi layar berkurang tajam ($\sim 350\text{px} - 400\text{px}$).
   `FullScreenModal` secara cerdas beradaptasi dari layar penuh menjadi modal card mengambang dengan batas tinggi dinamis `sm:max-h-[calc(100dvh-3rem)]`. Area konten tetap dapat digulir dengan mulus berkat `min-h-0 flex-1 overflow-y-auto overscroll-contain` tanpa pernah mendorong sticky footer atau header ke luar batas pandang layar.

9. **Aturan Mutlak Sub-Modal & Dialog Pop-Up Bersarang (Nested LIFO Invariant):**
   Setiap dialog pop-up sekunder, keypad numpad input nominal (seperti *New amount* di pembayaran), drawer geser (seperti *Keranjang Mobile* di POS), modal split bill, konfirmasi, atau popup rincian yang berada di dalam modal induk atau halaman:
   - **WAJIB** memanggil `useModalBackHandler(isPopupOpen, () => setIsPopupOpen(false))` pada level komponen tempat state tersebut berada.
   - **DILARANG KERAS** membiarkan popup/drawer hanya dikontrol oleh kondisi CSS/JSX (`isOpen && <div className="fixed inset-0...">`) tanpa mendaftarkan `useModalBackHandler`.
   - **Hierarki Penutupan (Anti-Bypass):** Saat kasir menekan tombol Back saat popup anak (misal: keypad edit nominal) terbuka, sistem LIFO **HANYA** menutup popup anak tersebut. Modal induk (modal pembayaran) **WAJIB TETAP TERBUKA** di layar.
   - **Checklist Audit AI / Developer:**
     1. Apakah ada state `is...Open` yang merender overlay `fixed inset-0`?
     2. Apakah sudah ada baris `useModalBackHandler(is...Open, onClose)` untuk state tersebut?
     3. Uji: Buka modal induk -> Buka popup anak -> Tekan Back -> Pastikan hanya popup anak yang tertutup.

10. **Aturan Mutlak Urutan React Hooks pada Modal (Unconditional Hooks Invariant):**
    - **DILARANG KERAS** menempatkan *early return* (`if (!isOpen) return null`, `if (!product) return null`) mendahului deklarasi React Hooks (`useMemo`, `useState`, `useEffect`, `useRef`, `useCallback`).
    - **WAJIB** menempatkan semua Hooks di bagian paling atas badan fungsi komponen modal. Guard `if (!isOpen || !data) return null` **HANYA BOLEH DILETAKKAN DI PALING BAWAH** tepat sebelum sintaks pengembalian elemen JSX.
    - **Pencegahan Crash "Client-Side Exception":** Pelanggaran aturan urutan Hooks menyebabkan Next.js / React melempar fatal exception `Rendered more hooks than during the previous render` saat modal yang semula tertutup dibuka oleh pengguna. Seluruh kalkulasi data di dalam `useMemo` saat modal tertutup (`data === null`) wajib dilengkapi proteksi fallback kenihilan (`if (!data) return []`).

---

Untuk contoh implementasi lengkap, batasan, dan studi kasus, baca [knowledge mobile modal UX](../../knowledge/mobile-modal-ux.md).
