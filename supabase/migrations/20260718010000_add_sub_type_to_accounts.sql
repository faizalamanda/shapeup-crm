-- Migration: 20260718010000_add_sub_type_to_accounts.sql
-- Description: Add sub_type column to accounts table for finer-grained reporting classifications.

-- 1. ADD COLUMN
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sub_type character varying(50);

-- 2. MIGRATE EXISTING ACCOUNTS DATA TO SENSIBLE SUB-TYPES
-- Aset (ASSET)
UPDATE public.accounts 
SET sub_type = 'bank_cash' 
WHERE type = 'ASSET' AND (code LIKE '101%' OR code LIKE '1100%' OR name ILIKE '%kas%' OR name ILIKE '%bank%' OR name ILIKE '%qris%');

UPDATE public.accounts 
SET sub_type = 'receivable' 
WHERE type = 'ASSET' AND (code LIKE '103%' OR name ILIKE '%piutang%');

UPDATE public.accounts 
SET sub_type = 'current_assets' 
WHERE type = 'ASSET' AND sub_type IS NULL AND (code LIKE '102%' OR name ILIKE '%persediaan%');

UPDATE public.accounts 
SET sub_type = 'fixed_assets' 
WHERE type = 'ASSET' AND sub_type IS NULL AND (code LIKE '12%' OR code LIKE '13%');

UPDATE public.accounts 
SET sub_type = 'current_assets' 
WHERE type = 'ASSET' AND sub_type IS NULL;

-- Kewajiban (LIABILITY)
UPDATE public.accounts 
SET sub_type = 'payable' 
WHERE type = 'LIABILITY' AND (code LIKE '201%' OR name ILIKE '%hutang%' OR name ILIKE '%utang%');

UPDATE public.accounts 
SET sub_type = 'current_liabilities' 
WHERE type = 'LIABILITY' AND sub_type IS NULL;

-- Ekuitas (EQUITY)
UPDATE public.accounts 
SET sub_type = 'equity' 
WHERE type = 'EQUITY';

-- Pendapatan (REVENUE)
UPDATE public.accounts 
SET sub_type = 'income' 
WHERE type = 'REVENUE' AND (code LIKE '401%' OR code LIKE '402%' OR code LIKE '403%');

UPDATE public.accounts 
SET sub_type = 'other_income' 
WHERE type = 'REVENUE' AND sub_type IS NULL;

-- Beban (EXPENSE)
UPDATE public.accounts 
SET sub_type = 'cogs' 
WHERE type = 'EXPENSE' AND (code LIKE '501%' OR name ILIKE '%harga pokok%' OR name ILIKE '%hpp%');

UPDATE public.accounts 
SET sub_type = 'expense' 
WHERE type = 'EXPENSE' AND sub_type IS NULL;
