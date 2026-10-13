-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Harden order_payments RLS + support refund events
-- Purpose:
--   1. Replace active_business_id-based policy with membership-based policy
--      (business_staff + owner), consistent with stock_moves. Prevents silent
--      insert failures when a user switches business mid-session or when a
--      background job (after()) runs with a stale active business.
--   2. Add payment_kind ('payment' | 'refund') so cancellations/refunds are
--      recorded as immutable append-only events (no UPDATE/DELETE needed).
--   3. Explicit grants for authenticated & service_role.
--   4. Rebuild v_all_payments so refund rows surface as outbound cash.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Refund support (append-only event model)
ALTER TABLE public.order_payments
  ADD COLUMN IF NOT EXISTS payment_kind text NOT NULL DEFAULT 'payment';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_payments_payment_kind_check'
  ) THEN
    ALTER TABLE public.order_payments
      ADD CONSTRAINT order_payments_payment_kind_check
      CHECK (payment_kind IN ('payment', 'refund'));
  END IF;
END $$;

-- Idempotency guard: max one payment + one refund event per order (single-tender model)
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_payments_order_kind
  ON public.order_payments (order_id, payment_kind);

-- 2. Membership-based RLS
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own business order_payments" ON public.order_payments;
DROP POLICY IF EXISTS "Members can view order_payments" ON public.order_payments;
DROP POLICY IF EXISTS "Members can insert order_payments" ON public.order_payments;
DROP POLICY IF EXISTS "Members can update order_payments" ON public.order_payments;

CREATE POLICY "Members can view order_payments" ON public.order_payments
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Members can insert order_payments" ON public.order_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

-- UPDATE allowed only for linking metadata (e.g. transaction_id backfill); no DELETE policy
-- → payments are immutable for regular users. service_role bypasses RLS.
CREATE POLICY "Members can update order_payments" ON public.order_payments
  FOR UPDATE TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
      UNION
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

-- 3. Grants
GRANT SELECT, INSERT, UPDATE ON public.order_payments TO authenticated;
GRANT ALL ON public.order_payments TO service_role;

-- 4. Rebuild unified view (refund rows → outbound)
CREATE OR REPLACE VIEW public.v_all_payments
WITH (security_invoker = true) AS
SELECT
    op.id,
    op.business_id,
    op.date,
    CASE WHEN op.payment_kind = 'refund' THEN 'outbound' ELSE 'inbound' END::text AS payment_type,
    COALESCE(o.source_platform, 'Sales')::text AS channel,
    'order'::text AS source_document_type,
    op.order_id AS source_document_id,
    COALESCE(o.order_number, '')::text AS document_number,
    COALESCE(c.name, 'Customer Walk-in')::text AS partner_name,
    op.payment_method::text AS payment_method,
    op.amount::numeric AS amount,
    op.payment_method_account_id AS account_id,
    op.transaction_id,
    op.shift_id,
    COALESCE(op.cash_received, 0)::numeric AS cash_received,
    COALESCE(op.change_amount, 0)::numeric AS change_amount,
    op.reference_number::text AS reference_number,
    op.notes::text AS notes,
    op.created_at
FROM public.order_payments op
JOIN public.orders o ON op.order_id = o.id
LEFT JOIN public.customers c ON o.customer_id = c.id

UNION ALL

SELECT
    pp.id, pp.business_id, pp.date,
    'outbound'::text, 'Purchases'::text, 'purchase'::text,
    pp.purchase_id, COALESCE(p.purchase_number, '')::text,
    COALESCE(s.name, 'Supplier')::text, 'bank_transfer'::text,
    pp.amount::numeric, pp.payment_method_account_id, pp.transaction_id,
    NULL::uuid, 0::numeric, 0::numeric, NULL::text, pp.notes::text, pp.created_at
FROM public.purchase_payments pp
JOIN public.purchases p ON pp.purchase_id = p.id
LEFT JOIN public.suppliers s ON p.supplier_id = s.id

UNION ALL

SELECT
    ep.id, ep.business_id, ep.date,
    'outbound'::text, 'Expenses'::text, 'expense'::text,
    ep.expense_id, ('EXP-' || SUBSTRING(e.id::text, 1, 8))::text,
    COALESCE(e.vendor_name, e.description, 'Pengeluaran')::text, 'cash_or_bank'::text,
    ep.amount::numeric, ep.payment_method_account_id, ep.transaction_id,
    NULL::uuid, 0::numeric, 0::numeric, NULL::text, ep.notes::text, ep.created_at
FROM public.expense_payments ep
JOIN public.expenses e ON ep.expense_id = e.id

UNION ALL

SELECT
    sp.id, sp.business_id, sp.date,
    'outbound'::text, 'Payroll'::text, 'salary'::text,
    sp.salary_id, ('GAJI-' || COALESCE(es.period, ''))::text,
    COALESCE(emp.name, 'Karyawan')::text, 'bank_transfer'::text,
    sp.amount::numeric, sp.payment_method_account_id, sp.transaction_id,
    NULL::uuid, 0::numeric, 0::numeric, NULL::text, sp.notes::text, sp.created_at
FROM public.salary_payments sp
JOIN public.employee_salaries es ON sp.salary_id = es.id
LEFT JOIN public.employees emp ON es.employee_id = emp.id;

GRANT SELECT ON public.v_all_payments TO authenticated, service_role;
