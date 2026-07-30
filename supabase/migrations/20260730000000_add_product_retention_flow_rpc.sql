-- Migration: 20260730000000_add_product_retention_flow_rpc.sql
-- Description: Indexes & RPC Function for Server-Side Product Flow Retention Aggregation (Scalable to 100k+ orders)

-- 1. Create B-Tree indexes for fast order date, business_id, and customer_id filtering
CREATE INDEX IF NOT EXISTS idx_orders_biz_status_date 
ON public.orders (business_id, status, order_date);

CREATE INDEX IF NOT EXISTS idx_orders_customer_date 
ON public.orders (customer_id, order_date);

-- 2. Create RPC Function to calculate product flow retention directly in PostgreSQL engine
CREATE OR REPLACE FUNCTION public.get_product_retention_flow(
  p_business_id UUID,
  p_product_filter TEXT DEFAULT '',
  p_operator TEXT DEFAULT 'contains'
)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH valid_orders AS (
    SELECT 
      id,
      COALESCE(customer_id, 'order-' || id::text) AS customer_key,
      COALESCE(order_date_utc, order_date, created_at) AS order_dt,
      items_json,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(customer_id, 'order-' || id::text)
        ORDER BY COALESCE(order_date_utc, order_date, created_at) ASC, id ASC
      ) AS order_rank
    FROM public.orders
    WHERE business_id = p_business_id
      AND LOWER(REGEXP_REPLACE(COALESCE(status, ''), '[^a-zA-Z0-9]', '', 'g')) IN ('shipped', 'processing', 'complete', 'completed')
  ),
  customer_first_orders AS (
    SELECT customer_key
    FROM valid_orders vo
    WHERE order_rank = 1
      AND (
        p_product_filter IS NULL OR TRIM(p_product_filter) = ''
        OR (
          p_operator = 'is' AND LOWER(vo.items_json::text) LIKE '%"' || LOWER(TRIM(p_product_filter)) || '"%'
        )
        OR (
          p_operator = 'is_not' AND LOWER(vo.items_json::text) NOT LIKE '%' || LOWER(TRIM(p_product_filter)) || '%'
        )
        OR (
          (p_operator IS NULL OR p_operator = 'contains') AND LOWER(vo.items_json::text) LIKE '%' || LOWER(TRIM(p_product_filter)) || '%'
        )
      )
  ),
  cohort_stats AS (
    SELECT COUNT(DISTINCT customer_key) AS cohort_size FROM customer_first_orders
  ),
  second_orders AS (
    SELECT 
      vo.customer_key,
      vo.items_json
    FROM valid_orders vo
    INNER JOIN customer_first_orders cfo ON vo.customer_key = cfo.customer_key
    WHERE vo.order_rank = 2
  ),
  retained_stats AS (
    SELECT COUNT(DISTINCT customer_key) AS retained_count FROM second_orders
  ),
  destination_items AS (
    SELECT 
      json_array_elements(
        CASE 
          WHEN json_typeof(so.items_json::json) = 'array' THEN so.items_json::json
          ELSE '[]'::json
        END
      ) AS item,
      so.customer_key
    FROM second_orders so
  ),
  destination_summary AS (
    SELECT 
      TRIM(REGEXP_REPLACE(COALESCE(item->>'name', item->>'product_name', ''), '\s+', ' ', 'g')) AS product_name,
      COUNT(DISTINCT customer_key) AS customer_count,
      COUNT(1) AS item_order_count
    FROM destination_items
    WHERE TRIM(COALESCE(item->>'name', item->>'product_name', '')) <> ''
    GROUP BY 1
    ORDER BY customer_count DESC, product_name ASC
  )
  SELECT json_build_object(
    'cohortSize', COALESCE((SELECT cohort_size FROM cohort_stats), 0),
    'retainedCount', COALESCE((SELECT retained_count FROM retained_stats), 0),
    'bouncedCount', GREATEST(0, COALESCE((SELECT cohort_size FROM cohort_stats), 0) - COALESCE((SELECT retained_count FROM retained_stats), 0)),
    'destinations', COALESCE(
      (SELECT json_agg(json_build_object(
        'productName', product_name,
        'customersCount', customer_count,
        'ordersCount', item_order_count
      )) FROM destination_summary),
      '[]'::json
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_product_retention_flow(UUID, TEXT, TEXT) TO authenticated, anon;
