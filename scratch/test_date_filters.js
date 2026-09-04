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
const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588';
const ongkirAccId = '1ec33d68-c5d5-482c-9ab1-bc342401f56e';

async function checkDateFilters() {
  console.log('=== Test 1: get_ledger_balances with UTC Bounds for August (Asia/Jakarta) ===');
  // WIB: 2026-08-01 00:00:00 WIB = 2026-07-31T17:00:00.000Z
  // WIB: 2026-08-31 23:59:59 WIB = 2026-08-31T16:59:59.999Z

  const { data: res1 } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-07-31T17:00:00.000Z',
    p_end_date: '2026-08-31T16:59:59.999Z',
    p_basis: 'cash'
  });
  console.log('August Cash (with start date):', res1.find(r => r.account_id === ongkirAccId));

  console.log('\n=== Test 2: get_ledger_balances without start date (Cumulative up to end of August) ===');
  const { data: res2 } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: null,
    p_end_date: '2026-08-31T16:59:59.999Z',
    p_basis: 'cash'
  });
  console.log('Cumulative up to Aug 31 Cash:', res2.find(r => r.account_id === ongkirAccId));

  console.log('\n=== Test 3: Check transaction dates and created_at dates ===');
  const { data: txs } = await supabase
    .from('transactions')
    .select('*, journal_lines(*), expense_payments(*)')
    .eq('business_id', businessId)
    .in('id', [
      '20a2d575-0c4f-4ec2-a959-6a14a684cd31',
      'a4640d02-5e66-42e6-b487-148c048a61a3',
      'f080c260-bf78-463f-b526-2a0b881dd84d',
      '31f9cc31-5318-4a09-b5c6-f61c074f2d7e'
    ]);

  txs.forEach(t => {
    console.log(`Tx ID: ${t.id}`);
    console.log(`  Desc: "${t.description}"`);
    console.log(`  Tx Date: ${t.date}`);
    console.log(`  Expense Payments:`, t.expense_payments);
  });
}

checkDateFilters();
