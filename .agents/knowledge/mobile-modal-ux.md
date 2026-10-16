# Mobile / PWA Full-screen Modal — ShapeUp CRM

Panduan referensi dan standar implementasi arsitektur modal mobile/PWA untuk seluruh modul ShapeUp CRM.

---

## 1. Konsep & Arsitektur Dasar

Gunakan `FullScreenModal` dari `@/components/ui/FullScreenModal` sebagai outer shell untuk semua modal fitur yang membutuhkan fokus pengguna di mobile/PWA.

- **Mobile Viewport:** Selalu 100% full-screen (`h-[100dvh] w-screen`). Komponen ini otomatis menghormati area aman perangkat (*safe-area insets* untuk *notch* di atas dan *home bar* di bawah).
- **Desktop Viewport:** Otomatis bertransformasi menjadi modal/card terpusat secara default (`desktopSize="md"`).
- **Manajemen Navigasi Hardware (LIFO):** Saat `isOpen` bernilai `true`, shell mendaftarkan riwayat navigasi melalui `useModalBackHandler`. Tombol Back perangkat atau gestur usap menutup modal paling atas; tombol `Escape` menutup modal pada desktop.
- **Isolasi Scroll:** Penguncian scroll halaman luar ditangani terpusat melalui *reference counting* (`lockBodyScroll()`).

> [!CAUTION]
> Dilarang keras menambahkan `createPortal`, manipulasi manual `document.body.style.overflow`, `history.pushState`, atau listener `popstate` di komponen pemakai modal.

---

## 2. Pilihan Ukuran Desktop (`desktopSize`)

Pilih `desktopSize` berdasarkan kepadatan konten:

| Ukuran | Kelas Tailwind | Kasus Penggunaan Ideal |
| :--- | :--- | :--- |
| `sm` | `sm:max-w-md` | Dialog konfirmasi penting, formulir singkat 1–2 input |
| `md` | `sm:max-w-2xl` | Form entri data standar (Tambah Pelanggan, Kas Masuk/Keluar) |
| `lg` | `sm:max-w-4xl` | Detail transaksi POS, rincian pembayaran, laporan kasir |
| `xl` | `sm:max-w-6xl` | Detail pesanan omnichannel, faktur pembelian 2-kolom multi-tab |
| `fullscreen` | Layar Penuh Desktop | Workspace perancang kanban, editor visual |

---

## 3. Pola Implementasi

### Pola A: Formulir Sederhana (Form Modal)

Gunakan `children` untuk formulir dan letakkan tombol simpan/batal di `footer`:

```tsx
<FullScreenModal
  isOpen={isEditorOpen}
  onClose={() => setIsEditorOpen(false)}
  title="Tambah Pelanggan Baru"
  description="Masukkan informasi kontak pelanggan"
  desktopSize="md"
  footer={
    <div className="flex items-center justify-end gap-2 w-full">
      <button type="button" onClick={() => setIsEditorOpen(false)} className="px-4 py-2 border rounded-xl text-xs font-bold">
        Batal
      </button>
      <button type="submit" form="customer-form" className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold">
        Simpan Pelanggan
      </button>
    </div>
  }
>
  <form id="customer-form" onSubmit={handleSave} className="space-y-4">
    {/* Input fields */}
  </form>
</FullScreenModal>
```

---

### Pola B: Modal Detail Kompleks & Multi-Tab (Contoh: OrderDetailModal & PurchaseDetailModal)

Ketika modal menampilkan banyak informasi (rincian item, riwayat bayar, jurnal akuntansi, dan ringkasan pengiriman), gunakan tata letak responsif 2-kolom:

```tsx
<FullScreenModal
  isOpen={Boolean(order)}
  onClose={onClose}
  title={
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-extrabold text-slate-900">Nota #{order?.order_number}</span>
      <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
        Lunas
      </span>
    </div>
  }
  description={
    <div className="text-xs text-slate-500">
      👤 {order?.customer?.name} • 📅 {formatDisplayDate(order?.order_date, 'datetime', timezone)}
    </div>
  }
  desktopSize="xl"
  footer={
    <div className="flex items-center justify-between w-full gap-2">
      <a href={`https://wa.me/${phone}`} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">
        💬 Chat WhatsApp
      </a>
      <button type="button" onClick={onClose} className="px-4 py-2 border rounded-xl text-xs font-bold">
        Tutup
      </button>
    </div>
  }
>
  <div className="flex flex-col lg:flex-row gap-6">
    
    {/* KOLOM KIRI: Tabs Konten (Items, Pembayaran, Jurnal) */}
    <div className="flex-1 min-w-0 order-2 lg:order-1 space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3 overflow-x-auto no-scrollbar">
        <button className="px-3.5 py-2 text-xs font-bold rounded-xl bg-slate-900 text-white">
          Item Pesanan (3)
        </button>
        <button className="px-3.5 py-2 text-xs font-bold rounded-xl bg-slate-100 text-slate-600">
          Riwayat Pembayaran (1)
        </button>
      </div>

      {/* Konten Tab Aktif (Tabel dibungkus overflow-x-auto) */}
      <div className="overflow-x-auto">
        <table className="min-w-[500px]">...</table>
      </div>
    </div>

    {/* KOLOM KANAN: Ringkasan Finansial & Logistik (Prioritas Utama di Mobile) */}
    <div className="w-full lg:w-[360px] lg:shrink-0 space-y-4 order-1 lg:order-2">
      <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3">
        {/* Ringkasan Subtotal, Ongkir, Grand Total, Sisa Tagihan */}
      </div>
      <div className="p-4 bg-white border border-slate-200/80 rounded-xl">
        {/* Alamat Pengiriman & Kurir/Resi */}
      </div>
    </div>

  </div>
</FullScreenModal>
```

### Pola C: Modal Tabel Data Transaksi (Hybrid Table & Mobile Cards)

Pada modal yang menampilkan daftar/tabel data bertransaksi (seperti Riwayat Transaksi POS, Daftar Nota Layanan, Pelunasan Piutang):
- **Desktop (`hidden md:block`):** Tampilkan tabel dengan kolom aksi bersegmentasi (Action Capsule) dengan pembeda warna tajam (Amber untuk tagihan piutang dengan nominal sisa, Slate/Indigo untuk layanan purna jual tukar/refund).
- **Mobile (`block md:hidden`):** Jangan paksa tabel horizontal 8 kolom! Tampilkan sebagai **Kartu Transaksi Interaktif (Mobile Cards)** dengan tombol aksi berukuran penuh ($\ge 42\text{px}$) di strip bawah kartu yang ramah jempol (*anti fat-finger*).

---

## 4. Anti-Patterns yang Wajib Dihindari

1. **The Floating Card Trap on Mobile (`fixed inset-0 p-4 max-h-[90vh]`):**
   Membuat modal melayang di tengah layar ponsel dengan padding luar `p-4` menyebabkan area konten terjepit, teks terpotong, dan mengabaikan *safe area* ponsel berponi.
2. **The Scroll-Chaining Trap (Nested `overflow-y-auto`):**
   Memasang `overflow-y-auto` pada kontainer di dalam `children` saat di mobile menyebabkan gestur sentuh tersangkut di sub-kontainer. Biarkan modal mengalir dalam satu scroll tunggal (`children` sudah memiliki `overflow-y-auto overscroll-contain`).
3. **The Buried CTA Trap:**
   Menaruh tombol penting seperti *Simpan*, *Chat WhatsApp*, atau *Tutup* di bagian paling bawah konten yang dapat di-scroll. Pengguna harus menggulir puluhan baris hanya untuk menemukan tombol aksi. Selalu tempatkan pada prop `footer`.
4. **The Async Null Pointer Trap (AGENTS.md):**
   Mengakses `order.id` langsung di dalam closure asynchronous `useEffect`. Selalu ekstrak ID secara sinkronus sebelum closure:
   ```tsx
   useEffect(() => {
     const orderId = order?.id
     if (!orderId) return
     async function fetchData() {
       await supabase.from('...').eq('order_id', orderId)
     }
     fetchData()
   }, [order?.id])
   ```
5. **The Naive Date Formatting Trap:**
   Menggunakan `.toLocaleString()` atau `.toLocaleDateString()` mentah. Selalu gunakan helper `formatDisplayDate(date, mode, timezone)` dari `@/lib/timeUtils.ts`.
6. **The Cramped Horizontal Table Trap on Mobile:**
   Memaksa tabel 8 kolom ditampilkan pada layar ponsel 360px. Kasir harus menggeser layar 500px ke kanan hanya untuk mencari tombol aksi. Gunakan teknik hybrid: tabel di desktop (`hidden md:block`), kartu interaktif di mobile (`block md:hidden`).
