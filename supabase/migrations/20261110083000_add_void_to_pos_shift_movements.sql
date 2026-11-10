-- Migration: 20261110083000_add_void_to_pos_shift_movements.sql
-- Description: Add status, void_reason, voided_at, voided_by, and reversal_transaction_id to pos_shift_movements for audit trail and void capability.

ALTER TABLE public.pos_shift_movements 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided'));

ALTER TABLE public.pos_shift_movements 
ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.pos_shift_movements 
ADD COLUMN IF NOT EXISTS voided_at timestamp with time zone;

ALTER TABLE public.pos_shift_movements 
ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.pos_shift_movements 
ADD COLUMN IF NOT EXISTS reversal_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

-- Performance index for shift detail lookup and metric aggregations
CREATE INDEX IF NOT EXISTS idx_pos_shift_movements_shift_status 
ON public.pos_shift_movements (shift_id, status);

