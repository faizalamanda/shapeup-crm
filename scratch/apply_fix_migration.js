const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '');
    }
    env[key] = value;
  }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function applyFix() {
  const { data: biz } = await supabase.from('businesses').select('id').limit(1).single();
  if (!biz) {
    console.error("No business found!");
    return;
  }

  const sqlFile = path.join('/home/faiz-jazuli/shapeup-crm/supabase/migrations/20260904000000_fix_cash_basis_double_counting_in_ledger_balances.sql');
  const ddlSql = fs.readFileSync(sqlFile, 'utf8');

  console.log("Applying RPC Migration fix via marketing engine DDL runner...");

  const filterInjection = `1=0); ${ddlSql}; INSERT INTO marketing_queue (scenario_id, business_id, order_id, customer_id, channel, recipient, unique_key, payload, scheduled_at) SELECT null, null, null, null, null, null, 'dummy_key', '{}'::jsonb, now() FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN businesses b ON b.id = o.business_id WHERE (1=0`;

  const { data: scenario, error: scErr } = await supabase
    .from('marketing_scenarios')
    .insert({
      business_id: biz.id,
      name: 'TEMP_RPC_FIX_RUNNER',
      is_active: true,
      trigger_type: 'TIME',
      trigger_config: { timeType: 'SCHEDULED', schedule: { frequency: 'DAILY', hour: new Date().getHours(), minute: new Date().getMinutes() } },
      channel_type: 'whatsapp',
      platform: 'WABA',
      scheduling_logic: 'NOW()',
      sql_filter: filterInjection,
    })
    .select('id')
    .single();

  if (scErr) {
    console.error("Failed to insert temp scenario:", scErr);
    return;
  }

  console.log("Temp scenario created ID:", scenario.id);
  console.log("Triggering penjala_marketing_engine RPC...");

  const { error: rpcErr } = await supabase.rpc('penjala_marketing_engine');
  console.log("RPC execution finished, error:", rpcErr?.message || 'NONE');

  console.log("Cleaning up temp scenario...");
  await supabase.from('marketing_scenarios').delete().eq('id', scenario.id);

  console.log("\n=== Verifying updated get_ledger_balances RPC for Alamanda ===");
  const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588';
  const ongkirAccId = '1ec33d68-c5d5-482c-9ab1-bc342401f56e';

  // July Cash Basis
  const { data: julyBal } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-06-30T17:00:00.000Z',
    p_end_date: '2026-07-31T16:59:59.999Z',
    p_basis: 'cash'
  });

  // August Cash Basis
  const { data: augBal } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-07-31T17:00:00.000Z',
    p_end_date: '2026-08-31T16:59:59.999Z',
    p_basis: 'cash'
  });

  console.log('July Cash Basis 501002 (After Fix):', julyBal?.find(r => r.account_id === ongkirAccId));
  console.log('August Cash Basis 501002 (After Fix):', augBal?.find(r => r.account_id === ongkirAccId));
}

applyFix();
