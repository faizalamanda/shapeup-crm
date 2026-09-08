require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, error } = await supabase.from('pipeline_members').select('*').limit(1);
  console.log("pipeline_members:", data, error);
  
  const { data: p, error: pe } = await supabase.from('pipelines').select('*').limit(1);
  console.log("pipelines:", p, pe);
}
main();
