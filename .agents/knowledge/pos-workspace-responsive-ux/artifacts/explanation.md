# POS Workspace Responsive Architecture & World-Class Cashier UX

## 1. Problem Statement & Industrial Benchmarking
Pada aplikasi kasir POS tablet dan monitor desktop, dua kendala ergonomis utama sering muncul:
1. **Tablet Horizontal Clipping (Sisi Kanan Terpotong):**
   Pada layar tablet (768px – 1024px), format mata uang IDR dengan 6–7 digit (`Rp 993.000` / `Rp 1.500.000`), kuantitas item, penanda varian, tombol `Hold`, dan tombol checkout utama sering mengalami pemotongan (*clipping*) jika panel keranjang terlalu sempit (< 300px) atau jika kontainer flex tidak memiliki `min-w-0` dan `overflow-hidden`.
2. **Widescreen Underutilization ("Layar Penuh Sisa Ruang"):**
   Pada layar monitor desktop/PC kasir 1080p atau 1440p (lebar $\ge 1536\text{px}$), membatasi kolom katalog ke 4 kolom menyebabkan kartu produk menjadi melar berlebihan dan menyisakan ruang kosong besar yang tidak efisien.
3. **Cluttered Receipt Summary:**
   Pengulangan baris `TOTAL` statis di atas tombol bayar, serta tumpang-tindih antara diskon item dan diskon global membuat kasir kebingungan dan memakan ruang vertikal.
4. **Poor Checkout Color Psychology:**
   Penggunaan warna pink/magenta/pastel pada tombol utama pembayaran mengurangi keterbacaan (*glanceability*) kasir dari sudut pandang miring dan tidak mencerminkan transaksi finansial resmi.

---

## 2. Core Architectural Standards

### 2.1 Anti-Clipping Minimum Widths & Flex Hierarchy
- Panel keranjang kanan pada split-screen (`md:`) diatur dengan lebar aman:
  ```tsx
  className="hidden md:flex md:w-[330px] lg:w-[360px] xl:w-[390px] 2xl:w-[420px] shrink-0 border-l border-slate-200 min-w-0 overflow-hidden"
  ```
- **Rasional:**
  - `330px` pada layar tablet memastikan tombol `Hold` (70px) berdampingan dengan tombol checkout `Bayar` (220px+) beserta padding kontainer tanpa terpotong.
  - Penambahan `min-w-0` dan `overflow-hidden` mencegah konten internal memaksakan pembesaran flex container yang dapat mendorong panel keluar batas viewport.

### 2.2 Adaptive Multi-Column Catalog Density
- Menyesuaikan kerapatan kartu katalog dengan lebar viewport:
  ```tsx
  className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-3 sm:gap-3.5"
  ```
- Di layar 1080p/1440p (`2xl:grid-cols-5 3xl:grid-cols-6`), kartu produk berukuran rapat dan proporsional, menampilkan 15–24 produk sekaligus tanpa scroll berlebih.

### 2.3 Lean Receipt Bill Summary & Pure Discount Separation
- **Penyatuan Total ke Tombol Bayar:** Baris teks `TOTAL` dihapus; nominal grand total disatukan langsung ke tombol aksi:
  ```tsx
  <span className="truncate">{!activeShift ? 'Buka Shift Dulu 🔑' : 'Bayar'}</span>
  <span className="font-black bg-blue-800/50 text-white px-2.5 py-1 rounded-lg text-xs sm:text-sm tracking-tight shrink-0 whitespace-nowrap">
    Rp {grandTotal.toLocaleString('id-ID')} →
  </span>
  ```
- **Pemisahan Mutlak Diskon Global:**
  - Baris `🏷️ Diskon Global` murni membaca `globalDiscountAmount > 0` (input dari modal diskon pesanan), bukan total akumulasi item discount. Jika belum ada diskon global, tombol hijau `[+ Diskon Global]` tetap tersedia.
  - Potongan diskon per-item tidak dimunculkan sebagai baris tersendiri di ringkasan footer; cukup ditampilkan pada baris item dengan tanda harga coret (*strikethrough*).

### 2.4 High-Contrast Cashier Action Psychology (Royal Blue)
- Mengacu pada standar Moka POS (`#2B6CB0`) dan Square POS, tombol checkout utama menggunakan **Solid Royal Blue**:
  ```tsx
  className={`... ${!activeShift ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-blue-500/25'}`}
  ```
- Warna biru solid memberikan kontras tinggi terhadap teks putih, mencerminkan eksekusi transaksi finansial resmi, dan tidak melelahkan mata kasir setelah berjam-jam bekerja.

### 2.5 Multiline Auto-Wrap & Full-Width Notes
- Nama produk yang panjang menggunakan `line-clamp-2 break-words` agar kolom harga di sebelah kanan tetap rapat dan tidak terpotong.
- Catatan khusus item (`item.note`) dipajang sebagai balok terpisah full-width di bawah harga dengan `break-words whitespace-normal` agar instruksi operasional panjang tampil utuh tanpa terpotong elipsis (`...`).
