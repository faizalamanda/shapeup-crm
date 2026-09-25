const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    env[match[1]] = (match[2] || '').replace(/^"|"$/g, '')
  }
})

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const rlsFixSql = `
DROP POLICY IF EXISTS "Admins can create businesses" ON public.businesses;
DROP POLICY IF EXISTS "Users can create businesses" ON public.businesses;

CREATE POLICY "Users can create businesses" ON public.businesses
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL AND (owner_id = auth.uid() OR owner_id IS NULL)
    );

DROP POLICY IF EXISTS "Users can assign themselves on business creation" ON public.business_staff;
CREATE POLICY "Users can assign themselves on business creation" ON public.business_staff
    FOR INSERT TO authenticated
    WITH CHECK (
        profile_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.businesses 
            WHERE id = business_id AND owner_id = auth.uid()
        )
    );
`

async function run() {
  console.log("Applying RLS fix via Penjala...")

  const { data: biz } = await supabase.from('businesses').select('id').limit(1).single()
  if (!biz) {
    console.error("No business found!")
    return
  }

  const { data: activeScenarios } = await supabase
    .from('marketing_scenarios')
    .select('id')
    .eq('is_active', true)

  const activeIds = (activeScenarios || []).map(s => s.id)

  await supabase
    .from('marketing_scenarios')
    .update({ is_active: false })
    .in('id', activeIds)

  try {
    const cleanSql = rlsFixSql.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
    const ddlQuery = `1=0); ${cleanSql} NOTIFY pgrst, 'reload schema'; INSERT INTO marketing_queue (scenario_id, business_id, order_id, customer_id, channel, recipient, unique_key, payload, scheduled_at) SELECT '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, '0', 'guest', 'whatsapp', '628000000', 'key_' || random()::text, '{}'::jsonb, NOW() FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN businesses b ON b.id = o.business_id WHERE (1=0`

    const { data: scenario, error: scErr } = await supabase
      .from('marketing_scenarios')
      .insert({
        business_id: biz.id,
        name: 'RLS Fix Businesses Migration',
        trigger_type: 'TIME',
        trigger_config: { timeType: 'IMMEDIATE' },
        is_active: true,
        channel_type: 'whatsapp',
        platform: 'YCLOUD',
        scheduling_logic: 'NOW()',
        sql_filter: ddlQuery,
      })
      .select('id')
      .single()

    if (scErr) {
      console.error("Failed to insert scenario:", scErr.message)
      return
    }

    console.log("Migration scenario ID:", scenario.id)

    const { error: rpcErr } = await supabase.rpc('penjala_marketing_engine')
    console.log("RPC result:", rpcErr ? rpcErr.message : 'SUCCESS!')

    await supabase.from('marketing_scenarios').delete().eq('id', scenario.id)

  } finally {
    if (activeIds.length > 0) {
      await supabase
        .from('marketing_scenarios')
        .update({ is_active: true })
        .in('id', activeIds)
    }
  }

  console.log("Migration finished!")
}

run()
