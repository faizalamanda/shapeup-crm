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
  // Find profile of alamandatoko@gmail.com
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', 'alamandatoko@gmail.com');
    
  if (profErr || !profiles || profiles.length === 0) {
    console.error("Profile not found:", profErr);
    return;
  }
  
  const profile = profiles[0];
  console.log("Profile of alamandatoko@gmail.com:", profile);
  
  // Find business_staff entries
  const { data: staff, error: staffErr } = await supabase
    .from('business_staff')
    .select('*, businesses(name)')
    .eq('profile_id', profile.id);
    
  if (staffErr) {
    console.error("Staff Fetch Error:", staffErr);
    return;
  }
  
  console.log("Business staff memberships:");
  staff.forEach(s => {
    console.log(`- Business ID: ${s.business_id}, Business Name: ${s.businesses?.name}, Role: ${s.role}`);
  });
}

run();
