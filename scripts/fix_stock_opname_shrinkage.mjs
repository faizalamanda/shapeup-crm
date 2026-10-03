import { createClient } from '@supabase/supabase-js'


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  console.log('Fetching all stock opname records...')
  const { data: opnames, error: soErr } = await supabase
    .from('stock_opname')
    .select('id, opname_number, items_json')

  if (soErr) {
    console.error('Error fetching stock opname:', soErr)
    return
  }

  let fixedMoves = 0
  let fixedProducts = 0

  for (const opname of opnames) {
    if (!opname.items_json || !Array.isArray(opname.items_json)) continue

    const shrinkageProductIds = opname.items_json
      .filter((item) => {
        const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
        return diff < 0
      })
      .map((item) => item.product_id)

    // For all items in the opname, let's sync physical stock to actual_quantity
    for (const item of opname.items_json) {
       const actQty = parseFloat(item.actual_quantity) || 0
       const { error: pErr } = await supabase.from('products').update({ stock_quantity: actQty }).eq('id', item.product_id)
       if (pErr) {
           console.error('Failed to sync physical stock for', item.product_id, pErr)
       } else {
           fixedProducts++
       }
    }

    if (shrinkageProductIds.length === 0) continue

    // Find stock moves for this opname that are 'adjustment' and have no origin_location_id
    const { data: moves, error: mvErr } = await supabase
      .from('stock_moves')
      .select('id, product_id, origin_location_id')
      .eq('source_type', 'stock_opname')
      .eq('source_id', opname.id)
      .eq('type', 'adjustment')
      .is('origin_location_id', null)
      .in('product_id', shrinkageProductIds)

    if (mvErr) {
      console.error(`Error fetching moves for opname ${opname.id}:`, mvErr)
      continue
    }

    if (moves && moves.length > 0) {
      const moveIds = moves.map(m => m.id)
      const { error: updErr } = await supabase
        .from('stock_moves')
        .update({ origin_location_id: '00000000-0000-0000-0000-000000000000' })
        .in('id', moveIds)

      if (updErr) {
        console.error(`Failed to update moves for opname ${opname.id}:`, updErr)
      } else {
        console.log(`Fixed ${moves.length} shrinkage moves for opname ${opname.opname_number}`)
        fixedMoves += moves.length
      }
    }
  }

  console.log(`Done! Fixed ${fixedMoves} stock moves and re-synced ${fixedProducts} physical product stock quantities.`)
}

run()
