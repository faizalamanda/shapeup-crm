import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const opnameNum = 'OPN-814272'
  const { data: opnames } = await supabase
    .from('stock_opname')
    .select('*')
    .eq('opname_number', opnameNum)

  const opname = opnames[0]
  
  const stockMoveInputs = opname.items_json
    .map((item) => {
      const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
      return {
        business_id: opname.business_id,
        product_id: item.product_id,
        reference: opnameNum,
        qty: Math.abs(diff),
        unit_cost: 0,
        type: 'adjustment',
        source_type: 'stock_opname',
        source_id: opname.id,
        status: 'done',
        created_at: opname.date || new Date().toISOString(),
        origin_location_id: diff < 0 ? '00000000-0000-0000-0000-000000000000' : null,
        destination_location_id: null
      }
    })
    .filter((m) => m.qty > 0)

  console.log(`Trying to insert ${stockMoveInputs.length} moves...`)
  const { data, error } = await supabase.from('stock_moves').insert(stockMoveInputs)
  if (error) {
    console.error('Insert error:', error)
  } else {
    console.log('Success!')
  }
}

run()
