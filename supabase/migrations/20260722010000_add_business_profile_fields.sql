-- Migration: 20260722010000_add_business_profile_fields.sql
-- Description: Add extended business profile fields to businesses table for full CRM & ERP settings.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS website TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS legal_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS industry TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tax_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'IDR',
  ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS city TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS province TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS postal_code TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signatory_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signatory_title TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}'::jsonb;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
