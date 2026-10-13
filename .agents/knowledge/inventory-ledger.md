# Inventory Ledger: Product Relation and Move History

## Kunci dan relasi

- `stock_moves.product_id` adalah UUID produk dan relasi utama ke `products.id`. Item purchase harus membawa `product_id` ini; jangan cocokkan ulang berdasarkan nama bila UUID tersedia.
- `business_id` adalah batas tenant. Semua query dan setiap fallback harus membatasinya.
- `reference` (misalnya nomor purchase) adalah teks untuk UI dan audit, bukan kunci relasi atau idempotensi.
- Untuk mutasi baru, simpan `source_type` dan `source_id`. Pada purchase, `source_type = 'purchase'` serta `source_id = purchases.id`. Gabungan business, source, product, dan type mencegah satu dokumen menulis move yang sama dua kali.

## Riwayat produk & Performansi High-Speed

- **Indeks Komposit Database:** Query mutasi produk di-scope `business_id` + `product_id` dan diurutkan `created_at DESC`. Database menggunakan komposit indeks `idx_stock_moves_biz_prod_created` untuk respon ~1-3ms.
- **Location Caching:** API route meng-cache konfigurasi `inventory_locations` per business ID (TTL 5 menit) untuk mengeliminasi DB call lokasi berulang saat membuka modal mutasi produk.
- **Global Move History:** Untuk data mutasi se-bisnis, gunakan endpoint terpaginasi `action=global_moves` daripada menarik array unpaginated.
- **Client SWR Pattern & Indikator Sync:** Komponen modal/tab Move History wajib menggunakan SWR (Stale-While-Revalidate) in-memory cache.
  - Jika data dimuat dari cache client: Tampilkan indikator sync `⚡ Sync: Data Tampil dari Cache (0ms)`.
  - Revalidasi latar belakang berlangsung otomatis, dan saat data segar diterima dari server, badge diperbarui menjadi `✓ Live Database`.
  - Bila `stock_moves` belum terisi lalu riwayat dibangun dari dokumen `items_json`, dokumen yang lolos karena *salah satu* item cocok tetap harus difilter lagi setelah stitching berdasarkan `move.product_id === productId`.

## Write path pembelian

Buat dokumen `purchases` lebih dulu agar UUID sumber tersedia. Agregasikan item fisik per `product_id` untuk update stok/WAC dan untuk satu receipt move per produk. Gunakan `recordStockMovements()`; jangan insert `stock_moves` langsung dari route.

## Idempotensi dan Presisi Timestamp Mutasi

- **Composite Idempotency Key:** Pengecekan mutasi existing di `recordStockMovements()` menggunakan komposit `${product_id}_${source_type}_${source_id}_${type}` dan `${product_id}_${reference}_${type}`. Dilarang menggunakan hanya `${product_id}_${type}` karena akan memblokir transaksi selanjutnya.
- **Hierarki Presisi Timestamp Mutasi Pesanan (`delivery`):**
  1. `date_shipped_gmt` / `date_shipped` (Prioritas Utama: Waktu pengiriman fisik)
  2. `date_paid_gmt` / `date_paid` (Fallback 1: Waktu pembayaran)
  3. `date_completed_gmt` / `date_completed` (Fallback 2: Waktu pesanan selesai)
  4. `order_date_utc` / `order_date` (Fallback 3: Waktu pesanan dibuat)
- **Single Source of Truth Stok Fisik:**
  - `products.stock_quantity` **WAJIB HANYA** diperbarui secara otomatis oleh PostgreSQL Trigger `trg_sync_product_stock_from_moves` (`AFTER INSERT/UPDATE/DELETE ON stock_moves`).
  - Dilarang keras melakukan manual update `products.stock_quantity` via `supabase.from('products').update()` di JavaScript saat menulis `stock_moves`.

## Backfill dan data legacy

Backfill hanya boleh memakai UUID produk bila tersedia. Jika perlu fallback SKU/nama, index alias harus dibatasi dengan `business_id`; nama atau SKU lintas business tidak boleh pernah dipakai untuk merelasi produk. Selalu gunakan paginasi saat fetching `stock_moves` di script backfill untuk melewati batas 1.000 baris PostgREST.

Sebelum menghapus atau membangun ulang move historis, bandingkan dulu `purchases.items_json.product_id`, `business_id`, dan rows `stock_moves`. Gejala tabel yang tampak duplikat bisa berasal dari fallback UI, bukan data tersimpan. Jalankan perubahan destruktif hanya terhadap dokumen yang sudah diverifikasi dan dengan hasil preview.

## Multi-Bucket Ledger & Pure Append-Only Event Sourcing

- **Single Source of Truth Wadah (`bucket`):** Setiap mutasi memiliki kolom `bucket` bertipe `VARCHAR(50)`:
  - `main`: Stok on-hand rak gudang aktif (hanya `status = 'done'` yang dihitung oleh trigger ke `products.stock_quantity`).
  - `quarantine`: Barang retur pelanggan/COD dalam pos inspeksi.
  - `in_transit`: Barang dalam pengiriman ekspedisi / antar-cabang.
- **Perhitungan Saldo Berjalan Native (PostgreSQL Engine):** Saldo per wadah (`system_stock`, `quarantine_stock`, `in_transit_stock`) dihitung 100% oleh Database View `v_stock_moves_ledger` menggunakan Window Functions `SUM(...) OVER (PARTITION BY product_id ORDER BY created_at ASC, id ASC)`. Dilarang menghitung saldo menggunakan perulangan array di JavaScript.
- **Zero In-Place Updates (Zero UPDATE):** Dilarang mengubah status atau timestamp transaksi retur historis (misal: Order #5726 pada 08/10).
- **Mutasi Penyeimbang (Offsetting Inserts):**
  - **Aksi Terima:** Append mutasi keluar karantina (`bucket: 'quarantine'`, `type: 'transfer'`, `source_type: 'order_return_release'`, `status: 'done'`) DAN mutasi masuk gudang utama (`bucket: 'main'`, `type: 'receipt'`, `source_type: 'order_return_receive'`, `status: 'done'`) pada tanggal/waktu riil eksekusi (`new Date().toISOString()`).
  - **Aksi Hilang:** Append mutasi hapus karantina (`bucket: 'quarantine'`, `type: 'adjustment'`, `source_type: 'order_return_loss'`, `status: 'done'`) pada tanggal/waktu riil eksekusi, serta posting Jurnal Kerugian Ekspedisi.
- **Antrean Retur (Net Balance):** Daftar karantina belum selesai dihitung dari `Net Qty = In - Out > 0`. Begitu mutasi penyeimbang dicatat, item langsung hilang dari antrean secara konsisten tanpa menyentuh data awal.

## Migrasi

Migrasi schema untuk kolom/constraint ledger harus diterapkan sebelum code writer baru dideploy. Constraint foreign key legacy dapat ditambahkan `NOT VALID` bila data lama belum diaudit; tetap verifikasi dan validasi data legacy dalam pekerjaan terpisah.
