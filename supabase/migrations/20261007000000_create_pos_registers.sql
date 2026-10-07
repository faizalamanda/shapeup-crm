-- Create POS Registers table
CREATE TABLE IF NOT EXISTS public.pos_registers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
    name varchar NOT NULL,
    account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
    status varchar DEFAULT 'active',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pos_registers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage their own business pos registers" ON public.pos_registers
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- Add register_id to pos_shifts
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS register_id uuid REFERENCES public.pos_registers(id) ON DELETE SET NULL;
