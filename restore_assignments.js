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
  const active_business_id = '097211f4-2d19-4196-a7b7-5b2cd17c2588'; // Alamanda

  console.log("Restoring assignments...");
  await supabase.from('business_staff').insert({
    business_id: active_business_id,
    profile_id: 'b82b3d43-b4ee-44e0-9d4c-146e90cdfcef', // Admin Alamanda 2
    role: 'staff'
  });

  await supabase.from('business_staff').insert({
    business_id: active_business_id,
    profile_id: '15781157-965c-420a-9f19-bcf51311268f', // Admin Alamanda
    role: 'admin'
  });

  console.log("Done.");
}

run();
