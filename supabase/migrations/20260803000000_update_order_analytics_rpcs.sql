-- Migration: 20260803000000_update_order_analytics_rpcs.sql
-- Description: Enhanced RPC functions get_order_analytics_metrics and get_order_list for order segmentation:
-- 1. Multi-status and multi-payment method matching (comma-separated string support)
-- 2. Flexible payment method matching for Bank Transfer (bacs/bank_transfer/transfer), COD, Midtrans, etc.
-- 3. Order source (source_platform) filtering
-- 4. Product name / segment keyword filtering (product_name)
-- 5. Improved date comparison & date range (between, equal, after, before)
-- 6. Include source_platform in returned order list items

CREATE OR REPLACE FUNCTION public.get_order_analytics_metrics(
  p_business_id UUID,
  p_search TEXT DEFAULT NULL,
  p_rules JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_where TEXT := 'WHERE o.business_id = ' || quote_literal(p_business_id);
  v_join TEXT := 'LEFT JOIN customer_metrics c ON o.customer_id = c.customer_id';
  v_sql TEXT;
  v_rule JSONB;
  v_field TEXT;
  v_op TEXT;
  v_val TEXT;
  v_res JSONB;
  v_arr TEXT[];
  v_i INT;
  v_quoted_arr TEXT;
  v_pm_cond TEXT;
  v_item_val TEXT;
BEGIN
  -- 1. Handle Search
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (c.name ILIKE ' || quote_literal('%' || p_search || '%') ||
                          ' OR c.phone ILIKE ' || quote_literal('%' || p_search || '%') ||
                          ' OR o.order_number ILIKE ' || quote_literal('%' || p_search || '%') ||
                          ' OR o.id::text ILIKE ' || quote_literal('%' || p_search || '%') || ')';
  END IF;

  -- 2. Handle Segment Rules
  FOR v_rule IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    v_field := v_rule->>'field';
    v_op := v_rule->>'operator';
    v_val := v_rule->>'value';

    IF v_val IS NULL OR TRIM(v_val) = '' THEN
      CONTINUE;
    END IF;

    IF v_field NOT IN ('grand_total', 'total_qty', 'status', 'payment_method', 'order_date', 'product_name', 'source_platform') THEN
      CONTINUE;
    END IF;

    IF v_field = 'grand_total' THEN
      IF v_op = 'greater_or_equal' THEN
        v_where := v_where || ' AND o.grand_total >= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'less_or_equal' THEN
        v_where := v_where || ' AND o.grand_total <= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'equal' THEN
        v_where := v_where || ' AND o.grand_total = ' || quote_literal(v_val) || '::numeric';
      END IF;

    ELSIF v_field = 'total_qty' THEN
      IF v_op = 'greater_or_equal' THEN
        v_where := v_where || ' AND o.total_qty >= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'less_or_equal' THEN
        v_where := v_where || ' AND o.total_qty <= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'equal' THEN
        v_where := v_where || ' AND o.total_qty = ' || quote_literal(v_val) || '::numeric';
      END IF;

    ELSIF v_field = 'order_date' THEN
      IF v_op = 'between' THEN
        v_arr := string_to_array(v_val, ',');
        IF cardinality(v_arr) >= 2 AND TRIM(v_arr[1]) <> '' AND TRIM(v_arr[2]) <> '' THEN
          v_where := v_where || ' AND o.order_date >= ' || quote_literal(TRIM(v_arr[1])) || '::date::timestamptz AND o.order_date <= (' || quote_literal(TRIM(v_arr[2])) || '::date + interval ''1 day'')::timestamptz';
        ELSIF cardinality(v_arr) >= 1 AND TRIM(v_arr[1]) <> '' THEN
          v_where := v_where || ' AND o.order_date >= ' || quote_literal(TRIM(v_arr[1])) || '::date::timestamptz';
        END IF;
      ELSIF v_op = 'after' THEN
        v_where := v_where || ' AND o.order_date >= ' || quote_literal(v_val) || '::timestamptz';
      ELSIF v_op = 'before' THEN
        v_where := v_where || ' AND o.order_date <= (' || quote_literal(v_val) || '::date + interval ''1 day'')::timestamptz';
      ELSIF v_op = 'equal' THEN
        v_where := v_where || ' AND o.order_date >= ' || quote_literal(v_val) || '::date::timestamptz AND o.order_date < (' || quote_literal(v_val) || '::date + interval ''1 day'')::timestamptz';
      END IF;

    ELSIF v_field = 'product_name' THEN
      IF v_op = 'is_not' THEN
        v_where := v_where || ' AND (o.items_json::text NOT ILIKE ' || quote_literal('%' || TRIM(v_val) || '%') || ' OR o.items_json IS NULL)';
      ELSE
        v_where := v_where || ' AND o.items_json::text ILIKE ' || quote_literal('%' || TRIM(v_val) || '%');
      END IF;

    ELSIF v_field IN ('status', 'payment_method', 'source_platform') THEN
      v_arr := string_to_array(v_val, ',');
      v_quoted_arr := '';
      FOR v_i IN 1..cardinality(v_arr) LOOP
        IF v_i > 1 THEN v_quoted_arr := v_quoted_arr || ', '; END IF;
        v_quoted_arr := v_quoted_arr || quote_literal(LOWER(TRIM(v_arr[v_i])));
      END LOOP;

      IF v_field = 'status' THEN
        IF v_op = 'is_not' OR v_op = 'not_in' THEN
          v_where := v_where || ' AND LOWER(o.status) NOT IN (' || v_quoted_arr || ')';
        ELSE
          v_where := v_where || ' AND LOWER(o.status) IN (' || v_quoted_arr || ')';
        END IF;

      ELSIF v_field = 'payment_method' THEN
        IF v_op = 'is_not' OR v_op = 'not_in' THEN
          v_where := v_where || ' AND LOWER(o.payment_method) NOT IN (' || v_quoted_arr || ')';
        ELSE
          -- Flexible matching for Bank Transfer (bacs/bank_transfer), COD, Midtrans, etc.
          v_pm_cond := '';
          FOR v_i IN 1..cardinality(v_arr) LOOP
            v_item_val := LOWER(TRIM(v_arr[v_i]));
            IF v_i > 1 THEN v_pm_cond := v_pm_cond || ' OR '; END IF;

            IF v_item_val IN ('bacs', 'bank_transfer', 'transfer') THEN
              v_pm_cond := v_pm_cond || '(LOWER(o.payment_method) IN (''bacs'', ''bank_transfer'', ''transfer'') OR o.payment_method ILIKE ''%bacs%'' OR o.payment_method ILIKE ''%bank%'' OR o.payment_method ILIKE ''%transfer%'')';
            ELSIF v_item_val = 'cod' THEN
              v_pm_cond := v_pm_cond || '(LOWER(o.payment_method) IN (''cod'', ''cash_on_delivery'') OR o.payment_method ILIKE ''%cod%'' OR o.payment_method ILIKE ''%cash%delivery%'')';
            ELSE
              v_pm_cond := v_pm_cond || '(LOWER(o.payment_method) = ' || quote_literal(v_item_val) || ' OR o.payment_method ILIKE ' || quote_literal('%' || v_item_val || '%') || ')';
            END IF;
          END LOOP;
          v_where := v_where || ' AND (' || v_pm_cond || ')';
        END IF;

      ELSIF v_field = 'source_platform' THEN
        IF v_op = 'is_not' OR v_op = 'not_in' THEN
          v_where := v_where || ' AND LOWER(o.source_platform) NOT IN (' || v_quoted_arr || ')';
        ELSE
          v_where := v_where || ' AND LOWER(o.source_platform) IN (' || v_quoted_arr || ')';
        END IF;
      END IF;

    END IF;
  END LOOP;

  v_sql := '
    WITH filtered_orders AS (
      SELECT o.id, o.grand_total, o.discount_amount, o.total_qty, o.payment_method, o.status, o.source_platform
      FROM orders o
      ' || v_join || '
      ' || v_where || '
    ),
    stats AS (
      SELECT
        COALESCE(count(*), 0) as total_orders,
        COALESCE(sum(grand_total), 0) as gross_sales,
        COALESCE(sum(discount_amount), 0) as total_discounts,
        COALESCE(sum(grand_total) - sum(discount_amount), 0) as net_sales,
        CASE WHEN count(*) > 0 THEN COALESCE(sum(grand_total), 0) / count(*) ELSE 0 END as aov,
        CASE WHEN count(*) > 0 THEN COALESCE(sum(total_qty), 0)::numeric / count(*) ELSE 0 END as avg_items_per_order
      FROM filtered_orders
    ),
    payment_dist AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(''payment_method'', COALESCE(payment_method, ''Manual''), ''count'', count)), ''[]''::jsonb) as dist
      FROM (
        SELECT payment_method, count(*) as count
        FROM filtered_orders
        GROUP BY payment_method
        ORDER BY count DESC
      ) t
    ),
    status_dist AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(''status'', COALESCE(status, ''pending''), ''count'', count)), ''[]''::jsonb) as dist
      FROM (
        SELECT status, count(*) as count
        FROM filtered_orders
        GROUP BY status
        ORDER BY count DESC
      ) t
    ),
    value_dist AS (
      SELECT jsonb_build_object(
        ''under_100k'', COALESCE(count(*) FILTER (WHERE grand_total < 100000), 0),
        ''100k_300k'', COALESCE(count(*) FILTER (WHERE grand_total >= 100000 AND grand_total < 300000), 0),
        ''300k_500k'', COALESCE(count(*) FILTER (WHERE grand_total >= 300000 AND grand_total < 500000), 0),
        ''500k_1m'',   COALESCE(count(*) FILTER (WHERE grand_total >= 500000 AND grand_total < 1000000), 0),
        ''over_1m'',   COALESCE(count(*) FILTER (WHERE grand_total >= 1000000), 0)
      ) as dist
      FROM filtered_orders
    )
    SELECT jsonb_build_object(
      ''stats'', (SELECT row_to_json(stats) FROM stats),
      ''payment_dist'', (SELECT dist FROM payment_dist),
      ''status_dist'', (SELECT dist FROM status_dist),
      ''value_dist'', (SELECT dist FROM value_dist)
    );
  ';

  EXECUTE v_sql INTO v_res;
  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_order_list(
  p_business_id UUID,
  p_search TEXT DEFAULT NULL,
  p_rules JSONB DEFAULT '[]'::jsonb,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_where TEXT := 'WHERE o.business_id = ' || quote_literal(p_business_id);
  v_join TEXT := 'LEFT JOIN customer_metrics c ON o.customer_id = c.customer_id';
  v_sql TEXT;
  v_rule JSONB;
  v_field TEXT;
  v_op TEXT;
  v_val TEXT;
  v_arr TEXT[];
  v_i INT;
  v_quoted_arr TEXT;
  v_pm_cond TEXT;
  v_item_val TEXT;
BEGIN
  -- 1. Handle Search
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (c.name ILIKE ' || quote_literal('%' || p_search || '%') ||
                          ' OR c.phone ILIKE ' || quote_literal('%' || p_search || '%') ||
                          ' OR o.order_number ILIKE ' || quote_literal('%' || p_search || '%') ||
                          ' OR o.id::text ILIKE ' || quote_literal('%' || p_search || '%') || ')';
  END IF;

  -- 2. Handle Segment Rules
  FOR v_rule IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    v_field := v_rule->>'field';
    v_op := v_rule->>'operator';
    v_val := v_rule->>'value';

    IF v_val IS NULL OR TRIM(v_val) = '' THEN
      CONTINUE;
    END IF;

    IF v_field NOT IN ('grand_total', 'total_qty', 'status', 'payment_method', 'order_date', 'product_name', 'source_platform') THEN
      CONTINUE;
    END IF;

    IF v_field = 'grand_total' THEN
      IF v_op = 'greater_or_equal' THEN
        v_where := v_where || ' AND o.grand_total >= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'less_or_equal' THEN
        v_where := v_where || ' AND o.grand_total <= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'equal' THEN
        v_where := v_where || ' AND o.grand_total = ' || quote_literal(v_val) || '::numeric';
      END IF;

    ELSIF v_field = 'total_qty' THEN
      IF v_op = 'greater_or_equal' THEN
        v_where := v_where || ' AND o.total_qty >= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'less_or_equal' THEN
        v_where := v_where || ' AND o.total_qty <= ' || quote_literal(v_val) || '::numeric';
      ELSIF v_op = 'equal' THEN
        v_where := v_where || ' AND o.total_qty = ' || quote_literal(v_val) || '::numeric';
      END IF;

    ELSIF v_field = 'order_date' THEN
      IF v_op = 'between' THEN
        v_arr := string_to_array(v_val, ',');
        IF cardinality(v_arr) >= 2 AND TRIM(v_arr[1]) <> '' AND TRIM(v_arr[2]) <> '' THEN
          v_where := v_where || ' AND o.order_date >= ' || quote_literal(TRIM(v_arr[1])) || '::date::timestamptz AND o.order_date <= (' || quote_literal(TRIM(v_arr[2])) || '::date + interval ''1 day'')::timestamptz';
        ELSIF cardinality(v_arr) >= 1 AND TRIM(v_arr[1]) <> '' THEN
          v_where := v_where || ' AND o.order_date >= ' || quote_literal(TRIM(v_arr[1])) || '::date::timestamptz';
        END IF;
      ELSIF v_op = 'after' THEN
        v_where := v_where || ' AND o.order_date >= ' || quote_literal(v_val) || '::timestamptz';
      ELSIF v_op = 'before' THEN
        v_where := v_where || ' AND o.order_date <= (' || quote_literal(v_val) || '::date + interval ''1 day'')::timestamptz';
      ELSIF v_op = 'equal' THEN
        v_where := v_where || ' AND o.order_date >= ' || quote_literal(v_val) || '::date::timestamptz AND o.order_date < (' || quote_literal(v_val) || '::date + interval ''1 day'')::timestamptz';
      END IF;

    ELSIF v_field = 'product_name' THEN
      IF v_op = 'is_not' THEN
        v_where := v_where || ' AND (o.items_json::text NOT ILIKE ' || quote_literal('%' || TRIM(v_val) || '%') || ' OR o.items_json IS NULL)';
      ELSE
        v_where := v_where || ' AND o.items_json::text ILIKE ' || quote_literal('%' || TRIM(v_val) || '%');
      END IF;

    ELSIF v_field IN ('status', 'payment_method', 'source_platform') THEN
      v_arr := string_to_array(v_val, ',');
      v_quoted_arr := '';
      FOR v_i IN 1..cardinality(v_arr) LOOP
        IF v_i > 1 THEN v_quoted_arr := v_quoted_arr || ', '; END IF;
        v_quoted_arr := v_quoted_arr || quote_literal(LOWER(TRIM(v_arr[v_i])));
      END LOOP;

      IF v_field = 'status' THEN
        IF v_op = 'is_not' OR v_op = 'not_in' THEN
          v_where := v_where || ' AND LOWER(o.status) NOT IN (' || v_quoted_arr || ')';
        ELSE
          v_where := v_where || ' AND LOWER(o.status) IN (' || v_quoted_arr || ')';
        END IF;

      ELSIF v_field = 'payment_method' THEN
        IF v_op = 'is_not' OR v_op = 'not_in' THEN
          v_where := v_where || ' AND LOWER(o.payment_method) NOT IN (' || v_quoted_arr || ')';
        ELSE
          -- Flexible matching for Bank Transfer (bacs/bank_transfer), COD, Midtrans, etc.
          v_pm_cond := '';
          FOR v_i IN 1..cardinality(v_arr) LOOP
            v_item_val := LOWER(TRIM(v_arr[v_i]));
            IF v_i > 1 THEN v_pm_cond := v_pm_cond || ' OR '; END IF;

            IF v_item_val IN ('bacs', 'bank_transfer', 'transfer') THEN
              v_pm_cond := v_pm_cond || '(LOWER(o.payment_method) IN (''bacs'', ''bank_transfer'', ''transfer'') OR o.payment_method ILIKE ''%bacs%'' OR o.payment_method ILIKE ''%bank%'' OR o.payment_method ILIKE ''%transfer%'')';
            ELSIF v_item_val = 'cod' THEN
              v_pm_cond := v_pm_cond || '(LOWER(o.payment_method) IN (''cod'', ''cash_on_delivery'') OR o.payment_method ILIKE ''%cod%'' OR o.payment_method ILIKE ''%cash%delivery%'')';
            ELSE
              v_pm_cond := v_pm_cond || '(LOWER(o.payment_method) = ' || quote_literal(v_item_val) || ' OR o.payment_method ILIKE ' || quote_literal('%' || v_item_val || '%') || ')';
            END IF;
          END LOOP;
          v_where := v_where || ' AND (' || v_pm_cond || ')';
        END IF;

      ELSIF v_field = 'source_platform' THEN
        IF v_op = 'is_not' OR v_op = 'not_in' THEN
          v_where := v_where || ' AND LOWER(o.source_platform) NOT IN (' || v_quoted_arr || ')';
        ELSE
          v_where := v_where || ' AND LOWER(o.source_platform) IN (' || v_quoted_arr || ')';
        END IF;
      END IF;

    END IF;
  END LOOP;

  v_sql := '
    SELECT jsonb_build_object(
      ''id'', o.id,
      ''order_number'', o.order_number,
      ''order_date'', o.order_date,
      ''total_qty'', o.total_qty,
      ''subtotal'', o.subtotal,
      ''shipping_cost'', o.shipping_cost,
      ''discount_amount'', o.discount_amount,
      ''grand_total'', o.grand_total,
      ''payment_method'', o.payment_method,
      ''source_platform'', o.source_platform,
      ''status'', o.status,
      ''items_json'', o.items_json,
      ''customer'', CASE WHEN c.customer_id IS NOT NULL THEN jsonb_build_object(''name'', c.name, ''phone'', c.phone) ELSE NULL END
    )
    FROM orders o
    ' || v_join || '
    ' || v_where || '
    ORDER BY o.order_date DESC
    LIMIT ' || p_limit || '
    OFFSET ' || p_offset || ';
  ';

  RETURN QUERY EXECUTE v_sql;
END;
$function$;
