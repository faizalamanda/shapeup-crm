const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('/home/faiz-jazuli/shapeup-crm/.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    env[match[1]] = (match[2] || '').replace(/^"|"$/g, '');
  }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const bid = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'; // TOKO ALAMANDA
  
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .eq('business_id', bid);
    
  if (error) {
    console.error("Error fetching customers:", error);
    return;
  }
  
  console.log(`Customers under TOKO ALAMANDA (Count: ${customers.length}):`);
  if (customers.length > 0) {
    console.log("Customer columns:", Object.keys(customers[0]));
  }
}

run();
