# Expense Ledger & Semi-Modular ACID RPC

## Latar Belakang Masalah
Sebelumnya, pembuatan dan pembaruan pengeluaran di `app/api/expenses/route.ts` dan `app/api/expenses/bulk/route.ts` mengalami duplikasi logika serta latensi tinggi saat update (`PUT`):
1. **Sequential DB Roundtrips (8–9x pada `PUT`):** `getAuthUser` → `profiles` → `expenses` → `expense_payments` count → `ensureExpenseAccounts` (tanpa syarat) → `transactions.update` → `journal_lines.delete` → `journal_lines.insert` → `expenses.update`.
2. **Risiko Non-ACID pada `PUT`:** `journal_lines.delete()` dan `journal_lines.insert()` berjalan pada transaksi HTTP terpisah; kegagalan pada `insert` meninggalkan jurnal terhapus.
3. **Frontend Waterfall & Cache Miss (`app/expenses/edit/[id]/page.tsx`):** Melakukan `supabase.auth.getUser()` → `profiles` sebelum mengambil data pengeluaran, tidak memperbarui `localStorage` (`cache_expenses_${businessId}`), dan memanggil `router.refresh()` setelah submit.

## Standar Arsitektur Terkini

### 1. Single Source of Truth di `lib/expenseLedger.ts`
Seluruh endpoint pengeluaran (`POST /api/expenses`, `PUT /api/expenses`, `POST /api/expenses/bulk`) wajib menggunakan modul `lib/expenseLedger.ts`:
- `prepareExpenseLedgerData(input, businessId, supabase, preloadedHutangAccountId?)`:
  - Sanitasi UUID (`isUuid()`).
  - Validasi nominal, status (`paid` | `unpaid` | `partial`), dan `amount_paid`.
  - Format tanggal transaksi via `formatTransactionDate(date)`.
  - Resolusi akun Hutang Usaha (`201000`) via `ensureExpenseAccounts()` **hanya jika** `numOutstanding > 0` atau `status === 'unpaid'`.
  - Penyusunan array `journal_lines` (Debit kategori, Credit akun bayar jika `amount_paid > 0`, Credit `201000` jika `outstanding_amount > 0`).
- `createExpenseWithLedger(businessId, input, supabaseAdmin)` → memanggil RPC `create_expense_transaction_v1`.
- `updateExpenseWithLedger(businessId, expenseId, input, supabaseAdmin)` → memanggil RPC `update_expense_transaction_v1`.

### 2. PostgreSQL Semi-Modular ACID RPC (`20261117103500_expense_transaction_rpc.sql`)
- **`create_expense_transaction_v1(payload jsonb)`** & **`update_expense_transaction_v1(payload jsonb)`**:
  - `SECURITY DEFINER` + `SET search_path = public` + Tenant Ownership/Staff Guard (`AGENTS.md` §14).
  - `update_expense_transaction_v1` mengunci baris `expenses` dengan `FOR UPDATE`, menolak status `paid` (`EXPENSE_ALREADY_PAID`) atau yang sudah memiliki cicilan di `expense_payments` (`EXPENSE_HAS_PAYMENTS`), lalu memperbarui `transactions`, membangun ulang `journal_lines`, dan memperbarui `expenses` dalam 1 blok transaksi ACID.

### 3. API Route & Frontend Standards
- `app/api/expenses/route.ts` dan `app/api/expenses/bulk/route.ts` wajib menggunakan `getApiContext({ req, requestedBusinessId })`, `try...catch` saat `req.json()`, dan `isUuid()` untuk parameter ID.
- `app/expenses/edit/[id]/page.tsx` wajib menggunakan `useUserContext()`, `useAccounts()`, `useSuppliers()` (SWR 0ms), mengambil `/api/expenses?id=...` langsung saat mount, serta melakukan update optimistik pada `localStorage` (`cache_expenses_${activeBizId}`) pasca-`PUT` tanpa `router.refresh()`.

