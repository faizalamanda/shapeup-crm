-- Migration: 20261028000000_add_created_by_to_get_order_list.sql
-- Description: Project 'created_by' in get_order_list RPC for Order Export and UI Attribution.
-- Resolves cashier_name from pos_shifts, full_name/email from profiles, or 'Sistem (Platform)' for integrations.

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
  v_join TEXT := 'LEFT JOIN customer_metrics c ON o.customer_id = c.customer_id
                  LEFT JOIN profiles u ON o.user_id = u.id
                  LEFT JOIN pos_shifts ps ON o.shift_id = ps.id';
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
  -- Multi-Tenant Security Guard: Validasi akses pemanggil ke unit bisnis
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.business_staff 
    WHERE business_id = p_business_id AND profile_id = auth.uid()
    UNION
    SELECT 1 FROM public.businesses 
    WHERE id = p_business_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki akses ke unit bisnis ini.';
  END IF;

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

    IF v_field NOT IN ('grand_total', 'total_qty', 'status', 'payment_status', 'payment_method', 'order_date', 'product_name', 'source_platform') THEN
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

    ELSIF v_field = 'payment_status' THEN
      v_arr := string_to_array(v_val, ',');
      v_quoted_arr := '';
      FOR v_i IN 1..cardinality(v_arr) LOOP
        IF v_i > 1 THEN v_quoted_arr := v_quoted_arr || ', '; END IF;
        v_quoted_arr := v_quoted_arr || quote_literal(LOWER(TRIM(v_arr[v_i])));
      END LOOP;

      IF v_op = 'is_not' OR v_op = 'not_in' THEN
        v_where := v_where || ' AND LOWER(COALESCE(o.payment_status, CASE WHEN o.status = ''completed'' THEN ''paid'' ELSE ''unpaid'' END)) NOT IN (' || v_quoted_arr || ')';
      ELSE
        v_where := v_where || ' AND LOWER(COALESCE(o.payment_status, CASE WHEN o.status = ''completed'' THEN ''paid'' ELSE ''unpaid'' END)) IN (' || v_quoted_arr || ')';
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
      ''payment_status'', COALESCE(o.payment_status, CASE WHEN o.status = ''completed'' THEN ''paid'' ELSE ''unpaid'' END),
      ''amount_paid'', COALESCE(o.amount_paid, CASE WHEN o.status = ''completed'' THEN o.grand_total ELSE 0 END),
      ''created_by'', CASE 
        WHEN ps.cashier_name IS NOT NULL AND TRIM(ps.cashier_name) <> '''' THEN ps.cashier_name
        WHEN u.full_name IS NOT NULL AND TRIM(u.full_name) <> '''' THEN u.full_name
        WHEN u.email IS NOT NULL AND TRIM(u.email) <> '''' THEN u.email
        WHEN o.source_platform IS NOT NULL AND TRIM(o.source_platform) <> '''' AND LOWER(o.source_platform) NOT IN (''manual'', ''pos'', ''invoice'') THEN ''Sistem ('' || o.source_platform || '')''
        ELSE ''Sistem''
      END,
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
