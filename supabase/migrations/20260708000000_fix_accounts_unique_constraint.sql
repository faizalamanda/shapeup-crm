-- Migration: 20260708000000_fix_accounts_unique_constraint.sql
-- Description: Drop the global unique constraint on accounts(code) and replace it with a multi-tenant constraint (business_id, code).

-- 1. Drop the incorrect global unique constraint on code
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_code_key;

-- 2. Add a multi-tenant unique constraint on (business_id, code)
-- This allows different businesses to have the same account codes (e.g. 101000 for Cash)
ALTER TABLE public.accounts ADD CONSTRAINT accounts_business_id_code_key UNIQUE (business_id, code);
