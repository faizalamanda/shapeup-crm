-- ==============================================================================
-- MIGRATION: Add Product Variant Support to Stock Ledger
-- Timestamp: 20261031150000_add_variant_support_to_stock_ledger.sql
-- Description:
-- 1. Adds variant_id column to public.stock_moves (FK to product_variants)
-- 2. Updates database view v_stock_moves_ledger with composite partitioning
-- 3. Updates trigger sync_product_stock_from_moves to sync both variant and parent
-- ==============================================================================

-- 1. Add variant_id to public.stock_moves
ALTER TABLE public.stock_moves
ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_moves_variant_id ON public.stock_moves(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_prod_variant ON public.stock_moves(product_id, variant_id);

-- 2. Update Database View: v_stock_moves_ledger
DROP VIEW IF EXISTS public.v_stock_moves_ledger CASCADE;

CREATE VIEW public.v_stock_moves_ledger 
WITH (security_invoker = true) AS
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
        PARTITION BY sm.product_id, COALESCE(sm.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
        PARTITION BY sm.product_id, COALESCE(sm.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
        PARTITION BY sm.product_id, COALESCE(sm.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY sm.created_at ASC, sm.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS in_transit_stock

FROM public.stock_moves sm;

GRANT SELECT ON public.v_stock_moves_ledger TO authenticated, anon, service_role;

-- 3. Update Trigger Function to intelligently sync variant and parent stock
CREATE OR REPLACE FUNCTION public.sync_product_stock_from_moves()
RETURNS TRIGGER AS $$
DECLARE
  target_product_id UUID;
  target_variant_id UUID;
  new_variant_stock NUMERIC;
  new_parent_stock NUMERIC;
BEGIN
  target_product_id := COALESCE(NEW.product_id, OLD.product_id);
  target_variant_id := COALESCE(NEW.variant_id, OLD.variant_id);

  IF target_variant_id IS NOT NULL THEN
    -- Recalculate specific variant stock_quantity in product_variants
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
    ), 0) INTO new_variant_stock
    FROM public.stock_moves
    WHERE product_id = target_product_id 
      AND variant_id = target_variant_id
      AND status = 'done' 
      AND bucket = 'main';

    UPDATE public.product_variants
    SET stock_quantity = new_variant_stock
    WHERE id = target_variant_id;

    -- Aggregate sum of all variants into parent product stock_quantity
    SELECT COALESCE(SUM(stock_quantity), 0) INTO new_parent_stock
    FROM public.product_variants
    WHERE product_id = target_product_id;

    UPDATE public.products
    SET stock_quantity = new_parent_stock,
        updated_at = NOW()
    WHERE id = target_product_id;
  ELSE
    -- Standard product without variant: calculate net stock for bucket 'main'
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
    ), 0) INTO new_parent_stock
    FROM public.stock_moves
    WHERE product_id = target_product_id 
      AND variant_id IS NULL
      AND status = 'done' 
      AND bucket = 'main';

    UPDATE public.products
    SET stock_quantity = new_parent_stock,
        updated_at = NOW()
    WHERE id = target_product_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_product_stock_from_moves ON public.stock_moves;
CREATE TRIGGER trg_sync_product_stock_from_moves
AFTER INSERT OR UPDATE OR DELETE ON public.stock_moves
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_stock_from_moves();

-- 4. Modernize RLS Policies on product_variants & product_modifiers (Rule 14 & 15 compliant)
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage product_variants" ON public.product_variants;
CREATE POLICY "Users can manage product_variants" ON public.product_variants
    FOR ALL
    TO authenticated
    USING (
      business_id IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
        UNION
        SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      )
      OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    )
    WITH CHECK (
      business_id IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
        UNION
        SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      )
      OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    );

ALTER TABLE public.product_modifiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage product_modifiers" ON public.product_modifiers;
CREATE POLICY "Users can manage product_modifiers" ON public.product_modifiers
    FOR ALL
    TO authenticated
    USING (
      business_id IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
        UNION
        SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      )
      OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    )
    WITH CHECK (
      business_id IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
        UNION
        SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      )
      OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    );

NOTIFY pgrst, 'reload schema';

