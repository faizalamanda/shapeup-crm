-- Migration: 20260918000000_create_loyalty_program.sql
-- Description:
--   Fitur Loyalty Member Program (Plugin)
--   1. Table loyalty_settings  — konfigurasi program per bisnis
--   2. Table customer_points   — saldo poin per customer (denormalized)
--   3. Table loyalty_point_ledger — histori semua transaksi poin
--   4. Update view customer_metrics untuk include loyalty data

-- ══════════════════════════════════════════════════════════════
-- 1. TABLE: loyalty_settings
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_settings (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid        UNIQUE NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- Program Config
  is_enabled              boolean     NOT NULL DEFAULT false,
  program_name            text        NOT NULL DEFAULT 'Member Loyalty',

  -- Earning Rules: 1 poin per X rupiah dari nilai order
  amount_per_point        integer     NOT NULL DEFAULT 10000,   -- Rp 10.000 = 1 poin
  min_transaction         integer     NOT NULL DEFAULT 0,       -- minimum transaksi untuk dapat poin

  -- Redemption Rules
  redemption_enabled      boolean     NOT NULL DEFAULT true,
  points_per_redemption   integer     NOT NULL DEFAULT 100,     -- 100 poin
  redemption_value        integer     NOT NULL DEFAULT 10000,   -- = Rp 10.000 diskon
  max_redemption_pct      integer     NOT NULL DEFAULT 50,      -- max 50% dari total transaksi

  -- Point Expiry
  expiry_enabled          boolean     NOT NULL DEFAULT false,
  expiry_months           integer     NOT NULL DEFAULT 12,      -- expire setelah 12 bulan tidak aktif

  -- Tier Configuration (JSONB array, ordered by min_points ASC)
  -- Each tier: { name, min_points, color, multiplier, badge_icon }
  tiers                   jsonb       NOT NULL DEFAULT '[
    {"name":"Bronze","min_points":0,"color":"#cd7f32","multiplier":1.0,"badge_icon":"🥉"},
    {"name":"Silver","min_points":500,"color":"#9ca3af","multiplier":1.5,"badge_icon":"🥈"},
    {"name":"Gold","min_points":2000,"color":"#f59e0b","multiplier":2.0,"badge_icon":"🥇"},
    {"name":"Platinum","min_points":5000,"color":"#8b5cf6","multiplier":3.0,"badge_icon":"💎"}
  ]'::jsonb,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_settings_business
  ON public.loyalty_settings (business_id);

-- RLS
ALTER TABLE public.loyalty_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can manage loyalty settings" ON public.loyalty_settings;
CREATE POLICY "Business members can manage loyalty settings"
  ON public.loyalty_settings
  FOR ALL TO authenticated
  USING (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- ══════════════════════════════════════════════════════════════
-- 2. TABLE: customer_points
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_points (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id         uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,

  current_points      integer     NOT NULL DEFAULT 0,
  lifetime_earned     integer     NOT NULL DEFAULT 0,
  lifetime_redeemed   integer     NOT NULL DEFAULT 0,
  tier                text        NOT NULL DEFAULT 'Bronze',

  last_activity_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE(business_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_points_business
  ON public.customer_points (business_id);

CREATE INDEX IF NOT EXISTS idx_customer_points_customer
  ON public.customer_points (customer_id);

-- RLS
ALTER TABLE public.customer_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can view customer points" ON public.customer_points;
CREATE POLICY "Business members can view customer points"
  ON public.customer_points
  FOR ALL TO authenticated
  USING (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- ══════════════════════════════════════════════════════════════
-- 3. TABLE: loyalty_point_ledger
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_point_ledger (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  order_id        uuid        REFERENCES public.orders(id) ON DELETE SET NULL,

  -- Type of point transaction
  -- earned    : dari pembelian order
  -- redeemed  : ditukar jadi diskon
  -- expired   : kadaluarsa
  -- adjusted  : manual adjustment oleh staff
  -- reversed  : poin dikembalikan saat order cancelled/refunded/returned
  type            text        NOT NULL CHECK (type IN ('earned', 'redeemed', 'expired', 'adjusted', 'reversed')),

  points          integer     NOT NULL,        -- positif = tambah poin, negatif = kurang poin
  balance_after   integer     NOT NULL,        -- saldo poin setelah transaksi ini
  description     text,                        -- keterangan (mis. "Order #1234 — Rp 150.000")
  multiplier_used numeric(4,2) DEFAULT 1.0,   -- multiplier tier yang dipakai saat earn
  order_amount    integer,                     -- nilai order (untuk audit)

  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_business
  ON public.loyalty_point_ledger (business_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_customer
  ON public.loyalty_point_ledger (customer_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_order
  ON public.loyalty_point_ledger (order_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_created
  ON public.loyalty_point_ledger (created_at DESC);

-- RLS
ALTER TABLE public.loyalty_point_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can view loyalty ledger" ON public.loyalty_point_ledger;
CREATE POLICY "Business members can view loyalty ledger"
  ON public.loyalty_point_ledger
  FOR ALL TO authenticated
  USING (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- ══════════════════════════════════════════════════════════════
-- 4. GRANT ACCESS
-- ══════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.loyalty_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_points TO authenticated;
GRANT SELECT, INSERT ON public.loyalty_point_ledger TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5. AUTO-UPDATE updated_at TRIGGERS
-- ══════════════════════════════════════════════════════════════

-- Reuse set_updated_at function if exists (from previous migrations)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_loyalty_settings_updated_at ON public.loyalty_settings;
CREATE TRIGGER trg_loyalty_settings_updated_at
  BEFORE UPDATE ON public.loyalty_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_points_updated_at ON public.customer_points;
CREATE TRIGGER trg_customer_points_updated_at
  BEFORE UPDATE ON public.customer_points
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- 6. UPDATE VIEW: customer_metrics — tambah loyalty columns
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
