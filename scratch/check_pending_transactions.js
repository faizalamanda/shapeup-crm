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
  const { data: pendingOrders, error } = await supabase
    .from('orders')
    .select('id, order_number, status, grand_total, created_at')
    .eq('business_id', 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d')
    .eq('status', 'pending');

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Checking ${pendingOrders.length} pending orders for transactions...`);
  for (const o of pendingOrders) {
    const { data: txs } = await supabase
      .from('transactions')
      .select('id, description, date')
      .eq('order_id', o.id);
      
    if (txs && txs.length > 0) {
      console.log(`Order ${o.order_number || o.id} has status 'pending' but has transactions:`);
      txs.forEach(t => console.log(`  - Tx ID: ${t.id} | Desc: ${t.description} | Date: ${t.date}`));
    }
  }
}

run()
