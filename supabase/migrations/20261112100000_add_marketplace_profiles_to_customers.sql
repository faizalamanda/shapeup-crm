-- Migration: 20261112100000_add_marketplace_profiles_to_customers.sql
-- Description: Enable flexible marketplace account handles and relax phone constraint for marketplace orders.

-- 1. Ensure phone column in customers is nullable so marketplace orders without phone don't fail
DO $$
BEGIN
  ALTER TABLE public.customers ALTER COLUMN phone DROP NOT NULL;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 2. Create GIN index for fast marketplace profile lookup in metadata
-- Enables sub-millisecond lookup: metadata->'marketplace_profiles'->>'shopee'
CREATE INDEX IF NOT EXISTS idx_customers_marketplace_profiles
  ON public.customers USING GIN ((metadata->'marketplace_profiles'));

-- 3. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

