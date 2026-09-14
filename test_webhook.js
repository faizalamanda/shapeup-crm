import { createClient } from '@supabase/supabase-js'


const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  const { data, error } = await supabaseAdmin
    .from('business_integrations')
    .select('config')
    .eq('provider', 'accurate')
    .eq('is_active', true)
    .limit(1)

  if (error) {
    console.error(error)
    return
  }

  if (data && data.length > 0) {
    console.log(JSON.stringify(data[0].config.last_webhook_payload, null, 2))
    console.log("Time:", data[0].config.last_webhook_time)
  } else {
    console.log("No integrations found")
  }
}

check()
