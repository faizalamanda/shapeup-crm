# Mobile / PWA Full-screen Modal

Gunakan `FullScreenModal` dari `@/components/ui/FullScreenModal` sebagai shell untuk alur modal baru yang perlu fokus penuh di mobile/PWA. Pada mobile komponen ini selalu fullscreen. Pada desktop, ia menjadi card/modal terpusat secara default (`desktopSize="md"`). Komponen ini memakai portal, mengunci scroll halaman, menghormati safe area perangkat, dan menyediakan header, area konten yang dapat di-scroll, serta footer opsional.

Saat `isOpen` bernilai `true`, shell mendaftarkan satu history entry melalui `useModalBackHandler`. Back browser/perangkat menutup modal paling atas lebih dahulu; Escape menutup modal pada desktop. Jangan menambahkan `history.pushState`, listener `popstate`, atau penguncian `body.style.overflow` lagi di komponen pemakainya.

```tsx
<FullScreenModal
  isOpen={isEditorOpen}
  onClose={() => setIsEditorOpen(false)}
  title="Edit pelanggan"
  description="Perbarui informasi pelanggan"
  desktopSize="lg"
  footer={<div className="flex gap-2">...</div>}
>
  <CustomerForm />
</FullScreenModal>
```

Pilihan `desktopSize` adalah `sm`, `md` (default), `lg`, `xl`, dan `fullscreen`. Pilih berdasarkan kepadatan konten, bukan jenis halaman: `sm` untuk aksi singkat, `md` untuk form standar, `lg`/`xl` untuk detail atau tabel, dan `fullscreen` saat desktop juga membutuhkan workspace penuh.

Gunakan `children` hanya untuk konten fitur. Tombol simpan/batal yang perlu tetap terlihat ditempatkan pada `footer`. `onClose` harus mengubah state `isOpen` menjadi `false`; jangan memanggil `window.history.back()` secara manual. Untuk dialog kecil atau konfirmasi desktop, gunakan pola modal yang sesuai, bukan shell fullscreen ini.
