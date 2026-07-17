const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read env file manually
const envPath = '.env.local';
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const businessId = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'; // TOKO ALAMANDA
  console.log(`Fetching transactions for business ${businessId}...`);
  
  // We want transactions between 2026-06-25 and 2026-08-05 to cover any timezone differences
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select(`
      id,
      date,
      description,
      journal_lines (
        id,
        account_id,
        debit,
        credit,
        accounts (
          code,
          name,
          type
        )
      )
    `)
    .eq('business_id', businessId)
    .gte('date', '2026-06-25T00:00:00Z')
    .lte('date', '2026-08-05T23:59:59Z')
    .order('date', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Found ${transactions.length} transactions:`);
  transactions.forEach(t => {
    // Convert UTC date to local time Asia/Jakarta format
    const localTime = new Date(t.date).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`- [UTC: ${t.date} | JKT: ${localTime}] ID: ${t.id} - ${t.description}`);
    t.journal_lines.forEach(jl => {
      console.log(`    * Account: (${jl.accounts?.code}) ${jl.accounts?.name} (${jl.accounts?.type}) | Debit: ${jl.debit} | Credit: ${jl.credit}`);
    });
  });
}

run();
