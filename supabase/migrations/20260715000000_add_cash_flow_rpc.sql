-- Migration: 20260715000000_add_cash_flow_rpc.sql
-- Description: Add server-side aggregation for Cash Flow report

CREATE OR REPLACE FUNCTION public.get_cash_flow_summary(
    p_business_id uuid,
    p_start_date timestamptz,
    p_end_date timestamptz
)
RETURNS json AS $$
DECLARE
    v_starting_cash numeric := 0;
    v_ending_cash numeric := 0;
    v_cash_account_ids uuid[];
    v_ops_inflows json;
    v_ops_outflows_suppliers json;
    v_ops_outflows_expenses json;
    v_inv_outflows json;
    v_fin_flows json;
    v_result json;
BEGIN
    -- 1. Identify Cash & Bank accounts
    SELECT array_agg(id) INTO v_cash_account_ids
    FROM public.accounts
    WHERE business_id = p_business_id
      AND type = 'ASSET'
      AND (
        code LIKE '101%' OR 
        code LIKE '1100%' OR
        LOWER(name) LIKE '%kas%' OR
        LOWER(name) LIKE '%bank%' OR
        LOWER(name) LIKE '%qris%'
      );

    IF v_cash_account_ids IS NULL THEN
        v_cash_account_ids := '{}';
    END IF;

    -- 2. Calculate Starting Cash Balance
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_starting_cash
    FROM public.journal_lines jl
    JOIN public.transactions t ON jl.transaction_id = t.id
    WHERE t.business_id = p_business_id
      AND jl.account_id = ANY(v_cash_account_ids)
      AND t.date < p_start_date;

    -- 3. Calculate Ending Cash Balance
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_ending_cash
    FROM public.journal_lines jl
    JOIN public.transactions t ON jl.transaction_id = t.id
    WHERE t.business_id = p_business_id
      AND jl.account_id = ANY(v_cash_account_ids)
      AND t.date <= p_end_date;

    -- 4. Aggregate flows using opposing non-cash lines
    -- Operating Inflows (Revenue or Accounts Receivable)
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_ops_inflows
    FROM (
        SELECT 
            a.code,
            a.name,
            SUM(jl.credit - jl.debit) as amount
        FROM public.journal_lines jl
        JOIN public.transactions t ON jl.transaction_id = t.id
        JOIN public.accounts a ON jl.account_id = a.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date AND t.date <= p_end_date
          -- Transaction has cash impact
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl2
              WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
          )
          -- Exclude internal transfers (must have non-cash lines)
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl3
              WHERE jl3.transaction_id = t.id AND NOT (jl3.account_id = ANY(v_cash_account_ids))
          )
          AND NOT (jl.account_id = ANY(v_cash_account_ids))
          -- Operating Inflow filter: REVENUE or Piutang
          AND (a.type = 'REVENUE' OR a.code LIKE '103%' OR LOWER(a.name) LIKE '%piutang%')
        GROUP BY a.code, a.name
        HAVING SUM(jl.credit - jl.debit) <> 0
    ) r;

    -- Operating Outflows: Suppliers (AP, persediaan, HPP, hutang)
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_ops_outflows_suppliers
    FROM (
        SELECT 
            a.code,
            a.name,
            -- For outflows, accumulate absolute cash outflow
            SUM(jl.debit - jl.credit) as amount
        FROM public.journal_lines jl
        JOIN public.transactions t ON jl.transaction_id = t.id
        JOIN public.accounts a ON jl.account_id = a.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date AND t.date <= p_end_date
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl2
              WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
          )
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl3
              WHERE jl3.transaction_id = t.id AND NOT (jl3.account_id = ANY(v_cash_account_ids))
          )
          AND NOT (jl.account_id = ANY(v_cash_account_ids))
          AND (a.code LIKE '201%' OR LOWER(a.name) LIKE '%hutang%' OR LOWER(a.name) LIKE '%pemasok%' OR a.code = '501000' OR LOWER(a.name) LIKE '%persediaan%')
        GROUP BY a.code, a.name
        HAVING SUM(jl.debit - jl.credit) <> 0
    ) r;

    -- Operating Outflows: Expenses
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_ops_outflows_expenses
    FROM (
        SELECT 
            a.code,
            a.name,
            SUM(jl.debit - jl.credit) as amount
        FROM public.journal_lines jl
        JOIN public.transactions t ON jl.transaction_id = t.id
        JOIN public.accounts a ON jl.account_id = a.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date AND t.date <= p_end_date
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl2
              WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
          )
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl3
              WHERE jl3.transaction_id = t.id AND NOT (jl3.account_id = ANY(v_cash_account_ids))
          )
          AND NOT (jl.account_id = ANY(v_cash_account_ids))
          AND a.type = 'EXPENSE'
          AND NOT (a.code = '501000' OR LOWER(a.name) LIKE '%persediaan%') -- Exclude HPP/persediaan as they are in supplier outflows
        GROUP BY a.code, a.name
        HAVING SUM(jl.debit - jl.credit) <> 0
    ) r;

    -- Investing Outflows: Fixed assets (Asset code starting with 12)
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_inv_outflows
    FROM (
        SELECT 
            a.code,
            a.name,
            SUM(jl.debit - jl.credit) as amount
        FROM public.journal_lines jl
        JOIN public.transactions t ON jl.transaction_id = t.id
        JOIN public.accounts a ON jl.account_id = a.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date AND t.date <= p_end_date
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl2
              WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
          )
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl3
              WHERE jl3.transaction_id = t.id AND NOT (jl3.account_id = ANY(v_cash_account_ids))
          )
          AND NOT (jl.account_id = ANY(v_cash_account_ids))
          AND a.type = 'ASSET' AND a.code LIKE '12%'
        GROUP BY a.code, a.name
        HAVING SUM(jl.debit - jl.credit) <> 0
    ) r;

    -- Financing flows (Other accounts, like modal / equity, non-current liabilities)
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_fin_flows
    FROM (
        SELECT 
            a.code,
            a.name,
            -- financing flow can be positive or negative
            SUM(jl.credit - jl.debit) as amount
        FROM public.journal_lines jl
        JOIN public.transactions t ON jl.transaction_id = t.id
        JOIN public.accounts a ON jl.account_id = a.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date AND t.date <= p_end_date
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl2
              WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
          )
          AND EXISTS (
              SELECT 1 FROM public.journal_lines jl3
              WHERE jl3.transaction_id = t.id AND NOT (jl3.account_id = ANY(v_cash_account_ids))
          )
          AND NOT (jl.account_id = ANY(v_cash_account_ids))
          -- Filter: not operating revenue/AR, not operating supplier (AP/inventory/HPP), not operating expense, not investing
          AND NOT (a.type = 'REVENUE' OR a.code LIKE '103%' OR LOWER(a.name) LIKE '%piutang%')
          AND NOT (a.code LIKE '201%' OR LOWER(a.name) LIKE '%hutang%' OR LOWER(a.name) LIKE '%pemasok%' OR a.code = '501000' OR LOWER(a.name) LIKE '%persediaan%')
          AND NOT (a.type = 'EXPENSE')
          AND NOT (a.type = 'ASSET' AND a.code LIKE '12%')
        GROUP BY a.code, a.name
        HAVING SUM(jl.credit - jl.debit) <> 0
    ) r;

    -- 5. Combine results into JSON
    v_result := json_build_object(
        'starting_cash', v_starting_cash,
        'ending_cash', v_ending_cash,
        'net_change', v_ending_cash - v_starting_cash,
        'ops_inflows', v_ops_inflows,
        'ops_outflows_suppliers', v_ops_outflows_suppliers,
        'ops_outflows_expenses', v_ops_outflows_expenses,
        'inv_outflows', v_inv_outflows,
        'fin_flows', v_fin_flows
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;
