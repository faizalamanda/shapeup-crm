const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  'https://jfflztwirjonhumcykay.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmZmx6dHdpcmpvbmh1bWN5a2F5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzExNzg2NywiZXhwIjoyMDg4NjkzODY3fQ.x8gJmSsLDLTfqKlU3-FKYbuuiMu3peaFQ1YA9EDDqWg'
)

async function main() {
  // Get view definition from pg_views
  const { data: viewDef, error: e1 } = await supabase.rpc('exec_sql', {
    sql: `SELECT definition FROM pg_views WHERE viewname = 'customer_metrics' AND schemaname = 'public'`
  })
  if (e1) {
    console.log('exec_sql not available, trying information_schema...')
    // Try to get columns instead
    const { data: cols, error: e2 } = await supabase.rpc('exec_sql', {
      sql: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'customer_metrics' AND table_schema = 'public' ORDER BY ordinal_position`
    })
    if (e2) {
      console.log('Error:', e2)
    } else {
      console.log('Columns:', JSON.stringify(cols, null, 2))
    }
  } else {
    console.log('View definition:', JSON.stringify(viewDef, null, 2))
  }

  // Also check a sample row to understand columns
  const { data: sample, error: e3 } = await supabase
    .from('customer_metrics')
    .select('*')
    .limit(1)

  if (e3) {
    console.log('Sample error:', e3)
  } else {
    console.log('Sample columns:', sample ? Object.keys(sample[0] || {}) : 'no data')
    console.log('Sample data:', JSON.stringify(sample, null, 2))
  }

  // Check orders table status values
  const { data: statuses, error: e4 } = await supabase
    .from('orders')
    .select('status')
    .limit(200)

  if (!e4 && statuses) {
    const uniqueStatuses = [...new Set(statuses.map(o => o.status))]
    console.log('Unique order statuses:', uniqueStatuses)
  }
}

main().catch(console.error)
