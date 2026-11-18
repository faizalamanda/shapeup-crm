-- ============================================================================
-- Migration: Add get_cash_flow_analytics RPC for Cash Real & Cash Flow Chart
-- Description:
--   1. Multi-Tenant Security Guard (AGENTS.md Rule #14)
--   2. Identifies Cash & Bank accounts consistently with get_cash_flow_summary
--   3. Supports optional p_account_id filter and p_granularity ('day' | 'week' | 'month')
--   4. Computes per-transaction net cash flow (avoiding double-counting internal
--      cash-to-cash transfers when viewing all accounts combined)
--   5. Returns full continuous time_series with running_balance (Cash Real),
--      per-account cash_accounts breakdown, and top_inflows / top_outflows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cash_flow_analytics(
    p_business_id uuid,
    p_start_date timestamptz,
    p_end_date timestamptz,
    p_timezone text DEFAULT 'Asia/Jakarta',
    p_granularity text DEFAULT 'day',
    p_account_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz text := COALESCE(NULLIF(TRIM(p_timezone), ''), 'Asia/Jakarta');
    v_granularity text := CASE
        WHEN p_granularity IN ('day', 'week', 'month') THEN p_granularity
        ELSE 'day'
    END;
    v_cash_account_ids uuid[];
    v_target_account_ids uuid[];
    v_starting_cash numeric := 0;
    v_ending_cash numeric := 0;
    v_total_inflow numeric := 0;
    v_total_outflow numeric := 0;
    v_local_start date;
    v_local_end date;
    v_step interval;
    v_trunc_unit text;
    v_series_start date;
    v_series_end date;
    v_cash_accounts json;
    v_time_series json;
    v_top_inflows json;
    v_top_outflows json;
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

    -- Identify Cash & Bank accounts consistently with get_cash_flow_summary
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
            'total_inflow', 0,
            'total_outflow', 0,
            'cash_accounts', '[]'::json,
            'time_series', '[]'::json,
            'top_inflows', '[]'::json,
            'top_outflows', '[]'::json
        );
    END IF;

    -- Narrow target accounts if a specific account is selected (must belong to v_cash_account_ids)
    IF p_account_id IS NOT NULL AND p_account_id = ANY(v_cash_account_ids) THEN
        v_target_account_ids := ARRAY[p_account_id];
    ELSE
        v_target_account_ids := v_cash_account_ids;
    END IF;

    -- 1. Starting & Ending Cash for target account(s)
    SELECT
        COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE t.date < p_start_date), 0),
        COALESCE(SUM(jl.debit - jl.credit), 0)
    INTO v_starting_cash, v_ending_cash
    FROM public.transactions t
    JOIN public.journal_lines jl ON jl.transaction_id = t.id
    WHERE t.business_id = p_business_id
      AND t.date <= p_end_date
      AND jl.account_id = ANY(v_target_account_ids);

    -- 2. Per-Account Breakdown (always returns all cash/bank accounts for selector & table)
    SELECT COALESCE(json_agg(acc_row ORDER BY acc_row.ending_balance DESC, acc_row.code ASC), '[]'::json)
    INTO v_cash_accounts
    FROM (
        SELECT
            a.id AS account_id,
            a.code,
            a.name,
            COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE t.date < p_start_date), 0) AS starting_balance,
            COALESCE(SUM(jl.debit) FILTER (WHERE t.date >= p_start_date AND t.date <= p_end_date), 0) AS inflow,
            COALESCE(SUM(jl.credit) FILTER (WHERE t.date >= p_start_date AND t.date <= p_end_date), 0) AS outflow,
            COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE t.date <= p_end_date), 0) AS ending_balance
        FROM public.accounts a
        LEFT JOIN public.journal_lines jl ON jl.account_id = a.id
        LEFT JOIN public.transactions t ON t.id = jl.transaction_id AND t.business_id = p_business_id AND t.date <= p_end_date
        WHERE a.id = ANY(v_cash_account_ids)
        GROUP BY a.id, a.code, a.name
    ) acc_row;

    -- 3. Time-series bucket bounds in business local timezone
    v_local_start := (p_start_date AT TIME ZONE v_tz)::date;
    v_local_end   := (p_end_date AT TIME ZONE v_tz)::date;

    IF v_granularity = 'month' THEN
        v_trunc_unit := 'month';
        v_step := interval '1 month';
        v_series_start := date_trunc('month', v_local_start)::date;
        v_series_end   := date_trunc('month', v_local_end)::date;
    ELSIF v_granularity = 'week' THEN
        v_trunc_unit := 'week';
        v_step := interval '1 week';
        v_series_start := date_trunc('week', v_local_start)::date;
        v_series_end   := date_trunc('week', v_local_end)::date;
    ELSE
        v_trunc_unit := 'day';
        v_step := interval '1 day';
        v_series_start := v_local_start;
        v_series_end   := v_local_end;
    END IF;

    -- 4. Compute per-transaction net cash impact & aggregate into continuous series
    WITH tx_cash_net AS MATERIALIZED (
        SELECT
            t.id AS transaction_id,
            date_trunc(v_trunc_unit, (t.date AT TIME ZONE v_tz))::date AS bucket_date,
            SUM(jl.debit - jl.credit) AS net_amount
        FROM public.transactions t
        JOIN public.journal_lines jl ON jl.transaction_id = t.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date
          AND t.date <= p_end_date
          AND jl.account_id = ANY(v_target_account_ids)
        GROUP BY t.id, bucket_date
    ),
    bucket_agg AS (
        SELECT
            bucket_date,
            COALESCE(SUM(CASE WHEN net_amount > 0 THEN net_amount ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN net_amount < 0 THEN ABS(net_amount) ELSE 0 END), 0) AS outflow,
            COALESCE(SUM(net_amount), 0) AS net_change
        FROM tx_cash_net
        GROUP BY bucket_date
    ),
    filled_series AS (
        SELECT
            gs::date AS bucket_date,
            COALESCE(ba.inflow, 0) AS inflow,
            COALESCE(ba.outflow, 0) AS outflow,
            COALESCE(ba.net_change, 0) AS net_change,
            v_starting_cash + SUM(COALESCE(ba.net_change, 0)) OVER (ORDER BY gs::date ASC) AS running_balance
        FROM generate_series(v_series_start::timestamp, v_series_end::timestamp, v_step) AS gs
        LEFT JOIN bucket_agg ba ON ba.bucket_date = gs::date
        ORDER BY gs::date ASC
    )
    SELECT
        COALESCE(SUM(inflow), 0),
        COALESCE(SUM(outflow), 0),
        COALESCE(json_agg(json_build_object(
            'date', to_char(bucket_date, 'YYYY-MM-DD'),
            'inflow', inflow,
            'outflow', outflow,
            'net_change', net_change,
            'running_balance', running_balance
        ) ORDER BY bucket_date ASC), '[]'::json)
    INTO v_total_inflow, v_total_outflow, v_time_series
    FROM filled_series;

    -- 5. Top Counterpart Inflows & Outflows
    WITH period_txs AS MATERIALIZED (
        SELECT DISTINCT t.id AS transaction_id
        FROM public.transactions t
        JOIN public.journal_lines jl ON jl.transaction_id = t.id
        WHERE t.business_id = p_business_id
          AND t.date >= p_start_date
          AND t.date <= p_end_date
          AND jl.account_id = ANY(v_target_account_ids)
    ),
    counter_agg AS (
        SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.type,
            SUM(jl.credit - jl.debit) AS net_flow_to_cash
        FROM period_txs pt
        JOIN public.journal_lines jl ON jl.transaction_id = pt.transaction_id
        JOIN public.accounts a ON a.id = jl.account_id
        WHERE NOT (jl.account_id = ANY(v_target_account_ids))
        GROUP BY a.id, a.code, a.name, a.type
    )
    SELECT
        COALESCE((
            SELECT json_agg(row_to_json(t_in))
            FROM (
                SELECT account_id, code, name, type, net_flow_to_cash AS amount
                FROM counter_agg
                WHERE net_flow_to_cash > 0
                ORDER BY net_flow_to_cash DESC
                LIMIT 8
            ) t_in
        ), '[]'::json),
        COALESCE((
            SELECT json_agg(row_to_json(t_out))
            FROM (
                SELECT account_id, code, name, type, ABS(net_flow_to_cash) AS amount
                FROM counter_agg
                WHERE net_flow_to_cash < 0
                ORDER BY ABS(net_flow_to_cash) DESC
                LIMIT 8
            ) t_out
        ), '[]'::json)
    INTO v_top_inflows, v_top_outflows;

    RETURN json_build_object(
        'starting_cash', v_starting_cash,
        'ending_cash', v_ending_cash,
        'net_change', v_ending_cash - v_starting_cash,
        'total_inflow', v_total_inflow,
        'total_outflow', v_total_outflow,
        'cash_accounts', v_cash_accounts,
        'time_series', v_time_series,
        'top_inflows', v_top_inflows,
        'top_outflows', v_top_outflows
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_flow_analytics(uuid, timestamptz, timestamptz, text, text, uuid) TO authenticated, service_role;

