# Multi-Bucket Inventory Architecture: Karantina, In-Transit, & Ledger On-Hand

## 🚨 Root Cause Analysis: Distorsi Saldo Akibat Mutasi Pending

Pada arsitektur *Double-Entry Stock Ledger*, setiap pergerakan barang disimpan sebagai *immutable events* di tabel `stock_moves`. Namun, terdapat jebakan fatal jika agregasi saldo berjalan (*running balance / system_stock*) tidak memfilter status mutasi secara ketat:

### Kasus Nyata: Kasus Retur COD & Stok Opname
1. Ketika pesanan e-commerce/COD dibatalkan atau retur (`source_type = 'order'`), sistem mencatat pergerakan balik:
   * `type: 'receipt'` (arah: pemulihan barang)
   * `status: 'pending'` (karena barang masih dibawa kurir / berada di area sortir retur, belum masuk rak gudang).
2. **PostgreSQL Trigger** `trg_sync_product_stock_from_moves` hanya menjumlahkan mutasi dengan `status = 'done'`. Sehingga `products.stock_quantity` tetap akurat sesuai fisik di rak gudang aktif (misal: 1 pcs).
3. Namun pada **Database View** `v_stock_moves_ledger`, kueri awal menjumlahkan semua baris tanpa memfilter status:
   ```sql
   -- ❌ SALAH: Menjumlahkan mutasi pending ke saldo aktif
   SUM(CASE WHEN sm.type IN ('receipt', 'refund') THEN sm.qty ... END) OVER (...)
   ```
   Akibatnya, saldo sistem di View melonjak menjadi 2 pcs (+1 pcs dari retur pending).
4. Saat staf gudang melakukan Stock Opname dengan jumlah fisik riil di rak = 2 pcs:
   * API Opname membaca `system_stock` dari View = 2 pcs.
   * Dihitung `diff = actual (2) - system (2) = 0`.
   * Karena selisih 0, sistem menganggap tidak ada penyesuaian, sehingga mutasi opname **tidak diinsert ke `stock_moves`**.
   * Di UI "Riwayat Move History", data opname hari itu tidak muncul, dan stok fisik di database tetap tertahan di angka 1.

---

## 🏛️ Prinsip Arsitektur: Database-Driven Multi-Bucket Inventory

Stok barang dipisahkan secara fisik dan relasional melalui kolom eksplisit `bucket` di tabel `stock_moves`:

$$\begin{aligned}
\text{Total Dimiliki (Total Owned)} &= \text{Stok Fisik Rak (On-Hand)} + \text{Karantina Retur (Quarantine)} + \text{Dalam Pengiriman (In-Transit)} \\
\text{Stok Siap Jual (Available to Promise)} &= \text{Stok Fisik Rak (On-Hand)} - \text{Terkunci Pesanan (Reserved)}
\end{aligned}$$

| Dimensi Stok | Kolom `bucket` | Status di `stock_moves` | Pengaruh ke Saldo Rak Gudang? | Deskripsi Operasional |
| :--- | :--- | :--- | :---: | :--- |
| **Stok Fisik (On-Hand)** | `bucket = 'main'` | `status = 'done'` | **YA (100%)** | Barang fisik yang sudah resmi terverifikasi berada di rak gudang aktif. |
| **Stok Karantina (Quarantine)** | `bucket = 'quarantine'` | `status = 'pending'` / `'done'` | **TIDAK** | Barang retur dari pelanggan/COD yang berada di pos inspeksi/karantina. |
| **Stok Pengiriman (In-Transit)** | `bucket = 'in_transit'` | `status = 'in_transit'` | **TIDAK** | Barang dalam perjalanan antar gudang/cabang atau kurir ekspedisi. |
| **Stok Terkunci (Reserved)** | `bucket = 'main'` | `status = 'pending'`, `type = 'delivery'` | **TIDAK** (Hanya potong *Available*) | Barang sudah dipesan pembeli (menunggu dipacking/dikirim). |

---

## 🛡️ Standar Implementasi Wajib

### 1. Definisi Database View `v_stock_moves_ledger` (Native Window Functions)
Perhitungan saldo berjalan untuk setiap wadah dilakukan 100% oleh Database Engine PostgreSQL, bukan oleh logika JavaScript:

```sql
CREATE OR REPLACE VIEW public.v_stock_moves_ledger AS
SELECT 
    sm.*,
    -- 1. Saldo Gudang Utama (Rak Siap Jual)
    SUM(
        CASE
            WHEN sm.status = 'done' AND sm.bucket = 'main' THEN
                CASE
                    WHEN sm.type IN ('receipt', 'refund') THEN sm.qty
                    WHEN sm.type = 'delivery' THEN -sm.qty
                    WHEN sm.type = 'adjustment' AND (sm.origin_location_id IS NULL OR (sm.destination_location_id IS NOT NULL AND sm.origin_location_id IS NULL)) THEN sm.qty
                    WHEN sm.type = 'adjustment' THEN -sm.qty
                    WHEN sm.type = 'transfer' AND sm.destination_location_id IS NOT NULL THEN sm.qty
                    WHEN sm.type = 'transfer' THEN -sm.qty
                    ELSE 0
                END
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC, sm.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS system_stock,

    -- 2. Saldo Karantina Retur
    SUM(
        CASE
            WHEN sm.bucket = 'quarantine' AND sm.status != 'cancelled' THEN
                CASE
                    WHEN sm.type = 'receipt' THEN sm.qty
                    WHEN sm.type IN ('delivery', 'transfer', 'adjustment') THEN -sm.qty
                    ELSE 0
                END
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC, sm.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS quarantine_stock,

    -- 3. Saldo Dalam Pengiriman
    SUM(
        CASE
            WHEN sm.bucket = 'in_transit' AND sm.status != 'cancelled' THEN
                CASE
                    WHEN sm.type = 'delivery' THEN sm.qty
                    WHEN sm.type IN ('receipt', 'transfer') THEN -sm.qty
                    ELSE 0
                END
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC, sm.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS in_transit_stock
FROM public.stock_moves sm;
```

### 2. Integritas Semantik Lokasi (Origin / Destination)
Dilarang melabeli mutasi retur pesanan sebagai penerimaan dari Pemasok/Vendor. Resolusi nama lokasi harus membedakan sumber dokumen:
* `bucket = 'quarantine'` & `type = 'receipt'` $\rightarrow$ Asal: `Transit Pelanggan (Retur)`, Tujuan: `Karantina Retur`.
* `bucket = 'quarantine'` & `type = 'transfer'` $\rightarrow$ Asal: `Karantina Retur`, Tujuan: `Gudang Utama (Penerimaan)`.
* `bucket = 'main'` & `type = 'receipt'` $\rightarrow$ Asal: `Karantina Retur`, Tujuan: `Gudang Utama (WH-MAIN)`.

### 3. Resolusi Saldo pada Stock Opname API
Di endpoint `app/api/stock-opname/route.ts`:
* Selalu baca `system_stock` dari View yang memfilter `status = 'done' AND bucket = 'main'`.
* Jika produk baru belum memiliki riwayat mutasi di `v_stock_moves_ledger`, gunakan fallback ke `products.stock_quantity`.
* Pastikan `recorded_quantity` yang disimpan di `stock_opname.items_json` mencerminkan saldo fisik aktif yang sebenarnya.

### 4. Visualisasi Kolom Wadah / Bucket di UI Move History
Move History (`ProductDetailModal.tsx`) menampilkan kolom **Wadah** berdasarkan nilai kolom database `bucket`:
* 🏢 `Gudang Utama` (hijau) untuk `bucket = 'main'`
* 📦 `Karantina Retur` (kuning/amber) untuk `bucket = 'quarantine'`
* 🚚 `Dalam Pengiriman` (biru) untuk `bucket = 'in_transit'`

### 5. Pola Pure Append-Only (Zero UPDATE) Saat Penerimaan atau Kehilangan Retur
Sesuai prinsip Event Sourcing dan Audit Trail permanen:
1. **Dilarang Keras Mengubah Data Lama (Zero UPDATE)**: Baris transaksi retur awal (misal: 08/10) **HARAM DIUBAH**. Nilai status, tanggal, dan bucket-nya tetap utuh sebagai bukti historis kapan barang masuk karantina.
2. **Saat Aksi "Terima & Jual"**:
   - Sistem melakukan `INSERT` mutasi pelepas karantina (`bucket = 'quarantine'`, `type = 'transfer'`, `qty = X`, tanggal hari ini).
   - Sistem melakukan `INSERT` mutasi masuk gudang utama (`bucket = 'main'`, `type = 'receipt'`, `qty = X`, `status = 'done'`, tanggal hari ini).
3. **Saat Aksi "Hilang / Rusak"**:
   - Sistem melakukan `INSERT` mutasi penghapusan karantina (`bucket = 'quarantine'`, `type = 'adjustment'`, `qty = X`, tanggal hari ini).
   - Sistem memposting Jurnal Beban Kerugian Barang Hilang.
4. **Queue Resolution**: Antrean retur belum diproses dihitung dari `Net Qty = In - Out > 0`. Begitu mutasi pengurang di-*append*, saldo karantina otomatis 0 dan dokumen hilang dari antrean secara elegan tanpa memodifikasi baris asal.

