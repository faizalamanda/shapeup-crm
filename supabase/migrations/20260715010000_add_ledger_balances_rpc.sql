-- Migration: 20260715010000_add_ledger_balances_rpc.sql
-- Description: Add indexes and public.get_ledger_balances RPC function for high-performance server-side aggregation

-- 1. Create B-Tree indexes for fast indexing on columns used in joining & filtering
CREATE INDEX IF NOT EXISTS idx_transactions_business_id_date ON public.transactions (business_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON public.transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_transaction_id ON public.journal_lines (transaction_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id ON public.journal_lines (account_id);

-- 2. Create the RPC function
CREATE OR REPLACE FUNCTION public.get_ledger_balances(
    p_business_id uuid,
    p_start_date timestamptz DEFAULT NULL,
    p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
    account_id uuid,
    debit_sum numeric,
    credit_sum numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id as account_id,
        COALESCE(sub.debit_sum, 0)::numeric as debit_sum,
        COALESCE(sub.credit_sum, 0)::numeric as credit_sum
    FROM public.accounts a
    LEFT JOIN (
        SELECT 
            jl.account_id,
            SUM(jl.debit) as debit_sum,
            SUM(jl.credit) as credit_sum
        FROM public.journal_lines jl
        JOIN public.transactions t ON jl.transaction_id = t.id
        WHERE t.business_id = p_business_id
          AND (p_start_date IS NULL OR t.date >= p_start_date)
          AND (p_end_date IS NULL OR t.date <= p_end_date)
        GROUP BY jl.account_id
    ) sub ON sub.account_id = a.id
    WHERE a.business_id = p_business_id;
END;
$$ LANGUAGE plpgsql;
