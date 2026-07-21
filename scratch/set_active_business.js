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
  const profileId = '154804c0-fb5d-440c-9672-50938ff33ffd'; // alamandatoko@gmail.com
  const businessId = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'; // TOKO ALAMANDA
  
  const { data, error } = await supabase
    .from('profiles')
    .update({ active_business_id: businessId })
    .eq('id', profileId)
    .select();
    
  if (error) {
    console.error("Update active business error:", error);
  } else {
    console.log("Successfully set active business to TOKO ALAMANDA:", data);
  }
}

run();
