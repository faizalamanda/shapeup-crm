# Tenant Ownership vs Functional RBAC & Staff Multi-Business Isolation

## 1. Problem Statement & Root Cause Analysis

### Skenario Lapangan:
Pemilik bisnis memiliki lebih dari satu unit usaha (misalnya: `SRJ FASHION 1` dan `SRJ FASHION 2`), kemudian mendaftarkan anggota tim (staf) yang sama menggunakan satu alamat email ke kedua unit bisnis tersebut.

### Gejala Masalah:
1. **Dropdown Bisnis Tidak Lengkap:** Ketika staf login, dropdown unit bisnis di navigasi hanya menampilkan 1 unit bisnis saja, padahal di database tabel `business_staff` staf tersebut telah terdaftar di kedua unit bisnis.
2. **PostgREST Join Masking (Silent Suppression):** 
   Kueri `business_staff.select('role, permissions, businesses (*)')` mengeksekusi *nested join* ke tabel `public.businesses`. PostgREST menerapkan aturan Row Level Security (RLS) pada tabel yang di-*join*. Karena tabel `businesses` sebelumnya hanya mengizinkan `SELECT` untuk `owner_id = auth.uid()`, PostgREST **tidak melempar error**, melainkan mengembalikan field `businesses: null` untuk baris bisnis yang bukan milik pengguna tersebut. Akibatnya, pemetaan `bizMap.set(item.businesses.id, ...)` mendrop unit bisnis tersebut secara diam-diam.
3. **Pemisahan Peran:** Staf dapat ditugaskan dengan `role: 'admin'` (misal: Kepala Toko atau Admin Keuangan Cabang). Wewenang administratif di cabang ini sering kali salah diasumsikan sebagai akun Pemilik Utama (*User Utama*), sehingga tombol pembuatan bisnis baru sempat terbuka untuk staf.

---

## 2. Pemisahan Konsep: Tenant Ownership vs Functional RBAC

Sistem ShapeUp CRM membedakan secara tegas antara **Kepemilikan Tenant (Tenant Ownership)** dan **Peran Operasional Unit Bisnis (Functional RBAC)**:

| Aspek | Tenant Owner (`isOwner: true`) | Delegated Staff (`isOwner: false`) |
| :--- | :--- | :--- |
| **Definisi** | Pengguna yang membuat dan memiliki akun/unit bisnis (`businesses.owner_id = user.id`), atau pendaftar baru yang belum ditugaskan. | Pengguna yang diundang/didaftarkan ke dalam unit bisnis milik orang lain via tabel `business_staff`. |
| **Functional Role** | Otomatis memiliki wewenang `'admin'` penuh di seluruh unit miliknya. | Dapat memiliki role `'admin'`, `'cashier'`, atau `'staff'` sesuai penugasan per cabang. |
| **Dropdown Bisnis** | Menampilkan semua unit bisnis yang dimilikinya. | Menampilkan **semua** unit bisnis tempat ia ditugaskan sebagai staf. |
| **Hak Membuat Bisnis** | **Diizinkan** (`POST /api/business`). | **Dilarang Keras** (HTTP 403 Forbidden). |
| **Pengelolaan Profil Bisnis** | Berhak mengubah nama bisnis, menghapus unit, atau menambah cabang. | Jika `role === 'admin'`, hanya berhak mengedit data operasional cabang aktif (telepon, alamat, printer) tanpa hak menambah unit. |

---

## 3. Database RLS Standards for Multi-Tenant Junctions

### 3.1. RLS Policy pada Parent Table (`public.businesses`)
Setiap tabel induk yang direlasikan melalui junction table staf wajib mengizinkan operasi `SELECT` bagi pengguna yang terdaftar di junction table:

```sql
-- Izinkan staf membaca metadata unit bisnis tempat mereka ditugaskan
DROP POLICY IF EXISTS "Staff can view assigned businesses" ON public.businesses;
CREATE POLICY "Staff can view assigned businesses" ON public.businesses
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_staff
            WHERE business_staff.business_id = businesses.id
              AND business_staff.profile_id = auth.uid()
        )
    );
```

### 3.2. Hardening RPC Database `SECURITY DEFINER`
Fungsi analitik dan pelaporan yang menggunakan flag `SECURITY DEFINER` berjalan dengan hak akses superuser dan melewati aturan RLS standar. Oleh karena itu, fungsi-fungsi ini **WAJIB** memiliki klausul otorisasi multi-tenant di baris paling awal:

```sql
-- Multi-Tenant Security Guard Clause
IF NOT EXISTS (
  SELECT 1 FROM public.business_staff 
  WHERE business_id = p_business_id AND profile_id = auth.uid()
  UNION
  SELECT 1 FROM public.businesses 
  WHERE id = p_business_id AND owner_id = auth.uid()
) THEN
  RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki akses ke unit bisnis ini.';
END IF;
```
Fungsi yang telah diamankan:
- `public.get_inventory_summary_metrics(p_business_id, ...)`
- `public.get_product_retention_flow(p_business_id, ...)`

---

## 4. Resilient Client Fallback Pattern (`lib/userBusinessHelper.ts`)

Untuk menjamin ketersediaan antarmuka bahkan jika terjadi jeda revalidasi skema RLS di PostgREST:

```typescript
// Deteksi apakah ada penugasan staf yang detail bisnisnya ter-mask null oleh RLS
const hasMissingJoinedBiz = bsRes.data?.some((item: any) => !item.businesses && item.business_id)

if (hasMissingJoinedBiz && typeof window !== 'undefined') {
  try {
    const res = await fetch('/api/business')
    if (res.ok) {
      const json = await res.json()
      if (json.businesses && Array.isArray(json.businesses)) {
        json.businesses.forEach((b: any) => bizMap.set(b.id, b))
      }
      if (typeof json.isOwner === 'boolean') {
        isOwner = json.isOwner
      }
    }
  } catch (e) {
    // Fail-safe: abaikan kegagalan jaringan, gunakan data yang berhasil dimuat
  }
}
```

Endpoint `GET /api/business` menggunakan `supabaseAdmin` di server untuk memverifikasi `user.id` yang sah dan mengembalikan daftar unit bisnis lengkap beserta penanda kepemilikan `isOwner`.

---

## 5. Defense-in-Depth Pembuatan Unit Bisnis

Proteksi hak pembuatan cabang bisnis diterapkan dalam 3 lapis pertahanan (*Defense-in-Depth*):

### Lapis 1: Navigasi Dropdown (`app/layout.tsx`)
```tsx
{/* Tombol Buat Bisnis Baru HANYA untuk User Utama */}
{isOwner && (
  <>
    <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
    <Link href="/settings/business?create=true">
      ➕ Buat Bisnis Baru
    </Link>
  </>
)}

{/* Kelola Bisnis terbuka untuk Pemilik atau Admin Cabang */}
{(isOwner || currentUserRole === 'admin') && (
  <>
    {!isOwner && <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />}
    <Link href="/settings/business">
      ⚙️ Kelola Bisnis
    </Link>
  </>
)}
```

### Lapis 2: Halaman Pengaturan Bisnis (`app/settings/business/page.tsx`)
- Tombol `+ Tambah Unit Bisnis Baru` hanya dirender jika `isOwner === true`.
- Parameter URL `?create=true` otomatis diabaikan jika `isOwner === false`.
- Fungsi `handleCreate()` memiliki pengecekan eksplisit di sisi klien:
  ```typescript
  if (!isOwner) {
    alert("Hanya Pengguna Utama (Pemilik Bisnis) yang memiliki wewenang untuk membuat unit bisnis baru.")
    setIsCreating(false)
    return
  }
  ```

### Lapis 3: Backend API Validation (`POST /api/business`)
Server memvalidasi apakah pengguna memiliki bisnis sendiri atau merupakan staf murni:
```typescript
const [ownedRes, staffRes] = await Promise.all([
  supabaseAdmin.from('businesses').select('id').eq('owner_id', user.id).limit(1),
  supabaseAdmin.from('business_staff').select('id').eq('profile_id', user.id).limit(1)
])

const isOwner = Boolean(ownedRes.data && ownedRes.data.length > 0)
const isStaff = Boolean(staffRes.data && staffRes.data.length > 0)

if (!isOwner && isStaff) {
  return NextResponse.json(
    { error: "Hanya Pengguna Utama (Pemilik Bisnis) yang memiliki wewenang untuk membuat unit bisnis baru." },
    { status: 403 }
  )
}
```

---

## 6. Verifikasi & Checklist Pengujian

Setiap kali melakukan perubahan pada modul otentikasi atau relasi multi-bisnis:
1. [x] Staf yang terdaftar di $N$ unit bisnis dapat melihat seluruh $N$ unit bisnis di dropdown navigasi.
2. [x] Pergantian unit bisnis (`active_business_id`) berjalan lancar bagi staf di semua unit bisnis tersebut.
3. [x] Tombol `➕ Buat Bisnis Baru` tersembunyi bagi staf (bahkan staf dengan role fungsional `'admin'`).
4. [x] Permintaan langsung `POST /api/business` dari akun staf ditolak dengan respon HTTP `403 Forbidden`.
5. [x] User Utama (pemilik bisnis) tetap dapat melihat semua unit usahanya, membuat cabang baru, dan mengelola seluruh unit tanpa hambatan.
6. [x] RPC analitik berstatus `SECURITY DEFINER` menolak eksekusi jika `p_business_id` tidak berelasi dengan `auth.uid()`.
