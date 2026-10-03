import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data: opnames } = await supabase.from('stock_opname').select('id, opname_number, items_json, business_id, date')
  
  let missingOpnames = 0
  let totalMissingMoves = 0

  for (const opname of opnames) {
    if (!opname.items_json) continue

    let diffItems = 0
    for (const item of opname.items_json) {
      const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
      if (diff !== 0) diffItems++
    }

    if (diffItems === 0) continue

    const { count } = await supabase
      .from('stock_moves')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'stock_opname')
      .eq('source_id', opname.id)

    if (count !== diffItems) {
      console.log(`Opname ${opname.opname_number} (${opname.id}) has ${diffItems} diff items but ${count} moves in DB.`)
      missingOpnames++
      totalMissingMoves += (diffItems - (count || 0))
      
      // Let's fix it by inserting missing moves
      if (count < diffItems) {
          const { data: existingMoves } = await supabase.from('stock_moves').select('product_id').eq('source_id', opname.id)
          const existingProductIds = existingMoves ? existingMoves.map((m) => m.product_id) : []

          const stockMoveInputs = opname.items_json
            .filter((item) => !existingProductIds.includes(item.product_id))
            .map((item) => {
              const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
              return {
                business_id: opname.business_id,
                product_id: item.product_id,
                reference: opname.opname_number,
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
            
          if (stockMoveInputs.length > 0) {
              const { error } = await supabase.from('stock_moves').insert(stockMoveInputs)
              if (error) {
                console.error(`Fix failed for ${opname.opname_number}`, error.message || error)
              } else {
                console.log(`Inserted ${stockMoveInputs.length} missing moves for ${opname.opname_number}`)
              }
          }
      }
    }
  }
  
  console.log(`Total missing opnames: ${missingOpnames}. Total missing moves: ${totalMissingMoves}`)
}

run()
