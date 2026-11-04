-- Migration: 20261103170000_world_class_payroll_reversals_and_rls.sql
-- Description:
--   1. Replace unconditional UNIQUE(employee_id, period) on employee_salaries with a Partial Unique Index
--      (WHERE payment_status <> 'cancelled') so cancelled payslips preserve audit history without blocking new payslips.
--   2. Extend salary_payments with append-only void tracking (status, voided_at, void_reason, reversal_transaction_id).
--   3. Modernize RLS policies on employees, employee_salaries, and salary_payments (Owner UNION Staff).
--   4. Update v_all_payments, get_ledger_balances, and get_cash_flow_summary to accurately reflect voided salary payments.

-- 1. Partial Unique Index on employee_salaries (allow re-creation after cancellation)
ALTER TABLE public.employee_salaries
  DROP CONSTRAINT IF EXISTS employee_salaries_employee_period_key;

CREATE UNIQUE INDEX IF NOT EXISTS employee_salaries_active_employee_period_idx
  ON public.employee_salaries (employee_id, period)
  WHERE payment_status <> 'cancelled';

-- 2. Extend salary_payments for Append-Only Void / Reversal Audit Trail
ALTER TABLE public.salary_payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  ADD COLUMN IF NOT EXISTS voided_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS reversal_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_salary_payments_salary_status
  ON public.salary_payments (salary_id, status);

CREATE INDEX IF NOT EXISTS idx_salary_payments_reversal_tx
  ON public.salary_payments (reversal_transaction_id)
  WHERE reversal_transaction_id IS NOT NULL;

-- 3. Modernize RLS Policies for Employees, Salaries, and Salary Payments (Rule 14 & Rule 15)
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins and managers can manage employees" ON public.employees;
DROP POLICY IF EXISTS "Users can manage their business employees" ON public.employees;
CREATE POLICY "Users can manage their business employees" ON public.employees
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff
      WHERE profile_id = auth.uid()
        AND (
          role = 'admin'
          OR 'full_access' = ANY(permissions)
          OR 'manage_employees_salary' = ANY(permissions)
        )
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff
      WHERE profile_id = auth.uid()
        AND (
          role = 'admin'
          OR 'full_access' = ANY(permissions)
          OR 'manage_employees_salary' = ANY(permissions)
        )
    )
  );

ALTER TABLE public.employee_salaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins and managers can manage salaries" ON public.employee_salaries;
DROP POLICY IF EXISTS "Users can manage their business employee_salaries" ON public.employee_salaries;
CREATE POLICY "Users can manage their business employee_salaries" ON public.employee_salaries
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff
      WHERE profile_id = auth.uid()
        AND (
          role = 'admin'
          OR 'full_access' = ANY(permissions)
          OR 'manage_employees_salary' = ANY(permissions)
        )
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff
      WHERE profile_id = auth.uid()
        AND (
          role = 'admin'
          OR 'full_access' = ANY(permissions)
          OR 'manage_employees_salary' = ANY(permissions)
        )
    )
  );

ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins and managers can manage salary_payments" ON public.salary_payments;
DROP POLICY IF EXISTS "Users can manage their business salary_payments" ON public.salary_payments;
CREATE POLICY "Users can manage their business salary_payments" ON public.salary_payments
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff
      WHERE profile_id = auth.uid()
        AND (
          role = 'admin'
          OR 'full_access' = ANY(permissions)
          OR 'manage_employees_salary' = ANY(permissions)
        )
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff
      WHERE profile_id = auth.uid()
        AND (
          role = 'admin'
          OR 'full_access' = ANY(permissions)
          OR 'manage_employees_salary' = ANY(permissions)
        )
    )
  );

-- 4. Rebuild v_all_payments Unified View to exclude voided salary payments
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

-- Branch 4: Outbound Payments (Payroll - Active Only)
SELECT
    sp.id, sp.business_id, sp.date,
    'outbound'::text, 'Payroll'::text, 'salary'::text,
    sp.salary_id, ('GAJI-' || COALESCE(es.period, ''))::text,
    COALESCE(emp.name, 'Karyawan')::text, 'bank_transfer'::text,
    sp.amount::numeric, sp.payment_method_account_id, sp.transaction_id,
    NULL::uuid, 0::numeric, 0::numeric, NULL::text, sp.notes::text, sp.created_at
FROM public.salary_payments sp
JOIN public.employee_salaries es ON sp.salary_id = es.id
LEFT JOIN public.employees emp ON es.employee_id = emp.id
WHERE COALESCE(sp.status, 'active') = 'active'
  AND es.payment_status <> 'cancelled';

GRANT SELECT ON public.v_all_payments TO authenticated, service_role;

-- 5. Update get_ledger_balances RPC to exclude voided salary_payments in Cash Basis
CREATE OR REPLACE FUNCTION public.get_ledger_balances(
    p_business_id uuid,
    p_start_date timestamptz DEFAULT NULL,
    p_end_date timestamptz DEFAULT NULL,
    p_basis text DEFAULT 'accrual'
)
RETURNS TABLE (
    account_id uuid,
    debit_sum numeric,
    credit_sum numeric
) AS $$
DECLARE
    v_cash_account_ids uuid[];
BEGIN
    IF p_basis = 'cash' THEN
        SELECT array_agg(id) INTO v_cash_account_ids
        FROM public.accounts
        WHERE business_id = p_business_id
          AND type = 'ASSET'
          AND (
            sub_type = 'bank_cash' OR
            (sub_type IS NULL AND (
              code LIKE '101%' OR 
              code LIKE '1100%' OR
              LOWER(name) LIKE '%kas%' OR
              LOWER(name) LIKE '%bank%' OR
              LOWER(name) LIKE '%qris%'
            ))
          );

        IF v_cash_account_ids IS NULL THEN
            v_cash_account_ids := '{}';
        END IF;

        RETURN QUERY
        SELECT 
            a.id as account_id,
            COALESCE(sub.debit_sum, 0)::numeric as debit_sum,
            COALESCE(sub.credit_sum, 0)::numeric as credit_sum
        FROM public.accounts a
        LEFT JOIN (
            SELECT 
                raw_lines.account_id,
                SUM(raw_lines.debit) as debit_sum,
                SUM(raw_lines.credit) as credit_sum
            FROM (
                -- Case 1: Pure direct cash transactions
                SELECT 
                    jl.account_id,
                    jl.debit,
                    jl.credit,
                    t.date
                FROM public.journal_lines jl
                JOIN public.transactions t ON jl.transaction_id = t.id
                JOIN public.accounts a ON jl.account_id = a.id
                WHERE t.business_id = p_business_id
                  AND a.type IN ('REVENUE', 'EXPENSE')
                  AND EXISTS (
                      SELECT 1 FROM public.journal_lines jl2
                      WHERE jl2.transaction_id = t.id 
                        AND jl2.account_id = ANY(v_cash_account_ids)
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM public.journal_lines jl3
                      JOIN public.accounts a3 ON jl3.account_id = a3.id
                      WHERE jl3.transaction_id = t.id 
                        AND (
                          a3.sub_type IN ('receivable', 'payable', 'current_liabilities', 'salary_payable')
                          OR (a3.sub_type IS NULL AND (
                            a3.code IN ('103000', '201000', '201100') OR 
                            LOWER(a3.name) LIKE '%piutang%' OR 
                            LOWER(a3.name) LIKE '%hutang%' OR 
                            LOWER(a3.name) LIKE '%utang%'
                          ))
                        )
                  )
                  AND NOT EXISTS (SELECT 1 FROM public.expense_payments ep WHERE ep.transaction_id = t.id)
                  AND NOT EXISTS (SELECT 1 FROM public.purchase_payments pp WHERE pp.transaction_id = t.id)
                  AND NOT EXISTS (SELECT 1 FROM public.salary_payments sp WHERE sp.transaction_id = t.id OR sp.reversal_transaction_id = t.id)

                UNION ALL

                -- Case 2: Payments on Invoices (AR)
                SELECT 
                    jl_sales.account_id,
                    (CASE WHEN jl_pay.debit > 0 THEN -jl_sales.debit ELSE jl_sales.debit END * (ABS(jl_pay.debit - jl_pay.credit) / COALESCE(NULLIF((SELECT SUM(ABS(jl_inner.debit - jl_inner.credit)) FROM public.journal_lines jl_inner WHERE jl_inner.transaction_id = t_sales.id AND jl_inner.account_id = a_pay.id), 0), 1)))::numeric as debit,
                    (CASE WHEN jl_pay.debit > 0 THEN -jl_sales.credit ELSE jl_sales.credit END * (ABS(jl_pay.debit - jl_pay.credit) / COALESCE(NULLIF((SELECT SUM(ABS(jl_inner.debit - jl_inner.credit)) FROM public.journal_lines jl_inner WHERE jl_inner.transaction_id = t_sales.id AND jl_inner.account_id = a_pay.id), 0), 1)))::numeric as credit,
                    t_pay.date
                FROM public.transactions t_pay
                JOIN public.journal_lines jl_pay ON jl_pay.transaction_id = t_pay.id
                JOIN public.accounts a_pay ON jl_pay.account_id = a_pay.id
                JOIN public.transactions t_sales ON t_sales.order_id = t_pay.order_id AND t_sales.id <> t_pay.id
                JOIN public.journal_lines jl_sales ON jl_sales.transaction_id = t_sales.id
                JOIN public.accounts a_sales ON jl_sales.account_id = a_sales.id
                WHERE t_pay.business_id = p_business_id
                  AND (
                    a_pay.sub_type = 'receivable' 
                    OR (a_pay.sub_type IS NULL AND (a_pay.code = '103000' OR LOWER(a_pay.name) LIKE '%piutang%'))
                  )
                  AND a_sales.type IN ('REVENUE', 'EXPENSE')
                  AND t_sales.description NOT LIKE '%Pembayaran%'
                  AND t_sales.description NOT LIKE '%Pelunasan%'
                  AND (
                      (
                          t_pay.description NOT LIKE '%Pembatalan%' AND t_pay.description NOT LIKE '%Retur%' AND t_pay.description NOT LIKE '%Refund%' AND t_pay.description NOT LIKE '%Reversal%'
                          AND t_sales.description NOT LIKE '%Pembatalan%' AND t_sales.description NOT LIKE '%Retur%' AND t_sales.description NOT LIKE '%Refund%' AND t_sales.description NOT LIKE '%Reversal%'
                      )
                      OR
                      (
                          (t_pay.description LIKE '%Pembatalan%' OR t_pay.description LIKE '%Retur%' OR t_pay.description LIKE '%Refund%' OR t_pay.description LIKE '%Reversal%')
                          AND (t_sales.description LIKE '%Pembatalan%' OR t_sales.description LIKE '%Retur%' OR t_sales.description LIKE '%Refund%' OR t_sales.description LIKE '%Reversal%')
                      )
                  )

                UNION ALL

                -- Case 3: Payments on Expenses (AP)
                SELECT 
                    e.category_account_id as account_id,
                    ep.amount as debit,
                    0 as credit,
                    t_pay.date
                FROM public.expense_payments ep
                JOIN public.transactions t_pay ON ep.transaction_id = t_pay.id
                JOIN public.expenses e ON ep.expense_id = e.id
                WHERE t_pay.business_id = p_business_id

                UNION ALL

                -- Case 4: Payments on Purchases (AP)
                SELECT 
                    jl_orig.account_id,
                    (jl_orig.debit * (pp.amount / COALESCE(NULLIF(p.grand_total, 0), 1))) as debit,
                    (jl_orig.credit * (pp.amount / COALESCE(NULLIF(p.grand_total, 0), 1))) as credit,
                    t_pay.date
                FROM public.purchase_payments pp
                JOIN public.transactions t_pay ON pp.transaction_id = t_pay.id
                JOIN public.purchases p ON pp.purchase_id = p.id
                JOIN public.transactions t_orig ON p.transaction_id = t_orig.id
                JOIN public.journal_lines jl_orig ON jl_orig.transaction_id = t_orig.id
                JOIN public.accounts a_orig ON jl_orig.account_id = a_orig.id
                WHERE t_pay.business_id = p_business_id
                  AND a_orig.type IN ('REVENUE', 'EXPENSE')

                UNION ALL

                -- Case 5: Active Payments on Salaries (AP)
                SELECT 
                    COALESCE(
                        jl_orig.account_id, 
                        (SELECT id FROM public.accounts WHERE business_id = t_pay.business_id AND (code = '503300' OR code = '503100' OR LOWER(name) LIKE '%gaji%') LIMIT 1)
                    ) as account_id,
                    sp.amount as debit,
                    0 as credit,
                    t_pay.date
                FROM public.salary_payments sp
                JOIN public.transactions t_pay ON sp.transaction_id = t_pay.id
                JOIN public.employee_salaries s ON sp.salary_id = s.id
                LEFT JOIN public.journal_lines jl_orig ON jl_orig.transaction_id = s.transaction_id AND jl_orig.debit > 0
                WHERE t_pay.business_id = p_business_id
                  AND COALESCE(sp.status, 'active') = 'active'
                  AND s.payment_status <> 'cancelled'
            ) raw_lines
            WHERE (p_start_date IS NULL OR raw_lines.date >= p_start_date)
              AND (p_end_date IS NULL OR raw_lines.date <= p_end_date)
            GROUP BY raw_lines.account_id
        ) sub ON sub.account_id = a.id
        WHERE a.business_id = p_business_id;
    ELSE
        -- Accrual Basis
        RETURN QUERY
        SELECT 
            a.id as account_id,
            COALESCE(sub.debit_sum, 0)::numeric as debit_sum,
            COALESCE(sub.credit_sum, 0)::numeric as credit_sum
        FROM public.accounts a
        LEFT JOIN (
            SELECT 
                jl.account_id,
                SUM(jl.debit) as debit_sum,
                SUM(jl.credit) as credit_sum
            FROM public.journal_lines jl
            JOIN public.transactions t ON jl.transaction_id = t.id
            WHERE t.business_id = p_business_id
              AND (p_start_date IS NULL OR t.date >= p_start_date)
              AND (p_end_date IS NULL OR t.date <= p_end_date)
            GROUP BY jl.account_id
        ) sub ON sub.account_id = a.id
        WHERE a.business_id = p_business_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

