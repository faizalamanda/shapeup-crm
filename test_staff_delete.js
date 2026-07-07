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
  const email = 'test_delete_staff@gmail.com';
  const name = 'Test Delete Staff';
  const active_business_id = '097211f4-2d19-4196-a7b7-5b2cd17c2588'; // Alamanda

  console.log("Starting test staff delete workflow...");

  // 1. Create user in auth
  const { data: newUser } = await supabase.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
    user_metadata: { full_name: name }
  });
  const userId = newUser.user.id;

  // 2. Insert BS
  await supabase.from('business_staff').insert({
    business_id: active_business_id,
    profile_id: userId,
    role: 'staff'
  });

  // 3. Update profile
  await supabase.from('profiles').update({ 
    full_name: name,
    business_id: active_business_id,
    active_business_id: active_business_id,
    role: 'staff'
  }).eq('id', userId);

  console.log("Setup complete. Attempting DELETE from business_staff...");

  // 4. Delete from business_staff
  const { error: deleteError } = await supabase
    .from('business_staff')
    .delete()
    .eq('business_id', active_business_id)
    .eq('profile_id', userId);

  if (deleteError) {
    console.error("Delete Error:", deleteError);
  } else {
    console.log("Deleted assignment successfully!");
  }

  // Cleanup
  await supabase.auth.admin.deleteUser(userId);
  console.log("Cleanup done.");
}

run();
