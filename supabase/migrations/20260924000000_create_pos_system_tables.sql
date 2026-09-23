-- Migration: POS System Tables (Shifts, Shift Movements, Held Orders, Printer Devices, Variants, Modifiers)

-- 1. pos_shifts
CREATE TABLE IF NOT EXISTS public.pos_shifts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    user_id uuid NOT NULL,
    cashier_name text NOT NULL,
    opened_at timestamp with time zone NOT NULL DEFAULT now(),
    closed_at timestamp with time zone,
    initial_cash numeric NOT NULL DEFAULT 0,
    expected_cash numeric NOT NULL DEFAULT 0,
    actual_cash numeric DEFAULT 0,
    difference numeric DEFAULT 0,
    note text,
    status text NOT NULL DEFAULT 'open', -- 'open', 'closed'
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pos_shifts_pkey PRIMARY KEY (id),
    CONSTRAINT pos_shifts_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT pos_shifts_status_check CHECK (status IN ('open', 'closed'))
);

ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their business pos_shifts" ON public.pos_shifts;
CREATE POLICY "Users can manage their business pos_shifts" ON public.pos_shifts
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));


-- 2. pos_shift_movements
CREATE TABLE IF NOT EXISTS public.pos_shift_movements (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    shift_id uuid NOT NULL,
    business_id uuid NOT NULL,
    type text NOT NULL, -- 'cash_in', 'cash_out'
    amount numeric NOT NULL DEFAULT 0,
    note text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pos_shift_movements_pkey PRIMARY KEY (id),
    CONSTRAINT pos_shift_movements_shift_fkey FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id) ON DELETE CASCADE,
    CONSTRAINT pos_shift_movements_business_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT pos_shift_movements_type_check CHECK (type IN ('cash_in', 'cash_out'))
);

ALTER TABLE public.pos_shift_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their business pos_shift_movements" ON public.pos_shift_movements;
CREATE POLICY "Users can manage their business pos_shift_movements" ON public.pos_shift_movements
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));


-- 3. pos_held_orders
CREATE TABLE IF NOT EXISTS public.pos_held_orders (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    user_id uuid NOT NULL,
    customer_id uuid,
    customer_name text,
    note text,
    cart_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    total_items integer NOT NULL DEFAULT 0,
    grand_total numeric NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pos_held_orders_pkey PRIMARY KEY (id),
    CONSTRAINT pos_held_orders_business_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

ALTER TABLE public.pos_held_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their business pos_held_orders" ON public.pos_held_orders;
CREATE POLICY "Users can manage their business pos_held_orders" ON public.pos_held_orders
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));


-- 4. pos_printer_devices
CREATE TABLE IF NOT EXISTS public.pos_printer_devices (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    name text NOT NULL,
    connection_type text NOT NULL, -- 'bluetooth', 'lan', 'system', 'pdf'
    address text,
    paper_size text NOT NULL DEFAULT '58mm', -- '58mm', '80mm', 'A4'
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pos_printer_devices_pkey PRIMARY KEY (id),
    CONSTRAINT pos_printer_devices_business_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT pos_printer_connection_check CHECK (connection_type IN ('bluetooth', 'lan', 'system', 'pdf')),
    CONSTRAINT pos_printer_paper_check CHECK (paper_size IN ('58mm', '80mm', 'A4'))
);

ALTER TABLE public.pos_printer_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their business pos_printer_devices" ON public.pos_printer_devices;
CREATE POLICY "Users can manage their business pos_printer_devices" ON public.pos_printer_devices
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));


-- 5. product_variants
CREATE TABLE IF NOT EXISTS public.product_variants (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    business_id uuid NOT NULL,
    name text NOT NULL, -- e.g. "Ukuran L - Merah"
    sku text,
    price numeric NOT NULL DEFAULT 0,
    cost_price numeric NOT NULL DEFAULT 0,
    stock_quantity integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT product_variants_pkey PRIMARY KEY (id),
    CONSTRAINT product_variants_product_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
    CONSTRAINT product_variants_business_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage product_variants" ON public.product_variants;
CREATE POLICY "Users can manage product_variants" ON public.product_variants
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));


-- 6. product_modifiers
CREATE TABLE IF NOT EXISTS public.product_modifiers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    business_id uuid NOT NULL,
    group_name text NOT NULL, -- e.g. "Sugar Level", "Topping"
    option_name text NOT NULL, -- e.g. "Less Sugar 50%", "Boba Extra"
    price_extra numeric NOT NULL DEFAULT 0,
    is_required boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT product_modifiers_pkey PRIMARY KEY (id),
    CONSTRAINT product_modifiers_product_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
    CONSTRAINT product_modifiers_business_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

ALTER TABLE public.product_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage product_modifiers" ON public.product_modifiers;
CREATE POLICY "Users can manage product_modifiers" ON public.product_modifiers
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

NOTIFY pgrst, 'reload schema';
