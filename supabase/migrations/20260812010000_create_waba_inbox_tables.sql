-- Migration: Create WABA conversations and messages tables for WhatsApp Business API Inbox
CREATE TABLE IF NOT EXISTS waba_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    wa_id TEXT NOT NULL, -- E.164 phone number without plus sign (e.g. '628123456789')
    contact_name TEXT,
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unread_count INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open', -- 'open', 'closed', 'archived'
    assigned_staff_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT waba_conversations_biz_wa_unique UNIQUE (business_id, wa_id)
);

CREATE TABLE IF NOT EXISTS waba_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES waba_conversations(id) ON DELETE CASCADE,
    wamid TEXT, -- Meta Message ID e.g. wamid.HBgL...
    direction TEXT NOT NULL, -- 'incoming' | 'outgoing'
    sender_phone TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text', -- 'text', 'image', 'document', 'location', 'template'
    text_body TEXT,
    media_url TEXT,
    status TEXT NOT NULL DEFAULT 'sent', -- 'received', 'sent', 'delivered', 'read', 'failed'
    error_message TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_waba_conversations_biz_last_msg ON waba_conversations(business_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_waba_messages_conv_created ON waba_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_waba_messages_biz_wamid ON waba_messages(business_id, wamid);

-- Enable RLS
ALTER TABLE waba_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE waba_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view waba_conversations for their businesses" ON waba_conversations;
DROP POLICY IF EXISTS "Users can manage waba_conversations for their businesses" ON waba_conversations;

CREATE POLICY "Users can view waba_conversations for their businesses"
ON waba_conversations FOR SELECT
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
    UNION
    SELECT business_id FROM business_staff WHERE profile_id = auth.uid()
  )
);

CREATE POLICY "Users can manage waba_conversations for their businesses"
ON waba_conversations FOR ALL
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
    UNION
    SELECT business_id FROM business_staff WHERE profile_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can view waba_messages for their businesses" ON waba_messages;
DROP POLICY IF EXISTS "Users can manage waba_messages for their businesses" ON waba_messages;

CREATE POLICY "Users can view waba_messages for their businesses"
ON waba_messages FOR SELECT
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
    UNION
    SELECT business_id FROM business_staff WHERE profile_id = auth.uid()
  )
);

CREATE POLICY "Users can manage waba_messages for their businesses"
ON waba_messages FOR ALL
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
    UNION
    SELECT business_id FROM business_staff WHERE profile_id = auth.uid()
  )
);
