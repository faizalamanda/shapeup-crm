-- Migration: Fix v_stock_moves_ledger to only calculate system_stock for status = 'done'
-- Context: Pending returns (quarantine), in-transit goods, and cancelled moves must NOT alter active on-hand warehouse balance.
-- Only confirmed physical movements (status = 'done') constitute active sellable on-hand inventory.

CREATE OR REPLACE VIEW public.v_stock_moves_ledger AS
SELECT 
    sm.*,
    SUM(
        CASE
            WHEN sm.status = 'done' THEN
                CASE
                    WHEN sm.type IN ('receipt', 'refund') THEN sm.qty
                    WHEN sm.type = 'delivery' THEN -sm.qty
                    WHEN sm.type = 'adjustment' AND (sm.origin_location_id IS NULL OR (sm.destination_location_id IS NOT NULL AND sm.origin_location_id IS NULL)) THEN sm.qty
                    WHEN sm.type = 'adjustment' THEN -sm.qty
                    ELSE 0
                END
            ELSE 0
        END
    ) OVER (
        PARTITION BY sm.product_id 
        ORDER BY sm.created_at ASC 
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS system_stock
FROM public.stock_moves sm;
