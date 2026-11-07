-- Migration: 20261107100000_create_pos_production_stations.sql
-- Description: Database-driven Custom Production Stations for POS (Dapur, Barista, Grill, Packing, dsb.) & POS Mode (Retail vs F&B)

-- 1. Create table pos_production_stations
CREATE TABLE IF NOT EXISTS public.pos_production_stations (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    icon TEXT NOT NULL DEFAULT '🍳',
    printer_device_id UUID,
    paper_size TEXT NOT NULL DEFAULT '58mm',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT pos_production_stations_pkey PRIMARY KEY (id),
    CONSTRAINT pos_production_stations_business_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
    CONSTRAINT pos_production_stations_printer_fkey FOREIGN KEY (printer_device_id) REFERENCES public.pos_printer_devices(id) ON DELETE SET NULL,
    CONSTRAINT pos_production_stations_paper_check CHECK (paper_size IN ('58mm', '80mm'))
);

-- Index for performant querying by business and sort order
CREATE INDEX IF NOT EXISTS idx_pos_production_stations_biz 
ON public.pos_production_stations(business_id, sort_order);

-- Enable RLS on pos_production_stations
ALTER TABLE public.pos_production_stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage production stations for their business" ON public.pos_production_stations;
CREATE POLICY "Users can manage production stations for their business" 
ON public.pos_production_stations
    FOR ALL
    TO authenticated
    USING (
        business_id IN (
            SELECT id FROM public.businesses WHERE owner_id = auth.uid()
            UNION
            SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
        )
        OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        business_id IN (
            SELECT id FROM public.businesses WHERE owner_id = auth.uid()
            UNION
            SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
        )
        OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    );


-- 2. Add production_station_id to categories (Relational 3NF Routing)
ALTER TABLE public.categories 
ADD COLUMN IF NOT EXISTS production_station_id UUID DEFAULT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'categories_production_station_fkey'
    ) THEN
        ALTER TABLE public.categories
        ADD CONSTRAINT categories_production_station_fkey 
        FOREIGN KEY (production_station_id) 
        REFERENCES public.pos_production_stations(id) 
        ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_categories_station 
ON public.categories(production_station_id);


-- 3. Add pos_mode to businesses table ('retail', 'fnb', 'custom')
ALTER TABLE public.businesses
ADD COLUMN IF NOT EXISTS pos_mode TEXT NOT NULL DEFAULT 'retail';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'businesses_pos_mode_check'
    ) THEN
        ALTER TABLE public.businesses
        ADD CONSTRAINT businesses_pos_mode_check 
        CHECK (pos_mode IN ('retail', 'fnb', 'custom'));
    END IF;
END $$;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

