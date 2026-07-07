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
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("Signing in...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'alamandatoko@gmail.com',
    password: 'Alamandaoke'
  });

  if (authError) {
    console.error("Sign in error:", authError);
    return;
  }

  const token = authData.session.access_token;
  console.log("Logged in. Access token obtained.");

  // Set active business to Alamanda ('097211f4-2d19-4196-a7b7-5b2cd17c2588')
  const { error: activeError } = await supabase
    .from('profiles')
    .update({ active_business_id: '097211f4-2d19-4196-a7b7-5b2cd17c2588' })
    .eq('id', authData.user.id);
  
  if (activeError) {
    console.error("Set active business error:", activeError);
    return;
  }
  console.log("Set active business to Alamanda.");

  // We need to call DELETE /api/staff?id=b82b3d43-b4ee-44e0-9d4c-146e90cdfcef (Admin Alamanda 2)
  console.log("Calling DELETE /api/staff...");

  // Since it uses createServerClient with next/headers cookies(), it expects the supabase auth cookies.
  const projectId = supabaseUrl.split('//')[1].split('.')[0];
  
  // Let's set cookies standard format
  const cookieHeader = `sb-access-token=${token}; sb-refresh-token=${authData.session.refresh_token}`;

  // 1. Test DELETE
  const deleteRes = await fetch('http://localhost:3000/api/staff?id=b82b3d43-b4ee-44e0-9d4c-146e90cdfcef', {
    method: 'DELETE',
    headers: {
      'Cookie': cookieHeader
    }
  });
  console.log("DELETE Status:", deleteRes.status);
  const deleteText = await deleteRes.text();
  console.log("DELETE Response Body:", deleteText);

  // 2. Test POST
  const postRes = await fetch('http://localhost:3000/api/staff', {
    method: 'POST',
    headers: {
      'Cookie': cookieHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'new_staff_api_test@gmail.com',
      password: 'password123',
      full_name: 'New Staff API Test',
      role: 'staff'
    })
  });
  console.log("POST Status:", postRes.status);
  const postText = await postRes.text();
  console.log("POST Response Body:", postText);
}

run();
