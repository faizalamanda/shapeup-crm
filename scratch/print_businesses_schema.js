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
  const { data: schema } = await supabaseAdmin.rpc('get_complete_schema');
  if (schema && schema.tables) {
    const bizTable = schema.tables.find(t => t.name === 'businesses');
    console.log("Businesses Table schema:", JSON.stringify(bizTable, null, 2));

    const staffTable = schema.tables.find(t => t.name === 'business_staff');
    console.log("Business Staff Table schema:", JSON.stringify(staffTable, null, 2));

    const profTable = schema.tables.find(t => t.name === 'profiles');
    console.log("Profiles Table schema:", JSON.stringify(profTable, null, 2));
  }
}

run();
