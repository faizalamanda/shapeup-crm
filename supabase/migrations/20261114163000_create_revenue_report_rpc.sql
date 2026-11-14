-- =============================================================================
-- Migration: High-Speed Revenue Report RPC (Query Shipping & JSONB Pushdown)
-- Purpose:
--   1. Eliminates 30-50 MB TOAST `raw_source_data` transfer by extracting only
--      required scalar attributes directly inside PostgreSQL.
--   2. Joins `order_payments` (`payment_kind = 'refund'`) and WooCommerce
--      `raw_source_data->'refunds'` in-memory on the DB server.
--   3. Bypasses PostgREST 1,000-row pagination ceiling in a single 1-RTT call.
--   4. Enforces strict Multi-Tenant RBAC Guard Clause (Owner + Assigned Staff).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_business_order_date_status
  ON public.orders (business_id, order_date);

CREATE INDEX IF NOT EXISTS idx_order_payments_business_refund_order
  ON public.order_payments (business_id, order_id)
  WHERE payment_kind = 'refund';

CREATE OR REPLACE FUNCTION public.get_revenue_report_orders(
  p_business_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- 1. Strict Multi-Tenant Security Guard Clause (AGENTS.md Rule #14)
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id AND owner_id = auth.uid()
    UNION
    SELECT 1 FROM public.business_staff
    WHERE business_id = p_business_id AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki akses ke unit bisnis ini.';
  END IF;

  -- 2. Single-pass Query Shipping with JSONB Scalar Pushdown & Refund Aggregation
  WITH refund_ledger AS (
    SELECT
      op.order_id,
      SUM(ABS(COALESCE(op.amount, 0))) AS ledger_refund
    FROM public.order_payments op
    WHERE op.business_id = p_business_id
      AND op.payment_kind = 'refund'
      AND op.order_id IS NOT NULL
    GROUP BY op.order_id
  ),
  filtered_orders AS (
    SELECT
      o.id,
      o.order_date,
      o.order_date_utc,
      o.created_at,
      LOWER(REGEXP_REPLACE(COALESCE(o.status, ''), '[^a-zA-Z0-9]', '', 'g')) AS norm_status,
      LOWER(COALESCE(o.payment_status, '')) AS payment_status,
      COALESCE(
        NULLIF(BTRIM(o.payment_method), ''),
        NULLIF(BTRIM(o.raw_source_data->>'payment_method_title'), ''),
        'Manual / Tunai'
      ) AS payment_method,
      COALESCE(
        NULLIF(BTRIM(o.source_platform), ''),
        NULLIF(BTRIM(o.raw_source_data->'source_order'->>'channel'), ''),
        'Manual'
      ) AS source_platform,
      GREATEST(0, COALESCE(o.subtotal, 0)) AS subtotal,
      GREATEST(
        0,
        COALESCE(
          NULLIF(o.shipping_cost, 0),
          NULLIF((o.raw_source_data->>'shipping_total')::numeric, 0),
          0
        )
      ) AS shipping_cost,
      GREATEST(0, COALESCE(o.discount_amount, 0)) AS discount_amount,
      GREATEST(0, ABS(COALESCE(o.other_fees, 0))) AS other_fees,
      GREATEST(0, COALESCE(o.grand_total, 0)) AS grand_total,
      GREATEST(
        0,
        COALESCE(
          NULLIF((o.raw_source_data->>'total_tax')::numeric, 0),
          NULLIF((o.raw_source_data->>'tax_total')::numeric, 0),
          0
        )
      ) AS taxes,
      UPPER(
        COALESCE(
          NULLIF(BTRIM(o.raw_source_data->'billing'->>'country'), ''),
          NULLIF(BTRIM(o.raw_source_data->'shipping'->>'country'), ''),
          'ID'
        )
      ) AS country,
      COALESCE(
        NULLIF(BTRIM(o.raw_source_data->'shipping'->>'city'), ''),
        NULLIF(BTRIM(o.raw_source_data->'billing'->>'city'), ''),
        'Tidak Diketahui'
      ) AS city,
      COALESCE(
        NULLIF(BTRIM(o.raw_source_data->'shipping'->>'state'), ''),
        NULLIF(BTRIM(o.raw_source_data->'billing'->>'state'), ''),
        'Tidak Diketahui'
      ) AS province,
      COALESCE(
        NULLIF(BTRIM(o.raw_source_data->'shipping_lines'->0->>'method_title'), ''),
        'Tanpa Ekspedisi'
      ) AS courier,
      COALESCE(
        NULLIF(BTRIM(o.raw_source_data->'tax_lines'->0->>'rate_code'), ''),
        NULLIF(BTRIM(o.raw_source_data->'tax_lines'->0->>'label'), ''),
        ''
      ) AS tax_code,
      COALESCE(rl.ledger_refund, 0) AS ledger_refund,
      COALESCE(
        (
          SELECT SUM(ABS(COALESCE((r_elem->>'total')::numeric, (r_elem->>'amount')::numeric, 0)))
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(o.raw_source_data->'refunds') = 'array' THEN o.raw_source_data->'refunds'
              ELSE '[]'::jsonb
            END
          ) AS r_elem
        ),
        0
      ) AS raw_refunds
    FROM public.orders o
    LEFT JOIN refund_ledger rl ON rl.order_id = o.id
    WHERE o.business_id = p_business_id
      AND (p_start_date IS NULL OR o.order_date >= p_start_date)
      AND (p_end_date IS NULL OR o.order_date <= p_end_date)
      AND LOWER(REGEXP_REPLACE(COALESCE(o.status, ''), '[^a-zA-Z0-9]', '', 'g')) IN (
        'shipped',
        'processing',
        'complete',
        'completed',
        'refunded',
        'returned',
        'returnrequest'
      )
    ORDER BY o.order_date ASC, o.id ASC
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', fo.id,
        'order_date', fo.order_date,
        'order_date_utc', fo.order_date_utc,
        'created_at', fo.created_at,
        'status', fo.norm_status,
        'payment_status', fo.payment_status,
        'payment_method', fo.payment_method,
        'source_platform', fo.source_platform,
        'subtotal', fo.subtotal,
        'shipping_cost', fo.shipping_cost,
        'discount_amount', fo.discount_amount,
        'other_fees', fo.other_fees,
        'grand_total', fo.grand_total,
        'taxes', fo.taxes,
        'country', fo.country,
        'city', fo.city,
        'province', fo.province,
        'courier', fo.courier,
        'tax_code', fo.tax_code,
        'ledger_refund', fo.ledger_refund,
        'raw_refunds', fo.raw_refunds
      )
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM filtered_orders fo;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_revenue_report_orders(uuid, timestamptz, timestamptz) TO authenticated;

