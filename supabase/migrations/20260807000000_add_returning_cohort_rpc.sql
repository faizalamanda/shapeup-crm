-- Migration: 20260807000000_add_returning_cohort_rpc.sql
-- Description: RPC function for Server-Side Returning Cohort Analysis (Fast RPC Aggregation)

CREATE OR REPLACE FUNCTION public.get_returning_cohort(
  p_business_id UUID,
  p_period_unit TEXT DEFAULT 'month',
  p_duration INT DEFAULT 12,
  p_first_order_start DATE DEFAULT NULL,
  p_segment_operator TEXT DEFAULT 'contains',
  p_product_name TEXT DEFAULT ''
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
      COALESCE(grand_total, 0) AS grand_total,
      items_json
    FROM public.orders
    WHERE business_id = p_business_id
      AND LOWER(REGEXP_REPLACE(COALESCE(status, ''), '[^a-zA-Z0-9]', '', 'g')) IN ('shipped', 'processing', 'complete', 'completed')
  ),
  product_filtered_orders AS (
    SELECT *
    FROM valid_orders vo
    WHERE 
      p_product_name IS NULL OR TRIM(p_product_name) = ''
      OR (
        p_segment_operator = 'is' AND LOWER(vo.items_json::text) LIKE '%"' || LOWER(TRIM(p_product_name)) || '"%'
      )
      OR (
        p_segment_operator = 'is_not' AND LOWER(vo.items_json::text) NOT LIKE '%' || LOWER(TRIM(p_product_name)) || '%'
      )
      OR (
        (p_segment_operator IS NULL OR p_segment_operator = 'contains') AND LOWER(vo.items_json::text) LIKE '%' || LOWER(TRIM(p_product_name)) || '%'
      )
  ),
  customer_first_orders AS (
    SELECT 
      customer_key,
      MIN(order_dt) AS first_order_dt
    FROM product_filtered_orders
    GROUP BY customer_key
    HAVING p_first_order_start IS NULL OR MIN(order_dt)::date >= p_first_order_start
  ),
  orders_with_cohort AS (
    SELECT 
      pfo.id,
      pfo.customer_key,
      pfo.order_dt,
      pfo.grand_total,
      cfo.first_order_dt,
      CASE p_period_unit
        WHEN 'week' THEN date_trunc('week', cfo.first_order_dt)
        WHEN 'quarter' THEN date_trunc('quarter', cfo.first_order_dt)
        WHEN 'year' THEN date_trunc('year', cfo.first_order_dt)
        ELSE date_trunc('month', cfo.first_order_dt)
      END AS cohort_start,
      CASE p_period_unit
        WHEN 'week' THEN date_trunc('week', pfo.order_dt)
        WHEN 'quarter' THEN date_trunc('quarter', pfo.order_dt)
        WHEN 'year' THEN date_trunc('year', pfo.order_dt)
        ELSE date_trunc('month', pfo.order_dt)
      END AS order_period_start
    FROM product_filtered_orders pfo
    INNER JOIN customer_first_orders cfo ON pfo.customer_key = cfo.customer_key
  ),
  orders_with_offset AS (
    SELECT 
      owc.*,
      CASE p_period_unit
        WHEN 'week' THEN (EXTRACT(EPOCH FROM (owc.order_period_start - owc.cohort_start)) / (7 * 86400))::int
        WHEN 'month' THEN ((EXTRACT(YEAR FROM owc.order_period_start) - EXTRACT(YEAR FROM owc.cohort_start)) * 12 + EXTRACT(MONTH FROM owc.order_period_start) - EXTRACT(MONTH FROM owc.cohort_start))::int
        WHEN 'quarter' THEN (((EXTRACT(YEAR FROM owc.order_period_start) - EXTRACT(YEAR FROM owc.cohort_start)) * 12 + EXTRACT(MONTH FROM owc.order_period_start) - EXTRACT(MONTH FROM owc.cohort_start)) / 3)::int
        ELSE (EXTRACT(YEAR FROM owc.order_period_start) - EXTRACT(YEAR FROM owc.cohort_start))::int
      END AS offset_val
    FROM orders_with_cohort owc
  ),
  cohort_rows_agg AS (
    SELECT 
      cohort_start,
      COUNT(DISTINCT customer_key) AS customer_count,
      COALESCE(SUM(CASE WHEN offset_val = 0 THEN grand_total ELSE 0 END), 0) AS first_order_revenue,
      COALESCE(
        json_object_agg(
          offset_val::text, 
          returning_count
        ) FILTER (WHERE offset_val > 0 AND offset_val < p_duration), 
        '{}'::json
      ) AS returning_by_offset,
      COALESCE(
        json_object_agg(
          offset_val::text, 
          period_revenue
        ) FILTER (WHERE offset_val < p_duration), 
        '{}'::json
      ) AS revenue_by_offset
    FROM (
      SELECT 
        cohort_start,
        offset_val,
        COUNT(DISTINCT customer_key) AS returning_count,
        SUM(grand_total) AS period_revenue
      FROM orders_with_offset
      WHERE offset_val >= 0 AND offset_val < p_duration
      GROUP BY cohort_start, offset_val
    ) offset_summary
    INNER JOIN customer_first_orders cfo_dummy ON true
    GROUP BY cohort_start
  ),
  rows_json AS (
    SELECT json_agg(
      json_build_object(
        'key', to_char(cohort_start, 'YYYY-MM-DD'),
        'label', CASE p_period_unit
          WHEN 'week' THEN 'Week ' || to_char(cohort_start, 'DD Mon')
          WHEN 'quarter' THEN 'Q' || to_char(cohort_start, 'Q YYYY')
          WHEN 'year' THEN to_char(cohort_start, 'YYYY')
          ELSE to_char(cohort_start, 'Mon YYYY')
        END,
        'start', cohort_start,
        'customerCount', customer_count,
        'firstOrderRevenue', first_order_revenue,
        'returningByOffset', returning_by_offset,
        'revenueByOffset', revenue_by_offset
      )
      ORDER BY cohort_start DESC
    ) AS rows_list
    FROM (
      SELECT 
        cohort_start,
        COUNT(DISTINCT customer_key) AS customer_count,
        SUM(CASE WHEN offset_val = 0 THEN grand_total ELSE 0 END) AS first_order_revenue,
        (
          SELECT json_object_agg(sub.offset_val::text, sub.cnt)
          FROM (
            SELECT owo2.offset_val, COUNT(DISTINCT owo2.customer_key) AS cnt
            FROM orders_with_offset owo2
            WHERE owo2.cohort_start = owo.cohort_start AND owo2.offset_val > 0 AND owo2.offset_val < p_duration
            GROUP BY owo2.offset_val
          ) sub
        ) AS returning_by_offset,
        (
          SELECT json_object_agg(sub.offset_val::text, sub.rev)
          FROM (
            SELECT owo3.offset_val, SUM(owo3.grand_total) AS rev
            FROM orders_with_offset owo3
            WHERE owo3.cohort_start = owo.cohort_start AND owo3.offset_val >= 0 AND owo3.offset_val < p_duration
            GROUP BY owo3.offset_val
          ) sub
        ) AS revenue_by_offset
      FROM orders_with_offset owo
      WHERE offset_val >= 0 AND offset_val < p_duration
      GROUP BY cohort_start
    ) row_sub
  ),
  overall_stats AS (
    SELECT 
      COUNT(DISTINCT customer_key) AS total_customers,
      COUNT(DISTINCT CASE WHEN offset_val > 0 THEN customer_key END) AS returning_customers,
      COALESCE(SUM(grand_total), 0) AS total_revenue
    FROM orders_with_offset
    WHERE offset_val >= 0 AND offset_val < p_duration
  )
  SELECT json_build_object(
    'totalCustomers', COALESCE((SELECT total_customers FROM overall_stats), 0),
    'returningCustomers', COALESCE((SELECT returning_customers FROM overall_stats), 0),
    'repeatRate', CASE 
      WHEN COALESCE((SELECT total_customers FROM overall_stats), 0) > 0 
      THEN ROUND((COALESCE((SELECT returning_customers FROM overall_stats), 0)::numeric / (SELECT total_customers FROM overall_stats)::numeric * 100), 2)
      ELSE 0 
    END,
    'totalRevenue', COALESCE((SELECT total_revenue FROM overall_stats), 0),
    'rows', COALESCE((SELECT rows_list FROM rows_json), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_returning_cohort(UUID, TEXT, INT, DATE, TEXT, TEXT) TO authenticated, anon;
