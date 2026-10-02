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
