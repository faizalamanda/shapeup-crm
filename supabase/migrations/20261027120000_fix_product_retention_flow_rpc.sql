-- Migration: 20261027120000_fix_product_retention_flow_rpc.sql
-- Description: Fix get_product_retention_flow RPC to extract product name from items_json (COALESCE name, product_name, parent_name),
-- support all operator aliases (is, is_not, contains), order by UTC/created_at date, and return unified schema.

CREATE OR REPLACE FUNCTION public.get_product_retention_flow(
  p_business_id uuid, 
  p_product_filter text DEFAULT ''::text, 
  p_operator text DEFAULT 'contains'::text
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_result JSON;
  v_norm_operator TEXT;
BEGIN
  -- Multi-Tenant Security Guard: Validasi akses pemanggil ke unit bisnis
  IF NOT EXISTS (
    SELECT 1 FROM public.business_staff 
    WHERE business_id = p_business_id AND profile_id = auth.uid()
    UNION
    SELECT 1 FROM public.businesses 
    WHERE id = p_business_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki akses ke unit bisnis ini.';
  END IF;

  v_norm_operator := LOWER(COALESCE(p_operator, 'contains'));

  WITH valid_orders AS (
    SELECT 
      COALESCE(o.customer_id::text, 'order-' || o.id::text) as customer_key,
      o.id as order_id,
      COALESCE(o.order_date_utc, o.order_date, o.created_at) as order_date,
      ARRAY(
        SELECT DISTINCT TRIM(REGEXP_REPLACE(COALESCE(elem->>'name', elem->>'product_name', elem->>'parent_name', ''), '\s+', ' ', 'g'))
        FROM jsonb_array_elements(
          CASE 
            WHEN o.items_json IS NOT NULL AND jsonb_typeof(o.items_json::jsonb) = 'array' THEN o.items_json::jsonb 
            ELSE '[]'::jsonb 
          END
        ) elem
        WHERE TRIM(COALESCE(elem->>'name', elem->>'product_name', elem->>'parent_name', '')) <> ''
      ) as product_names,
      ROW_NUMBER() OVER(
        PARTITION BY COALESCE(o.customer_id::text, 'order-' || o.id::text) 
        ORDER BY COALESCE(o.order_date_utc, o.order_date, o.created_at) ASC, o.id ASC
      ) as order_seq
    FROM public.orders o
    WHERE o.business_id = p_business_id
      AND (
        LOWER(REGEXP_REPLACE(COALESCE(o.status, ''), '[^a-zA-Z0-9]', '', 'g')) IN ('shipped', 'processing', 'complete', 'completed')
        OR (o.raw_source_data->>'date_paid') IS NOT NULL
        OR o.source_platform = 'manual'
      )
  ),
  cohort_customers AS (
    SELECT customer_key
    FROM valid_orders
    WHERE order_seq = 1
      AND (
        p_product_filter = '' OR p_product_filter IS NULL OR
        (v_norm_operator = 'contains' AND EXISTS (SELECT 1 FROM unnest(product_names) p WHERE p ILIKE '%' || p_product_filter || '%')) OR
        ((v_norm_operator = 'not_contains' OR v_norm_operator = 'is_not') AND NOT EXISTS (SELECT 1 FROM unnest(product_names) p WHERE p ILIKE '%' || p_product_filter || '%')) OR
        ((v_norm_operator = 'equals' OR v_norm_operator = 'is') AND EXISTS (SELECT 1 FROM unnest(product_names) p WHERE LOWER(p) = LOWER(p_product_filter)))
      )
  ),
  total_cohort AS (
    SELECT COUNT(*) as count FROM cohort_customers
  ),
  second_orders AS (
    SELECT 
      vo.customer_key,
      vo.product_names
    FROM valid_orders vo
    JOIN cohort_customers cc ON vo.customer_key = cc.customer_key
    WHERE vo.order_seq = 2
  ),
  retained_total AS (
    SELECT COUNT(DISTINCT customer_key) as count FROM second_orders
  ),
  expanded_second_products AS (
    SELECT 
      so.customer_key,
      unnest(so.product_names) as next_product_name
    FROM second_orders so
  ),
  aggregated_products AS (
    SELECT 
      next_product_name,
      COUNT(DISTINCT customer_key) as repeat_count,
      COUNT(1) as total_order_count
    FROM expanded_second_products
    WHERE next_product_name IS NOT NULL AND next_product_name != ''
    GROUP BY next_product_name
  )
  SELECT json_build_object(
    -- Format Standar Frontend ShapeUp
    'cohortSize', (SELECT count FROM total_cohort),
    'retainedCount', (SELECT count FROM retained_total),
    'bouncedCount', GREATEST(0, (SELECT count FROM total_cohort) - (SELECT count FROM retained_total)),
    'retentionRate', CASE 
      WHEN (SELECT count FROM total_cohort) > 0 
      THEN ROUND(((SELECT count FROM retained_total)::numeric / (SELECT count FROM total_cohort)::numeric) * 100, 2)
      ELSE 0 
    END,
    'destinations', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'productName', next_product_name,
            'customersCount', repeat_count,
            'ordersCount', total_order_count
          ) ORDER BY repeat_count DESC, next_product_name ASC
        )
        FROM aggregated_products
      ),
      '[]'::json
    ),
    -- Format Kompatibilitas Legacy
    'total_cohort_customers', (SELECT count FROM total_cohort),
    'retained_customers', (SELECT count FROM retained_total),
    'overall_retention_rate', CASE 
      WHEN (SELECT count FROM total_cohort) > 0 
      THEN ROUND(((SELECT count FROM retained_total)::numeric / (SELECT count FROM total_cohort)::numeric) * 100, 2)
      ELSE 0 
    END,
    'next_purchases', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'product_name', next_product_name,
            'count', repeat_count,
            'share_percentage', CASE 
              WHEN (SELECT count FROM retained_total) > 0 
              THEN ROUND((repeat_count::numeric / (SELECT count FROM retained_total)::numeric) * 100, 2)
              ELSE 0 
            END
          ) ORDER BY repeat_count DESC, next_product_name ASC
        )
        FROM aggregated_products
      ),
      '[]'::json
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_product_retention_flow(UUID, TEXT, TEXT) TO authenticated, anon;
NOTIFY pgrst, 'reload schema';
