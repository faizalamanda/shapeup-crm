---
name: "page-layout-ux"
description: "Create or update ShapeUp CRM feature pages with the shared PageLayout, responsive content widths, and Back navigation that yields to active modals."
---

# Page Layout UX — ShapeUp CRM

Gunakan `PageLayout` dari `@/components/ui/PageLayout` sebagai shell halaman fitur baru. Berikan `title`; gunakan `description`, `actions`, dan `footer` hanya ketika membantu alur utama. Pilih `width` berdasarkan kepadatan konten: `md` untuk form, `xl` untuk halaman data, dan `full` hanya untuk workspace/tabel yang membutuhkan lebar penuh.

Jangan membuat listener `popstate`, `history.pushState`, atau logika Back sendiri pada halaman. `useMobileBackToHome` menangani Back perangkat/browser sekali pada application layout: desktop mengikuti history normal, sedangkan mobile/PWA kembali ke `/onboarding`. Tombol Back `PageLayout` menggunakan aturan yang sama.

Modal standar selalu memiliki prioritas Back. Saat sebuah modal aktif, Back wajib menutup modal teratas sebelum halaman berpindah. Gunakan `FullScreenModal` untuk alur modal mobile/PWA dan jangan menambahkan penanganan Back kedua di halaman.

Untuk API, contoh, dan rekomendasi UX terkait loading, empty state, error recovery, serta preservation state, baca [knowledge page layout UX](../../knowledge/page-layout-ux.md).
