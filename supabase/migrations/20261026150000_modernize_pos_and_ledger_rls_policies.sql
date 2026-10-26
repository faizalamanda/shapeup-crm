-- Migration: 20261026150000_modernize_pos_and_ledger_rls_policies.sql
-- Description:
--   Modernize fragile RLS policies that relied solely on `profiles.active_business_id`.
--   Ensures that both Business Owners (businesses.owner_id) and Assigned Staff (business_staff.profile_id)
--   can reliably interact with accounts, pos_shifts, pos_shift_movements, order_payments,
--   pos_registers, and accounting transactions without hitting RLS violations.

-- 1. ACCOUNTS TABLE
DROP POLICY IF EXISTS "Users can manage their own business accounts" ON public.accounts;
CREATE POLICY "Users can manage their own business accounts" ON public.accounts
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 2. POS SHIFTS TABLE
DROP POLICY IF EXISTS "Users can manage their business pos_shifts" ON public.pos_shifts;
CREATE POLICY "Users can manage their business pos_shifts" ON public.pos_shifts
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 3. POS SHIFT MOVEMENTS TABLE
DROP POLICY IF EXISTS "Users can manage their business pos_shift_movements" ON public.pos_shift_movements;
CREATE POLICY "Users can manage their business pos_shift_movements" ON public.pos_shift_movements
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 4. POS REGISTERS TABLE
DROP POLICY IF EXISTS "Users can manage their business pos_registers" ON public.pos_registers;
CREATE POLICY "Users can manage their business pos_registers" ON public.pos_registers
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 5. ORDER PAYMENTS TABLE
DROP POLICY IF EXISTS "Users can manage order_payments of their active business" ON public.order_payments;
CREATE POLICY "Users can manage order_payments of their active business" ON public.order_payments
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 6. TRANSACTIONS TABLE
DROP POLICY IF EXISTS "Users can manage their own business transactions" ON public.transactions;
CREATE POLICY "Users can manage their own business transactions" ON public.transactions
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 7. JOURNAL LINES TABLE
DROP POLICY IF EXISTS "Users can manage their own business journal lines" ON public.journal_lines;
CREATE POLICY "Users can manage their own business journal lines" ON public.journal_lines
  FOR ALL TO authenticated
  USING (transaction_id IN (
    SELECT id FROM public.transactions 
    WHERE business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  ))
  WITH CHECK (transaction_id IN (
    SELECT id FROM public.transactions 
    WHERE business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  ));
