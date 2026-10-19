# Arsitektur PWA Auto-Rotate & Safe-Area Inset Lanskap — ShapeUp CRM

## 1. Latar Belakang & Akar Masalah

Pada aplikasi seluler berbasis web (Progressive Web App / PWA), orientasi jendela tampilan (*display window*) dikendalikan oleh spesifikasi dokumen **W3C Web Application Manifest**. 

Sebelum pembaruan dilakukan, berkas `public/manifest.json` memiliki deklarasi:
```json
{
  "orientation": "portrait-primary"
}
```

### 1.1 Mekanisme WebAPK Android & Window Manager Lock
Ketika pengguna menginstal aplikasi via browser di Android (Chrome, Brave, Edge, atau Samsung Internet):
1. Browser tidak hanya membuat shortcut URL di homescreen, melainkan berinteraksi dengan *WebAPK Minting Service* dari Google/Chromium.
2. Server tersebut mengompilasi sebuah paket instalasi mini asli Android (`.apk`) di mana atribut `android:screenOrientation="portrait"` disematkan langsung ke berkas manifes biner aplikasi Android (`AndroidManifest.xml`).
3. Akibatnya, *Window Manager* sistem operasi Android memprioritaskan konfigurasi statis APK di atas sensor giroskop fisik ponsel.
4. Meskipun pengguna mengaktifkan fitur **Auto-Rotate (Rotasi Otomatis)** pada Quick Settings Android dan memiringkan perangkat 90°, OS menolak memutar jendela PWA, sehingga aplikasi terkunci kaku pada mode potret.

---

## 2. Standar Spesifikasi W3C Web App Manifest

Berdasarkan spesifikasi resmi W3C Web App Manifest (§8.5 `orientation` member), nilai anggota orientasi dievaluasi sebagai berikut:

| Nilai Konfigurasi | Perilaku Saat Auto-Rotate HP Aktif | Perilaku Saat Auto-Rotate HP Terkunci | Kesesuaian Ritel & Kasir |
| :--- | :--- | :--- | :--- |
| `"portrait-primary"` *(Lama)* | **Terkunci Potret** (Ponsel dimiringkan tidak ada respons). | Terkunci Potret. | ❌ Tidak ramah dudukan meja kasir (*stand*). |
| **`"any"`** *(Standar Baru)* | **Bebas Berputar** (Potret, Lanskap Kanan, Lanskap Kiri). | Terkunci Potret sesuai kunci sistem OS. |  **Standar Emas Ritel & Omnichannel**. |
| `"natural"` | Mengikuti orientasi fisik perangkat (Ponsel = potret, Tablet = lanskap). | Terkunci sesuai sistem OS. | Kurang fleksibel pada tablet hybrid. |

Dengan menetapkan `"orientation": "any"` pada `public/manifest.json`, aplikasi memberikan kendali penuh kepada pengguna:
- Jika pengguna ingin aplikasi tetap tegak, mereka cukup mematikan tombol Auto-Rotate di HP mereka.
- Jika kasir meletakkan ponsel pada dudukan counter meja kasir secara horizontal, aplikasi otomatis berputar ke mode Lanskap yang lega.

---

## 3. Integrasi Viewport `<head>` & Safe-Area Inset

Ketika smartphone berlayar modern (bezel-less) diputar ke posisi horizontal, posisi kamera depan (*punch-hole*), poni (*notch*), atau *Dynamic Island* berpindah dari atas ke sisi **kiri** atau **kanan** layar.

### 3.1 Direktif `viewport-fit=cover`
Secara default, peramban seluler menambahkan *letterbox* (bilah putih/hitam) di sisi samping agar konten tidak menabrak notch. Untuk memanfaatkan seluruh layar OLED secara penuh dan elegan, dokumen HTML wajib mendeklarasikan:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```
Pada ShapeUp CRM, deklarasi ini disatukan secara terpusat pada helper komponen `PWAHead` di [app/layout.tsx](file:///home/faiz-jazuli/shapeup-crm/app/layout.tsx):
```tsx
function PWAHead() {
  return (
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <link rel="manifest" href="/manifest.json" />
      <meta name="theme-color" content="#18181b" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="ShapeUp CRM" />
      <link rel="apple-touch-icon" href="/icon-192.png" />
    </head>
  )
}
```
Helper ini dipanggil pada seluruh cabang render layout (termasuk halaman non-sidebar seperti `/pos`, `/login`, dan onboarding).

### 3.2 Proteksi Kolisi Visual (`Zero Notch Collision`)
Untuk mencegah teks, tombol back, atau tombol kasir tertutup fisik kamera ponsel di sisi samping, seluruh kontainer kerja layar penuh menerapkan padding CSS Environment Variable:
```tsx
style={{
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
}}
```
Komponen yang telah diproteksi meliputi:
1. **Layout Utama CRM ([app/layout.tsx](file:///home/faiz-jazuli/shapeup-crm/app/layout.tsx)):** Kontainer `div.main-area` melindungi header topbar dan konten utama.
2. **Register Kasir POS ([POSWorkspace.tsx](file:///home/faiz-jazuli/shapeup-crm/app/pos/components/POSWorkspace.tsx)):** Kontainer `fixed inset-0` melindungi tombol kembali ke hub, status shift, dan tombol aksi nota.
3. **Hub & Sesi Kasir ([POSHub.tsx](file:///home/faiz-jazuli/shapeup-crm/app/pos/components/POSHub.tsx)):** Command strip atas dan daftar sesi shift kasir.

---

## 4. Adaptasi Ergonomi Layar pada Smartphone Lanskap

Saat smartphone berputar ke mode lanskap, dimensi viewport mengalami inversi proporsi:
- **Lebar Layar:** Meningkat dari $\sim 390\text{px} - 430\text{px}$ menjadi $\sim 844\text{px} - 932\text{px}$. Nilai ini melewati breakpoint Tailwind `sm:` (640px) dan `md:` (768px), namun masih di bawah `lg:` (1024px).
- **Tinggi Layar:** Menyusut tajam dari $\sim 844\text{px} - 932\text{px}$ menjadi hanya $\sim 350\text{px} - 400\text{px}$.

### Respon Komponen Antarmuka:
1. **Sidebar Navigasi CRM:** Tetap tersembunyi rapi berkat breakpoint `lg: 1024px` dan hanya terbuka saat tombol hamburger disentuh, sehingga ruang pandang konten tetap maksimal.
2. **Katalog Produk POS:** Grid kartu produk otomatis melebar dari 2 kolom menjadi 3 hingga 4 kolom (`sm:grid-cols-3 md:grid-cols-4`), mempercepat kasir mencari dan memilih barang.
3. **FullScreenModal & Dialog:** Modal beradaptasi secara cerdas dari layar penuh 100vh menjadi card mengambang dengan batas tinggi adaptif `sm:max-h-[calc(100dvh-3rem)]`. Area konten mempertahankan `overflow-y-auto overscroll-contain` tanpa pernah mendorong tombol aksi utama di footer ke luar batas layar.

---

## 5. Prosedur Pembaruan Klien (PWA Update Lifecycle)

Bagi pengguna yang telah menginstal PWA versi lama sebelum berkas manifes diperbarui:
- **Peramban Web Standar:** Pembaruan aktif secara instan saat halaman dimuat ulang (*refresh*).
- **WebAPK Android Terpasang di Homescreen:** Android memeriksa pembaruan manifest di latar belakang secara asinkronus (biasanya setiap 24 jam). Untuk langsung merasakan rotasi otomatis seketika:
  1. Hapus (*uninstall*) ikon PWA ShapeUp CRM lama dari Layar Utama HP.
  2. Buka aplikasi di Chrome/Brave/Edge.
  3. Tekan menu browser lalu pilih **"Tambahkan ke Layar Utama" / "Install App"**.
