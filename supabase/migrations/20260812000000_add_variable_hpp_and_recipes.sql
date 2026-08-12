-- 1. Tambah kolom unit & hpp_type pada tabel products jika belum ada
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pcs';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hpp_type text NOT NULL DEFAULT 'fixed';

-- Tambahkan constraint check untuk hpp_type jika belum ada
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_hpp_type_check'
    ) THEN
        ALTER TABLE public.products ADD CONSTRAINT products_hpp_type_check CHECK (hpp_type IN ('fixed', 'variable'));
    END IF;
END $$;

-- 2. Ubah tipe data stock_quantity agar mendukung angka desimal (gram, yard, ml, dll)
ALTER TABLE public.products ALTER COLUMN stock_quantity TYPE numeric(15,4) USING stock_quantity::numeric(15,4);

-- 3. Membuat tabel product_recipes (BOM / Resep Bahan Baku)
CREATE TABLE IF NOT EXISTS public.product_recipes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    ingredient_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity numeric(15,4) NOT NULL CHECK (quantity > 0),
    unit text NOT NULL DEFAULT 'pcs',
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT product_recipes_pkey PRIMARY KEY (id),
    CONSTRAINT product_recipes_unique_ingredient UNIQUE (product_id, ingredient_product_id)
);

-- Index untuk performa join resep saat checkout / sync order
CREATE INDEX IF NOT EXISTS idx_product_recipes_product_id ON public.product_recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_product_recipes_business_id ON public.product_recipes(business_id);
CREATE INDEX IF NOT EXISTS idx_product_recipes_ingredient ON public.product_recipes(ingredient_product_id);

-- Aktifkan Row Level Security (RLS) pada tabel product_recipes
ALTER TABLE public.product_recipes ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS untuk product_recipes
DROP POLICY IF EXISTS "Users can manage their own business product_recipes" ON public.product_recipes;
CREATE POLICY "Users can manage their own business product_recipes" ON public.product_recipes
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- Reload schema PostgREST
NOTIFY pgrst, 'reload schema';
