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

async function checkDetails() {
  const expIds = [
    'd808e931-4dc6-4cf1-a22b-55bd9dde1f08', // Biaya ongkir lincah (Jul 31)
    'ce912069-50bc-4c84-a469-974e96cfba91', // Biaya Ongkir COD mengantar (Jul 31)
    '86b358f5-6182-419a-a818-26e83d2bcb2e', // Tagihan ongkir agustus (Aug 31)
    'dbfc3cce-bfac-43fc-b576-78c7da00b25b'  // Ongkir Mengantar Agustus (Aug 31)
  ];

  console.log('=== Detailed Expenses & Payment Transactions ===');
  for (const id of expIds) {
    const { data: exp } = await supabase.from('expenses').select('*').eq('id', id).single();
    const { data: ep } = await supabase.from('expense_payments').select('*, transactions(*)').eq('expense_id', id);
    console.log('\nExpense:', exp);
    console.log('Expense Payments:', ep);
  }

  console.log('\n=== Checking get_ledger_balances RPC logic for Expense Payments ===');
  // Let's run get_ledger_balances RPC for July 2026 and August 2026 explicitly and print raw_lines if possible
  // Or check RPC code again:
  // Case 3 in get_ledger_balances:
  // SELECT e.category_account_id as account_id, ep.amount as debit, 0 as credit, t_pay.date
  // FROM public.expense_payments ep
  // JOIN public.transactions t_pay ON ep.transaction_id = t_pay.id
  // JOIN public.expenses e ON ep.expense_id = e.id
  // WHERE t_pay.business_id = p_business_id
}

checkDetails();
