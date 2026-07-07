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
  const email = 'test_correct_staff@gmail.com';
  const name = 'Test Correct Staff';
  const active_business_id = '097211f4-2d19-4196-a7b7-5b2cd17c2588'; // Alamanda

  console.log("Starting test staff insert with CORRECT ORDER...");

  // 1. Create user in auth
  const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
    user_metadata: { full_name: name }
  });

  if (createError) {
    console.error("Create User Error:", createError);
    return;
  }

  const userId = newUser.user.id;
  console.log("Created Auth User. ID:", userId);

  // 2. Insert to business_staff FIRST
  console.log("Inserting into business_staff first...");
  const { error: bsError } = await supabase
    .from('business_staff')
    .insert({
      business_id: active_business_id,
      profile_id: userId,
      role: 'staff'
    });

  if (bsError) {
    console.error("Business Staff Insert Error:", bsError);
  } else {
    console.log("Business staff relation inserted successfully.");
  }

  // 3. Update profile SECOND
  console.log("Updating profile table second...");
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ 
      full_name: name,
      business_id: active_business_id,
      active_business_id: active_business_id,
      role: 'staff'
    })
    .eq('id', userId);

  if (profileError) {
    console.error("Profile Update Error:", profileError);
  } else {
    console.log("Profile updated successfully.");
  }

  // Clean up test user
  console.log("Cleaning up test user...");
  await supabase.auth.admin.deleteUser(userId);
  console.log("Cleanup done.");
}

run();
