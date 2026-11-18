-- ============================================================================
-- Migration: Add get_ap_ar_summary RPC for Cash Flow Dashboard AP/AR Visibility
-- Description:
--   1. Multi-Tenant Security Guard (AGENTS.md Rule #14)
--   2. Journal-First Single Source of Truth (COA / journal_lines):
--      - AR (Piutang Usaha): ASSET accounts with sub_type = 'receivable'
--        (or code LIKE '103%' / name LIKE '%piutang%'), balance = SUM(debit - credit)
--      - AP (Hutang Usaha & Gaji): LIABILITY accounts with sub_type = 'payable'
--        (or code LIKE '201%' / name LIKE '%hutang%' excluding tax/unearned),
--        balance = SUM(credit - debit), broken down into 201000 vs 201100
--      This guarantees exact 1:1 parity with Neraca (Balance Sheet).
--   3. Document Aging Breakdown (orders, purchases, expenses):
--      - Computes Overdue (due_date < today) & Due Soon (today..today+7)
--      - Exposes doc_outstanding_amount alongside ledger_outstanding_amount
--        for transparent reconciliation of manual journals / unposted docs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ap_ar_summary(
    p_business_id uuid,
    p_timezone text DEFAULT 'Asia/Jakarta'
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz text := COALESCE(NULLIF(TRIM(p_timezone), ''), 'Asia/Jakarta');
    v_today date;
    v_due_soon_end date;

    -- Ledger (COA / journal_lines) totals
    v_ar_account_ids uuid[];
    v_ap_account_ids uuid[];
    v_ap_salary_account_ids uuid[];
    v_ar_ledger_amount numeric := 0;
    v_ap_ledger_amount numeric := 0;
    v_ap_salary_ledger_amount numeric := 0;

    -- Document (orders / purchases / expenses) totals & aging
    v_ar_doc_amount numeric := 0;
    v_ar_doc_count bigint := 0;
    v_ar_overdue_amount numeric := 0;
    v_ar_overdue_count bigint := 0;
    v_ar_due_soon_amount numeric := 0;
    v_ar_due_soon_count bigint := 0;

    v_ap_doc_amount numeric := 0;
    v_ap_doc_count bigint := 0;
    v_ap_overdue_amount numeric := 0;
    v_ap_overdue_count bigint := 0;
    v_ap_due_soon_amount numeric := 0;
    v_ap_due_soon_count bigint := 0;
    v_ap_purchases_amount numeric := 0;
    v_ap_purchases_count bigint := 0;
    v_ap_expenses_amount numeric := 0;
    v_ap_expenses_count bigint := 0;
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

    v_today := (NOW() AT TIME ZONE v_tz)::date;
    v_due_soon_end := v_today + 7;

    -- 1. Identify AR & AP COA accounts consistently with Balance Sheet
    SELECT array_agg(id) INTO v_ar_account_ids
    FROM public.accounts
    WHERE business_id = p_business_id
      AND type = 'ASSET'
      AND (
        sub_type = 'receivable' OR
        (sub_type IS NULL AND (code LIKE '103%' OR LOWER(name) LIKE '%piutang%'))
      );

    SELECT
        array_agg(id),
        array_agg(id) FILTER (WHERE code LIKE '2011%' OR LOWER(name) LIKE '%gaji%')
    INTO v_ap_account_ids, v_ap_salary_account_ids
    FROM public.accounts
    WHERE business_id = p_business_id
      AND type = 'LIABILITY'
      AND (
        sub_type = 'payable' OR
        (sub_type IS NULL AND (code LIKE '2010%' OR code LIKE '2011%' OR LOWER(name) LIKE '%hutang usaha%' OR LOWER(name) LIKE '%hutang gaji%'))
      );

    -- 2. Compute exact General Ledger balances from journal_lines (1:1 with Neraca)
    IF v_ar_account_ids IS NOT NULL AND array_length(v_ar_account_ids, 1) > 0 THEN
        SELECT COALESCE(SUM(jl.debit - jl.credit), 0)
        INTO v_ar_ledger_amount
        FROM public.journal_lines jl
        JOIN public.transactions t ON t.id = jl.transaction_id
        WHERE t.business_id = p_business_id
          AND jl.account_id = ANY(v_ar_account_ids);
    END IF;

    IF v_ap_account_ids IS NOT NULL AND array_length(v_ap_account_ids, 1) > 0 THEN
        SELECT
            COALESCE(SUM(jl.credit - jl.debit), 0),
            COALESCE(SUM(jl.credit - jl.debit) FILTER (
                WHERE v_ap_salary_account_ids IS NOT NULL AND jl.account_id = ANY(v_ap_salary_account_ids)
            ), 0)
        INTO v_ap_ledger_amount, v_ap_salary_ledger_amount
        FROM public.journal_lines jl
        JOIN public.transactions t ON t.id = jl.transaction_id
        WHERE t.business_id = p_business_id
          AND jl.account_id = ANY(v_ap_account_ids);
    END IF;

    -- 3. Accounts Receivable Document Aging from public.orders
    WITH ar_rows AS (
        SELECT
            GREATEST(0, COALESCE(o.grand_total, 0) - COALESCE(o.amount_paid, 0)) AS remaining,
            CASE
                WHEN (o.raw_source_data->>'due_date') ~ '^\d{4}-\d{2}-\d{2}'
                THEN SUBSTRING(o.raw_source_data->>'due_date' FROM 1 FOR 10)::date
                ELSE NULL
            END AS due_date
        FROM public.orders o
        WHERE o.business_id = p_business_id
          AND COALESCE(o.status, '') NOT IN ('cancelled', 'pending')
          AND COALESCE(
                o.payment_status,
                CASE
                    WHEN o.status = 'completed' AND COALESCE(o.amount_paid, 0) = 0 THEN 'paid'
                    ELSE 'unpaid'
                END
              ) IN ('unpaid', 'partial')
          AND (COALESCE(o.grand_total, 0) - COALESCE(o.amount_paid, 0)) > 0.01
    )
    SELECT
        COALESCE(SUM(remaining), 0),
        COUNT(*),
        COALESCE(SUM(remaining) FILTER (WHERE due_date IS NOT NULL AND due_date < v_today), 0),
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < v_today),
        COALESCE(SUM(remaining) FILTER (WHERE due_date IS NOT NULL AND due_date >= v_today AND due_date <= v_due_soon_end), 0),
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date >= v_today AND due_date <= v_due_soon_end)
    INTO
        v_ar_doc_amount,
        v_ar_doc_count,
        v_ar_overdue_amount,
        v_ar_overdue_count,
        v_ar_due_soon_amount,
        v_ar_due_soon_count
    FROM ar_rows;

    -- 4. Accounts Payable Document Aging from public.purchases + public.expenses
    WITH ap_purchases AS (
        SELECT
            GREATEST(0, COALESCE(p.grand_total, 0) - COALESCE(p.amount_paid, 0)) AS remaining,
            p.due_date
        FROM public.purchases p
        WHERE p.business_id = p_business_id
          AND p.payment_status IN ('unpaid', 'partial')
          AND (COALESCE(p.grand_total, 0) - COALESCE(p.amount_paid, 0)) > 0.01
    ),
    ap_expenses AS (
        SELECT
            GREATEST(
                0,
                COALESCE(e.outstanding_amount, COALESCE(e.amount, 0) - COALESCE(e.amount_paid, 0))
            ) AS remaining,
            e.due_date
        FROM public.expenses e
        WHERE e.business_id = p_business_id
          AND e.payment_status IN ('unpaid', 'partial')
          AND COALESCE(e.outstanding_amount, COALESCE(e.amount, 0) - COALESCE(e.amount_paid, 0)) > 0.01
    ),
    ap_all AS (
        SELECT remaining, due_date FROM ap_purchases
        UNION ALL
        SELECT remaining, due_date FROM ap_expenses
    )
    SELECT
        COALESCE((SELECT SUM(remaining) FROM ap_all), 0),
        COALESCE((SELECT COUNT(*) FROM ap_all), 0),
        COALESCE((SELECT SUM(remaining) FROM ap_all WHERE due_date IS NOT NULL AND due_date < v_today), 0),
        COALESCE((SELECT COUNT(*) FROM ap_all WHERE due_date IS NOT NULL AND due_date < v_today), 0),
        COALESCE((SELECT SUM(remaining) FROM ap_all WHERE due_date IS NOT NULL AND due_date >= v_today AND due_date <= v_due_soon_end), 0),
        COALESCE((SELECT COUNT(*) FROM ap_all WHERE due_date IS NOT NULL AND due_date >= v_today AND due_date <= v_due_soon_end), 0),
        COALESCE((SELECT SUM(remaining) FROM ap_purchases), 0),
        COALESCE((SELECT COUNT(*) FROM ap_purchases), 0),
        COALESCE((SELECT SUM(remaining) FROM ap_expenses), 0),
        COALESCE((SELECT COUNT(*) FROM ap_expenses), 0)
    INTO
        v_ap_doc_amount,
        v_ap_doc_count,
        v_ap_overdue_amount,
        v_ap_overdue_count,
        v_ap_due_soon_amount,
        v_ap_due_soon_count,
        v_ap_purchases_amount,
        v_ap_purchases_count,
        v_ap_expenses_amount,
        v_ap_expenses_count;

    RETURN json_build_object(
        'as_of_date', v_today,
        'receivables', json_build_object(
            'outstanding_amount', v_ar_ledger_amount,
            'doc_outstanding_amount', v_ar_doc_amount,
            'unreconciled_amount', v_ar_ledger_amount - v_ar_doc_amount,
            'outstanding_count', v_ar_doc_count,
            'overdue_amount', v_ar_overdue_amount,
            'overdue_count', v_ar_overdue_count,
            'due_soon_amount', v_ar_due_soon_amount,
            'due_soon_count', v_ar_due_soon_count
        ),
        'payables', json_build_object(
            'outstanding_amount', v_ap_ledger_amount,
            'trade_payable_amount', v_ap_ledger_amount - v_ap_salary_ledger_amount,
            'salary_payable_amount', v_ap_salary_ledger_amount,
            'doc_outstanding_amount', v_ap_doc_amount,
            'unreconciled_amount', (v_ap_ledger_amount - v_ap_salary_ledger_amount) - v_ap_doc_amount,
            'outstanding_count', v_ap_doc_count,
            'overdue_amount', v_ap_overdue_amount,
            'overdue_count', v_ap_overdue_count,
            'due_soon_amount', v_ap_due_soon_amount,
            'due_soon_count', v_ap_due_soon_count,
            'purchases_amount', v_ap_purchases_amount,
            'purchases_count', v_ap_purchases_count,
            'expenses_amount', v_ap_expenses_amount,
            'expenses_count', v_ap_expenses_count
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ap_ar_summary(uuid, text) TO authenticated, service_role;
