-- 1. Membuat tabel kategori (categories)
CREATE TABLE IF NOT EXISTS public.categories (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT categories_pkey PRIMARY KEY (id),
    CONSTRAINT categories_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT categories_business_id_name_key UNIQUE (business_id, name)
);

-- Mengaktifkan RLS pada tabel categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS untuk categories
DROP POLICY IF EXISTS "Users can manage their own business categories" ON public.categories;
CREATE POLICY "Users can manage their own business categories" ON public.categories
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 2. Membuat tabel produk (products)
CREATE TABLE IF NOT EXISTS public.products (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    name text NOT NULL,
    sku text,
    description text,
    price numeric NOT NULL DEFAULT 0,
    cost_price numeric NOT NULL DEFAULT 0, -- HPP / Harga Modal Beli
    type text NOT NULL, -- 'physical' atau 'service'
    category_id uuid,
    stock_type text NOT NULL, -- 'tracked', 'available', 'unavailable'
    stock_quantity integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT products_pkey PRIMARY KEY (id),
    CONSTRAINT products_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL,
    CONSTRAINT products_type_check CHECK (type IN ('physical', 'service')),
    CONSTRAINT products_stock_type_check CHECK (stock_type IN ('tracked', 'available', 'unavailable'))
);

-- Menambahkan kolom cost_price jika tabel products sudah ada sebelumnya tanpa kolom tersebut
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0;

-- Mengaktifkan RLS pada tabel products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS untuk products
DROP POLICY IF EXISTS "Users can manage their own business products" ON public.products;
CREATE POLICY "Users can manage their own business products" ON public.products
    FOR ALL
    TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- Reload schema cache PostgREST agar kolom baru langsung dikenali oleh API client
NOTIFY pgrst, 'reload schema';
