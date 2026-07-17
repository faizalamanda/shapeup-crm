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
  console.log(`Fetching invoices for business ${businessId}...`);
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('business_id', businessId);
  if (error) {
    console.error(error);
    return;
  }
  console.log("Invoices list:", invoices);
}

run();
