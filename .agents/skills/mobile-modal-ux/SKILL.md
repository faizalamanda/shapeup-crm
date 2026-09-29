---
name: "mobile-modal-ux"
description: "Create or update full-screen mobile/PWA modal flows using the shared ShapeUp CRM shell and its Back-button behavior. Use for feature dialogs that require a dedicated mobile screen."
---

# Mobile Modal UX — ShapeUp CRM

Untuk modal baru yang berfungsi sebagai layar fokus di mobile/PWA, gunakan `FullScreenModal` dari `@/components/ui/FullScreenModal` sebagai outer shell. Mobile selalu fullscreen; desktop menggunakan card `md` secara default. Atur `desktopSize` menjadi `sm`, `md`, `lg`, `xl`, atau `fullscreen` sesuai kepadatan konten. Letakkan konten fitur pada `children` dan aksi yang harus tetap terlihat pada `footer`.

`FullScreenModal` sudah menangani portal, `aria-modal`, fokus awal, body-scroll lock, safe-area viewport, Escape desktop, serta history Back LIFO melalui `useModalBackHandler`. Berikan `isOpen` dan `onClose` yang mengubah state menjadi tertutup. Jangan menambah `createPortal`, listener `popstate`, `history.pushState`, atau body scroll lock di pemakai.

Untuk contoh dan batasan pemakaian, baca [knowledge mobile modal UX](../../knowledge/mobile-modal-ux.md). Modal ringkas seperti konfirmasi kecil tidak perlu dipaksa menggunakan shell fullscreen.
