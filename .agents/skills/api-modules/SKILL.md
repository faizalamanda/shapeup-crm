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

### 1b. `lib/userBusinessHelper.ts` — Unified User & Business Fetching

Gunakan modul tunggal ini baik di *client-side* (`UserContext.tsx`, `settings/business/page.tsx`) maupun *server-side* ketika ingin mendapatkan profil user + daftar bisnis (assigned + owned) + unit bisnis aktif + role & permissions serta status kepemilikan tenant (`isOwner`) dalam 1 *call* paralel.

```typescript
import { fetchUserBusinessContext } from '@/lib/userBusinessHelper'

const {
  userProfile,
  businesses,
  activeBusiness,
  activeBusinessId,
  currentUserRole,
  currentUserPermissions,
  isOwner
} = await fetchUserBusinessContext(userId, supabase)
```

**Konsep Kunci: Tenant Ownership vs Functional RBAC:**
1. **`isOwner: boolean` (Account/Tenant Owner):**
   - Bernilai `true` HANYA JIKA user memiliki minimal 1 baris di tabel `businesses` (`businesses.owner_id = user.id`).
   - Bernilai `false` jika user murni didaftarkan sebagai anggota tim / staf di `business_staff` milik orang lain.
   - Pembeda tegas: Staf yang diberi `role = 'admin'` di unit bisnis tetap memiliki `isOwner: false`. Hak membuat cabang bisnis baru (`POST /api/business`) dan tombol UI `➕ Buat Bisnis Baru` wajib dikunci secara eksklusif dengan `isOwner`.
2. **PostgREST Join RLS & Resilient Fallback:**
   - Kueri `business_staff.select('..., businesses (*)')` mengevaluasi RLS pada tabel `businesses`. Jika RLS memblokir, PostgREST mengembalikan `businesses: null` secara diam-diam tanpa error.
   - Database wajib memiliki policy RLS:
     ```sql
     CREATE POLICY "Staff can view assigned businesses" ON public.businesses
       FOR SELECT TO authenticated
       USING (EXISTS (SELECT 1 FROM public.business_staff WHERE business_staff.business_id = businesses.id AND business_staff.profile_id = auth.uid()));
     ```
   - Sebagai proteksi ganda (*resilient client fallback*), jika `fetchUserBusinessContext` mendeteksi adanya `business_id` namun relasi `businesses` bernilai null (misal sebelum schema reload), fungsi secara otomatis memanggil `/api/business` (server endpoint berbasis `supabaseAdmin`) untuk memastikan seluruh unit bisnis staf tetap tampil utuh di dropdown.

---

### 1c. `app/auth/actions.ts` — Auth & Password Lifecycle (Forgot & Reset Password)

Modul terpusat untuk alur otentikasi dan pemulihan akun berbasis Supabase Auth dan Next.js Server Actions.

```typescript
import { loginAction, registerAction, forgotPasswordAction, resetPasswordAction, logoutAction } from '@/app/auth/actions'
```

1. **`forgotPasswordAction(formData)`:**
   - Menerima `email`, men-trim dan me-lowercase.
   - Menyelesaikan *origin* secara dinamis dari request headers (`x-forwarded-host`, `x-forwarded-proto`) dengan *fallback* ke `NEXT_PUBLIC_SITE_URL` agar valid di semua environment (localhost, preview, domain kustom).
   - Memanggil `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` })`. Tautan diarahkan **langsung** ke `/reset-password` karena alur recovery Supabase menyematkan token dalam bentuk *hash fragment* (`#access_token=...&type=recovery`) yang hanya bisa dibaca di sisi klien browser (tidak dikirim ke server HTTP).
   - Mengembalikan `{ success: true }`, `{ success: true, alreadySent: true }` (jika terkena rate limit 60 detik Supabase), atau `{ error: string }`.

2. **`resetPasswordAction(formData)`:**
   - Menerima `password` dan `confirmPassword`.
   - Validasi panjang minimal 6 karakter dan kecocokan password.
   - Memperbarui kata sandi pengguna via `supabase.auth.updateUser({ password })`.

3. **Supabase Callback & Token Resolution (`app/auth/callback/route.ts` & `app/reset-password/page.tsx`):**
   - **Callback Route (`app/auth/callback/route.ts`):** Jika ada token `code` PKCE, tukar via `exchangeCodeForSession(code)`. Jika tidak ada `code` namun parameter `next` mengarah ke `/reset-password` (misal tautan email lama), teruskan pengalihan (*forward redirect*) langsung ke `${targetOrigin}${next}` agar browser tetap mempertahankan *hash fragment* token.
   - **Instant Client Token Extraction (`app/reset-password/page.tsx`):** Komponen membaca `window.location.hash` secara langsung, mengekstrak `access_token` & `refresh_token`, dan segera memanggil `supabase.auth.setSession(...)` secara sinkron/instan tanpa bergantung pada jeda *listener*.

4. **Middleware & Client Isolation Rules (`middleware.ts` & `UserContext.tsx`):**
   - `/forgot-password` terdaftar di `isAuthRoute` (pengguna yang sudah login otomatis dialihkan ke dashboard/onboarding).
   - `/reset-password` **DILARANG KERAS** dimasukkan ke `isAuthRoute` (karena sesi pemulihan baru saja ditukar dari email; jika masuk `isAuthRoute`, user akan ditendang ke dashboard sebelum sempat mengisi password baru) dan **DILARANG** dimasukkan ke `isProtectedRoute` (agar token/kode dapat diverifikasi terlebih dahulu di sisi client/server).
   - Di `UserContext.tsx`, `isPublicRoute` wajib menggunakan `.startsWith()` (`currentPath.startsWith('/forgot-password')`, `currentPath.startsWith('/reset-password')`, `currentPath.startsWith('/auth')`) agar query parameter atau sub-path tidak memicu *redirect* ke halaman login.

5. **Email Operation Protocol & Anti-Rate Limit Standard (`lib/supabaseServer.ts` & `lib/supabase.ts`):**
   - **Handshake SMTP Latency:** Pengiriman email di Supabase (`/recover`, `/signup`, `/otp`, `/invite`, `/resend`, `/magiclink`) berjalan *synchronous* dengan server relay SMTP (~4–5 detik).
   - **Ekstraksi URL Robust:** Gunakan helper `getUrlString(url)` yang memeriksa `url.url` jika parameter berupa instance `Request` agar tidak terkonversi menjadi `"[object Request]"`.
   - **Timeout Khusus 15 Detik:** Batas timeout dinaikkan ke **15.000 ms (15 detik)** khusus untuk mutasi email agar request tidak di-abort sebelum email selesai dikirim.
   - **Zero-Retry (`maxRetries = 0`):** Operasi mutasi email **DILARANG KERAS** menggunakan *auto-retry*. Percobaan ulang otomatis saat request pertama sedang diproses akan langsung memicu error 429 (`over_email_send_rate_limit: For security purposes, you can only request this once every 60 seconds`).
   - **Form Locking & Progressive UX:** Kolom `<input>` dan `<button>` langsung dikunci (`disabled={loading}`) seketika formulir dikirim, dilindungi oleh `isSubmittingRef.current = true`. Tampilkan umpan balik progresif (*"Mengirim Tautan..."* -> *"Menghubungkan ke email..."*) agar pengguna tidak merasa sistem *hang*.
   - **Graceful Rate Limit Presentation:** Jika Supabase mengembalikan *rate limit* 60 detik, tangani secara anggun sebagai konfirmasi sukses bahwa tautan sudah dikirim (`alreadySent: true`) dengan timer mundur 60 detik sebelum tombol kirim ulang aktif, bukan menampilkan error merah yang membingungkan.

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

**Aturan Default Pengaturan Bisnis Baru & Trigger Stok:**
- **Default Bisnis Baru:** `global_stock_reduction_status = ['shipped', 'completed']`, `global_journal_hpp_status = ['shipped', 'completed']`, `global_default_hpp_percentage = 0%`.
- **Strict Setting-Driven:** Pengurangan stok (`applyStockMovement`) dan HPP Journal Lines **TIDAK BOLEH** di-override dengan hardcoded fallback seperti `status === 'completed'`. Selalu patuhi `stockReductionStatuses.includes(status)` dan `journalHppStatuses.includes(status)` dari setting database.
- **Unified Sales & HPP Journal Trigger & Date Basis (`journalHppStatuses`):**
  - **Single Source of Truth:** Setting No. 2 (`journal_hpp_status` / `global_journal_hpp_status`) mengendalikan kapan jurnal penjualan & HPP diterbitkan serta penanggalan transaksinya (Setting No. 4 yang redundant telah dihapus).
  - **Dynamic Dating:** Jika konfigurasi mencakup status operasional (`'processing'`, `'shipped'`, `'completed'`), transaksi jurnal dicatat pada tanggal/jam kejadian operasional (`paymentDate` / `orderMoveDate` / `updated_at`). Jika hanya mencakup status awal (`'pending'`), jurnal dicatat pada waktu checkout pemesanan (`order_date_utc` / `order_date`).
  - **Flexible Multi-Select & Single-Select:** Pengguna bebas memilih hanya satu status (misal hanya `Processing` atau hanya `Completed`) atau beberapa status; sistem di `syncOrderToLedger()` secara pintar mengecek status dan mencegah duplikasi (*zero duplicate*) berkat idempotensi `salesTx`.


**Aturan Siklus Hidup Pembayaran (Two-Dimensional Lifecycle & Omnichannel Settlement):**
- **Two-Dimensional Separation:** Pisahkan status logistik (`orders.status`: `pending`, `processing`, `shipped`, `completed`) dari status keuangan (`orders.payment_status`: `unpaid`, `partial`, `paid`). Jangan pernah mengasumsikan pesanan baru lunas jika `status === 'completed'`.
- **Settlement Non-COD vs COD:**
  - *Non-COD (Transfer Bank, Gateway, QRIS, Kartu Kredit):* Pelanggan membayar di muka. Saat pesanan `processing`, `shipped`, `completed`, atau memiliki `date_paid`, status pembayarannya adalah `'paid'`, piutang nol (`amount_paid = grand_total`), dan kas diakui seketika di jurnal.
  - *COD (Bayar di Tempat):* Saat `processing` atau `shipped`, status pembayaran adalah `'unpaid'` dan mencatat Piutang COD (`103000`). Status baru berubah menjadi `'paid'` setelah pesanan `completed` (kurir menyetor dana).
- **Auto-Sync to `order_payments`:** Setiap pesanan non-COD yang terbayar otomatis dijamin memiliki baris rekaman di tabel `order_payments` serta memperbarui `orders.payment_status` dan `orders.amount_paid` secara atomik di database.

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
- Idempotency: Cek existing transaction (`business_id, order_id, description`) sebelum insert.
- Anti-Duplikasi (Strict): Dilarang mengasumsikan `isNewOrder = Boolean(preloadedOrder)`. Di `orderLedger.ts`, existing transactions wajib selalu di-fetch via `order_id` dan `skipExistingCheck` diset `false` agar tidak menghasilkan duplikasi transaksi Penjualan.
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

### 9. `lib/stockLedger.ts` — SaaS Stock Movement Ledger

Modul terpusat untuk mencatat mutasi stok fisik secara **SaaS-grade/immutable** ke tabel `public.stock_moves`.

```typescript
import { recordStockMovements } from '@/lib/stockLedger'

await recordStockMovements([
  {
    businessId,
    productId,
    reference: 'PO-001',
    qty: 10,
    unitCost: 50000,
    type: 'receipt', // 'receipt' | 'delivery' | 'transfer' | 'adjustment' | 'refund'
    sourceType: 'purchase',
    sourceId: purchase.id, // UUID dokumen sumber, bukan nomor invoice
    status: 'done'
  }
], supabase)
```

**Fitur:**
- **Relasi utama:** `product_id` adalah UUID produk; `reference` hanya untuk tampilan/pencarian dokumen.
- **Idempotensi Otomatis:** Untuk dokumen baru gunakan `source_type + source_id + product_id + type`; jangan jadikan nomor invoice sebagai kunci relasi.
- **Isolasi tenant:** Setiap query `stock_moves` wajib memfilter `business_id` dan `product_id`.
- **Dipakai di:** `purchases/route.ts`, `stock-opname/route.ts`, `pos/refund/route.ts`, `lib/inventoryHelper.ts` (POS Orders & Invoices).

Untuk aturan fallback riwayat, backfill, dan perbaikan data legacy, baca [knowledge inventory ledger](../../knowledge/inventory-ledger.md).

---

### 10. UUID Input Sanitization & Optional Foreign Keys

Kolom bertipe data PostgreSQL `UUID` (seperti `register_id`, `shift_id`, `customer_id`, dll.) akan memicu *fatal crash* (`invalid input syntax for type uuid: ""`) jika menerima string kosong `""`.

Destructuring dengan default parameter seperti `const { register_id = null } = body` **tidak akan mencegah error** karena string kosong adalah nilai yang *defined*.

```typescript
import { isUuid } from '@/lib/utils'

// Sanitasi sebelum kueri database / insert / update:
const cleanRegisterId = isUuid(register_id) ? register_id : null
const cleanShiftId = isUuid(shift_id) ? shift_id : null
```

Di sisi React / Client payload, selalu kirim `id || null` bukan string kosong:
```typescript
body: JSON.stringify({ register_id: registerId || null })
```
Untuk detail lengkap, baca [knowledge uuid-sanitization](../../knowledge/uuid-sanitization/artifacts/explanation.md).

---

### 11. Vercel Serverless & Edge Input Parsing Standards

Untuk memastikan keandalan 100% pada lingkungan Vercel Serverless Functions:

1. **Safe Request Body Parsing:**
   `await request.json()` pada Vercel akan melempar *unhandled SyntaxError* jika payload kosong atau format tidak valid.
   **Wajib:**
   ```typescript
   let body: any
   try {
     body = await request.json()
   } catch {
     return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong' }, { status: 400 })
   }
   ```

2. **Safe Pagination & Number Parsing (Anti-NaN):**
   `parseInt('abc', 10)` menghasilkan `NaN`. Operasi `Math.max(1, NaN)` di JavaScript tetap menghasilkan `NaN`, yang merusak rentang `.range(NaN, NaN)` di Supabase.
   **Wajib:**
   ```typescript
   const rawPage = parseInt(url.searchParams.get('page') || '1', 10)
   const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

   const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10)
   const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 50
   ```

3. **PostgREST Filter Delimiter Safety:**
   Pada pencarian dengan `.or(...)`, karakter koma `,` dan tanda kurung `()` adalah delimiter sintaks internal PostgREST. Jika user mencari `baju, merah`, kueri akan gagal dengan error 400 Bad Request.
   **Wajib:** Sanitize string pencarian:
   ```typescript
   const rawSearch = url.searchParams.get('search') || ''
   const search = rawSearch.replace(/[,()]/g, ' ').trim()
   ```

4. **Client-Side Safe Response Parsing:**
   Ketika endpoint serverless mengalami timeout (504) atau gateway error (502), response berupa halaman HTML, bukan JSON. Memanggil `await res.json()` langsung akan memicu crash `SyntaxError: Unexpected token '<'`.
   **Wajib:**
   ```typescript
   const json = await res.json().catch(() => null)
   if (!res.ok) throw new Error(json?.error || `Gagal memuat data (Status: ${res.status})`)
   ```

---

### 12. PostgreSQL Database Views & Row Level Security (RLS)

1. **`WITH (security_invoker = true)` pada Database Views:**
   Secara default di PostgreSQL, View dieksekusi dengan hak akses pemilik view (*SECURITY DEFINER* / postgres), yang **melewati (bypass) aturan RLS** pada tabel asal.
   **Wajib:** Setiap View yang dibuat harus menyertakan opsi `WITH (security_invoker = true)`:
   ```sql
   CREATE VIEW public.v_quarantine_returns
   WITH (security_invoker = true) AS
   SELECT ...
   ```
   Ini memastikan PostgreSQL menegakkan aturan RLS tabel asal (`stock_moves`, `products`) berdasarkan kredensial pengguna yang sedang login (`auth.uid()`).

2. **Defense-in-Depth Tenant Isolation:**
   Di API Route, selalu kombinasikan RLS database dengan filter eksplisit `.eq('business_id', businessId)` yang bersumber dari `getApiContext()`. Jangan pernah mengandalkan satu lapisan keamanan saja.

---

### 13. POS Session & Order Payments Integration

1. **Session Gating:**
   Setiap endpoint kasir wajib memverifikasi keberadaan shift aktif pengguna:
   ```typescript
   const { data: activeShift } = await supabase
     .from('pos_shifts')
     .select('id, register_id')
     .eq('business_id', businessId)
     .eq('user_id', user.id)
     .eq('status', 'open')
     .maybeSingle()

   if (!activeShift) {
     return NextResponse.json({ error: 'Sesi kasir belum dibuka.' }, { status: 403 })
   }
   ```

2. **Multi-Tender & Split Payments (`order_payments`):**
   Gunakan tabel `order_payments` sebagai *Single Source of Truth* untuk penerimaan pembayaran (1:N terhadap `orders`). Catat setiap metode tender terpisah beserta akun GL dan `shift_id`.

3. **Append-Only Void & Refund:**
   Dilarang keras melakukan `DELETE` pada riwayat pembayaran. Pembatalan pembayaran (void) dan refund pesanan dicatat sebagai event penyeimbang (`payment_kind = 'void' | 'refund'`) yang mengacu pada `voided_payment_id`.

4. **Two-Dimensional Order Lifecycle & Payment Ledger UI:**
   Antarmuka pesanan (`/orders`, `OrderTable.tsx`, `OrderDetailModal.tsx`) memisahkan status logistik (`orders.status`) dan status keuangan (`orders.payment_status`).
   - Riwayat pembayaran di tab modal wajib dimuat langsung dari tabel `order_payments` lengkap dengan referensi akun kas/bank dan status konfirmasi.
   - Pesanan e-commerce non-COD yang masuk wajib langsung diakui sebagai lunas (`paid`) dan saldo piutang lunas (`amount_paid = grand_total`), serta memiliki baris kas di `order_payments`.

---

### 14. `lib/paymentLedger.ts` — Universal Payment Specialist (Cicilan & Void)

Pahami pemisahan tanggung jawab antara **`syncOrderToLedger()`** dan **`lib/paymentLedger.ts`**:

1. **`syncOrderToLedger()` (Master Order Orchestrator):**
   - **Kapan Digunakan:** Saat pesanan baru dibuat atau berubah status (WooCommerce webhook, POS checkout baru, penerbitan Invoice baru, sinkronisasi Accurate ERP, dan Order Manual).
   - **Tanggung Jawab:** Mutasi stok fisik rak gudang (`stock_moves`), kalkulasi HPP WAC, jurnal pengakuan pendapatan (`401000`), jurnal kas/bank pembayaran awal, pencatatan baris pembayaran ke `order_payments`, dan loyalty points.

2. **`lib/paymentLedger.ts` (Subsequent Payment & Void Specialist):**
   - **Kapan Digunakan:** Saat pesanan sudah ada di sistem sebelumnya (stok dan penjualan sudah diakui di masa lalu), lalu ada transaksi keuangan lanjutan.
   - **Fungsi Utama:**
     - `recordOrderPayment()`: Pelunasan cicilan / DP susulan (murni Debit Kas/Bank `101000`/`101200` dan Kredit Piutang Usaha `103000` tanpa memicu mutasi stok ulang).
     - `voidOrderPayment()`: Pembatalan satu baris pembayaran yang salah tender secara *append-only* (Debit Piutang, Kredit Kas/Bank).
     - `recalculateOrderPaymentStatus()`: Sinkronisasi ulang `amount_paid` dan `payment_status` (`unpaid`, `partial`, `paid`).

---

### 15. Password Visibility & Security UX Standards (Tombol Mata)

Setiap kolom input password di seluruh aplikasi **WAJIB** menerapkan tombol mata (*Show/Hide Password Toggle*) untuk kenyamanan dan keamanan pengguna:

1. **State & Toggle Icon:**
   - Kolom password wajib memiliki kontrol state `const [showPassword, setShowPassword] = useState(false)`.
   - Input menggunakan `type={showPassword ? 'text' : 'password'}` dengan padding kanan (`pr-12` atau `pr-10`).
   - Tombol toggle menggunakan `type="button"`, `tabIndex={-1}`, dan `aria-label` yang dinamis ("Lihat password" / "Sembunyikan password").
   - Ikon mata terbuka (Lucide Eye) saat tersembunyi, dan mata tercoret (Lucide EyeOff) saat teks terbuka.

2. **Real-time Feedback & Match Indicators:**
   - Pada form penetapan password baru (`/reset-password`, pengaturan staf):
     - Sediakan indikator kekuatan password (*minimal 6 karakter*).
     - Sediakan verifikasi kesesuaian real-time (*Password cocok* dengan ikon centang hijau atau peringatan saat belum cocok).
     - Tombol simpan wajib dinonaktifkan (`disabled`) jika panjang belum memenuhi syarat atau konfirmasi belum cocok.

3. **Konsistensi UI:**
   - Standar ini diterapkan seragam pada:
     - Halaman Masuk (`/login`)
     - Halaman Registrasi (`/register`)
     - Halaman Reset Password (`/reset-password`)
     - Formulir Ganti Password Mandiri & Modal Staf (`/settings/staff`)

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
11. **Location Caching:** Di API route laporan inventory (`inventory/reports/route.ts`), kueri `inventory_locations` di-cache 5 menit di memori server untuk mempercepat kueri mutasi terindeks (~3ms).
12. **Client SWR & Cache Sync Status:** Komponen UI yang menampilkan Move History (modal / tab) wajib menggunakan client-side SWR cache (`0ms` instant load). Jika data bersumber dari cache, UI wajib menampilkan badge status `⚡ Sync: Data Tampil dari Cache (0ms)`.
13. **High-Speed Database-Level Order Payment RPC:** Status pembayaran (`payment_status`) dan total terbayar (`amount_paid`) diagregasikan langsung pada tingkat PostgreSQL RPC (`get_order_list` dan `get_order_analytics_metrics`) menggunakan indeks komposit `(business_id, payment_status, created_at DESC)`. Dilarang melakukan komputasi pembayaran N+1 di client-side.

## 🔗 Dependency Graph

```
API Route (POS/Invoice/Webhook/etc.)
  ├── lib/apiContext.ts          → Auth + Business ID
  ├── lib/guestCustomer.ts       → Guest customer (POS only)
  ├── lib/paymentLedger.ts       → Subsequent installments & payment voids (murni kas & piutang)
  └── lib/orderLedger.ts         → Main order orchestrator (WooCommerce, POS, Invoice, ERP)
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
| Inventory Locations | 5min | Auto-expire (5 menit) |
| Move History (Client SWR) | Memory | Stale-While-Revalidate di background |
| Accounts (COA) | Forever | Restart server — jarang berubah |
| Integration Config | 60s | Auto-expire |
| HPP/Recipe Batch | 60s | `invalidateHppCache()` — saat recipe diubah |
| Loyalty Settings | 60s | Auto on `upsertLoyaltySettings()` |
