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
  console.log("Querying pg_trigger...");
  
  // We can query pg_trigger using the postgres catalog views
  // Let's run a query selecting trigger name, table name, and action
  const query = `
    SELECT 
        trg.tgname AS trigger_name,
        tbl.relname AS table_name,
        p.proname AS function_name
    FROM pg_trigger trg
    JOIN pg_class tbl ON trg.tgrelid = tbl.oid
    JOIN pg_namespace ns ON tbl.relnamespace = ns.oid
    JOIN pg_proc p ON trg.tgfoid = p.oid
    WHERE ns.nspname = 'public'
      AND tbl.relname IN ('profiles', 'business_staff', 'businesses');
  `;

  // Supabase JS doesn't have a direct sql query function, but we can execute it via postgres function or HTTP endpoint if there's an RPC.
  // Wait! Do we have any RPC?
  // Let's check if we can write a postgres function or if there is another way.
  // Actually, we can check if there are other files in the project that define tables/triggers.
  // No, the project is a NextJS app and the database is Supabase.
  // Wait, let's look at the database schema! We can check if there are any other triggers on business_staff.
  // If there are no other sql files in supabase/migrations, then there are no other triggers created by migrations!
  // Wait! What if there are RLS policies on business_staff?
  // Let's check the RLS policies:
  // FOR ALL TO authenticated USING ( EXISTS ( SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' ) )
  // Wait! In the API route:
  // We use supabaseAdmin = getSupabaseAdmin() which uses the service role key. Service role key bypasses RLS completely, so RLS policies cannot cause the 500 error!
}

run();
