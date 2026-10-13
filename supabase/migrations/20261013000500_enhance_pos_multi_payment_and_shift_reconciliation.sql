-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Enhance POS Multi-Payment, Order Payment Status & Shift Reconciliation
-- Purpose:
--   1. Drop single-tender unique constraint on order_payments to support
--      multiple payments per order (installments, split payments, partial tender).
--   2. Expand order_payments payment_kind to ('payment', 'refund', 'void').
--   3. Add voided_payment_id to order_payments for audit trail link.
--   4. Add payment_status and amount_paid to orders table.
--   5. Add source_account_id and destination_account_id to pos_shifts for structured COA audit.
--   6. Rebuild v_all_payments unified view with security_invoker = true.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop single-tender unique index on order_payments
DROP INDEX IF EXISTS public.uq_order_payments_order_kind;

-- 2. Expand payment_kind check constraint
ALTER TABLE public.order_payments DROP CONSTRAINT IF EXISTS order_payments_payment_kind_check;
ALTER TABLE public.order_payments 
  ADD CONSTRAINT order_payments_payment_kind_check 
  CHECK (payment_kind IN ('payment', 'refund', 'void'));

-- 3. Add voided_payment_id for lineage tracking
ALTER TABLE public.order_payments 
  ADD COLUMN IF NOT EXISTS voided_payment_id uuid REFERENCES public.order_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_payments_voided_id 
  ON public.order_payments (voided_payment_id) 
  WHERE voided_payment_id IS NOT NULL;

-- 4. Extend orders table with payment tracking fields
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_status_check'
  ) THEN
    ALTER TABLE public.orders 
      ADD CONSTRAINT orders_payment_status_check 
      CHECK (payment_status IN ('unpaid', 'partial', 'paid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status 
  ON public.orders (business_id, payment_status);

-- Backfill legacy orders
UPDATE public.orders
SET payment_status = CASE 
  WHEN status = 'completed' THEN 'paid'
  WHEN status = 'cancelled' THEN 'unpaid'
  ELSE 'unpaid'
END,
amount_paid = CASE 
  WHEN status = 'completed' THEN COALESCE(grand_total, 0)
  ELSE 0
END
WHERE amount_paid = 0 AND (payment_status IS NULL OR payment_status = 'unpaid');

-- 5. Extend pos_shifts with relational account links
ALTER TABLE public.pos_shifts
  ADD COLUMN IF NOT EXISTS source_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

-- 6. Rebuild v_all_payments Unified View
CREATE OR REPLACE VIEW public.v_all_payments
WITH (security_invoker = true) AS

-- Branch 1: Inbound & Reversals from Orders (POS, Invoices, Online)
SELECT
    op.id,
    op.business_id,
    op.date,
    CASE WHEN op.payment_kind IN ('refund', 'void') THEN 'outbound' ELSE 'inbound' END::text AS payment_type,
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

-- Branch 2: Outbound Payments (Purchase Bills)
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

-- Branch 3: Outbound Payments (Expenses)
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

-- Branch 4: Outbound Payments (Payroll)
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
