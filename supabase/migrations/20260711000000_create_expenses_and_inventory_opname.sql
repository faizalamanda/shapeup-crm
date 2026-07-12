-- 1. Tabel Suppliers/Pemasok
CREATE TABLE IF NOT EXISTS public.suppliers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL, -- Hubungan jika Customer merangkap Supplier
    name text NOT NULL,
    email text,
    phone text,
    address text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT suppliers_pkey PRIMARY KEY (id),
    CONSTRAINT suppliers_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT suppliers_business_id_name_key UNIQUE (business_id, name)
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own business suppliers" ON public.suppliers
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 2. Tabel Expenses/Pengeluaran Umum
CREATE TABLE IF NOT EXISTS public.expenses (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE,
    category_account_id uuid NOT NULL REFERENCES public.accounts(id), -- Bisa bertipe EXPENSE (OPEX) atau ASSET (CAPEX)
    payment_account_id uuid NOT NULL REFERENCES public.accounts(id),  -- Kas/Bank
    amount numeric NOT NULL CHECK (amount >= 0),
    date date NOT NULL DEFAULT current_date,
    description text,
    vendor_name text,
    attachment_url text, -- File bukti bayar
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT expenses_pkey PRIMARY KEY (id),
    CONSTRAINT expenses_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own business expenses" ON public.expenses
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 3. Tabel Purchases/Pembelian
CREATE TABLE IF NOT EXISTS public.purchases (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE, -- Transaksi awal (Pembelian barang & pengakuan hutang)
    supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
    purchase_number text NOT NULL,
    date date NOT NULL DEFAULT current_date,
    due_date date,
    subtotal numeric NOT NULL CHECK (subtotal >= 0),
    discount_amount numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    other_fees numeric NOT NULL DEFAULT 0,
    grand_total numeric NOT NULL CHECK (grand_total >= 0),
    amount_paid numeric NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
    items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    attachment_url text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT purchases_pkey PRIMARY KEY (id),
    CONSTRAINT purchases_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT purchases_business_id_purchase_number_key UNIQUE (business_id, purchase_number)
);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own business purchases" ON public.purchases
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 4. Tabel Purchase Payments / Log Riwayat Pembayaran Pembelian (DP, Cicilan, Pelunasan)
CREATE TABLE IF NOT EXISTS public.purchase_payments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE, -- Jurnal pembayaran hutang ke kas/bank
    date date NOT NULL DEFAULT current_date,
    amount numeric NOT NULL CHECK (amount > 0), -- Jumlah nominal yang dibayarkan ke kas/bank
    payment_method_account_id uuid NOT NULL REFERENCES public.accounts(id), -- Akun Kas/Bank pengirim
    write_off_amount numeric NOT NULL DEFAULT 0, -- Selisih pembulatan/write-off (bisa positif/negatif)
    write_off_account_id uuid REFERENCES public.accounts(id), -- Akun write-off jika ada selisih
    attachment_url text,
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT purchase_payments_pkey PRIMARY KEY (id),
    CONSTRAINT purchase_payments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

ALTER TABLE public.purchase_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own business purchase_payments" ON public.purchase_payments
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 5. Tabel Stock Opname
CREATE TABLE IF NOT EXISTS public.stock_opname (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    opname_number text NOT NULL,
    date date NOT NULL DEFAULT current_date,
    notes text,
    items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT stock_opname_pkey PRIMARY KEY (id),
    CONSTRAINT stock_opname_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT stock_opname_business_id_opname_number_key UNIQUE (business_id, opname_number)
);

ALTER TABLE public.stock_opname ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own business stock_opname" ON public.stock_opname
    FOR ALL TO authenticated
    USING (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()))
    WITH CHECK (business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid()));

-- 6. Setup Storage Bucket 'attachments' untuk Struk Bukti Bayar
INSERT INTO storage.buckets (id, name, public) 
VALUES ('attachments', 'attachments', true) 
ON CONFLICT (id) DO NOTHING;

-- Kebijakan Storage RLS (memungkinkan user login mengunggah, membaca, dan menghapus file)
CREATE POLICY "Allow authenticated upload attachments" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'attachments');
CREATE POLICY "Allow authenticated select attachments" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'attachments');
CREATE POLICY "Allow authenticated delete attachments" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'attachments');
