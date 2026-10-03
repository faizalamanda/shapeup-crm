import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data: opnames } = await supabase.from('stock_opname').select('id, opname_number, created_at')
  
  let fixedCount = 0
  for (const opname of opnames) {
    const { data: moves, error: selErr } = await supabase
      .from('stock_moves')
      .select('id, created_at')
      .eq('source_type', 'stock_opname')
      .eq('source_id', opname.id)

    if (selErr) {
        console.error('Failed to select moves', selErr)
        continue
    }

    if (!moves || moves.length === 0) continue

    // Check if any move has the wrong timestamp (i.e. '00:00:00+00' which is 07:00 WIB)
    // Actually, let's just forcefully sync all of them to opname.created_at to ensure precision!
    const moveIds = moves.map(m => m.id)
    
    const { error: updErr } = await supabase
      .from('stock_moves')
      .update({ created_at: opname.created_at })
      .in('id', moveIds)

    if (updErr) {
      console.error(`Failed to update timestamp for ${opname.opname_number}:`, updErr.message)
    } else {
      fixedCount += moveIds.length
    }
  }

  console.log(`Synced ${fixedCount} move timestamps to their exact Stock Opname execution time.`)
}

run()
