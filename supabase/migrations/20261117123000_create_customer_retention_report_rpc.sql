-- =============================================================================
-- Migration: High-Speed Customer Retention Report RPC
-- Purpose:
--   1. Single-pass server-side aggregation for Customer Retention analytics:
--      - Orders over customer lifetime (1, 2, 3, 4, 5-9, 10+ buckets)
--      - One-time vs Returning customer breakdown
--      - Time between repeat orders (Days / Weeks / Months distribution & min/avg/max)
--      - Items bought over customer lifetime (1..6, 7-9, 10-19, 20+ buckets)
--   2. Bypasses PostgREST 1,000-row limit and eliminates raw order transfer.
--   3. Enforces strict Multi-Tenant RBAC Guard Clause (AGENTS.md Rule #14).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_biz_cust_date_incl
  ON public.orders (business_id, customer_id, order_date)
  INCLUDE (grand_total, status);

CREATE OR REPLACE FUNCTION public.get_customer_retention_metrics(
  p_business_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_time_unit text DEFAULT 'week',
  p_exclude_guest boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit text;
  v_divisor numeric;
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

  v_unit := CASE
    WHEN p_time_unit IN ('day', 'week', 'month') THEN p_time_unit
    ELSE 'week'
  END;

  v_divisor := CASE v_unit
    WHEN 'day' THEN 1.0
    WHEN 'month' THEN 30.0
    ELSE 7.0
  END;

  WITH guest_customers AS (
    SELECT c.id
    FROM public.customers c
    WHERE c.business_id = p_business_id
      AND (
        c.phone = '0'
        OR LOWER(COALESCE(c.email, '')) = 'guest@business.com'
      )
  ),
  valid_orders AS (
    SELECT
      COALESCE(o.customer_id::text, 'order-' || o.id::text) AS customer_key,
      COALESCE(o.order_date_utc, o.order_date, o.created_at) AS order_ts,
      GREATEST(0, COALESCE(o.grand_total, 0)) AS grand_total,
      COALESCE((
        SELECT SUM(GREATEST(0, COALESCE((elem->>'quantity')::numeric, (elem->>'qty')::numeric, 1)))
        FROM jsonb_array_elements(
          CASE
            WHEN o.items_json IS NOT NULL AND jsonb_typeof(o.items_json::jsonb) = 'array'
              THEN o.items_json::jsonb
            ELSE '[]'::jsonb
          END
        ) AS elem
      ), 0) AS items_qty
    FROM public.orders o
    WHERE o.business_id = p_business_id
      AND LOWER(REGEXP_REPLACE(COALESCE(o.status, ''), '[^a-zA-Z0-9]', '', 'g')) IN (
        'shipped',
        'processing',
        'complete',
        'completed'
      )
      AND (
        NOT p_exclude_guest
        OR (
          o.customer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM guest_customers gc WHERE gc.id = o.customer_id)
        )
      )
  ),
  customer_lifetime AS (
    SELECT
      vo.customer_key,
      MIN(vo.order_ts) AS first_order_ts,
      COUNT(*)::bigint AS lifetime_orders,
      COALESCE(SUM(vo.grand_total), 0)::numeric AS lifetime_spend,
      COALESCE(SUM(vo.items_qty), 0)::numeric AS lifetime_items
    FROM valid_orders vo
    WHERE vo.order_ts IS NOT NULL
    GROUP BY vo.customer_key
    HAVING MIN(vo.order_ts) >= p_start_date
       AND MIN(vo.order_ts) <= p_end_date
  ),
  -- Order count buckets: 1, 2, 3, 4, 5-9, 10+
  order_bucket_defs(bucket_key, sort_order) AS (
    VALUES
      ('1', 1),
      ('2', 2),
      ('3', 3),
      ('4', 4),
      ('5-9', 5),
      ('10+', 6)
  ),
  order_bucketed AS (
    SELECT
      CASE
        WHEN cl.lifetime_orders = 1 THEN '1'
        WHEN cl.lifetime_orders = 2 THEN '2'
        WHEN cl.lifetime_orders = 3 THEN '3'
        WHEN cl.lifetime_orders = 4 THEN '4'
        WHEN cl.lifetime_orders BETWEEN 5 AND 9 THEN '5-9'
        ELSE '10+'
      END AS bucket_key,
      cl.lifetime_orders,
      cl.lifetime_spend
    FROM customer_lifetime cl
  ),
  order_buckets_agg AS (
    SELECT
      d.bucket_key,
      d.sort_order,
      COUNT(ob.bucket_key)::bigint AS customers,
      COALESCE(SUM(ob.lifetime_orders), 0)::bigint AS total_orders,
      COALESCE(SUM(ob.lifetime_spend), 0)::numeric AS total_spend,
      CASE
        WHEN COALESCE(SUM(ob.lifetime_orders), 0) > 0
          THEN (SUM(ob.lifetime_spend) / SUM(ob.lifetime_orders))::numeric
        ELSE 0
      END AS avg_order_spend
    FROM order_bucket_defs d
    LEFT JOIN order_bucketed ob ON ob.bucket_key = d.bucket_key
    GROUP BY d.bucket_key, d.sort_order
    ORDER BY d.sort_order ASC
  ),
  -- Repeat order intervals (consecutive orders for returning customers)
  ordered_returning AS (
    SELECT
      vo.customer_key,
      vo.order_ts,
      LAG(vo.order_ts) OVER (PARTITION BY vo.customer_key ORDER BY vo.order_ts ASC) AS prev_order_ts
    FROM valid_orders vo
    INNER JOIN customer_lifetime cl ON cl.customer_key = vo.customer_key
    WHERE cl.lifetime_orders >= 2
      AND vo.order_ts IS NOT NULL
  ),
  repeat_gaps AS (
    SELECT
      GREATEST(0, EXTRACT(EPOCH FROM (order_ts - prev_order_ts)) / 86400.0)::numeric AS gap_days
    FROM ordered_returning
    WHERE prev_order_ts IS NOT NULL
  ),
  repeat_bucket_defs(bucket_idx, bucket_key) AS (
    VALUES
      (0, '0'), (1, '1'), (2, '2'), (3, '3'), (4, '4'), (5, '5'),
      (6, '6'), (7, '7'), (8, '8'), (9, '9'), (10, '10'), (11, '11'), (12, '12+')
  ),
  repeat_bucketed AS (
    SELECT
      LEAST(12, FLOOR(rg.gap_days / v_divisor)::int) AS bucket_idx
    FROM repeat_gaps rg
  ),
  repeat_buckets_agg AS (
    SELECT
      d.bucket_key,
      d.bucket_idx AS sort_order,
      COUNT(rb.bucket_idx)::bigint AS repeat_orders
    FROM repeat_bucket_defs d
    LEFT JOIN repeat_bucketed rb ON rb.bucket_idx = d.bucket_idx
    GROUP BY d.bucket_key, d.bucket_idx
    ORDER BY d.bucket_idx ASC
  ),
  repeat_summary AS (
    SELECT
      COUNT(*)::bigint AS pair_count,
      COALESCE(AVG(gap_days), 0)::numeric AS avg_days,
      COALESCE(MIN(gap_days), 0)::numeric AS min_days,
      COALESCE(MAX(gap_days), 0)::numeric AS max_days
    FROM repeat_gaps
  ),
  -- Lifetime items bought buckets: 1, 2, 3, 4, 5, 6, 7-9, 10-19, 20+
  item_bucket_defs(bucket_key, sort_order) AS (
    VALUES
      ('1', 1),
      ('2', 2),
      ('3', 3),
      ('4', 4),
      ('5', 5),
      ('6', 6),
      ('7-9', 7),
      ('10-19', 8),
      ('20+', 9)
  ),
  item_bucketed AS (
    SELECT
      CASE
        WHEN ROUND(cl.lifetime_items) <= 1 THEN '1'
        WHEN ROUND(cl.lifetime_items) = 2 THEN '2'
        WHEN ROUND(cl.lifetime_items) = 3 THEN '3'
        WHEN ROUND(cl.lifetime_items) = 4 THEN '4'
        WHEN ROUND(cl.lifetime_items) = 5 THEN '5'
        WHEN ROUND(cl.lifetime_items) = 6 THEN '6'
        WHEN ROUND(cl.lifetime_items) BETWEEN 7 AND 9 THEN '7-9'
        WHEN ROUND(cl.lifetime_items) BETWEEN 10 AND 19 THEN '10-19'
        ELSE '20+'
      END AS bucket_key
    FROM customer_lifetime cl
    WHERE cl.lifetime_items > 0
  ),
  item_buckets_agg AS (
    SELECT
      d.bucket_key,
      d.sort_order,
      COUNT(ib.bucket_key)::bigint AS customers
    FROM item_bucket_defs d
    LEFT JOIN item_bucketed ib ON ib.bucket_key = d.bucket_key
    GROUP BY d.bucket_key, d.sort_order
    ORDER BY d.sort_order ASC
  ),
  summary_agg AS (
    SELECT
      COUNT(*)::bigint AS total_customers,
      COUNT(*) FILTER (WHERE cl.lifetime_orders = 1)::bigint AS onetime_customers,
      COUNT(*) FILTER (WHERE cl.lifetime_orders >= 2)::bigint AS returning_customers,
      CASE
        WHEN COUNT(*) > 0
          THEN ((COUNT(*) FILTER (WHERE cl.lifetime_orders >= 2))::numeric * 100.0 / COUNT(*))
        ELSE 0
      END AS retention_rate,
      COALESCE(SUM(cl.lifetime_orders), 0)::bigint AS total_orders,
      COALESCE(SUM(cl.lifetime_spend), 0)::numeric AS total_spend,
      CASE
        WHEN COALESCE(SUM(cl.lifetime_orders), 0) > 0
          THEN (SUM(cl.lifetime_spend) / SUM(cl.lifetime_orders))::numeric
        ELSE 0
      END AS avg_order_spend,
      CASE
        WHEN COUNT(*) > 0 THEN (SUM(cl.lifetime_orders)::numeric / COUNT(*))
        ELSE 0
      END AS avg_lifetime_orders,
      COALESCE(MIN(cl.lifetime_orders), 0)::bigint AS min_lifetime_orders,
      COALESCE(MAX(cl.lifetime_orders), 0)::bigint AS max_lifetime_orders,

      -- One-time breakdown
      COALESCE(SUM(cl.lifetime_orders) FILTER (WHERE cl.lifetime_orders = 1), 0)::bigint AS onetime_orders,
      COALESCE(SUM(cl.lifetime_spend) FILTER (WHERE cl.lifetime_orders = 1), 0)::numeric AS onetime_spend,
      CASE
        WHEN COALESCE(SUM(cl.lifetime_orders) FILTER (WHERE cl.lifetime_orders = 1), 0) > 0
          THEN (SUM(cl.lifetime_spend) FILTER (WHERE cl.lifetime_orders = 1) / SUM(cl.lifetime_orders) FILTER (WHERE cl.lifetime_orders = 1))::numeric
        ELSE 0
      END AS onetime_avg_order,
      CASE
        WHEN COUNT(*) FILTER (WHERE cl.lifetime_orders = 1) > 0
          THEN (SUM(cl.lifetime_spend) FILTER (WHERE cl.lifetime_orders = 1) / COUNT(*) FILTER (WHERE cl.lifetime_orders = 1))::numeric
        ELSE 0
      END AS onetime_avg_ltv,

      -- Returning breakdown
      COALESCE(SUM(cl.lifetime_orders) FILTER (WHERE cl.lifetime_orders >= 2), 0)::bigint AS returning_orders,
      COALESCE(SUM(cl.lifetime_spend) FILTER (WHERE cl.lifetime_orders >= 2), 0)::numeric AS returning_spend,
      CASE
        WHEN COALESCE(SUM(cl.lifetime_orders) FILTER (WHERE cl.lifetime_orders >= 2), 0) > 0
          THEN (SUM(cl.lifetime_spend) FILTER (WHERE cl.lifetime_orders >= 2) / SUM(cl.lifetime_orders) FILTER (WHERE cl.lifetime_orders >= 2))::numeric
        ELSE 0
      END AS returning_avg_order,
      CASE
        WHEN COUNT(*) FILTER (WHERE cl.lifetime_orders >= 2) > 0
          THEN (SUM(cl.lifetime_spend) FILTER (WHERE cl.lifetime_orders >= 2) / COUNT(*) FILTER (WHERE cl.lifetime_orders >= 2))::numeric
        ELSE 0
      END AS returning_avg_ltv,

      -- Items breakdown
      COALESCE(SUM(cl.lifetime_items), 0)::numeric AS total_items,
      CASE
        WHEN COUNT(*) > 0 THEN (SUM(cl.lifetime_items)::numeric / COUNT(*))
        ELSE 0
      END AS avg_lifetime_items,
      COALESCE(MIN(cl.lifetime_items), 0)::numeric AS min_lifetime_items,
      COALESCE(MAX(cl.lifetime_items), 0)::numeric AS max_lifetime_items
    FROM customer_lifetime cl
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'total_customers', s.total_customers,
        'onetime_customers', s.onetime_customers,
        'returning_customers', s.returning_customers,
        'retention_rate', s.retention_rate,
        'total_orders', s.total_orders,
        'total_spend', s.total_spend,
        'avg_order_spend', s.avg_order_spend,
        'avg_lifetime_orders', s.avg_lifetime_orders,
        'min_lifetime_orders', s.min_lifetime_orders,
        'max_lifetime_orders', s.max_lifetime_orders,
        'onetime_orders', s.onetime_orders,
        'onetime_spend', s.onetime_spend,
        'onetime_avg_order', s.onetime_avg_order,
        'onetime_avg_ltv', s.onetime_avg_ltv,
        'returning_orders', s.returning_orders,
        'returning_spend', s.returning_spend,
        'returning_avg_order', s.returning_avg_order,
        'returning_avg_ltv', s.returning_avg_ltv,
        'returning_vs_onetime_ltv_multiplier', CASE
          WHEN s.onetime_avg_ltv > 0 THEN (s.returning_avg_ltv / s.onetime_avg_ltv)::numeric
          ELSE 0
        END,
        'total_items', s.total_items,
        'avg_lifetime_items', s.avg_lifetime_items,
        'min_lifetime_items', s.min_lifetime_items,
        'max_lifetime_items', s.max_lifetime_items,
        'repeat_pair_count', rs.pair_count,
        'repeat_avg_days', rs.avg_days,
        'repeat_min_days', rs.min_days,
        'repeat_max_days', rs.max_days
      )
      FROM summary_agg s
      CROSS JOIN repeat_summary rs
    ),
    'order_buckets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket_key', ob.bucket_key,
          'customers', ob.customers,
          'total_orders', ob.total_orders,
          'total_spend', ob.total_spend,
          'avg_order_spend', ob.avg_order_spend
        )
        ORDER BY ob.sort_order ASC
      )
      FROM order_buckets_agg ob
    ), '[]'::jsonb),
    'repeat_time_buckets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket_key', rb.bucket_key,
          'repeat_orders', rb.repeat_orders
        )
        ORDER BY rb.sort_order ASC
      )
      FROM repeat_buckets_agg rb
    ), '[]'::jsonb),
    'item_buckets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket_key', ib.bucket_key,
          'customers', ib.customers
        )
        ORDER BY ib.sort_order ASC
      )
      FROM item_buckets_agg ib
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_retention_metrics(uuid, timestamptz, timestamptz, text, boolean) TO authenticated;

