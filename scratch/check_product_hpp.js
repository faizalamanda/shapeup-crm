const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    const key = match[1]
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[key] = value
  }
})

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function inspectProduct() {
  console.log('--- Inspecting Product Kemeja Baru Test ---')

  const { data: prods, error: pErr } = await supabase
    .from('products')
    .select('id, name, sku, type, cost_price, price, stock_type, stock_quantity')
    .ilike('name', '%Kemeja%')

  console.log('Products found:', prods, pErr)

  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, items_json')
    .ilike('order_number', '%INV-29082026-001%')

  console.log('Order items_json:', JSON.stringify(orders, null, 2))
}

inspectProduct()
