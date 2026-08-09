const fs = require('fs')
const envText = fs.readFileSync('.env.local', 'utf8')
envText.split('\n').forEach(line => {
  const [k, v] = line.split('=')
  if (k && v) process.env[k.trim()] = v.trim()
})
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspect() {
  const bid = '097211f4-2d19-4196-a7b7-5b2cd17c2588' // Alamanda

  // 1. Fetch ALL customer_metrics using chunked pagination WITH ORDER BY
  let allCm = []
  let cFrom = 0
  while (true) {
    const { data: chunk, error: cmErr } = await supabase
      .from('customer_metrics')
      .select('*')
      .eq('business_id', bid)
      .order('customer_id', { ascending: true })
      .range(cFrom, cFrom + 999)

    if (cmErr || !chunk || chunk.length === 0) break
    allCm.push(...chunk)
    if (chunk.length < 1000) break
    cFrom += 1000
  }

  console.log('Total fetched rows across chunks:', allCm.length)

  // Deduplicate by customer_id
  const uniqueMap = new Map()
  allCm.forEach(c => {
    if (c.customer_id && !uniqueMap.has(c.customer_id)) {
      uniqueMap.set(c.customer_id, c)
    }
  })

  const uniqueCustomers = Array.from(uniqueMap.values())
  console.log('Total unique customers in DB:', uniqueCustomers.length)

  const gte500k = uniqueCustomers.filter(c => Number(c.ltv || 0) >= 500000)
  console.log('Unique customers with ltv >= 500000:', gte500k.length)
}

inspect()
