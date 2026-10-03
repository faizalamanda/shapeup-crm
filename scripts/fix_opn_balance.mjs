import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data: opname, error } = await supabase.from('stock_opname').select('*').eq('opname_number', 'OPN-814272').single()
  
  if (error || !opname) {
    console.error('Opname not found', error)
    return
  }

  const items = opname.items_json
  let updatedMoves = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    
    // Find true running balance just BEFORE this opname
    const { data: priorMoves } = await supabase
      .from('v_stock_moves_ledger')
      .select('system_stock')
      .eq('product_id', item.product_id)
      .lt('created_at', opname.created_at) // Strictly before this opname
      .order('created_at', { ascending: false })
      .limit(1)

    const trueBalance = priorMoves && priorMoves.length > 0 ? priorMoves[0].system_stock : 0

    // The user's intended physical stock
    const actualStock = parseFloat(item.actual_quantity) || 0
    
    const trueDiff = actualStock - trueBalance

    // Update items_json
    item.recorded_quantity = trueBalance
    
    // Find the corresponding stock_move
    const { data: move } = await supabase
      .from('stock_moves')
      .select('id')
      .eq('source_type', 'stock_opname')
      .eq('source_id', opname.id)
      .eq('product_id', item.product_id)
      .single()

    if (move) {
      if (trueDiff === 0) {
        // Delete move if no diff
        await supabase.from('stock_moves').delete().eq('id', move.id)
        updatedMoves++
      } else {
        // Update move qty and origin/dest
        const originId = trueDiff < 0 ? '00000000-0000-0000-0000-000000000000' : null
        await supabase.from('stock_moves').update({ 
          qty: Math.abs(trueDiff),
          origin_location_id: originId
        }).eq('id', move.id)
        updatedMoves++
      }
    } else if (trueDiff !== 0) {
       // Insert missing move just in case
        const originId = trueDiff < 0 ? '00000000-0000-0000-0000-000000000000' : null
        await supabase.from('stock_moves').insert({
            business_id: opname.business_id,
            product_id: item.product_id,
            reference: opname.opname_number,
            qty: Math.abs(trueDiff),
            unit_cost: 0,
            type: 'adjustment',
            source_type: 'stock_opname',
            source_id: opname.id,
            status: 'done',
            created_at: opname.created_at,
            origin_location_id: originId,
            destination_location_id: null
        })
        updatedMoves++
    }
  }

  // Update opname items_json
  await supabase.from('stock_opname').update({ items_json: items }).eq('id', opname.id)
  
  // Finally, resync products.stock_quantity for all these products to match current ledger balance
  for (const item of items) {
     const { data: latestMove } = await supabase
      .from('v_stock_moves_ledger')
      .select('system_stock')
      .eq('product_id', item.product_id)
      .order('created_at', { ascending: false })
      .limit(1)
      
     const currentTrueBalance = latestMove && latestMove.length > 0 ? latestMove[0].system_stock : 0
     await supabase.from('products').update({ stock_quantity: currentTrueBalance }).eq('id', item.product_id)
  }

  console.log(`Fixed OPN-814272. Updated ${updatedMoves} moves and synced physical stock.`)
}

run()
