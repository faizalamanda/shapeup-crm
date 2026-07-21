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
  const { data: businesses, error: busErr } = await supabase
    .from('businesses')
    .select('id, name');
    
  if (busErr) {
    console.error("Businesses Fetch Error:", busErr);
    return;
  }
  
  console.log("Businesses list:");
  for (const bus of businesses) {
    const { count, error: countErr } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', bus.id);
      
    console.log(`- Name: "${bus.name}", ID: "${bus.id}", Customer Count: ${countErr ? 'Error' : count}`);
  }
}

run();
