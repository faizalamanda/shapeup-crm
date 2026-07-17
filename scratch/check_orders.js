const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    const key = match[1]
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[key] = value
  }
})

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const businessId = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'; // TOKO ALAMANDA
  console.log(`Fetching orders for business ${businessId} in July 2026...`);
  
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('business_id', businessId)
    .gte('created_at', '2026-06-25T00:00:00Z')
    .lte('created_at', '2026-08-05T23:59:59Z')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Found ${orders.length} orders:`);
  orders.forEach(o => {
    console.log(`- ID: ${o.id} | Code: ${o.invoice_code || o.code} | Date: ${o.created_at} | Status: ${o.status} | Total: ${o.grand_total} | Type: ${o.type || 'POS?'}`);
  });
}

run()
