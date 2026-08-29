-- Migration: 20260829000000_add_description_to_journal_lines.sql
-- Description: Adds description text column to public.journal_lines table to support Odoo-style itemized journal line descriptions.

ALTER TABLE public.journal_lines ADD COLUMN IF NOT EXISTS description text;

-- Add comment on column
COMMENT ON COLUMN public.journal_lines.description IS 'Itemized line description/memo (Odoo account.move.line.name style)';
