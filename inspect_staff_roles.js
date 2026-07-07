const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read env file manually
const envPath = '.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '');
    }
    env[key] = value;
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const email = 'alamandatoko@gmail.com';
  console.log(`Inspecting staff assignments for user: ${email}...`);

  const { data: users, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) {
    console.error(userError);
    return;
  }

  const user = users.users.find(u => u.email === email);
  if (!user) {
    console.log("User not found!");
    return;
  }

  console.log("User ID:", user.id);

  // 1. Profile role
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  console.log("Profile details:", profile);

  // 2. business_staff assignments
  const { data: staffAssignments } = await supabase
    .from('business_staff')
    .select('*, businesses(*)')
    .eq('profile_id', user.id);

  console.log("\nBusiness Staff assignments for this user:");
  staffAssignments?.forEach(asg => {
    console.log(`- Business ID: ${asg.business_id}`);
    console.log(`  Business Name: ${asg.businesses?.name}`);
    console.log(`  Staff Role in this business: ${asg.role}`);
  });
}

run();
