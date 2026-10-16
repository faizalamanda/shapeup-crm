# Unified Sales & HPP Journal Trigger & Dynamic Dating Architecture

## 1. Latar Belakang & Redundansi Pengaturan (The Setting Problem)

Sebelumnya, terdapat dua pengaturan terpisah di antarmuka CRM:
1. **Setting No. 2 (`global_journal_hpp_status` / `journal_hpp_status`):** Menentukan pada status pesanan apa rincian jurnal persediaan dan HPP diterbitkan (`['processing', 'shipped', 'completed']`).
2. **Setting No. 4 (`global_sales_journal_date_basis` / `sales_journal_date_basis`):** Menentukan acuan penanggalan jurnal penjualan (Saat Diproses / Dibayar vs Saat Pesanan Masuk).

Secara prinsip rekayasa perangkat lunak dan akuntansi, **Setting No. 4 adalah redundan**:
- Ketika bisnis menetapkan bahwa jurnal diterbitkan saat pesanan diproses atau dikirim (Setting No. 2), maka tanggal peristiwa akuntansi (*accounting event date*) secara inheren terjadi pada saat pesanan tersebut diproses atau diverifikasi pembayarannya (jam kerja operasional / `date_paid`).
- Menciptakan pengaturan terpisah (Setting No. 4) menambah kompleksitas kognitif bagi pengguna (*UI cognitive load*) dan menciptakan risiko divergensi data jika pengaturan saling bertentangan.

Oleh karena itu, **Setting No. 4 dihapus sepenuhnya**, dan **Setting No. 2 dijadikan Acuan Tunggal (*Single Source of Truth*)** untuk:
1. Menentukan *kapan* jurnal Penjualan & HPP diterbitkan.
2. Menentukan *tanggal transaksi* yang disematkan pada jurnal akuntansi di buku besar.

---

## 2. Dynamic Dating Logic di Orchestrator (`lib/orderLedger.ts`)

Di dalam fungsi orchestrator `syncOrderToLedger()`:

```typescript
// Ambil konfigurasi Setting No. 2
const { defaultHppPct, stockReductionStatuses, journalHppStatuses } = integrationConfigResult

// Evaluasi apakah trigger jurnal dikaitkan dengan proses operasional / pembayaran
const isDelayedJournalTrigger = journalHppStatuses.some((s: string) => 
  ['processing', 'shipped', 'completed'].includes(s)
)

// Tanggal awal: order checkout date
let salesDate = order.order_date_utc || order.order_date || new Date().toISOString()

// Jika dipicu pada status operasional (processing/shipped/completed),
// gunakan timestamp operasional riil (pembayaran / mutasi gudang / update pesanan)
if (isDelayedJournalTrigger) {
  if (paymentDate && !isCod) {
    salesDate = paymentDate
  } else if (orderMoveDate) {
    salesDate = orderMoveDate
  } else if (order.updated_at) {
    salesDate = new Date(order.updated_at).toISOString()
  }
}
```

### Mekanisme Penyelarasan Jurnal Existing (`salesTx` Alignment):
Jika transaksi penjualan (`salesTx`) sudah ada sebelumnya di database, sistem memeriksa apakah tanggal transaksi telah sesuai dengan `expectedSalesDate` hasil evaluasi Setting No. 2:
```typescript
if (salesTx && expectedSalesDate && salesTx.date !== expectedSalesDate) {
  await supabase.from('transactions').update({ date: expectedSalesDate }).eq('id', salesTx.id)
  salesTx.date = expectedSalesDate
}
```

---

## 3. Fleksibilitas Multi-Status vs Single-Status

Pengguna memiliki fleksibilitas penuh untuk memilih opsi pada antarmuka:
- Memilih **semua** status: `[Processing, Shipped, Completed]`
- Memilih **kombinasi**: misal `[Shipped, Completed]`
- Memilih **hanya satu**: misal hanya `Processing` atau hanya `Completed`

### Bagaimana Sistem Memetakannya Secara Pintar?

1. **Kasus Memilih Hanya Satu (`journalHppStatuses = ['processing']`):**
   - **Saat pesanan berstatus `processing`:** Sistem mengecek `journalHppStatuses.includes('processing') === true`. Jurnal Penjualan, HPP, dan Pembayaran langsung diterbitkan dengan tanggal operasional (`paymentDate`).
   - **Saat pesanan berlanjut ke `shipped` atau `completed`:** Sistem mengecek `salesTx` di database. Karena sudah ada, sistem **TIDAK AKAN** menduplikasi jurnal (Idempotensi terjamin).

2. **Kasus Memilih Hanya Satu (`journalHppStatuses = ['completed']`):**
   - **Saat pesanan masih `processing` atau `shipped`:** Jurnal HPP ditahan karena `journalHppStatuses.includes(status) === false`.
   - **Saat pesanan resmi `completed`:** Jurnal Penjualan & HPP diterbitkan seketika pada saat status selesai.

3. **Kasus Memilih Banyak Status (`['processing', 'shipped', 'completed']` - Rekomendasi):**
   - Memberikan fleksibilitas jika suatu pesanan e-commerce melompati status (misal pesanan instan/COD yang langsung berstatus `completed` tanpa melewati `processing`). Jurnal tetap terbit pada status pertama yang ditemui tanpa risiko terlewat.

---

## 4. Hirarki Konfigurasi (Per-Platform Override vs Global Fallback)

Fungsi `getIntegrationConfigs(businessId, platform)` di `lib/orderLedger.ts` mendukung dua tingkat hierarki:
1. **Platform Override (`use_global_settings = false`):** Platform tertentu (misalnya WooCommerce) dapat memiliki setting trigger status tersendiri di [Pengaturan Integrasi](file:///home/faiz-jazuli/shapeup-crm/app/settings/integrations/page.tsx).
2. **Global Fallback (`use_global_settings = true`):** Menggunakan aturan terpusat dari [Pengaturan Stok & Jurnal Global](file:///home/faiz-jazuli/shapeup-crm/app/settings/inventory/page.tsx).

---

## 5. Ringkasan File & Komponen Terkait

| File / Modul | Peran & Perubahan |
| :--- | :--- |
| `app/settings/inventory/page.tsx` | Menghapus kartu No. 4, menyederhanakan halaman menjadi 3 bagian inti (Stok, Jurnal HPP, Default HPP %). |
| `app/settings/integrations/page.tsx` | Menghapus input Acuan Tanggal Jurnal Penjualan pada modal/kartu WooCommerce. |
| `app/api/settings/inventory/route.ts` | Menghapus field `global_sales_journal_date_basis` dari skema GET & POST payload. |
| `lib/orderLedger.ts` | Menghapus `salesJournalDateBasis` dari cache, dan mengikat `salesDate` langsung ke `isDelayedJournalTrigger` dari Setting No. 2. |
| `.agents/AGENTS.md` | Aturan 3 (Localization & Date Formatting) diperbarui menjadi standar *Unified Sales & HPP Journal Trigger & Date Basis*. |
| `.agents/skills/api-modules/SKILL.md` | Mendokumentasikan standar integrasi Setting No. 2 sebagai acuan tunggal trigger & penanggalan jurnal. |
