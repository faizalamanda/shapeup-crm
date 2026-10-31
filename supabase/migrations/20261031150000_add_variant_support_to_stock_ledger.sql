-- ==============================================================================
-- MIGRATION: Add Product Variant Support to Stock Ledger
-- Timestamp: 20261031150000_add_variant_support_to_stock_ledger.sql
-- Description:
-- 1. Adds variant_id column to public.stock_moves (FK to product_variants)
-- 2. Replaces uq_stock_moves_document_product_type with variant-aware unique index
-- 3. Updates database view v_stock_moves_ledger with composite partitioning
-- 4. Updates trigger sync_product_stock_from_moves to intelligently sync variant and parent
-- 5. Modernizes RLS policies for product_variants, product_modifiers, products, categories
-- ==============================================================================

-- 1. Add variant_id to public.stock_moves
ALTER TABLE public.stock_moves
ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_moves_variant_id ON public.stock_moves(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_prod_variant ON public.stock_moves(product_id, variant_id);

-- 1b. Replace document product unique index with variant-aware composite unique index
-- Prevents collision when a single order/purchase contains multiple variants of the same product
DROP INDEX IF EXISTS public.uq_stock_moves_document_product_type;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_moves_document_product_variant_type
  ON public.stock_moves (
    business_id, 
    source_type, 
    source_id, 
    product_id, 
    COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), 
    type
  )
  WHERE source_id IS NOT NULL;

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
  old_variant_id UUID;
  new_variant_stock NUMERIC;
  new_parent_stock NUMERIC;
  has_product_variants BOOLEAN;
BEGIN
  target_product_id := COALESCE(NEW.product_id, OLD.product_id);
  target_variant_id := NEW.variant_id;
  old_variant_id := OLD.variant_id;

  -- 1. Check if the product has defined variants in product_variants
  SELECT EXISTS (
    SELECT 1 FROM public.product_variants WHERE product_id = target_product_id
  ) INTO has_product_variants;

  -- 2. If move is attached to a variant, update that specific variant's stock
  IF target_variant_id IS NOT NULL THEN
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
  END IF;

  -- 3. If an UPDATE changed the variant_id or a DELETE occurred with OLD.variant_id
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') AND old_variant_id IS NOT NULL AND old_variant_id IS DISTINCT FROM target_variant_id THEN
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
      AND variant_id = old_variant_id
      AND status = 'done' 
      AND bucket = 'main';

    UPDATE public.product_variants
    SET stock_quantity = new_variant_stock
    WHERE id = old_variant_id;
  END IF;

  -- 4. Update parent product stock_quantity
  IF has_product_variants THEN
    -- Aggregate sum of all variants into parent product
    SELECT COALESCE(SUM(stock_quantity), 0) INTO new_parent_stock
    FROM public.product_variants
    WHERE product_id = target_product_id;

    UPDATE public.products
    SET stock_quantity = new_parent_stock,
        updated_at = NOW()
    WHERE id = target_product_id;
  ELSE
    -- Standard product without variants: calculate net stock directly from stock_moves
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

-- 4. Modernize RLS Policies on product_variants, product_modifiers, products, categories (Rule 14 & 15 compliant)
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

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business products" ON public.products;
CREATE POLICY "Users can manage their own business products" ON public.products
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

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business categories" ON public.categories;
CREATE POLICY "Users can manage their own business categories" ON public.categories
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

-- Modernize RLS on public.stock_moves
ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view stock_moves for their business" ON public.stock_moves;
DROP POLICY IF EXISTS "Users can insert stock_moves for their business" ON public.stock_moves;
DROP POLICY IF EXISTS "Users can manage stock_moves for their business" ON public.stock_moves;
CREATE POLICY "Users can manage stock_moves for their business" ON public.stock_moves
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

-- Modernize RLS on public.stock_opname
ALTER TABLE public.stock_opname ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business stock_opname" ON public.stock_opname;
CREATE POLICY "Users can manage their own business stock_opname" ON public.stock_opname
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

