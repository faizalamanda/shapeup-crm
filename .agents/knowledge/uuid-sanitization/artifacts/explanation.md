# UUID Input Sanitization & PostgreSQL Strict-Type Guard

## 🚨 Root Cause Analysis: The Empty String Trap

PostgreSQL memiliki sistem pengetikan ketat (*strict typing*). Kolom bertipe data `UUID` (seperti `register_id`, `shift_id`, `customer_id`, dsb.) **hanya menerima** representasi UUID valid berformat 36 karakter (misal: `550e8400-e29b-41d4-a716-446655440000`) atau nilai `NULL`.

Jika menerima string kosong `""`:
```sql
-- Error fatal PostgreSQL
ERROR: invalid input syntax for type uuid: ""
```

### Jebakan Default Parameter JavaScript (ES6)
Banyak developer mengira destructuring dengan default value akan mengamankan nilai kosong:
```typescript
// ❌ JEBAKAN: Default value HANYA terpicu jika bernilai undefined!
const { register_id = null } = body

// Jika client mengirim: { register_id: "" }
// Maka nilai register_id tetap "" (bukan null)!
// Saat dimasukkan ke Supabase insert/update -> PostgreSQL CRASH!
```

---

## 🛡️ Solusi Dual-Layer (Client + Server)

### 1. Server-Side Guard (API Routes) — WAJIB
Setiap endpoint API yang menerima foreign key UUID opsional **WAJIB** menerapkan validasi regex UUID sebelum data dimasukkan ke query Supabase / database:

```typescript
// Helper standar UUID regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// Sanitasi sebelum kueri DB:
const cleanRegisterId = isUuid(register_id) ? register_id : null
const cleanShiftId = isUuid(shift_id) ? shift_id : null

// Gunakan cleanRegisterId untuk insert/update/filter
await supabase.from('pos_shifts').insert({
  business_id: businessId,
  user_id: user.id,
  register_id: cleanRegisterId, // Aman: menghasilkan NULL di PostgreSQL jika tidak valid/kosong
  // ...
})
```

### 2. Client-Side Guard (React Components) — WAJIB
Pada form atau modal, ketika sebuah pilihan relasi/register belum dipilih atau bernilai string kosong `""`:
```typescript
// ❌ JANGAN kirim string kosong
await fetch('/api/pos/shifts', {
  body: JSON.stringify({ register_id: registerId }) // jika registerId = '', backend menerima ''
})

// ✅ SELALU normalisasi menjadi null
await fetch('/api/pos/shifts', {
  body: JSON.stringify({ register_id: registerId || null })
})
```

---

## 📋 Checklist Penerapan pada Entity / Kolom UUID
Terapkan pola ini pada seluruh kolom relasi opsional di seluruh CRM:
- `orders.shift_id`
- `orders.register_id`
- `orders.customer_id`
- `pos_shifts.register_id`
- `stock_moves.source_id`
- `journal_transactions.source_id`
