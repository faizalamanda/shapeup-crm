const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[key] = value;
  }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    // 1. Get all businesses in profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('active_business_id')
      .not('active_business_id', 'is', null);

    if (!profiles || profiles.length < 2) {
      console.log("Not enough profiles with different businesses to test multi-tenant constraint.");
    }

    // Let's look at all customers and see if there are duplicate phones across different business_ids
    const { data: allCustomers, error: custErr } = await supabase
      .from('customers')
      .select('business_id, phone');

    if (custErr) {
      console.error("Error reading customers:", custErr);
      process.exit(1);
    }

    console.log("Total customers:", allCustomers.length);
    const phoneMap = {};
    const duplicates = [];
    allCustomers.forEach(c => {
      if (phoneMap[c.phone]) {
        if (phoneMap[c.phone] !== c.business_id) {
          duplicates.push({ phone: c.phone, bus1: phoneMap[c.phone], bus2: c.business_id });
        }
      } else {
        phoneMap[c.phone] = c.business_id;
      }
    });

    console.log("Duplicate phones across businesses:", duplicates);

    // Let's try to query the unique constraints on table 'customers' using a simple insert test
    // We can try to insert a customer with an existing phone but different business id
    if (allCustomers.length > 0) {
      const existingCustomer = allCustomers[0];
      // Find a business ID different from existingCustomer.business_id
      let diffBusinessId = null;
      for (const p of profiles) {
        if (p.active_business_id !== existingCustomer.business_id) {
          diffBusinessId = p.active_business_id;
          break;
        }
      }

      if (diffBusinessId) {
        console.log(`Testing duplicate phone constraint: Inserting existing phone "${existingCustomer.phone}" from business "${existingCustomer.business_id}" into business "${diffBusinessId}"`);
        const { data: inserted, error: insertErr } = await supabase
          .from('customers')
          .insert({
            business_id: diffBusinessId,
            name: 'Test Multi-Tenant',
            phone: existingCustomer.phone,
          })
          .select('*');

        if (insertErr) {
          console.log("Insert failed as expected if constraint is global:", insertErr.message);
        } else {
          console.log("Insert succeeded! Constraint is NOT global (or there's no unique constraint):", inserted);
          // Let's clean it up
          await supabase.from('customers').delete().eq('id', inserted[0].id);
        }
      } else {
        console.log("Could not find a different business ID to test.");
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
