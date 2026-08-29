const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
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

async function applyDdl() {
  console.log("Applying DDL: Add description column to journal_lines & reload schema cache...")

  const { data: biz } = await supabase.from('businesses').select('id').limit(1).single()
  if (!biz) {
    console.error("No business found!")
    return
  }

  // Create temporary scenario to execute DDL
  const ddlQuery = `1=1); ALTER TABLE public.journal_lines ADD COLUMN IF NOT EXISTS description TEXT; NOTIFY pgrst, 'reload schema'; INSERT INTO marketing_queue (scenario_id, business_id, order_id, customer_id, channel, recipient, unique_key, payload, scheduled_at) SELECT '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, o.id::text, 'guest', 'whatsapp', '628', 'key_' || random()::text, '{}'::jsonb, NOW() FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN businesses b ON b.id = o.business_id WHERE (1=0`

  const { data: scenario, error: scErr } = await supabase
    .from('marketing_scenarios')
    .insert({
      business_id: biz.id,
      name: 'Temp DDL Migration',
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
    console.error("Failed to create temp scenario:", scErr.message)
    return
  }

  console.log("Temp scenario created ID:", scenario.id)

  const { error: rpcErr } = await supabase.rpc('penjala_marketing_engine')
  console.log("RPC execution finished, error:", rpcErr?.message || 'NONE')

  console.log("Cleaning up temp scenario...")
  await supabase.from('marketing_scenarios').delete().eq('id', scenario.id)

  console.log("Verifying journal_lines schema cache query...")
  const { data: jl, error: jlErr } = await supabase.from('journal_lines').select('id, description').limit(1)
  console.log("journal_lines query result:", jl, "Error:", jlErr?.message || 'SUCCESS')
}

applyDdl()
