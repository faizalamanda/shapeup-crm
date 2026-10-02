import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = 'https://supabase.tokoalamanda.com'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODkwMTc4ODIsImV4cCI6MTk0NjY5Nzg4Mn0.W3KA5K-6fKXlu4Kqi_96f8l9BmMfOnU373IB7Bx_-7M'
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function run() {
  const { data: prod } = await supabase.from('products').select('*').ilike('name', '%Believe Flower Tee T-shirt - Light Pink, XL%').single()
  if (!prod) { console.log('Product not found!'); return; }
  console.log('Product:', prod.id, prod.name)
  
  // check stock moves
  const { data: moves } = await supabase.from('stock_moves').select('*').eq('product_id', prod.id)
  console.log('Moves count:', moves?.length)
  console.log('Moves types:', moves?.map(m => m.type))
  
  // check orders that contain this product in items_json
  // we need to fetch orders and filter
  const { data: orders } = await supabase.from('orders').select('id, order_number, status, items_json').ilike('items_json', `%${prod.id}%`)
  console.log('Orders with this product by ID:', orders?.length)
  
  const { data: ordersByName } = await supabase.from('orders').select('id, order_number, status, items_json').ilike('items_json', `%Believe Flower Tee T-shirt - Light Pink, XL%`)
  console.log('Orders with this product by name:', ordersByName?.length)
  
  if (ordersByName?.length > 0) {
     console.log('Sample Order 1:', ordersByName[0].order_number, ordersByName[0].status, ordersByName[0].items_json)
  }
}
run()
