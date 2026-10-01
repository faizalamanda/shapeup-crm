const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) env[match[1]] = match[2].replace(/^"|"$/g, '');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('orders')
    .select('raw_source_data')
    .eq('id', 'faec1056-b5a0-4800-be87-a71a0bc24068')
    .single();
  
  if (error) console.error(error);
  else {
    console.log(JSON.stringify(data.raw_source_data, null, 2));
  }
}
run();
