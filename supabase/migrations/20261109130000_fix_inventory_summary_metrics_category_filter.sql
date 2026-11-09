-- Migration: 20261109130000_fix_inventory_summary_metrics_category_filter.sql
-- Fix get_inventory_summary_metrics to handle case-insensitive category matching,
-- UUID matching, and "Tanpa Kategori" (including products where category_id IS NULL).

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
    AND (
      p_category_name IS NULL 
      OR p_category_name = '' 
      OR LOWER(c.name) = LOWER(p_category_name)
      OR p.category_id::text = p_category_name
      OR (LOWER(p_category_name) = 'tanpa kategori' AND (p.category_id IS NULL OR LOWER(c.name) = 'tanpa kategori'))
    );

  RETURN result;
END;
$function$;

