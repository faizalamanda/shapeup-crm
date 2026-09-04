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

async function testCases() {
  const ongkirAccId = '1ec33d68-c5d5-482c-9ab1-bc342401f56e'; // Biaya Beban Ongkir (501002)

  // July: 2026-06-30T17:00:00.000Z to 2026-07-31T16:59:59.999Z
  // Aug:  2026-07-31T17:00:00.000Z to 2026-08-31T16:59:59.999Z

  console.log('=== Checking all transactions for 501002 (Ongkir Expense) ===');
  const { data: allJl } = await supabase
    .from('journal_lines')
    .select('*, transactions(*)')
    .eq('account_id', ongkirAccId);
  
  console.log(`Total journal lines for 501002: ${allJl.length}`);
  allJl.forEach(jl => {
    console.log(`JL ID: ${jl.id}, Debit: ${jl.debit}, Credit: ${jl.credit}, Tx Date: ${jl.transactions?.date}, Tx Desc: "${jl.transactions?.description}"`);
  });

  // Let's check expense payments for 501002
  const { data: expPayments } = await supabase
    .from('expense_payments')
    .select('*, expenses(*), transactions(*)');

  const ongkirEp = expPayments.filter(ep => ep.expenses && ep.expenses.category_account_id === ongkirAccId);
  console.log(`\nTotal expense payments for 501002: ${ongkirEp.length}`);
  ongkirEp.forEach(ep => {
    console.log(`EP ID: ${ep.id}, Amount: ${ep.amount}, Tx Date: ${ep.transactions?.date}, Tx Desc: "${ep.transactions?.description}"`);
  });

  // Now let's test what get_ledger_balances gives for July & August
  const { data: julyBalances } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-06-30T17:00:00.000Z',
    p_end_date: '2026-07-31T16:59:59.999Z',
    p_basis: 'cash'
  });

  const { data: augBalances } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-07-31T17:00:00.000Z',
    p_end_date: '2026-08-31T16:59:59.999Z',
    p_basis: 'cash'
  });

  const { data: julyAccrual } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-06-30T17:00:00.000Z',
    p_end_date: '2026-07-31T16:59:59.999Z',
    p_basis: 'accrual'
  });

  const { data: augAccrual } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-07-31T17:00:00.000Z',
    p_end_date: '2026-08-31T16:59:59.999Z',
    p_basis: 'accrual'
  });

  console.log('\n--- 501002 Biaya Beban Ongkir Summary ---');
  console.log('July Accrual:', julyAccrual.find(r => r.account_id === ongkirAccId));
  console.log('July Cash   :', julyBalances.find(r => r.account_id === ongkirAccId));
  console.log('August Accrual:', augAccrual.find(r => r.account_id === ongkirAccId));
  console.log('August Cash   :', augBalances.find(r => r.account_id === ongkirAccId));
}

testCases();
