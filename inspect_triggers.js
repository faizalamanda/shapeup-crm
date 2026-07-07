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
  console.log("Fetching all triggers...");
  
  const { data: triggers, error } = await supabase.rpc('get_triggers');
  if (error) {
    // If RPC doesn't exist, execute arbitrary query using postgres functions or check via a generic sql query
    console.error("RPC Error:", error);
    
    // We can run a direct SQL query to select from pg_trigger
    const { data: pgTriggers, error: pgError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1); // just a check, we can't query raw SQL directly unless we use an endpoint or check existing triggers
      
    console.log("Listing tables and triggers via standard queries if possible...");
  } else {
    console.log("Triggers:", triggers);
  }
  
  // Let's do a query on pg_trigger using a custom supabase client RPC or query if available.
  // Actually, we can just execute a query using a Node postgres client or inspect migrations!
  // Let's find all migrations!
}

run();
