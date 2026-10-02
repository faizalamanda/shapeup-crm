import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = 'https://supabase.tokoalamanda.com'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODkwMTc4ODIsImV4cCI6MTk0NjY5Nzg4Mn0.W3KA5K-6fKXlu4Kqi_96f8l9BmMfOnU373IB7Bx_-7M'
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function run() {
  const prodId = '2b8fba7d-43a6-423c-ab45-241c4f8976c4'
  
  // fetch all orders for testing
  let allOrders = []
  let from = 0
  while (true) {
    const { data } = await supabase.from('orders').select('id, order_number, status, items_json').range(from, from + 1000)
    if (!data || data.length === 0) break
    allOrders = allOrders.concat(data)
    from += 1001
  }
  
  let matchCount = 0;
  for (const o of allOrders) {
     if (typeof o.items_json === 'string') {
        if (o.items_json.includes('Believe Flower') || o.items_json.includes(prodId)) {
           matchCount++;
           console.log('Matched Order:', o.order_number, o.status, o.items_json);
        }
     } else if (Array.isArray(o.items_json)) {
        if (JSON.stringify(o.items_json).includes('Believe Flower') || JSON.stringify(o.items_json).includes(prodId)) {
           matchCount++;
           console.log('Matched Order:', o.order_number, o.status, JSON.stringify(o.items_json).substring(0, 100));
        }
     }
  }
  console.log('Total orders matched locally:', matchCount);
}
run()
