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

async function run() {
  const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  
  // Create a temporary user or sign in existing test user
  const testEmail = `testuser_${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  
  console.log("Creating test user:", testEmail);
  const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });
  
  if (createErr) {
    console.error("Failed to create test user:", createErr);
    return;
  }
  
  const userId = newUser.user.id;
  console.log("Created user ID:", userId);

  // Authenticate as this new user
  const supabaseUser = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: authData, error: authErr } = await supabaseUser.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });

  if (authErr) {
    console.error("Failed to sign in as new user:", authErr);
    return;
  }
  console.log("Signed in successfully as test user!");

  // Try inserting a business into `businesses` as authenticated user
  console.log("Attempting to insert new business as authenticated user...");
  const { data: bizData, error: bizErr } = await supabaseUser
    .from('businesses')
    .insert([{
      name: 'TEST ONBOARDING BUSINESS',
      phone: '08123456789',
      timezone: 'Asia/Jakarta',
      owner_id: userId
    }])
    .select()
    .single();

  if (bizErr) {
    console.error("❌ ERROR inserting business:", bizErr);
  } else {
    console.log("✅ SUCCESS inserting business:", bizData);
  }

  // Cleanup test user & business if created
  if (bizData?.id) {
    await supabaseAdmin.from('businesses').delete().eq('id', bizData.id);
  }
  await supabaseAdmin.auth.admin.deleteUser(userId);
  console.log("Cleaned up test user.");
}

run();
