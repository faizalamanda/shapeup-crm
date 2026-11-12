# Multi-Tenant POS Session & Business Context Isolation Architecture

## 1. Problem Statement & Root Cause Analysis

### Skenario Lapangan:
Pengguna memiliki lebih dari satu unit usaha (misalnya: `MITRA PRINTING KUDUS` dan `Mitra Printing 1`). Pengguna membuka sesi kasir (*shift*) di unit bisnis pertama, lalu berganti unit usaha di dashboard CRM dan membuka halaman kasir POS.

### Gejala Masalah:
1. **Sesi Kasir Antar Bisnis Muncul Bersama / Tercampur:**
   Di tabel *Riwayat Sesi Shift Kasir (Shift Ledger)*, sesi shift dari unit bisnis sebelumnya tampil bercampur di layar, seolah-olah data shift hanya difilter berdasarkan `user_id` yang sedang login dan mengabaikan unit bisnis yang sedang aktif.
2. **In-Memory Server Profile Cache Drift (30 Detik):**
   Fungsi `getApiContext()` di `@/lib/apiContext.ts` meng-cache `activeBusinessId` di memori server Node.js selama 30 detik (`PROFILE_CACHE_TTL = 30_000`). Jika pengguna beralih unit bisnis di frontend, panggilan API dalam jendela 30 detik tersebut masih menyelesaikan `businessId` lama jika API tidak menyertakan parameter bisnis eksplisit.
3. **L2 SessionStorage Cache Key Collision:**
   Komponen `POSHub.tsx` menerapkan caching instan (*0ms hydration*) di `sessionStorage`. Saat komponen pertama kali di-mount sebelum `activeBusiness` selesai di-resolve dari React Context, fungsi cache menggunakan fallback key `'su_pos_hub_v2_default'`. Akibatnya, cache sesi dari unit bisnis A sempat termuat dan tertimpa saat beralih ke unit bisnis B.
4. **Ketiadaan Parameter Bisnis Eksplisit:**
   Endpoint kasir (`/api/pos/shifts?mode=hub`) dan form buka shift (`action: open`) sebelumnya tidak mengirimkan `business_id` dari state frontend, melainkan sepenuhnya bergantung pada resolusi pasif profil server.

---

## 2. Arsitektur Solusi & Standar Implementasi

### 2.1 Explicit Business ID & Zero-Drift Server Resolution (`lib/apiContext.ts`)
Setiap API route yang membutuhkan auth dan konteks bisnis kini menerima objek request `getApiContext({ req })` atau override `requestedBusinessId`:

```typescript
export async function getApiContext(options?: {
  requireBusiness?: boolean
  existingSupabase?: SupabaseClient
  req?: Request
  requestedBusinessId?: string
}): Promise<ApiContextResult>
```

Alur kerja resolusi:
1. Mengekstrak `candidate` ID bisnis dari parameter `requestedBusinessId`, query param `?business_id=...`, atau header HTTP `x-business-id`.
2. **0ms Fast-Path RAM Hit:** Jika `reqBizId` sama dengan profil aktif di memori server, sistem langsung mengembalikan konteks dalam **0ms**.
3. **In-Memory Permission Cache (`userBizAccessCache` TTL 60s):** Jika `reqBizId` berbeda (misal pengguna baru saja berpindah cabang), izin kepemilikan/penugasan staf diverifikasi sekali via primary key index database, lalu di-cache di RAM server selama 60 detik. Request kasir berikutnya langsung dilayani dalam **0ms** dari memori RAM.
4. Jika tidak ada parameter eksplisit, fallback ke `profileCache` profil aktif seperti biasa.

### 2.2 Client-to-Server Attribution di Modul Kasir (`app/pos/components/POSHub.tsx`)
1. **Query & Paginasi Shift:**
   ```typescript
   const bizParam = `&business_id=${activeBusiness.id}`
   const res = await fetch(`/api/pos/shifts?mode=hub&limit=15&offset=0${statusParam}${cashierParam}${bizParam}`, {
     headers: { 'x-business-id': activeBusiness.id }
   })
   ```
2. **Buka & Tutup Shift:**
   Form pembukaan dan penutupan shift menyertakan `business_id: activeBusiness.id` secara eksplisit pada payload JSON dan header request.
3. **Isolasi L2 SessionStorage Cache:**
   Dilarang keras menggunakan fallback key `'default'`. Cache hanya ditulis dan dibaca jika `businessId` terdefinisi secara valid:
   ```typescript
   function readHubCache(businessId?: string): POSHubCacheEntry | null {
     if (typeof window === 'undefined' || !businessId) return null
     try {
       const raw = sessionStorage.getItem(`su_pos_hub_v2_${businessId}`)
       if (!raw) return null
       // ... parse & TTL check
     } catch {
       return null
     }
   }
   ```

### 2.3 Immediate Cache Invalidation on Business Switch (`components/UserContext.tsx`)
Ketika pengguna mengklik unit bisnis lain di CRM (`handleSwitchBusiness`), sistem mengeksekusi pembersihan cache ganda:
```typescript
// 1. Bersihkan localStorage POS & Dashboard
keysToRemove.push(key) // su_pos_, su_dash_

// 2. Bersihkan sessionStorage POS seketika
for (let i = 0; i < sessionStorage.length; i++) {
  const key = sessionStorage.key(i)
  if (key && (key.startsWith('su_pos_') || key.startsWith('su_dash_'))) {
    sessionStorage.removeItem(key)
  }
}

// 3. Invalidate server in-memory profile and permission cache
invalidateProfileCache(userId)
```

---

## 3. Matriks Integritas Multi-Bisnis POS

| Lapisan Sistem | Mekanisme Perlindungan | Latensi / Performa |
| :--- | :--- | :--- |
| **Client UI (`POSHub.tsx`)** | Filter eksplisit per `activeBusiness.id`, cache laci kasir terisolasi per ID unit | 0ms Instant Hydration |
| **Network Transport** | Query param `?business_id=...` + Header `x-business-id` | Standar HTTP |
| **API Context (`apiContext.ts`)** | `userBizAccessCache` (TTL 60s) + `cached.activeBusinessId === reqBizId` | 0ms Fast-Path (RAM) |
| **Database RLS & Query** | Query bersyarat `.eq('business_id', businessId)` di seluruh aksi shift | Terindeks Primary Key B-Tree |

