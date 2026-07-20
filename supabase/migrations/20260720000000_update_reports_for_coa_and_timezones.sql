-- Migration: 20260720000000_update_reports_for_coa_and_timezones.sql
-- Description: Update get_cash_flow_summary and get_ledger_balances RPCs to trace expense, purchase, and salary payment accounts to their actual expense COA accounts (e.g. 501001 Biaya Performance Ads) under Operating Expenses.

-- 1. UPDATE get_cash_flow_summary RPC
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
    -- Identify Cash & Bank accounts based on COA sub_type = 'bank_cash' or fallback code/name
    SELECT array_agg(id) INTO v_cash_account_ids
    FROM public.accounts
    WHERE business_id = p_business_id
      AND type = 'ASSET'
      AND (
        sub_type = 'bank_cash' OR
        (sub_type IS NULL AND (
          code LIKE '101%' OR 
          code LIKE '1100%' OR
          LOWER(name) LIKE '%kas%' OR
          LOWER(name) LIKE '%bank%' OR
          LOWER(name) LIKE '%qris%'
        ))
      );

    IF v_cash_account_ids IS NULL THEN
        v_cash_account_ids := '{}';
    END IF;

    -- Calculate Starting Cash Balance
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_starting_cash
    FROM public.journal_lines jl
    JOIN public.transactions t ON jl.transaction_id = t.id
    WHERE t.business_id = p_business_id
      AND jl.account_id = ANY(v_cash_account_ids)
      AND t.date < p_start_date;

    -- Calculate Ending Cash Balance
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_ending_cash
    FROM public.journal_lines jl
    JOIN public.transactions t ON jl.transaction_id = t.id
    WHERE t.business_id = p_business_id
      AND jl.account_id = ANY(v_cash_account_ids)
      AND t.date <= p_end_date;

    -- Operating Inflows (Revenue or Accounts Receivable)
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_ops_inflows
    FROM (
        SELECT 
            a.id as account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(eff.amount) as amount
        FROM (
            SELECT 
                jl.account_id,
                (jl.credit - jl.debit) as amount
            FROM public.journal_lines jl
            JOIN public.transactions t ON jl.transaction_id = t.id
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date AND t.date <= p_end_date
              AND EXISTS (
                  SELECT 1 FROM public.journal_lines jl2
                  WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
              )
              AND NOT (jl.account_id = ANY(v_cash_account_ids))
              AND NOT EXISTS (SELECT 1 FROM public.expense_payments ep WHERE ep.transaction_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM public.purchase_payments pp WHERE pp.transaction_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM public.salary_payments sp WHERE sp.transaction_id = t.id)
        ) eff
        JOIN public.accounts a ON eff.account_id = a.id
        WHERE a.type = 'REVENUE' 
           OR a.sub_type = 'receivable'
           OR (a.sub_type IS NULL AND (a.code LIKE '103%' OR LOWER(a.name) LIKE '%piutang%'))
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(eff.amount) <> 0
        ORDER BY a.code ASC
    ) r;

    -- Operating Outflows: Expenses (Expense Payments mapped to category_account_id e.g. 501001 Biaya Performance Ads, Salary Payments, Direct Expense lines)
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_ops_outflows_expenses
    FROM (
        SELECT 
            a.id as account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(eff.amount) as amount
        FROM (
            -- 1. Direct cash expense lines
            SELECT 
                jl.account_id,
                (jl.debit - jl.credit) as amount
            FROM public.journal_lines jl
            JOIN public.transactions t ON jl.transaction_id = t.id
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date AND t.date <= p_end_date
              AND EXISTS (
                  SELECT 1 FROM public.journal_lines jl2
                  WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
              )
              AND NOT (jl.account_id = ANY(v_cash_account_ids))
              AND NOT EXISTS (SELECT 1 FROM public.expense_payments ep WHERE ep.transaction_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM public.purchase_payments pp WHERE pp.transaction_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM public.salary_payments sp WHERE sp.transaction_id = t.id)

            UNION ALL

            -- 2. Expense Payments mapped to expense category_account_id (e.g. 501001 Biaya Performance Ads)
            SELECT 
                e.category_account_id as account_id,
                ep.amount as amount
            FROM public.expense_payments ep
            JOIN public.transactions t ON ep.transaction_id = t.id
            JOIN public.expenses e ON ep.expense_id = e.id
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date AND t.date <= p_end_date
              AND e.category_account_id IS NOT NULL

            UNION ALL

            -- 3. Salary Payments mapped to salary expense account
            SELECT 
                COALESCE(
                    jl_orig.account_id, 
                    (SELECT id FROM public.accounts WHERE business_id = t.business_id AND (code = '503100' OR LOWER(name) LIKE '%gaji%') LIMIT 1)
                ) as account_id,
                sp.amount as amount
            FROM public.salary_payments sp
            JOIN public.transactions t ON sp.transaction_id = t.id
            JOIN public.employee_salaries s ON sp.salary_id = s.id
            LEFT JOIN public.journal_lines jl_orig ON jl_orig.transaction_id = s.transaction_id AND jl_orig.debit > 0
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date AND t.date <= p_end_date
        ) eff
        JOIN public.accounts a ON eff.account_id = a.id
        WHERE a.type = 'EXPENSE'
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(eff.amount) <> 0
        ORDER BY a.code ASC
    ) r;

    -- Operating Outflows: Suppliers (Purchase payments & AP for inventory/purchases)
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_ops_outflows_suppliers
    FROM (
        SELECT 
            a.id as account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(eff.amount) as amount
        FROM (
            SELECT 
                COALESCE(
                    jl_orig.account_id, 
                    (SELECT id FROM public.accounts WHERE business_id = p_business_id AND code = '501000' LIMIT 1)
                ) as account_id,
                pp.amount as amount
            FROM public.purchase_payments pp
            JOIN public.transactions t ON pp.transaction_id = t.id
            JOIN public.purchases p ON pp.purchase_id = p.id
            LEFT JOIN public.journal_lines jl_orig ON jl_orig.transaction_id = p.transaction_id AND jl_orig.debit > 0
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date AND t.date <= p_end_date

            UNION ALL

            SELECT 
                jl.account_id,
                (jl.debit - jl.credit) as amount
            FROM public.journal_lines jl
            JOIN public.transactions t ON jl.transaction_id = t.id
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date AND t.date <= p_end_date
              AND EXISTS (
                  SELECT 1 FROM public.journal_lines jl2
                  WHERE jl2.transaction_id = t.id AND jl2.account_id = ANY(v_cash_account_ids)
              )
              AND NOT (jl.account_id = ANY(v_cash_account_ids))
              AND NOT EXISTS (SELECT 1 FROM public.expense_payments ep WHERE ep.transaction_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM public.purchase_payments pp WHERE pp.transaction_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM public.salary_payments sp WHERE sp.transaction_id = t.id)
        ) eff
        JOIN public.accounts a ON eff.account_id = a.id
        WHERE (
            a.sub_type IN ('payable', 'cogs')
            OR (a.type = 'ASSET' AND a.sub_type = 'current_assets')
            OR (a.sub_type IS NULL AND (
                a.code LIKE '201%' OR LOWER(a.name) LIKE '%pemasok%' OR a.code = '501000' OR LOWER(a.name) LIKE '%persediaan%'
            ))
        )
        AND a.type <> 'EXPENSE'
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(eff.amount) <> 0
        ORDER BY a.code ASC
    ) r;

    -- Investing Outflows: Fixed Assets
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_inv_outflows
    FROM (
        SELECT 
            a.id as account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
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
          AND NOT (jl.account_id = ANY(v_cash_account_ids))
          AND a.type = 'ASSET'
          AND (
              a.sub_type IN ('fixed_assets', 'non_current_assets', 'other_assets')
              OR (a.sub_type IS NULL AND (a.code LIKE '12%' OR a.code LIKE '13%'))
          )
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(jl.debit - jl.credit) <> 0
        ORDER BY a.code ASC
    ) r;

    -- Financing flows: Equity / Loans
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_fin_flows
    FROM (
        SELECT 
            a.id as account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
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
          AND NOT (jl.account_id = ANY(v_cash_account_ids))
          AND a.type = 'EQUITY'
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(jl.credit - jl.debit) <> 0
        ORDER BY a.code ASC
    ) r;

    -- Build final result JSON
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

-- 2. UPDATE get_ledger_balances RPC
CREATE OR REPLACE FUNCTION public.get_ledger_balances(
    p_business_id uuid,
    p_start_date timestamptz DEFAULT NULL,
    p_end_date timestamptz DEFAULT NULL,
    p_basis text DEFAULT 'accrual'
)
RETURNS TABLE (
    account_id uuid,
    debit_sum numeric,
    credit_sum numeric
) AS $$
DECLARE
    v_cash_account_ids uuid[];
BEGIN
    IF p_basis = 'cash' THEN
        SELECT array_agg(id) INTO v_cash_account_ids
        FROM public.accounts
        WHERE business_id = p_business_id
          AND type = 'ASSET'
          AND (
            sub_type = 'bank_cash' OR
            (sub_type IS NULL AND (
              code LIKE '101%' OR 
              code LIKE '1100%' OR
              LOWER(name) LIKE '%kas%' OR
              LOWER(name) LIKE '%bank%' OR
              LOWER(name) LIKE '%qris%'
            ))
          );

        IF v_cash_account_ids IS NULL THEN
            v_cash_account_ids := '{}';
        END IF;

        RETURN QUERY
        SELECT 
            a.id as account_id,
            COALESCE(sub.debit_sum, 0)::numeric as debit_sum,
            COALESCE(sub.credit_sum, 0)::numeric as credit_sum
        FROM public.accounts a
        LEFT JOIN (
            SELECT 
                raw_lines.account_id,
                SUM(raw_lines.debit) as debit_sum,
                SUM(raw_lines.credit) as credit_sum
            FROM (
                -- Case 1: Pure direct cash transactions (no AR/AP involved)
                SELECT 
                    jl.account_id,
                    jl.debit,
                    jl.credit,
                    t.date
                FROM public.journal_lines jl
                JOIN public.transactions t ON jl.transaction_id = t.id
                JOIN public.accounts a ON jl.account_id = a.id
                WHERE t.business_id = p_business_id
                  AND a.type IN ('REVENUE', 'EXPENSE')
                  AND EXISTS (
                      SELECT 1 FROM public.journal_lines jl2
                      WHERE jl2.transaction_id = t.id 
                        AND jl2.account_id = ANY(v_cash_account_ids)
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM public.journal_lines jl3
                      JOIN public.accounts a3 ON jl3.account_id = a3.id
                      WHERE jl3.transaction_id = t.id 
                        AND (
                          a3.sub_type IN ('receivable', 'payable', 'current_liabilities', 'salary_payable')
                          OR (a3.sub_type IS NULL AND (
                            a3.code IN ('103000', '201000', '201100') OR 
                            LOWER(a3.name) LIKE '%piutang%' OR 
                            LOWER(a3.name) LIKE '%hutang%' OR 
                            LOWER(a3.name) LIKE '%utang%'
                          ))
                        )
                  )

                UNION ALL

                -- Case 2: Payments on Invoices (AR)
                SELECT 
                    jl_sales.account_id,
                    (CASE WHEN jl_pay.debit > 0 THEN -jl_sales.debit ELSE jl_sales.debit END * (ABS(jl_pay.debit - jl_pay.credit) / COALESCE(NULLIF((SELECT SUM(ABS(jl_inner.debit - jl_inner.credit)) FROM public.journal_lines jl_inner WHERE jl_inner.transaction_id = t_sales.id AND jl_inner.account_id = a_pay.id), 0), 1)))::numeric as debit,
                    (CASE WHEN jl_pay.debit > 0 THEN -jl_sales.credit ELSE jl_sales.credit END * (ABS(jl_pay.debit - jl_pay.credit) / COALESCE(NULLIF((SELECT SUM(ABS(jl_inner.debit - jl_inner.credit)) FROM public.journal_lines jl_inner WHERE jl_inner.transaction_id = t_sales.id AND jl_inner.account_id = a_pay.id), 0), 1)))::numeric as credit,
                    t_pay.date
                FROM public.transactions t_pay
                JOIN public.journal_lines jl_pay ON jl_pay.transaction_id = t_pay.id
                JOIN public.accounts a_pay ON jl_pay.account_id = a_pay.id
                JOIN public.transactions t_sales ON t_sales.order_id = t_pay.order_id AND t_sales.id <> t_pay.id
                JOIN public.journal_lines jl_sales ON jl_sales.transaction_id = t_sales.id
                JOIN public.accounts a_sales ON jl_sales.account_id = a_sales.id
                WHERE t_pay.business_id = p_business_id
                  AND (
                    a_pay.sub_type = 'receivable' 
                    OR (a_pay.sub_type IS NULL AND (a_pay.code = '103000' OR LOWER(a_pay.name) LIKE '%piutang%'))
                  )
                  AND a_sales.type IN ('REVENUE', 'EXPENSE')
                  AND t_sales.description NOT LIKE '%Pembayaran%'
                  AND t_sales.description NOT LIKE '%Pelunasan%'
                  AND (
                      (
                          t_pay.description NOT LIKE '%Pembatalan%' AND t_pay.description NOT LIKE '%Retur%' AND t_pay.description NOT LIKE '%Refund%' AND t_pay.description NOT LIKE '%Reversal%'
                          AND t_sales.description NOT LIKE '%Pembatalan%' AND t_sales.description NOT LIKE '%Retur%' AND t_sales.description NOT LIKE '%Refund%' AND t_sales.description NOT LIKE '%Reversal%'
                      )
                      OR
                      (
                          (t_pay.description LIKE '%Pembatalan%' OR t_pay.description LIKE '%Retur%' OR t_pay.description LIKE '%Refund%' OR t_pay.description LIKE '%Reversal%')
                          AND (t_sales.description LIKE '%Pembatalan%' OR t_sales.description LIKE '%Retur%' OR t_sales.description LIKE '%Refund%' OR t_sales.description LIKE '%Reversal%')
                      )
                  )

                UNION ALL

                -- Case 3: Payments on Expenses (AP) -> Maps to expense category_account_id!
                SELECT 
                    e.category_account_id as account_id,
                    ep.amount as debit,
                    0 as credit,
                    t_pay.date
                FROM public.expense_payments ep
                JOIN public.transactions t_pay ON ep.transaction_id = t_pay.id
                JOIN public.expenses e ON ep.expense_id = e.id
                WHERE t_pay.business_id = p_business_id

                UNION ALL

                -- Case 4: Payments on Purchases (AP)
                SELECT 
                    jl_orig.account_id,
                    (jl_orig.debit * (pp.amount / COALESCE(NULLIF(p.grand_total, 0), 1))) as debit,
                    (jl_orig.credit * (pp.amount / COALESCE(NULLIF(p.grand_total, 0), 1))) as credit,
                    t_pay.date
                FROM public.purchase_payments pp
                JOIN public.transactions t_pay ON pp.transaction_id = t_pay.id
                JOIN public.purchases p ON pp.purchase_id = p.id
                JOIN public.transactions t_orig ON p.transaction_id = t_orig.id
                JOIN public.journal_lines jl_orig ON jl_orig.transaction_id = t_orig.id
                JOIN public.accounts a_orig ON jl_orig.account_id = a_orig.id
                WHERE t_pay.business_id = p_business_id
                  AND a_orig.type IN ('REVENUE', 'EXPENSE')

                UNION ALL

                -- Case 5: Payments on Salaries (AP)
                SELECT 
                    COALESCE(
                        jl_orig.account_id, 
                        (SELECT id FROM public.accounts WHERE business_id = t_pay.business_id AND (code = '503100' OR LOWER(name) LIKE '%gaji%') LIMIT 1)
                    ) as account_id,
                    sp.amount as debit,
                    0 as credit,
                    t_pay.date
                FROM public.salary_payments sp
                JOIN public.transactions t_pay ON sp.transaction_id = t_pay.id
                JOIN public.employee_salaries s ON sp.salary_id = s.id
                LEFT JOIN public.journal_lines jl_orig ON jl_orig.transaction_id = s.transaction_id AND jl_orig.debit > 0
                WHERE t_pay.business_id = p_business_id
            ) raw_lines
            WHERE (p_start_date IS NULL OR raw_lines.date >= p_start_date)
              AND (p_end_date IS NULL OR raw_lines.date <= p_end_date)
            GROUP BY raw_lines.account_id
        ) sub ON sub.account_id = a.id
        WHERE a.business_id = p_business_id;
    ELSE
        -- Accrual Basis
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
    END IF;
END;
$$ LANGUAGE plpgsql;
