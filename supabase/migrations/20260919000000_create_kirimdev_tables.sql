-- ============================================================
-- Plugin: kirim.dev WABA Integration
-- Tables: kirimdev_conversations, kirimdev_messages
-- ============================================================

-- Conversations: one row per unique contact per business
CREATE TABLE IF NOT EXISTS kirimdev_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  wa_id TEXT NOT NULL,                          -- E.164 number without +, e.g. 62812XXXXXXX
  contact_name TEXT NOT NULL DEFAULT '',
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  unread_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'pending')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, wa_id)
);

CREATE INDEX IF NOT EXISTS idx_kirimdev_conversations_business
  ON kirimdev_conversations(business_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_kirimdev_conversations_wa_id
  ON kirimdev_conversations(business_id, wa_id);

-- Messages: individual messages in a conversation thread
CREATE TABLE IF NOT EXISTS kirimdev_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  conversation_id UUID NOT NULL
    REFERENCES kirimdev_conversations(id) ON DELETE CASCADE,
  wamid TEXT,                                   -- WhatsApp message ID (from Meta via kirim.dev)
  direction TEXT NOT NULL
    CHECK (direction IN ('incoming', 'outgoing')),
  sender_phone TEXT,
  recipient_phone TEXT,
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts', 'interactive', 'template', 'unsupported')),
  text_body TEXT,
  media_url TEXT,
  media_mime_type TEXT,
  media_caption TEXT,
  interactive_payload JSONB,                    -- for button replies, list replies
  template_name TEXT,                           -- if message_type = template
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'sent', 'delivered', 'read', 'failed')),
  error_message TEXT,
  raw_payload JSONB,                            -- full webhook/API response for debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kirimdev_messages_conversation
  ON kirimdev_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_kirimdev_messages_wamid
  ON kirimdev_messages(wamid) WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kirimdev_messages_business
  ON kirimdev_messages(business_id);

-- RLS
ALTER TABLE kirimdev_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kirimdev_messages ENABLE ROW LEVEL SECURITY;

-- Policies: service role has full access; users cannot directly access (all access via server-side API routes)
CREATE POLICY "Service role full access on kirimdev_conversations"
  ON kirimdev_conversations
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on kirimdev_messages"
  ON kirimdev_messages
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to read their own business conversations (via RLS on business membership)
-- NOTE: The Next.js API routes use service_role client, so these are just safety guards.
CREATE POLICY "Authenticated read kirimdev_conversations"
  ON kirimdev_conversations
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT active_business_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Authenticated read kirimdev_messages"
  ON kirimdev_messages
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT active_business_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Updated_at trigger for conversations
CREATE OR REPLACE FUNCTION update_kirimdev_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kirimdev_conversations_updated_at
  BEFORE UPDATE ON kirimdev_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_kirimdev_conversations_updated_at();

-- Enable Realtime on both tables (for live inbox updates)
ALTER PUBLICATION supabase_realtime ADD TABLE kirimdev_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE kirimdev_messages;
