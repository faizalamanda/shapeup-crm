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

async function verify() {
  console.log('=== Checking Live get_ledger_balances RPC Output from Supabase ===');

  // July Cash Basis
  const { data: julyBal, error: julyErr } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-06-30T17:00:00.000Z',
    p_end_date: '2026-07-31T16:59:59.999Z',
    p_basis: 'cash'
  });

  // August Cash Basis
  const { data: augBal, error: augErr } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-07-31T17:00:00.000Z',
    p_end_date: '2026-08-31T16:59:59.999Z',
    p_basis: 'cash'
  });

  if (julyErr || augErr) {
    console.error('RPC Error:', julyErr?.message || augErr?.message);
    return;
  }

  const julyRow = julyBal?.find(r => r.account_id === ongkirAccId);
  const augRow = augBal?.find(r => r.account_id === ongkirAccId);

  console.log('Live July 2026 Cash Basis Ongkir (501002):', julyRow);
  console.log('Live August 2026 Cash Basis Ongkir (501002):', augRow);
}

verify();
