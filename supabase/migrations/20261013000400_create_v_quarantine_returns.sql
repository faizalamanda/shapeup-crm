-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Create Database View for Quarantine Returns (Single Source of Truth)
-- Context: Moves all return status resolution into native PostgreSQL Engine (Zero Logic in App).
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_quarantine_returns CASCADE;

CREATE VIEW public.v_quarantine_returns
WITH (security_invoker = true) AS
SELECT 
    r.id AS move_id,
    r.business_id,
    r.product_id,
    r.reference,
    r.qty AS return_qty,
    r.created_at AS return_date,
    p.name AS product_name,
    p.sku AS product_sku,
    p.unit AS product_unit,
    p.cost_price,

    -- 1. Status Mesin (Machine-Readable)
    CASE
        WHEN rel.source_type = 'order_return_release' THEN 'received'
        WHEN rel.source_type = 'order_return_loss' THEN 'lost'
        ELSE 'pending'
    END AS status,

    -- 2. Label Siap Tampil (Human-Readable UI Label)
    CASE
        WHEN rel.source_type = 'order_return_release' THEN 'Diterima di Gudang'
        WHEN rel.source_type = 'order_return_loss' THEN 'Hilang di Ekspedisi'
        ELSE 'Menunggu Verifikasi'
    END AS status_label,

    -- 3. Informasi Penyelesaian
    rel.created_at AS resolved_at,
    rel.reference AS resolution_reference,

    -- 4. Boolean Flags (Frontend tinggal pakai tanpa if/else rumit)
    (rel.id IS NULL) AS is_actionable

FROM public.stock_moves r
JOIN public.products p ON p.id = r.product_id
LEFT JOIN LATERAL (
    SELECT rel_sub.id, rel_sub.source_type, rel_sub.created_at, rel_sub.reference
    FROM public.stock_moves rel_sub
    WHERE rel_sub.source_id = r.id 
      AND rel_sub.type IN ('transfer', 'adjustment')
      AND rel_sub.status = 'done'
    ORDER BY rel_sub.created_at DESC
    LIMIT 1
) rel ON true
WHERE r.bucket = 'quarantine' 
  AND r.type = 'receipt'
  AND r.source_type = 'order';

-- Berikan izin akses PostgREST untuk view
GRANT SELECT ON public.v_quarantine_returns TO authenticated, anon, service_role;
