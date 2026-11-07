-- Add dimension pricing fields to products table
-- Supports printing service products (dynamic length x width calculation)
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(30) NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS min_area NUMERIC(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.products.pricing_type IS 'standard: fixed unit price, area: dynamic length x width calculation (m2 or cm2)';
COMMENT ON COLUMN public.products.min_area IS 'Minimum billable area for area-based products (0 for no minimum)';
COMMENT ON COLUMN public.products.min_price IS 'Minimum billable price for area-based products (0 for no minimum)';

