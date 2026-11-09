-- Migration: 20261109100000_fix_customer_metrics_joined_at_and_dates.sql
-- Description:
--   1. Update public.customer_metrics view:
--      - joined_at uses earliest completed order_date (acquisition date) with fallback to c.created_at
--      - add first_order_date explicitly
--      - WITH (security_invoker = true) for multi-tenant RLS enforcement (Rule 11)
--   2. Grant permissions to authenticated and anon

DROP VIEW IF EXISTS public.customer_metrics CASCADE;

CREATE OR REPLACE VIEW public.customer_metrics WITH (security_invoker = true) AS
SELECT
  c.id                                                        AS customer_id,
  c.business_id,
  c.name,
  c.phone,
  c.email,
  c.category,
  -- First completed order date (Customer Acquisition Event Date)
  (SELECT MIN(o1.order_date)
   FROM public.orders o1
   WHERE o1.customer_id = c.id
     AND o1.business_id = c.business_id
     AND o1.status = 'completed')                             AS first_order_date,

  -- joined_at: Acquisition Date if purchased, fallback to created_at if prospect
  COALESCE(
    (SELECT MIN(o1.order_date)
     FROM public.orders o1
     WHERE o1.customer_id = c.id
       AND o1.business_id = c.business_id
       AND o1.status = 'completed'),
    c.created_at
  )                                                           AS joined_at,

  -- Construct address from address_data JSONB
  CASE
    WHEN c.address_data IS NOT NULL THEN
      CONCAT_WS(', ',
        NULLIF(TRIM(c.address_data->>'address_line1'), ''),
        NULLIF(TRIM(c.address_data->>'address_line2'), ''),
        NULLIF(TRIM(c.address_data->>'subdistrict'), ''),
        NULLIF(TRIM(c.address_data->>'city'), ''),
        NULLIF(TRIM(c.address_data->>'state'), ''),
        NULLIF(TRIM(c.address_data->>'postcode'), ''),
        NULLIF(TRIM(c.address_data->>'country'), '')
      )
    ELSE NULL
  END                                                         AS address,

  -- Completed metrics (Only status = 'completed')
  COALESCE(count(o_comp.id), 0)                               AS completed_order_count,
  COALESCE(count(o_comp.id), 0)                               AS total_order_count,
  COALESCE(sum(o_comp.grand_total), 0)                        AS ltv,
  CASE
    WHEN count(o_comp.id) > 0 THEN COALESCE(sum(o_comp.grand_total), 0) / count(o_comp.id)
    ELSE 0
  END                                                         AS aov,
  
  -- Absolute last order attributes (any status)
  (SELECT o2.order_date
   FROM public.orders o2
   WHERE o2.customer_id = c.id
     AND o2.business_id = c.business_id
   ORDER BY o2.order_date DESC
   LIMIT 1)                                                   AS last_order_date,
    
  (SELECT o2.status
   FROM public.orders o2
   WHERE o2.customer_id = c.id
     AND o2.business_id = c.business_id
   ORDER BY o2.order_date DESC
   LIMIT 1)                                                   AS last_order_status,
    
  -- Days since last COMPLETED order
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.orders o3
      WHERE o3.customer_id = c.id
        AND o3.status = 'completed'
        AND o3.business_id = c.business_id
    ) THEN EXTRACT(EPOCH FROM (NOW() - (
      SELECT o3.order_date
      FROM public.orders o3
      WHERE o3.customer_id = c.id
        AND o3.status = 'completed'
        AND o3.business_id = c.business_id
      ORDER BY o3.order_date DESC
      LIMIT 1
    ))) / 86400
    ELSE NULL
  END                                                         AS days_since_last_order,

  -- ─── Loyalty Columns ───────────────────────────────────────
  COALESCE(cp.current_points, 0)                              AS loyalty_points,
  COALESCE(cp.lifetime_earned, 0)                             AS loyalty_lifetime_earned,
  COALESCE(cp.lifetime_redeemed, 0)                           AS loyalty_lifetime_redeemed,
  COALESCE(cp.tier, 'Bronze')                                 AS loyalty_tier,
  cp.last_activity_at                                         AS loyalty_last_activity_at

FROM public.customers c
LEFT JOIN public.orders o_comp
  ON o_comp.customer_id = c.id
  AND o_comp.business_id = c.business_id
  AND o_comp.status = 'completed'
LEFT JOIN public.customer_points cp
  ON cp.customer_id = c.id
  AND cp.business_id = c.business_id
GROUP BY
  c.id, c.business_id, c.name, c.phone, c.email,
  c.category, c.created_at, c.address_data,
  cp.current_points, cp.lifetime_earned, cp.lifetime_redeemed,
  cp.tier, cp.last_activity_at;

-- Grant access
GRANT SELECT ON public.customer_metrics TO authenticated;
GRANT SELECT ON public.customer_metrics TO anon;

