-- =============================================================================
-- Migration: High-Speed Customers & Lifetime Value Report RPC
-- Purpose:
--   1. Single-pass server-side aggregation per customer (MIN(order_date),
--      lifetime orders, lifetime spend, lifetime items) in PostgreSQL.
--   2. Bypasses PostgREST 1,000-row limit and eliminates raw order/JSONB transfer.
--   3. Supports dynamic business timezone, Day/Week/Month granularity, and
--      Guest/Walk-In customer exclusion toggle.
--   4. Enforces strict Multi-Tenant RBAC Guard Clause (AGENTS.md Rule #14).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_biz_cust_date_incl
  ON public.orders (business_id, customer_id, order_date)
  INCLUDE (grand_total, status);

CREATE OR REPLACE FUNCTION public.get_customers_report_metrics(
  p_business_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_granularity text DEFAULT 'month',
  p_timezone text DEFAULT 'Asia/Jakarta',
  p_exclude_guest boolean DEFAULT true
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

  -- 2. Single-Pass Customer Lifetime Aggregation
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
  bucketed_customers AS (
    SELECT
      cl.*,
      CASE v_gran
        WHEN 'day' THEN to_char(date_trunc('day', cl.first_order_ts AT TIME ZONE v_tz), 'YYYY-MM-DD')
        WHEN 'week' THEN to_char(date_trunc('week', cl.first_order_ts AT TIME ZONE v_tz), 'YYYY-MM-DD')
        ELSE to_char(date_trunc('month', cl.first_order_ts AT TIME ZONE v_tz), 'YYYY-MM-01')
      END AS bucket_key
    FROM customer_lifetime cl
  ),
  bucket_agg AS (
    SELECT
      bc.bucket_key,
      COUNT(*)::bigint AS customers,
      COALESCE(SUM(bc.lifetime_spend), 0)::numeric AS total_ltv,
      CASE WHEN COUNT(*) > 0 THEN (SUM(bc.lifetime_spend) / COUNT(*))::numeric ELSE 0 END AS avg_ltv,
      COALESCE(SUM(bc.lifetime_orders), 0)::bigint AS total_orders,
      CASE WHEN COUNT(*) > 0 THEN (SUM(bc.lifetime_orders)::numeric / COUNT(*)) ELSE 0 END AS avg_orders,
      COALESCE(SUM(bc.lifetime_items), 0)::numeric AS total_items,
      COUNT(*) FILTER (WHERE bc.lifetime_orders > 1)::bigint AS returning_customers,
      CASE WHEN COUNT(*) > 0 THEN ((COUNT(*) FILTER (WHERE bc.lifetime_orders > 1))::numeric * 100.0 / COUNT(*)) ELSE 0 END AS return_rate
    FROM bucketed_customers bc
    GROUP BY bc.bucket_key
    ORDER BY bc.bucket_key ASC
  ),
  summary_agg AS (
    SELECT
      COUNT(*)::bigint AS new_customers,
      COALESCE(SUM(cl.lifetime_orders), 0)::bigint AS total_orders,
      COALESCE(SUM(cl.lifetime_spend), 0)::numeric AS total_spend,
      COALESCE(SUM(cl.lifetime_items), 0)::numeric AS total_items,
      COUNT(*) FILTER (WHERE cl.lifetime_orders > 1)::bigint AS returning_customers,
      CASE WHEN COUNT(*) > 0 THEN (SUM(cl.lifetime_spend) / COUNT(*))::numeric ELSE 0 END AS avg_ltv,
      CASE WHEN SUM(cl.lifetime_orders) > 0 THEN (SUM(cl.lifetime_spend) / SUM(cl.lifetime_orders))::numeric ELSE 0 END AS avg_order_value,
      CASE WHEN COUNT(*) > 0 THEN (SUM(cl.lifetime_orders)::numeric / COUNT(*)) ELSE 0 END AS avg_lifetime_orders,
      CASE WHEN COUNT(*) > 0 THEN (SUM(cl.lifetime_items)::numeric / COUNT(*)) ELSE 0 END AS avg_lifetime_items,
      CASE WHEN COUNT(*) > 0 THEN ((COUNT(*) FILTER (WHERE cl.lifetime_orders > 1))::numeric * 100.0 / COUNT(*)) ELSE 0 END AS return_rate
    FROM customer_lifetime cl
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'new_customers', s.new_customers,
        'total_orders', s.total_orders,
        'total_spend', s.total_spend,
        'total_items', s.total_items,
        'returning_customers', s.returning_customers,
        'avg_ltv', s.avg_ltv,
        'avg_order_value', s.avg_order_value,
        'avg_lifetime_orders', s.avg_lifetime_orders,
        'avg_lifetime_items', s.avg_lifetime_items,
        'return_rate', s.return_rate
      )
      FROM summary_agg s
    ),
    'buckets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'bucket_key', ba.bucket_key,
          'customers', ba.customers,
          'total_ltv', ba.total_ltv,
          'avg_ltv', ba.avg_ltv,
          'total_orders', ba.total_orders,
          'avg_orders', ba.avg_orders,
          'total_items', ba.total_items,
          'returning_customers', ba.returning_customers,
          'return_rate', ba.return_rate
        )
        ORDER BY ba.bucket_key ASC
      )
      FROM bucket_agg ba
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customers_report_metrics(uuid, timestamptz, timestamptz, text, text, boolean) TO authenticated;

