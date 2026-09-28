-- Migration: Add RPC function for ultra-fast inventory summary metrics calculation (supports search & category filters)
CREATE OR REPLACE FUNCTION public.get_inventory_summary_metrics(
  p_business_id UUID,
  p_search TEXT DEFAULT NULL,
  p_category_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
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
$$;
