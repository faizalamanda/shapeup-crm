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
  console.log("Fetching profiles with null business_id...");
  const { data: nullProfiles, error: fetchError } = await supabase
    .from('profiles')
    .select('*')
    .or('business_id.is.null,active_business_id.is.null');

  if (fetchError) {
    console.error("Error fetching profiles:", fetchError);
    return;
  }

  console.log(`Found ${nullProfiles.length} profiles to check:`);
  
  for (const profile of nullProfiles) {
    console.log(`- Profile: ${profile.email} (${profile.full_name})`);
    
    // Determine intended business ID based on name/email
    let targetBusinessId = null;
    if (profile.email.includes('alamanda') && !profile.email.includes('toko')) {
      targetBusinessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588'; // Alamanda
    } else if (profile.email.includes('toko') || profile.email.includes('cs@tokoalamanda.com')) {
      targetBusinessId = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'; // TOKO ALAMANDA
    } else {
      // Look at existing assignments first
      const { data: bs } = await supabase
        .from('business_staff')
        .select('business_id')
        .eq('profile_id', profile.id)
        .limit(1);
      if (bs && bs.length > 0) {
        targetBusinessId = bs[0].business_id;
      }
    }

    if (targetBusinessId) {
      console.log(`  Assigning to business ID: ${targetBusinessId}`);
      
      // 1. Insert into business_staff if not already present
      const { error: bsError } = await supabase
        .from('business_staff')
        .insert({
          business_id: targetBusinessId,
          profile_id: profile.id,
          role: profile.role || 'staff'
        })
        .select();

      if (bsError && bsError.code !== '23505') { // Ignore unique constraint violation if already exists
        console.error("  Error inserting business_staff:", bsError);
      } else {
        console.log("  Ensured business_staff assignment exists.");
      }

      // 2. Update profile fields
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          business_id: targetBusinessId,
          active_business_id: targetBusinessId
        })
        .eq('id', profile.id);

      if (profileError) {
        console.error("  Error updating profile:", profileError);
      } else {
        console.log("  Successfully updated profile business_id and active_business_id.");
      }
    } else {
      console.log("  Could not determine target business, skipping.");
    }
  }
}

run();
