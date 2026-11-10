-- ============================================================================
-- Migration: 20261110163500_add_moka_compatible_product_features.sql
-- Purpose  : Adds non-breaking multi-price tiers (Basic / Dine-In / Take Away),
--            minimum stock alert, external POS ID mapping, and modifier cost
--            support for Moka POS compatibility & Metorik-style analytics.
-- Safety   : 100% additive (IF NOT EXISTS) with safe defaults. Does NOT alter
--            any existing journals, transactions, stock_moves, or triggers.
-- ============================================================================

BEGIN;

-- 1. Enhance public.products with non-breaking optional columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_tiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS min_stock_alert integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_id text;

-- 2. Enhance public.product_variants with non-breaking optional columns
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS price_tiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS min_stock_alert integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_id text;

-- 3. Enhance public.product_modifiers with optional cost_price & sort_order
ALTER TABLE public.product_modifiers
  ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 4. Create helpful indexes for external_id lookups (Moka / Omnichannel sync)
CREATE INDEX IF NOT EXISTS idx_products_business_external_id
  ON public.products (business_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_variants_business_external_id
  ON public.product_variants (business_id, external_id)
  WHERE external_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

