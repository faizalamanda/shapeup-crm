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

const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20260924000000_create_pos_system_tables.sql'), 'utf8')

async function run() {
  console.log("Applying POS Migration via isolated Penjala execution...")

  // 1. Get active business ID
  const { data: biz } = await supabase.from('businesses').select('id').limit(1).single()
  if (!biz) {
    console.error("No business found!")
    return
  }

  // 2. Fetch all currently active scenarios to restore later
  const { data: activeScenarios } = await supabase
    .from('marketing_scenarios')
    .select('id')
    .eq('is_active', true)

  const activeIds = (activeScenarios || []).map(s => s.id)
  console.log(`Deactivating ${activeIds.length} existing active scenarios temporarily...`)

  // 3. Deactivate all scenarios temporarily
  await supabase
    .from('marketing_scenarios')
    .update({ is_active: false })
    .in('id', activeIds)

  try {
    // 4. Clean DDL SQL & create single migration scenario with 1=0 prefix
    const cleanSql = migrationSql.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
    const ddlQuery = `1=0); ${cleanSql} NOTIFY pgrst, 'reload schema'; INSERT INTO marketing_queue (scenario_id, business_id, order_id, customer_id, channel, recipient, unique_key, payload, scheduled_at) SELECT '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, '0', 'guest', 'whatsapp', '628000000', 'key_' || random()::text, '{}'::jsonb, NOW() FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN businesses b ON b.id = o.business_id WHERE (1=0`

    const { data: scenario, error: scErr } = await supabase
      .from('marketing_scenarios')
      .insert({
        business_id: biz.id,
        name: 'POS DDL Migration Final',
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
      console.error("Failed to insert DDL scenario:", scErr.message)
      return
    }

    console.log("DDL scenario created ID:", scenario.id)

    // 5. Execute RPC
    const { error: rpcErr } = await supabase.rpc('penjala_marketing_engine')
    console.log("RPC execution result:", rpcErr ? rpcErr.message : 'SUCCESS!')

    // 6. Delete temp scenario
    await supabase.from('marketing_scenarios').delete().eq('id', scenario.id)

  } finally {
    // 7. Always restore original active scenarios
    if (activeIds.length > 0) {
      console.log("Restoring original active scenarios...")
      await supabase
        .from('marketing_scenarios')
        .update({ is_active: true })
        .in('id', activeIds)
    }
  }

  console.log("\n=== Verifying POS Tables in Schema Cache ===")
  const tables = ['pos_shifts', 'pos_shift_movements', 'pos_held_orders', 'pos_printer_devices', 'product_variants', 'product_modifiers']
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1)
    if (error) {
      console.log(`❌ ${table}: ${error.message}`)
    } else {
      console.log(`✅ ${table}: OK (Rows: ${data?.length || 0})`)
    }
  }
}

run()
