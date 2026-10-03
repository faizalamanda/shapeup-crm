import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const opnameNum = 'OPN-814272'
  const { data: opnames, error: soErr } = await supabase
    .from('stock_opname')
    .select('id, items_json')
    .eq('opname_number', opnameNum)

  if (soErr || !opnames || opnames.length === 0) {
    console.error('Failed to fetch opname', soErr)
    return
  }

  const opname = opnames[0]
  console.log(`Opname ${opnameNum} ID: ${opname.id}`)
  console.log(`Total items in JSON: ${opname.items_json.length}`)

  let itemsWithDiff = 0
  for (const item of opname.items_json) {
    const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
    if (diff !== 0) itemsWithDiff++
  }
  console.log(`Items with diff != 0: ${itemsWithDiff}`)

  const { data: moves, error: mvErr } = await supabase
    .from('stock_moves')
    .select('id, product_id, type, qty, reference')
    .eq('source_type', 'stock_opname')
    .eq('source_id', opname.id)

  if (mvErr) {
    console.error('Failed to fetch moves', mvErr)
    return
  }

  console.log(`Moves in DB for this Opname: ${moves.length}`)
  console.log(moves)
}

run()
