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
    .limit(3);
  
  if (error) console.error(error);
  else {
    data.forEach(d => {
      console.log('Order:', d.id);
      console.log('subtotal:', d.subtotal);
      console.log('discount:', d.discount_amount);
      console.log('shipping:', d.shipping_cost);
      console.log('grand_total:', d.grand_total);
      console.log('raw totalAmount:', d.raw_source_data?.totalAmount);
      console.log('raw tax1Amount:', d.raw_source_data?.tax1Amount);
      console.log('raw tax2Amount:', d.raw_source_data?.tax2Amount);
      console.log('raw itemDiscountAmount:', d.raw_source_data?.itemDiscountAmount);
      console.log('raw discountAmount:', d.raw_source_data?.discountAmount);
      console.log('raw detailItem length:', d.raw_source_data?.detailItem?.length);
      console.log('---');
    });
  }
}
run();
