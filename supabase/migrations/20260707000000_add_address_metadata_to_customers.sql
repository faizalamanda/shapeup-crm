-- Migration: 20260707000000_add_address_metadata_to_customers.sql
-- Description: Add a flexible JSONB column 'address_data' to the customers table.
-- This single column replaces multiple fixed address columns, enabling global market
-- support (Indonesia, Malaysia, USA, UK, etc.) without future schema migrations.
--
-- JSONB Structure Example (Indonesia preset):
-- {
--   "country_preset": "indonesia",
--   "country": "ID",
--   "address_line1": "Jl. Merdeka No. 10",
--   "address_line2": "RT 02/RW 05",
--   "subdistrict": "Menteng",
--   "city": "Jakarta Pusat",
--   "state": "DKI Jakarta",
--   "postcode": "10310"
-- }

-- 1. Add the JSONB column (nullable, no default forces explicit save)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address_data jsonb DEFAULT NULL;

-- 2. GIN index for fast JSONB querying — enables broadcast segmentation
--    e.g. filter customers WHERE address_data->>'state' = 'DKI Jakarta'
CREATE INDEX IF NOT EXISTS idx_customers_address_data
  ON public.customers USING GIN (address_data);

-- 3. Notify PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
