-- Migration: Create business_integrations table for plugin-architecture store integrations
CREATE TABLE IF NOT EXISTS business_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, -- e.g. 'woocommerce', 'shopify', 'tiktok', etc.
    name TEXT NOT NULL, -- e.g. 'WooCommerce Store'
    is_active BOOLEAN NOT NULL DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_integrations_biz_provider_unique UNIQUE (business_id, provider)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_business_integrations_biz_prov ON business_integrations(business_id, provider);

-- Enable RLS
ALTER TABLE business_integrations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to prevent duplication errors
DROP POLICY IF EXISTS "Users can view integrations for their accessible businesses" ON business_integrations;
DROP POLICY IF EXISTS "Admins and staff can manage integrations for their businesses" ON business_integrations;

-- RLS Policies
CREATE POLICY "Users can view integrations for their accessible businesses"
ON business_integrations FOR SELECT
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
    UNION
    SELECT business_id FROM business_staff WHERE profile_id = auth.uid()
  )
);

CREATE POLICY "Admins and staff can manage integrations for their businesses"
ON business_integrations FOR ALL
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
    UNION
    SELECT business_id FROM business_staff WHERE profile_id = auth.uid()
  )
);
