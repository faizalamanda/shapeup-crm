const { createServerClient } = require('@supabase/ssr');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = '.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    env[match[1]] = (match[2] || '').replace(/^"|"/g, '');
  }
});

async function run() {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let cookiesSet = [];

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() { return []; },
        setAll(cookiesToSet) {
          cookiesSet = cookiesToSet;
        }
      }
    }
  );

  console.log("Signing in on server-side client...");
  await supabase.auth.signInWithPassword({
    email: 'alamandatoko@gmail.com',
    password: 'Alamandaoke'
  });

  console.log("Cookies to set:", JSON.stringify(cookiesSet, null, 2));
}

run();
