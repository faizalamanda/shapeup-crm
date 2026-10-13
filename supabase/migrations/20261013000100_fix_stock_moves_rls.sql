-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Fix stock_moves RLS policies
-- Context: 20261003000000_add_stock_moves_rls.sql referenced business_staff.user_id,
--          but the real column is business_staff.profile_id → policies were never created.
--          Without policies, user-scoped clients (POS checkout, refund, returns) are
--          silently blocked from reading/writing stock_moves.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view stock_moves for their business" ON public.stock_moves;
CREATE POLICY "Users can view stock_moves for their business"
  ON public.stock_moves
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert stock_moves for their business" ON public.stock_moves;
CREATE POLICY "Users can insert stock_moves for their business"
  ON public.stock_moves
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

-- Needed by /api/inventory/returns (status pending → done / cancelled)
DROP POLICY IF EXISTS "Users can update stock_moves for their business" ON public.stock_moves;
CREATE POLICY "Users can update stock_moves for their business"
  ON public.stock_moves
  FOR UPDATE TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

-- DELETE: admins only (used by inventory backfill). Ledger rows are otherwise immutable.
DROP POLICY IF EXISTS "Admins can delete stock_moves for their business" ON public.stock_moves;
CREATE POLICY "Admins can delete stock_moves for their business"
  ON public.stock_moves
  FOR DELETE TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM public.business_staff
      WHERE profile_id = auth.uid() AND role = 'admin'
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_moves TO authenticated;
GRANT ALL ON public.stock_moves TO service_role;
