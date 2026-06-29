import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    // 1. Get logged-in user and active business ID
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found for user profile' }, { status: 400 })
    }

    const businessId = profile.active_business_id
    const body = await req.json()
    const { order_id } = body

    if (!order_id) {
      return NextResponse.json({ error: 'Order ID wajib disertasikan' }, { status: 400 })
    }

    // 2. Fetch the existing order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .eq('business_id', businessId)
      .single()

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Pesanan tidak ditemukan' }, { status: 404 })
    }

    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Pesanan sudah dibatalkan sebelumnya' }, { status: 400 })
    }

    // 3. Update order status to cancelled
    const { error: updErr } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', order_id)

    if (updErr) {
      return NextResponse.json({ error: 'Gagal memperbarui status pesanan: ' + updErr.message }, { status: 500 })
    }

    // 4. Restock tracked products
    const items = Array.isArray(order.items_json) ? order.items_json : []
    const productIds = items.map((i: any) => i.product_id).filter(Boolean)

    let totalCogs = 0

    if (productIds.length > 0) {
      const { data: dbProducts } = await supabase
        .from('products')
        .select('id, cost_price, stock_type, stock_quantity, type')
        .in('id', productIds)

      if (dbProducts) {
        const productMap = new Map<string, any>()
        dbProducts.forEach(p => productMap.set(p.id, p))

        for (const item of items) {
          const dbProd = productMap.get(item.product_id)
          if (dbProd) {
            // Restore stock
            if (dbProd.stock_type === 'tracked') {
              const { error: stockErr } = await supabase
                .from('products')
                .update({ stock_quantity: dbProd.stock_quantity + Number(item.quantity) })
                .eq('id', dbProd.id)

              if (stockErr) {
                console.error(`Gagal restok produk ${dbProd.id}:`, stockErr.message)
              }
            }

            // Calculate COGS to reverse
            if (dbProd.type === 'physical' && dbProd.cost_price > 0) {
              totalCogs += dbProd.cost_price * Number(item.quantity)
            }
          }
        }
      }
    }

    // 5. Fetch Ledger Accounts
    const { data: accounts, error: accErr } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('business_id', businessId)

    if (accErr || !accounts) {
      return NextResponse.json({ error: 'Gagal mengambil akun ledger: ' + (accErr?.message || '') }, { status: 500 })
    }

    const accountMap: Record<string, string> = {}
    accounts.forEach(a => {
      accountMap[a.code] = a.id
    })

    // 6. Record Reversal Ledger Transaction
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        order_id: order.id,
        date: new Date().toISOString(),
        description: `Refund/Pembatalan POS #${order.order_number}`
      })
      .select('id')
      .single()

    if (txErr) {
      return NextResponse.json({ error: 'Gagal mencatat transaksi refund: ' + txErr.message }, { status: 500 })
    }

    // Determine Cash or Bank account to credit
    const creditAccountCode = order.payment_method === 'Cash' ? '101000' : '101200'
    const creditAccountId = accountMap[creditAccountCode]
    const debitAccountId = accountMap['401000']

    // Reverse: Debit Revenue, Credit Cash/Bank
    const journalLines = [
      {
        transaction_id: tx.id,
        account_id: debitAccountId,
        debit: order.grand_total,
        credit: 0
      },
      {
        transaction_id: tx.id,
        account_id: creditAccountId,
        debit: 0,
        credit: order.grand_total
      }
    ]

    // Reverse COGS: Debit Inventory, Credit COGS
    if (totalCogs > 0) {
      journalLines.push(
        {
          transaction_id: tx.id,
          account_id: accountMap['102000'],
          debit: totalCogs,
          credit: 0
        },
        {
          transaction_id: tx.id,
          account_id: accountMap['501000'],
          debit: 0,
          credit: totalCogs
        }
      )
    }

    const { error: jlErr } = await supabase
      .from('journal_lines')
      .insert(journalLines)

    if (jlErr) {
      return NextResponse.json({ error: 'Gagal mencatat jurnal pembalikan (double-entry): ' + jlErr.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Pesanan berhasil direfund'
    }, { status: 200 })

  } catch (err: any) {
    console.error('POS Refund Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
