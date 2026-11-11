-- Migration: 20261111100000_update_inventory_summary_metrics_with_variants.sql
-- Update get_inventory_summary_metrics to account for both main products and derivative product variants.
-- Each variant of a multi-variant product is calculated as an individual discrete SKU,
-- while non-variant products are calculated directly from public.products.

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
  -- Multi-Tenant Security Guard: Validasi akses pemanggil ke unit bisnis (Rule 14 & 15 compliant)
  IF NOT EXISTS (
    SELECT 1 FROM public.business_staff 
    WHERE business_id = p_business_id AND profile_id = auth.uid()
    UNION
    SELECT 1 FROM public.businesses 
    WHERE id = p_business_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki akses ke unit bisnis ini.';
  END IF;

  WITH filtered_products AS (
    SELECT 
      p.id, 
      p.name, 
      p.sku, 
      p.cost_price, 
      p.stock_quantity, 
      p.category_id, 
      c.name AS category_name
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE p.business_id = p_business_id
      AND (
        p_category_name IS NULL 
        OR p_category_name = '' 
        OR LOWER(c.name) = LOWER(p_category_name)
        OR p.category_id::text = p_category_name
        OR (LOWER(p_category_name) = 'tanpa kategori' AND (p.category_id IS NULL OR LOWER(c.name) = 'tanpa kategori'))
      )
  ),
  discrete_items AS (
    -- 1. Variant items: Tiap varian fisik diskret dari produk yang memiliki varian
    SELECT 
      pv.id AS item_id,
      pv.product_id,
      (fp.name || ' - ' || pv.name) AS item_name,
      COALESCE(pv.sku, fp.sku) AS item_sku,
      COALESCE(pv.stock_quantity, 0) AS stock_qty,
      COALESCE(NULLIF(pv.cost_price, 0), fp.cost_price, 0) AS cost_price
    FROM public.product_variants pv
    JOIN filtered_products fp ON fp.id = pv.product_id
    WHERE pv.business_id = p_business_id

    UNION ALL

    -- 2. Non-variant products: Produk yang tidak memiliki varian di product_variants
    SELECT 
      fp.id AS item_id,
      fp.id AS product_id,
      fp.name AS item_name,
      fp.sku AS item_sku,
      COALESCE(fp.stock_quantity, 0) AS stock_qty,
      COALESCE(fp.cost_price, 0) AS cost_price
    FROM filtered_products fp
    WHERE NOT EXISTS (
      SELECT 1 FROM public.product_variants pv 
      WHERE pv.product_id = fp.id
    )
  )
  SELECT jsonb_build_object(
    'total_products', COUNT(*),
    'total_stock_qty', COALESCE(SUM(di.stock_qty), 0),
    'total_valuation', COALESCE(SUM(di.stock_qty * di.cost_price), 0),
    'out_of_stock_count', COUNT(*) FILTER (WHERE di.stock_qty <= 0),
    'low_stock_count', COUNT(*) FILTER (WHERE di.stock_qty > 0 AND di.stock_qty <= 5)
  ) INTO result
  FROM discrete_items di
  WHERE (
    p_search IS NULL 
    OR p_search = '' 
    OR di.item_name ILIKE '%' || p_search || '%' 
    OR di.item_sku ILIKE '%' || p_search || '%'
  );

  RETURN result;
END;
$function$;

