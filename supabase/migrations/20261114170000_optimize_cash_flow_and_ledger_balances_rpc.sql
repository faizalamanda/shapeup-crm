-- =============================================================================
-- Migration: 20261114170000_optimize_cash_flow_and_ledger_balances_rpc.sql
-- Description:
--   1. Add missing B-Tree indexes on payment subledgers (purchase_payments,
--      salary_payments) and transactions(business_id, order_id) to eliminate
--      sequential scans in NOT EXISTS and AR invoice payment joins.
--   2. Harden get_cash_flow_summary and get_ledger_balances with STABLE
--      SECURITY DEFINER and strict Multi-Tenant RBAC Guard Clause (AGENTS.md Rule 14)
--      to eliminate per-row RLS subquery evaluation across journal_lines.
--   3. Refactor get_cash_flow_summary to use single-pass CTE materialization
--      and single-pass starting/ending cash aggregation, while excluding voided
--      salary payments (sync with 20261103170000).
--   4. Refactor get_ledger_balances (Cash & Accrual Basis) with date predicate
--      pushdown into each UNION ALL branch and LATERAL join optimization.
-- =============================================================================

-- 1. Missing Subledger & Order Transaction Indexes
CREATE INDEX IF NOT EXISTS idx_purchase_payments_transaction_id
  ON public.purchase_payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_payments_business_id
  ON public.purchase_payments (business_id);

CREATE INDEX IF NOT EXISTS idx_salary_payments_transaction_id
  ON public.salary_payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_salary_payments_business_id
  ON public.salary_payments (business_id);

CREATE INDEX IF NOT EXISTS idx_transactions_biz_order_id
  ON public.transactions (business_id, order_id)
  WHERE order_id IS NOT NULL;


-- 2. Optimized get_cash_flow_summary RPC (Single-Pass CTE & SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_cash_flow_summary(
    p_business_id uuid,
    p_start_date timestamptz,
    p_end_date timestamptz
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_starting_cash numeric := 0;
    v_ending_cash numeric := 0;
    v_cash_account_ids uuid[];
    v_default_salary_account_id uuid;
    v_default_cogs_account_id uuid;
    v_ops_inflows json;
    v_ops_outflows_suppliers json;
    v_ops_outflows_expenses json;
    v_inv_outflows json;
    v_fin_flows json;
BEGIN
    -- Multi-Tenant Security Guard Clause (AGENTS.md Rule #14)
    IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
       AND current_user NOT IN ('postgres', 'service_role') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.businesses
            WHERE id = p_business_id AND owner_id = auth.uid()
            UNION
            SELECT 1 FROM public.business_staff
            WHERE business_id = p_business_id AND profile_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki akses ke unit bisnis ini.';
        END IF;
    END IF;

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

    IF v_cash_account_ids IS NULL OR array_length(v_cash_account_ids, 1) IS NULL THEN
        RETURN json_build_object(
            'starting_cash', 0,
            'ending_cash', 0,
            'net_change', 0,
            'ops_inflows', '[]'::json,
            'ops_outflows_suppliers', '[]'::json,
            'ops_outflows_expenses', '[]'::json,
            'inv_outflows', '[]'::json,
            'fin_flows', '[]'::json
        );
    END IF;

    -- Resolve fallback accounts once per invocation (0 per-row scalar subqueries)
    SELECT id INTO v_default_salary_account_id
    FROM public.accounts
    WHERE business_id = p_business_id
      AND (code = '503300' OR code = '503100' OR LOWER(name) LIKE '%gaji%')
    ORDER BY code ASC
    LIMIT 1;

    SELECT id INTO v_default_cogs_account_id
    FROM public.accounts
    WHERE business_id = p_business_id
      AND code = '501000'
    LIMIT 1;

    -- Single-Pass Starting & Ending Cash Balance Aggregation
    SELECT
        COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE t.date < p_start_date), 0),
        COALESCE(SUM(jl.debit - jl.credit), 0)
    INTO v_starting_cash, v_ending_cash
    FROM public.transactions t
    JOIN public.journal_lines jl ON jl.transaction_id = t.id
    WHERE t.business_id = p_business_id
      AND t.date <= p_end_date
      AND jl.account_id = ANY(v_cash_account_ids);

    -- Single-Pass CTE Materialization for Period Cash Flows
    WITH period_cash_txs AS MATERIALIZED (
        SELECT DISTINCT
            t.id AS transaction_id,
            (
                EXISTS (SELECT 1 FROM public.expense_payments ep WHERE ep.transaction_id = t.id)
                OR EXISTS (SELECT 1 FROM public.purchase_payments pp WHERE pp.transaction_id = t.id)
                OR EXISTS (
                    SELECT 1 FROM public.salary_payments sp
                    WHERE sp.transaction_id = t.id OR sp.reversal_transaction_id = t.id
                )
            ) AS is_subledger_payment
        FROM public.transactions t
        JOIN public.journal_lines jl_cash ON jl_cash.transaction_id = t.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date
          AND t.date <= p_end_date
          AND jl_cash.account_id = ANY(v_cash_account_ids)
    ),
    counter_lines AS MATERIALIZED (
        SELECT
            jl.account_id,
            jl.debit,
            jl.credit,
            pct.is_subledger_payment
        FROM period_cash_txs pct
        JOIN public.journal_lines jl ON jl.transaction_id = pct.transaction_id
        WHERE NOT (jl.account_id = ANY(v_cash_account_ids))
    ),
    ops_inflows_q AS (
        SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(cl.credit - cl.debit) AS amount
        FROM counter_lines cl
        JOIN public.accounts a ON cl.account_id = a.id
        WHERE NOT cl.is_subledger_payment
          AND (
              a.type = 'REVENUE'
              OR a.sub_type = 'receivable'
              OR (a.sub_type IS NULL AND (a.code LIKE '103%' OR LOWER(a.name) LIKE '%piutang%'))
          )
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(cl.credit - cl.debit) <> 0
        ORDER BY a.code ASC
    ),
    ops_expenses_q AS (
        SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(eff.amount) AS amount
        FROM (
            -- 1. Direct cash expense lines
            SELECT
                cl.account_id,
                (cl.debit - cl.credit) AS amount
            FROM counter_lines cl
            WHERE NOT cl.is_subledger_payment

            UNION ALL

            -- 2. Expense Payments mapped to expense category_account_id
            SELECT
                e.category_account_id AS account_id,
                ep.amount AS amount
            FROM public.transactions t
            JOIN public.expense_payments ep ON ep.transaction_id = t.id
            JOIN public.expenses e ON ep.expense_id = e.id
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date
              AND t.date <= p_end_date
              AND e.category_account_id IS NOT NULL

            UNION ALL

            -- 3. Active Salary Payments mapped to salary expense account
            SELECT
                COALESCE(jl_orig.account_id, v_default_salary_account_id) AS account_id,
                sp.amount AS amount
            FROM public.transactions t
            JOIN public.salary_payments sp ON sp.transaction_id = t.id
            JOIN public.employee_salaries s ON sp.salary_id = s.id
            LEFT JOIN public.journal_lines jl_orig
                ON jl_orig.transaction_id = s.transaction_id AND jl_orig.debit > 0
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date
              AND t.date <= p_end_date
              AND COALESCE(sp.status, 'active') = 'active'
              AND s.payment_status <> 'cancelled'
        ) eff
        JOIN public.accounts a ON eff.account_id = a.id
        WHERE a.type = 'EXPENSE'
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(eff.amount) <> 0
        ORDER BY a.code ASC
    ),
    ops_suppliers_q AS (
        SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(eff.amount) AS amount
        FROM (
            SELECT
                COALESCE(jl_orig.account_id, v_default_cogs_account_id) AS account_id,
                pp.amount AS amount
            FROM public.transactions t
            JOIN public.purchase_payments pp ON pp.transaction_id = t.id
            JOIN public.purchases p ON pp.purchase_id = p.id
            LEFT JOIN public.journal_lines jl_orig
                ON jl_orig.transaction_id = p.transaction_id AND jl_orig.debit > 0
            WHERE t.business_id = p_business_id
              AND t.date >= p_start_date
              AND t.date <= p_end_date

            UNION ALL

            SELECT
                cl.account_id,
                (cl.debit - cl.credit) AS amount
            FROM counter_lines cl
            WHERE NOT cl.is_subledger_payment
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
    ),
    inv_outflows_q AS (
        SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(cl.debit - cl.credit) AS amount
        FROM counter_lines cl
        JOIN public.accounts a ON cl.account_id = a.id
        WHERE a.type = 'ASSET'
          AND (
              a.sub_type IN ('fixed_assets', 'non_current_assets', 'other_assets')
              OR (a.sub_type IS NULL AND (a.code LIKE '12%' OR a.code LIKE '13%'))
          )
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(cl.debit - cl.credit) <> 0
        ORDER BY a.code ASC
    ),
    fin_flows_q AS (
        SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.type,
            a.sub_type,
            SUM(cl.credit - cl.debit) AS amount
        FROM counter_lines cl
        JOIN public.accounts a ON cl.account_id = a.id
        WHERE a.type = 'EQUITY'
        GROUP BY a.id, a.code, a.name, a.type, a.sub_type
        HAVING SUM(cl.credit - cl.debit) <> 0
        ORDER BY a.code ASC
    )
    SELECT
        (SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM ops_inflows_q r),
        (SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM ops_expenses_q r),
        (SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM ops_suppliers_q r),
        (SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM inv_outflows_q r),
        (SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM fin_flows_q r)
    INTO
        v_ops_inflows,
        v_ops_outflows_expenses,
        v_ops_outflows_suppliers,
        v_inv_outflows,
        v_fin_flows;

    RETURN json_build_object(
        'starting_cash', v_starting_cash,
        'ending_cash', v_ending_cash,
        'net_change', v_ending_cash - v_starting_cash,
        'ops_inflows', v_ops_inflows,
        'ops_outflows_suppliers', v_ops_outflows_suppliers,
        'ops_outflows_expenses', v_ops_outflows_expenses,
        'inv_outflows', v_inv_outflows,
        'fin_flows', v_fin_flows
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_flow_summary(uuid, timestamptz, timestamptz) TO authenticated, service_role;


-- 3. Optimized get_ledger_balances RPC (Predicate Pushdown & SECURITY DEFINER)
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
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cash_account_ids uuid[];
    v_default_salary_account_id uuid;
BEGIN
    -- Multi-Tenant Security Guard Clause (AGENTS.md Rule #14)
    IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
       AND current_user NOT IN ('postgres', 'service_role') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.businesses
            WHERE id = p_business_id AND owner_id = auth.uid()
            UNION
            SELECT 1 FROM public.business_staff
            WHERE business_id = p_business_id AND profile_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki akses ke unit bisnis ini.';
        END IF;
    END IF;

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

        SELECT id INTO v_default_salary_account_id
        FROM public.accounts
        WHERE business_id = p_business_id
          AND (code = '503300' OR code = '503100' OR LOWER(name) LIKE '%gaji%')
        ORDER BY code ASC
        LIMIT 1;

        RETURN QUERY
        SELECT 
            a.id AS account_id,
            COALESCE(sub.debit_sum, 0)::numeric AS debit_sum,
            COALESCE(sub.credit_sum, 0)::numeric AS credit_sum
        FROM public.accounts a
        LEFT JOIN (
            SELECT 
                raw_lines.account_id,
                SUM(raw_lines.debit) AS debit_sum,
                SUM(raw_lines.credit) AS credit_sum
            FROM (
                -- Case 1: Pure direct cash transactions (date predicate pushed down)
                SELECT 
                    jl.account_id,
                    jl.debit,
                    jl.credit
                FROM public.transactions t
                JOIN public.journal_lines jl ON jl.transaction_id = t.id
                JOIN public.accounts a_line ON jl.account_id = a_line.id
                WHERE t.business_id = p_business_id
                  AND (p_start_date IS NULL OR t.date >= p_start_date)
                  AND (p_end_date IS NULL OR t.date <= p_end_date)
                  AND a_line.type IN ('REVENUE', 'EXPENSE')
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
                  AND NOT EXISTS (SELECT 1 FROM public.expense_payments ep WHERE ep.transaction_id = t.id)
                  AND NOT EXISTS (SELECT 1 FROM public.purchase_payments pp WHERE pp.transaction_id = t.id)
                  AND NOT EXISTS (SELECT 1 FROM public.salary_payments sp WHERE sp.transaction_id = t.id OR sp.reversal_transaction_id = t.id)

                UNION ALL

                -- Case 2: Payments on Invoices (AR) with LATERAL single-pass AR total & date pushdown
                SELECT 
                    jl_sales.account_id,
                    (
                        CASE WHEN jl_pay.debit > 0 THEN -jl_sales.debit ELSE jl_sales.debit END
                        * (ABS(jl_pay.debit - jl_pay.credit) / COALESCE(NULLIF(ar_tot.total_ar, 0), 1))
                    )::numeric AS debit,
                    (
                        CASE WHEN jl_pay.debit > 0 THEN -jl_sales.credit ELSE jl_sales.credit END
                        * (ABS(jl_pay.debit - jl_pay.credit) / COALESCE(NULLIF(ar_tot.total_ar, 0), 1))
                    )::numeric AS credit
                FROM public.transactions t_pay
                JOIN public.journal_lines jl_pay ON jl_pay.transaction_id = t_pay.id
                JOIN public.accounts a_pay ON jl_pay.account_id = a_pay.id
                JOIN public.transactions t_sales
                    ON t_sales.business_id = t_pay.business_id
                   AND t_sales.order_id = t_pay.order_id
                   AND t_sales.id <> t_pay.id
                LEFT JOIN LATERAL (
                    SELECT SUM(ABS(jl_inner.debit - jl_inner.credit)) AS total_ar
                    FROM public.journal_lines jl_inner
                    WHERE jl_inner.transaction_id = t_sales.id
                      AND jl_inner.account_id = a_pay.id
                ) ar_tot ON true
                JOIN public.journal_lines jl_sales ON jl_sales.transaction_id = t_sales.id
                JOIN public.accounts a_sales ON jl_sales.account_id = a_sales.id
                WHERE t_pay.business_id = p_business_id
                  AND t_pay.order_id IS NOT NULL
                  AND (p_start_date IS NULL OR t_pay.date >= p_start_date)
                  AND (p_end_date IS NULL OR t_pay.date <= p_end_date)
                  AND (
                    a_pay.sub_type = 'receivable' 
                    OR (a_pay.sub_type IS NULL AND (a_pay.code = '103000' OR LOWER(a_pay.name) LIKE '%piutang%'))
                  )
                  AND a_sales.type IN ('REVENUE', 'EXPENSE')
                  AND COALESCE(t_sales.description, '') NOT LIKE '%Pembayaran%'
                  AND COALESCE(t_sales.description, '') NOT LIKE '%Pelunasan%'
                  AND (
                      (
                          COALESCE(t_pay.description, '') NOT LIKE '%Pembatalan%' AND COALESCE(t_pay.description, '') NOT LIKE '%Retur%' AND COALESCE(t_pay.description, '') NOT LIKE '%Refund%' AND COALESCE(t_pay.description, '') NOT LIKE '%Reversal%'
                          AND COALESCE(t_sales.description, '') NOT LIKE '%Pembatalan%' AND COALESCE(t_sales.description, '') NOT LIKE '%Retur%' AND COALESCE(t_sales.description, '') NOT LIKE '%Refund%' AND COALESCE(t_sales.description, '') NOT LIKE '%Reversal%'
                      )
                      OR
                      (
                          (COALESCE(t_pay.description, '') LIKE '%Pembatalan%' OR COALESCE(t_pay.description, '') LIKE '%Retur%' OR COALESCE(t_pay.description, '') LIKE '%Refund%' OR COALESCE(t_pay.description, '') LIKE '%Reversal%')
                          AND (COALESCE(t_sales.description, '') LIKE '%Pembatalan%' OR COALESCE(t_sales.description, '') LIKE '%Retur%' OR COALESCE(t_sales.description, '') LIKE '%Refund%' OR COALESCE(t_sales.description, '') LIKE '%Reversal%')
                      )
                  )

                UNION ALL

                -- Case 3: Payments on Expenses (AP) with date pushdown
                SELECT 
                    e.category_account_id AS account_id,
                    ep.amount AS debit,
                    0::numeric AS credit
                FROM public.transactions t_pay
                JOIN public.expense_payments ep ON ep.transaction_id = t_pay.id
                JOIN public.expenses e ON ep.expense_id = e.id
                WHERE t_pay.business_id = p_business_id
                  AND (p_start_date IS NULL OR t_pay.date >= p_start_date)
                  AND (p_end_date IS NULL OR t_pay.date <= p_end_date)

                UNION ALL

                -- Case 4: Payments on Purchases (AP) with date pushdown
                SELECT 
                    jl_orig.account_id,
                    (jl_orig.debit * (pp.amount / COALESCE(NULLIF(p.grand_total, 0), 1)))::numeric AS debit,
                    (jl_orig.credit * (pp.amount / COALESCE(NULLIF(p.grand_total, 0), 1)))::numeric AS credit
                FROM public.transactions t_pay
                JOIN public.purchase_payments pp ON pp.transaction_id = t_pay.id
                JOIN public.purchases p ON pp.purchase_id = p.id
                JOIN public.transactions t_orig ON p.transaction_id = t_orig.id
                JOIN public.journal_lines jl_orig ON jl_orig.transaction_id = t_orig.id
                JOIN public.accounts a_orig ON jl_orig.account_id = a_orig.id
                WHERE t_pay.business_id = p_business_id
                  AND (p_start_date IS NULL OR t_pay.date >= p_start_date)
                  AND (p_end_date IS NULL OR t_pay.date <= p_end_date)
                  AND a_orig.type IN ('REVENUE', 'EXPENSE')

                UNION ALL

                -- Case 5: Active Payments on Salaries (AP) with date pushdown
                SELECT 
                    COALESCE(jl_orig.account_id, v_default_salary_account_id) AS account_id,
                    sp.amount AS debit,
                    0::numeric AS credit
                FROM public.transactions t_pay
                JOIN public.salary_payments sp ON sp.transaction_id = t_pay.id
                JOIN public.employee_salaries s ON sp.salary_id = s.id
                LEFT JOIN public.journal_lines jl_orig
                    ON jl_orig.transaction_id = s.transaction_id AND jl_orig.debit > 0
                WHERE t_pay.business_id = p_business_id
                  AND (p_start_date IS NULL OR t_pay.date >= p_start_date)
                  AND (p_end_date IS NULL OR t_pay.date <= p_end_date)
                  AND COALESCE(sp.status, 'active') = 'active'
                  AND s.payment_status <> 'cancelled'
            ) raw_lines
            GROUP BY raw_lines.account_id
        ) sub ON sub.account_id = a.id
        WHERE a.business_id = p_business_id;
    ELSE
        -- Accrual Basis
        RETURN QUERY
        SELECT 
            a.id AS account_id,
            COALESCE(sub.debit_sum, 0)::numeric AS debit_sum,
            COALESCE(sub.credit_sum, 0)::numeric AS credit_sum
        FROM public.accounts a
        LEFT JOIN (
            SELECT 
                jl.account_id,
                SUM(jl.debit) AS debit_sum,
                SUM(jl.credit) AS credit_sum
            FROM public.transactions t
            JOIN public.journal_lines jl ON jl.transaction_id = t.id
            WHERE t.business_id = p_business_id
              AND (p_start_date IS NULL OR t.date >= p_start_date)
              AND (p_end_date IS NULL OR t.date <= p_end_date)
            GROUP BY jl.account_id
        ) sub ON sub.account_id = a.id
        WHERE a.business_id = p_business_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ledger_balances(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

