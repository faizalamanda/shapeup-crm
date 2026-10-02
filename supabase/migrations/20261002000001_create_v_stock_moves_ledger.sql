-- Migration: Create View for World-Class Ledger Architecture with Window Functions

CREATE OR REPLACE VIEW public.v_stock_moves_ledger AS
SELECT 
    sm.*,
    SUM(
        CASE
            WHEN sm.type IN ('receipt', 'refund') THEN sm.qty
            WHEN sm.type = 'delivery' THEN -sm.qty
            WHEN sm.type = 'adjustment' AND (sm.origin_location_id IS NULL OR (sm.destination_location_id IS NOT NULL AND sm.origin_location_id IS NULL)) THEN sm.qty
            WHEN sm.type = 'adjustment' THEN -sm.qty
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC 
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS system_stock
FROM public.stock_moves sm;
