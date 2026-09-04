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
const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588'; // Toko Alamanda

async function inspect() {
  console.log('=== 1. Check Accounts for Ongkir / Shipping Expense ===');
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, type, sub_type')
    .eq('business_id', businessId);
  
  const ongkirAccounts = accounts.filter(a => 
    a.name.toLowerCase().includes('ongkir') || 
    a.name.toLowerCase().includes('pengiriman') || 
    a.name.toLowerCase().includes('shipping') || 
    a.name.toLowerCase().includes('kurir') ||
    a.name.toLowerCase().includes('ekspedisi')
  );
  console.log('Ongkir / Shipping accounts found:', ongkirAccounts);

  console.log('\n=== 2. Check Expenses related to Ongkir / Shipping ===');
  const { data: expenses } = await supabase
    .from('expenses')
    .select('*, expense_payments(*)')
    .eq('business_id', businessId);
  
  console.log(`Total expenses count: ${expenses?.length || 0}`);
  const ongkirExpenses = (expenses || []).filter(e => 
    (e.description && (e.description.toLowerCase().includes('ongkir') || e.description.toLowerCase().includes('shipping') || e.description.toLowerCase().includes('pengiriman'))) ||
    ongkirAccounts.some(a => a.id === e.category_account_id)
  );
  console.log('Ongkir expenses count:', ongkirExpenses.length);
  ongkirExpenses.forEach(e => {
    console.log(`Expense ID: ${e.id}, Date: ${e.expense_date}, CategoryAcc: ${e.category_account_id}, Desc: "${e.description}", Amount: ${e.amount}`);
    console.log(`  Payments:`, e.expense_payments);
  });

  console.log('\n=== 3. Check Expense Payments in July & August 2026 ===');
  const { data: expPayments } = await supabase
    .from('expense_payments')
    .select('*, transactions(*)');
  
  const alamandaExpPayments = (expPayments || []).filter(ep => ep.transactions && ep.transactions.business_id === businessId);
  console.log('Alamanda expense payments count:', alamandaExpPayments.length);
  alamandaExpPayments.forEach(ep => {
    console.log(`EP ID: ${ep.id}, Expense ID: ${ep.expense_id}, Payment Date in Ep: ${ep.payment_date}, Tx Date: ${ep.transactions?.date}, Amount: ${ep.amount}, Tx Desc: "${ep.transactions?.description}"`);
  });

  console.log('\n=== 4. Check All Expense Transactions in July & August 2026 ===');
  const { data: txs } = await supabase
    .from('transactions')
    .select('*, journal_lines(*)')
    .eq('business_id', businessId)
    .gte('date', '2026-07-01T00:00:00.000Z')
    .lte('date', '2026-08-31T23:59:59.999Z')
    .order('date', { ascending: true });

  console.log(`Total transactions July-August 2026: ${txs?.length || 0}`);
  txs?.forEach(t => {
    const isOngkir = (t.description && t.description.toLowerCase().includes('ongkir')) ||
      t.journal_lines.some(jl => ongkirAccounts.some(oa => oa.id === jl.account_id));
    if (isOngkir) {
      console.log(`Tx ID: ${t.id}, Date: ${t.date}, Desc: "${t.description}", OrderId: ${t.order_id}`);
      t.journal_lines.forEach(jl => {
        const acc = accounts.find(a => a.id === jl.account_id);
        console.log(`  Line: ${acc?.code} (${acc?.name}) - Debit: ${jl.debit}, Credit: ${jl.credit}`);
      });
    }
  });

  console.log('\n=== 5. Check Ledger Balances RPC output for July and August (Cash Basis vs Accrual Basis) ===');
  // July 2026 Cash Basis: 2026-07-01 to 2026-07-31
  const { data: julyCash } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-06-30T17:00:00.000Z',
    p_end_date: '2026-07-31T16:59:59.999Z',
    p_basis: 'cash'
  });
  // August 2026 Cash Basis: 2026-08-01 to 2026-08-31
  const { data: augCash } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: '2026-07-31T17:00:00.000Z',
    p_end_date: '2026-08-31T16:59:59.999Z',
    p_basis: 'cash'
  });

  ongkirAccounts.forEach(oa => {
    const julyRow = julyCash?.find(r => r.account_id === oa.id);
    const augRow = augCash?.find(r => r.account_id === oa.id);
    console.log(`Account ${oa.code} (${oa.name}):`);
    console.log(`  July Cash Basis  -> Debit: ${julyRow?.debit_sum}, Credit: ${julyRow?.credit_sum}`);
    console.log(`  August Cash Basis -> Debit: ${augRow?.debit_sum}, Credit: ${augRow?.credit_sum}`);
  });
}

inspect();
