---
name: inventory-ledger-architecture
description: Arsitektur Ledger Inventori Kelas Dunia menggunakan PostgreSQL View dan Window Functions untuk menghitung running balance. Gunakan skill ini ketika bekerja dengan kalkulasi riwayat stok dan tabel stock_moves.
---

# Inventory Ledger Architecture (World-Class Standard)

This skill documents the standard architecture for querying and displaying inventory stock movements and running balances (system_stock) in ShapeUp CRM.

## Core Principle
- **DO NOT** calculate running balances (`system_stock`) in JavaScript/TypeScript using manual array iterations (neither forward nor backward).
- **DO NOT** store `system_stock` natively in the `stock_moves` table itself, as it causes massive cascade update issues when backdated transactions are inserted.
- **DO USE** PostgreSQL's native Engine capabilities (Window Functions) via the Database View: `v_stock_moves_ledger`.

## The `v_stock_moves_ledger` View
This view acts exactly like the `stock_moves` table, but it includes an on-the-fly calculated `system_stock` column using:
```sql
SUM(
  CASE
    WHEN type IN ('receipt', 'refund') THEN qty
    WHEN type = 'delivery' THEN -qty
    WHEN type = 'adjustment' AND (origin_location_id IS NULL OR (destination_location_id IS NOT NULL AND origin_location_id IS NULL)) THEN qty
    WHEN type = 'adjustment' THEN -qty
    ELSE 0
  END
) OVER (PARTITION BY product_id ORDER BY created_at ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as system_stock
```
This guarantees 100% data integrity even if past transactions are modified or backdated.

## Usage in API / Frontend
When fetching stock moves for a product:
1. Always query `v_stock_moves_ledger` instead of `stock_moves`.
2. Apply pagination directly via Supabase `.range(offset, offset + limit - 1)`.
3. Apply sorting via `.order('created_at', { ascending: false })` to show the latest moves at the top.
4. Directly return the result. No logic is needed in the Node.js/Edge layer.

## Best Practices
- Never use `Promise.all` to fetch prior rows and calculate backward/forward logic in JS.
- Rely on the DB View. It is C-level optimized and instantaneous.
- Ensure the API always retrieves `system_stock` from the view and maps it to the frontend `StockMove` interface.

## Academic & Theoretical Justification
This architecture is heavily backed by Database Theory and Computer Science principles:
1. **Third Normal Form (3NF)**: Storing a derived running balance physical column violates 3NF (Denormalization) and causes Update Anomalies. This view approach strictly adheres to 3NF.
2. **Event Sourcing & CQRS**: `stock_moves` acts as the Append-Only Event Store (Write Model). The view `v_stock_moves_ledger` acts as the Read Model, projecting past events into a current state without physical mutation.
3. **High Concurrency & Race Conditions**: In high-velocity environments (e.g. Flash Sales), storing running balances requires locking (Row Locks), severely limiting write throughput. This Append-Only approach guarantees maximum concurrency without deadlocks.
4. **Bitemporal Modeling**: Transactions have a Transaction Time (insertion) and Valid Time (effective date). Using `ORDER BY created_at` in the Window Function seamlessly handles backdated entries without requiring cascading row updates.

## Ledger Insertion Rules (Important)
When writing stock moves to `public.stock_moves` (usually via `recordStockMovements` in `lib/stockLedger.ts`), you **MUST** follow these critical rules:

1. **Adjustments (Shrinkage vs Excess)**:
   - For a **Positive Adjustment** (adding stock, e.g., Excess/Lebih): Set `originLocationId` to `null` and `destinationLocationId` to `null`.
   - For a **Negative Adjustment** (removing stock, e.g., Shrinkage/Susut): You **MUST** set `originLocationId` to a dummy UUID (e.g., `'00000000-0000-0000-0000-000000000000'`). Without this, the view will incorrectly calculate it as a positive addition!

2. **Precise Timestamps (`created_at`)**:
   - The view relies heavily on `created_at` for chronological sorting.
   - If the user provides a `date` (e.g. `'2026-09-30'`), passing it directly will resolve to Midnight UTC (e.g., `07:00 WIB`), messing up the timeline.
   - **Rule**: If the date is *today*, use the exact current time (`new Date().toISOString()`). If the date is *backdated* and lacks a time component, append the end-of-day time (e.g. `T16:59:59.000Z` for `23:59:59 WIB`) to ensure it encompasses all transactions of that day.

3. **Batch Operations (Anti N+1)**:
   - Always batch `recordStockMovements` in a single array. Never loop and insert sequentially.

4. **Single Source of Truth for Physical Stock (NO MANUAL UPDATES)**:
   - **CRITICAL**: Do **NOT** manually update `products.stock_quantity` via `supabase.from('products').update(...)` in the API route before or after inserting into `stock_moves`.
   - The PostgreSQL database is configured with an automated trigger (`trg_sync_product_stock_from_moves`) that fires `AFTER INSERT OR UPDATE OR DELETE ON public.stock_moves`.
   - Updating it manually in JS will cause "Ghost Updates" where the physical stock changes, but if the `stock_moves` insert fails silently, the Move History ledger will remain empty while the physical stock is altered, destroying data integrity. Let the DB Engine handle the sync atomically.

5. **Strict Error Handling (No Silent Failures)**:
   - Never call `recordStockMovements()` without explicitly checking its return value (`{ error }`).
   - If `error` is present, the API **MUST throw or return a 500 status** to halt the transaction and inform the client. Swallowing the error (e.g., just returning `200 OK`) causes phantom states where the client thinks the process succeeded but the ledger is missing data.
   - Idempotency Gotcha: If an opname or document is "Updated" (resubmitted with the same `reference` / `opname_number`), `recordStockMovements` is designed to be idempotent and will return `inserted: 0`. This is expected behavior, but silent DB failure errors must still be caught.

## Ledger UI & Calculation Rules

1. **Opname Diff Calculation (The "Absolute Truth")**:
   - **DO NOT** calculate Opname selisih (`diff`) based on `recorded_quantity` sent from the frontend or from caching tables (like `products.stock_quantity`).
   - **MUST**: Always fetch the latest `system_stock` from `v_stock_moves_ledger` at the time the API executes. Calculate `diff = actual_quantity - true_system_stock`. This guarantees the final balance lands perfectly on `actual_quantity`.

2. **Move History UI Rendering**:
   - The `qty` column in `stock_moves` is always stored as an absolute (positive) number.
   - When rendering `Move History` in the UI, use this logic to prepend `+` or `-` and apply colors:
     ```tsx
     // Positive (Emerald): receipt OR (adjustment AND !origin_location_id)
     // Negative (Rose): delivery OR (adjustment AND origin_location_id)
     {m.type === 'receipt' ? `+${m.qty}` : m.type === 'delivery' ? `-${m.qty}` : m.type === 'adjustment' ? (m.origin_location_id ? `-${m.qty}` : `+${m.qty}`) : m.qty}
     ```

## Idempotency Key & Timestamp Rules for `lib/stockLedger.ts`

### 1. Composite Idempotency Key
- In `lib/stockLedger.ts`, `existingKeySet` MUST include both:
  - `${product_id}_${source_type}_${source_id}_${type}`
  - `${product_id}_${reference}_${type}`
- **NEVER** key solely by `${product_id}_${type}`. Doing so will block all subsequent transactions of the same type for that product.

### 2. Order & Shipping Timestamp Selection Hierarchy
When generating stock movements for orders (e.g. `type: 'delivery'`), determine the exact movement timestamp (`created_at`) using the following order of precedence:
1. `raw.date_shipped_gmt` / `raw.date_shipped` *(Shipping Date — Top Priority)*
2. `raw.date_paid_gmt` / `raw.date_paid` *(Payment Date)*
3. `raw.date_completed_gmt` / `raw.date_completed` *(Completion Date)*
4. `order.order_date_utc` / `order.order_date` *(Order Date)*
5. `new Date().toISOString()` *(Fallback)*

### 3. Pagination & Limit Safety (1,000 Row Boundary)
- Supabase queries default to a limit of 1,000 rows.
- When performing bulk operations (such as rebuilding stock move ledgers or auditing transactions across all businesses), always paginate with `.range(from, to)` in chunks (e.g., 500 or 1,000 rows per loop) to ensure no products or orders are missed.

## Transaction Document UI Standard (Ledger Tabs)
When displaying the details of any transaction document that affects inventory (e.g., Stock Opname, Sales Orders, Purchase Orders) in the frontend, you **MUST** follow this Tabbed UI architectural pattern to provide a transparent audit trail.

### 1. Mobile/PWA Native Modal
- The detail view **MUST** be wrapped in `<FullScreenModal>` from `@/components/ui/FullScreenModal` with `desktopSize="xl"` or `lg`. This ensures full PWA compliance, Safe-Area handling, and native Back-button routing.
- Do NOT use custom portals, `body.style.overflow` locks, or raw `div` overlays.

### 2. Tab Structure & Lazy Loading (Access Speed)
To prevent network bottlenecks on initial modal open, the data for the ledgers **MUST** be fetched lazily ("On-Demand") only when the user clicks the respective tab.
- **Tab 1: Physical / General Details**
  - **Data Source**: Pre-loaded with the document or fetched immediately.
  - **Purpose**: Displays the raw data of the transaction (e.g., recorded vs actual physical count for Opname, or line items purchased for PO).
- **Tab 2: Jurnal Stok (Stock Moves / Kartu Stok)**
  - **Data Source**: Lazy-loaded from `v_stock_moves_ledger` using `source_type` and `source_id`. Execute as a direct Supabase client query from the browser to bypass API cold-starts.
  - **Purpose**: Allows the user to verify exactly what stock adjustments were made by this specific document.
  - **UI**: Show Time, Product Name, Action Type, Qty Mutasi (with + / - signs and colors), and Saldo Sistem (Running Balance).
- **Tab 3: Jurnal Keuangan (Financial Journal)**
  - **Data Source**: Lazy-loaded from `transactions` and `journal_lines` based on the document's transaction ID.
  - **Purpose**: To verify the financial accounting impact (Debit/Credit to Inventory and Expense accounts).

