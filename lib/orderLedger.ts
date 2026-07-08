import { SupabaseClient } from '@supabase/supabase-js'

export async function syncOrderToLedger(
  orderId: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Fetch the order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderErr || !order) {
      throw new Error(`Order not found or error: ${orderErr?.message || 'unknown'}`)
    }

    const { business_id: businessId, order_number: orderNumber, status, grand_total } = order
    
    // 2. Resolve/Create Default Accounts
    const defaultAccounts = [
      { code: '101000', name: 'Kas POS (Tunai)', type: 'ASSET', business_id: businessId },
      { code: '101200', name: 'Bank / QRIS POS', type: 'ASSET', business_id: businessId },
      { code: '103000', name: 'Piutang Usaha', type: 'ASSET', business_id: businessId },
      { code: '401000', name: 'Pendapatan Penjualan POS', type: 'REVENUE', business_id: businessId },
      { code: '501000', name: 'Harga Pokok Penjualan (HPP)', type: 'EXPENSE', business_id: businessId },
      { code: '102000', name: 'Persediaan Barang', type: 'ASSET', business_id: businessId }
    ]

    const { data: existingAccounts } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('business_id', businessId)

    const existingCodes = existingAccounts ? existingAccounts.map(a => a.code) : []
    const accountsToCreate = defaultAccounts.filter(a => !existingCodes.includes(a.code))

    if (accountsToCreate.length > 0) {
      const { error: insAccErr } = await supabase.from('accounts').insert(accountsToCreate)
      if (insAccErr) {
        throw new Error(`Failed to create default accounts: ${insAccErr.message}`)
      }
    }

    // Refetch all accounts
    const { data: allAccounts, error: refetchAccErr } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('business_id', businessId)

    if (refetchAccErr || !allAccounts) {
      throw new Error(`Failed to refetch ledger accounts: ${refetchAccErr?.message || 'unknown'}`)
    }

    const accountMap: Record<string, string> = {}
    allAccounts.forEach(a => {
      accountMap[a.code] = a.id
    })

    // Helper to check if COD
    const isCod = isCodOrder(order)

    // 3. Process products mapping & auto-creation & stock/COGS calculation
    const items = Array.isArray(order.items_json) ? order.items_json : []
    let totalCogs = 0
    const matchedProducts: { item: any; dbProduct: any }[] = []

    for (const item of items) {
      let dbProd = null
      const sku = item.sku ? String(item.sku).trim() : ''
      const name = item.name ? String(item.name).trim() : ''

      // 3.1. Priority 1: SKU
      if (sku) {
        const { data } = await supabase
          .from('products')
          .select('*')
          .eq('business_id', businessId)
          .eq('sku', sku)
          .limit(1)
        if (data && data.length > 0) {
          dbProd = data[0]
        }
      }

      // 3.2. Priority 2: Name
      if (!dbProd && name) {
        const { data } = await supabase
          .from('products')
          .select('*')
          .eq('business_id', businessId)
          .ilike('name', name)
          .limit(1)
        if (data && data.length > 0) {
          dbProd = data[0]
        }
      }

      // 3.3. Auto-creation if not found
      if (!dbProd && name) {
        // Extract HPP (cost price) from WooCommerce metadata
        let extractedCostPrice = 0
        if (Array.isArray(item.meta_data)) {
          const cogMeta = item.meta_data.find((m: any) => 
            ['_wc_cog_item_cost', '_cog_item_cost', 'cost_price', 'cost', 'hpp'].includes(m.key)
          )
          if (cogMeta) {
            const val = parseFloat(cogMeta.value)
            if (!isNaN(val)) extractedCostPrice = val
          }
        }

        // Create new product
        const { data: newProd, error: newProdErr } = await supabase
          .from('products')
          .insert({
            business_id: businessId,
            name: name,
            sku: sku || null,
            price: parseFloat(item.price || item.total || 0) || 0,
            cost_price: extractedCostPrice,
            type: 'physical',
            stock_type: 'tracked',
            stock_quantity: 0
          })
          .select('*')
          .single()

        if (newProdErr) {
          console.error(`Failed to auto-create product: ${newProdErr.message}`)
        } else {
          dbProd = newProd
        }
      }

      if (dbProd) {
        matchedProducts.push({ item, dbProduct: dbProd })
        if (dbProd.type === 'physical' && dbProd.cost_price > 0) {
          totalCogs += dbProd.cost_price * (parseInt(item.quantity) || 1)
        }
      }
    }

    // 4. Fetch existing transactions for this order
    const { data: txs, error: txsErr } = await supabase
      .from('transactions')
      .select('*, journal_lines(*)')
      .eq('order_id', orderId)

    if (txsErr) {
      throw new Error(`Failed to fetch existing transactions: ${txsErr.message}`)
    }

    // Helper patterns to identify transactions
    const isSalesTx = (tx: any) => 
      (tx.description.includes('Penjualan') || tx.description.includes('Penerbitan') || tx.description.includes('Sales')) && 
      !tx.description.includes('Pembatalan') && !tx.description.includes('Retur') && !tx.description.includes('Refund') && !tx.description.includes('Reversal')

    const isPaymentTx = (tx: any) => 
      (tx.description.includes('Pelunasan') || tx.description.includes('Pembayaran') || tx.description.includes('Payment')) && 
      !tx.description.includes('Pembatalan') && !tx.description.includes('Retur') && !tx.description.includes('Refund') && !tx.description.includes('Reversal')

    const isReversalSalesTx = (tx: any) => 
      (tx.description.includes('Pembatalan') || tx.description.includes('Retur') || tx.description.includes('Refund') || tx.description.includes('Reversal')) && 
      (tx.description.includes('Penjualan') || tx.description.includes('Penerbitan') || tx.description.includes('Sales'))

    const isReversalPaymentTx = (tx: any) => 
      (tx.description.includes('Pembatalan') || tx.description.includes('Retur') || tx.description.includes('Refund') || tx.description.includes('Reversal')) && 
      (tx.description.includes('Pelunasan') || tx.description.includes('Pembayaran') || tx.description.includes('Payment'))

    const salesTx = txs?.find(isSalesTx)
    const paymentTx = txs?.find(isPaymentTx)
    const reversalSalesTx = txs?.find(isReversalSalesTx)
    const reversalPaymentTx = txs?.find(isReversalPaymentTx)

    const platform = order.source_platform || 'WooCommerce'

    // Helper to adjust stock
    const adjustStock = async (direction: 'deduct' | 'restore') => {
      for (const { item, dbProduct } of matchedProducts) {
        if (dbProduct.stock_type === 'tracked') {
          const qty = parseInt(item.quantity) || 1
          const delta = direction === 'deduct' ? -qty : qty
          const { error: stockErr } = await supabase
            .from('products')
            .update({ stock_quantity: dbProduct.stock_quantity + delta })
            .eq('id', dbProduct.id)

          if (stockErr) {
            console.error(`Failed to adjust stock for product ${dbProduct.id}: ${stockErr.message}`)
          } else {
            dbProduct.stock_quantity += delta
          }
        }
      }
    }

    // 5. Handle transitions based on current status
    if (status === 'processing') {
      // 5.1. SALES POSTING
      if (!salesTx) {
        // Deduct stock
        await adjustStock('deduct')

        // Insert transaction
        const { data: newSalesTx, error: insSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: order.order_date || new Date().toISOString(),
            description: `Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (insSalesErr) throw insSalesErr

        // Insert journal lines
        const journalLines = [
          {
            transaction_id: newSalesTx.id,
            account_id: accountMap['103000'], // Piutang Usaha
            debit: parseFloat(grand_total) || 0,
            credit: 0
          },
          {
            transaction_id: newSalesTx.id,
            account_id: accountMap['401000'], // Pendapatan
            debit: 0,
            credit: parseFloat(grand_total) || 0
          }
        ]

        if (totalCogs > 0) {
          journalLines.push(
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['501000'], // HPP
              debit: totalCogs,
              credit: 0
            },
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['102000'], // Persediaan Barang
              debit: 0,
              credit: totalCogs
            }
          )
        }

        const { error: insLinesErr } = await supabase.from('journal_lines').insert(journalLines)
        if (insLinesErr) throw insLinesErr
      }

      // 5.2. PAYMENT POSTING
      if (!isCod) {
        // Transfer/Online payment: should record payment immediately
        if (!paymentTx) {
          const { data: newPayTx, error: insPayErr } = await supabase
            .from('transactions')
            .insert({
              business_id: businessId,
              order_id: orderId,
              date: new Date().toISOString(),
              description: `Pembayaran ${platform} #${orderNumber}`
            })
            .select('id')
            .single()

          if (insPayErr) throw insPayErr

          const paymentLines = [
            {
              transaction_id: newPayTx.id,
              account_id: accountMap['101200'], // Bank
              debit: parseFloat(grand_total) || 0,
              credit: 0
            },
            {
              transaction_id: newPayTx.id,
              account_id: accountMap['103000'], // Piutang
              debit: 0,
              credit: parseFloat(grand_total) || 0
            }
          ]

          const { error: insPayLinesErr } = await supabase.from('journal_lines').insert(paymentLines)
          if (insPayLinesErr) throw insPayLinesErr
        }
      } else {
        // COD should NOT have payment posting in processing
        // If it exists (e.g. status was moved completed -> processing), reverse it!
        if (paymentTx && !reversalPaymentTx) {
          const { data: revPayTx, error: revPayErr } = await supabase
            .from('transactions')
            .insert({
              business_id: businessId,
              order_id: orderId,
              date: new Date().toISOString(),
              description: `Pembatalan Pembayaran ${platform} #${orderNumber}`
            })
            .select('id')
            .single()

          if (revPayErr) throw revPayErr

          const reversalLines = paymentTx.journal_lines.map((line: any) => ({
            transaction_id: revPayTx.id,
            account_id: line.account_id,
            debit: line.credit,
            credit: line.debit
          }))

          const { error: insRevLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
          if (insRevLinesErr) throw insRevLinesErr
        }
      }
    } 
    
    else if (status === 'completed') {
      // 5.1. Ensure Sales Posting exists
      if (!salesTx) {
        await adjustStock('deduct')

        const { data: newSalesTx, error: insSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: order.order_date || new Date().toISOString(),
            description: `Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (insSalesErr) throw insSalesErr

        const journalLines = [
          {
            transaction_id: newSalesTx.id,
            account_id: accountMap['103000'],
            debit: parseFloat(grand_total) || 0,
            credit: 0
          },
          {
            transaction_id: newSalesTx.id,
            account_id: accountMap['401000'],
            debit: 0,
            credit: parseFloat(grand_total) || 0
          }
        ]

        if (totalCogs > 0) {
          journalLines.push(
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['501000'],
              debit: totalCogs,
              credit: 0
            },
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['102000'],
              debit: 0,
              credit: totalCogs
            }
          )
        }

        const { error: insLinesErr } = await supabase.from('journal_lines').insert(journalLines)
        if (insLinesErr) throw insLinesErr
      }

      // 5.2. Ensure Payment Posting exists
      if (!paymentTx) {
        const payAccountCode = isCod ? '101000' : '101200'
        const { data: newPayTx, error: insPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (insPayErr) throw insPayErr

        const paymentLines = [
          {
            transaction_id: newPayTx.id,
            account_id: accountMap[payAccountCode], // Kas/Bank
            debit: parseFloat(grand_total) || 0,
            credit: 0
          },
          {
            transaction_id: newPayTx.id,
            account_id: accountMap['103000'], // Piutang
            debit: 0,
            credit: parseFloat(grand_total) || 0
          }
        ]

        const { error: insPayLinesErr } = await supabase.from('journal_lines').insert(paymentLines)
        if (insPayLinesErr) throw insPayLinesErr
      }
    }

    else if (status === 'cancelled' || status === 'failed') {
      // Full Reversal: Restores stock, reverses Sales Posting (including COGS), reverses Payment Posting
      if (salesTx && !reversalSalesTx) {
        // Restore stock
        await adjustStock('restore')

        // Insert reversal sales transaction
        const { data: revSalesTx, error: revSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Pembatalan Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revSalesErr) throw revSalesErr

        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          transaction_id: revSalesTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevSalesLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevSalesLinesErr) throw insRevSalesLinesErr
      }

      if (paymentTx && !reversalPaymentTx) {
        // Insert reversal payment transaction
        const { data: revPayTx, error: revPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Pembatalan Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revPayErr) throw revPayErr

        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          transaction_id: revPayTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevPayLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevPayLinesErr) throw insRevPayLinesErr
      }
    }

    else if (status === 'refunded') {
      // Refund: Money returned, goods NOT returned. Stock is NOT restored, HPP is NOT reversed (HPP remains).
      if (salesTx && !reversalSalesTx) {
        // Insert reversal sales transaction (excluding COGS/inventory)
        const { data: revSalesTx, error: revSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Refund Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revSalesErr) throw revSalesErr

        // Filter to ONLY reverse non-COGS lines (meaning 103000 Piutang and 401000 Pendapatan)
        const nonCogsLines = salesTx.journal_lines.filter((line: any) => {
          return line.account_id === accountMap['103000'] || line.account_id === accountMap['401000']
        })

        const reversalLines = nonCogsLines.map((line: any) => ({
          transaction_id: revSalesTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevSalesLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevSalesLinesErr) throw insRevSalesLinesErr
      }

      if (paymentTx && !reversalPaymentTx) {
        // Insert reversal payment transaction
        const { data: revPayTx, error: revPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Refund Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revPayErr) throw revPayErr

        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          transaction_id: revPayTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevPayLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevPayLinesErr) throw insRevPayLinesErr
      }
    }

    else if (status === 'returned') {
      // Return: Money returned, goods ARE returned. Stock IS restored, HPP IS reversed (full reversal).
      if (salesTx && !reversalSalesTx) {
        // Restore stock
        await adjustStock('restore')

        // Insert reversal sales transaction (full reversal)
        const { data: revSalesTx, error: revSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Retur Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revSalesErr) throw revSalesErr

        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          transaction_id: revSalesTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevSalesLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevSalesLinesErr) throw insRevSalesLinesErr
      }

      if (paymentTx && !reversalPaymentTx) {
        // Insert reversal payment transaction
        const { data: revPayTx, error: revPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Retur Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revPayErr) throw revPayErr

        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          transaction_id: revPayTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevPayLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevPayLinesErr) throw insRevPayLinesErr
      }
    }

    return { success: true, message: 'Sync complete' }
  } catch (err: any) {
    console.error('syncOrderToLedger Error:', err)
    return { success: false, message: err.message || 'Internal server error' }
  }
}

function isCodOrder(order: any): boolean {
  const method = (order.payment_method || '').toLowerCase()
  const rawMethod = (order.raw_source_data?.payment_method || '').toLowerCase()
  return (
    method.includes('cod') ||
    method.includes('cash on delivery') ||
    method.includes('bayar di tempat') ||
    method.includes('tunai') ||
    method === 'cash' ||
    rawMethod === 'cod' ||
    rawMethod.includes('cod')
  )
}
