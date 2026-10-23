-- Migration: 20261023000000_fix_staff_business_dropdown_and_rpc_rls.sql
-- Description: 
--   1. Add RLS policy on public.businesses so staff can view all businesses they are assigned to in business_staff.
--   2. Add multi-tenant security guard clauses to SECURITY DEFINER analytics functions.

-- 1. Izinkan staf membaca metadata unit bisnis tempat mereka ditugaskan
DROP POLICY IF EXISTS "Staff can view assigned businesses" ON public.businesses;
CREATE POLICY "Staff can view assigned businesses" ON public.businesses
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_staff
            WHERE business_staff.business_id = businesses.id
              AND business_staff.profile_id = auth.uid()
        )
    );

-- 2. Hardening RPC: get_inventory_summary_metrics
CREATE OR REPLACE FUNCTION public.get_inventory_summary_metrics(
  p_business_id uuid, 
  p_search text DEFAULT NULL::text, 
  p_category_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result JSONB;
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

  SELECT jsonb_build_object(
    'total_products', COUNT(*),
    'total_stock_qty', COALESCE(SUM(p.stock_quantity), 0),
    'total_valuation', COALESCE(SUM(p.stock_quantity * p.cost_price), 0),
    'out_of_stock_count', COUNT(*) FILTER (WHERE p.stock_quantity <= 0),
    'low_stock_count', COUNT(*) FILTER (WHERE p.stock_quantity > 0 AND p.stock_quantity <= 5)
  ) INTO result
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE p.business_id = p_business_id
    AND (p_search IS NULL OR p_search = '' OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%')
    AND (p_category_name IS NULL OR p_category_name = '' OR c.name = p_category_name);

  RETURN result;
END;
$function$;

-- 3. Hardening RPC: get_product_retention_flow
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

  WITH valid_orders AS (
    SELECT 
      o.customer_id,
      o.id as order_id,
      o.order_date,
      ARRAY(SELECT (jsonb_array_elements(o.items_json)->>'product_name')) as product_names,
      ROW_NUMBER() OVER(PARTITION BY o.customer_id ORDER BY o.order_date ASC) as order_seq
    FROM public.orders o
    WHERE o.business_id = p_business_id
      AND o.customer_id IS NOT NULL
      AND (
        o.status IN ('completed', 'processing', 'shipped')
        OR (o.raw_source_data->>'date_paid') IS NOT NULL
        OR o.source_platform = 'manual'
      )
  ),
  cohort_customers AS (
    SELECT customer_id
    FROM valid_orders
    WHERE order_seq = 1
      AND (
        p_product_filter = '' OR p_product_filter IS NULL OR
        (p_operator = 'contains' AND EXISTS (SELECT 1 FROM unnest(product_names) p WHERE p ILIKE '%' || p_product_filter || '%')) OR
        (p_operator = 'not_contains' AND NOT EXISTS (SELECT 1 FROM unnest(product_names) p WHERE p ILIKE '%' || p_product_filter || '%')) OR
        (p_operator = 'equals' AND EXISTS (SELECT 1 FROM unnest(product_names) p WHERE LOWER(p) = LOWER(p_product_filter)))
      )
  ),
  total_cohort AS (
    SELECT COUNT(*) as count FROM cohort_customers
  ),
  second_orders AS (
    SELECT 
      vo.customer_id,
      vo.product_names
    FROM valid_orders vo
    JOIN cohort_customers cc ON vo.customer_id = cc.customer_id
    WHERE vo.order_seq = 2
  ),
  retained_total AS (
    SELECT COUNT(DISTINCT customer_id) as count FROM second_orders
  ),
  expanded_second_products AS (
    SELECT 
      so.customer_id,
      unnest(so.product_names) as next_product_name
    FROM second_orders so
  ),
  aggregated_products AS (
    SELECT 
      next_product_name,
      COUNT(DISTINCT customer_id) as repeat_count
    FROM expanded_second_products
    WHERE next_product_name IS NOT NULL AND next_product_name != ''
    GROUP BY next_product_name
  )
  SELECT json_build_object(
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
          ) ORDER BY repeat_count DESC
        )
        FROM aggregated_products
      ),
      '[]'::json
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
