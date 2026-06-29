-- Migration: 20260629000000_ledger_multi_tenant.sql
-- Description: Add business_id to accounts & transactions, enable RLS with multi-tenant policies, and create balancing constraint trigger.

-- 1. ADD COLUMNS
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 2. ENABLE RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

-- 3. RLS POLICIES FOR ACCOUNTS
DROP POLICY IF EXISTS "Users can manage their own business accounts" ON public.accounts;
CREATE POLICY "Users can manage their own business accounts" ON public.accounts
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 4. RLS POLICIES FOR TRANSACTIONS
DROP POLICY IF EXISTS "Users can manage their own business transactions" ON public.transactions;
CREATE POLICY "Users can manage their own business transactions" ON public.transactions
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 5. RLS POLICIES FOR JOURNAL LINES
DROP POLICY IF EXISTS "Users can manage their own business journal lines" ON public.journal_lines;
CREATE POLICY "Users can manage their own business journal lines" ON public.journal_lines
    FOR ALL TO authenticated
    USING (transaction_id IN (
        SELECT id FROM public.transactions 
        WHERE business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    ))
    WITH CHECK (transaction_id IN (
        SELECT id FROM public.transactions 
        WHERE business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    ));

-- 6. BALANCING TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.check_transaction_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_debit_sum numeric;
    v_credit_sum numeric;
BEGIN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit_sum, v_credit_sum
    FROM public.journal_lines
    WHERE transaction_id = NEW.transaction_id;

    IF v_debit_sum <> v_credit_sum THEN
        RAISE EXCEPTION 'Transaksi tidak seimbang: Total Debit (%) tidak sama dengan Total Kredit (%) untuk transaction_id %',
            v_debit_sum, v_credit_sum, NEW.transaction_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. BALANCING TRIGGER
DROP TRIGGER IF EXISTS trg_check_transaction_balance ON public.journal_lines;

CREATE CONSTRAINT TRIGGER trg_check_transaction_balance
AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_transaction_balance();
