-- 1. ADD COLUMNS TO EXPENSES TABLE
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'unpaid', 'partial'));
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS outstanding_amount numeric NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0);

-- 2. UPDATE EXISTING ROWS TO BE FULLY PAID
UPDATE public.expenses 
SET amount_paid = amount, 
    outstanding_amount = 0,
    payment_status = 'paid'
WHERE amount_paid = 0 AND outstanding_amount = 0 AND payment_status = 'paid';

-- 3. CREATE EXPENSE PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS public.expense_payments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
    transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    date date NOT NULL DEFAULT current_date,
    amount numeric NOT NULL CHECK (amount > 0),
    payment_method_account_id uuid NOT NULL REFERENCES public.accounts(id),
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT expense_payments_pkey PRIMARY KEY (id),
    CONSTRAINT expense_payments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

-- 4. ENABLE RLS ON EXPENSE PAYMENTS
ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;

-- 5. RLS POLICY FOR EXPENSE PAYMENTS
DROP POLICY IF EXISTS "Users can manage their own business expense_payments" ON public.expense_payments;
CREATE POLICY "Users can manage their own business expense_payments" ON public.expense_payments
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));
