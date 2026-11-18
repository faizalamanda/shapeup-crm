-- =============================================================================
-- Migration: High-Speed Profit Dashboard RPC
-- Purpose:
--   1. Single-pass server-side aggregation for /reports/profit (active business):
--      - KPI Summary (Net Profit, Net Revenue, Total Costs, Net Profit Margin,
--        COGS/HPP, Payroll, Transport/Shipping, Transaction Fees, Operational Costs)
--      - Channel Breakdown (Orders, Gross Sales, Net Revenue, AOV per channel)
--      - UTM & Channel Revenue Attribution
--      - Time-series Performance (Day / Week / Month in dynamic business timezone)
--      - Cost Breakdown by COA Expense Accounts (for Donut Chart)
--      - Order Summary (AOV, Avg Order Profit, Avg Order Cost, Avg Items, Purchase Frequency)
--      - Customer Summary (Total, New, Returning, Repurchase Rate)
--      - Others (Shipping Charged, Taxes Collected, Fees, Discounts, Refunds)
--   2. Bypasses PostgREST 1,000-row limit and eliminates raw order/journal transfer.
--   3. Enforces strict Multi-Tenant RBAC Guard Clause (AGENTS.md Rule #14).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_profit_dashboard_metrics(
  p_business_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_timezone text DEFAULT 'Asia/Jakarta',
  p_granularity text DEFAULT 'day',
  p_exclude_guest boolean DEFAULT false,
  p_platform text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_gran text;
  v_platform text;
  v_result jsonb;
BEGIN
  -- 1. Strict Multi-Tenant Security Guard Clause (AGENTS.md Rule #14)
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
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

  v_tz := COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Asia/Jakarta');
  v_gran := CASE
    WHEN p_granularity IN ('day', 'week', 'month') THEN p_granularity
    ELSE 'day'
  END;
  v_platform := COALESCE(NULLIF(BTRIM(p_platform), ''), 'all');

  WITH guest_customers AS (
    SELECT c.id
    FROM public.customers c
    WHERE c.business_id = p_business_id
      AND (
        c.phone = '0'
        OR LOWER(COALESCE(c.email, '')) = 'guest@business.com'
      )
  ),
  refund_ledger AS (
    SELECT
      op.order_id,
      SUM(ABS(COALESCE(op.amount, 0))) AS ledger_refund
    FROM public.order_payments op
    WHERE op.business_id = p_business_id
      AND op.payment_kind = 'refund'
      AND op.order_id IS NOT NULL
    GROUP BY op.order_id
  ),
  all_valid_orders AS (
    SELECT
      o.id,
      o.customer_id,
      COALESCE(o.customer_id::text, 'guest-order-' || o.id::text) AS customer_key,
      COALESCE(o.order_date_utc, o.order_date, o.created_at) AS order_ts,
      LOWER(REGEXP_REPLACE(COALESCE(o.status, ''), '[^a-zA-Z0-9]', '', 'g')) AS norm_status,
      LOWER(COALESCE(o.payment_status, '')) AS payment_status,
      COALESCE(
        NULLIF(BTRIM(o.source_platform), ''),
        NULLIF(BTRIM(o.raw_source_data->'source_order'->>'channel'), ''),
        'Manual'
      ) AS source_platform,
      NULLIF(BTRIM(o.raw_source_data->'source_order'->>'utm_source'), '') AS utm_source,
      GREATEST(0, COALESCE(o.subtotal, 0)) AS subtotal,
      GREATEST(
        0,
        COALESCE(
          NULLIF(o.shipping_cost, 0),
          NULLIF((o.raw_source_data->>'shipping_total')::numeric, 0),
          0
        )
      ) AS shipping,
      GREATEST(0, COALESCE(o.discount_amount, 0)) AS discount,
      GREATEST(0, ABS(COALESCE(o.other_fees, 0))) AS fees,
      GREATEST(0, COALESCE(o.grand_total, 0)) AS grand_total,
      GREATEST(
        0,
        COALESCE(
          NULLIF((o.raw_source_data->>'total_tax')::numeric, 0),
          NULLIF((o.raw_source_data->>'tax_total')::numeric, 0),
          0
        )
      ) AS taxes,
      COALESCE(rl.ledger_refund, 0) AS ledger_refund,
      COALESCE(
        (
          SELECT SUM(ABS(COALESCE((r_elem->>'total')::numeric, (r_elem->>'amount')::numeric, 0)))
          FROM jsonb_array_elements(
            CASE
              WHEN o.raw_source_data IS NOT NULL
               AND jsonb_typeof(o.raw_source_data->'refunds') = 'array'
                THEN o.raw_source_data->'refunds'
              ELSE '[]'::jsonb
            END
          ) AS r_elem
        ),
        0
      ) AS raw_refunds,
      COALESCE(
        (
          SELECT SUM(GREATEST(0, COALESCE((elem->>'quantity')::numeric, (elem->>'qty')::numeric, 1)))
          FROM jsonb_array_elements(
            CASE
              WHEN o.items_json IS NOT NULL
               AND jsonb_typeof(o.items_json::jsonb) = 'array'
                THEN o.items_json::jsonb
              ELSE '[]'::jsonb
            END
          ) AS elem
        ),
        0
      ) AS items_qty
    FROM public.orders o
    LEFT JOIN refund_ledger rl ON rl.order_id = o.id
    WHERE o.business_id = p_business_id
      AND LOWER(REGEXP_REPLACE(COALESCE(o.status, ''), '[^a-zA-Z0-9]', '', 'g')) IN (
        'shipped',
        'processing',
        'complete',
        'completed',
        'refunded',
        'returned',
        'returnrequest'
      )
      AND (
        NOT p_exclude_guest
        OR (
          o.customer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM guest_customers gc WHERE gc.id = o.customer_id)
        )
      )
  ),
  customer_first_orders AS (
    SELECT
      avo.customer_key,
      MIN(avo.order_ts) AS first_order_ts
    FROM all_valid_orders avo
    WHERE avo.order_ts IS NOT NULL
    GROUP BY avo.customer_key
  ),
  available_platforms AS (
    SELECT DISTINCT avo.source_platform
    FROM all_valid_orders avo
    WHERE avo.order_ts >= p_start_date
      AND avo.order_ts <= p_end_date
    ORDER BY avo.source_platform
  ),
  period_orders_unfiltered AS (
    SELECT
      avo.*,
      (avo.order_ts AT TIME ZONE v_tz) AS local_ts,
      CASE
        WHEN avo.grand_total > 0 THEN avo.grand_total
        ELSE GREATEST(0, avo.subtotal - avo.discount + avo.shipping + avo.fees + avo.taxes)
      END AS gross_sales,
      CASE
        WHEN avo.norm_status IN ('refunded', 'returned', 'returnrequest') OR avo.payment_status = 'refunded' THEN
          LEAST(
            CASE WHEN avo.grand_total > 0 THEN avo.grand_total ELSE GREATEST(0, avo.subtotal - avo.discount + avo.shipping + avo.fees + avo.taxes) END,
            GREATEST(
              avo.raw_refunds,
              avo.ledger_refund,
              COALESCE(
                NULLIF(
                  GREATEST(
                    0,
                    (CASE WHEN avo.grand_total > 0 THEN avo.grand_total ELSE GREATEST(0, avo.subtotal - avo.discount + avo.shipping + avo.fees + avo.taxes) END)
                    - avo.shipping - avo.fees - avo.taxes
                  ),
                  0
                ),
                CASE WHEN avo.grand_total > 0 THEN avo.grand_total ELSE GREATEST(0, avo.subtotal - avo.discount + avo.shipping + avo.fees + avo.taxes) END
              )
            )
          )
        ELSE
          LEAST(
            CASE WHEN avo.grand_total > 0 THEN avo.grand_total ELSE GREATEST(0, avo.subtotal - avo.discount + avo.shipping + avo.fees + avo.taxes) END,
            GREATEST(avo.raw_refunds, avo.ledger_refund)
          )
      END AS refunds
    FROM all_valid_orders avo
    WHERE avo.order_ts >= p_start_date
      AND avo.order_ts <= p_end_date
  ),
  period_orders AS (
    SELECT
      pou.*,
      GREATEST(0, pou.gross_sales - pou.taxes - pou.shipping - pou.fees - pou.refunds) AS net_sales,
      to_char(date_trunc(v_gran, pou.local_ts), 'YYYY-MM-DD') AS bucket_date,
      CASE
        WHEN cfo.first_order_ts >= p_start_date AND cfo.first_order_ts <= p_end_date THEN true
        ELSE false
      END AS is_new_customer
    FROM period_orders_unfiltered pou
    LEFT JOIN customer_first_orders cfo ON cfo.customer_key = pou.customer_key
    WHERE (v_platform = 'all' OR pou.source_platform = v_platform)
  ),
  -- Expense Journal Lines from Accounting Ledger in Business Timezone
  period_expense_lines AS (
    SELECT
      a.id AS account_id,
      a.code AS account_code,
      a.name AS account_name,
      a.sub_type AS account_sub_type,
      to_char(date_trunc(v_gran, (t.date AT TIME ZONE v_tz)), 'YYYY-MM-DD') AS bucket_date,
      (COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)) AS net_amount,
      CASE
        WHEN a.sub_type = 'cogs'
          OR a.code = '501000'
          OR LOWER(a.name) LIKE '%harga pokok%'
          OR LOWER(a.name) LIKE '%hpp%'
          THEN 'cogs'
        WHEN a.code = '503300'
          OR LOWER(a.name) LIKE '%gaji%'
          OR LOWER(a.name) LIKE '%upah%'
          THEN 'payroll'
        WHEN a.code = '503500'
          OR LOWER(a.name) LIKE '%transport%'
          OR LOWER(a.name) LIKE '%pengiriman%'
          OR LOWER(a.name) LIKE '%ongkir%'
          THEN 'shipping'
        WHEN a.code = '504000'
          OR LOWER(a.name) LIKE '%administrasi bank%'
          OR LOWER(a.name) LIKE '%bunga%'
          THEN 'transaction_fees'
        ELSE 'operational'
      END AS cost_group
    FROM public.journal_lines jl
    JOIN public.transactions t ON jl.transaction_id = t.id
    JOIN public.accounts a ON jl.account_id = a.id
    WHERE t.business_id = p_business_id
      AND t.date >= p_start_date
      AND t.date <= p_end_date
      AND a.type = 'EXPENSE'
  ),
  -- Revenue Journal Lines (Single Source of Truth from Accounting Ledger)
  period_revenue_lines AS (
    SELECT
      to_char(date_trunc(v_gran, (t.date AT TIME ZONE v_tz)), 'YYYY-MM-DD') AS bucket_date,
      (COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)) AS net_revenue_amount
    FROM public.journal_lines jl
    JOIN public.transactions t ON jl.transaction_id = t.id
    JOIN public.accounts a ON jl.account_id = a.id
    WHERE t.business_id = p_business_id
      AND t.date >= p_start_date
      AND t.date <= p_end_date
      AND a.type = 'REVENUE'
  ),
  revenue_summary AS (
    SELECT
      COALESCE(SUM(net_revenue_amount), 0) AS ledger_revenue
    FROM period_revenue_lines
  ),
  expense_summary AS (
    SELECT
      COALESCE(SUM(CASE WHEN cost_group = 'cogs' THEN net_amount ELSE 0 END), 0) AS cogs,
      COALESCE(SUM(CASE WHEN cost_group = 'payroll' THEN net_amount ELSE 0 END), 0) AS payroll,
      COALESCE(SUM(CASE WHEN cost_group = 'shipping' THEN net_amount ELSE 0 END), 0) AS shipping_cost,
      COALESCE(SUM(CASE WHEN cost_group = 'transaction_fees' THEN net_amount ELSE 0 END), 0) AS bank_fees,
      COALESCE(SUM(CASE WHEN cost_group = 'operational' THEN net_amount ELSE 0 END), 0) AS operational_cost,
      COALESCE(SUM(net_amount), 0) AS ledger_total_costs
    FROM period_expense_lines
  ),
  order_summary AS (
    SELECT
      COUNT(*)::int AS orders,
      COALESCE(SUM(items_qty), 0)::numeric AS items,
      COALESCE(SUM(gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(net_sales), 0)::numeric AS order_net_sales,
      COALESCE(SUM(shipping), 0)::numeric AS shipping_charged,
      COALESCE(SUM(taxes), 0)::numeric AS taxes_collected,
      COALESCE(SUM(fees), 0)::numeric AS order_fees,
      COALESCE(SUM(discount), 0)::numeric AS discounts,
      COALESCE(SUM(refunds), 0)::numeric AS refunds,
      COALESCE(SUM(CASE WHEN utm_source IS NOT NULL THEN net_sales ELSE 0 END), 0)::numeric AS utm_attributed_revenue,
      COUNT(DISTINCT customer_key)::int AS total_customers,
      COUNT(DISTINCT CASE WHEN is_new_customer THEN customer_key END)::int AS new_customers,
      COUNT(DISTINCT CASE WHEN NOT is_new_customer THEN customer_key END)::int AS returning_customers
    FROM period_orders
  ),
  combined_summary AS (
    SELECT
      os.orders,
      os.items,
      os.gross_sales,
      rs.ledger_revenue AS net_revenue,
      es.cogs,
      es.payroll,
      es.shipping_cost,
      es.bank_fees AS transaction_fees,
      es.operational_cost,
      es.ledger_total_costs AS total_costs,
      (rs.ledger_revenue - es.ledger_total_costs) AS net_profit,
      CASE
        WHEN rs.ledger_revenue > 0 THEN ROUND(((rs.ledger_revenue - es.ledger_total_costs) / rs.ledger_revenue) * 100, 2)
        ELSE 0
      END AS net_profit_margin,
      (rs.ledger_revenue - es.cogs) AS gross_profit,
      CASE
        WHEN rs.ledger_revenue > 0 THEN ROUND(((rs.ledger_revenue - es.cogs) / rs.ledger_revenue) * 100, 2)
        ELSE 0
      END AS gross_margin,
      CASE
        WHEN os.orders > 0 THEN ROUND(os.order_net_sales / os.orders, 0)
        ELSE 0
      END AS avg_order_value,
      CASE
        WHEN os.orders > 0 THEN ROUND((rs.ledger_revenue - es.ledger_total_costs) / os.orders, 0)
        ELSE 0
      END AS avg_order_profit,
      CASE
        WHEN os.orders > 0 THEN ROUND(es.ledger_total_costs / os.orders, 0)
        ELSE 0
      END AS avg_order_cost,
      CASE
        WHEN os.orders > 0 THEN ROUND(os.items / os.orders, 2)
        ELSE 0
      END AS avg_items_per_order,
      CASE
        WHEN os.total_customers > 0 THEN ROUND(os.orders::numeric / os.total_customers, 2)
        ELSE 0
      END AS purchase_frequency,
      os.total_customers,
      os.new_customers,
      os.returning_customers,
      CASE
        WHEN os.total_customers > 0 THEN ROUND((os.returning_customers::numeric / os.total_customers) * 100, 2)
        ELSE 0
      END AS repurchase_rate,
      os.shipping_charged,
      os.taxes_collected,
      os.order_fees,
      os.discounts,
      os.refunds,
      os.utm_attributed_revenue
    FROM order_summary os
    CROSS JOIN revenue_summary rs
    CROSS JOIN expense_summary es
  ),
  order_ts_buckets AS (
    SELECT
      bucket_date,
      COUNT(*)::int AS orders,
      COALESCE(SUM(gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(net_sales), 0)::numeric AS order_net_sales
    FROM period_orders
    GROUP BY bucket_date
  ),
  revenue_ts_buckets AS (
    SELECT
      bucket_date,
      COALESCE(SUM(net_revenue_amount), 0)::numeric AS ledger_revenue
    FROM period_revenue_lines
    GROUP BY bucket_date
  ),
  expense_ts_buckets AS (
    SELECT
      bucket_date,
      COALESCE(SUM(CASE WHEN cost_group = 'cogs' THEN net_amount ELSE 0 END), 0)::numeric AS cogs,
      COALESCE(SUM(net_amount), 0)::numeric AS ledger_costs
    FROM period_expense_lines
    GROUP BY bucket_date
  ),
  merged_ts AS (
    SELECT
      COALESCE(r.bucket_date, e.bucket_date, o.bucket_date) AS bucket_date,
      COALESCE(o.orders, 0) AS orders,
      COALESCE(o.gross_sales, 0) AS gross_sales,
      COALESCE(r.ledger_revenue, 0) AS net_revenue,
      COALESCE(e.cogs, 0) AS cogs,
      COALESCE(e.ledger_costs, 0) AS total_costs,
      (COALESCE(r.ledger_revenue, 0) - COALESCE(e.ledger_costs, 0)) AS net_profit,
      CASE
        WHEN COALESCE(r.ledger_revenue, 0) > 0 THEN
          ROUND(((COALESCE(r.ledger_revenue, 0) - COALESCE(e.ledger_costs, 0)) / r.ledger_revenue) * 100, 2)
        ELSE 0
      END AS net_profit_margin,
      CASE
        WHEN COALESCE(o.orders, 0) > 0 THEN ROUND(COALESCE(o.order_net_sales, 0) / o.orders, 0)
        ELSE 0
      END AS avg_order_value
    FROM revenue_ts_buckets r
    FULL OUTER JOIN expense_ts_buckets e ON r.bucket_date = e.bucket_date
    FULL OUTER JOIN order_ts_buckets o ON COALESCE(r.bucket_date, e.bucket_date) = o.bucket_date
    ORDER BY COALESCE(r.bucket_date, e.bucket_date, o.bucket_date) ASC
  ),
  channel_breakdown AS (
    SELECT
      pou.source_platform AS channel,
      COUNT(*)::int AS orders,
      COALESCE(SUM(pou.gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(GREATEST(0, pou.gross_sales - pou.taxes - pou.shipping - pou.fees - pou.refunds)), 0)::numeric AS net_revenue
    FROM period_orders_unfiltered pou
    GROUP BY pou.source_platform
    ORDER BY net_revenue DESC, orders DESC
  ),
  utm_breakdown AS (
    SELECT
      COALESCE(po.utm_source, po.source_platform) AS source_label,
      (po.utm_source IS NOT NULL) AS is_utm,
      COUNT(*)::int AS orders,
      COALESCE(SUM(po.gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(po.net_sales), 0)::numeric AS net_revenue
    FROM period_orders po
    GROUP BY COALESCE(po.utm_source, po.source_platform), (po.utm_source IS NOT NULL)
    ORDER BY net_revenue DESC, orders DESC
    LIMIT 10
  ),
  cost_breakdown AS (
    SELECT
      account_code AS code,
      account_name AS name,
      cost_group,
      COALESCE(SUM(net_amount), 0)::numeric AS amount
    FROM period_expense_lines
    GROUP BY account_code, account_name, cost_group
    HAVING COALESCE(SUM(net_amount), 0) <> 0
    ORDER BY amount DESC
  )
  SELECT jsonb_build_object(
    'summary', (SELECT row_to_json(cs)::jsonb FROM combined_summary cs),
    'time_series', COALESCE((SELECT jsonb_agg(row_to_json(mt)::jsonb ORDER BY mt.bucket_date) FROM merged_ts mt), '[]'::jsonb),
    'channels', COALESCE((SELECT jsonb_agg(row_to_json(cb)::jsonb) FROM channel_breakdown cb), '[]'::jsonb),
    'utm_channels', COALESCE((SELECT jsonb_agg(row_to_json(ub)::jsonb) FROM utm_breakdown ub), '[]'::jsonb),
    'cost_breakdown', COALESCE((SELECT jsonb_agg(row_to_json(cdb)::jsonb) FROM cost_breakdown cdb), '[]'::jsonb),
    'platforms', COALESCE((SELECT jsonb_agg(ap.source_platform) FROM available_platforms ap), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_dashboard_metrics(uuid, timestamptz, timestamptz, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profit_dashboard_metrics(uuid, timestamptz, timestamptz, text, text, boolean, text) TO service_role;

