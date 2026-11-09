-- Migration: 20261109120000_add_account_id_to_pos_shift_movements.sql
-- Description: Add account_id and transaction_id to pos_shift_movements for complete audit trail and ledger synchronization.

ALTER TABLE public.pos_shift_movements 
ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE public.pos_shift_movements 
ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

-- Index for speedy audit lookup
CREATE INDEX IF NOT EXISTS idx_pos_shift_movements_business_created 
ON public.pos_shift_movements (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_shift_movements_transaction_id 
ON public.pos_shift_movements (transaction_id);

