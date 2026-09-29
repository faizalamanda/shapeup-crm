-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: POS Fast Checkout — sync_status + client_order_id
-- Tujuan: Mendukung optimistic checkout + background ledger sync
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tambah kolom sync_status untuk tracking background job
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced'
    CHECK (sync_status IN ('pending', 'synced', 'failed'));

-- 2. Tambah kolom client_order_id untuk idempotency (UUID dari client)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_order_id TEXT UNIQUE;

-- 3. Index untuk monitoring: ambil semua order yang belum/gagal sync
CREATE INDEX IF NOT EXISTS idx_orders_sync_status
  ON orders (business_id, sync_status)
  WHERE sync_status IN ('pending', 'failed');

-- 4. Index untuk idempotency check
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id
  ON orders (client_order_id)
  WHERE client_order_id IS NOT NULL;
