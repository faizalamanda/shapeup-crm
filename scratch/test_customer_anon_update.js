const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync('/home/faiz-jazuli/shapeup-crm/.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    env[match[1]] = (match[2] || '').replace(/^"|"$/g, '');
  }
});

const anonClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  // Sign in as user
  const { data: authData, error: authErr } = await anonClient.auth.signInWithPassword({
    email: 'alamandatoko@gmail.com',
    password: 'Alamandaoke'
  });
  
  if (authErr) {
    console.error("Auth Error:", authErr);
    return;
  }
  
  console.log("Signed in successfully as alamandatoko@gmail.com");
  
  // Fetch active business ID
  const { data: profile } = await anonClient
    .from('profiles')
    .select('active_business_id')
    .eq('id', authData.user.id)
    .single();
    
  const bid = profile?.active_business_id;
  console.log("Active Business ID:", bid);

  if (!bid) {
    console.error("No active business ID found!");
    return;
  }

  // Try querying customer_metrics view first
  const { data: metrics, error: metricsErr } = await anonClient
    .from('customer_metrics')
    .select('*')
    .eq('business_id', bid)
    .limit(1);

  console.log("Customer metrics sample:", metrics, metricsErr);

  // Try to select customers table directly with business_id filter
  const { data: customers, error: selectErr } = await anonClient
    .from('customers')
    .select('*')
    .eq('business_id', bid)
    .limit(1);
    
  if (selectErr) {
    console.error("Select Error:", selectErr);
  } else {
    console.log("Select Success! Customers length:", customers.length);
    console.log("Full customers array:", customers);
    
    if (customers && customers[0]) {
      const originalName = customers[0].name;
      console.log(`Attempting to update customer ${customers[0].id}...`);
      
      const { data: updateData, error: updateErr } = await anonClient
        .from('customers')
        .update({ name: originalName + ' (Test)' })
        .eq('id', customers[0].id)
        .select();
        
      if (updateErr) {
        console.error("Update Error:", updateErr);
      } else {
        console.log("Update Success! Returned:", updateData);
        
        // Revert it back
        await anonClient
          .from('customers')
          .update({ name: originalName })
          .eq('id', customers[0].id);
        console.log("Reverted name back.");
      }
    }
  }
}

run();
