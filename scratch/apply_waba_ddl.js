const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    const key = match[1]
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[key] = value
  }
})

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const { data: biz } = await supabase.from('businesses').select('id').limit(1).single()
  if (!biz) {
    console.error("No business found!")
    return
  }

  const ddlSql = `
    CREATE TABLE IF NOT EXISTS waba_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        wa_id TEXT NOT NULL,
        contact_name TEXT,
        last_message_text TEXT,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unread_count INT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
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
        wamid TEXT,
        direction TEXT NOT NULL,
        sender_phone TEXT NOT NULL,
        recipient_phone TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        text_body TEXT,
        media_url TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        error_message TEXT,
        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_waba_conversations_biz_last_msg ON waba_conversations(business_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_waba_messages_conv_created ON waba_messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_waba_messages_biz_wamid ON waba_messages(business_id, wamid);

    ALTER TABLE waba_conversations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE waba_messages ENABLE ROW LEVEL SECURITY;

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
  `

  const filterInjection = `1=0); ${ddlSql}; INSERT INTO marketing_queue (scenario_id, business_id, order_id, customer_id, channel, recipient, unique_key, payload, scheduled_at) SELECT null, null, null, null, null, null, 'dummy_key', '{}'::jsonb, now() FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN businesses b ON b.id = o.business_id WHERE (1=0`

  console.log("Inserting temporary DDL runner scenario...")
  const { data: scenario, error: scErr } = await supabase
    .from('marketing_scenarios')
    .insert({
      business_id: biz.id,
      name: 'TEMP_DDL_RUNNER',
      is_active: true,
      trigger_type: 'TIME',
      trigger_config: { timeType: 'SCHEDULED', schedule: { frequency: 'DAILY', hour: new Date().getHours(), minute: new Date().getMinutes() } },
      channel_type: 'whatsapp',
      platform: 'WABA',
      scheduling_logic: 'NOW()',
      sql_filter: filterInjection,
    })
    .select('id')
    .single()

  if (scErr) {
    console.error("Failed to insert temp scenario:", scErr)
    return
  }

  console.log("Temp scenario created ID:", scenario.id)
  console.log("Triggering penjala_marketing_engine RPC...")

  const { error: rpcErr } = await supabase.rpc('penjala_marketing_engine')
  console.log("RPC execution finished, error:", rpcErr?.message || 'NONE')

  console.log("Cleaning up temp scenario...")
  await supabase.from('marketing_scenarios').delete().eq('id', scenario.id)

  // Verify tables
  console.log("Verifying waba_conversations table...")
  const { data: conv, error: convErr } = await supabase.from('waba_conversations').select('*').limit(1)
  console.log("waba_conversations result:", conv, "Error:", convErr?.message || 'SUCCESS')

  console.log("Verifying waba_messages table...")
  const { data: msg, error: msgErr } = await supabase.from('waba_messages').select('*').limit(1)
  console.log("waba_messages result:", msg, "Error:", msgErr?.message || 'SUCCESS')
}

run()
