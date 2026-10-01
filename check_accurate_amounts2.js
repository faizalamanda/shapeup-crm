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
    .select('id, subtotal, discount_amount, shipping_cost, grand_total, raw_source_data')
    .eq('source_platform', 'Accurate Online')
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (error) console.error(error);
  else {
    let diffCount = 0;
    data.forEach(d => {
      const calcGrandTotal = d.subtotal + d.shipping_cost - d.discount_amount;
      if (d.grand_total !== calcGrandTotal) {
        console.log('Order:', d.id);
        console.log('subtotal:', d.subtotal);
        console.log('discount:', d.discount_amount);
        console.log('shipping:', d.shipping_cost);
        console.log('grand_total:', d.grand_total);
        console.log('calculated:', calcGrandTotal);
        console.log('raw totalAmount:', d.raw_source_data?.totalAmount);
        console.log('raw tax1Amount:', d.raw_source_data?.tax1Amount);
        console.log('raw detailItem length:', d.raw_source_data?.detailItem?.length);
        console.log('---');
        diffCount++;
      }
    });
    if (diffCount === 0) console.log("No differences found in the last 50 orders.");
  }
}
run();
