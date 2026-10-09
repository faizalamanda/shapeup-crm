# Anti-Pattern: Manual Invoice / Order Cancellation

## Latar Belakang Masalah
Sebelumnya, pada fitur Edit Invoice (`app/api/orders/invoices/[id]/route.ts`), terdapat sebuah *anti-pattern* di mana sistem secara manual mencoba mengembalikan stok fisik dan menyisipkan jurnal pembalikan (reversal) ketika tagihan dibatalkan (Cancel).

**Masalah yang ditimbulkan:**
1. **N+1 Query Bottleneck:** Sistem menggunakan `for...of` untuk memperbarui kolom `products.stock_quantity` dan menyisipkan baris jurnal per item secara serial. Jika invoice berisi 100 jenis barang, ini akan menimbulkan setidaknya 100 *query update* terpisah yang menyebabkan *timeout*.
2. **Pelanggaran Arsitektur Ledger:** Sesuai arsitektur *Inventory Ledger*, stok fisik produk tidak boleh diubah secara manual via `update({ stock_quantity: ... })` dari *API Layer*. Pergerakan harus melalui tabel `stock_moves`, sehingga *Trigger PostgreSQL* dapat melakukan sinkronisasi dengan aman dan menjaga konsistensi kalkulasi HPP.
3. **Duplikasi (DRY Violation):** Logika pembalikan akun HPP, Pendapatan, dan Kas sudah didefinisikan secara matang di dalam layanan terpusat `syncOrderToLedger`. Menulis ulangnya di *API Controller* sangat rawan akan inkonsistensi.

## Solusi (Best Practice)
Untuk membatalkan transaksi yang terkait dengan mutasi stok dan jurnal finansial, cukup lakukan hal berikut:

1. Ubah status transaksi/pesanan menjadi `cancelled` di database.
2. Segera panggil `await syncOrderToLedger(id, supabase)`.

```typescript
// CONTOH YANG BENAR
if (status === 'cancelled' && existing.status !== 'cancelled') {
  // 1. Update status
  const { error: cancelErr } = await supabaseAdmin
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (cancelErr) throw cancelErr

  // 2. Delegate Reversal to unified orderLedger service
  await syncOrderToLedger(id, supabaseAdmin)
}
```

Dengan mendelegasikan kepada `syncOrderToLedger`, fungsi akan secara otomatis mendeteksi status `cancelled` dan secara idempoten melakukan pembalikan (restore) stok fisik melalui `applyStockMovement` beserta jurnal finansial yang mendasarinya tanpa menyebabkan _N+1 query_.
