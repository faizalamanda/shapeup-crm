-- Migration: Automated PostgreSQL Database Trigger to sync products.stock_quantity from public.stock_moves
-- World-Class Ledger Architecture: stock_moves is Single Source of Truth, products.stock_quantity is updated atomically by Postgres DB Engine.

CREATE OR REPLACE FUNCTION public.sync_product_stock_from_moves()
RETURNS TRIGGER AS $$
DECLARE
  target_product_id UUID;
  new_net_stock NUMERIC;
BEGIN
  target_product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT COALESCE(SUM(
    CASE
      WHEN type IN ('receipt', 'refund') THEN qty
      WHEN type = 'delivery' THEN -qty
      WHEN type = 'adjustment' AND (origin_location_id IS NULL OR (destination_location_id IS NOT NULL AND origin_location_id IS NULL)) THEN qty
      WHEN type = 'adjustment' THEN -qty
      ELSE 0
    END
  ), 0) INTO new_net_stock
  FROM public.stock_moves
  WHERE product_id = target_product_id AND status = 'done';

  UPDATE public.products
  SET stock_quantity = new_net_stock,
      updated_at = NOW()
  WHERE id = target_product_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger on stock_moves
DROP TRIGGER IF EXISTS trg_sync_product_stock_from_moves ON public.stock_moves;

CREATE TRIGGER trg_sync_product_stock_from_moves
AFTER INSERT OR UPDATE OR DELETE ON public.stock_moves
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_stock_from_moves();
