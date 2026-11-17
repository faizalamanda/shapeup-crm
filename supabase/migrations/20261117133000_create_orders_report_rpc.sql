-- =============================================================================
-- Migration: High-Speed Orders Report RPC (Metorik-Grade Analytics)
-- Purpose:
--   1. Single-pass server-side aggregation for /reports/orders:
--      - KPI Summary (Net Sales, Gross Sales, Orders, Items, Avg Net/Gross/Items,
--        Refunds, Discounts, Taxes, Shipping, Fees)
--      - Time-series trend (Day / Week / Month in dynamic business timezone)
--      - New vs. Returning customers (evaluated against lifetime first_order_ts)
--      - Item count distribution (1, 2, 3, 4, 5+)
--      - Order value distribution (Rp0-100k, 100k-300k, 300k-500k, 500k-1M, 1M+)
--      - Orders by day of week (Mon-Sun) & by hour of day (0-23)
--      - Day x Hour Heatmap matrix (orders, gross_sales, net_sales)
--      - Time to complete orders (avg, median, max, buckets in Days/Hours,
--        with scope filter: all / non_pos / has_date_completed)
--   2. Bypasses PostgREST 1,000-row limit and eliminates raw order transfer.
--   3. Enforces strict Multi-Tenant RBAC Guard Clause (AGENTS.md Rule #14).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_orders_report_metrics(
  p_business_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_timezone text DEFAULT 'Asia/Jakarta',
  p_granularity text DEFAULT 'month',
  p_time_unit text DEFAULT 'day',
  p_exclude_guest boolean DEFAULT false,
  p_completion_scope text DEFAULT 'all',
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
  v_unit text;
  v_scope text;
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
    ELSE 'month'
  END;
  v_unit := CASE
    WHEN p_time_unit IN ('day', 'hour') THEN p_time_unit
    ELSE 'day'
  END;
  v_scope := CASE
    WHEN p_completion_scope IN ('all', 'non_pos', 'has_date_completed') THEN p_completion_scope
    ELSE 'all'
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
      ) AS items_qty,
      -- Completion timestamp resolution (WooCommerce date_completed_gmt / date_completed -> updated_at)
      CASE
        WHEN NULLIF(BTRIM(o.raw_source_data->>'date_completed_gmt'), '') IS NOT NULL THEN
          (NULLIF(BTRIM(o.raw_source_data->>'date_completed_gmt'), '')::timestamp AT TIME ZONE 'UTC')
        WHEN NULLIF(BTRIM(o.raw_source_data->>'date_completed'), '') IS NOT NULL THEN
          CASE
            WHEN (o.raw_source_data->>'date_completed') ~ '(Z|[+-]\d{2}:?\d{2})$'
              THEN (o.raw_source_data->>'date_completed')::timestamptz
            ELSE ((o.raw_source_data->>'date_completed')::timestamp AT TIME ZONE v_tz)
          END
        ELSE COALESCE(o.updated_at, COALESCE(o.order_date_utc, o.order_date, o.created_at))
      END AS completed_ts,
      (
        NULLIF(BTRIM(o.raw_source_data->>'date_completed_gmt'), '') IS NOT NULL
        OR NULLIF(BTRIM(o.raw_source_data->>'date_completed'), '') IS NOT NULL
      ) AS has_explicit_completed,
      (
        LOWER(COALESCE(o.source_platform, '')) IN ('pos', 'kasir')
        OR COALESCE((o.raw_source_data->>'is_pos')::boolean, false)
      ) AS is_pos_order
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
  -- Lifetime first order timestamp per customer_key (before date range filter, for New vs Returning)
  customer_first_orders AS (
    SELECT
      avo.customer_key,
      MIN(avo.order_ts) AS first_order_ts
    FROM all_valid_orders avo
    WHERE avo.order_ts IS NOT NULL
    GROUP BY avo.customer_key
  ),
  -- Distinct platforms in business for segment dropdown
  available_platforms AS (
    SELECT DISTINCT avo.source_platform
    FROM all_valid_orders avo
    WHERE avo.order_ts >= p_start_date
      AND avo.order_ts <= p_end_date
    ORDER BY avo.source_platform
  ),
  -- Orders strictly within selected period + optional platform filter
  period_orders AS (
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
      END AS refunds,
      (avo.order_ts <= cfo.first_order_ts) AS is_new_customer_order
    FROM all_valid_orders avo
    JOIN customer_first_orders cfo ON cfo.customer_key = avo.customer_key
    WHERE avo.order_ts >= p_start_date
      AND avo.order_ts <= p_end_date
      AND (v_platform = 'all' OR LOWER(avo.source_platform) = LOWER(v_platform))
  ),
  enriched_orders AS (
    SELECT
      po.*,
      GREATEST(0, po.gross_sales - po.taxes - po.shipping - po.fees - po.refunds) AS net_sales,
      date_trunc(v_gran, po.local_ts)::date AS bucket_date,
      EXTRACT(ISODOW FROM po.local_ts)::int AS dow, -- 1=Mon .. 7=Sun
      EXTRACT(HOUR FROM po.local_ts)::int AS hour_of_day -- 0..23
    FROM period_orders po
  ),
  -- Summary KPIs
  summary_agg AS (
    SELECT
      COUNT(*)::bigint AS orders,
      COALESCE(SUM(eo.items_qty), 0)::numeric AS items,
      COALESCE(SUM(eo.net_sales), 0)::numeric AS net_sales,
      COALESCE(SUM(eo.gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(eo.refunds), 0)::numeric AS refunds,
      COALESCE(SUM(eo.discount), 0)::numeric AS discounts,
      COALESCE(SUM(eo.taxes), 0)::numeric AS taxes,
      COALESCE(SUM(eo.shipping), 0)::numeric AS shipping,
      COALESCE(SUM(eo.fees), 0)::numeric AS fees,
      COUNT(DISTINCT eo.bucket_date)::bigint AS active_buckets
    FROM enriched_orders eo
  ),
  -- New vs Returning breakdown
  nvr_agg AS (
    SELECT
      COUNT(DISTINCT CASE WHEN eo.is_new_customer_order THEN eo.customer_key END)::bigint AS new_customers,
      COUNT(*) FILTER (WHERE eo.is_new_customer_order)::bigint AS new_orders,
      COALESCE(SUM(eo.net_sales) FILTER (WHERE eo.is_new_customer_order), 0)::numeric AS new_net_sales,
      COALESCE(SUM(eo.gross_sales) FILTER (WHERE eo.is_new_customer_order), 0)::numeric AS new_gross_sales,
      COUNT(DISTINCT CASE WHEN NOT eo.is_new_customer_order THEN eo.customer_key END)::bigint AS ret_customers,
      COUNT(*) FILTER (WHERE NOT eo.is_new_customer_order)::bigint AS ret_orders,
      COALESCE(SUM(eo.net_sales) FILTER (WHERE NOT eo.is_new_customer_order), 0)::numeric AS ret_net_sales,
      COALESCE(SUM(eo.gross_sales) FILTER (WHERE NOT eo.is_new_customer_order), 0)::numeric AS ret_gross_sales
    FROM enriched_orders eo
  ),
  -- Time series buckets
  ts_agg AS (
    SELECT
      eo.bucket_date,
      COUNT(*)::bigint AS orders,
      COALESCE(SUM(eo.items_qty), 0)::numeric AS items,
      COALESCE(SUM(eo.gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(eo.net_sales), 0)::numeric AS net_sales
    FROM enriched_orders eo
    GROUP BY eo.bucket_date
    ORDER BY eo.bucket_date ASC
  ),
  -- Item count distribution (1, 2, 3, 4, 5+)
  item_bucket_defs(bucket_key, sort_order) AS (
    VALUES ('1', 1), ('2', 2), ('3', 3), ('4', 4), ('5+', 5)
  ),
  item_dist_raw AS (
    SELECT
      CASE
        WHEN ROUND(eo.items_qty) <= 1 THEN '1'
        WHEN ROUND(eo.items_qty) = 2 THEN '2'
        WHEN ROUND(eo.items_qty) = 3 THEN '3'
        WHEN ROUND(eo.items_qty) = 4 THEN '4'
        ELSE '5+'
      END AS bucket_key,
      COUNT(*)::bigint AS orders
    FROM enriched_orders eo
    GROUP BY 1
  ),
  item_dist AS (
    SELECT
      d.bucket_key,
      d.sort_order,
      COALESCE(r.orders, 0)::bigint AS orders
    FROM item_bucket_defs d
    LEFT JOIN item_dist_raw r ON r.bucket_key = d.bucket_key
    ORDER BY d.sort_order
  ),
  -- Order value distribution (IDR tiers)
  val_bucket_defs(bucket_key, sort_order) AS (
    VALUES
      ('Rp0 - Rp100rb', 1),
      ('Rp100rb - Rp300rb', 2),
      ('Rp300rb - Rp500rb', 3),
      ('Rp500rb - Rp1jt', 4),
      ('Rp1jt+', 5)
  ),
  val_dist_raw AS (
    SELECT
      CASE
        WHEN eo.gross_sales < 100000 THEN 'Rp0 - Rp100rb'
        WHEN eo.gross_sales < 300000 THEN 'Rp100rb - Rp300rb'
        WHEN eo.gross_sales < 500000 THEN 'Rp300rb - Rp500rb'
        WHEN eo.gross_sales < 1000000 THEN 'Rp500rb - Rp1jt'
        ELSE 'Rp1jt+'
      END AS bucket_key,
      COUNT(*)::bigint AS orders
    FROM enriched_orders eo
    GROUP BY 1
  ),
  val_dist AS (
    SELECT
      d.bucket_key,
      d.sort_order,
      COALESCE(r.orders, 0)::bigint AS orders
    FROM val_bucket_defs d
    LEFT JOIN val_dist_raw r ON r.bucket_key = d.bucket_key
    ORDER BY d.sort_order
  ),
  -- Orders by Day of Week (1..7)
  dow_series AS (SELECT generate_series(1, 7) AS dow),
  by_day_agg AS (
    SELECT
      ds.dow,
      COALESCE(COUNT(eo.id), 0)::bigint AS orders,
      COALESCE(SUM(eo.gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(eo.net_sales), 0)::numeric AS net_sales
    FROM dow_series ds
    LEFT JOIN enriched_orders eo ON eo.dow = ds.dow
    GROUP BY ds.dow
    ORDER BY ds.dow
  ),
  -- Orders by Hour of Day (0..23)
  hour_series AS (SELECT generate_series(0, 23) AS hour_of_day),
  by_hour_agg AS (
    SELECT
      hs.hour_of_day,
      COALESCE(COUNT(eo.id), 0)::bigint AS orders,
      COALESCE(SUM(eo.gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(eo.net_sales), 0)::numeric AS net_sales
    FROM hour_series hs
    LEFT JOIN enriched_orders eo ON eo.hour_of_day = hs.hour_of_day
    GROUP BY hs.hour_of_day
    ORDER BY hs.hour_of_day
  ),
  -- Day x Hour Heatmap
  heatmap_agg AS (
    SELECT
      eo.dow,
      eo.hour_of_day,
      COUNT(*)::bigint AS orders,
      COALESCE(SUM(eo.gross_sales), 0)::numeric AS gross_sales,
      COALESCE(SUM(eo.net_sales), 0)::numeric AS net_sales
    FROM enriched_orders eo
    GROUP BY eo.dow, eo.hour_of_day
  ),
  -- Time to complete orders
  completed_orders_base AS (
    SELECT
      GREATEST(0, EXTRACT(EPOCH FROM (eo.completed_ts - eo.order_ts)) / 3600.0)::numeric AS completion_hours
    FROM enriched_orders eo
    WHERE eo.norm_status IN ('complete', 'completed')
      AND eo.completed_ts IS NOT NULL
      AND (
        v_scope = 'all'
        OR (v_scope = 'non_pos' AND NOT eo.is_pos_order)
        OR (v_scope = 'has_date_completed' AND eo.has_explicit_completed)
      )
  ),
  completion_stats AS (
    SELECT
      COUNT(*)::bigint AS completed_orders,
      COALESCE(AVG(cb.completion_hours), 0)::numeric AS avg_hours,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cb.completion_hours), 0)::numeric AS median_hours,
      COALESCE(MAX(cb.completion_hours), 0)::numeric AS max_hours,
      COUNT(*) FILTER (WHERE cb.completion_hours <= 24)::bigint AS within_1d_count,
      COUNT(*) FILTER (WHERE cb.completion_hours <= 72)::bigint AS within_3d_count
    FROM completed_orders_base cb
  ),
  comp_bucket_defs(bucket_key, sort_order) AS (
    SELECT * FROM (
      VALUES
        ('0-1', 1),
        ('1-2', 2),
        ('2-3', 3),
        ('3-7', 4),
        ('7+', 5)
    ) AS t(bucket_key, sort_order)
    WHERE v_unit = 'day'
    UNION ALL
    SELECT * FROM (
      VALUES
        ('0-1h', 1),
        ('1-6h', 2),
        ('6-12h', 3),
        ('12-24h', 4),
        ('24h+', 5)
    ) AS t(bucket_key, sort_order)
    WHERE v_unit = 'hour'
  ),
  comp_dist_raw AS (
    SELECT
      CASE
        WHEN v_unit = 'hour' THEN
          CASE
            WHEN cb.completion_hours < 1 THEN '0-1h'
            WHEN cb.completion_hours < 6 THEN '1-6h'
            WHEN cb.completion_hours < 12 THEN '6-12h'
            WHEN cb.completion_hours < 24 THEN '12-24h'
            ELSE '24h+'
          END
        ELSE
          CASE
            WHEN (cb.completion_hours / 24.0) < 1 THEN '0-1'
            WHEN (cb.completion_hours / 24.0) < 2 THEN '1-2'
            WHEN (cb.completion_hours / 24.0) < 3 THEN '2-3'
            WHEN (cb.completion_hours / 24.0) < 7 THEN '3-7'
            ELSE '7+'
          END
      END AS bucket_key,
      COUNT(*)::bigint AS orders
    FROM completed_orders_base cb
    GROUP BY 1
  ),
  comp_dist AS (
    SELECT
      d.bucket_key,
      d.sort_order,
      COALESCE(r.orders, 0)::bigint AS orders
    FROM comp_bucket_defs d
    LEFT JOIN comp_dist_raw r ON r.bucket_key = d.bucket_key
    ORDER BY d.sort_order
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'orders', sa.orders,
        'items', sa.items,
        'net_sales', sa.net_sales,
        'gross_sales', sa.gross_sales,
        'avg_net', CASE WHEN sa.orders > 0 THEN ROUND(sa.net_sales / sa.orders, 2) ELSE 0 END,
        'avg_gross', CASE WHEN sa.orders > 0 THEN ROUND(sa.gross_sales / sa.orders, 2) ELSE 0 END,
        'avg_items', CASE WHEN sa.orders > 0 THEN ROUND(sa.items / sa.orders, 2) ELSE 0 END,
        'refunds', sa.refunds,
        'discounts', sa.discounts,
        'taxes', sa.taxes,
        'shipping', sa.shipping,
        'fees', sa.fees,
        'active_buckets', sa.active_buckets
      )
      FROM summary_agg sa
    ),
    'new_vs_returning', (
      SELECT jsonb_build_object(
        'new', jsonb_build_object(
          'customers', na.new_customers,
          'orders', na.new_orders,
          'net_sales', na.new_net_sales,
          'avg_net', CASE WHEN na.new_orders > 0 THEN ROUND(na.new_net_sales / na.new_orders, 2) ELSE 0 END,
          'gross_sales', na.new_gross_sales,
          'avg_gross', CASE WHEN na.new_orders > 0 THEN ROUND(na.new_gross_sales / na.new_orders, 2) ELSE 0 END
        ),
        'returning', jsonb_build_object(
          'customers', na.ret_customers,
          'orders', na.ret_orders,
          'net_sales', na.ret_net_sales,
          'avg_net', CASE WHEN na.ret_orders > 0 THEN ROUND(na.ret_net_sales / na.ret_orders, 2) ELSE 0 END,
          'gross_sales', na.ret_gross_sales,
          'avg_gross', CASE WHEN na.ret_orders > 0 THEN ROUND(na.ret_gross_sales / na.ret_orders, 2) ELSE 0 END
        )
      )
      FROM nvr_agg na
    ),
    'time_series', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket_date', to_char(ta.bucket_date, 'YYYY-MM-DD'),
          'orders', ta.orders,
          'items', ta.items,
          'gross_sales', ta.gross_sales,
          'net_sales', ta.net_sales,
          'avg_gross', CASE WHEN ta.orders > 0 THEN ROUND(ta.gross_sales / ta.orders, 2) ELSE 0 END,
          'avg_items', CASE WHEN ta.orders > 0 THEN ROUND(ta.items / ta.orders, 2) ELSE 0 END
        )
        ORDER BY ta.bucket_date ASC
      )
      FROM ts_agg ta
    ), '[]'::jsonb),
    'item_buckets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('bucket_key', idist.bucket_key, 'orders', idist.orders)
        ORDER BY idist.sort_order
      )
      FROM item_dist idist
    ), '[]'::jsonb),
    'value_buckets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('bucket_key', vdist.bucket_key, 'orders', vdist.orders)
        ORDER BY vdist.sort_order
      )
      FROM val_dist vdist
    ), '[]'::jsonb),
    'by_day', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'dow', bd.dow,
          'orders', bd.orders,
          'gross_sales', bd.gross_sales,
          'net_sales', bd.net_sales
        )
        ORDER BY bd.dow
      )
      FROM by_day_agg bd
    ), '[]'::jsonb),
    'by_hour', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'hour', bh.hour_of_day,
          'orders', bh.orders,
          'gross_sales', bh.gross_sales,
          'net_sales', bh.net_sales
        )
        ORDER BY bh.hour_of_day
      )
      FROM by_hour_agg bh
    ), '[]'::jsonb),
    'heatmap', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'dow', hm.dow,
          'hour', hm.hour_of_day,
          'orders', hm.orders,
          'gross_sales', hm.gross_sales,
          'net_sales', hm.net_sales
        )
      )
      FROM heatmap_agg hm
    ), '[]'::jsonb),
    'completion', jsonb_build_object(
      'stats', (
        SELECT jsonb_build_object(
          'completed_orders', cs.completed_orders,
          'avg_hours', ROUND(cs.avg_hours, 2),
          'median_hours', ROUND(cs.median_hours, 2),
          'max_hours', ROUND(cs.max_hours, 2),
          'within_1d_pct', CASE WHEN cs.completed_orders > 0 THEN ROUND((cs.within_1d_count::numeric / cs.completed_orders) * 100, 1) ELSE 0 END,
          'within_3d_pct', CASE WHEN cs.completed_orders > 0 THEN ROUND((cs.within_3d_count::numeric / cs.completed_orders) * 100, 1) ELSE 0 END
        )
        FROM completion_stats cs
      ),
      'buckets', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('bucket_key', cd.bucket_key, 'orders', cd.orders)
          ORDER BY cd.sort_order
        )
        FROM comp_dist cd
      ), '[]'::jsonb)
    ),
    'platforms', COALESCE((
      SELECT jsonb_agg(ap.source_platform ORDER BY ap.source_platform)
      FROM available_platforms ap
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_orders_report_metrics(uuid, timestamptz, timestamptz, text, text, text, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_orders_report_metrics(uuid, timestamptz, timestamptz, text, text, text, boolean, text, text) TO service_role;

