import { NextRequest, NextResponse } from 'next/server'
import { executeAccurateSync } from '@/lib/integrations/accurate/syncService'

export async function POST(req: NextRequest) {
  try {
    // Validate service key
    const authKey = req.headers.get('x-service-key')
    if (authKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { businessId, payload } = await req.json()
    
    if (!businessId || !payload || !Array.isArray(payload)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    // Process payload to extract specificIds
    const specificInvoiceIds: number[] = []
    const specificReceiptIds: number[] = []
    
    payload.forEach((event: any) => {
      if (event.data && Array.isArray(event.data)) {
        event.data.forEach((item: any) => {
          if (item.salesInvoiceId) specificInvoiceIds.push(item.salesInvoiceId)
          if (item.salesReceiptId) specificReceiptIds.push(item.salesReceiptId)

          const typeStr = String(event.type || '').toUpperCase()
          const moduleStr = String(event.module || '').toUpperCase()
          
          if ((typeStr.includes('INVOICE') || moduleStr.includes('INVOICE')) && item.id) {
            specificInvoiceIds.push(item.id)
          }
          if ((typeStr.includes('RECEIPT') || moduleStr.includes('RECEIPT')) && item.id) {
            specificReceiptIds.push(item.id)
          }
        })
      }
    })

    if (specificInvoiceIds.length > 0 || specificReceiptIds.length > 0) {
      console.log(`[Accurate Process Queue] Processing specific IDs for ${businessId}: Invoices=${specificInvoiceIds.length}, Receipts=${specificReceiptIds.length}`)
      await executeAccurateSync(businessId, 1, { invoiceIds: specificInvoiceIds, receiptIds: specificReceiptIds })
    } else {
      console.log(`[Accurate Process Queue] No specific IDs found, running normal sync for ${businessId}`)
      await executeAccurateSync(businessId, 1)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Accurate Process Queue] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
