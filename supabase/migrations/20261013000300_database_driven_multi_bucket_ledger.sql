-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Database-Driven Multi-Bucket Ledger (Single Source of Truth)
-- Context: Moves all bucket calculations (Main, Quarantine, In-Transit) into native
--          PostgreSQL Window Functions. Adds 'bucket' column to public.stock_moves.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add bucket column to public.stock_moves
ALTER TABLE public.stock_moves 
ADD COLUMN IF NOT EXISTS bucket VARCHAR(50) NOT NULL DEFAULT 'main';

-- Index for fast bucket queries
CREATE INDEX IF NOT EXISTS idx_stock_moves_biz_prod_bucket 
ON public.stock_moves (business_id, product_id, bucket);

-- 2. Backfill existing rows
-- Tag customer order returns as 'quarantine'
UPDATE public.stock_moves
SET bucket = 'quarantine'
WHERE (source_type = 'order' OR reference ILIKE '%order%')
  AND type = 'receipt'
  AND (status = 'pending' OR status = 'transferred');

-- Tag in-transit moves as 'in_transit'
UPDATE public.stock_moves
SET bucket = 'in_transit'
WHERE status = 'in_transit';

-- 3. Database View: v_stock_moves_ledger with Multi-Bucket Running Balances
-- Note: DROP VIEW CASCADE is required by PostgreSQL because adding 'bucket' column to stock_moves
--       changes the column ordinal positions of sm.* in the existing view definition.
DROP VIEW IF EXISTS public.v_stock_moves_ledger CASCADE;

CREATE VIEW public.v_stock_moves_ledger AS
SELECT 
    sm.*,

    -- 1. Saldo Berjalan Gudang Utama (On-Hand Siap Jual di Rak)
    SUM(
        CASE
            WHEN sm.status = 'done' AND sm.bucket = 'main' THEN
                CASE
                    WHEN sm.type IN ('receipt', 'refund') THEN sm.qty
                    WHEN sm.type = 'delivery' THEN -sm.qty
                    WHEN sm.type = 'adjustment' AND (sm.origin_location_id IS NULL OR (sm.destination_location_id IS NOT NULL AND sm.origin_location_id IS NULL)) THEN sm.qty
                    WHEN sm.type = 'adjustment' THEN -sm.qty
                    WHEN sm.type = 'transfer' AND sm.destination_location_id IS NOT NULL THEN sm.qty
                    WHEN sm.type = 'transfer' THEN -sm.qty
                    ELSE 0
                END
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC, sm.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS system_stock,

    -- 2. Saldo Berjalan Karantina Retur
    SUM(
        CASE
            WHEN sm.bucket = 'quarantine' AND sm.status != 'cancelled' THEN
                CASE
                    WHEN sm.type = 'receipt' THEN sm.qty
                    WHEN sm.type IN ('delivery', 'transfer', 'adjustment') THEN -sm.qty
                    ELSE 0
                END
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC, sm.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS quarantine_stock,

    -- 3. Saldo Berjalan Dalam Pengiriman (In-Transit)
    SUM(
        CASE
            WHEN sm.bucket = 'in_transit' AND sm.status != 'cancelled' THEN
                CASE
                    WHEN sm.type = 'delivery' THEN sm.qty
                    WHEN sm.type IN ('receipt', 'transfer') THEN -sm.qty
                    ELSE 0
                END
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC, sm.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS in_transit_stock

FROM public.stock_moves sm;

-- Grant permissions for PostgREST
GRANT SELECT ON public.v_stock_moves_ledger TO authenticated, anon, service_role;

-- 4. Update Trigger Function to only sync products.stock_quantity for bucket = 'main'
CREATE OR REPLACE FUNCTION public.sync_product_stock_from_moves()
RETURNS TRIGGER AS $$
DECLARE
  target_product_id UUID;
  new_net_stock NUMERIC;
BEGIN
  target_product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT COALESCE(SUM(
    CASE
      WHEN type IN ('receipt', 'refund') THEN qty
      WHEN type = 'delivery' THEN -qty
      WHEN type = 'adjustment' AND (origin_location_id IS NULL OR (destination_location_id IS NOT NULL AND origin_location_id IS NULL)) THEN qty
      WHEN type = 'adjustment' THEN -qty
      WHEN type = 'transfer' AND destination_location_id IS NOT NULL THEN qty
      WHEN type = 'transfer' THEN -qty
      ELSE 0
    END
  ), 0) INTO new_net_stock
  FROM public.stock_moves
  WHERE product_id = target_product_id 
    AND status = 'done' 
    AND bucket = 'main';

  UPDATE public.products
  SET stock_quantity = new_net_stock,
      updated_at = NOW()
  WHERE id = target_product_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_product_stock_from_moves ON public.stock_moves;
CREATE TRIGGER trg_sync_product_stock_from_moves
AFTER INSERT OR UPDATE OR DELETE ON public.stock_moves
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_stock_from_moves();
