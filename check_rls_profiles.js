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
  console.log("Checking RLS policies on profiles table...");
  const query = `
    SELECT 
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles';
  `;

  // We can select all policies from pg_policies. Let's see if we can do this via Postgres.
  // Wait, let's look at the database schema via a direct fetch of public profiles with anon vs service role!
  const anonClient = createClient(supabaseUrl, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  
  // Sign in as alamandatoko@gmail.com
  const { data: authData } = await anonClient.auth.signInWithPassword({
    email: 'alamandatoko@gmail.com',
    password: 'Alamandaoke'
  });
  
  console.log("Signed in with Anon client as alamandatoko@gmail.com.");
  
  // Try to select business_staff joined with profiles
  const { data, error } = await anonClient
    .from('business_staff')
    .select('role, profiles (*)')
    .eq('business_id', '097211f4-2d19-4196-a7b7-5b2cd17c2588'); // Alamanda
    
  if (error) {
    console.error("Fetch staff Error:", error);
  } else {
    console.log("Fetch staff Success! Number of rows:", data.length);
    console.log("Data sample:", JSON.stringify(data, null, 2));
  }
}

run();
