const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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
  const query = `
    SELECT 
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customers';
  `;
  
  const { data, error } = await supabase.rpc('exec_sql', { sql: query });
  if (error) {
    console.error("RPC Error:", error);
    // If exec_sql is not available, we can fallback to standard query
    const { data: policies, error: polErr } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'customers');
    console.log("Fallback Policies:", policies, polErr);
  } else {
    console.log("Customers Policies:", JSON.stringify(data, null, 2));
  }
}

run();
