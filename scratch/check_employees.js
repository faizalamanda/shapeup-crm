const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = '.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    env[match[1]] = (match[2] || '').replace(/^"|"/g, '');
  }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: employees } = await supabase.from('employees').select('*');
  console.log("Employees count:", employees?.length);
  console.log("Employees data:", JSON.stringify(employees, null, 2));

  const { data: businesses } = await supabase.from('businesses').select('*');
  console.log("Businesses:", JSON.stringify(businesses, null, 2));
}
run();
