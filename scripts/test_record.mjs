import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const moves = [
    {
      businessId: '097211f4-2d19-4196-a7b7-5b2cd17c2588',
      productId: 'e6799bfc-1dc0-48bd-b58e-cdede6c2f3e8',
      reference: 'OPN-889493',
      qty: 25,
      unitCost: 0,
      type: 'adjustment',
      sourceType: 'stock_opname',
      sourceId: '2993ac4e-919f-443d-b8d3-fe445f478a3c',
      status: 'done',
      createdAt: '2026-10-03T05:38:45.846Z',
      originLocationId: '00000000-0000-0000-0000-000000000000',
      destinationLocationId: null
    },
    {
      businessId: '097211f4-2d19-4196-a7b7-5b2cd17c2588',
      productId: 'e4d1e722-32bb-49f4-9d3b-1daf74898116',
      reference: 'OPN-889493',
      qty: 2,
      unitCost: 0,
      type: 'adjustment',
      sourceType: 'stock_opname',
      sourceId: '2993ac4e-919f-443d-b8d3-fe445f478a3c',
      status: 'done',
      createdAt: '2026-10-03T05:38:45.846Z',
      originLocationId: '00000000-0000-0000-0000-000000000000',
      destinationLocationId: null
    }
  ]

  const newMoveRows = moves.map(m => {
    const row = {
      business_id: m.businessId,
      product_id: m.productId,
      reference: m.reference,
      qty: Math.abs(m.qty),
      unit_cost: m.unitCost || 0,
      status: m.status || 'done',
      type: m.type,
      origin_location_id: m.originLocationId || null,
      destination_location_id: m.destinationLocationId || null,
      created_at: m.createdAt
    }
    row.source_type = m.sourceType
    row.source_id = m.sourceId
    return row
  })

  console.log("Attempting insert...")
  const res = await supabase.from('stock_moves').insert(newMoveRows)
  console.log(res.error || res.data)
}

run()
