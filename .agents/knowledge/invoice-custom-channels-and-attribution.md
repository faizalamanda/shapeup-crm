# Invoice Custom Channels, Couriers & Omnichannel Customer Attribution — ShapeUp CRM

Dokumen ini mendefinisikan arsitektur *Adaptive Business Taxonomy* untuk **Kanal Sumber Pesanan (Sales Channel)**, **Kurir Pengiriman**, **UTM Source/Campaign**, dan **Sinkronisasi Platform Marketplace Customer** pada modul Invoice (`/orders/invoices`).

---

## 1. Latar Belakang & Prinsip Desain (HCI & Data Quality)

1. **Recognition Rather Than Recall (Nielsen, 1994):**
   - Staf tidak boleh dipaksa mengingat dan mengetik ulang kanal sumber pesanan kustom (seperti `Lazada`, `Blibli`, `Reseller B2B`, `Pameran Expo`) atau kurir pengiriman kustom (`Indah Cargo`, `Lalamove`) setiap kali membuat faktur baru.
2. **Pencegahan Folksonomy Drift (Furnas et al., 1987):**
   - Input teks bebas tanpa memori bisnis dan tanpa normalisasi *case-insensitive* menyebabkan terpecahnya baris analitik pada `/reports/orders` dan `/reports/profit` (contoh: `"Lazada"` vs `"lazada"`).
3. **Zero-Setup Adaptive Taxonomy:**
   - Kanal dan kurir kustom milik bisnis dipelajari secara otomatis dari riwayat transaksi (`orders`) dan profil marketplace pelanggan (`customers.metadata`), serta langsung tersedia di seluruh form pembuatan/pengeditan invoice dan filter pesanan.

---

## 2. Arsitektur Backend & Normalisasi Kanonikal

Pada `app/api/orders/invoices/route.ts` dan `app/api/orders/invoices/[id]/route.ts`:

- **`getBusinessCustomInvoiceOptions(businessId, supabaseAdmin)`:**
  - Mengekstrak opsi kustom unik milik `business_id` aktif secara paralel (`Promise.all`) dari tabel `orders` dan `customers`, disimpan pada *in-memory cache* (`${businessId}:__custom_options__`, TTL 30 detik, otomatis di-invalidate oleh `invalidateInvoicesCache(businessId)`):
    - `custom_channels`: Gabungan `orders.source_platform`, `orders.raw_source_data.source_order.channel`, `customers.metadata.marketplace_profiles.other_platform`, `lead_source`, dan `custom_channel` (dide-duplikasi *case-insensitive* terhadap `STANDARD_INVOICE_CHANNELS`).
    - `custom_couriers`: Gabungan `shapeup_kurir_awb` / `_kurir_awb` pada `orders.raw_source_data.meta_data` (dide-duplikasi terhadap `STANDARD_INVOICE_COURIERS`).
    - `custom_utm_sources` & `custom_utm_campaigns`: Riwayat nilai UTM unik milik bisnis.
- **`canonicalizeOption(input, standardList, customList)`:**
  - Setiap request `POST` dan `PUT` invoice menormalisasi `source_platform` dan `courier` secara *case-insensitive* terhadap daftar standar maupun daftar kustom bisnis yang sudah ada agar penamaan di database 100% konsisten.

---

## 3. Standar Antarmuka & Interaksi Pengguna (UI/UX)

1. **First-Class `<optgroup>` & Quick-Select Chips (`/orders/invoices/new` & `/orders/invoices/[id]/edit`):**
   - Kanal kustom milik bisnis dirender langsung di dalam `<optgroup label="Kanal Kustom Bisnis Anda">` (`🏷️`) pada dropdown **Kanal Sumber Pesanan**, serta ditampilkan sebagai *quick-select chips* di bawah dropdown.
   - Kurir kustom dirender di dalam `<optgroup label="Kurir Kustom Bisnis Anda">` (`🚚`).
   - Saat mengedit invoice yang menggunakan kanal atau kurir kustom, dropdown langsung memilih nilai kustom tersebut sebagai opsi utama (bukan melemparnya ke opsi `"Lainnya"`).
2. **Inline Save (`+ Simpan Kanal` / `+ Simpan Kurir`) & L2 Cache (`localStorage`):**
   - Saat staf memilih `➕ Tambah Kanal Kustom Baru...`, mengetik nama kanal, lalu menekan `Enter` atau tombol `+ Simpan Kanal`, nilai tersebut langsung disimpan ke `localStorage` ber-namespace `su_invoice_custom_opts_${businessId}` dan terpilih seketika di dropdown.
3. **Integrasi 1-Klik dari Akun Marketplace Customer:**
   - Pada `QuickAddCustomerForm`, input *Nama Platform Lain* (`other_platform`) dilengkapi `<datalist>` dan *quick-chips* dari `customChannels` bisnis, serta setiap nilai baru yang diketik langsung masuk ke daftar kanal kustom invoice secara reaktif.
   - Saat pelanggan terpilih di `CustomerSelectCombobox` memiliki profil marketplace (`shopee`, `tiktok`, `tokopedia`, atau `other_platform`), kartu alamat pelanggan menampilkan chip **`Kanal Akun Customer: [🏷️ Lazada: username → Pakai Kanal]`** untuk menyelaraskan Kanal Sumber Pesanan invoice dalam 1 klik.
   - Pada `CustomerSelectCombobox` dan halaman detail/cetak invoice (`/orders/invoices/[id]`), profil `other_handle` wajib merender label `other_platform` (bukan key internal `other_handle`).

