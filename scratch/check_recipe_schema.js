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

async function checkSchema() {
  console.log('Testing select from product_recipes...')
  const { data, error } = await supabase.from('product_recipes').select('*').limit(1)
  console.log('product_recipes status:', data, error)

  const { data: prodData, error: prodErr } = await supabase.from('products').select('id, name, unit, hpp_type, stock_quantity').limit(1)
  console.log('products status:', prodData, prodErr)
}

checkSchema()
