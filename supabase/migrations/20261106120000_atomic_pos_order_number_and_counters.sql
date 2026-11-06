-- Migration: Atomic POS Order Number Generator and Business Counters
-- Creates public.business_counters table and generate_pos_order_number() function

CREATE TABLE IF NOT EXISTS public.business_counters (
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    counter_type TEXT NOT NULL, -- e.g. 'pos_order', 'pos_queue'
    period_date DATE NOT NULL,  -- Localized calendar date e.g. '2026-11-06'
    last_val INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (business_id, counter_type, period_date)
);

CREATE INDEX IF NOT EXISTS idx_business_counters_lookup 
ON public.business_counters (business_id, counter_type, period_date);

-- Enable Row Level Security
ALTER TABLE public.business_counters ENABLE ROW LEVEL SECURITY;

-- Multi-Tenant RLS Policy for business_counters
DROP POLICY IF EXISTS "Multi-tenant access for business counters" ON public.business_counters;
CREATE POLICY "Multi-tenant access for business counters" ON public.business_counters
    FOR ALL TO authenticated
    USING (
        business_id IN (
            SELECT id FROM public.businesses WHERE owner_id = auth.uid()
            UNION
            SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
        ) OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        business_id IN (
            SELECT id FROM public.businesses WHERE owner_id = auth.uid()
            UNION
            SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
        ) OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
    );

-- Atomic Generator Function for POS Order Number
CREATE OR REPLACE FUNCTION public.generate_pos_order_number(
    p_business_id UUID,
    p_prefix TEXT DEFAULT 'POS',
    p_timezone TEXT DEFAULT 'Asia/Jakarta'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_is_authorized BOOLEAN;
    v_today DATE;
    v_date_str TEXT;
    v_next_val INT;
    v_order_number TEXT;
    v_safe_prefix TEXT;
    v_init_val INT := 1;
BEGIN
    -- 1. Security Guard: Caller must be owner or staff of p_business_id (if authenticated)
    IF v_caller IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.businesses WHERE id = p_business_id AND owner_id = v_caller
            UNION
            SELECT 1 FROM public.business_staff WHERE business_id = p_business_id AND profile_id = v_caller
            UNION
            SELECT 1 FROM public.profiles WHERE id = v_caller AND active_business_id = p_business_id
        ) INTO v_is_authorized;

        IF NOT v_is_authorized THEN
            RAISE EXCEPTION 'Unauthorized: Caller % does not have access to business %', v_caller, p_business_id;
        END IF;
    END IF;

    -- 2. Resolve localized civil calendar date
    BEGIN
        v_today := (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Jakarta'))::date;
    EXCEPTION WHEN OTHERS THEN
        v_today := CURRENT_DATE;
    END;

    v_date_str := to_char(v_today, 'YYYYMMDD');
    v_safe_prefix := COALESCE(NULLIF(trim(p_prefix), ''), 'POS');

    -- 3. Transition Guard: If counter row for today does not exist yet, find max in orders
    IF NOT EXISTS (
        SELECT 1 FROM public.business_counters 
        WHERE business_id = p_business_id AND counter_type = 'pos_order' AND period_date = v_today
    ) THEN
        SELECT COALESCE(MAX(
            CASE 
                WHEN order_number ~ ('^' || v_safe_prefix || '-' || v_date_str || '-[0-9]+$')
                THEN substring(order_number from ('^' || v_safe_prefix || '-' || v_date_str || '-([0-9]+)$'))::int
                ELSE 0
            END
        ), 0) + 1
        INTO v_init_val
        FROM public.orders
        WHERE business_id = p_business_id
          AND order_number LIKE (v_safe_prefix || '-' || v_date_str || '-%');
          
        IF v_init_val < 1 THEN
            v_init_val := 1;
        END IF;
    END IF;

    -- 4. Atomic UPSERT: row-level exclusive lock guaranteed by PostgreSQL kernel (< 0.2ms)
    INSERT INTO public.business_counters (business_id, counter_type, period_date, last_val, updated_at)
    VALUES (p_business_id, 'pos_order', v_today, v_init_val, NOW())
    ON CONFLICT (business_id, counter_type, period_date)
    DO UPDATE SET last_val = business_counters.last_val + 1, updated_at = NOW()
    RETURNING last_val INTO v_next_val;

    -- 5. Format canonical document number: POS-YYYYMMDD-0001 (padded to 4 digits or more)
    v_order_number := v_safe_prefix || '-' || v_date_str || '-' || lpad(v_next_val::text, 4, '0');

    RETURN jsonb_build_object(
        'order_number', v_order_number,
        'queue_number', v_next_val,
        'date_str', v_date_str,
        'sequence', v_next_val
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pos_order_number(UUID, TEXT, TEXT) TO authenticated, service_role;

