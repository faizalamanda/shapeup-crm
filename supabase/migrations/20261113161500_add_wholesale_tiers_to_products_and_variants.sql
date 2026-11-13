-- Add quantity-based wholesale pricing tiers to products and product_variants
-- Format: [{"min_qty": 10, "price": 45000}, {"min_qty": 50, "price": 40000}]

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wholesale_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS wholesale_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;

