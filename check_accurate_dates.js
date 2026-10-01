const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) env[match[1]] = match[2].replace(/^"|"$/g, '');
});
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_date, order_date_utc, raw_source_data')
    .eq('source_platform', 'Accurate Online')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (error) console.error(error);
  else {
    data.forEach(d => {
      console.log('Order:', d.id);
      console.log('order_date:', d.order_date);
      console.log('order_date_utc:', d.order_date_utc);
      console.log('raw transDate:', d.raw_source_data?.transDate);
      console.log('---');
    });
  }
}
run();
