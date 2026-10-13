-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Create order_payments table and v_all_payments Unified View
-- Purpose:
--   1. Provide dedicated payment record entity for Orders (POS & Invoices)
--   2. Support cash drawer breakdown (cash_received, change_amount), split payment
--   3. Link orders to pos_shifts and pos_registers
--   4. Establish Odoo-style unified payment view (v_all_payments) for Inbound & Outbound
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend orders table with shift & register foreign keys
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.pos_shifts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS register_id uuid REFERENCES public.pos_registers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_shift_id ON public.orders (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_register_id ON public.orders (register_id) WHERE register_id IS NOT NULL;

-- 2. Create order_payments table
CREATE TABLE IF NOT EXISTS public.order_payments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    shift_id uuid REFERENCES public.pos_shifts(id) ON DELETE SET NULL,
    date date NOT NULL DEFAULT current_date,
    amount numeric NOT NULL CHECK (amount > 0),
    payment_method text NOT NULL, -- 'cash', 'bank', 'qris', 'card'
    payment_method_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
    cash_received numeric DEFAULT 0 CHECK (cash_received >= 0),
    change_amount numeric DEFAULT 0 CHECK (change_amount >= 0),
    reference_number text, -- Reference from EDC / QRIS approval code
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT order_payments_pkey PRIMARY KEY (id)
);

-- 3. Enable Row Level Security (RLS) on order_payments
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own business order_payments" ON public.order_payments;
CREATE POLICY "Users can manage their own business order_payments" ON public.order_payments
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 4. High-Throughput Minimalist Indexes
CREATE INDEX IF NOT EXISTS idx_order_payments_tenant_date 
    ON public.order_payments (business_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_order_payments_order_id 
    ON public.order_payments (order_id);

CREATE INDEX IF NOT EXISTS idx_order_payments_shift_id 
    ON public.order_payments (shift_id) 
    WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_payments_transaction_id 
    ON public.order_payments (transaction_id) 
    WHERE transaction_id IS NOT NULL;

-- 5. Create or Replace v_all_payments (Unified Payment Hub Read Model)
CREATE OR REPLACE VIEW public.v_all_payments 
WITH (security_invoker = true) AS

-- Branch 1: Inbound Payments (Sales Orders, POS, Invoices)
SELECT
    op.id,
    op.business_id,
    op.date,
    'inbound'::text AS payment_type,
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

-- Branch 2: Outbound Payments (Purchase Bills / Pemasok)
SELECT
    pp.id,
    pp.business_id,
    pp.date,
    'outbound'::text AS payment_type,
    'Purchases'::text AS channel,
    'purchase'::text AS source_document_type,
    pp.purchase_id AS source_document_id,
    COALESCE(p.purchase_number, '')::text AS document_number,
    COALESCE(s.name, 'Supplier')::text AS partner_name,
    'bank_transfer'::text AS payment_method,
    pp.amount::numeric AS amount,
    pp.payment_method_account_id AS account_id,
    pp.transaction_id,
    NULL::uuid AS shift_id,
    0::numeric AS cash_received,
    0::numeric AS change_amount,
    NULL::text AS reference_number,
    pp.notes::text AS notes,
    pp.created_at
FROM public.purchase_payments pp
JOIN public.purchases p ON pp.purchase_id = p.id
LEFT JOIN public.suppliers s ON p.supplier_id = s.id

UNION ALL

-- Branch 3: Outbound Payments (Biaya Operasional / Expenses)
SELECT
    ep.id,
    ep.business_id,
    ep.date,
    'outbound'::text AS payment_type,
    'Expenses'::text AS channel,
    'expense'::text AS source_document_type,
    ep.expense_id AS source_document_id,
    ('EXP-' || SUBSTRING(e.id::text, 1, 8))::text AS document_number,
    COALESCE(e.vendor_name, e.description, 'Pengeluaran')::text AS partner_name,
    'cash_or_bank'::text AS payment_method,
    ep.amount::numeric AS amount,
    ep.payment_method_account_id AS account_id,
    ep.transaction_id,
    NULL::uuid AS shift_id,
    0::numeric AS cash_received,
    0::numeric AS change_amount,
    NULL::text AS reference_number,
    ep.notes::text AS notes,
    ep.created_at
FROM public.expense_payments ep
JOIN public.expenses e ON ep.expense_id = e.id

UNION ALL

-- Branch 4: Outbound Payments (Penggajian / Salary Payroll)
SELECT
    sp.id,
    sp.business_id,
    sp.date,
    'outbound'::text AS payment_type,
    'Payroll'::text AS channel,
    'salary'::text AS source_document_type,
    sp.salary_id AS source_document_id,
    ('GAJI-' || COALESCE(es.period, ''))::text AS document_number,
    COALESCE(emp.name, 'Karyawan')::text AS partner_name,
    'bank_transfer'::text AS payment_method,
    sp.amount::numeric AS amount,
    sp.payment_method_account_id AS account_id,
    sp.transaction_id,
    NULL::uuid AS shift_id,
    0::numeric AS cash_received,
    0::numeric AS change_amount,
    NULL::text AS reference_number,
    sp.notes::text AS notes,
    sp.created_at
FROM public.salary_payments sp
JOIN public.employee_salaries es ON sp.salary_id = es.id
LEFT JOIN public.employees emp ON es.employee_id = emp.id;
