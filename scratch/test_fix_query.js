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

async function testFix() {
  console.log('Testing raw fix query for Cash Basis 501002...');

  // Let's run a query representing Case 1 (with NOT EXISTS expense_payments/purchase_payments/salary_payments) + Case 3 + Case 4 + Case 5
  // For July 2026 (2026-07-01 to 2026-07-31 WIB)
  const julyStart = '2026-06-30T17:00:00.000Z';
  const julyEnd   = '2026-07-31T16:59:59.999Z';

  const augStart  = '2026-07-31T17:00:00.000Z';
  const augEnd    = '2026-08-31T16:59:59.999Z';

  // We can fetch expense_payments directly to see sum in July and August
  const { data: epJuly } = await supabase
    .from('expense_payments')
    .select('amount, expenses!inner(category_account_id, description), transactions!inner(date, business_id)')
    .eq('transactions.business_id', businessId)
    .gte('transactions.date', julyStart)
    .lte('transactions.date', julyEnd);

  const julyOngkirEp = epJuly.filter(ep => ep.expenses.category_account_id === '1ec33d68-c5d5-482c-9ab1-bc342401f56e');
  const julyOngkirSum = julyOngkirEp.reduce((sum, item) => sum + item.amount, 0);

  const { data: epAug } = await supabase
    .from('expense_payments')
    .select('amount, expenses!inner(category_account_id, description), transactions!inner(date, business_id)')
    .eq('transactions.business_id', businessId)
    .gte('transactions.date', augStart)
    .lte('transactions.date', augEnd);

  const augOngkirEp = epAug.filter(ep => ep.expenses.category_account_id === '1ec33d68-c5d5-482c-9ab1-bc342401f56e');
  const augOngkirSum = augOngkirEp.reduce((sum, item) => sum + item.amount, 0);

  console.log('Corrected July Ongkir Expense (Cash Basis):', julyOngkirSum, 'IDR');
  console.log('Corrected August Ongkir Expense (Cash Basis):', augOngkirSum, 'IDR');
}

testFix();
