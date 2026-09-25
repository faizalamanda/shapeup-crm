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
  console.log("Listing users...");
  const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers();
  if (usersErr) {
    console.error("List users error:", usersErr);
    return;
  }
  console.log(`Found ${usersData.users.length} users:`);
  usersData.users.forEach(u => {
    console.log(`- ID: ${u.id}, Email: ${u.email}, Created: ${u.created_at}`);
  });

  // Check profiles table for all users
  const { data: profiles, error: profErr } = await supabaseAdmin.from('profiles').select('*');
  console.log("\nProfiles in DB:", profiles);

  // Check businesses table
  const { data: businesses, error: bizErr } = await supabaseAdmin.from('businesses').select('*');
  console.log("\nBusinesses in DB:", businesses);
}

run();
