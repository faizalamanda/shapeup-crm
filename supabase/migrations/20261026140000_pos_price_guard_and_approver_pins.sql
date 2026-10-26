-- Migration: 20261026140000_pos_price_guard_and_approver_pins.sql
-- Description:
--   1. Add prevent_below_hpp flag to products table.
--   2. Add can_approve_pos flag to business_staff table.
--   3. Create price_guard_settings table for POS price floor configuration.
--   4. Create pos_approver_pins table for hashed personal 6-digit approver PINs.
--   5. Create price_override_logs table for append-only audit trail of price/discount overrides.

-- 1. Products: Add prevent_below_hpp flag
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS prevent_below_hpp boolean NOT NULL DEFAULT false;

-- 2. Business Staff: Add can_approve_pos flag
ALTER TABLE public.business_staff
  ADD COLUMN IF NOT EXISTS can_approve_pos boolean NOT NULL DEFAULT false;

-- 3. Price Guard Settings table (1 row per business)
CREATE TABLE IF NOT EXISTS public.price_guard_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  global_enabled boolean NOT NULL DEFAULT false,
  channels text[] NOT NULL DEFAULT '{pos}' CHECK (channels <@ ARRAY['pos','invoice','manual_order']),
  require_global_discount_auth boolean NOT NULL DEFAULT false,
  require_approver_pin boolean NOT NULL DEFAULT false,
  require_reason boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_guard_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff and owners can view price_guard_settings" ON public.price_guard_settings;
CREATE POLICY "Staff and owners can view price_guard_settings" ON public.price_guard_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_staff
      WHERE business_staff.business_id = price_guard_settings.business_id
        AND business_staff.profile_id = auth.uid()
      UNION
      SELECT 1 FROM public.businesses
      WHERE businesses.id = price_guard_settings.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners and admins can manage price_guard_settings" ON public.price_guard_settings;
CREATE POLICY "Owners and admins can manage price_guard_settings" ON public.price_guard_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses
      WHERE businesses.id = price_guard_settings.business_id
        AND businesses.owner_id = auth.uid()
      UNION
      SELECT 1 FROM public.business_staff
      WHERE business_staff.business_id = price_guard_settings.business_id
        AND business_staff.profile_id = auth.uid()
        AND business_staff.role = 'admin'
    )
  );

-- 4. POS Approver PINs table (Hashed with scrypt, rate-limited lockout)
CREATE TABLE IF NOT EXISTS public.pos_approver_pins (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);

ALTER TABLE public.pos_approver_pins ENABLE ROW LEVEL SECURITY;
-- Direct client access is denied; managed securely through service-role backend API.

-- 5. Price Override Logs table (Append-only audit trail)
CREATE TABLE IF NOT EXISTS public.price_override_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'pos',
  trigger text NOT NULL CHECK (trigger IN ('line_price', 'global_discount')),
  shift_id uuid REFERENCES public.pos_shifts(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  qty numeric,
  requested_net_price numeric NOT NULL DEFAULT 0,
  cost_snapshot numeric NOT NULL DEFAULT 0,
  reason text,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_override_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and admins can view price_override_logs" ON public.price_override_logs;
CREATE POLICY "Owners and admins can view price_override_logs" ON public.price_override_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses
      WHERE businesses.id = price_override_logs.business_id
        AND businesses.owner_id = auth.uid()
      UNION
      SELECT 1 FROM public.business_staff
      WHERE business_staff.business_id = price_override_logs.business_id
        AND business_staff.profile_id = auth.uid()
        AND business_staff.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Staff and owners can insert price_override_logs" ON public.price_override_logs;
CREATE POLICY "Staff and owners can insert price_override_logs" ON public.price_override_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses
      WHERE businesses.id = price_override_logs.business_id
        AND businesses.owner_id = auth.uid()
      UNION
      SELECT 1 FROM public.business_staff
      WHERE business_staff.business_id = price_override_logs.business_id
        AND business_staff.profile_id = auth.uid()
    )
  );

