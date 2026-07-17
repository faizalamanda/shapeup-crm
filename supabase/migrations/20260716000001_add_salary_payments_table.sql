-- 1. Add columns to employee_salaries table
ALTER TABLE public.employee_salaries ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
ALTER TABLE public.employee_salaries ADD COLUMN IF NOT EXISTS outstanding_amount numeric NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0);

-- 2. Update existing rows based on payment_status
UPDATE public.employee_salaries
SET amount_paid = amount,
    outstanding_amount = 0
WHERE payment_status = 'paid';

UPDATE public.employee_salaries
SET amount_paid = 0,
    outstanding_amount = amount
WHERE payment_status = 'pending' OR payment_status = 'cancelled';

-- 3. Create salary_payments table
CREATE TABLE IF NOT EXISTS public.salary_payments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    salary_id uuid NOT NULL REFERENCES public.employee_salaries(id) ON DELETE CASCADE,
    transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    date date NOT NULL DEFAULT current_date,
    amount numeric NOT NULL CHECK (amount > 0),
    payment_method_account_id uuid NOT NULL REFERENCES public.accounts(id),
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT salary_payments_pkey PRIMARY KEY (id)
);

-- 4. Enable RLS on salary_payments
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;

-- 5. Create security policy for salary_payments (consistent with salaries)
DROP POLICY IF EXISTS "Admins and managers can manage salary_payments" ON public.salary_payments;
CREATE POLICY "Admins and managers can manage salary_payments" ON public.salary_payments
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_staff bs
            WHERE bs.profile_id = auth.uid()
              AND bs.business_id = salary_payments.business_id
              AND (bs.role = 'admin' OR 'full_access' = ANY(bs.permissions) OR 'manage_employees_salary' = ANY(bs.permissions))
        )
    );
