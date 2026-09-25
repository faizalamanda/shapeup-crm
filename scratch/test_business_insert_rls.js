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

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Let's find a user without a business, or test with barcloth.in@gmail.com / nunaadzkadina@gmail.com
  const { data: profiles } = await supabaseAdmin.from('profiles').select('*').eq('email', 'barcloth.in@gmail.com');
  console.log("User profile:", profiles[0]);
  const user = profiles[0];

  if (!user) {
    console.log("User not found!");
    return;
  }

  // Generate an auth token / session for this user using admin magic link or custom token or auth.admin
  // Or let's test directly: create a client with user session token or test API route / RLS!
  // Wait, we can generate a session link or use auth.admin.generateLink or password if known.
  // Alternatively, let's query pg_policies using postgres connection if available, or check REST API.
  
  // Let's check rest API pg_policies endpoint with service role
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/get_complete_schema`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const schema = await res.json();
  if (schema.policies) {
    const bizPolicies = schema.policies.filter(p => p.table === 'businesses');
    console.log("Businesses policies:", bizPolicies);
  } else {
    console.log("Schema result keys:", Object.keys(schema));
  }
}

run();
