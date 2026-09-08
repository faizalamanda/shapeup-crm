-- ========================================================
-- MIGRATION: 20260908000000_create_pipeline_tables.sql
-- PIPELINE PLUGIN DATABASE TABLES
-- ========================================================

-- 1. Pipelines Table
CREATE TABLE IF NOT EXISTS public.pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    icon VARCHAR(50) DEFAULT 'kanban',
    type VARCHAR(50) NOT NULL DEFAULT 'sales', -- sales, productivity, production, hiring, custom
    currency VARCHAR(10) DEFAULT 'IDR',
    visibility VARCHAR(20) NOT NULL DEFAULT 'everyone', -- everyone, members_only
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipelines_business_id ON public.pipelines(business_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_visibility ON public.pipelines(visibility);

-- 2. Pipeline Members Table
CREATE TABLE IF NOT EXISTS public.pipeline_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'editor', -- owner, editor, viewer
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_pipeline_user UNIQUE (pipeline_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_members_pipeline_id ON public.pipeline_members(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_members_user_id ON public.pipeline_members(user_id);

-- 3. Pipeline Stages Table
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#3B82F6',
    display_order INT NOT NULL DEFAULT 0,
    wip_limit INT DEFAULT NULL,
    is_won_stage BOOLEAN NOT NULL DEFAULT FALSE,
    is_lost_stage BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline_id ON public.pipeline_stages(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_order ON public.pipeline_stages(pipeline_id, display_order);

-- 4. Pipeline Cards Table
CREATE TABLE IF NOT EXISTS public.pipeline_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    value NUMERIC(15, 2) DEFAULT 0,
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
    assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    due_date TIMESTAMPTZ DEFAULT NULL,
    labels JSONB DEFAULT '[]'::jsonb,
    custom_fields JSONB DEFAULT '{}'::jsonb,
    display_order INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, won, lost, archived
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_cards_pipeline_id ON public.pipeline_cards(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_cards_stage_id ON public.pipeline_cards(stage_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_cards_assignee_id ON public.pipeline_cards(assignee_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_cards_status ON public.pipeline_cards(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_cards_order ON public.pipeline_cards(stage_id, display_order);

-- 5. Pipeline Activities Table
CREATE TABLE IF NOT EXISTS public.pipeline_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES public.pipeline_cards(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    activity_type VARCHAR(50) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_activities_card_id ON public.pipeline_activities(card_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_activities_created_at ON public.pipeline_activities(created_at DESC);

-- Enable RLS
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_activities ENABLE ROW LEVEL SECURITY;

-- Grant permissions to authenticated users & service_role
GRANT ALL ON public.pipelines TO authenticated, anon, service_role;
GRANT ALL ON public.pipeline_members TO authenticated, anon, service_role;
GRANT ALL ON public.pipeline_stages TO authenticated, anon, service_role;
GRANT ALL ON public.pipeline_cards TO authenticated, anon, service_role;
GRANT ALL ON public.pipeline_activities TO authenticated, anon, service_role;

-- Multi-tenant isolation RLS policies with DROP IF EXISTS (business_staff uses profile_id column)
DROP POLICY IF EXISTS pipelines_business_isolation ON public.pipelines;
CREATE POLICY pipelines_business_isolation ON public.pipelines
    FOR ALL USING (
        business_id IN (
            SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
        )
    )
    WITH CHECK (
        business_id IN (
            SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS pipeline_members_isolation ON public.pipeline_members;
CREATE POLICY pipeline_members_isolation ON public.pipeline_members
    FOR ALL USING (
        pipeline_id IN (
            SELECT id FROM public.pipelines WHERE business_id IN (
                SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        pipeline_id IN (
            SELECT id FROM public.pipelines WHERE business_id IN (
                SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS pipeline_stages_isolation ON public.pipeline_stages;
CREATE POLICY pipeline_stages_isolation ON public.pipeline_stages
    FOR ALL USING (
        pipeline_id IN (
            SELECT id FROM public.pipelines WHERE business_id IN (
                SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        pipeline_id IN (
            SELECT id FROM public.pipelines WHERE business_id IN (
                SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS pipeline_cards_isolation ON public.pipeline_cards;
CREATE POLICY pipeline_cards_isolation ON public.pipeline_cards
    FOR ALL USING (
        pipeline_id IN (
            SELECT id FROM public.pipelines WHERE business_id IN (
                SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        pipeline_id IN (
            SELECT id FROM public.pipelines WHERE business_id IN (
                SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS pipeline_activities_isolation ON public.pipeline_activities;
CREATE POLICY pipeline_activities_isolation ON public.pipeline_activities
    FOR ALL USING (
        card_id IN (
            SELECT id FROM public.pipeline_cards WHERE pipeline_id IN (
                SELECT id FROM public.pipelines WHERE business_id IN (
                    SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
                )
            )
        )
    )
    WITH CHECK (
        card_id IN (
            SELECT id FROM public.pipeline_cards WHERE pipeline_id IN (
                SELECT id FROM public.pipelines WHERE business_id IN (
                    SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
                )
            )
        )
    );
