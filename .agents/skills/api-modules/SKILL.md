---
name: "API Modular Architecture"
description: "Arsitektur modul reusable untuk semua API routes: auth context, guest customer, ledger, HPP, loyalty, inventory, journal. Gunakan skill ini saat membuat atau memodifikasi API route apapun."
---

# API Modular Architecture — ShapeUp CRM

## 🏗️ Modul-Modul Reusable

Semua API route **WAJIB** menggunakan modul-modul berikut. Jangan duplikasi kode — satu berubah, otomatis berubah semua.

---

### 1. `lib/apiContext.ts` — Auth + Business Context

**SELALU** gunakan ini di awal setiap API route yang butuh auth + business ID.

```typescript
import { getApiContext } from '@/lib/apiContext'

export async function POST(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error  // Returns NextResponse 401/400
  const { user, businessId, supabase, supabaseAdmin } = ctx
  // ... business logic
}
```

**Fitur:**
- JWT fast-path (tanpa network call jika token valid, ~0-5ms)
- In-memory profile cache (30s TTL)
- Singleton admin client (tidak buat baru setiap request)
- Discriminated union return type (type-safe error handling)

**Dipakai di:** POS, Invoice, Purchases, Expenses, Customers, Staff, Pipeline, Integrations, dll.

**JANGAN lakukan ini lagi:**
```typescript
// ❌ JANGAN — boilerplate lama
const supabase = await createClient()
const { user, error: authErr } = await getAuthUser(supabase)
if (authErr || !user) return ...
const { data: profile } = await supabase.from('profiles').select('active_business_id')...
```

---

### 2. `lib/guestCustomer.ts` — Guest Customer Resolution

Gunakan saat perlu resolve "Customer Tamu" (walk-in) di POS.

```typescript
import { resolveGuestCustomerId } from '@/lib/guestCustomer'

const guestId = await resolveGuestCustomerId(businessId, supabaseAdmin)
```

**Fitur:**
- In-memory cache per business (5 menit TTL)
- Single-flight deduplication (2 request bersamaan → 1 DB call)
- Auto-create jika belum ada

---

### 3. `lib/orderLedger.ts` — Order Ledger Sync (Sales)

Modul utama untuk sinkronisasi order ke jurnal akuntansi + stok + loyalty.

```typescript
import { syncOrderToLedger } from '@/lib/orderLedger'

const syncRes = await syncOrderToLedger(orderId, supabase, preloadedOrder)
```

**Dipakai di:**
- `app/api/pos/order/route.ts` — POS checkout
- `app/api/orders/invoices/route.ts` — Invoice creation
- `app/api/orders/invoices/[id]/route.ts` — Invoice update
- `app/api/orders/invoices/[id]/payment/route.ts` — Invoice payment
- `app/api/webhook/woo/process-queue/route.ts` — WooCommerce webhook
- `app/api/webhook/woo/sync-ledger/route.ts` — Manual ledger sync
- `lib/integrations/accurate/syncService.ts` — Accurate sync

**Sub-modul yang digunakan:**
- `lib/accountHelper.ts` — COA account resolution (cached)
- `lib/inventoryHelper.ts` — Stock movement + product matching
- `lib/hppHelper.ts` — Itemized HPP journal lines
- `lib/recipeHelper.ts` — Recipe/BOM-based HPP calculation (cached 60s)
- `lib/journalHelper.ts` — Transaction + journal_lines posting
- `plugins/loyalty/helpers/loyaltyApi.ts` — Loyalty points (cached settings)

---

### 4. `lib/accountHelper.ts` — COA Account Resolution (Sales)

```typescript
import { getOrCreateDefaultAccounts } from '@/lib/accountHelper'
const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)
// accountMap['101000'] = Kas POS UUID
// accountMap['401000'] = Pendapatan UUID
// etc.
```

**Cached:** Setelah call pertama per business, langsung return dari memory.

---

### 5. `lib/expenseLedger.ts` — COA Account Resolution (Expenses/Purchases)

```typescript
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
const accountMap = await ensureExpenseAccounts(businessId, supabase)
// accountMap['201000'] = Hutang Usaha UUID
// accountMap['503000'] = Beban Operasional UUID
```

**Cached:** Setelah call pertama per business, langsung return dari memory.

**Dipakai di:** `purchases/route.ts`, `expenses/route.ts`, `expenses/[id]/pay/route.ts`, dll.

---

### 6. `lib/journalHelper.ts` — Journal Transaction Posting

```typescript
import { postJournalTransaction } from '@/lib/journalHelper'

await postJournalTransaction(
  businessId, orderId, date, description, journalLines, supabase,
  skipExistingCheck  // true for new orders, false for updates/resync
)
```

**Fitur:**
- Idempotency: cek existing transaction sebelum insert (bisa di-skip untuk new order)
- Self-healing: partial commit (header tanpa lines) otomatis diperbaiki
- Dipakai oleh `orderLedger.ts` dan `pos/shifts/route.ts`

---

### 7. `lib/recipeHelper.ts` — HPP/BOM Calculation

```typescript
import { calculateProductsHppBatch, invalidateHppCache } from '@/lib/recipeHelper'

const hppMap = await calculateProductsHppBatch(productIds, supabase)
// hppMap.get(productId) → { isVariable, unitHpp, ingredients }
```

**Cached:** 60 detik TTL. Panggil `invalidateHppCache()` saat recipe/ingredient berubah.

---

### 8. `plugins/loyalty/helpers/loyaltyApi.ts` — Loyalty Points

```typescript
import { earnPointsForOrder, invalidateLoyaltySettingsCache } from '@/plugins/loyalty/helpers/loyaltyApi'

// Auto-skip jika loyalty tidak aktif (cached settings, ~0ms)
await earnPointsForOrder(supabase, { businessId, customerId, orderId, orderAmount, orderNumber })
```

**Cache:** `fetchLoyaltySettings()` cached 60s. Jika loyalty off → 0ms (no DB query).
**Invalidation:** `upsertLoyaltySettings()` otomatis invalidate cache.

---

## ⚡ Performance Rules

1. **Auth:** `getApiContext()` uses JWT fast-path → ~0-5ms (no network call to Supabase Auth)
2. **Profile:** Cached 30 detik → setelah call pertama, 0ms
3. **Guest Customer:** Cached 5 menit → setelah call pertama, 0ms
4. **HPP/Recipe:** Cached 60 detik → setelah call pertama, 0ms
5. **Loyalty Settings:** Cached 60 detik → jika off, 0ms (no DB query)
6. **Accounts (COA):** Cached selamanya per process → setelah call pertama, 0ms
7. **Parallelisasi:** Di `orderLedger.ts`, accounts + integration config di-fetch via `Promise.all`
8. **HPP sharing:** `calculateProductsHppBatch` dipanggil 1x di `syncOrderToLedger`, hasilnya di-share ke `applyStockMovement` dan `generateItemizedHppJournalLines`
9. **Batch Stock & Cost Updates:** Di `purchases/route.ts` dan `expenses/route.ts`, pembaruan stok & WAC HPP dilakukan secara agregat (batch `.in('id', productIds)`) dan dieksekusi secara paralel (`Promise.all`) untuk menghindari *N+1 query bottleneck*.
10. **Immediate Frontend Fetching:** Pemuatan data utama halaman (seperti `fetchPurchases`) dilakukan seketika di *mount* tanpa menunggu resolution profile *client-side*, karena API route sudah menangani otentikasi via cookie `getApiContext()`.

## 🔗 Dependency Graph

```
API Route (POS/Invoice/Webhook/etc.)
  ├── lib/apiContext.ts          → Auth + Business ID
  ├── lib/guestCustomer.ts       → Guest customer (POS only)
  └── lib/orderLedger.ts         → Main orchestrator
        ├── lib/accountHelper.ts    → COA accounts
        ├── lib/inventoryHelper.ts  → Stock + product matching
        │     └── lib/recipeHelper.ts → HPP batch (cached)
        ├── lib/hppHelper.ts        → HPP journal lines
        │     └── lib/recipeHelper.ts → (reuses shared map)
        ├── lib/journalHelper.ts    → Transaction + lines
        └── plugins/loyalty/        → Points (cached settings)
```

## ⚠️ Cache Invalidation Rules

| Cache | TTL | Invalidate When |
|-------|-----|-----------------|
| Profile (apiContext) | 30s | `invalidateProfileCache(userId)` — saat switch business |
| Guest Customer | 5min | `invalidateGuestCache(businessId)` — jarang perlu |
| Accounts (COA) | Forever | Restart server — jarang berubah |
| Integration Config | 60s | Auto-expire |
| HPP/Recipe Batch | 60s | `invalidateHppCache()` — saat recipe diubah |
| Loyalty Settings | 60s | Auto on `upsertLoyaltySettings()` |
