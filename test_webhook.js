import { createClient } from '@supabase/supabase-js'


const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  const { data, error } = await supabaseAdmin
    .from('business_integrations')
    .select('id, is_active, config')
    .eq('provider', 'accurate')

  if (error) {
    console.error(error)
    return
  }

  if (data && data.length > 0) {
    console.log(`Found ${data.length} accurate integrations:`)
    for (const item of data) {
      console.log(`ID: ${item.id}, Active: ${item.is_active}`)
      console.log(`Webhook Time:`, item.config?.last_webhook_time)
      console.log(`Payload:`, item.config?.last_webhook_payload ? JSON.stringify(item.config.last_webhook_payload, null, 2) : 'NONE')
    }
  } else {
    console.log("No integrations found")
  }
}

check()
