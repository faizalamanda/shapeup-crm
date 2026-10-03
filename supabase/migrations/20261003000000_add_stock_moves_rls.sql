-- Migration: Add Row Level Security (RLS) policies for public.stock_moves
-- Ensures authenticated staff members can view and insert stock movements for their assigned business.

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view stock_moves for their business" ON public.stock_moves;
CREATE POLICY "Users can view stock_moves for their business"
  ON public.stock_moves
  FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE user_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert stock_moves for their business" ON public.stock_moves;
CREATE POLICY "Users can insert stock_moves for their business"
  ON public.stock_moves
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE user_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );
