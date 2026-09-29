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

## Backfill dan data legacy

Backfill hanya boleh memakai UUID produk bila tersedia. Jika perlu fallback SKU/nama, index alias harus dibatasi dengan `business_id`; nama atau SKU lintas business tidak boleh pernah dipakai untuk merelasi produk. Selalu gunakan paginasi saat fetching `stock_moves` di script backfill untuk melewati batas 1.000 baris PostgREST.

Sebelum menghapus atau membangun ulang move historis, bandingkan dulu `purchases.items_json.product_id`, `business_id`, dan rows `stock_moves`. Gejala tabel yang tampak duplikat bisa berasal dari fallback UI, bukan data tersimpan. Jalankan perubahan destruktif hanya terhadap dokumen yang sudah diverifikasi dan dengan hasil preview.

## Migrasi

Migrasi schema untuk kolom/constraint ledger harus diterapkan sebelum code writer baru dideploy. Constraint foreign key legacy dapat ditambahkan `NOT VALID` bila data lama belum diaudit; tetap verifikasi dan validasi data legacy dalam pekerjaan terpisah.
