-- Migration: 20260721000000_fix_customer_metrics_and_presets.sql
-- Description:
--   1. Recreate customer_metrics view — LTV, AOV, total_order_count, days_since_last_order hanya dari order berstatus 'completed'
--      Namun last_order_date dan last_order_status tetap dari order terakhir mutlak (apapun statusnya) untuk kebutuhan filter/tampilan
--      Tambah kolom: days_since_last_order, completed_order_count, email, address (constructed from address_data JSONB)
--   2. Create table customer_segment_presets untuk menyimpan preset segmentasi per business+user

-- ══════════════════════════════════════════════════════════════
-- 1. RECREATE VIEW customer_metrics
-- ══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.customer_metrics;

CREATE OR REPLACE VIEW public.customer_metrics AS
SELECT
  c.id                                                        AS customer_id,
  c.business_id,
  c.name,
  c.phone,
  c.email,
  c.category,
  c.created_at                                                AS joined_at,
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
  END                                                         AS days_since_last_order
FROM public.customers c
LEFT JOIN public.orders o_comp
  ON o_comp.customer_id = c.id
  AND o_comp.business_id = c.business_id
  AND o_comp.status = 'completed'
GROUP BY
  c.id, c.business_id, c.name, c.phone, c.email,
  c.category, c.created_at, c.address_data;

-- Grant access
GRANT SELECT ON public.customer_metrics TO authenticated;
GRANT SELECT ON public.customer_metrics TO anon;

-- ══════════════════════════════════════════════════════════════
-- 2. CREATE TABLE customer_segment_presets
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_segment_presets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  emoji         text        NOT NULL DEFAULT '🔖',
  rules         jsonb       NOT NULL DEFAULT '[]',
  is_default    boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csp_business_user
  ON public.customer_segment_presets (business_id, user_id);

-- RLS
ALTER TABLE public.customer_segment_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own segment presets" ON public.customer_segment_presets;
CREATE POLICY "Users can manage their own segment presets"
  ON public.customer_segment_presets
  FOR ALL TO authenticated
  USING (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    AND user_id = auth.uid()
  )
  WITH CHECK (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    AND user_id = auth.uid()
  );

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_csp_updated_at ON public.customer_segment_presets;
CREATE TRIGGER trg_csp_updated_at
  BEFORE UPDATE ON public.customer_segment_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
