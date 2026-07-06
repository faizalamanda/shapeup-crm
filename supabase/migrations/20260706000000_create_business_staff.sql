-- 1. Membuat tabel business_staff (junction table many-to-many)
CREATE TABLE IF NOT EXISTS public.business_staff (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'staff',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT business_staff_pkey PRIMARY KEY (id),
    CONSTRAINT business_staff_business_id_profile_id_key UNIQUE (business_id, profile_id)
);

-- 2. Mengaktifkan RLS pada tabel business_staff
ALTER TABLE public.business_staff ENABLE ROW LEVEL SECURITY;

-- 3. Kebijakan RLS untuk business_staff
DROP POLICY IF EXISTS "Users can view staff assignments" ON public.business_staff;
CREATE POLICY "Users can view staff assignments" ON public.business_staff
    FOR SELECT TO authenticated
    USING (
        profile_id = auth.uid() OR
        business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    );

DROP POLICY IF EXISTS "Admins can manage staff assignments" ON public.business_staff;
CREATE POLICY "Admins can manage staff assignments" ON public.business_staff
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- 4. Memigrasikan data profil lama ke tabel business_staff
-- Hubungkan profiles.business_id saat ini
INSERT INTO public.business_staff (business_id, profile_id, role)
SELECT business_id, id, role 
FROM public.profiles 
WHERE business_id IS NOT NULL
ON CONFLICT (business_id, profile_id) DO NOTHING;

-- Hubungkan businesses.owner_id saat ini sebagai admin
INSERT INTO public.business_staff (business_id, profile_id, role)
SELECT id, owner_id, 'admin'
FROM public.businesses
WHERE owner_id IS NOT NULL
ON CONFLICT (business_id, profile_id) DO NOTHING;

-- 5. Membuat trigger untuk memastikan user hanya bisa memilih active_business_id yang ditugaskan kepada mereka
CREATE OR REPLACE FUNCTION public.check_active_business_assignment()
RETURNS TRIGGER AS $$
BEGIN
    -- Jika active_business_id di-set NULL, perbolehkan (misal saat logout atau reset)
    IF NEW.active_business_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Pastikan ada di business_staff
    IF NOT EXISTS (
        SELECT 1 FROM public.business_staff
        WHERE business_id = NEW.active_business_id AND profile_id = NEW.id
    ) THEN
        -- Fallback: pastikan jika user adalah pemilik bisnis (owner_id)
        IF NOT EXISTS (
            SELECT 1 FROM public.businesses
            WHERE id = NEW.active_business_id AND owner_id = NEW.id
        ) THEN
            RAISE EXCEPTION 'Pengguna tidak ditempatkan/ditugaskan di unit bisnis ini.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_active_business_assignment ON public.profiles;
CREATE TRIGGER trg_check_active_business_assignment
BEFORE UPDATE OF active_business_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.check_active_business_assignment();

-- Reload schema cache PostgREST
NOTIFY pgrst, 'reload schema';
