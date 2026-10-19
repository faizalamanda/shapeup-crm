# Isolated Thermal Receipt Printing Architecture

## 1. Problem Statement & Incident Analysis
Pada pencetakan struk kasir POS via browser (khususnya tablet/ponsel Android menggunakan aplikasi perantara printer thermal seperti **RawBT**):
- Saat tombol **Cetak Receipt** ditekan di `ReceiptPreviewModal.tsx`, sistem sebelumnya memanggil `window.print()` langsung pada browser window utama.
- **Dampak yang Terjadi:**
  1. Header dialog modal (`Pratinjau Receipt`, dropdown `Thermal 58mm`, tombol silang `✕`) ikut tercetak di bagian atas kertas.
  2. Footer dialog modal (`Receipt berhasil dikirim ke printer.`, tombol `🖨️ Cetak Receipt`, tombol `Tutup`) ikut tercetak di bagian bawah kertas.
  3. Aplikasi RawBT menerima seluruh DOM layar yang dirender oleh Android Print Spooler dan merasterisasi seluruh kotak dialog modal sebagai gambar monokrom, menghasilkan struk yang kotor, memakan banyak kertas, dan tidak profesional.

---

## 2. Core Architecture: Isolated DOM via Hidden Iframe
Untuk menjamin hasil cetak struk murni tanpa artefak layar, ShapeUp CRM mengadopsi pola **Isolated Hidden Iframe** (pola serupa yang sukses diterapkan pada pencetakan label pengiriman pesanan).

### 2.1 Alur Kerja Cetak (Execution Pipeline)
```
Kasir Klik "Cetak Receipt"
           │
           ▼
getPrinterAdapter('system').print(receipt, paperSize)
           │
           ▼
printReceiptViaIframe(receipt, paperSize)
           │
           ├── 1. Get or Create Hidden <iframe> (#pos-thermal-print-iframe)
           │      (style: position:fixed; visibility:hidden; width:0; height:0)
           │
           ├── 2. generateReceiptHtml(receipt, paperSize)
           │      - Sanitasi HTML (escapeHtml)
           │      - Format Baris Item, Diskon, Pajak, Grand Total
           │      - CSS Khusus Thermal (@page { margin: 0; })
           │      - Lebar Efektif: 48mm (58mm) / 72mm (80mm)
           │
           ├── 3. iframeDoc.open() -> write(html) -> close()
           │
           ├── 4. Jeda 150-200ms (browser parse font & styles)
           │
           ▼
iframe.contentWindow.focus() + iframe.contentWindow.print()
           │
           ▼
Android Print Spooler / RawBT hanya menerima dokumen struk murni!
(Hasil cetak fisik bersih 100% tanpa header modal/tombol)
```

---

## 3. Kompensasi Area Cetak Thermal Fisik

Printer thermal roll memiliki batas fisik *printable width* pada print-head monokromnya:

| Ukuran Roll | Printable Width Efektif | Dots / Resolusi | Karakter per Baris | Aturan CSS Print |
| :--- | :--- | :--- | :--- | :--- |
| **58mm** | **48 mm** | 384 dots | ~32 char (font normal) | `@page { size: 58mm auto; margin: 0; }` Container: `48mm` |
| **80mm** | **72 mm** | 576 dots | ~48 char (font normal) | `@page { size: 80mm auto; margin: 0; }` Container: `72mm` |
| **A4** | **180 mm** | Standard | - | `@page { size: A4 portrait; margin: 15mm; }` Container: `100%` |

> **Penting:** Jika kontainer diatur persis `58mm` atau `80mm`, beberapa printer mini thermal akan memotong teks 3-5mm di sisi tepi kanan/kiri. Menetapkan lebar `48mm` untuk roll 58mm dan `72mm` untuk roll 80mm menjamin kompatibilitas 100% di semua merek printer thermal (POS-58, RPP02N, Zjiang, Epson, Star, Panda, dll).

---

## 4. Defense-in-Depth (@media print Fallback)
Meskipun pencetakan utama melalui hidden iframe, komponen `ReceiptPreviewModal.tsx` tetap dilengkapi perlindungan lapis ganda:
1. Kelas `.no-print` pada backdrop, header, dan footer kontrol.
2. Tag `<style>` dengan aturan `@media print`:
   ```css
   @media print {
     body * {
       visibility: hidden !important;
     }
     #thermal-receipt-container, #thermal-receipt-container * {
       visibility: visible !important;
     }
     #thermal-receipt-container {
       position: fixed !important;
       left: 0 !important;
       top: 0 !important;
       width: 48mm !important;
       margin: 0 !important;
       padding: 2mm !important;
       border: none !important;
       box-shadow: none !important;
     }
     .no-print {
       display: none !important;
     }
   }
   ```
Jika kasir tidak sengaja menekan pintasan keyboard browser (`Ctrl+P` / `Cmd+P`), modal chrome tetap tidak akan pernah tercetak ke atas kertas.
