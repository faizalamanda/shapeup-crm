-- Migration: 20261102151500_modernize_orders_customers_and_purchases_rls.sql
-- Description:
--   Modernize Row Level Security (RLS) policies on orders, customers, suppliers, expenses,
--   purchases, purchase_payments, pos_held_orders, and pos_printer_devices.
--   Enforces Rule 14 & Rule 15 from AGENTS.md:
--   Union clause: (businesses.owner_id UNION business_staff.profile_id OR profiles.active_business_id)
--   Guarantees that both Business Owners and Assigned Staff never face RLS violations or zero-row returns.

-- 1. ORDERS TABLE
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business orders" ON public.orders;
DROP POLICY IF EXISTS "Users can manage their business orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view and manage orders" ON public.orders;
DROP POLICY IF EXISTS "Members can view orders" ON public.orders;
DROP POLICY IF EXISTS "Members can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Members can update orders" ON public.orders;
CREATE POLICY "Users can manage their business orders" ON public.orders
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

-- 2. CUSTOMERS TABLE
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business customers" ON public.customers;
DROP POLICY IF EXISTS "Users can manage their business customers" ON public.customers;
DROP POLICY IF EXISTS "Users can view and manage customers" ON public.customers;
DROP POLICY IF EXISTS "Members can view customers" ON public.customers;
DROP POLICY IF EXISTS "Members can insert customers" ON public.customers;
DROP POLICY IF EXISTS "Members can update customers" ON public.customers;
CREATE POLICY "Users can manage their business customers" ON public.customers
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

-- 3. SUPPLIERS TABLE
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Users can manage their business suppliers" ON public.suppliers;
CREATE POLICY "Users can manage their business suppliers" ON public.suppliers
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

-- 4. EXPENSES TABLE
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users can manage their business expenses" ON public.expenses;
CREATE POLICY "Users can manage their business expenses" ON public.expenses
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

-- 5. PURCHASES TABLE
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business purchases" ON public.purchases;
DROP POLICY IF EXISTS "Users can manage their business purchases" ON public.purchases;
CREATE POLICY "Users can manage their business purchases" ON public.purchases
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

-- 6. PURCHASE PAYMENTS TABLE
ALTER TABLE public.purchase_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own business purchase_payments" ON public.purchase_payments;
DROP POLICY IF EXISTS "Users can manage their business purchase_payments" ON public.purchase_payments;
CREATE POLICY "Users can manage their business purchase_payments" ON public.purchase_payments
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

-- 7. POS HELD ORDERS TABLE
ALTER TABLE public.pos_held_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their business pos_held_orders" ON public.pos_held_orders;
CREATE POLICY "Users can manage their business pos_held_orders" ON public.pos_held_orders
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

-- 8. POS PRINTER DEVICES TABLE
ALTER TABLE public.pos_printer_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their business pos_printer_devices" ON public.pos_printer_devices;
CREATE POLICY "Users can manage their business pos_printer_devices" ON public.pos_printer_devices
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

-- 9. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
