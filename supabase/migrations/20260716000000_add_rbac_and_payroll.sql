-- 1. Alter business_staff to add permissions column
ALTER TABLE public.business_staff 
ADD COLUMN IF NOT EXISTS permissions text[] DEFAULT '{}';

-- 2. Create employees table
CREATE TABLE IF NOT EXISTS public.employees (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name text NOT NULL,
    position text,
    email text,
    phone text,
    status text NOT NULL DEFAULT 'active',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT employees_pkey PRIMARY KEY (id)
);

-- 3. Create employee_salaries table
CREATE TABLE IF NOT EXISTS public.employee_salaries (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    amount numeric NOT NULL DEFAULT 0,
    period text NOT NULL, -- e.g., '2026-07'
    payment_status text NOT NULL DEFAULT 'pending', -- 'paid' or 'pending'
    payment_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    paid_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT employee_salaries_pkey PRIMARY KEY (id),
    CONSTRAINT employee_salaries_employee_period_key UNIQUE (employee_id, period)
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_salaries ENABLE ROW LEVEL SECURITY;

-- 5. Policies for employees
DROP POLICY IF EXISTS "Admins and managers can manage employees" ON public.employees;
CREATE POLICY "Admins and managers can manage employees" ON public.employees
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_staff bs
            WHERE bs.profile_id = auth.uid()
              AND bs.business_id = employees.business_id
              AND (
                  bs.role = 'admin' OR 
                  'full_access' = ANY(bs.permissions) OR 
                  'manage_employees_salary' = ANY(bs.permissions)
              )
        )
    );

-- 6. Policies for employee_salaries
DROP POLICY IF EXISTS "Admins and managers can manage salaries" ON public.employee_salaries;
CREATE POLICY "Admins and managers can manage salaries" ON public.employee_salaries
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.business_staff bs
            WHERE bs.profile_id = auth.uid()
              AND bs.business_id = employee_salaries.business_id
              AND (
                  bs.role = 'admin' OR 
                  'full_access' = ANY(bs.permissions) OR 
                  'manage_employees_salary' = ANY(bs.permissions)
              )
        )
    );

-- Reload PostgREST cache
NOTIFY pgrst, 'reload schema';
